// Cockpit web app. Listens on 127.0.0.1 only; reached through `tailscale serve` (private network).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { summarize, upcoming } from '../src/patrimoine.mjs';
import { upcomingDeadlines } from '../src/echeancier.mjs';
import { budget } from '../src/budget.mjs';
import { parseProspectsForm } from '../src/prospects.mjs';
import { rattachements, compterPar } from '../src/coffre.mjs';
import { cleTache, lireFaits, marquer, retirer, sansFaits, CLE_RE } from '../src/faits.mjs';
import { addDoc, editDoc, readDoc, readIndex, readKey, readVerifier, vaultState, setVault, replaceV1, parseMultipart, MAX_FILE } from './coffre.mjs';
import crypto from 'node:crypto';
import { todayPage, patrimoinePage, chiffresPage, accesPage, errorPage, sauvegardesPage, dossierPage, prospectsPage, coffrePage, coffreViewPage } from './views.mjs';
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
// The safe: encrypted files in STATE/coffre, their list in data/coffre.json, the key outside the data folder (root, /maj).
const COFFRE_DIR = process.env.COFFRE_DIR || path.join(STATE, 'coffre');
const COFFRE_INDEX = path.join(DATA_DIR, 'coffre.json');
const COFFRE_KEY = process.env.COFFRE_KEY || '/etc/cockpit/coffre.key';
const COFFRE_VERIF = path.join(DATA_DIR, 'coffre-verif.json'); // v1 (first sealed papers), read only now
const COFFRE_VAULT = path.join(DATA_DIR, 'coffre-vault.json'); // v2: the vault key wrapped by the password
const COFFRE_INDICE = path.join(DATA_DIR, 'coffre-indice.json'); // Sam's hint for the password (never the password), behind Face ID
// The script that seals « très sensible » papers in Safari, inlined in the Coffre pages with a nonce.
const CLIENT_JS = fsSync.readFileSync(new URL('./coffreclient.mjs', import.meta.url), 'utf8');
// PDF.js 4.10.38 (Mozilla, Apache-2.0, npm integrity checked) draws every page of a PDF: the iPhone shows only the first
// page of a PDF placed in a page. Served by the Cockpit itself, behind Face ID; read once at start.
const PDFJS = { '/coffre/pdfjs.mjs': fsSync.readFileSync(new URL('./pdfjs.mjs', import.meta.url)), '/coffre/pdfworker.mjs': fsSync.readFileSync(new URL('./pdfworker.mjs', import.meta.url)) };
const FAITS = process.env.FAITS_FILE || path.join(DATA_DIR, 'faits.json'); // « ✅ C'est fait » ticks, server only
const PROSPECTS = process.env.PROSPECTS_FILE || path.join(DATA_DIR, 'prospects.json'); // niveau 3: server only, in the encrypted backups
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
// Coffre pages: the sealing script (nonce) may fetch from this site and show a decrypted paper from memory (blob:).
const withScript = (nonce) => ({ ...SECURITY, 'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' blob:; script-src 'nonce-${nonce}' 'self'; worker-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` });
const withNonce = (nonce) => ({ ...SECURITY, 'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` });
const JSONH = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const json = (res, code, obj) => { res.writeHead(code, JSONH); res.end(JSON.stringify(obj)); };
const readRaw = async (req, max) => { const parts = []; let n = 0; for await (const c of req) { n += c.length; if (n > max) throw new Error('trop gros'); parts.push(c); } return Buffer.concat(parts); };
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
    return [200, todayPage({ now: new Date(), sante: await readJson(path.join(STATE, 'sante.json')), sauvegarde: await readJson(path.join(STATE, 'sauvegarde.json')), notes: await lastNotes(), echeances: upcoming(summary, asOf), fiscal: upcomingDeadlines(asOf, 45), alertes, attentes: sansFaits(await readJson(path.join(STATE, 'decisions.json')), lireFaits(await readJson(FAITS))), token: FORM_TOKEN, budget: budget(data, summary, (await readJson(PRIVE)) || {}) })];
  }
  if (url === '/patrimoine') return [200, patrimoinePage({ summary, asOf, vide, papiers: compterPar((await readIndex(COFFRE_INDEX)).list) })];
  if (url === '/coffre') {
    const { etat: ce, list } = await readIndex(COFFRE_INDEX);
    if (ce === 'illisible') return [500, errorPage('La liste de ton coffre est présente mais illisible. Je ne l’affiche pas et rien ne peut l’écraser : dis-le à Claude, la dernière sauvegarde la contient.')];
    const q = opts.query || {};
    const places = rattachements(data);
    const filtre = { r: places.some(([k]) => k === q.r) ? q.r : '', afaire: q.afaire === '1' };
    const distant = ((await readJson(path.join(STATE, 'coffre-distant.json'))) || {}).ids;
    const nonce = crypto.randomBytes(16).toString('base64url');
    return [200, coffrePage({ index: list, places, filtre, token: FORM_TOKEN, message: opts.message, sent: opts.message && !opts.message.ok ? opts.fields : null, distant: Array.isArray(distant) ? distant.filter((id) => list.some((d) => d.id === id)).length : null, cle: !!(await readKey(COFFRE_KEY)), todayIso: asOf, nonce, script: CLIENT_JS, verif: (await readVerifier(COFFRE_VERIF)) || '', vaultInfo: await vaultState(COFFRE_VAULT), indice: await readIndice() }), withScript(nonce)];
  }
  if (url === '/dossier') return [200, dossierPage({ data, token: FORM_TOKEN, message: opts.message, vide, sent: opts.message && !opts.message.ok ? opts.fields : null, dernieres: Object.fromEntries(summary.biens.filter((b) => b.end).map((b) => [b.id, b.end])) })];
  if (url === '/prospects') {
    const { etat: pe, list } = await readProspects();
    if (pe === 'illisible') return [500, errorPage('Ta liste de prospects est présente mais illisible. Je ne l’affiche pas et rien ne peut l’écraser : dis-le à Claude, la dernière sauvegarde la contient.')];
    return [200, prospectsPage({ list, token: FORM_TOKEN, message: opts.message, sent: opts.message && !opts.message.ok ? opts.fields : null, todayIso: asOf })];
  }
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
      res.writeHead(200, { ...JSONH, 'set-cookie': `${COOKIE}=${sid}; Path=/; HttpOnly; ${ORIGIN.startsWith('https') ? 'Secure; ' : ''}SameSite=Lax; Max-Age=43200` });
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

// Prospects: same rules as the dossier (missing = empty list; unreadable = never overwritten; all or nothing).
export async function readProspects(file = PROSPECTS) {
  let raw;
  try { raw = await fs.readFile(file, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? { etat: 'absent', list: [] } : { etat: 'illisible', list: [] }; }
  try { const l = JSON.parse(raw); if (Array.isArray(l)) return { etat: 'ok', list: l }; } catch { /* fall through */ }
  return { etat: 'illisible', list: [] };
}
export async function actProspects(fields, now = new Date(), file = PROSPECTS) {
  const { etat, list } = await readProspects(file);
  if (etat === 'illisible') return { ok: false, text: 'Ta liste de prospects sur le serveur est illisible : je refuse de l’écraser. Dis-le à Claude.' };
  try {
    const next = parseProspectsForm(fields, list, now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }));
    await writeDossier(file, next);
    return { ok: true, text: 'Prospects enregistrés sur ton serveur.' };
  } catch (e) {
    return { ok: false, text: e.champ ? `Rien n’a été enregistré — ${e.message}.` : 'Rien n’a été enregistré : un champ n’est pas valide ou le serveur n’a pas pu écrire.' };
  }
}

const coffreCtx = async (now = new Date()) => ({ dir: COFFRE_DIR, indexFile: COFFRE_INDEX, keyFile: COFFRE_KEY, verifFile: COFFRE_VERIF, places: rattachements((await readDossier(DATA)).data), todayIso: now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }) });
const askBackup = () => fs.writeFile(path.join(path.dirname(DATA), 'sauvegarde-demandee'), new Date().toISOString()).catch(() => {});

// Filing a paper: multipart form (one file), read as bytes with a hard size limit, checked like every form.
export async function handleUpload(req, res) {
  const len = Number(req.headers['content-length'] || 0);
  let message, fields = null;
  if (len > MAX_FILE + 64 * 1024) message = { ok: false, text: 'Rien n’a été rangé — fichier trop lourd (15 Mo maximum). Scanne-le en noir et blanc ou en plusieurs parties.' };
  else {
    try {
      const body = await readRaw(req, MAX_FILE + 64 * 1024);
      const { fields: f, file } = parseMultipart(body, req.headers['content-type']);
      fields = f;
      if (!sameSite(req) || f.jeton !== FORM_TOKEN) message = { ok: false, text: 'Formulaire expiré ou venu d’ailleurs : rien n’a été rangé. Recharge la page et recommence.' };
      else { message = await addDoc(f, file, await coffreCtx()); if (message.ok) await askBackup(); }
    } catch { message = { ok: false, text: 'Rien n’a été rangé : le fichier n’a pas pu être lu. Réessaie.' }; }
  }
  if (message.ok) fields = null;
  if (String(req.headers.accept || '').includes('application/json')) return json(res, message.ok ? 200 : 400, { ok: message.ok, text: message.text });
  const [, html, headers] = await render('/coffre', { message, fields, query: {} });
  res.writeHead(message.ok ? 200 : 400, headers || SECURITY); res.end(html);
}
// First time: the vault key, already wrapped by the password on the phone, is kept here (set once).
export async function handleVault(req, res) {
  let body = null;
  try { body = JSON.parse(await readBody(req, 4096)); } catch { return json(res, 400, { ok: false, text: 'Demande illisible.' }); }
  if (!sameSite(req) || !body || body.jeton !== FORM_TOKEN) return json(res, 400, { ok: false, text: 'Page expirée : recharge-la et recommence.' });
  try { const r = await setVault(body.vault, COFFRE_VAULT); if (r.ok) await askBackup(); return json(res, r.ok ? 200 : 400, r); }
  catch { return json(res, 500, { ok: false, text: 'Le serveur n’a pas pu écrire. Réessaie.' }); }
}
export async function handleReplace(req, res) {
  try {
    const { fields, file } = parseMultipart(await readRaw(req, MAX_FILE + 64 * 1024), req.headers['content-type']);
    if (!sameSite(req) || fields.jeton !== FORM_TOKEN) return json(res, 400, { ok: false, text: 'Page expirée.' });
    const r = await replaceV1(fields, file, await coffreCtx());
    if (r.ok) await askBackup();
    return json(res, r.ok ? 200 : 400, r);
  } catch { return json(res, 400, { ok: false, text: 'Demande illisible.' }); }
}
// The password hint: one short line, kept on the server behind Face ID (and in the encrypted backups).
// The page refuses a hint that opens the safe (it tries it on the phone first); the server only checks its length.
export const MAX_INDICE = 80;
export async function readIndice(file = COFFRE_INDICE) { const v = await readJson(file); return v && typeof v.indice === 'string' ? v.indice : ''; }
export async function actIndice(fields, file = COFFRE_INDICE) {
  const t = String(fields.indice ?? '').replace(/\s+/g, ' ').trim();
  if (t.length > MAX_INDICE) return { ok: false, text: `Rien n’a été enregistré — indice trop long (${MAX_INDICE} caractères maximum).` };
  if (!t) { await fs.rm(file, { force: true }); return { ok: true, text: 'Indice effacé.' }; }
  await writeDossier(file, { indice: t, date: new Date().toISOString() });
  return { ok: true, text: '💡 Indice enregistré. Il s’affiche sous « Ouvrir le coffre » (« Voir mon indice »).' };
}
export async function actCoffre(fields) {
  try { const r = await editDoc(fields, await coffreCtx()); if (r.ok) await askBackup(); return r; }
  catch { return { ok: false, text: 'Rien n’a été changé : le serveur n’a pas pu écrire.' }; }
}
// The page around one paper (title, back button, the paper in a frame or as a picture). Nothing decrypted here.
export async function viewDoc(id) {
  const { list } = await readIndex(COFFRE_INDEX); // `list` also tells the key panel which mode to show
  const doc = /^[a-f0-9]{24}$/.test(String(id)) && list.find((d) => d.id === id);
  if (!doc) return [404, errorPage('Papier introuvable.')];
  const nonce = crypto.randomBytes(16).toString('base64url');
  return [200, coffreViewPage({ doc, places: rattachements((await readDossier(DATA)).data), nonce, script: CLIENT_JS, token: FORM_TOKEN, vaultInfo: await vaultState(COFFRE_VAULT), verif: (await readVerifier(COFFRE_VERIF)) || '', index: list, indice: await readIndice() }), withScript(nonce)];
}
// Opening a paper: decrypted in memory, shown in the browser. Only PDF and photos ever get here (checked at filing).
export async function serveDoc(id) {
  const doc = await readDoc(id, await coffreCtx());
  if (!doc) return null;
  const name = `${doc.meta.titre.replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 60) || 'papier'}.${doc.meta.ext}`;
  // Sealed on the phone: still sealed here; sent as opaque bytes (the page's script opens it, in memory, with the password).
  if (doc.meta.e2e) return { body: doc.data, headers: { 'content-type': 'application/octet-stream', 'content-length': doc.data.length, 'content-disposition': 'attachment; filename="papier.ckf"', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } };
  return { body: doc.data, headers: { 'content-type': doc.meta.mime, 'content-length': doc.data.length, 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
    'x-content-type-options': 'nosniff', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'" } };
}

// « ✅ C'est fait » / « ↩︎ Remettre »: one tap, the list changes at once, then back to Aujourd'hui (no form to resend).
// Only a task that is in the list (or already ticked) can be ticked: nothing else is written.
export async function actFait(pathname, fields, now = new Date(), file = FAITS) {
  const cle = String(fields.cle || '');
  if (!CLE_RE.test(cle)) return { ok: false };
  const faits = lireFaits(await readJson(file));
  if (pathname === '/fait/annuler') { await writeDossier(file, retirer(faits, cle)); return { ok: true }; }
  const dec = (await readJson(path.join(STATE, 'decisions.json'))) || {};
  const connue = (dec.projets || []).some((p) => (p.lignes || []).some((l) => cleTache(l) === cle));
  if (!connue) return { ok: false };
  await writeDossier(file, marquer(faits, cle, now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' })));
  return { ok: true };
}
export async function handleFait(req, res, pathname) {
  let fields = {};
  try { fields = Object.fromEntries(new URLSearchParams(await readBody(req, 2048))); } catch { /* refused below */ }
  if (!sameSite(req) || fields.jeton !== FORM_TOKEN) { res.writeHead(400, SECURITY); return res.end(errorPage('Page expirée : reviens sur Aujourd’hui et touche à nouveau le bouton.')); }
  let r; try { r = await actFait(pathname, fields); } catch { r = { ok: false }; }
  if (!r.ok) { res.writeHead(400, SECURITY); return res.end(errorPage('Cette tâche n’est plus dans la liste : reviens sur Aujourd’hui.')); }
  res.writeHead(303, { location: '/', 'cache-control': 'no-store' }); return res.end();
}

export async function handlePost(req, res, pathname) {
  let body;
  try { body = await readBody(req, pathname.startsWith('/dossier') || pathname === '/prospects' || pathname === '/coffre/modifier' ? 65536 : 8192); } catch { res.writeHead(413, SECURITY); return res.end(errorPage('Trop de données.')); }
  const fields = Object.fromEntries(new URLSearchParams(body));
  const page = pathname.startsWith('/sauvegardes') ? '/sauvegardes' : pathname.startsWith('/dossier') ? '/dossier' : pathname === '/prospects' ? '/prospects' : pathname === '/coffre/modifier' || pathname === '/coffre/indice' ? '/coffre' : '/mes-chiffres';
  let message;
  if (!sameSite(req) || fields.jeton !== FORM_TOKEN) message = { ok: false, text: 'Formulaire expiré ou venu d’ailleurs : rien n’a été enregistré. Recharge la page et recommence.' };
  else if (page === '/sauvegardes') { try { message = await actSauvegardes(pathname, fields); } catch { message = { ok: false, text: 'Impossible pour l’instant. Rien n’a été gardé.' }; } }
  else if (page === '/dossier') message = await actDossier(pathname, fields);
  else if (page === '/prospects') message = await actProspects(fields);
  else if (pathname === '/coffre/indice') { try { message = await actIndice(fields); } catch { message = { ok: false, text: 'Rien n’a été enregistré : le serveur n’a pas pu écrire.' }; } }
  else if (page === '/coffre') message = await actCoffre(fields);
  else {
    try { await savePrive(fields, (await readDossier(DATA)).data); message = { ok: true, text: 'Enregistré sur ton serveur.' }; }
    catch { message = { ok: false, text: 'Un montant n’est pas valide (exemple : 1650 ou 1 650,50). Rien n’a été enregistré.' }; }
  }
  const sent = (page === '/dossier' && pathname === '/dossier') || page === '/prospects' ? fields : null; // the safe's edit forms are per paper: nothing re-shown // re-shown on refusal, never stored
  const [code, html, headers] = await render(page, { message, fields: sent, query: {} });
  res.writeHead(message.ok ? 200 : 400, headers || SECURITY); res.end(html);
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
      if (req.method === 'POST' && (pathname === '/fait' || pathname === '/fait/annuler')) return await handleFait(req, res, pathname);
      if (req.method === 'POST' && pathname === '/coffre/ajouter') return await handleUpload(req, res);
      if (req.method === 'POST' && pathname === '/coffre/cle') return await handleVault(req, res);
      if (req.method === 'POST' && pathname === '/coffre/remplacer') return await handleReplace(req, res);
      if (req.method === 'POST' && (pathname === '/mes-chiffres' || pathname === '/dossier' || pathname === '/dossier/retirer' || pathname === '/prospects' || pathname === '/coffre/modifier' || pathname === '/coffre/indice' || pathname.startsWith('/sauvegardes/'))) return await handlePost(req, res, pathname);
      if (req.method === 'GET' && pathname.startsWith('/coffre/voir/')) {
        const [vc, vh, vhead] = await viewDoc(pathname.slice('/coffre/voir/'.length));
        res.writeHead(vc, vhead || SECURITY); return res.end(vh);
      }
      if (req.method === 'GET' && PDFJS[pathname]) { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'private, max-age=2592000, immutable', 'x-content-type-options': 'nosniff' }); return res.end(PDFJS[pathname]); }
      if (req.method === 'GET' && pathname.startsWith('/coffre/f/')) {
        const doc = await serveDoc(pathname.slice('/coffre/f/'.length));
        if (!doc) { res.writeHead(404, SECURITY); return res.end(errorPage('Papier introuvable.')); }
        res.writeHead(200, doc.headers); return res.end(doc.body);
      }
      if (req.method !== 'GET') { res.writeHead(405, SECURITY); return res.end(errorPage('Méthode refusée.')); }
      const [code, html, headers] = await render(pathname, { query: Object.fromEntries(new URL(req.url, 'http://x').searchParams) });
      res.writeHead(code, headers || SECURITY); res.end(html);
    } catch (e) { res.writeHead(500, SECURITY); res.end(errorPage('Erreur interne.')); console.error(e); }
  }).listen(PORT, process.env.HOST || '127.0.0.1', () => console.log(`cockpit-app on ${process.env.HOST || '127.0.0.1'}:${PORT}`));
}
