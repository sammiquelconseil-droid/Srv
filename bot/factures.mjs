// « 🧾 Factures » : Sam's invoices (Vendix, advice), numbered without gaps, as PDF, and « payée » in one tap. Paid
// invoices are counted by « Ma micro-entreprise » at display time (encaissements), never copied into micro.json:
// no double counting, no stale form overwriting them. Pure, tested code (rule 6). Level 3 data: server only
// (STATE/data/factures.json), never in git, never in Telegram (the bot only says how many invoices are late).
// An invoice is never deleted nor changed once issued (sequential numbering): a mistake is cancelled by a credit note.
import { Page, buildPdf, wrap } from './pdf.mjs';
import { ACTIVITES, euros, moisDe } from './micro.mjs';

// Mentions (third-party guides concordant, official pages unreachable from the session on 27/10/2026: « a_verifier »).
// The move of VAT into the CIBS was postponed to 01/01/2027 (ordonnance n° 2026-671, art. 17, per several secondary
// sources) and the CIBS article number is not settled (L. 223-3 or L. 233-3): « 293 B du CGI » stays, admitted
// afterwards too. Each invoice keeps a copy of the mentions it was issued with (an issued invoice never changes).
export const MENTIONS = {
  tva: { texte: 'TVA non applicable, art. 293 B du CGI', statut: 'a_verifier' },
  retardPro: 'En cas de retard de paiement : pénalités au taux de trois fois le taux d’intérêt légal et indemnité forfaitaire pour frais de recouvrement de 40 € (art. L. 441-10 et D. 441-5 du code de commerce).',
  escompte: 'Pas d’escompte pour paiement anticipé.',
  categorie: 'Catégorie de l’opération : prestation de services.',
  statut: 'a_verifier',
};
export const ECHEANCES = [['0', 'À réception'], ['15', 'Sous 15 jours'], ['30', 'Sous 30 jours']];
export const LIGNES = 5;
// Ready-made wordings (Vendix offers, Les Zaff OFFRES.md): suggestions only, Sam types the price.
export const SUGGESTIONS = [
  ...['Boutique', 'Croissance', 'Premium', 'Max'].map((f) => `Abonnement Vendix, formule ${f}, mois de `),
  ...['Boutique', 'Croissance', 'Premium', 'Max'].map((f) => `Création de la boutique, formule ${f} (offerte)`),
  'Option Vendix : ', 'Conseil en automatisation, ', 'Apport d’affaires : ',
];
const DEBUT_ACTIVITE = '2026-10-13';

const fail = (champ, raison) => { const e = new Error(`${champ} : ${raison}`); e.champ = champ; throw e; };
const clean = (v, max, champ, required = false) => {
  const t = String(v ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  if (required && !t) fail(champ, 'à remplir');
  if (t.length > max) fail(champ, `trop long (${max} caractères au plus)`);
  return t;
};
// SIREN (9) and SIRET (14) end with a Luhn check digit: catches a mistyped number.
export function luhn(d) {
  let s = 0;
  for (let i = 0; i < d.length; i++) { let n = Number(d[d.length - 1 - i]); if (i % 2) { n *= 2; if (n > 9) n -= 9; } s += n; }
  return s % 10 === 0;
}
const digits = (v) => String(v ?? '').replace(/[\s.]/g, '');
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export const empty = () => ({ emetteur: null, compteurs: {}, factures: [] });
const copy = (d) => JSON.parse(JSON.stringify({ ...empty(), ...(d || {}) }));

export function parseEmetteur(fields, data) {
  const siret = digits(fields.siret);
  if (!/^\d{14}$/.test(siret) || !luhn(siret)) fail('SIRET', '14 chiffres, tel qu’écrit sur ton avis de situation (un chiffre a peut-être été mal tapé)');
  const email = clean(fields.email, 120, 'E-mail');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('E-mail', 'adresse invalide');
  const adresse = clean(fields.adresse, 200, 'Adresse', true);
  if (adresse.split('\n').length > 3) fail('Adresse', '3 lignes au plus');
  const next = copy(data);
  next.emetteur = {
    nom: clean(fields.nom, 80, 'Ton nom', true), commercial: clean(fields.commercial, 60, 'Nom commercial'),
    adresse, siret, email, paiement: clean(fields.paiement, 200, 'Comment te payer', true),
    rcs: clean(fields.rcs, 60, 'Immatriculation'),
  };
  return next;
}

// A new invoice: numbered F<year>-<001…> in date order, never reused. All or nothing.
export function parseFacture(fields, data, todayIso) {
  const d = copy(data);
  if (!d.emetteur) fail('Tes coordonnées', 'remplis-les d’abord (en bas de la page)');
  const envoi = String(fields.envoi || '').slice(0, 40);
  if (envoi && (d.envois || []).includes(envoi)) fail('Facture', 'déjà créée (bouton touché deux fois) : regarde la liste plus bas');
  const date = String(todayIso).slice(0, 10);
  const activite = ACTIVITES.find(([k]) => k === fields.activite);
  if (!activite) fail('Activité', 'choisis Vendix ou conseil');
  if (date < `${activite[3]}-01`) fail('Activité', `${activite[1]} commence en ${activite[3] === '2026-11' ? 'novembre 2026' : 'octobre 2026'}`);
  const siren = digits(fields.client_siren);
  if (siren && (!/^\d{9}$/.test(siren) || !luhn(siren))) fail('SIREN du client', '9 chiffres (un chiffre a peut-être été mal tapé)');
  const client = { nom: clean(fields.client_nom, 80, 'Nom du client', true), adresse: clean(fields.client_adresse, 200, 'Adresse du client', true), siren, pro: fields.client_pro === '1' };
  if (client.adresse.split('\n').length > 3) fail('Adresse du client', '3 lignes au plus');
  const lignes = [];
  for (let i = 1; i <= LIGNES; i++) {
    const designation = clean(fields[`l${i}_designation`], 120, `Ligne ${i}`);
    const pu = String(fields[`l${i}_pu`] ?? '').trim();
    if (!designation && !pu) continue;
    if (!designation) fail(`Ligne ${i}`, 'écris ce que tu factures');
    const qte = String(fields[`l${i}_qte`] ?? '').trim() === '' ? 1 : Number(fields[`l${i}_qte`]);
    if (!Number.isInteger(qte) || qte < 1 || qte > 999) fail(`Ligne ${i} · quantité`, 'un nombre entier de 1 à 999');
    if (!pu) fail(`Ligne ${i} · prix`, 'à remplir (0 pour une ligne offerte)');
    const prix = euros(pu, `Ligne ${i} · prix`);
    lignes.push({ designation, qte, pu: prix, total: prix * qte });
  }
  if (!lignes.length) fail('Lignes', 'écris au moins une ligne');
  const total = lignes.reduce((n, l) => n + l.total, 0);
  if (!total) fail('Total', 'une facture à 0 € ne sert à rien');
  if (total > 10_000_000) fail('Total', 'plus de 100 000 € : vérifie les montants');
  const jours = ECHEANCES.find(([k]) => k === String(fields.echeance))?.[0];
  if (jours === undefined) fail('Échéance', 'choisis une date de paiement');
  const year = date.slice(0, 4), n = (d.compteurs[year] || 0) + 1;
  const last = d.factures.filter((f) => f.numero.startsWith(`F${year}`)).at(-1);
  if (last && last.date > date) fail('Date', 'une facture plus récente existe déjà : vérifie la date du serveur');
  const facture = {
    numero: `F${year}-${String(n).padStart(3, '0')}`, date, activite: activite[0], client,
    periode: clean(fields.periode, 60, 'Période ou date de la prestation', true), lignes, total,
    echeance: addDays(date, Number(jours)), payee: null, avoir: null,
    // Frozen at issue: the PDF of this invoice stays identical for 10 years, whatever changes later.
    emetteur: { ...d.emetteur }, mentions: { tva: MENTIONS.tva.texte, retardPro: MENTIONS.retardPro, escompte: MENTIONS.escompte, categorie: MENTIONS.categorie },
  };
  d.compteurs[year] = n; d.factures.push(facture);
  if (envoi) d.envois = [...(d.envois || []), envoi].slice(-50);
  return { data: d, facture };
}

const find = (d, numero) => d.factures.find((f) => f.numero === numero) || fail('Facture', 'introuvable');

// Credit note: cancels an invoice entirely (A<year>-<001…>, its own sequence). The invoice stays, marked cancelled.
// Already paid: Sam refunds the client; the refund is taken off the turnover in the month of the credit note.
export function annuler(data, numero, todayIso) {
  const d = copy(data); const f = find(d, numero);
  if (f.avoir) fail('Facture', 'déjà annulée');
  const date = String(todayIso).slice(0, 10), year = date.slice(0, 4), key = `A${year}`, n = (d.compteurs[key] || 0) + 1;
  f.avoir = { numero: `A${year}-${String(n).padStart(3, '0')}`, date };
  d.compteurs[key] = n;
  return d;
}

// Paid: the amount goes to « Ma micro-entreprise », month of the payment, line of the activity.
export function payer(data, numero, dateIso, todayIso) {
  const d = copy(data); const f = find(d, numero);
  if (f.avoir) fail('Facture', 'annulée par un avoir');
  if (f.payee) fail('Facture', 'déjà marquée payée');
  const date = String(dateIso || todayIso).slice(0, 10), today = String(todayIso).slice(0, 10);
  if (!ISO_RE.test(date) || Number.isNaN(Date.parse(date)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) fail('Date du paiement', 'date invalide');
  if (date > today) fail('Date du paiement', 'pas dans le futur');
  if (date < DEBUT_ACTIVITE) fail('Date du paiement', 'avant le début de ton activité');
  const act = ACTIVITES.find(([k]) => k === f.activite);
  if (date < `${act[3]}-01`) fail('Date du paiement', `${act[1]} commence en novembre 2026`);
  f.payee = { date };
  return d;
}
// A payment marked by mistake (not a refund: that is a credit note).
export function retirerPaiement(data, numero) {
  const d = copy(data); const f = find(d, numero);
  if (!f.payee) fail('Facture', 'pas marquée payée');
  if (f.avoir) fail('Facture', 'annulée par un avoir après paiement : le remboursement est déjà compté');
  f.payee = null;
  return d;
}
// Cash received per month and activity (micro-entreprise counts at receipt): + on the payment's month,
// − on the credit note's month when a paid invoice was cancelled (refund).
export function encaissements(data) {
  const mois = {};
  const add = (m, k, v) => { mois[m] = mois[m] || {}; mois[m][k] = (mois[m][k] || 0) + v; };
  for (const f of (data && Array.isArray(data.factures) ? data.factures : [])) {
    if (!f.payee || !Number.isSafeInteger(f.total)) continue;
    add(moisDe(f.payee.date), f.activite, f.total);
    if (f.avoir) add(moisDe(f.avoir.date), f.activite, -f.total);
  }
  return { mois };
}

export function resumeFactures(data, todayIso) {
  const list = ((data && data.factures) || []).filter((f) => !f.avoir);
  const ouvertes = list.filter((f) => !f.payee);
  return {
    aEncaisser: ouvertes.reduce((n, f) => n + f.total, 0), nbOuvertes: ouvertes.length,
    enRetard: ouvertes.filter((f) => f.echeance < String(todayIso).slice(0, 10)).map((f) => f.numero),
  };
}
// Bot: one message per late invoice, no name, no amount (Telegram is not end-to-end encrypted).
// One message for all late invoices (sent again only when the list changes).
export function rappelsFactures(data, todayIso) {
  const l = resumeFactures(data, todayIso).enRetard;
  if (!l.length) return [];
  return [{ cause: `factures:retard:${l.join(',')}`, text: `🧾 ${l.length === 1 ? 'Une de tes factures n’est pas payée' : `${l.length} de tes factures ne sont pas payées`} et la date limite est passée. Le détail est dans ton Cockpit › Factures.` }];
}

// ---- PDF (A4). Voice of Sam: nothing names a tool (REGLES-COMMUNES §G).
const eur = (c) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(c / 100);
const dateFr = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
export function pdfFacture(data, numero, { avoir = false } = {}) {
  const d = copy(data); const f = find(d, numero);
  const e = f.emetteur || d.emetteur; const M = f.mentions || { tva: MENTIONS.tva.texte, retardPro: MENTIONS.retardPro, escompte: MENTIONS.escompte, categorie: MENTIONS.categorie };
  if (avoir && !f.avoir) fail('Avoir', 'cette facture n’est pas annulée');
  const sign = avoir ? -1 : 1;
  const p = new Page(); const L = 50, R = 545;
  const who = e.commercial ? `${e.nom} EI — ${e.commercial}` : `${e.nom} EI`;
  // Left: Sam (up to x = 320); right: title and dates. Long texts wrap instead of running into each other.
  let y = 790;
  for (const r of wrap(who, 14, 265, true)) { p.text(L, y, r, { size: 14, bold: true }); y -= 17; }
  y -= 1;
  const left = [...e.adresse.split('\n'), `SIRET ${e.siret.replace(/^(\d{3})(\d{3})(\d{3})(\d{5})$/, '$1 $2 $3 $4')}`, ...(e.rcs ? [e.rcs] : []), ...(e.email ? [e.email] : [])];
  for (const t of left) for (const r of wrap(t, 9.5, 265)) { p.text(L, y, r, { size: 9.5 }); y -= 12; }
  const titre = avoir ? `AVOIR n° ${f.avoir.numero}` : `FACTURE n° ${f.numero}`;
  p.text(R, 790, titre, { size: 15, bold: true, align: 'right' });
  let ry = 772;
  p.text(R, ry, `Date : ${dateFr(avoir ? f.avoir.date : f.date)}`, { size: 9.5, align: 'right' });
  if (avoir) for (const r of wrap(`Annule la facture n° ${f.numero} du ${dateFr(f.date)}${f.payee ? ', payée le ' + dateFr(f.payee.date) : ''}`, 9.5, 200)) { ry -= 12; p.text(R, ry, r, { size: 9.5, align: 'right' }); }
  y = Math.min(y, ry) - 16;
  const client = [...wrap(f.client.nom, 10.5, 225, true).map((t) => [t, true]), ...f.client.adresse.split('\n').flatMap((l) => wrap(l, 9.5, 225)).map((t) => [t, false]), ...(f.client.siren ? [[`SIREN ${f.client.siren.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3')}`, false]] : [])];
  const h = 26 + client.length * 12.5;
  p.box(300, y - h + 12, 245, h, 0.95);
  p.text(310, y - 2, 'Client', { size: 8.5, gray: 0.4 });
  let cy = y - 4;
  for (const [t, b] of client) { cy -= 12.5; p.text(310, cy, t, { size: b ? 10.5 : 9.5, bold: b }); }
  y = y - h - 8;
  for (const r of wrap(`Prestation : ${f.periode}`, 10, R - L)) { p.text(L, y, r, { size: 10 }); y -= 13; }
  y -= 11;
  p.box(L, y - 6, R - L, 20, 0.9);
  p.text(L + 6, y, 'Désignation', { size: 9, bold: true }); p.text(360, y, 'Qté', { size: 9, bold: true, align: 'right' });
  p.text(455, y, 'Prix unitaire', { size: 9, bold: true, align: 'right' }); p.text(R - 6, y, 'Total', { size: 9, bold: true, align: 'right' });
  y -= 22;
  for (const l of f.lignes) {
    p.text(360, y, String(l.qte), { size: 9.5, align: 'right' }); p.text(455, y, eur(sign * l.pu), { size: 9.5, align: 'right' }); p.text(R - 6, y, eur(sign * l.total), { size: 9.5, align: 'right' });
    for (const r of wrap(l.designation, 9.5, 270)) { p.text(L + 6, y, r, { size: 9.5 }); y -= 13; }
    p.line(L, y + 8, R, y + 8, 0.3); y -= 8;
  }
  y -= 8;
  p.text(430, y, avoir ? 'Total de l’avoir' : 'Total à payer', { size: 11, bold: true, align: 'right' }); p.text(R - 6, y, eur(sign * f.total), { size: 11, bold: true, align: 'right' });
  y -= 15; p.text(R - 6, y, M.tva, { size: 8.5, align: 'right' });
  y -= 30;
  const bloc = [];
  if (!avoir) {
    bloc.push(f.echeance === f.date ? `Paiement : à réception de la facture (${dateFr(f.date)}).` : `Paiement : au plus tard le ${dateFr(f.echeance)}.`);
    bloc.push(e.paiement);
    if (f.payee) bloc.push(`Duplicata acquitté : payée le ${dateFr(f.payee.date)}.`);
    bloc.push(M.escompte);
    if (f.client.pro) bloc.push(M.retardPro);
  } else bloc.push(f.payee ? 'Cette facture est annulée : la somme payée est remboursée.' : 'Cette facture est annulée : aucun paiement n’est dû à ce titre.');
  bloc.push(M.categorie);
  for (const t of bloc) { for (const r of wrap(t, 9, R - L)) { p.text(L, y, r, { size: 9 }); y -= 12; } y -= 4; }
  for (const [i, r] of wrap(`${who} · SIRET ${e.siret}`, 7.5, 400).slice(0, 2).entries()) p.text(L, 40 - i * 9, r, { size: 7.5, gray: 0.45 });
  p.text(R, 40, avoir ? f.avoir.numero : f.numero, { size: 7.5, gray: 0.45, align: 'right' });
  return buildPdf([p], { title: avoir ? `Avoir ${f.avoir.numero}` : `Facture ${f.numero}`, author: e.commercial || e.nom });
}
