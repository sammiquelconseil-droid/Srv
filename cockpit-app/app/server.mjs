// Cockpit web app. Listens on 127.0.0.1 only; reached through `tailscale serve` (private network).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { summarize, upcoming } from '../src/patrimoine.mjs';
import crypto from 'node:crypto';
import { todayPage, patrimoinePage, chiffresPage, errorPage } from './views.mjs';

const STATE = process.env.STATE_DIR || '/var/lib/cockpit';
const DATA = process.env.DATA_FILE || path.join(STATE, 'data', 'situation.json');
const PORT = Number(process.env.PORT || 8080);
const PRIVE = process.env.PRIVE_FILE || path.join(STATE, 'data', 'prive.json');
const FORM_TOKEN = crypto.randomBytes(16).toString('hex'); // changes at each restart; checked on every form post

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

async function handlePost(req, res) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 8192) { res.writeHead(413, SECURITY); return res.end(errorPage('Trop de données.')); } }
  const fields = Object.fromEntries(new URLSearchParams(body));
  // Origin is "null" under our no-referrer policy; the per-restart form token is the real check.
  const origin = req.headers.origin;
  let sameSite = !origin || origin === 'null';
  if (!sameSite) { try { sameSite = new URL(origin).host === req.headers.host; } catch { sameSite = false; } }
  let message;
  if (!sameSite || fields.jeton !== FORM_TOKEN) message = { ok: false, text: 'Formulaire expiré ou venu d’ailleurs : rien n’a été enregistré. Recharge la page et recommence.' };
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
      if (req.method === 'POST' && pathname === '/mes-chiffres') return await handlePost(req, res);
      if (req.method !== 'GET') { res.writeHead(405, SECURITY); return res.end(errorPage('Méthode refusée.')); }
      const [code, html] = await render(new URL(req.url, 'http://x').pathname);
      res.writeHead(code, SECURITY); res.end(html);
    } catch (e) { res.writeHead(500, SECURITY); res.end(errorPage('Erreur interne.')); console.error(e); }
  }).listen(PORT, process.env.HOST || '127.0.0.1', () => console.log(`cockpit-app on ${process.env.HOST || '127.0.0.1'}:${PORT}`));
}
