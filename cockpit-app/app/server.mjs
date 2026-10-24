// Cockpit web app. Listens on 127.0.0.1 only; reached through `tailscale serve` (private network).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { summarize, upcoming } from '../src/patrimoine.mjs';
import crypto from 'node:crypto';
import { todayPage, patrimoinePage, chiffresPage, accesPage, errorPage } from './views.mjs';
import { createAuth, createSessions, parseCookies } from './auth.mjs';
import fsSync from 'node:fs';

const STATE = process.env.STATE_DIR || '/var/lib/cockpit';
const DATA = process.env.DATA_FILE || path.join(STATE, 'data', 'situation.json');
const PORT = Number(process.env.PORT || 8080);
const PRIVE = process.env.PRIVE_FILE || path.join(STATE, 'data', 'prive.json');
const FORM_TOKEN = crypto.randomBytes(16).toString('hex'); // changes at each restart; checked on every form post
const DATA_DIR = path.dirname(PRIVE);
const KEYS_FILE = path.join(DATA_DIR, 'passkeys.json');
const SESS_FILE = path.join(DATA_DIR, 'sessions.json');
const CODE_FILE = path.join(DATA_DIR, 'acces-code.json');
const RP_ID = process.env.RP_ID || ''; // e.g. cockpit.tailxxxx.ts.net ; empty = login disabled (insecure, dev only)
const ORIGIN = process.env.ORIGIN || (RP_ID ? `https://${RP_ID}` : '');
const readJsonSync = (f) => { try { return JSON.parse(fsSync.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJsonSync = (f, v) => { const t = f + '.tmp'; fsSync.writeFileSync(t, JSON.stringify(v), { mode: 0o600 }); fsSync.renameSync(t, f); };
const keyStore = {
  list: () => readJsonSync(KEYS_FILE) || [],
  add: (c) => writeJsonSync(KEYS_FILE, [...keyStore.list(), c]),
  update: (id, p) => writeJsonSync(KEYS_FILE, keyStore.list().map((c) => (c.id === id ? { ...c, ...p } : c))),
};
const auth = RP_ID ? createAuth({ rpId: RP_ID, origin: ORIGIN, store: keyStore }) : null;
const sessions = createSessions({ load: () => readJsonSync(SESS_FILE), save: (m) => writeJsonSync(SESS_FILE, m) });
const COOKIE = 'cockpit_session';

// "1 650,50" -> 165050 cents; null when empty; throws when not a sane amount.
export function parseEuros(input) {
  const t = String(input ?? '').replace(/[\s\u00a0€]/g, '').replace(',', '.');
  if (t === '') return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) throw new Error('montant invalide');
  return Math.round(Number(t) * 100);
}

export async function savePrive(fields, data, now = new Date()) {
  const prive = (await readJson(PRIVE)) || {};
  const keys = ['salaire', ...data.abonnements.map((a) => 'abo:' + a.nom)];
  for (const k of keys) {
    if (!(k in fields)) continue;
    const c = parseEuros(fields[k]);
    if (c === null) delete prive[k]; else prive[k] = { montantCents: c, le: now.toISOString() };
  }
  const tmp = PRIVE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(prive), { mode: 0o600 });
  await fs.rename(tmp, PRIVE);
  return prive;
}
const readJson = async (f) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return null; } };
const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

async function lastNotes(n = 5) {
  const dir = path.join(STATE, 'inbox');
  const files = await fs.readdir(dir).catch(() => []);
  const lines = [];
  for (const f of files.filter((x) => x.endsWith('.md'))) {
    const proj = f.replace(/\.md$/, '');
    for (const l of (await fs.readFile(path.join(dir, f), 'utf8')).split('\n').filter(Boolean)) lines.push(`${l.replace(/^- /, '')} (${proj})`);
  }
  return lines.sort().reverse().slice(0, n);
}

const SECURITY = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store',
};
const withNonce = (nonce) => ({ ...SECURITY, 'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` });
const JSONH = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const json = (res, code, obj) => { res.writeHead(code, JSONH); res.end(JSON.stringify(obj)); };
const readBody = async (req, max = 65536) => { let b = ''; for await (const c of req) { b += c; if (b.length > max) throw new Error('trop gros'); } return b; };
const sameSite = (req) => { const o = req.headers.origin; if (!o || o === 'null') return true; try { return new URL(o).host === req.headers.host; } catch { return false; } };

// One-time enrollment code, written by the bot (/acces) into the shared data dir.
function takeCode(code) {
  const c = readJsonSync(CODE_FILE);
  if (!c || !c.code || c.exp < Date.now()) return false;
  const ok = crypto.timingSafeEqual(Buffer.from(String(code || '').padEnd(12)), Buffer.from(String(c.code).padEnd(12)));
  if (ok) fsSync.rmSync(CODE_FILE, { force: true });
  return ok;
}

export async function render(url, opts = {}) {
  const data = await readJson(DATA);
  if (!data) return [503, errorPage('Les données ne sont pas encore arrivées sur le serveur.')];
  const asOf = todayIso();
  const summary = summarize(data, asOf);
  if (url === '/') {
    const alertes = summary.biens.flatMap((b) => (b.alertes || []).map((a) => `${b.nom} : ${a}`));
    return [200, todayPage({ now: new Date(), sante: await readJson(path.join(STATE, 'sante.json')), sauvegarde: await readJson(path.join(STATE, 'sauvegarde.json')), notes: await lastNotes(), echeances: upcoming(summary, asOf), alertes })];
  }
  if (url === '/patrimoine') return [200, patrimoinePage({ summary, asOf })];
  if (url === '/mes-chiffres') return [200, chiffresPage({ data, prive: await readJson(PRIVE), token: FORM_TOKEN, message: opts.message })];
  return [404, errorPage('Page introuvable.')];
}

async function handleAccess(req, res, pathname) {
  if (!auth) return json(res, 503, { erreur: 'connexion non configurée' });
  if (req.method !== 'POST' || !sameSite(req)) return json(res, 405, { erreur: 'refusé' });
  let body; try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return json(res, 400, { erreur: 'requête illisible' }); }
  try {
    if (pathname === '/acces/options-inscription') {
      if (!takeCode(body.code)) { await new Promise((r) => setTimeout(r, 1500)); return json(res, 403, { erreur: 'code absent, faux ou expiré' }); }
      return json(res, 200, auth.registrationOptions());
    }
    if (pathname === '/acces/inscription') { const id = auth.register(body, body.label); return json(res, 200, { ok: true, id }); }
    if (pathname === '/acces/options-connexion') return json(res, 200, auth.authenticationOptions());
    if (pathname === '/acces/connexion') {
      const cred = auth.authenticate(body);
      const sid = sessions.create(cred.label);
      res.writeHead(200, { ...JSONH, 'set-cookie': `${COOKIE}=${sid}; Path=/; HttpOnly; ${ORIGIN.startsWith('https') ? 'Secure; ' : ''}SameSite=Strict; Max-Age=43200` });
      return res.end(JSON.stringify({ ok: true }));
    }
    return json(res, 404, { erreur: 'inconnu' });
  } catch (e) { return json(res, 400, { erreur: e.message }); }
}

function currentSession(req) { return sessions.check(parseCookies(req.headers.cookie)[COOKIE]); }

async function handlePost(req, res) {
  let body;
  try { body = await readBody(req, 8192); } catch { res.writeHead(413, SECURITY); return res.end(errorPage('Trop de données.')); }
  const fields = Object.fromEntries(new URLSearchParams(body));
  let message;
  if (!sameSite(req) || fields.jeton !== FORM_TOKEN) message = { ok: false, text: 'Formulaire expiré ou venu d’ailleurs : rien n’a été enregistré. Recharge la page et recommence.' };
  else {
    try { await savePrive(fields, await readJson(DATA)); message = { ok: true, text: 'Enregistré sur ton serveur.' }; }
    catch { message = { ok: false, text: 'Un montant n’est pas valide (exemple : 1650 ou 1 650,50). Rien n’a été enregistré.' }; }
  }
  const [code, html] = await render('/mes-chiffres', { message });
  res.writeHead(message.ok ? 200 : 400, SECURITY); res.end(html);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://x').pathname;
      if (pathname.startsWith('/acces/')) return await handleAccess(req, res, pathname);
      if (pathname === '/acces') { const nonce = crypto.randomBytes(16).toString('base64url'); res.writeHead(200, withNonce(nonce)); return res.end(accesPage({ nonce, hasKeys: keyStore.list().length > 0 })); }
      if (auth && !currentSession(req)) { res.writeHead(303, { location: '/acces', 'cache-control': 'no-store', 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0` }); return res.end(); }
      if (req.method === 'POST' && pathname === '/deconnexion') { sessions.drop(parseCookies(req.headers.cookie)[COOKIE]); res.writeHead(303, { location: '/acces', 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0` }); return res.end(); }
      if (req.method === 'POST' && pathname === '/mes-chiffres') return await handlePost(req, res);
      if (req.method !== 'GET') { res.writeHead(405, SECURITY); return res.end(errorPage('Méthode refusée.')); }
      const [code, html] = await render(pathname);
      res.writeHead(code, SECURITY); res.end(html);
    } catch (e) { res.writeHead(500, SECURITY); res.end(errorPage('Erreur interne.')); console.error(e); }
  }).listen(PORT, process.env.HOST || '127.0.0.1', () => console.log(`cockpit-app on ${process.env.HOST || '127.0.0.1'}:${PORT}`));
}
