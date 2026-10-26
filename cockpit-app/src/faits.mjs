// « ✅ C'est fait » on the Aujourd'hui page: Sam ticks a task and it leaves the list at once, without waiting for
// ROADMAP.md to be edited on GitHub. Kept on the server only (STATE/data/faits.json), never in git, never in Telegram.
// A task is known by its whole text: when Claude rewrites a line (new version to install, new detail), it shows again.
import crypto from 'node:crypto';

export const MAX_FAITS = 300;
const KEEP_DAYS = 120;
export const CLE_RE = /^[a-f0-9]{16}$/;

// Same key for the raw ROADMAP line (bot) and the line stored in decisions.json (app, cut at 400 characters).
export function cleTache(line) {
  const t = String(line || '').replace(/`|^#+\s*|^- (\[ \] )?/g, '').replace(/\s+/g, ' ').trim().replace(/…$/, '').slice(0, 399).toLowerCase();
  return crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);
}

export const lireFaits = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([k, d]) => CLE_RE.test(k) && /^\d{4}-\d{2}-\d{2}$/.test(String(d)))) : {});

const ageDays = (iso, today) => (Date.parse(today + 'T00:00:00Z') - Date.parse(iso + 'T00:00:00Z')) / 864e5;
export function marquer(faits, cle, todayIso) {
  if (!CLE_RE.test(String(cle))) throw new Error('tâche inconnue');
  const next = Object.fromEntries(Object.entries(lireFaits(faits)).filter(([, d]) => ageDays(d, todayIso) <= KEEP_DAYS));
  next[cle] = todayIso;
  const keys = Object.keys(next).sort((a, b) => next[b].localeCompare(next[a])).slice(0, MAX_FAITS);
  return Object.fromEntries(keys.map((k) => [k, next[k]]));
}
export function retirer(faits, cle) { const next = { ...lireFaits(faits) }; delete next[cle]; return next; }

// The list as read by the bot, minus what Sam ticked; the ticked ones are kept apart (to undo a wrong tap).
export function sansFaits(attentes, faits) {
  if (!attentes || !Array.isArray(attentes.projets)) return attentes;
  const f = lireFaits(faits), faites = [];
  const projets = attentes.projets.map((p) => {
    const lignes = [];
    for (const l of p.lignes || []) { const cle = cleTache(l); if (f[cle]) faites.push({ cle, ligne: l, label: p.label }); else lignes.push(l); }
    return { ...p, lignes };
  }).filter((p) => p.lignes.length);
  return { ...attentes, projets, total: projets.reduce((n, p) => n + p.lignes.length, 0), faites };
}
