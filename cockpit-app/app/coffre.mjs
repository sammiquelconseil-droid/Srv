// Storage of the safe: each document is encrypted (AES-256-GCM) with a key kept outside the data folder
// (/etc/cockpit/coffre.key, written by root at /maj, readable by the app only). Only PDF and photos are
// accepted, recognised by their first bytes (never by the name or what the phone claims). Nothing here logs
// a title or a file name.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { parseMeta, MAX_DOCS, nommer, isE2 } from '../src/coffre.mjs';

export const MAX_FILE = 15 * 1024 * 1024; // one document
export const MAX_TOTAL = 3 * 1024 * 1024 * 1024; // the whole safe
const MAGIC = 'CKF1';
// A paper sealed on the phone (app/coffreclient.mjs) starts with CKE1: the server cannot read it and never tries.
// CKE1 = sealed with a key derived from the password (first version) ; CKE2 = sealed with the vault key.
export const SEALED = Buffer.from('CKE1');
export const SEALED2 = Buffer.from('CKE2');
export const isSealed = (buf) => (buf.length > 32 && buf.subarray(0, 4).equals(SEALED)) || (buf.length > 16 && buf.subarray(0, 4).equals(SEALED2));
export const E2E_MIMES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic' };
const ID_RE = /^[a-f0-9]{24}$/;
export const isId = (id) => ID_RE.test(String(id || ''));

export function encrypt(buf, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([Buffer.from(MAGIC), iv, c.getAuthTag(), ct]);
}
export function decrypt(blob, key) {
  if (blob.subarray(0, 4).toString() !== MAGIC) throw new Error('format inconnu');
  const d = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(4, 16));
  d.setAuthTag(blob.subarray(16, 32));
  return Buffer.concat([d.update(blob.subarray(32)), d.final()]);
}

// What the file really is. Anything else (HTML, SVG, scripts, office files…) is refused.
export function detect(buf) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.length >= 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp' && ['heic', 'heix', 'mif1', 'msf1', 'hevc'].includes(buf.subarray(8, 12).toString('latin1'))) return { mime: 'image/heic', ext: 'heic' };
  return null;
}

// multipart/form-data with text fields and at most one file (field « fichier »). Small and strict.
export function parseMultipart(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(String(contentType || ''));
  if (!m) throw new Error('formulaire illisible');
  const sep = Buffer.from('--' + (m[1] || m[2]).trim());
  const fields = {}; let file = null;
  let pos = body.indexOf(sep);
  if (pos < 0) throw new Error('formulaire illisible');
  for (let n = 0; n < 40; n++) {
    pos += sep.length;
    if (body.subarray(pos, pos + 2).toString() === '--') return { fields, file };
    pos += 2; // CRLF after the boundary
    const headEnd = body.indexOf('\r\n\r\n', pos);
    if (headEnd < 0) throw new Error('formulaire illisible');
    const head = body.subarray(pos, headEnd).toString('utf8');
    const next = body.indexOf(sep, headEnd + 4);
    if (next < 0) throw new Error('formulaire illisible');
    const data = body.subarray(headEnd + 4, next - 2); // minus the CRLF before the boundary
    const name = /name="([^"]*)"/i.exec(head)?.[1];
    const filename = /filename="([^"]*)"/i.exec(head)?.[1];
    if (name === 'fichier' && filename !== undefined) { if (file) throw new Error('un seul fichier à la fois'); file = { filename, data }; }
    else if (name && filename === undefined) fields[name] = data.toString('utf8');
    pos = next;
  }
  throw new Error('formulaire trop long');
}

export async function readIndex(file) {
  let raw;
  try { raw = await fs.readFile(file, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? { etat: 'absent', list: [] } : { etat: 'illisible', list: [] }; }
  try { const l = JSON.parse(raw); if (Array.isArray(l)) return { etat: 'ok', list: l }; } catch { /* fall through */ }
  return { etat: 'illisible', list: [] };
}
async function writeAtomic(file, data, mode = 0o600) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { await fs.writeFile(tmp, data, { mode }); await fs.rename(tmp, file); } finally { await fs.rm(tmp, { force: true }); }
}
export async function readKey(keyFile) {
  try { const k = await fs.readFile(keyFile); return k.length === 32 ? k : null; } catch { return null; }
}

const fail = (text) => ({ ok: false, text });
// One change of the list at a time (single process): two saves at once must never drop a paper.
let queue = Promise.resolve();
const serial = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };
// ctx: { dir, indexFile, keyFile, places, todayIso, now }
export const addDoc = (fields, file, ctx) => serial(() => addDocNow(fields, file, ctx));
async function addDocNow(fields, file, ctx) {
  const key = await readKey(ctx.keyFile);
  if (!key) return fail('Le coffre n’est pas encore ouvert sur ton serveur : fais /maj dans le bot, puis réessaie.');
  const { etat, list } = await readIndex(ctx.indexFile);
  if (etat === 'illisible') return fail('La liste de ton coffre est illisible : je n’ajoute rien pour ne pas l’abîmer. Dis-le à Claude.');
  let meta;
  try { meta = parseMeta(fields, ctx.places); } catch (e) { return fail(`Rien n’a été rangé — ${e.message}.`); }
  if (!file || !file.data.length) return fail('Rien n’a été rangé — choisis un fichier (photo ou PDF).');
  if (file.data.length > MAX_FILE) return fail('Rien n’a été rangé — fichier trop lourd (15 Mo maximum). Scanne-le en noir et blanc ou en plusieurs parties.');
  // Sealed on the phone: the type is what the phone says, from the short list (the bytes are unreadable here).
  const e2e = isSealed(file.data);
  // A paper ticked « 🔒 » must arrive sealed, with a sealed title, under the vault method (v2) and the id the phone
  // used to seal it: if the page's script failed, nothing in clear is ever kept for it.
  if (fields.sensible === '1' && !e2e) return fail('Rien n’a été rangé : ce papier 🔒 n’a pas été chiffré sur ton téléphone. Recharge la page et réessaie.');
  if (e2e && (!file.data.subarray(0, 4).equals(SEALED2) || !isE2(meta.titre) || (meta.note && !isE2(meta.note)) || !isId(fields.id) || list.some((d) => d.id === fields.id))) return fail('Rien n’a été rangé : chiffrement incomplet. Recharge la page et réessaie.');
  const kind = e2e ? (E2E_MIMES[fields.mime] ? { mime: fields.mime, ext: E2E_MIMES[fields.mime] } : null) : detect(file.data);
  if (!kind) return fail('Rien n’a été rangé — seuls les PDF et les photos (JPEG, PNG, HEIC) sont acceptés.');
  if (list.length >= MAX_DOCS) return fail('Rien n’a été rangé — le coffre est plein (2 000 papiers). Dis-le à Claude.');
  const total = list.reduce((t, d) => t + (d.taille || 0), 0);
  if (total + file.data.length > MAX_TOTAL) return fail('Rien n’a été rangé — le coffre est plein (3 Go). Dis-le à Claude.');
  const sha = crypto.createHash('sha256').update(file.data).digest('hex');
  const twin = list.find((d) => d.sha256 === sha);
  if (twin) return fail(`Ce fichier est déjà dans ton coffre (${nommer(twin.titre)}). Rien n’a été ajouté.`);
  const id = e2e ? fields.id : crypto.randomBytes(12).toString('hex');
  const target = path.join(ctx.dir, `${id}.ckf`);
  await fs.mkdir(ctx.dir, { recursive: true, mode: 0o700 });
  try {
    await writeAtomic(target, encrypt(file.data, key));
    const doc = { id, ...meta, mime: kind.mime, ext: kind.ext, taille: file.data.length, sha256: sha, ajoute: ctx.todayIso, ...(e2e ? { e2e: true } : {}) };
    // First sensitive paper: keep its verifier (a sentence sealed with the vault password) so that later uploads can
    // check the password; never replaced afterwards (a second password would split the vault in two).
    if (e2e && ctx.verifFile && /^[A-Za-z0-9+/=]{40,400}$/.test(String(fields.verifier || '')) && !(await readVerifier(ctx.verifFile))) await writeAtomic(ctx.verifFile, JSON.stringify({ verifier: fields.verifier }));
    await writeAtomic(ctx.indexFile, JSON.stringify([...list, doc], null, 1));
    return { ok: true, text: e2e ? `🔒 ${nommer(meta.titre)} est rangé, chiffré sur ton iPhone. Sans ton mot de passe du coffre, personne ne peut l’ouvrir.` : `✅ ${nommer(meta.titre)} est rangé dans ton coffre.`, id };
  } catch {
    await fs.rm(target, { force: true });
    return fail('Rien n’a été rangé : le serveur n’a pas pu écrire. Réessaie ; si ça recommence, dis-le à Claude.');
  }
}

export const editDoc = (fields, ctx) => serial(() => editDocNow(fields, ctx));
async function editDocNow(fields, ctx) {
  const { etat, list } = await readIndex(ctx.indexFile);
  if (etat === 'illisible') return fail('La liste de ton coffre est illisible : je ne change rien. Dis-le à Claude.');
  const i = list.findIndex((d) => d.id === fields.id);
  if (!isId(fields.id) || i < 0) return fail('Papier introuvable : recharge la page.');
  if (fields.supprimer === '1') {
    if (fields.sur !== '1') return fail('Pour retirer un papier, coche aussi « Oui, le retirer ». Rien n’a été changé.');
    const [gone] = list.splice(i, 1);
    await writeAtomic(ctx.indexFile, JSON.stringify(list, null, 1));
    await fs.rm(path.join(ctx.dir, `${gone.id}.ckf`), { force: true });
    return { ok: true, text: `${nommer(gone.titre)} est retiré du coffre.` };
  }
  // A 🔒 paper keeps sealed texts: a title or note in clear is refused (the phone's script did not run).
  if (list[i].e2e && isE2(list[i].titre) && (!isE2(fields.titre) || (String(fields.note || '').trim() && !isE2(fields.note)))) return fail('Rien n’a été changé : le titre n’a pas été chiffré sur ton téléphone. Ouvre le coffre puis réessaie.');
  try { list[i] = { ...list[i], ...parseMeta(fields, ctx.places, list[i]) }; } catch (e) { return fail(`Rien n’a été changé — ${e.message}.`); }
  await writeAtomic(ctx.indexFile, JSON.stringify(list, null, 1));
  return { ok: true, text: `${nommer(list[i].titre)} est mis à jour.` };
}

// One document, decrypted in memory for the person who passed Face ID. null = not found or unreadable.
export async function readDoc(id, ctx) {
  if (!isId(id)) return null;
  const key = await readKey(ctx.keyFile);
  const { list } = await readIndex(ctx.indexFile);
  const meta = list.find((d) => d.id === id);
  if (!key || !meta) return null;
  try { return { meta, data: decrypt(await fs.readFile(path.join(ctx.dir, `${id}.ckf`)), key) }; } catch { return null; }
}

export async function readVerifier(file) {
  try { const v = JSON.parse(await fs.readFile(file, 'utf8')); return typeof v.verifier === 'string' ? v.verifier : null; } catch { return null; }
}

// The vault (v2): the vault key, WRAPPED by the password (the server cannot unwrap it). Set once, never replaced.
const B64 = (s, n) => typeof s === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(s) && Buffer.from(s, 'base64').length === n;
export const validVault = (v) => !!v && v.v === 2 && B64(v.salt, 16) && B64(v.iv, 12) && B64(v.wrapped, 48);
export async function readVault(file) { return (await vaultState(file)).vault; }
// absent = never created ; abime = present but unreadable or invalid (never offer to create a new one then).
export async function vaultState(file) {
  let raw;
  try { raw = await fs.readFile(file, 'utf8'); } catch (e) { return { etat: e.code === 'ENOENT' ? 'absent' : 'abime', vault: null }; }
  try { const v = JSON.parse(raw); if (validVault(v)) return { etat: 'ok', vault: v }; } catch { /* fall through */ }
  return { etat: 'abime', vault: null };
}
// v1 → v2: a paper sealed with the first method (CKE1, title in clear) is replaced by the phone's v2 version
// (same id): file sealed with the vault key, title and note sealed. Only for v1 papers, only once.
export const replaceV1 = (fields, file, ctx) => serial(async () => {
  const { etat, list } = await readIndex(ctx.indexFile);
  if (etat === 'illisible') return fail('La liste de ton coffre est illisible : rien n’a été changé.');
  const i = list.findIndex((d) => d.id === fields.id);
  if (!isId(fields.id) || i < 0 || !list[i].e2e) return fail('Papier introuvable.');
  if (!file || !file.data.subarray(0, 4).equals(SEALED2) || !isE2(fields.titre) || (fields.note && !isE2(fields.note))) return fail('Chiffrement incomplet : rien n’a été changé.');
  const key = await readKey(ctx.keyFile);
  const target = path.join(ctx.dir, `${fields.id}.ckf`);
  let current;
  try { current = decrypt(await fs.readFile(target), key); } catch { return fail('Ancien papier illisible : rien n’a été changé.'); }
  if (!current.subarray(0, 4).equals(SEALED)) return fail('Ce papier est déjà converti.');
  await writeAtomic(target, encrypt(file.data, key));
  list[i] = { ...list[i], titre: fields.titre, note: fields.note || '', taille: file.data.length, sha256: crypto.createHash('sha256').update(file.data).digest('hex') };
  await writeAtomic(ctx.indexFile, JSON.stringify(list, null, 1));
  return { ok: true, text: 'Converti.' };
});
export const setVault = (vault, file) => serial(async () => {
  if (!validVault(vault)) return { ok: false, text: 'Clé du coffre abîmée : rien n’a été enregistré. Recommence.' };
  // Never over an existing file, even unreadable: replacing the wrapped key would lose every paper for good.
  try { await fs.writeFile(file, JSON.stringify({ v: 2, salt: vault.salt, iv: vault.iv, wrapped: vault.wrapped }), { flag: 'wx', mode: 0o600 }); }
  catch (e) { return { ok: false, text: e.code === 'EEXIST' ? 'Ton coffre a déjà un mot de passe : il ne peut pas être remplacé d’ici.' : 'Le serveur n’a pas pu écrire. Réessaie.' }; }
  return { ok: true, text: 'Mot de passe du coffre créé.' };
});
