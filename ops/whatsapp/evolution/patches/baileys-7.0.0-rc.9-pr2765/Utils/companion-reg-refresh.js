// Port of WhiskeySockets/Baileys PR #2765 (head 4f263f0) to the 7.0.0-rc.9 lib
// bundled in evoapicloud/evolution-api:v2.3.7. Source of truth:
// src/Utils/companion-reg-client-utils.ts in the PR. Only the two helpers the
// PR adds are ported; buildPairingQRData is not, because rc.9 still emits the
// pre-rc10 QR string (ref,noise,identity,adv) that v6.7.24 also emits.
import { randomBytes } from 'crypto';
import { getBinaryNodeChild } from '../WABinary/index.js';
/**
 * Holds the ref currently on screen so it can be re-rendered.
 * `render` receives the ref, not a finished payload, so the caller reads the
 * adv secret at render time: a companion_reg_refresh rotates it mid-flow.
 */
export const makePairingQRRenderer = (refs, render) => {
    let index = 0;
    let current;
    return {
        next() {
            const ref = refs[index];
            if (ref === undefined) {
                return false;
            }
            index += 1;
            current = ref;
            render(ref);
            return true;
        },
        refresh() {
            if (current === undefined) {
                return false;
            }
            render(current);
            return true;
        }
    };
};
/** The two children WA Web's parser accepts on this notification. */
const COMPANION_REG_REFRESH_CHILDREN = ['companion_reg_refresh', 'pair-device-rotate-qr'];
/**
 * <notification type="companion_reg_refresh"> - the server retiring an
 * unpaired companion's registration material. WA Web answers by regenerating
 * the adv secret key; that key is a quarter of what the pairing QR advertises,
 * so a client that only acks keeps offering a QR built on a retired secret.
 */
export const handleCompanionRegRefresh = (node, { creds, emitCredsUpdate, refreshQR, logger }) => {
    if (!COMPANION_REG_REFRESH_CHILDREN.some(tag => getBinaryNodeChild(node, tag))) {
        logger.warn({ node }, 'companion_reg_refresh carries neither expected child; ignoring');
        return 'ignored_malformed';
    }
    if (creds.me) {
        logger.debug({ id: node.attrs.id }, 'companion_reg_refresh on a registered session; keeping the adv secret');
        return 'ignored_registered';
    }
    // Same construction as initAuthCreds: 32 CSPRNG bytes, base64.
    creds.advSecretKey = randomBytes(32).toString('base64');
    emitCredsUpdate({ advSecretKey: creds.advSecretKey });
    logger.info({ id: node.attrs.id }, 'rotated the adv secret the server asked to retire; re-rendering the pairing QR');
    refreshQR();
    return 'rotated';
};
