// The safe (« coffre ») of Sam's papers: what each document is and where it belongs. Pure functions shared by
// the app (pages, forms) and the bot (deadline reminders). The files themselves live encrypted on the server
// (app/coffre.mjs); the index (STATE/data/coffre.json) holds titles and dates, never the content.
export const TYPES = [
  ['contrat', '📜', 'Contrat'], ['devis', '🧮', 'Devis'], ['facture', '🧾', 'Facture'], ['acte', '🏛', 'Acte / titre de propriété'],
  ['assurance', '🛡', 'Assurance'], ['impots', '🏦', 'Impôts / URSSAF'], ['pret', '💳', 'Prêt / banque'], ['courrier', '✉️', 'Courrier'],
  ['garantie', '🧰', 'Garantie / notice'], ['autre', '📄', 'Autre'],
];
// Where a paper belongs, besides each house of the dossier (bien:<id>).
export const DOMAINES = [
  ['perso', '👤', 'Perso'], ['sm', '💼', 'Ma micro-entreprise'], ['impots', '🏦', 'Impôts et URSSAF'],
  ['projet:hoc', '🧶', 'HOC'], ['projet:zaff', '👕', 'Les Zaff'], ['projet:lingfi', '🛍', 'Lingfi'],
  ['projet:leadgen', '🔥', 'LeadGen Rénov'], ['projet:cockpit', '🧭', 'Cockpit'], ['autre', '📦', 'Autre'],
];
export const MAX_DOCS = 2000;

const fail = (champ, raison) => { const e = new Error(`${champ} : ${raison}`); e.champ = champ; throw e; };
const text = (v, champ, max, required = false) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (required && !t) fail(champ, 'à remplir');
  if (t.length > max) fail(champ, `trop long (${max} caractères maximum)`);
  return t;
};
// A title or note sealed on the phone (« e2: » + base64): kept as is, never read here.
export const E2_RE = /^e2:[A-Za-z0-9+/]+={0,2}$/;
export const isE2 = (v) => E2_RE.test(String(v || ''));
const sealedOr = (v, champ, max, maxSealed, required = false) => {
  const t = String(v ?? '').trim();
  if (t.startsWith('e2:')) { if (!isE2(t) || t.length > maxSealed) fail(champ, 'chiffrement abîmé, recommence'); return t; }
  return text(t, champ, max, required);
};
// How a paper is named in a message: never the sealed text.
export const nommer = (titre) => (isE2(titre) ? 'Ton papier 🔒' : `« ${titre} »`);
const isDate = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t) && new Date(t + 'T00:00:00Z').toISOString().slice(0, 10) === t;
const optDate = (v, champ) => { const t = String(v ?? '').trim(); if (!t) return null; if (!isDate(t)) fail(champ, 'date impossible (choisis-la avec le calendrier)'); return t; };

// Every place a document can be attached to: the houses of the dossier first, then the fixed domains.
export function rattachements(dossier) {
  const biens = ((dossier && dossier.biens) || []).filter((b) => b.id).map((b) => [`bien:${b.id}`, '🏡', b.nom]);
  return [...biens, ...DOMAINES];
}
export const libelle = (list, key) => { const x = list.find(([k]) => k === key); return x ? `${x[1]} ${x[2]}` : '📦 Ancien classement'; };

// Title, place, type, dates, « à faire ». A place that no longer exists (house removed) is kept as it was.
export function parseMeta(fields, places, current = {}) {
  const keys = places.map(([k]) => k);
  const rattache = String(fields.rattache || current.rattache || 'perso');
  if (!keys.includes(rattache) && rattache !== current.rattache) fail('rangé dans', 'choix inconnu');
  const type = String(fields.type || current.type || 'autre');
  if (!TYPES.some(([k]) => k === type)) fail('type', 'inconnu');
  const afaire = String(fields.afaire || '');
  if (!['', 'a_faire', 'fait'].includes(afaire)) fail('à faire', 'choix inconnu');
  return {
    titre: sealedOr(fields.titre, 'titre', 80, 1500, true), rattache, type,
    date: optDate(fields.date, 'date du document'), echeance: optDate(fields.echeance, 'date limite'),
    afaire, note: sealedOr(fields.note, 'note', 200, 2500),
  };
}

// Newest first (document date, else the day it was filed), optionally filtered by place and type.
export function filtrer(index, { r = '', t = '' } = {}) {
  return (index || []).filter((d) => (!r || d.rattache === r) && (!t || d.type === t))
    .sort((a, b) => String(b.date || b.ajoute).localeCompare(String(a.date || a.ajoute)) || String(b.ajoute).localeCompare(String(a.ajoute)));
}
export const annee = (d) => String(d.date || d.ajoute || '').slice(0, 4) || '—';
export const compterPar = (index) => (index || []).reduce((m, d) => { m[d.rattache] = (m[d.rattache] || 0) + 1; return m; }, {});
export const aFaire = (index) => (index || []).filter((d) => d.afaire === 'a_faire');

const days = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5);
// Bot: J-30, J-7 and the day itself for each deadline not marked done. No title in Telegram (it can be private).
export function rappelsCoffre(index, todayIso) {
  const out = [];
  for (const d of index || []) {
    if (!d.echeance || d.afaire === 'fait') continue;
    const n = days(todayIso, d.echeance);
    if (![30, 7, 0].includes(n)) continue;
    const quand = n === 0 ? 'aujourd’hui' : `dans ${n} jours (le ${d.echeance.slice(8, 10)}/${d.echeance.slice(5, 7)})`;
    out.push({ cause: `coffre:${d.id}:${d.echeance}:J-${n}`, text: `📎 Un papier de ton coffre arrive à sa date limite ${quand}. Le détail est dans ton Cockpit › Coffre.` });
  }
  return out;
}
