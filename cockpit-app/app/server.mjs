// Cockpit web app. Listens on 127.0.0.1 only; reached through `tailscale serve` (private network).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { summarize, upcoming } from '../src/patrimoine.mjs';
import { upcomingDeadlines } from '../src/echeancier.mjs';
import crypto from 'node:crypto';
import { todayPage, patrimoinePage, chiffresPage, accesPage, errorPage, sauvegardesPage, dossierPage } from './views.mjs';
import { emptyDossier, parseDossierForm, removeBien, writeDossier, readDossier, parseEuros } from './dossier.mjs';
import { pendingKey, testBackup, storeGithubToken } from './sauvegarde.mjs';
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
const KEY_FILE = path.join(STATE, 'cle-a-remettre'); // written by root (nouvelle clé), owned by cockpit, shown here until Sam confirms
const KEY_TESTED = path.join(STATE, 'cle-testee'); // marker (no secret): the pending key opened the latest backup from a paste
const BACKUPS = process.env.BACKUPS_DIR || '/var/backups/cockpit';
const SECRETS = path.join(STATE, 'secrets');
const RP_ID = process.env.RP_ID || ''; // e.g. cockpit.tailxxxx.ts.net ; empty = Face ID not configured → every screen stays closed
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

export { parseEuros };

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
  // The dossier lives on this server only (C-094). Missing or empty = the screens still open, with an invitation to fill it.
  const { etat, data } = await readDossier(DATA);
  if (etat === 'illisible' && ['/', '/patrimoine', '/dossier'].includes(url)) return [500, errorPage('Ton dossier est présent sur le serveur mais illisible (fichier abîmé ou droits). Je ne l’affiche pas et rien ne peut l’écraser. Ne touche à rien : dis-le à Claude, la dernière sauvegarde le contient.')];
  const vide = !data.biens.length;
  const asOf = todayIso();
  const summary = summarize(data, asOf);
  if (url === '/') {
    const alertes = summary.biens.flatMap((b) => (b.alertes || []).map((a) => `${b.nom} : ${a}`));
    if (vide) alertes.push('Ton dossier (biens, crédits, loyers) est vide : remplis-le sur la page Dossier. Il reste sur ton serveur.');
    return [200, todayPage({ now: new Date(), sante: await readJson(path.join(STATE, 'sante.json')), sauvegarde: await readJson(path.join(STATE, 'sauvegarde.json')), notes: await lastNotes(), echeances: upcoming(summary, asOf), fiscal: upcomingDeadlines(asOf, 45), alertes, attentes: await readJson(path.join(STATE, 'decisions.json')) })];
  }
  if (url === '/patrimoine') return [200, patrimoinePage({ summary, asOf, vide })];
  if (url === '/dossier') return [200, dossierPage({ data, token: FORM_TOKEN, message: opts.message, vide, sent: opts.message && !opts.message.ok ? opts.fields : null })];
  if (url === '/mes-chiffres') return [200, chiffresPage({ data, prive: await readJson(PRIVE), token: FORM_TOKEN, message: opts.message })];
  if (url === '/sauvegardes') {
    // Without Face ID configured (RP_ID empty) nothing is session-protected: the key is then never shown.
    const key = auth ? await pendingKey(KEY_FILE) : null;
    const tested = !!key && fsSync.existsSync(KEY_TESTED);
    const message = opts.message || (!auth && (await pendingKey(KEY_FILE)) ? { ok: false, text: 'Une clé attend, mais Face ID n’est pas activé sur cet écran : je ne l’affiche pas. Dis à Claude « activer le cadenas ».' } : undefined);
    return [200, sauvegardesPage({ key, tested, token: FORM_TOKEN, message, backup: await readJson(path.join(STATE, 'sauvegarde.json')) })];
  }
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

// Actions of the Sauvegardes page. Fields are never logged; the reply never repeats what was pasted.
export async function actSauvegardes(pathname, fields, deps = {}) {
  if (!('auth' in deps ? deps.auth : auth)) return { ok: false, text: 'Face ID n’est pas activé sur cet écran : aucune action sur les clés ou les jetons. Dis à Claude « activer le cadenas ».' };
  if (pathname === '/sauvegardes/rangee') {
    if (!fsSync.existsSync(KEY_TESTED)) return { ok: false, text: 'Teste d’abord ta clé ci-dessous, en la collant depuis Mots de passe : je ne l’efface du serveur qu’après un test ✅.' };
    await fs.rm(KEY_FILE, { force: true }); await fs.rm(KEY_TESTED, { force: true });
    return { ok: true, text: '✅ Clé effacée du serveur. Elle n’existe plus que dans ton app Mots de passe et sur ta fiche.' };
  }
  if (pathname === '/sauvegardes/test') {
    const r = await testBackup({ key: fields.cle, backupsDir: BACKUPS, tmpBase: STATE, run: deps.run });
    if (r.ok && (await pendingKey(KEY_FILE)) === String(fields.cle || '').trim()) { fsSync.writeFileSync(KEY_TESTED, new Date().toISOString()); r.text += ' Tu peux maintenant l’effacer du serveur (bouton au-dessus).'; }
    return r;
  }
  if (pathname === '/sauvegardes/github') return storeGithubToken({ token: fields.github, secretsDir: SECRETS });
  return { ok: false, text: 'Action inconnue.' };
}

// Actions of the Dossier page: the whole form is validated first, then written in one go (nothing on a bad field).
export async function actDossier(pathname, fields, now = new Date()) {
  const { etat, data: current } = await readDossier(DATA);
  if (etat === 'illisible') return { ok: false, text: 'Ton dossier sur le serveur est illisible : je refuse de l’écraser. Dis-le à Claude.' };
  try {
    let next;
    if (pathname === '/dossier/retirer') {
      if (fields.sur !== '1') return { ok: false, text: 'Coche « Oui, retirer ce bien » avant de toucher le bouton. Rien n’a été changé.' };
      next = removeBien(current, String(fields.id || ''));
    } else next = parseDossierForm(fields, current, now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }));
    await writeDossier(DATA, next);
    await fs.writeFile(path.join(path.dirname(DATA), 'sauvegarde-demandee'), new Date().toISOString()).catch(() => {}); // root makes a fresh encrypted backup
    return { ok: true, text: pathname === '/dossier/retirer' ? 'Bien retiré. Les chiffres sont recalculés.' : 'Dossier enregistré sur ton serveur. Les chiffres sont recalculés.' };
  } catch (e) {
    return { ok: false, text: e.champ ? `Rien n’a été enregistré — ${e.message}.` : 'Rien n’a été enregistré : un champ n’est pas valide ou le serveur n’a pas pu écrire.' };
  }
}

export async function handlePost(req, res, pathname) {
  let body;
  try { body = await readBody(req, pathname.startsWith('/dossier') ? 65536 : 8192); } catch { res.writeHead(413, SECURITY); return res.end(errorPage('Trop de données.')); }
  const fields = Object.fromEntries(new URLSearchParams(body));
  const page = pathname.startsWith('/sauvegardes') ? '/sauvegardes' : pathname.startsWith('/dossier') ? '/dossier' : '/mes-chiffres';
  let message;
  if (!sameSite(req) || fields.jeton !== FORM_TOKEN) message = { ok: false, text: 'Formulaire expiré ou venu d’ailleurs : rien n’a été enregistré. Recharge la page et recommence.' };
  else if (page === '/sauvegardes') { try { message = await actSauvegardes(pathname, fields); } catch { message = { ok: false, text: 'Impossible pour l’instant. Rien n’a été gardé.' }; } }
  else if (page === '/dossier') message = await actDossier(pathname, fields);
  else {
    try { await savePrive(fields, (await readDossier(DATA)).data); message = { ok: true, text: 'Enregistré sur ton serveur.' }; }
    catch { message = { ok: false, text: 'Un montant n’est pas valide (exemple : 1650 ou 1 650,50). Rien n’a été enregistré.' }; }
  }
  const sent = page === '/dossier' && pathname === '/dossier' ? fields : null; // re-shown on refusal, never stored
  const [code, html] = await render(page, { message, fields: sent });
  res.writeHead(message.ok ? 200 : 400, SECURITY); res.end(html);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://x').pathname;
      // Fail closed: without Face ID configured, no page, no form, no data — only this explanation.
      if (!auth) { res.writeHead(503, SECURITY); return res.end(errorPage('Cadenas (Face ID) non activé sur ce serveur : tous les écrans privés restent fermés et aucune donnée n’est affichée. Dis à Claude « activer le cadenas ».')); }
      if (pathname.startsWith('/acces/')) return await handleAccess(req, res, pathname);
      if (pathname === '/acces') { const nonce = crypto.randomBytes(16).toString('base64url'); res.writeHead(200, withNonce(nonce)); return res.end(accesPage({ nonce, hasKeys: keyStore.list().length > 0 })); }
      if (auth && !currentSession(req)) { res.writeHead(303, { location: '/acces', 'cache-control': 'no-store', 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0` }); return res.end(); }
      if (req.method === 'POST' && pathname === '/deconnexion') { sessions.drop(parseCookies(req.headers.cookie)[COOKIE]); res.writeHead(303, { location: '/acces', 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0` }); return res.end(); }
      if (req.method === 'POST' && (pathname === '/mes-chiffres' || pathname === '/dossier' || pathname === '/dossier/retirer' || pathname.startsWith('/sauvegardes/'))) return await handlePost(req, res, pathname);
      if (req.method !== 'GET') { res.writeHead(405, SECURITY); return res.end(errorPage('Méthode refusée.')); }
      const [code, html] = await render(pathname);
      res.writeHead(code, SECURITY); res.end(html);
    } catch (e) { res.writeHead(500, SECURITY); res.end(errorPage('Erreur interne.')); console.error(e); }
  }).listen(PORT, process.env.HOST || '127.0.0.1', () => console.log(`cockpit-app on ${process.env.HOST || '127.0.0.1'}:${PORT}`));
}
