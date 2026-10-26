// Passkey (WebAuthn) login: Face ID / Touch ID on Sam's devices. No dependency.
// Enrollment needs a one-time code issued by the Telegram bot; sessions are HttpOnly cookies.
import crypto from 'node:crypto';
import { decode } from './cbor.mjs';

export const b64u = {
  enc: (b) => Buffer.from(b).toString('base64url'),
  dec: (s) => Buffer.from(String(s || ''), 'base64url'),
};
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();

function parseAuthData(ad) {
  if (ad.length < 37) throw new Error('authData trop court');
  const out = { rpIdHash: ad.subarray(0, 32), flags: ad[32], signCount: ad.readUInt32BE(33) };
  if (out.flags & 0x40) { // attested credential data present
    const idLen = ad.readUInt16BE(53);
    out.credentialId = ad.subarray(55, 55 + idLen);
    out.cose = decode(ad.subarray(55 + idLen));
  }
  return out;
}

export function coseToJwk(cose) {
  const kty = cose.get(1), alg = cose.get(3);
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) return { kty: 'EC', crv: 'P-256', x: b64u.enc(cose.get(-2)), y: b64u.enc(cose.get(-3)), alg: 'ES256' };
  if (kty === 3 && alg === -257) return { kty: 'RSA', n: b64u.enc(cose.get(-1)), e: b64u.enc(cose.get(-2)), alg: 'RS256' };
  throw new Error('type de clé non pris en charge');
}

function checkClientData(raw, type, challenge, origin) {
  const cd = JSON.parse(Buffer.from(raw).toString('utf8'));
  if (cd.type !== type) throw new Error('type inattendu');
  if (cd.challenge !== challenge) throw new Error('défi inattendu');
  if (cd.origin !== origin) throw new Error('origine inattendue');
}

export function createAuth({ rpId, origin, store, now = () => Date.now() }) {
  const challenges = new Map(); // challenge -> expiry
  const newChallenge = () => { const c = b64u.enc(crypto.randomBytes(32)); challenges.set(c, now() + 5 * 60e3); return c; };
  const useChallenge = (c) => { const exp = challenges.get(c); challenges.delete(c); if (!exp || exp < now()) throw new Error('défi expiré'); };

  return {
    registrationOptions() {
      return { challenge: newChallenge(), rp: { id: rpId, name: 'Cockpit' }, user: { id: b64u.enc(crypto.randomBytes(16)), name: 'sam', displayName: 'Sam' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], timeout: 120000, attestation: 'none',
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' }, excludeCredentials: store.list().map((c) => ({ type: 'public-key', id: c.id })) };
    },
    register(body, label) {
      const cdRaw = b64u.dec(body.response.clientDataJSON);
      const cd = JSON.parse(cdRaw.toString('utf8'));
      useChallenge(cd.challenge);
      checkClientData(cdRaw, 'webauthn.create', cd.challenge, origin);
      const att = decode(b64u.dec(body.response.attestationObject));
      const ad = parseAuthData(Buffer.from(att.get('authData')));
      if (!ad.rpIdHash.equals(sha256(rpId))) throw new Error('site inattendu');
      if ((ad.flags & 0x01) === 0 || (ad.flags & 0x04) === 0) throw new Error('vérification de la personne absente');
      if (!ad.credentialId) throw new Error('pas de clé');
      const jwk = coseToJwk(ad.cose);
      const id = b64u.enc(ad.credentialId);
      if (body.id && body.id !== id) throw new Error('identifiant incohérent');
      store.add({ id, jwk, signCount: ad.signCount, label: String(label || 'appareil').slice(0, 40), created: new Date(now()).toISOString() });
      return id;
    },
    authenticationOptions() {
      return { challenge: newChallenge(), rpId, timeout: 120000, userVerification: 'required', allowCredentials: store.list().map((c) => ({ type: 'public-key', id: c.id })) };
    },
    authenticate(body) {
      const cred = store.list().find((c) => c.id === body.id);
      if (!cred) throw new Error('clé inconnue');
      const cdRaw = b64u.dec(body.response.clientDataJSON);
      const cd = JSON.parse(cdRaw.toString('utf8'));
      useChallenge(cd.challenge);
      checkClientData(cdRaw, 'webauthn.get', cd.challenge, origin);
      const adRaw = b64u.dec(body.response.authenticatorData);
      const ad = parseAuthData(adRaw);
      if (!ad.rpIdHash.equals(sha256(rpId))) throw new Error('site inattendu');
      if ((ad.flags & 0x01) === 0 || (ad.flags & 0x04) === 0) throw new Error('Face ID ou code requis');
      const key = crypto.createPublicKey({ key: cred.jwk, format: 'jwk' });
      const data = Buffer.concat([adRaw, sha256(cdRaw)]);
      const ok = cred.jwk.kty === 'EC'
        ? crypto.verify('sha256', data, { key, dsaEncoding: 'der' }, b64u.dec(body.response.signature))
        : crypto.verify('sha256', data, key, b64u.dec(body.response.signature));
      if (!ok) throw new Error('signature invalide');
      if (ad.signCount !== 0 && ad.signCount <= cred.signCount) throw new Error('compteur suspect (clé copiée ?)');
      store.update(cred.id, { signCount: ad.signCount, lastUsed: new Date(now()).toISOString() });
      return cred;
    },
  };
}

// Sessions: random id in an HttpOnly cookie; kept in a file so they survive a restart.
// A session ends after `idleMs` without any page opened (auto-lock, Sam 26/10) and in any case after `ttlMs`.
// The idle clock is kept in memory and saved at most once a minute (no disk write on every click).
export function createSessions({ load, save, ttlMs = 12 * 3600e3, idleMs = 15 * 60e3, now = () => Date.now() }) {
  let map = load() || {};
  let savedAt = 0;
  const alive = (v) => v.exp >= now() && (v.seen || 0) + idleMs >= now();
  const prune = () => { for (const [k, v] of Object.entries(map)) if (!alive(v)) delete map[k]; };
  return {
    create(label) { prune(); const id = b64u.enc(crypto.randomBytes(32)); map[id] = { exp: now() + ttlMs, seen: now(), label }; save(map); savedAt = now(); return id; },
    check(id) {
      prune();
      const s = id && map[id];
      if (!s) return null;
      s.seen = now();
      if (now() - savedAt > 60e3) { save(map); savedAt = now(); }
      return s;
    },
    drop(id) { delete map[id]; save(map); },
    dropAll() { map = {}; save(map); },
  };
}

export function parseCookies(header) {
  return Object.fromEntries(String(header || '').split(';').map((p) => p.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
