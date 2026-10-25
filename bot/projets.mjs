// « Où en sont mes projets ? » : the bot READS each project's own files (no copy, no second source of truth)
// and lists them in Sam's priority order (REGLES-COMMUNES §H). HOC is never read here: its data belong to Assimina.
import { PROJECTS } from './classify.mjs';
import { findSecret } from './secrets.mjs';

// Telegram is not end-to-end encrypted: amounts and anything secret-looking never leave the Cockpit.
// Details stay readable on the Cockpit screens over Tailscale.
export function minimise(s) {
  const t = String(s || '');
  if (findSecret(t)) return '[ligne masquée : donnée sensible — à lire dans le Cockpit]';
  return t.replace(/\d[\d\s\u202f.,]*\s?(€|euros?\b|EUR\b)/gi, '[montant]');
}

export const RANK = { hoc: 1, cockpit: 2, zaff: 2, lingfi: 3, leadgen: 4 };
export const ORDER = Object.keys(RANK).sort((a, b) => RANK[a] - RANK[b]);

const all = (re) => (t) => [...t.matchAll(re)].map((m) => m[0]);
const section = (title) => (t) => { const i = t.indexOf(title); if (i < 0) return []; const rest = t.slice(i + title.length); const end = rest.search(/\n## /); return (end < 0 ? rest : rest.slice(0, end)).split('\n').filter((l) => /^- (?!\[x\])/.test(l)); };

// Where each project already writes its state. null = not read from here.
export const SOURCES = {
  hoc: null, // never read, from anywhere
  cockpit: { attente: ['ROADMAP.md', section('## Décisions de Sam')] },
  zaff: { attente: ['ROADMAP.md', all(/^- \[ \] \(toi\).*$/gm)] },
  lingfi: { attente: ['DECISIONS.md', all(/^#{2,3} D-\d+.*dis stop.*$/gm)] },
  leadgen: { attente: null },
};

const clean = (s, n = 150) => { const t = minimise(String(s || '').replace(/\*\*|`|^#+\s*|^- (\[ \] )?/g, '')).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// Only explicitly allowed fields reach Telegram: the structured « Phase actuelle » line of ROADMAP.md
// (REGLES-COMMUNES §D), the DATE of the last change (never the commit message), the NUMBER of decisions
// waiting for Sam and their short titles (sections written for Sam, minimised). No journal text, no note,
// no local file, no commit message. HOC: a fixed sentence, nothing read anywhere.
const PHASE = /^Phase actuelle\s*:.*$/m;
export async function synthese({ read: readAny, commit: commitAny, decisionsOnly = false, alertes = [], queued = 0, now = new Date() }) {
  const hocRepo = PROJECTS.hoc.repo;
  const read = (repo, f) => (repo === hocRepo ? Promise.resolve(null) : readAny(repo, f));
  const commit = (repo) => (repo === hocRepo ? Promise.resolve(null) : commitAny(repo));
  const rows = []; let decisions = 0;
  for (const k of ORDER) {
    const p = PROJECTS[k], src = SOURCES[k];
    if (!src) { if (!decisionsOnly) rows.push(`${RANK[k]}. ${p.label} — consulter sa session dédiée (rien n’est lu d’ici).`); continue; }
    const files = {};
    const get = async (f) => (f in files ? files[f] : (files[f] = await read(p.repo, f).catch(() => null)));
    const phase = ((await get('ROADMAP.md')) || '').match(PHASE);
    const attente = (src.attente ? (src.attente[1]((await get(src.attente[0])) || '') || []) : []).map((l) => clean(l, 90));
    decisions += attente.length;
    if (decisionsOnly) { if (attente.length) rows.push(`${p.label} :\n${attente.slice(0, 3).map((a) => `   🧑 ${a}`).join('\n')}${attente.length > 3 ? `\n   … et ${attente.length - 3} autre(s)` : ''}`); continue; }
    const c = await commit(p.repo).catch(() => null);
    const lines = [`${RANK[k]}. ${p.label} — ${phase ? clean(phase[0], 90) : 'pas de ligne « Phase actuelle » dans son ROADMAP (format commun à adopter)'}`];
    if (c && c.date) lines.push(`   Dernier changement : ${c.date.slice(8, 10)}/${c.date.slice(5, 7)}`);
    if (attente.length) lines.push(`   🧑 Pour toi (${attente.length}) : ${attente[0]}`);
    rows.push(lines.join('\n'));
  }
  const at = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(now).replace(' ', ' ').replace(',', ''); // heure de Paris
  const crit = alertes.filter((a) => a.level === 'critique').length;
  if (decisionsOnly) return rows.length ? `🧑 Décisions qui n’attendent que toi (${decisions}) — ${at}\n\n${rows.join('\n\n')}\n\nDétail et recommandations : /moi dans une session Claude du projet.` : 'Rien n’attend ta décision dans les fichiers des projets. Je continue.';
  return `📊 Tes projets — ${at}\n${ORDER.length} projets · ${decisions} décision(s) pour toi · ${crit} incident(s)${queued ? ` · ${queued} note(s) en attente d’envoi` : ''}\n\n${rows.join('\n\n')}\n\nLu à l’instant dans les fichiers des projets (rien n’est recopié). Décisions seules : /decisions`;
}
