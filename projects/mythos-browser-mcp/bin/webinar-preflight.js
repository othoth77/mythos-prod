#!/usr/bin/env node
// =====================================================
// MYTHOS Browser MCP — webinar SAFE TEST (run ON the browser host, before the real event)
// projects/mythos-browser-mcp/bin/webinar-preflight.js --url <webinar url> [--seconds 10] [--out DIR]
//                                                       [--display :99] [--pulse-sink mythos_rec]
//
// Proves, ahead of time, that a webinar CAN be recorded on this host — or
// says exactly which layer cannot. Ten checks, each PASS | FAIL | BLOCKED
// with a reason, JSON verdict at the end, exit 0 only on all PASS.
//
//   1  open the URL through the governed BrowserAdapter (Obscura primary)
//   2  session state: is the page an auth/login/registration wall?
//   3  page loads (title, readyState)
//   4  a <video> (or <audio>/iframe player) element exists
//   5  media availability: readyState/duration/tracks of the first <video>
//   6  short test recording of the CAPTURE LAYER
//   7  recording file exists
//   8  duration > 0 (ffprobe)
//   9  audio/video streams present (ffprobe)
//  10  stop and clean up (capture process, temp files)
//
// THE CAPTURE LAYER IS NOT THE BROWSER ADAPTER. Browser navigation proves a
// page loads; it does not record media. Obscura is a headless engine with no
// screen and no audio device, and CDP screencasts carry no audio. The correct
// recording layer for a live webinar is a real screen+audio capture of a
// visible browser: ffmpeg over an X display (Xvfb or the real desktop, x11grab)
// plus a PulseAudio/PipeWire monitor source. Checks 6–9 exercise THAT layer,
// with a synthetic source when no display is available, so a missing ffmpeg,
// missing display or missing audio sink is found NOW, not during the event.
// =====================================================
'use strict';
var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var adapterLib = require(path.join(__dirname, '..', 'lib', 'browser-adapter'));

var args = process.argv.slice(2);
var opt = { url: null, seconds: 10, out: path.join(os.homedir(), '.local', 'state', 'mythos-browser', 'webinar-preflight'), display: process.env.DISPLAY || null, pulseSink: null };
for (var i = 0; i < args.length; i++) {
  if (args[i] === '--url') opt.url = args[++i];
  else if (args[i] === '--seconds') opt.seconds = Math.max(3, Math.min(60, Number(args[++i]) || 10));
  else if (args[i] === '--out') opt.out = args[++i];
  else if (args[i] === '--display') opt.display = args[++i];
  else if (args[i] === '--pulse-sink') opt.pulseSink = args[++i];
}
if (!opt.url) { console.error('usage: webinar-preflight.js --url <url> [--seconds N] [--out DIR] [--display :N] [--pulse-sink NAME]'); process.exit(2); }
fs.mkdirSync(opt.out, { recursive: true, mode: 0o700 });

var verdict = { url: opt.url, host: os.hostname(), started_at: new Date().toISOString(), checks: [], status: 'PASS', capture_layer: null };
function record(n, name, status, detail, data) {
  verdict.checks.push({ n: n, check: name, status: status, detail: detail, data: data === undefined ? null : data });
  if (status !== 'PASS' && verdict.status === 'PASS') verdict.status = status === 'BLOCKED' ? 'BLOCKED' : 'FAIL';
}
function which(bin) { var r = cp.spawnSync('/bin/sh', ['-c', 'command -v ' + bin], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; }
function run(bin, argv, ms) { return cp.spawnSync(bin, argv, { encoding: 'utf8', timeout: ms || 20000 }); }

var adapter = adapterLib.createAdapter({ env: process.env });
var AUTH_RE = /sign in|log in|login|password|register|registration required|enter your (name|email)|join webinar|verify you are human|captcha/i;
var VIDEO_PROBE = '(function(){var v=document.querySelector("video");var a=document.querySelector("audio");var f=Array.prototype.slice.call(document.querySelectorAll("iframe")).map(function(i){return i.src||""}).filter(Boolean).slice(0,5);' +
  'if(!v)return JSON.stringify({video:false,audio:!!a,iframes:f});' +
  'return JSON.stringify({video:true,audio:!!a,iframes:f,readyState:v.readyState,duration:v.duration,paused:v.paused,muted:v.muted,src:(v.currentSrc||v.src||"").slice(0,120),width:v.videoWidth,height:v.videoHeight,' +
  'audioTracks:v.audioTracks?v.audioTracks.length:null,videoTracks:v.videoTracks?v.videoTracks.length:null,srcObject:!!v.srcObject});})()';

var recFile = null, capture = null;

adapter.openSession().then(function (s) {
  var impl = s.impl, sess = s.session;
  var nav;
  return impl.navigate(sess, opt.url).then(function (n) {
    nav = n;
    record(1, 'open URL through BrowserAdapter', 'PASS', 'backend=' + s.backend + (s.fallback_reason ? ' (fallback: ' + s.fallback_reason + ')' : ''), { backend: s.backend, final_url: n.final_url });
    return impl.extract(sess, { max_chars: 4000 });
  }).then(function (x) {
    var text = x.found ? x.text : '';
    var wall = AUTH_RE.test(text) || AUTH_RE.test(nav.title || '');
    record(2, 'session state (auth wall?)', wall ? 'FAIL' : 'PASS', wall ? 'the page reads like a login/registration wall — a session must be established BEFORE the event (owner step: registration link or authenticated profile)' : 'no login/registration wall detected in the visible text', { title: nav.title, sample: text.slice(0, 200) });
    record(3, 'page loads', nav.ready_state === 'complete' || nav.ready_state === 'interactive' ? 'PASS' : 'FAIL', 'readyState=' + nav.ready_state + ' title=' + JSON.stringify(nav.title), null);
    return impl.evaluate(sess, VIDEO_PROBE).catch(function (e) { return JSON.stringify({ error: String(e.message).slice(0, 200) }); });
  }).then(function (v) {
    var media = {}; try { media = JSON.parse(v); } catch (e) { media = { error: 'probe unparsable' }; }
    if (media.error) record(4, 'video element', 'BLOCKED', 'media probe failed on backend ' + s.backend + ': ' + media.error, media);
    else record(4, 'video element', media.video ? 'PASS' : (media.iframes && media.iframes.length ? 'FAIL' : 'FAIL'), media.video ? 'a <video> element is present' : (media.iframes && media.iframes.length ? 'no <video> in the top document; player is inside an iframe (' + media.iframes[0] + ') — capture must be at the screen layer' : 'no <video>, <audio> or player iframe found'), media);
    if (media.video) {
      var avail = (media.readyState >= 1) || media.srcObject || (media.duration > 0);
      record(5, 'audio/video availability', avail ? 'PASS' : 'FAIL', 'readyState=' + media.readyState + ' duration=' + media.duration + ' src=' + (media.src || (media.srcObject ? 'MediaStream' : '')) + ' tracks a/v=' + media.audioTracks + '/' + media.videoTracks, null);
    } else record(5, 'audio/video availability', 'FAIL', 'no media element to measure', null);
    return impl.close(sess);
  }, function (e) { record(1, 'open URL through BrowserAdapter', 'FAIL', String(e.message).slice(0, 300), e.attempts || null); record(2, 'session state', 'BLOCKED', 'not reached', null); record(3, 'page loads', 'BLOCKED', 'not reached', null); record(4, 'video element', 'BLOCKED', 'not reached', null); record(5, 'audio/video availability', 'BLOCKED', 'not reached', null); return impl.close(sess).catch(function () {}); });
}, function (e) {
  record(1, 'open URL through BrowserAdapter', 'FAIL', String(e.message).slice(0, 400), e.attempts || null);
  [2, 3, 4, 5].forEach(function (n) { record(n, ['', '', 'session state', 'page loads', 'video element', 'audio/video availability'][n], 'BLOCKED', 'not reached: no browser backend', null); });
}).then(function () {
  // ---- 6. the CAPTURE layer
  var ffmpeg = which('ffmpeg'), ffprobe = which('ffprobe');
  verdict.capture_layer = { tool: 'ffmpeg', ffmpeg: ffmpeg, ffprobe: ffprobe, display: opt.display, pulse_sink: opt.pulseSink,
    note: 'a live webinar is recorded from a VISIBLE browser: ffmpeg x11grab of the display + a PulseAudio/PipeWire monitor source; the headless engine and CDP cannot deliver audio' };
  if (!ffmpeg || !ffprobe) { record(6, 'test recording (capture layer)', 'BLOCKED', 'ffmpeg/ffprobe not installed on this host — install them (system package) before the event', null); [7, 8, 9].forEach(function (n) { record(n, ['', '', '', '', '', '', '', 'recording file', 'duration > 0', 'a/v streams'][n], 'BLOCKED', 'no recording', null); }); return; }
  recFile = path.join(opt.out, 'preflight-' + new Date().toISOString().replace(/[:.]/g, '-') + '.mkv');
  var videoIn, audioIn, mode;
  var haveDisplay = opt.display && run('/bin/sh', ['-c', 'xdpyinfo -display ' + opt.display + ' >/dev/null 2>&1 || xset -display ' + opt.display + ' q >/dev/null 2>&1']).status === 0;
  var haveSink = opt.pulseSink && run('/bin/sh', ['-c', 'pactl list short sources 2>/dev/null | grep -q "' + opt.pulseSink + '.monitor"']).status === 0;
  if (haveDisplay) { videoIn = ['-f', 'x11grab', '-video_size', '1280x720', '-framerate', '15', '-i', opt.display]; mode = 'x11grab:' + opt.display; }
  else { videoIn = ['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=15']; mode = 'synthetic-video (no usable display: ' + (opt.display || 'DISPLAY unset') + ')'; }
  if (haveSink) { audioIn = ['-f', 'pulse', '-i', opt.pulseSink + '.monitor']; mode += '+pulse:' + opt.pulseSink; }
  else { audioIn = ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100']; mode += '+synthetic-audio (no pulse monitor source' + (opt.pulseSink ? ' ' + opt.pulseSink : '') + ')'; }
  var argv = ['-hide_banner', '-loglevel', 'error', '-y'].concat(videoIn, audioIn, ['-t', String(opt.seconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', recFile]);
  var t0 = Date.now();
  capture = run(ffmpeg, argv, (opt.seconds + 25) * 1000);
  var real = haveDisplay && haveSink;
  record(6, 'test recording (capture layer)', capture.status === 0 ? (real ? 'PASS' : 'FAIL') : 'FAIL',
    capture.status === 0 ? (real ? 'ffmpeg recorded ' + opt.seconds + 's from ' + mode : 'ffmpeg works but recorded a SYNTHETIC source (' + mode + '): the real display/audio path is not ready — provide --display and --pulse-sink that exist') : 'ffmpeg failed: ' + String(capture.stderr || capture.error || '').slice(0, 300),
    { mode: mode, ms: Date.now() - t0, args: argv.join(' ') });
  if (capture.status !== 0) { [7, 8, 9].forEach(function (n) { record(n, ['', '', '', '', '', '', '', 'recording file', 'duration > 0', 'a/v streams'][n], 'BLOCKED', 'no recording', null); }); return; }
  var st = fs.existsSync(recFile) ? fs.statSync(recFile) : null;
  record(7, 'recording file', st && st.size > 0 ? 'PASS' : 'FAIL', st ? recFile + ' (' + st.size + ' bytes)' : 'file missing', { path: recFile, bytes: st ? st.size : 0 });
  var pr = run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name', '-of', 'json', recFile], 20000);
  var info = {}; try { info = JSON.parse(pr.stdout || '{}'); } catch (e) {}
  var dur = Number(info.format && info.format.duration) || 0;
  record(8, 'duration > 0', dur > 0 ? 'PASS' : 'FAIL', 'duration=' + dur + 's', { duration: dur });
  var kinds = (info.streams || []).map(function (s) { return s.codec_type + ':' + s.codec_name; });
  var hasV = kinds.some(function (k) { return k.indexOf('video:') === 0; }), hasA = kinds.some(function (k) { return k.indexOf('audio:') === 0; });
  record(9, 'audio/video streams', hasV && hasA ? 'PASS' : 'FAIL', kinds.join(', ') || 'no streams', { streams: kinds });
}).then(function () {
  // ---- 10. cleanup: nothing left running, the test file kept ONLY as evidence
  var leftovers = run('/bin/sh', ['-c', 'pgrep -f "^ffmpeg .*preflight-" || true']).stdout.trim();
  record(10, 'stop and clean up', leftovers ? 'FAIL' : 'PASS', leftovers ? 'capture still running: ' + leftovers : 'no capture process left; evidence file kept at ' + (recFile || '(none)'), null);
  verdict.ended_at = new Date().toISOString();
  var out = JSON.stringify(verdict, null, 2);
  var tok = process.env.OBSCURA_CDP_TOKEN; if (tok) out = out.split(tok).join('<redacted>');
  console.log(out);
  process.exit(verdict.status === 'PASS' ? 0 : 1);
});
