// Storage of the safe: each document is encrypted (AES-256-GCM) with a key kept outside the data folder
// (/etc/cockpit/coffre.key, written by root at /maj, readable by the app only). Only PDF and photos are
// accepted, recognised by their first bytes (never by the name or what the phone claims). Nothing here logs
// a title or a file name.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { parseMeta, MAX_DOCS } from '../src/coffre.mjs';

export const MAX_FILE = 15 * 1024 * 1024; // one document
export const MAX_TOTAL = 3 * 1024 * 1024 * 1024; // the whole safe
const MAGIC = 'CKF1';
// A paper sealed on the phone (app/coffreclient.mjs) starts with CKE1: the server cannot read it and never tries.
export const SEALED = Buffer.from('CKE1');
export const isSealed = (buf) => buf.length > 32 && buf.subarray(0, 4).equals(SEALED);
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
  const kind = e2e ? (E2E_MIMES[fields.mime] ? { mime: fields.mime, ext: E2E_MIMES[fields.mime] } : null) : detect(file.data);
  if (!kind) return fail('Rien n’a été rangé — seuls les PDF et les photos (JPEG, PNG, HEIC) sont acceptés.');
  if (list.length >= MAX_DOCS) return fail('Rien n’a été rangé — le coffre est plein (2 000 papiers). Dis-le à Claude.');
  const total = list.reduce((t, d) => t + (d.taille || 0), 0);
  if (total + file.data.length > MAX_TOTAL) return fail('Rien n’a été rangé — le coffre est plein (3 Go). Dis-le à Claude.');
  const sha = crypto.createHash('sha256').update(file.data).digest('hex');
  const twin = list.find((d) => d.sha256 === sha);
  if (twin) return fail(`Ce fichier est déjà dans ton coffre (« ${twin.titre} »). Rien n’a été ajouté.`);
  const id = crypto.randomBytes(12).toString('hex');
  const target = path.join(ctx.dir, `${id}.ckf`);
  await fs.mkdir(ctx.dir, { recursive: true, mode: 0o700 });
  try {
    await writeAtomic(target, encrypt(file.data, key));
    const doc = { id, ...meta, mime: kind.mime, ext: kind.ext, taille: file.data.length, sha256: sha, ajoute: ctx.todayIso, ...(e2e ? { e2e: true } : {}) };
    // First sensitive paper: keep its verifier (a sentence sealed with the vault password) so that later uploads can
    // check the password; never replaced afterwards (a second password would split the vault in two).
    if (e2e && ctx.verifFile && /^[A-Za-z0-9+/=]{40,400}$/.test(String(fields.verifier || '')) && !(await readVerifier(ctx.verifFile))) await writeAtomic(ctx.verifFile, JSON.stringify({ verifier: fields.verifier }));
    await writeAtomic(ctx.indexFile, JSON.stringify([...list, doc], null, 1));
    return { ok: true, text: e2e ? `🔒 « ${meta.titre} » est rangé, chiffré avec ton mot de passe du coffre. Sans ce mot de passe, personne ne peut l’ouvrir : garde-le sur ta fiche de secours.` : `✅ « ${meta.titre} » est rangé dans ton coffre.`, id };
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
    return { ok: true, text: `« ${gone.titre} » est retiré du coffre.` };
  }
  try { list[i] = { ...list[i], ...parseMeta(fields, ctx.places, list[i]) }; } catch (e) { return fail(`Rien n’a été changé — ${e.message}.`); }
  await writeAtomic(ctx.indexFile, JSON.stringify(list, null, 1));
  return { ok: true, text: `« ${list[i].titre} » est mis à jour.` };
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
