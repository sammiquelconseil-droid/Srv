// Fiscal/social calendar with J-30 / J-7 / J-1 reminders. Every rule carries its official source, the date it
// was checked and a status (CLAUDE.md rule 5). Reminder dates are the EARLIEST legal deadline, so a reminder
// is never late; the note says when a later date may apply.
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export const RULES = [
  {
    id: 'urssaf', libelle: 'Déclaration URSSAF du chiffre d’affaires du mois précédent (même sans vente)', mensuel: true,
    // Activité créée le 13/10/2026 : première déclaration avant la fin du mois qui suit les 3 mois civils complets
    // suivant le début (nov., déc., janv.) → 28/02/2027, un montant par mois depuis octobre. Corrigé le 25/10 (était 31/01).
    premiere: '2027-02-28', premiereAVerifier: true,
    note: 'Dernier jour du mois suivant ; si week-end ou férié, report au jour ouvré suivant. Première déclaration : date exacte affichée dans ton espace autoentrepreneur.urssaf.fr (à confirmer), un chiffre par mois depuis octobre 2026, zéro compris.',
    source: 'https://entreprendre.service-public.gouv.fr/vosdroits/F23257', verifieLe: '2026-10-25', statut: 'verifie',
  },
  {
    id: 'cfe-declaration-initiale', libelle: 'Déclaration initiale de CFE (formulaire 1447-C-SD) à envoyer au service des impôts des entreprises', date: '2026-12-31',
    note: 'Obligatoire pour toute entreprise créée en 2026, micro-entreprise comprise, même si aucune CFE n’est due l’année de création. Formulaire reçu par courrier après la création, sinon à télécharger sur impots.gouv.fr ; à retourner au SIE avant le 1er janvier 2027. Garde une copie et la preuve d’envoi.',
    source: 'https://entreprendre.service-public.gouv.fr/vosdroits/F23547', verifieLe: '2026-10-25', statut: 'verifie',
  },
  {
    id: 'cfe', libelle: 'CFE (cotisation foncière des entreprises)', mois: 12, jour: 15, aPartirDe: 2027, // pas de CFE l’année de création (2026)
    note: 'Avis mis en ligne début novembre dans l’espace professionnel impots.gouv.fr ; paiement dématérialisé obligatoire ; 5 % de majoration après la date.',
    source: 'https://www.impots.gouv.fr/actualite/cfe-etou-ifer-2025-mise-en-ligne-des-avis-dimpot-dans-lespace-professionnel', verifieLe: '2026-10-25', statut: 'verifie',
  },
  {
    id: 'impot-revenu', libelle: 'Déclaration de revenus en ligne (salaire, loyers, micro-entreprise)', mois: 5, jour: 21, anneeVerifiee: 2026,
    note: '2026 : 21 mai (départements 01–19), 28 mai (20–54), 4 juin (55 et plus). Le rappel prend la date la plus tôt. Les dates de l’année suivante sont publiées en avril : à revérifier.',
    source: 'https://www.economie.gouv.fr/particuliers/impots-et-fiscalite/gerer-mon-impot-sur-le-revenu/impot-sur-le-revenu-le-calendrier-de-la-declaration-en-2026', verifieLe: '2026-10-25', statut: 'verifie',
  },
  {
    id: 'taxe-fonciere', libelle: 'Taxe foncière (3 biens)', mois: 10, jour: 15, anneeVerifiee: 2026,
    note: '15 octobre par chèque ou virement (moins de 300 €), 20 octobre minuit en ligne ; prélèvement le 26 octobre. Avis en septembre sur impots.gouv.fr.',
    source: 'https://presse.economie.gouv.fr/taxes-foncieres-2026-les-dates-a-retenir-pour-le-paiement/', verifieLe: '2026-10-25', statut: 'verifie',
  },
  {
    id: 'facture-electronique', libelle: 'Facturation électronique : tes factures aux entreprises passent par une plateforme agréée', date: '2027-09-01',
    note: 'Depuis le 1er septembre 2026, tu dois déjà pouvoir RECEVOIR des factures électroniques : choisir une plateforme agréée (liste officielle sur impots.gouv.fr ; des offres gratuites existent, à vérifier). À partir du 1er septembre 2027 : émission obligatoire et transmission des données de ventes aux particuliers. Aucun abonnement sans ton accord.',
    source: 'https://www.economie.gouv.fr/entreprises/gerer-sa-micro-entreprise/micro-entrepreneur-auto-entrepreneur-quelles-sont-vos-obligations', verifieLe: '2026-10-25', statut: 'a_verifier',
  },
];

// Status of one occurrence: a yearly date checked for one year is « à vérifier » for the following years.
export const statutPour = (rule, dateIso) => {
  if (rule.premiereAVerifier && dateIso === rule.premiere) return 'a_verifier';
  return rule.anneeVerifiee && Number(dateIso.slice(0, 4)) > rule.anneeVerifiee ? 'a_verifier' : rule.statut;
};

export function occurrences(rule, fromIso, months = 13) {
  if (rule.date) return rule.date >= fromIso ? [rule.date] : []; // one-off deadline
  const [y0, m0] = fromIso.split('-').map(Number);
  const out = [];
  for (let i = 0; i < months; i++) {
    const y = y0 + Math.floor((m0 - 1 + i) / 12), m = ((m0 - 1 + i) % 12) + 1;
    if (rule.mensuel) out.push(iso(y, m, lastDay(y, m)));
    else if (m === rule.mois && (!rule.aPartirDe || y >= rule.aPartirDe)) out.push(iso(y, m, Math.min(rule.jour, lastDay(y, m))));
  }
  return out.filter((d) => d >= fromIso && (!rule.premiere || d >= rule.premiere));
}

export function upcomingDeadlines(fromIso, days = 45, rules = RULES) {
  const limit = new Date(Date.parse(fromIso + 'T00:00:00Z') + days * 86400e3).toISOString().slice(0, 10);
  return rules.flatMap((r) => occurrences(r, fromIso).filter((d) => d <= limit).map((date) => ({ ...r, date, statut: statutPour(r, date) })))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Which reminders are due today: exactly J-30, J-7 or J-1 before a deadline.
export function remindersFor(todayIso, rules = RULES) {
  return upcomingDeadlines(todayIso, 31, rules).map((e) => ({ ...e, jours: Math.round((Date.parse(e.date) - Date.parse(todayIso)) / 86400e3) }))
    .filter((e) => [30, 7, 1].includes(e.jours));
}
