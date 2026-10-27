// « Ma micro-entreprise » : what Sam received each month, per activity, and what follows from it — URSSAF lines to
// declare, money to set aside, the VAT franchise gauge, the micro ceiling. Pure, tested code (rule 6): no AI here.
// The amounts live on the server only (STATE/data/micro.json, level 3); Telegram only ever gets a level, no amount.
// Every rate comes from parametres/fiscal-2026.yaml with its status; « a_verifier » is shown with a warning.
import { RULES } from './echeancier.mjs';

// [key, label, URSSAF line, first month]: Vendix starts on 01/11/2026 (C-112).
export const ACTIVITES = [
  ['bnc', 'Apport d’affaires et conseil', 'libéral (BNC)', '2026-10'],
  ['bic', 'Vendix (boutiques en ligne)', 'prestations de services commerciales (BIC)', '2026-11'],
];
export const PARAMS = {
  taux: { bnc: { pct: 25.6, statut: 'a_verifier' }, bic: { pct: 21.2, statut: 'a_verifier' } },
  // Contribution à la formation professionnelle, collected with the cotisations: 0,2 % libéral, 0,1 % commerçant.
  formation: { bnc: 0.2, bic: 0.1, statut: 'a_verifier' },
  // Prudence chosen in LeadGen's KIT §5 (45,6 % = 25,6 % of cotisations + 20 % for income tax): a choice, not a tax computation.
  provisionImpotPct: 20,
  plafondMicro: { cents: 8360000, statut: 'a_verifier' },
  // Orange at 80 % of 37 500 €. (The « 90 % of 41 250 € » level of the parameters is 37 125 €, under 37 500 €: it is
  // folded into « rouge », whose text names both thresholds.)
  tva: { baseCents: 3750000, majoreCents: 4125000, statut: 'verifie', orangePct: 80 },
  debut: '2026-10', // activity created on 13/10/2026
  // Creation year: to know whether the franchise holds next year, the creation year's turnover is compared with the
  // threshold brought down to the days of activity (13/10 → 31/12 = 80 days): 37 500 × 80/365. The 41 250 € « during
  // the year » threshold is not prorated (impots.gouv.fr example). Same prudence for the micro ceiling. Read in extracts
  // only (BOFiP, justice.fr, impots.gouv.fr): « a_verifier ».
  creation: { annee: '2026', jours: 80, statut: 'a_verifier' },
  // The income-tax reserve of year N is kept until the tax on N is settled (balance taken from September N+1).
  impotGardeJusquA: '09-30',
};
export const PREMIERE_DECLARATION = RULES.find((r) => r.id === 'urssaf').premiere;
export const PREMIERE_A_VERIFIER = !!RULES.find((r) => r.id === 'urssaf').premiereAVerifier;

const fail = (champ, raison) => { const e = new Error(`${champ} : ${raison}`); e.champ = champ; throw e; };
export function euros(input, champ) {
  const t = String(input ?? '').replace(/[\s  €]/g, '').replace(',', '.');
  if (t === '') return 0;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) fail(champ, 'montant invalide (exemple : 349 ou 1 250,50)');
  return Math.round(Number(t) * 100);
}
const MOIS_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const moisDe = (iso) => String(iso).slice(0, 7);
export function moisEntre(debut, fin) {
  const out = []; let [y, m] = debut.split('-').map(Number);
  const [fy, fm] = fin.split('-').map(Number);
  while (y < fy || (y === fy && m <= fm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const nomMois = (m) => `${MOIS_FR[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

// Form: « m.<AAAA-MM>.bnc / .bic » in euros. Only months between the start and this month; all or nothing.
export function parseMicroForm(fields, current = {}, todayIso) {
  const next = { mois: { ...((current && current.mois) || {}) } };
  for (const m of moisEntre(PARAMS.debut, moisDe(todayIso))) {
    const row = {};
    for (const [k, , , debut] of ACTIVITES) if (m >= debut && `m.${m}.${k}` in fields) row[k] = euros(fields[`m.${m}.${k}`], `${nomMois(m)} · ${k === 'bnc' ? 'apport/conseil' : 'Vendix'}`);
    if (Object.keys(row).length) {
      const merged = { ...(next.mois[m] || {}), ...row };
      if (Object.values(merged).some((v) => v > 0)) next.mois[m] = merged; else delete next.mois[m];
    }
  }
  for (const m of Object.keys(next.mois)) if (!MOIS_RE.test(m)) delete next.mois[m];
  return next;
}

const pct = (cents, p) => Math.round((cents * p) / 100);
const montant = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0); // a hand-edited file never adds strings
// Thresholds of a calendar year: brought down to the days of activity in the creation year.
export function seuils(annee) {
  const { baseCents, majoreCents } = PARAMS.tva;
  const prorata = annee === PARAMS.creation.annee;
  const k = (c) => (prorata ? Math.round((c * PARAMS.creation.jours) / 365) : c);
  return { prorata, base: k(baseCents), majore: majoreCents, plafond: k(PARAMS.plafondMicro.cents) };
}
// The months, what to declare and set aside, the gauges. Calendar year of `todayIso`.
// `enc` = paid invoices per month (factures.encaissements): added to what Sam typed, never stored in micro.json.
export function resume(data, todayIso, enc = null) {
  const today = String(todayIso).slice(0, 10), fin = moisDe(today), annee = fin.slice(0, 4), avant = String(Number(annee) - 1);
  const mois = moisEntre(PARAMS.debut, fin).map((m) => {
    const r = ((data && data.mois) || {})[m] || {};
    const fx = (enc && enc.mois && enc.mois[m]) || {};
    const fbnc = Number.isSafeInteger(fx.bnc) ? fx.bnc : 0, fbic = Number.isSafeInteger(fx.bic) ? fx.bic : 0;
    const bnc = Math.max(0, montant(r.bnc) + fbnc), bic = Math.max(0, montant(r.bic) + fbic);
    const cotis = pct(bnc, PARAMS.taux.bnc.pct + PARAMS.formation.bnc) + pct(bic, PARAMS.taux.bic.pct + PARAMS.formation.bic);
    const impot = pct(bnc + bic, PARAMS.provisionImpotPct), echeance = echeanceDeclaration(m);
    // Still to pay: the cotisations until the declaration's deadline, the tax reserve until the tax on that year is settled.
    const garde = (echeance >= today ? cotis : 0) + (today <= `${Number(m.slice(0, 4)) + 1}-${PARAMS.impotGardeJusquA}` ? impot : 0);
    return { mois: m, bnc, bic, factures: { bnc: fbnc, bic: fbic }, total: bnc + bic, cotis, impot, deCote: cotis + impot, echeance, enCours: m === fin, aDeclarer: echeance >= today, garde };
  });
  const total = (y) => mois.filter((x) => x.mois.startsWith(y)).reduce((n, x) => n + x.total, 0);
  const caAnnee = total(annee), caAvant = total(avant), s = seuils(annee), sAvant = seuils(avant);
  const niveau = caAnnee > s.majore ? 'depasse' : caAvant > sAvant.base ? 'due' : caAnnee > s.base ? 'rouge' : caAnnee >= (s.base * PARAMS.tva.orangePct) / 100 ? 'orange' : 'ok';
  return {
    annee, mois, caAnnee, caAvant,
    cotisAnnee: mois.filter((x) => x.mois.startsWith(annee)).reduce((n, x) => n + x.cotis, 0),
    aGarder: mois.reduce((n, x) => n + x.garde, 0),
    tva: { niveau, prorata: s.prorata, base: s.base, majore: s.majore, pctBase: Math.floor((caAnnee * 100) / s.base), resteBase: Math.max(0, s.base - caAnnee), resteMajore: Math.max(0, s.majore - caAnnee) },
    plafond: { prorata: s.prorata, cents: s.plafond, pct: Math.floor((caAnnee * 100) / s.plafond), reste: Math.max(0, s.plafond - caAnnee) },
  };
}

// URSSAF: monthly declaration; the first one (activity started 13/10/2026) carries one amount per month since
// October, zeros included (date from src/echeancier.mjs, « à vérifier » there).
export function echeanceDeclaration(m) {
  if (m <= '2027-01') return PREMIERE_DECLARATION;
  const [y, mo] = m.split('-').map(Number);
  const ny = mo === 12 ? y + 1 : y, nm = mo === 12 ? 1 : mo + 1;
  return new Date(Date.UTC(ny, nm, 0)).toISOString().slice(0, 10); // last day of the following month
}

// Bot: once per level and year, no amount (Telegram is not end-to-end encrypted).
const TEXTE = {
  orange: 'Ton chiffre d’affaires de l’année approche le seuil de TVA (80 %). Le détail est dans ton Cockpit › Micro-entreprise.',
  due: 'Ton chiffre d’affaires de l’an dernier a passé le seuil de TVA : tu dois facturer la TVA depuis le 1er janvier. Ouvre ton Cockpit › Micro-entreprise et préviens Claude.',
  rouge: 'Ton chiffre d’affaires de l’année a passé le 1er seuil de TVA : TVA à facturer dès le 1er janvier prochain, et dès le jour où tu passerais le 2e seuil. Ouvre ton Cockpit › Micro-entreprise et préviens Claude.',
  depasse: 'Ton chiffre d’affaires a passé le 2e seuil de TVA : tu dois facturer la TVA dès maintenant. Ouvre ton Cockpit › Micro-entreprise et préviens Claude.',
};
export function rappelsMicro(data, todayIso, enc = null) {
  const r = resume(data, todayIso, enc);
  return r.tva.niveau === 'ok' ? [] : [{ cause: `tva:${r.annee}:${r.tva.niveau}`, text: `🧾 ${TEXTE[r.tva.niveau]}` }];
}
