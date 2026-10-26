// The dossier (biens, crédits, loyers, revenus, abonnements) lives ONLY on the server, in STATE/data/situation.json,
// never in a git repository (REGLES-COMMUNES §N, décision C-094). This module turns the « Dossier » form into a
// validated dossier, all or nothing, and writes it atomically. Amounts are cents; money maths stay tested code.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

export const STATUTS = ['declare', 'verifie', 'estime', 'hypothese'];
const KEPT_STATUTS = [...STATUTS, 'a_saisir']; // accepted when they come back from the file unchanged
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BIENS = 12, MAX_LOYERS = 6, MAX_ALERTES = 5, ALERTE_LEN = 200, MAX_ABOS = 20, MAX_CHARGES = 40;
export const FREQUENCES = ['mois', 'an'];
export const EMPTY_NOTE = 'Dossier vide : à remplir sur la page Dossier.';

export const emptyDossier = () => ({ maj: null, note: EMPTY_NOTE, biens: [], revenus: { revenuFiscalReferenceCents: { statut: 'a_saisir' }, salaireNetMois: { statut: 'a_saisir' }, microEntreprise: {} }, abonnements: [], charges: [] });

// "1 650,50" -> 165050 ; '' -> null ; anything else throws.
export function parseEuros(input) {
  const t = String(input ?? '').replace(/[\s  €]/g, '').replace(',', '.');
  if (t === '') return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) throw new Error('montant invalide');
  return Math.round(Number(t) * 100);
}

const fail = (champ, raison) => { const e = new Error(`${champ} : ${raison}`); e.champ = champ; throw e; };
const filled = (v) => String(v ?? '').trim() !== '';
const text = (v, champ, max, { required = false } = {}) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (required && !t) fail(champ, 'à remplir');
  if (t.length > max) fail(champ, `trop long (${max} caractères maximum)`);
  return t;
};
const money = (v, champ, { required = false } = {}) => {
  let c; try { c = parseEuros(v); } catch { fail(champ, 'montant invalide (exemple : 1650 ou 1 650,50)'); }
  if (required && c === null) fail(champ, 'à remplir');
  return c;
};
const date = (v, champ, { required = false } = {}) => {
  const t = String(v ?? '').trim();
  if (!t) { if (required) fail(champ, 'date à remplir'); return null; }
  let ok = DATE_RE.test(t);
  if (ok) { try { ok = new Date(t + 'T00:00:00Z').toISOString().slice(0, 10) === t; } catch { ok = false; } }
  if (!ok) fail(champ, 'date impossible (choisis-la avec le calendrier)');
  return t;
};
const statut = (v, champ) => { const t = String(v ?? 'declare').trim() || 'declare'; if (!KEPT_STATUTS.includes(t)) fail(champ, 'statut inconnu'); return t; };
const integer = (v, champ, min, max) => { const t = String(v ?? '').trim(); if (!/^\d{1,4}$/.test(t)) fail(champ, `nombre entier attendu (${min} à ${max})`); const n = Number(t); if (n < min || n > max) fail(champ, `entre ${min} et ${max}`); return n; };

export const slug = (nom) => String(nom).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'bien';

const FIN_KEYS = ['fin.type', 'fin.capital', 'fin.mensualite', 'fin.premiere', 'fin.nombre', 'fin.signature', 'fin.paiement'];

// One bien from the fields prefixed `${p}.` ; `current` keeps the keys the form does not edit (hypotheses, notes…).
function parseBien(fields, p, current = {}, label = 'bien') {
  const f = (k) => fields[`${p}.${k}`];
  const nom = text(f('nom'), `${label} · nom du bien`, 60, { required: true });
  const b = { ...current, id: current.id || slug(nom), nom,
    type: text(f('type'), `${label} · type`, 40), situation: text(f('situation'), `${label} · situation`, 80),
    achat: { ...(current.achat || {}), date: date(f('achat.date'), `${label} · date d’achat`), prixCents: money(f('achat.prix'), `${label} · prix d’achat`) ?? 0,
      comptantCents: money(f('achat.comptant'), `${label} · payé comptant`) ?? 0, statut: statut(f('achat.statut'), `${label} · achat`) },
    loyers: [], alertes: [] };
  if (!FIN_KEYS.some((k) => filled(f(k)))) delete b.financement; // every credit box empty = no credit
  else {
    const capital = money(f('fin.capital'), `${label} · capital`), mensualite = money(f('fin.mensualite'), `${label} · mensualité`);
    if (!capital || !mensualite || !filled(f('fin.premiere'))) fail(`${label} · crédit`, 'remplis le capital, la mensualité et la première échéance (ou vide toutes les cases du crédit s’il n’y en a pas)');
    const nombre = integer(f('fin.nombre'), `${label} · nombre d’échéances`, 1, 600);
    const signature = money(f('fin.signature'), `${label} · versé à la signature`) ?? 0;
    // The last instalment absorbs rounding (src/schedules.mjs): accept a gap smaller than one instalment.
    if (capital - (signature + mensualite * nombre) >= mensualite) fail(`${label} · crédit`, `${nombre} mensualités de ${(mensualite / 100).toFixed(2).replace('.', ',')} € ne couvrent pas le capital : vérifie le capital, la mensualité et le nombre d’échéances`);
    b.financement = { ...(current.financement || {}), type: text(f('fin.type'), `${label} · type de crédit`, 60) || 'Crédit', capitalCents: capital, mensualiteCents: mensualite,
      premiereEcheance: date(f('fin.premiere'), `${label} · première échéance`, { required: true }), nombre, paiement: text(f('fin.paiement'), `${label} · comment tu paies`, 80),
      statut: statut(f('fin.statut'), `${label} · crédit`) };
    if (signature) b.financement.versementSignatureCents = signature; else delete b.financement.versementSignatureCents;
  }
  for (let i = 0; i < MAX_LOYERS; i++) {
    const nomL = `${label} · ${i ? `loyer n°${i + 1}` : 'loyer'}`;
    const lib = text(f(`loyer${i}.libelle`), nomL, 60), m = money(f(`loyer${i}.montant`), `${nomL} · montant`);
    if (!lib && m === null) continue;
    if (!lib || m === null) fail(nomL, 'remplis la case « Loyer » (qui paie) et son montant, ou vide les deux');
    b.loyers.push({ libelle: lib, montantCents: m, statut: statut(f(`loyer${i}.statut`), nomL) });
  }
  const alertes = String(f('alertes') || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (alertes.length > MAX_ALERTES) fail(`${label} · points de vigilance`, `${MAX_ALERTES} lignes maximum`);
  if (alertes.some((l) => l.length > ALERTE_LEN)) fail(`${label} · points de vigilance`, `${ALERTE_LEN} caractères maximum par ligne`);
  b.alertes = alertes;
  return b;
}

// Whole form -> whole dossier. Throws on the first invalid field (message names it); nothing is written then.
export function parseDossierForm(fields, current, todayIso) {
  const cur = current && Array.isArray(current.biens) ? current : emptyDossier();
  const byId = Object.fromEntries(cur.biens.filter((b) => b.id).map((b) => [b.id, b]));
  const biens = [];
  const seen = new Set();
  for (let i = 0; i < MAX_BIENS; i++) {
    if (!(`b${i}.nom` in fields)) continue;
    const id = String(fields[`b${i}.id`] || '');
    const b = parseBien(fields, `b${i}`, byId[id] || cur.biens[i] || {}, fields[`b${i}.nom`] || `bien n°${i + 1}`);
    if (seen.has(b.id)) fail(`${b.nom}`, 'deux biens ont le même identifiant');
    seen.add(b.id); biens.push(b);
  }
  const newTouched = Object.keys(fields).some((k) => k.startsWith('new.') && !k.endsWith('.statut') && filled(fields[k]));
  if (newTouched) {
    if (!filled(fields['new.nom'])) fail('nouveau bien · nom du bien', 'à remplir (ou vide toutes les cases de « Ajouter un bien »)');
    const b = parseBien(fields, 'new', {}, 'nouveau bien');
    let id = b.id, n = 2; while (seen.has(id)) id = `${b.id}-${n++}`;
    b.id = id; seen.add(id); biens.push(b);
  }
  if (biens.length > MAX_BIENS) fail('biens', `${MAX_BIENS} biens maximum`);
  const revenus = { ...cur.revenus };
  const rfr = money(fields.rfr, 'revenu fiscal de référence');
  const oldRfr = (cur.revenus && cur.revenus.revenuFiscalReferenceCents) || {};
  revenus.revenuFiscalReferenceCents = rfr === null ? { ...oldRfr, statut: 'a_saisir' } : { ...oldRfr, valeur: rfr, statut: statut(fields.rfrStatut, 'revenu fiscal de référence') };
  if (rfr === null) delete revenus.revenuFiscalReferenceCents.valeur;
  // Optional renewal date + notice (days) on a subscription or a fixed expense → reminders 30 and 7 days before.
  const renewal = (prefix, nom) => {
    const r = {};
    const d = date(fields[`${prefix}.renouv`], `« ${nom} » · date de renouvellement`);
    if (d) r.renouvellement = d;
    if (filled(fields[`${prefix}.preavis`])) r.preavisJours = integer(fields[`${prefix}.preavis`], `« ${nom} » · préavis (jours)`, 0, 365);
    return r;
  };
  const abonnements = [];
  for (let i = 0; i < MAX_ABOS; i++) {
    if (!(`a${i}.nom` in fields)) continue;
    const nom = text(fields[`a${i}.nom`], `abonnement n°${i + 1}`, 40);
    if (!nom) continue; // emptied = removed
    abonnements.push({ nom, montantCents: money(fields[`a${i}.montant`], `abonnement « ${nom} » · prix par mois`, { required: true }), statut: statut(fields[`a${i}.statut`], `abonnement « ${nom} »`), ...renewal(`a${i}`, nom) });
  }
  if (filled(fields['anew.nom']) || filled(fields['anew.montant'])) {
    const nom = text(fields['anew.nom'], 'ajouter un abonnement · nom', 40, { required: true });
    abonnements.push({ nom, montantCents: money(fields['anew.montant'], `abonnement « ${nom} » · prix par mois`, { required: true }), statut: statut(fields['anew.statut'], `abonnement « ${nom} »`), ...renewal('anew', nom) });
  }
  if (new Set(abonnements.map((a) => a.nom)).size !== abonnements.length) fail('abonnements', 'deux abonnements ont le même nom');
  // Fixed expenses (insurance, electricity, phone, taxes paid monthly…) : name, amount, per month or per year.
  const charges = [];
  const charge = (prefix, label) => {
    const nom = text(fields[`${prefix}.nom`], `${label} · nom`, 40, { required: true });
    const freq = String(fields[`${prefix}.freq`] || 'mois');
    if (!FREQUENCES.includes(freq)) fail(`dépense « ${nom} »`, 'fréquence inconnue');
    return { nom, montantCents: money(fields[`${prefix}.montant`], `dépense « ${nom} » · montant`, { required: true }), frequence: freq, ...renewal(prefix, nom) };
  };
  for (let i = 0; i < MAX_CHARGES; i++) {
    if (!(`c${i}.nom` in fields)) continue;
    if (!filled(fields[`c${i}.nom`]) && !filled(fields[`c${i}.montant`])) continue; // emptied = removed
    charges.push(charge(`c${i}`, `dépense n°${i + 1}`));
  }
  if (filled(fields['cnew.nom']) || filled(fields['cnew.montant'])) charges.push(charge('cnew', 'ajouter une dépense'));
  // « 📋 Coller une liste » : one line per item, « Abonnement|Dépense ; nom ; montant ; mois|an ; jj/mm/aaaa ; préavis ».
  // A name already in the list is UPDATED (that is how the list is brought up to date), never duplicated.
  String(fields.coller || '').split('\n').map((l) => l.trim()).filter(Boolean).forEach((line, n) => {
    const where = `ligne collée n°${n + 1}`;
    const parts = line.split(';').map((x) => x.trim());
    if (parts.length < 3) fail(where, 'il faut au moins « Abonnement ou Dépense ; nom ; montant »');
    const kind = parts[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const list = kind.startsWith('abo') ? abonnements : kind.startsWith('dep') ? charges : fail(where, 'commence par « Abonnement » ou « Dépense »');
    const nom = text(parts[1], `${where} · nom`, 40, { required: true });
    const montantCents = money(parts[2], `${where} · montant`, { required: true });
    const freq = (parts[3] || 'mois').toLowerCase() === 'an' ? 'an' : 'mois';
    let renouvellement;
    if (parts[4]) { const m = parts[4].match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (!m) fail(`${where} · date`, 'format jj/mm/aaaa'); renouvellement = date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, `${where} · date`); }
    const preavis = parts[5] ? integer(parts[5], `${where} · préavis`, 0, 365) : undefined;
    const item = list === abonnements ? { nom, montantCents, statut: 'declare' } : { nom, montantCents, frequence: freq };
    if (renouvellement) item.renouvellement = renouvellement;
    if (preavis !== undefined) item.preavisJours = preavis;
    const i = list.findIndex((x) => x.nom.toLowerCase() === nom.toLowerCase());
    if (i >= 0) list[i] = { ...list[i], ...item }; else list.push(item);
  });
  if (abonnements.length > MAX_ABOS) fail('abonnements', `${MAX_ABOS} au maximum`);
  if (charges.length > MAX_CHARGES) fail('dépenses', `${MAX_CHARGES} au maximum`);
  if (new Set(charges.map((c) => c.nom)).size !== charges.length) fail('dépenses', 'deux dépenses ont le même nom');
  const out = { ...cur, maj: todayIso, biens, revenus, abonnements, charges };
  if (out.note === EMPTY_NOTE) out.note = 'Dossier de Sam, gardé sur son serveur seulement (C-094). Montants en centimes.';
  return out;
}

export function removeBien(current, id) {
  if (!current || !Array.isArray(current.biens)) fail('dossier', 'vide');
  const biens = current.biens.filter((b) => b.id !== id);
  if (biens.length === current.biens.length) fail('bien', 'introuvable');
  return { ...current, biens };
}

// Atomic write with a unique temp name (two saves at once cannot mix); readable by the app account only.
export async function writeDossier(file, dossier) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(dossier, null, 1), { mode: 0o600 });
    await fs.rename(tmp, file);
  } finally { await fs.rm(tmp, { force: true }); }
}

// Missing file = empty dossier (first use). Present but unreadable = NEVER treated as empty: the pages say so and
// nothing can overwrite it (a save would erase the only live copy).
export async function readDossier(file) {
  let raw;
  try { raw = await fs.readFile(file, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? { etat: 'absent', data: emptyDossier() } : { etat: 'illisible', data: emptyDossier() }; }
  try { const d = JSON.parse(raw); if (d && Array.isArray(d.biens)) return { etat: d.biens.length ? 'ok' : 'vide', data: d }; } catch { /* fall through */ }
  return { etat: 'illisible', data: emptyDossier() };
}
