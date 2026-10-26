// Prospects for the shop offer (Vendix): a short list kept ONLY on the server (STATE/data/prospects.json, niveau 3),
// never in git, never in a Telegram message with a name (the bot only says how many to follow up).
// Minimal data by design: a pseudo, where Sam found the person, a step, a follow-up date, a short note.
export const ETAPES = [
  ['a_contacter', 'À contacter'], ['contacte', 'Message envoyé'], ['relance', 'Relancé une fois'],
  ['demo', 'Démo faite'], ['offre', 'Offre envoyée'], ['signe', 'Client 🎉'], ['non', 'Pas intéressé / stop'],
];
const CODES = ETAPES.map(([k]) => k);
const CLOSED = ['signe', 'non'];
export const MAX_PROSPECTS = 100;
// Days before the next follow-up, set automatically when a step is chosen without a date.
const AUTO_DAYS = { contacte: 4, relance: 7, demo: 2, offre: 3 };

const fail = (champ, raison) => { const e = new Error(`${champ} : ${raison}`); e.champ = champ; throw e; };
const text = (v, champ, max, required = false) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (required && !t) fail(champ, 'à remplir');
  if (t.length > max) fail(champ, `trop long (${max} caractères maximum)`);
  return t;
};
const isDate = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t) && new Date(t + 'T00:00:00Z').toISOString().slice(0, 10) === t;
export const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

function one(fields, p, label, cur, todayIso) {
  const f = (k) => fields[`${p}.${k}`];
  const nom = text(f('nom'), `${label} · pseudo`, 40, true);
  const etape = String(f('etape') || 'a_contacter');
  if (!CODES.includes(etape)) fail(`${label} · étape`, 'inconnue');
  const r = String(f('relance') ?? '').trim();
  if (r && !isDate(r)) fail(`${label} · relance`, 'date impossible (choisis-la avec le calendrier)');
  const changed = !cur || cur.etape !== etape;
  let relance = r || null;
  if (CLOSED.includes(etape)) relance = null; // a « non » is never followed up
  else if (changed && !r && AUTO_DAYS[etape]) relance = addDays(todayIso, AUTO_DAYS[etape]);
  // A follow-up date that did not move while the step did is the old one: replace it by the automatic one.
  else if (changed && cur && r === cur.relance && AUTO_DAYS[etape]) relance = addDays(todayIso, AUTO_DAYS[etape]);
  const out = { id: cur?.id || `p${Date.parse(todayIso + 'T00:00:00Z') / 1000}-${Math.random().toString(36).slice(2, 7)}`,
    nom, ou: text(f('ou'), `${label} · où`, 40), etape, relance,
    note: etape === 'non' ? '' : text(f('note'), `${label} · note`, 200), // « stop » = keep only what avoids writing again
    depuis: changed ? todayIso : cur.depuis || todayIso };
  return out;
}

// Whole form, all or nothing. Rows p{i}.* (empty pseudo = removed) and pnew.*.
export function parseProspectsForm(fields, current = [], todayIso) {
  const byId = Object.fromEntries((current || []).map((x) => [x.id, x]));
  const list = [];
  for (let i = 0; i < MAX_PROSPECTS; i++) {
    if (!(`p${i}.nom` in fields)) continue;
    if (!String(fields[`p${i}.nom`]).trim()) continue; // emptied = removed (right to erasure, one gesture)
    list.push(one(fields, `p${i}`, `prospect n°${i + 1}`, byId[fields[`p${i}.id`]] || null, todayIso));
  }
  if (String(fields['pnew.nom'] || '').trim()) list.push(one(fields, 'pnew', 'nouveau prospect', null, todayIso));
  if (list.length > MAX_PROSPECTS) fail('prospects', `${MAX_PROSPECTS} au maximum`);
  const names = list.map((x) => x.nom.toLowerCase());
  if (new Set(names).size !== names.length) fail('prospects', 'deux prospects ont le même pseudo');
  return list;
}

export const aRelancer = (list, todayIso) => (list || []).filter((x) => !CLOSED.includes(x.etape) && x.relance && x.relance <= todayIso);

// Open prospects first by follow-up date, then the closed ones.
export const trier = (list) => [...(list || [])].sort((a, b) => (CLOSED.includes(a.etape) - CLOSED.includes(b.etape)) || String(a.relance || '9999').localeCompare(String(b.relance || '9999')) || a.nom.localeCompare(b.nom));

export function compter(list) {
  const c = Object.fromEntries(CODES.map((k) => [k, 0]));
  for (const x of list || []) c[x.etape] = (c[x.etape] || 0) + 1;
  return c;
}

// Bot: one alert a day, with a count only (Telegram is not end-to-end encrypted: no pseudo, no note).
export function rappelsProspects(list, todayIso) {
  const n = aRelancer(list, todayIso).length;
  if (!n) return [];
  return [{ cause: `prospects:${todayIso}`, text: `🎯 ${n} prospect${n > 1 ? 's' : ''} à relancer aujourd’hui. Le détail est dans ton Cockpit › Prospects.` }];
}
