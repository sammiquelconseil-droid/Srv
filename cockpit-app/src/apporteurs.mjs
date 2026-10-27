// « 🤝 Apporteurs » : the people who bring Sam shop clients, and what they earn — computed from the paid invoices
// (src/factures.mjs), never typed twice. Pure, tested code (rule 6). Level 3 data (STATE/data/apporteurs.json):
// server only, never in git; Telegram only ever gets a count, no name, no amount. Confidential programme (27/10).
import { randomBytes, createHash } from 'node:crypto';
import { moisDe } from './micro.mjs';

// Rates in points of the subscription cashed: year 1, year 2, then. Direct apporteur; or apporteur brought by a
// « parrain » (the parrain's share + the apporteur's share never exceed the direct rate).
export const TAUX = { direct: [25, 15, 10], second: [15, 9, 6], parrain: [10, 6, 4] };
// A special rate for one apporteur (Les Zaff: 25 % for 3 years, then 20 %): points per client year, last value repeats.
// The partner rate (Les Zaff, its associate, Sam's close circle): kept under the « zaff » key so stored files stay valid.
export const TAUX_SPECIAUX = [['', 'Taux normal (25 / 15 / 10 %)'], ['zaff', 'Partenaire : 25 % pendant 3 ans, puis 20 %']];
const SPECIAUX = { zaff: [25, 25, 25, 20] };
const tauxDe = (table, annee) => table[Math.min(annee, table.length - 1)];
export const BONUS_POINTS = 5, BONUS_MIN_APPORTEURS = 3;
export const MODES = [['avoir', 'Avoir (déduit de son abonnement)'], ['virement', 'Virement (sur sa facture)']];
export const MAX_APPORTEURS = 50;

const fail = (champ, raison) => { const e = new Error(`${champ} : ${raison}`); e.champ = champ; throw e; };
const text = (v, champ, max, required = false) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (required && !t) fail(champ, 'à remplir');
  if (t.length > max) fail(champ, `trop long (${max} caractères au plus)`);
  return t;
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (t) => ISO.test(t) && new Date(`${t}T12:00:00Z`).toISOString().slice(0, 10) === t;
export const nextMois = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };
const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
// Client names are matched to the invoices' client names: accents and case do not matter.
export const key = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export const empty = () => ({ apporteurs: [], clients: [], versements: [] });
const copy = (d) => JSON.parse(JSON.stringify({ ...empty(), ...(d || {}) }));
const newId = (list) => String(list.reduce((n, x) => Math.max(n, Number(x.id) || 0), 0) + 1);

// ---- Writes (all or nothing).
export function ajouterApporteur(fields, data, todayIso) {
  const d = copy(data);
  if (d.apporteurs.length >= MAX_APPORTEURS) fail('Apporteurs', `${MAX_APPORTEURS} au plus`);
  const nom = text(fields.nom, 'Nom', 60, true);
  if (d.apporteurs.some((a) => key(a.nom) === key(nom))) fail('Nom', 'déjà dans la liste');
  const parrain = String(fields.parrain || '');
  if (parrain && !d.apporteurs.some((a) => a.id === parrain)) fail('Parrain', 'inconnu');
  // Chains are allowed (A presents B who presents C): on a client, only its apporteur and that apporteur's own
  // parrain are paid (never the parrain's parrain), so the 25 % cap holds whatever the depth.
  const a = { id: newId(d.apporteurs), nom, contact: text(fields.contact, 'Contact', 80), parrain: parrain || null, depuis: String(todayIso).slice(0, 10), actif: true, contrat: fields.contrat === '1', token: randomBytes(16).toString('hex') };
  if (fields.taux) { if (!SPECIAUX[fields.taux]) fail('Taux', 'inconnu'); if (parrain) fail('Taux', 'un taux particulier ne se combine pas avec un parrain'); a.taux = fields.taux; }
  // Shared objective (Les Zaff and its associate): the boutiques of both count for the same goal.
  const avec = String(fields.objectif_avec || '');
  if (avec) {
    const owner = d.apporteurs.find((x) => x.id === avec) || fail('Objectif commun', 'apporteur inconnu');
    if (!owner.objectif) fail('Objectif commun', `${owner.nom} n’a pas d’objectif`);
    a.objectifDe = avec;
  }
  const objectif = avec ? '' : String(fields.objectif_clients || '').trim();
  if (objectif) {
    const n = Number(objectif); if (!Number.isInteger(n) || n < 1 || n > 99) fail('Objectif', 'un nombre de 1 à 99');
    const avant = String(fields.objectif_avant || '').trim(), offert = String(fields.offert_jusqua || '').trim();
    if (!isDate(avant)) fail('Objectif · date limite', 'choisis-la avec le calendrier');
    if (offert && !isDate(offert)) fail('Offert jusqu’au', 'choisis-la avec le calendrier');
    a.objectif = { clients: n, avant, offert_jusqua: offert || null };
  }
  d.apporteurs.push(a);
  return d;
}
// Pause: no commission from the month of the pause, no bonus; a paused apporteur is no longer counted as active.
export function modifierApporteur(fields, data, todayIso = null) {
  const d = copy(data); const a = d.apporteurs.find((x) => x.id === String(fields.id)) || fail('Apporteur', 'introuvable');
  if ('actif' in fields) {
    const actif = fields.actif === '1';
    if (!actif && a.actif) a.pause = String(todayIso || new Date().toISOString()).slice(0, 10);
    if (actif) delete a.pause;
    a.actif = actif;
  }
  if ('contrat' in fields) a.contrat = fields.contrat === '1';
  if ('contact' in fields) a.contact = text(fields.contact, 'Contact', 80);
  return d;
}
// A client (as named on the invoices) is brought by one apporteur, the first who presented them.
export function attribuerClient(fields, data, todayIso) {
  const d = copy(data);
  const nom = text(fields.client, 'Client', 80, true);
  const apporteur = d.apporteurs.find((x) => x.id === String(fields.apporteur)) || fail('Apporteur', 'choisis-le dans la liste');
  if (!apporteur.contrat) fail('Apporteur', 'contrat pas encore signé : aucune commission avant la signature');
  const already = d.clients.find((c) => key(c.nom) === key(nom));
  if (already) fail('Client', `déjà apporté par ${d.apporteurs.find((x) => x.id === already.apporteur)?.nom || 'un autre apporteur'} (un client = un seul apporteur)`);
  const depuis = String(fields.depuis || todayIso).slice(0, 10);
  if (!isDate(depuis) || depuis > String(todayIso).slice(0, 10)) fail('Apporté le', 'date impossible ou dans le futur');
  d.clients.push({ nom, apporteur: apporteur.id, depuis });
  return d;
}
export function retirerClient(fields, data) {
  const d = copy(data); const i = d.clients.findIndex((c) => key(c.nom) === key(fields.client));
  if (i < 0) fail('Client', 'introuvable');
  d.clients.splice(i, 1); return d;
}
export function verser(fields, data, todayIso) {
  const d = copy(data); const a = d.apporteurs.find((x) => x.id === String(fields.apporteur)) || fail('Apporteur', 'introuvable');
  const t = String(fields.montant ?? '').replace(/[\s  €]/g, '').replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t) || Number(t) <= 0) fail('Montant', 'exemple : 87 ou 162,25');
  const mode = MODES.some(([k]) => k === fields.mode) ? fields.mode : fail('Mode', 'avoir ou virement');
  const date = String(fields.date || todayIso).slice(0, 10);
  if (!isDate(date) || date > String(todayIso).slice(0, 10)) fail('Date', 'date impossible ou dans le futur');
  d.versements.push({ id: newId(d.versements), apporteur: a.id, montant: Math.round(Number(t) * 100), mode, date, note: text(fields.note, 'Note', 80) });
  return d;
}
export function annulerVersement(fields, data) {
  const d = copy(data); const i = d.versements.findIndex((v) => v.id === String(fields.id));
  if (i < 0) fail('Versement', 'introuvable');
  d.versements.splice(i, 1); return d;
}

// ---- Computation from the invoices. Only the subscription lines (« Abonnement … ») of the client's Vendix
// invoices count, never the creation, options or advice. A line per paid invoice, dated the month of the cash
// (due the month after); rate by the client's year counted from their FIRST subscription payment. A refund
// (credit note on a paid invoice) gives back exactly what was earned, dated the month of the credit note.
export const estAbonnement = (l) => /^\s*abonnement/i.test(l.designation || '');
export const baseAbonnement = (f) => (f.activite === 'bic' && Array.isArray(f.lignes) ? f.lignes.filter(estAbonnement).reduce((n, l) => n + (Number.isSafeInteger(l.total) ? l.total : 0), 0) : 0);
const pts = (cents, points) => Math.round((cents * points) / 100);
export function lignes(data, factures) {
  const d = copy(data); const byKey = new Map(d.clients.map((c) => [key(c.nom), c]));
  const app = Object.fromEntries(d.apporteurs.map((a) => [a.id, a]));
  const paid = (factures && Array.isArray(factures.factures) ? factures.factures : []).filter((f) => f.payee && f.client && baseAbonnement(f) > 0);
  // First subscription payment per client (year 1 starts there), among the attributed clients.
  const first = {};
  for (const f of paid) { const k = key(f.client.nom); if (byKey.has(k)) { const m = moisDe(f.payee.date); if (!first[k] || m < first[k]) first[k] = m; } }
  // An apporteur earns only with a signed contract, from the month he was added, and not from the month of a pause.
  const gagne = (a, mois) => a && a.contrat && moisDe(a.depuis) <= mois && !(a.pause && moisDe(a.pause) <= mois);
  const out = [];
  for (const f of paid) {
    const k = key(f.client.nom); const c = byKey.get(k); if (!c || !app[c.apporteur]) continue;
    const a = app[c.apporteur]; const mois = moisDe(f.payee.date), base = baseAbonnement(f);
    if (mois < moisDe(c.depuis)) continue; // nothing before the client was brought (no retroactive commission)
    const annee = Math.max(0, Math.floor(monthsBetween(first[k], mois) / 12));
    const push = (id, taux, role) => { if (gagne(app[id], mois)) out.push({ mois, apporteur: id, client: c.nom, numero: f.numero, base, taux, role, avoir: f.avoir ? moisDe(f.avoir.date) : null }); };
    if (a.parrain && app[a.parrain]) { push(a.id, tauxDe(TAUX.second, annee), 'second'); push(a.parrain, tauxDe(TAUX.parrain, annee), 'parrain'); }
    else push(a.id, tauxDe(a.taux && SPECIAUX[a.taux] ? SPECIAUX[a.taux] : TAUX.direct, annee), 'direct');
  }
  // Bonus of a month: with ≥ 3 apporteurs active THAT month, the one(s) with the most clients whose first payment is
  // in that month get +5 points on their lines of that month (shared on a tie). Never on parrain lines.
  const months = [...new Set(out.map((l) => l.mois))];
  for (const mois of months) {
    const actifs = d.apporteurs.filter((a) => a.contrat && moisDe(a.depuis) <= mois && !(a.pause && moisDe(a.pause) <= mois));
    if (actifs.length < BONUS_MIN_APPORTEURS) continue;
    const counts = {};
    for (const [k, m] of Object.entries(first)) if (m === mois) { const c = byKey.get(k); const a = app[c.apporteur]; if (a && gagne(a, mois)) counts[c.apporteur] = (counts[c.apporteur] || 0) + 1; }
    if (!Object.keys(counts).length) continue;
    const max = Math.max(...Object.values(counts)); const winners = Object.keys(counts).filter((x) => counts[x] === max);
    for (const l of out) if (l.mois === mois && l.role !== 'parrain' && winners.includes(l.apporteur)) l.bonus = BONUS_POINTS / winners.length;
  }
  // No start bonus (27/10, Sam: the « 1er mois doublé » scares a client who may stay one month; removed from the contracts).
  for (const l of out) { l.points = l.taux + (l.bonus || 0); l.montant = pts(l.base, l.points); l.due = nextMois(l.mois); }
  // Refunds: the exact amount earned, given back in the month of the credit note.
  const refunds = out.filter((l) => l.avoir).map((l) => ({ ...l, mois: l.avoir, base: -l.base, montant: -l.montant, due: nextMois(l.avoir), avoir: null, rembourse: true }));
  return [...out, ...refunds].sort((x, y) => (x.mois < y.mois ? -1 : x.mois > y.mois ? 1 : 0));
}

// Per apporteur: due so far (lines whose « due » month has come), paid, balance, clients, objective, rank.
export function resume(data, factures, todayIso) {
  const d = copy(data); const today = String(todayIso).slice(0, 10), moisCourant = moisDe(today);
  const all = lignes(d, factures);
  const invoicesByClient = {};
  for (const f of (factures && Array.isArray(factures.factures) ? factures.factures : [])) if (f.client) (invoicesByClient[key(f.client.nom)] = invoicesByClient[key(f.client.nom)] || []).push(f);
  const apporteurs = d.apporteurs.map((a) => {
    const mine = all.filter((l) => l.apporteur === a.id);
    const du = mine.filter((l) => l.due <= moisCourant).reduce((n, l) => n + l.montant, 0);
    const ceMois = mine.filter((l) => l.due === moisCourant).reduce((n, l) => n + l.montant, 0);
    const aVenir = mine.filter((l) => l.due > moisCourant).reduce((n, l) => n + l.montant, 0);
    const verse = d.versements.filter((v) => v.apporteur === a.id).reduce((n, v) => n + v.montant, 0);
    const clients = d.clients.filter((c) => c.apporteur === a.id).map((c) => {
      const inv = (invoicesByClient[key(c.nom)] || []).filter((f) => !f.avoir && baseAbonnement(f) > 0);
      const payes = inv.filter((f) => f.payee), ouvertes = inv.filter((f) => !f.payee);
      const premier = payes.map((f) => f.payee.date).sort()[0] || null;
      return { nom: c.nom, depuis: c.depuis, premierPaiement: premier, payees: payes.length, enAttente: ouvertes.length, enRetard: ouvertes.filter((f) => f.echeance < today).length, dernier: payes.map((f) => f.payee.date).sort().at(-1) || null };
    });
    const payants = clients.filter((c) => c.premierPaiement).length;
    let objectif = null;
    if (a.objectif) {
      const atteints = clients.filter((c) => c.premierPaiement && c.premierPaiement <= a.objectif.avant).length;
      objectif = { ...a.objectif, atteints, ok: atteints >= a.objectif.clients, depasse: today > a.objectif.avant && atteints < a.objectif.clients };
    }
    return { ...a, du, ceMois, aVenir, verse, solde: du - verse, clients, payants, objectif, versements: d.versements.filter((v) => v.apporteur === a.id) };
  });
  // Shared objectives: the partners' boutiques count too, and each partner sees the same goal.
  for (const a of apporteurs) {
    if (!a.objectif) continue;
    const team = apporteurs.filter((b) => b.objectifDe === a.id);
    if (!team.length) continue;
    const atteints = [a, ...team].reduce((n, b) => n + b.clients.filter((c) => c.premierPaiement && c.premierPaiement <= a.objectif.avant).length, 0);
    a.objectif = { ...a.objectif, atteints, ok: atteints >= a.objectif.clients, depasse: today > a.objectif.avant && atteints < a.objectif.clients, commun: true };
    for (const b of team) b.objectif = { ...a.objectif };
  }
  // Rank: paying clients brought (direct), then cash brought. Only ranks and counts are ever shown to others.
  const rank = [...apporteurs].filter((a) => a.actif).sort((x, y) => y.payants - x.payants);
  for (const a of apporteurs) a.rang = a.actif ? rank.findIndex((r) => r.payants === a.payants) + 1 : null; // ex æquo share a rank
  return {
    apporteurs, moisCourant, bonusActif: apporteurs.filter((a) => a.actif).length >= BONUS_MIN_APPORTEURS,
    aVerserCeMois: apporteurs.reduce((n, a) => n + Math.max(0, a.solde), 0), nbClients: d.clients.length,
    classement: rank.map((a) => ({ id: a.id, nom: a.nom, payants: a.payants, rang: a.rang })),
  };
}

// The monthly statement Sam sends to one apporteur (WhatsApp / Telegram): his clients, paid or not, his money.
// Nothing about the others but their rank and count of clients.
const eur = (c) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(c / 100);
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const nomMois = (m) => `${MOIS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export function releve(data, factures, apporteurId, todayIso) {
  const r = resume(data, factures, todayIso); const a = r.apporteurs.find((x) => x.id === String(apporteurId)) || fail('Apporteur', 'introuvable');
  const all = lignes(data, factures).filter((l) => l.apporteur === a.id);
  const mois = r.moisCourant, prev = all.filter((l) => l.due === mois);
  const lines = [`Relevé ${nomMois(mois)} — ${a.nom}`, ''];
  lines.push(`Tes boutiques (${a.clients.length}) :`);
  for (const c of a.clients) lines.push(`• ${c.nom} — ${c.premierPaiement ? `${c.payees} mois payé${c.payees > 1 ? 's' : ''}` : 'pas encore payé'}${c.enRetard ? ` · ${c.enRetard} en retard` : c.enAttente ? ` · ${c.enAttente} en attente` : ''}`);
  if (!a.clients.length) lines.push('• aucune pour l’instant');
  lines.push('', `Commission du mois (sur les encaissements de ${nomMois(prev[0] ? prev[0].mois : mois)}) : ${eur(a.ceMois)}`);
  for (const l of prev) lines.push(`• ${l.client} : ${l.rembourse ? `remboursement, ${eur(l.montant)}` : `${eur(l.base)} × ${String(l.points).replace('.', ',')} % = ${eur(l.montant)}${l.bonus ? ' (dont bonus n°1 du mois)' : ''}`}`);
  lines.push(`Total dû à ce jour : ${eur(a.du)} · déjà versé : ${eur(a.verse)} · ${a.solde < 0 ? `trop versé : ${eur(-a.solde)} (déduit du prochain)` : `reste : ${eur(a.solde)}`}`);
  if (a.objectif) lines.push('', `Objectif : ${a.objectif.atteints}/${a.objectif.clients} boutiques payantes avant le ${a.objectif.avant.split('-').reverse().join('/')} ${a.objectif.ok ? '✅' : a.objectif.depasse ? '— échéance passée' : ''}`);
  if (r.bonusActif) lines.push('', `Classement (boutiques payantes) : tu es n°${a.rang} sur ${r.classement.length} (${a.payants} boutique${a.payants > 1 ? 's' : ''} payante${a.payants > 1 ? 's' : ''}).`);
  return lines.join('\n');
}

// Bot: from the 1st to the 7th, once per month, a count only.
export function rappelsApporteurs(data, factures, todayIso) {
  const today = String(todayIso).slice(0, 10); if (Number(today.slice(8, 10)) > 7) return [];
  const r = resume(data, factures, today); const n = r.apporteurs.filter((a) => a.solde > 0).length;
  return n ? [{ cause: `apporteurs:${r.moisCourant}`, text: `🤝 ${n === 1 ? 'Un apporteur attend sa commission' : `${n} apporteurs attendent leur commission`} ce mois-ci. Les relevés sont prêts dans ton Cockpit › Apporteurs.` }] : [];
}

// Public code of an apporteur (his referral link on the Vendix demo site): one-way from the private token.
export const codeOf = (token) => (/^[0-9a-f]{32}$/.test(token || '') ? createHash('sha256').update(token).digest('hex').slice(0, 8) : '');
// Every apporteur has a private link token (older files: added here).
export function avecJetons(data) {
  const d = copy(data); let changed = false;
  for (const a of d.apporteurs) if (!/^[0-9a-f]{32}$/.test(a.token || '')) { a.token = randomBytes(16).toString('hex'); changed = true; }
  return { data: d, changed };
}
export function nouveauJeton(fields, data) {
  const d = copy(data); const a = d.apporteurs.find((x) => x.id === String(fields.id)) || fail('Apporteur', 'introuvable');
  a.token = randomBytes(16).toString('hex'); return d;
}

// What the online dashboard receives (src/web/apporteurs.py of the Vendix demo site): one entry per active apporteur,
// his clients and money only, the ranking with names and counts. No amount of anyone else, no client of anyone else.
const dfr = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
export function exportPublic(data, factures, todayIso) {
  const r = resume(data, factures, todayIso); const all = lignes(data, factures);
  const classement = r.classement.map((c) => ({ nom: c.nom, payants: c.payants, id: c.id }));
  const nbActifs = r.apporteurs.filter((a) => a.actif).length;
  return {
    maj: `${dfr(todayIso)}`,
    apporteurs: r.apporteurs.filter((a) => a.actif && /^[0-9a-f]{32}$/.test(a.token || '')).map((a) => ({
      token: a.token, code: codeOf(a.token), nom: a.nom, rang: a.rang, nbActifs, bonusActif: r.bonusActif,
      ceMois: a.ceMois, ceMoisTxt: eur(a.ceMois), du: a.du, duTxt: eur(a.du), verse: a.verse, verseTxt: eur(a.verse), solde: a.solde, soldeTxt: eur(Math.abs(a.solde)),
      moisTxt: nomMois(r.moisCourant),
      objectif: a.objectif ? { clients: a.objectif.clients, atteints: a.objectif.atteints, avantTxt: dfr(a.objectif.avant), offertTxt: dfr(a.objectif.offert_jusqua), ok: a.objectif.ok, depasse: a.objectif.depasse } : null,
      clients: a.clients.map((c) => ({ nom: c.nom, payes: c.payees, enAttente: c.enAttente, enRetard: c.enRetard, dernierTxt: dfr(c.dernier) })),
      lignes: all.filter((l) => l.apporteur === a.id && l.due === r.moisCourant).map((l) => ({ client: l.client, baseTxt: eur(l.base), pointsTxt: String(l.points).replace('.', ','), montantTxt: eur(l.montant), bonus: !!l.bonus, rembourse: !!l.rembourse })),
      versements: a.versements.map((v) => ({ dateTxt: dfr(v.date), montantTxt: eur(v.montant), mode: v.mode })),
      classement: classement.map((c) => ({ nom: c.nom, payants: c.payants, moi: c.id === a.id })),
    })),
  };
}
