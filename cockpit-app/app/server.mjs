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
import { parseMicroForm, resume as microResume } from '../src/micro.mjs';
import * as factures from '../src/factures.mjs';
import * as apporteurs from '../src/apporteurs.mjs';
import { addDoc, editDoc, readDoc, readIndex, readKey, readVerifier, vaultState, setVault, replaceV1, parseMultipart, MAX_FILE } from './coffre.mjs';
import crypto from 'node:crypto';
import { todayPage, patrimoinePage, chiffresPage, microPage, facturesPage, apporteursPage, accesPage, errorPage, sauvegardesPage, dossierPage, prospectsPage, coffrePage, coffreViewPage } from './views.mjs';
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
const MICRO_FILE = process.env.MICRO_FILE || path.join(DATA_DIR, 'micro.json'); // « Ma micro-entreprise » amounts, server only (level 3)
const FACTURES_FILE = process.env.FACTURES_FILE || path.join(DATA_DIR, 'factures.json'); // Sam's invoices, server only (level 3)
const APPORTEURS_FILE = process.env.APPORTEURS_FILE || path.join(DATA_DIR, 'apporteurs.json'); // confidential programme, server only (level 3)
const APPORTEURS_SYNC = path.join(STATE, 'apporteurs-sync-demandee'); // marker: the bot sends the dashboard data
const FAITS = process.env.FAITS_FILE || path.join(DATA_DIR, 'faits.json'); // « ✅ C'est fait » ticks, server only
const PROSPECTS = process.env.PROSPECTS_FILE || path.join(DATA_DIR, 'prospects.json'); // niveau 3: server only, in the encrypted backups
const KEY_FILE = path.join(STATE, 'cle-a-remettre'); // written by root (nouvelle clé), owned by cockpit, shown here until Sam confirms
const KEY_TESTED = path.join(STATE, 'cle-testee'); // marker (no secret): the pending key opened the latest backup from a paste
const BACKUPS = process.env.BACKUPS_DIR || '/var/backups/cockpit';
const SECRETS = path.join(STATE, 'secrets');
const APPORTEURS_CLE = path.join(SECRETS, 'apporteurs'); // { url, cle } of the online dashboard (shared with the Vendix demo site)
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
    return [200, todayPage({ now: new Date(), sante: await readJson(path.join(STATE, 'sante.json')), sauvegarde: await readJson(path.join(STATE, 'sauvegarde.json')), notes: await lastNotes(), echeances: upcoming(summary, asOf), fiscal: upcomingDeadlines(asOf, 45), alertes, attentes: sansFaits(await readJson(path.join(STATE, 'decisions.json')), lireFaits(await readJson(FAITS))), token: FORM_TOKEN, micro: microResume((await readMicro()).data, asOf, factures.encaissements((await readFactures()).data)), factures: factures.resumeFactures((await readFactures()).data, asOf), budget: budget(data, summary, (await readJson(PRIVE)) || {}) })];
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
  if (url === '/micro') {
    const m = await readMicro();
    if (m.etat === 'illisible') return [500, errorPage('Tes montants de micro-entreprise sont présents mais illisibles. Je ne les affiche pas et rien ne peut les écraser : dis-le à Claude, la dernière sauvegarde les contient.')];
    return [200, microPage({ data: m.data, enc: factures.encaissements((await readFactures()).data), todayIso: asOf, token: FORM_TOKEN, message: opts.message, sent: opts.fields })];
  }
  if (url === '/factures') {
    const f = await readFactures();
    if (f.etat === 'illisible') return [500, errorPage('Tes factures sont présentes sur le serveur mais illisibles. Je ne les affiche pas et rien ne peut les écraser : dis-le à Claude, la dernière sauvegarde les contient.')];
    return [200, facturesPage({ data: f.data, todayIso: asOf, token: FORM_TOKEN, message: opts.message, sent: opts.message && !opts.message.ok ? opts.fields : null })];
  }
  if (url === '/apporteurs') {
    const a = await readApporteurs(); const f = await readFactures();
    if (a.etat === 'illisible') return [500, errorPage('Tes apporteurs sont présents sur le serveur mais illisibles. Je ne les affiche pas et rien ne peut les écraser : dis-le à Claude, la dernière sauvegarde les contient.')];
    return [200, apporteursPage({ data: a.data, factures: f.etat === 'ok' ? f.data : factures.empty(), facturesIllisibles: f.etat === 'illisible', todayIso: asOf, token: FORM_TOKEN, message: opts.message, sent: opts.message && !opts.message.ok ? opts.fields : null, enLigne: await readJson(APPORTEURS_CLE) })];
  }
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
export async function readMicro(file = MICRO_FILE) {
  let raw;
  try { raw = await fs.readFile(file, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? { etat: 'absent', data: {} } : { etat: 'illisible', data: {} }; }
  try { const d = JSON.parse(raw); if (d && typeof d === 'object' && !Array.isArray(d)) return { etat: 'ok', data: d }; } catch { /* fall through */ }
  return { etat: 'illisible', data: {} };
}
// Micro-entreprise amounts: same rules as the dossier (unreadable file = never overwritten; all or nothing).
export async function actMicro(fields, now = new Date(), file = MICRO_FILE) { return locked(() => actMicroNow(fields, now, file)); }
async function actMicroNow(fields, now, file) {
  const { etat, data: current } = await readMicro(file);
  if (etat === 'illisible') return { ok: false, text: 'Tes montants sur le serveur sont illisibles : je refuse de les écraser. Dis-le à Claude.' };
  try {
    await writeDossier(file, parseMicroForm(fields, current, now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' })));
    await fs.writeFile(path.join(path.dirname(DATA), 'sauvegarde-demandee'), new Date().toISOString()).catch(() => {});
    return { ok: true, text: 'Enregistré sur ton serveur. Les montants à déclarer et à garder sont recalculés.' };
  } catch (e) {
    return { ok: false, text: e.champ ? `Rien n’a été enregistré — ${e.message}.` : 'Rien n’a été enregistré : le serveur n’a pas pu écrire.' };
  }
}
export async function readFactures(file = FACTURES_FILE) {
  let raw;
  try { raw = await fs.readFile(file, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? { etat: 'absent', data: factures.empty() } : { etat: 'illisible', data: factures.empty() }; }
  try { const d = JSON.parse(raw); if (d && Array.isArray(d.factures)) return { etat: 'ok', data: d }; } catch { /* fall through */ }
  return { etat: 'illisible', data: factures.empty() };
}
// One writer at a time for invoices and micro amounts: two taps at once never lose a write.
let chain = Promise.resolve();
const locked = (fn) => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };
// Invoices: all or nothing; a paid invoice is counted by « Ma micro-entreprise » at display time (encaissements).
export async function actFactures(pathname, fields, now = new Date(), file = FACTURES_FILE) { return locked(() => actFacturesNow(pathname, fields, now, file)); }
async function actFacturesNow(pathname, fields, now, file) {
  const today = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const { etat, data } = await readFactures(file);
  if (etat === 'illisible') return { ok: false, text: 'Tes factures sur le serveur sont illisibles : je refuse de les écraser. Dis-le à Claude.' };
  try {
    let next, text;
    if (pathname === '/factures/coordonnees') { next = factures.parseEmetteur(fields, data); text = 'Tes coordonnées sont enregistrées. Elles apparaîtront sur tes prochaines factures.'; }
    else if (pathname === '/factures') { const r = factures.parseFacture(fields, data, today); next = r.data; text = `Facture ${r.facture.numero} créée. Touche « 📄 PDF » pour l’ouvrir et l’envoyer.`; }
    else if (pathname === '/factures/annuler') { next = factures.annuler(data, fields.numero, today); text = `Facture ${fields.numero} annulée par un avoir. Envoie l’avoir (📄) à ton client.`; }
    else if (pathname === '/factures/payee') { next = factures.payer(data, fields.numero, fields.date, today); text = `Facture ${fields.numero} payée : elle compte maintenant dans ta page Micro-entreprise. Ne la retape pas à la main.`; }
    else if (pathname === '/factures/retirer') { next = factures.retirerPaiement(data, fields.numero); text = `Paiement de ${fields.numero} retiré : il ne compte plus dans ta page Micro-entreprise.`; }
    else return { ok: false, text: 'Action inconnue.' };
    await writeDossier(file, next);
    await fs.writeFile(path.join(path.dirname(DATA), 'sauvegarde-demandee'), new Date().toISOString()).catch(() => {});
    await fs.writeFile(APPORTEURS_SYNC, new Date().toISOString()).catch(() => {}); // paid invoices feed the apporteurs' dashboards
    return { ok: true, text };
  } catch (e) {
    return { ok: false, text: e.champ ? `Rien n’a été enregistré — ${e.message}.` : 'Rien n’a été enregistré : le serveur n’a pas pu écrire.' };
  }
}
// The PDF of an invoice (F…) or of its credit note (A…), behind Face ID like every screen.
export async function factureCachee(name) {
  const m = /^(F|A)(\d{4}-\d{3})\.pdf$/.exec(name || '');
  if (!m) return null;
  const { etat, data } = await readFactures();
  if (etat !== 'ok') return null;
  const f = m[1] === 'F' ? data.factures.find((x) => x.numero === `F${m[2]}`) : data.factures.find((x) => x.avoir && x.avoir.numero === `A${m[2]}`);
  if (!f || !data.emetteur) return null;
  const body = factures.pdfFacture(data, f.numero, { avoir: m[1] === 'A' });
  const nom = `${m[1] === 'F' ? 'Facture' : 'Avoir'}-${m[1]}${m[2]}.pdf`;
  return { body, headers: { ...SECURITY, 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${nom}"`, 'cache-control': 'no-store' } };
}
export async function readApporteurs(file = APPORTEURS_FILE) {
  let raw;
  try { raw = await fs.readFile(file, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? { etat: 'absent', data: apporteurs.empty() } : { etat: 'illisible', data: apporteurs.empty() }; }
  try { const d = JSON.parse(raw); if (d && Array.isArray(d.apporteurs)) return { etat: 'ok', data: d }; } catch { /* fall through */ }
  return { etat: 'illisible', data: apporteurs.empty() };
}
export async function actApporteurs(pathname, fields, now = new Date(), file = APPORTEURS_FILE) { return locked(() => actApporteursNow(pathname, fields, now, file)); }
async function actApporteursNow(pathname, fields, now, file) {
  const today = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const { etat, data } = await readApporteurs(file);
  if (etat === 'illisible') return { ok: false, text: 'Tes apporteurs sur le serveur sont illisibles : je refuse de les écraser. Dis-le à Claude.' };
  try {
    let next, text;
    if (pathname === '/apporteurs/ajouter') { next = apporteurs.ajouterApporteur(fields, data, today); text = `${fields.nom} ajouté. Pense au contrat avant la première commission.`; }
    else if (pathname === '/apporteurs/modifier') { next = apporteurs.modifierApporteur(fields, data, today); text = 'Modifié.'; }
    else if (pathname === '/apporteurs/client') { next = apporteurs.attribuerClient(fields, data, today); text = `Client attribué. Ses factures payées compteront pour cet apporteur.`; }
    else if (pathname === '/apporteurs/client/retirer') { next = apporteurs.retirerClient(fields, data); text = 'Client retiré de l’apporteur.'; }
    else if (pathname === '/apporteurs/verser') { next = apporteurs.verser(fields, data, today); text = 'Versement noté : le solde est recalculé.'; }
    else if (pathname === '/apporteurs/verser/annuler') { next = apporteurs.annulerVersement(fields, data); text = 'Versement retiré.'; }
    else if (pathname === '/apporteurs/lien') { next = apporteurs.nouveauJeton(fields, data); text = 'Nouveau lien créé : l’ancien ne marche plus. Envoie-lui le nouveau.'; }
    else if (pathname === '/apporteurs/enligne') {
      // The shared key is made here, shown to Sam behind Face ID, pasted once on the Vendix demo site (APPORTEURS_KEY).
      const url = String(fields.url || '').trim().replace(/\/+$/, '');
      if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i.test(url)) return { ok: false, text: 'L’adresse du site Vendix doit ressembler à https://streetwear-demo.onrender.com (rien après).' };
      const old = (await readJson(APPORTEURS_CLE)) || {};
      const cle = old.cle && fields.nouvelle !== '1' ? old.cle : crypto.randomBytes(24).toString('base64url');
      await fs.mkdir(SECRETS, { recursive: true, mode: 0o700 });
      await fs.writeFile(APPORTEURS_CLE + '.tmp', JSON.stringify({ url, cle }), { mode: 0o600 }); await fs.rename(APPORTEURS_CLE + '.tmp', APPORTEURS_CLE);
      next = apporteurs.avecJetons(data).data; text = old.cle && fields.nouvelle !== '1' ? 'Adresse enregistrée.' : 'Clé créée. Copie-la sur le site Vendix (étapes ci-dessous), puis le bot enverra les tableaux de bord tout seul.';
    } else return { ok: false, text: 'Action inconnue.' };
    const { data: withTokens } = apporteurs.avecJetons(next);
    await writeDossier(file, withTokens);
    await fs.writeFile(APPORTEURS_SYNC, new Date().toISOString()).catch(() => {});
    await fs.writeFile(path.join(path.dirname(DATA), 'sauvegarde-demandee'), new Date().toISOString()).catch(() => {});
    return { ok: true, text };
  } catch (e) {
    return { ok: false, text: e.champ ? `Rien n’a été enregistré — ${e.message}.` : 'Rien n’a été enregistré : le serveur n’a pas pu écrire.' };
  }
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

const FACTURE_POSTS = ['/factures', '/factures/coordonnees', '/factures/payee', '/factures/retirer', '/factures/annuler', '/apporteurs/ajouter', '/apporteurs/modifier', '/apporteurs/client', '/apporteurs/client/retirer', '/apporteurs/verser', '/apporteurs/verser/annuler', '/apporteurs/lien', '/apporteurs/enligne'];
export async function handlePost(req, res, pathname) {
  let body;
  try { body = await readBody(req, pathname.startsWith('/dossier') || pathname === '/prospects' || pathname === '/micro' || pathname.startsWith('/factures') || pathname.startsWith('/apporteurs') || pathname === '/coffre/modifier' ? 65536 : 8192); } catch { res.writeHead(413, SECURITY); return res.end(errorPage('Trop de données.')); }
  const fields = Object.fromEntries(new URLSearchParams(body));
  const page = pathname.startsWith('/sauvegardes') ? '/sauvegardes' : pathname.startsWith('/dossier') ? '/dossier' : pathname === '/prospects' ? '/prospects' : pathname === '/micro' ? '/micro' : pathname.startsWith('/factures') ? '/factures' : pathname.startsWith('/apporteurs') ? '/apporteurs' : pathname === '/coffre/modifier' || pathname === '/coffre/indice' ? '/coffre' : '/mes-chiffres';
  let message;
  if (!sameSite(req) || fields.jeton !== FORM_TOKEN) message = { ok: false, text: 'Formulaire expiré ou venu d’ailleurs : rien n’a été enregistré. Recharge la page et recommence.' };
  else if (page === '/sauvegardes') { try { message = await actSauvegardes(pathname, fields); } catch { message = { ok: false, text: 'Impossible pour l’instant. Rien n’a été gardé.' }; } }
  else if (page === '/dossier') message = await actDossier(pathname, fields);
  else if (page === '/prospects') message = await actProspects(fields);
  else if (page === '/micro') message = await actMicro(fields);
  else if (page === '/factures') message = await actFactures(pathname, fields);
  else if (page === '/apporteurs') message = await actApporteurs(pathname, fields);
  else if (pathname === '/coffre/indice') { try { message = await actIndice(fields); } catch { message = { ok: false, text: 'Rien n’a été enregistré : le serveur n’a pas pu écrire.' }; } }
  else if (page === '/coffre') message = await actCoffre(fields);
  else {
    try { await savePrive(fields, (await readDossier(DATA)).data); message = { ok: true, text: 'Enregistré sur ton serveur.' }; }
    catch { message = { ok: false, text: 'Un montant n’est pas valide (exemple : 1650 ou 1 650,50). Rien n’a été enregistré.' }; }
  }
  const sent = (page === '/dossier' && pathname === '/dossier') || page === '/prospects' || ((page === '/micro' || page === '/factures' || page === '/apporteurs') && !message.ok) ? fields : null; // the safe's edit forms are per paper: nothing re-shown // re-shown on refusal, never stored
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
      if (req.method === 'POST' && (pathname === '/mes-chiffres' || pathname === '/micro' || FACTURE_POSTS.includes(pathname) || pathname === '/dossier' || pathname === '/dossier/retirer' || pathname === '/prospects' || pathname === '/coffre/modifier' || pathname === '/coffre/indice' || pathname.startsWith('/sauvegardes/'))) return await handlePost(req, res, pathname);
      if (req.method === 'GET' && pathname.startsWith('/coffre/voir/')) {
        const [vc, vh, vhead] = await viewDoc(pathname.slice('/coffre/voir/'.length));
        res.writeHead(vc, vhead || SECURITY); return res.end(vh);
      }
      if (req.method === 'GET' && PDFJS[pathname]) { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'private, max-age=2592000, immutable', 'x-content-type-options': 'nosniff' }); return res.end(PDFJS[pathname]); }
      if (req.method === 'GET' && pathname.startsWith('/factures/')) {
        const doc = await factureCachee(pathname.slice('/factures/'.length));
        if (!doc) { res.writeHead(404, SECURITY); return res.end(errorPage('Facture introuvable.')); }
        res.writeHead(200, doc.headers); return res.end(doc.body);
      }
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
