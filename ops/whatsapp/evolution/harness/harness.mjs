// Isolated QR-pairing harness. Runs INSIDE a throwaway container from the
// exact production image (evoapicloud/evolution-api:v2.3.7) so node, baileys
// and every dependency are byte-identical to production. No Evolution API, no
// Postgres, no webhook, no bridge. Never sends a message: only the pairing
// handshake is exercised. Usage (args): --variant baseline|patched --mode mock|live
// BAILEYS_PATH lets a variant load a different build (e.g. the PR #2765 head built from source)
const BAILEYS_ROOT = process.env.BAILEYS_PATH || '/evolution/node_modules/baileys';
const B = await import(`${BAILEYS_ROOT}/lib/index.js`);
const makeWASocket = B.default || B.makeWASocket; const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = B;
const { binaryNodeToString } = await import(`${BAILEYS_ROOT}/lib/WABinary/index.js`);
import pino from 'pino';
import QRCode from 'qrcode';
import qrTerminal from 'qrcode-terminal';
import fs from 'fs';
import { Boom } from '@hapi/boom';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const variant = arg('--variant', 'baseline');
const mode = arg('--mode', 'mock');
const OUT = '/evolution/h/out';
const logPath = `${OUT}/${variant}-${mode}.log.jsonl`;
const logger = pino({ level: 'trace' }, pino.destination({ dest: logPath, sync: true }));
const say = (o) => { const line = JSON.stringify({ t: new Date().toISOString(), ...o }); console.log(line); fs.appendFileSync(`${OUT}/${variant}-${mode}.events.jsonl`, line + '\n'); };

const { state, saveCreds } = await useMultiFileAuthState(`${OUT}/auth-${variant}-${mode}`);
const version = process.env.WA_VERSION ? process.env.WA_VERSION.split('.').map(Number) : (await fetchLatestBaileysVersion()).version;
say({ ev: 'start', variant, mode, version, node: process.version, hasMe: !!state.creds.me, baileys: BAILEYS_ROOT, qrTimeout: Number(process.env.QR_TIMEOUT || 45000) });

let sock; let attempts = 0; const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS || 4);
function connect() {
attempts++;
say({ ev: 'connect', attempt: attempts });
sock = makeWASocket({
  version,
  auth: state,
  logger,
  printQRInTerminal: false,
  browser: ['MYTHOS bridge', 'Chrome', '7.0.0-30-generic'], // same as production
  qrTimeout: Number(process.env.QR_TIMEOUT || 45000), // 45 s = Evolution v2.3.7; raise for a wider scan window
  keepAliveIntervalMs: 30000, // same as Evolution v2.3.7
  connectTimeoutMs: 30000,
  syncFullHistory: false,
  markOnlineOnConnect: false,
  generateHighQualityLinkPreview: false
});

let qrCount = 0; let lastQr; let rotated = false;
sock.ev.on('creds.update', async (u) => { await saveCreds(); if (u && u.advSecretKey) { rotated = true; say({ ev: 'creds.update', advSecretKeyRotated: true }); } });
sock.ws.on('CB:notification', (node) => say({ ev: 'notification', type: node.attrs.type, xml: binaryNodeToString(node) }));
sock.ws.on('CB:iq,,pair-success', () => say({ ev: 'pair-success-received' }));
sock.ev.on('connection.update', async (u) => {
  const { connection, lastDisconnect, qr, isNewLogin } = u;
  if (qr) {
    qrCount++;
    const parts = qr.split(',');
    const changedAdv = lastQr && lastQr.split(',')[0] === parts[0] && lastQr.split(',')[3] !== parts[3];
    say({ ev: 'qr', n: qrCount, ref: parts[0].slice(0, 12) + '…', advTail: parts[3].slice(-8), sameRefNewAdv: !!changedAdv });
    lastQr = qr;
    if (mode === 'live') {
      await QRCode.toFile(`${OUT}/qr-${variant}.png`, qr, { errorCorrectionLevel: 'L', scale: 8 });
      fs.chmodSync(`${OUT}/qr-${variant}.png`, 0o600);
      say({ ev: 'qr-written', file: `${OUT}/qr-${variant}.png` });
      if (process.stdout.isTTY || process.env.QR_TTY) { qrTerminal.generate(qr, { small: true }, (t) => console.log(t)); }
    }
    if (mode === 'mock' && qrCount === 1) {
      // Inject the exact stanza from WhiskeySockets/Baileys#2737, as the socket
      // would dispatch it (onMessageReceived emits CB:notification,type:<type>).
      setTimeout(() => {
        const node = { tag: 'notification', attrs: { from: '@s.whatsapp.net', type: 'companion_reg_refresh', id: '510447984', t: String(Math.floor(Date.now() / 1000)) }, content: [{ tag: 'companion_reg_refresh', attrs: {} }] };
        say({ ev: 'inject', xml: binaryNodeToString(node) });
        sock.ws.emit('CB:notification,type:companion_reg_refresh', node);
        sock.ws.emit('CB:notification', node);
        setTimeout(() => {
          say({ ev: 'mock-result', variant, qrEmitted: qrCount, advRotated: rotated, verdict: rotated && qrCount >= 2 ? 'ROTATED_AND_REFRESHED' : 'NO_ROTATION' });
          sock.end(new Boom('mock done', { statusCode: DisconnectReason.loggedOut }));
          setTimeout(() => process.exit(0), 500);
        }, 1500);
      }, 1500);
    }
  }
  if (connection === 'open') {
    say({ ev: 'OPEN', isNewLogin, me: sock.user && sock.user.id ? sock.user.id.replace(/\d(?=\d{4})/g, 'x') : null });
    say({ ev: 'PAIRED_OK', note: 'logging out the test device now so no session is left behind' });
    try { await sock.logout('harness done'); } catch (e) { say({ ev: 'logout-error', err: String(e) }); }
    setTimeout(() => process.exit(0), 1000);
  }
  if (connection === 'close') {
    const code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output ? lastDisconnect.error.output.statusCode : undefined;
    say({ ev: 'close', code, msg: lastDisconnect && lastDisconnect.error ? lastDisconnect.error.message : undefined, qrEmitted: qrCount, advRotated: rotated, hasMe: !!state.creds.me });
    if (mode === 'live' && code === DisconnectReason.restartRequired) { say({ ev: 'restart-required', note: 'pair-success received and creds saved; reconnecting to complete login, then logging the test device out' }); return connect(); }
    if (mode === 'live' && code !== DisconnectReason.loggedOut && !state.creds.me && attempts < MAX_ATTEMPTS) { say({ ev: 'reconnect', reason: 'QR refs exhausted / server closed; fresh refs' }); return setTimeout(connect, 2000); }
    process.exit(0);
  }
});
}
connect();
