// Cockpit web app. Listens on 127.0.0.1 only; reached through `tailscale serve` (private network).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { summarize, upcoming } from '../src/patrimoine.mjs';
import { todayPage, patrimoinePage, errorPage } from './views.mjs';

const STATE = process.env.STATE_DIR || '/var/lib/cockpit';
const DATA = process.env.DATA_FILE || path.join(STATE, 'data', 'situation.json');
const PORT = Number(process.env.PORT || 8080);
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

export async function render(url) {
  const data = await readJson(DATA);
  if (!data) return [503, errorPage('Les données ne sont pas encore arrivées sur le serveur.')];
  const asOf = todayIso();
  const summary = summarize(data, asOf);
  if (url === '/') {
    const alertes = summary.biens.flatMap((b) => (b.alertes || []).map((a) => `${b.nom} : ${a}`));
    return [200, todayPage({ now: new Date(), sante: await readJson(path.join(STATE, 'sante.json')), sauvegarde: await readJson(path.join(STATE, 'sauvegarde.json')), notes: await lastNotes(), echeances: upcoming(summary, asOf), alertes })];
  }
  if (url === '/patrimoine') return [200, patrimoinePage({ summary, asOf })];
  return [404, errorPage('Page introuvable.')];
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET') { res.writeHead(405, SECURITY); return res.end(errorPage('Méthode refusée.')); }
      const [code, html] = await render(new URL(req.url, 'http://x').pathname);
      res.writeHead(code, SECURITY); res.end(html);
    } catch (e) { res.writeHead(500, SECURITY); res.end(errorPage('Erreur interne.')); console.error(e); }
  }).listen(PORT, process.env.HOST || '127.0.0.1', () => console.log(`cockpit-app on ${process.env.HOST || '127.0.0.1'}:${PORT}`));
}
