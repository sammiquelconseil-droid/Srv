// Fiscal/social calendar with J-30 / J-7 / J-1 reminders. Every rule carries its official source, the date it
// was checked and a status (CLAUDE.md rule 5). Reminder dates are the EARLIEST legal deadline, so a reminder
// is never late; the note says when a later date may apply.
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const SF = 'https://entreprendre.service-public.gouv.fr/vosdroits/';
export const RAPPELS = [30, 7, 1]; // default reminders (days before); a rule may carry its own `rappels`

export const RULES = [
  {
    id: 'urssaf', libelle: 'Déclaration URSSAF du chiffre d’affaires du mois précédent (même sans vente)', mensuel: true,
    // Activité créée le 13/10/2026 : première déclaration avant la fin du mois qui suit les 3 mois civils complets
    // suivant le début (nov., déc., janv.) → 28/02/2027, un montant par mois depuis octobre. Corrigé le 25/10 (était 31/01).
    premiere: '2027-02-28', premiereAVerifier: true,
    note: 'Dernier jour du mois suivant. Le Cockpit garde toujours cette date, même un week-end ou un jour férié (jamais de report au lundi : un report n’est pas confirmé par un texte officiel lu, et un rappel ne doit jamais être en retard). Première déclaration : date exacte affichée dans ton espace autoentrepreneur.urssaf.fr (à confirmer), un chiffre par mois depuis octobre 2026, zéro compris.',
    source: 'https://entreprendre.service-public.gouv.fr/vosdroits/F23257', verifieLe: '2026-10-25', statut: 'verifie',
  },
  {
    id: 'cfe-declaration-initiale', libelle: 'Déclaration initiale de CFE (formulaire 1447-C-SD) à envoyer au service des impôts des entreprises', date: '2026-12-31',
    // Legal date 31/12, but a letter posted on the 30th may arrive late: reminders aim at posting before 22/12 (J-1 = 21/12).
    rappelAvant: '2026-12-22',
    note: 'Obligatoire pour toute entreprise créée en 2026, micro-entreprise comprise, même si aucune CFE n’est due l’année de création. Formulaire reçu par courrier après la création, sinon à télécharger sur impots.gouv.fr ; à retourner au SIE avant le 1er janvier 2027 : poste-le au plus tard le 21/12 pour qu’il arrive à temps. Garde une copie et la preuve d’envoi.',
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
    id: 'urssaf-periodicite', libelle: 'Demander à l’URSSAF de déclarer tous les 3 mois (au lieu de chaque mois)', date: '2026-11-12',
    note: 'Possible dans le mois qui suit le début de l’activité : 4 déclarations par an au lieu de 12, donc moins d’oublis (chaque oubli coûte une pénalité). Demande dans ton espace autoentrepreneur.urssaf.fr › Messagerie. Après cette date, le changement vaut pour l’année suivante (rappel chaque 31 octobre).',
    source: SF + 'F23257', verifieLe: '2026-11-05', statut: 'verifie',
  },
  {
    id: 'urssaf-periodicite-annuelle', libelle: 'Changer, si tu veux, la fréquence de tes déclarations URSSAF pour l’an prochain (tous les mois ou tous les 3 mois)', mois: 10, jour: 31, aPartirDe: 2027,
    note: 'Demande avant le 31 octobre pour l’année suivante, dans ton espace autoentrepreneur.urssaf.fr. Rien à faire si la fréquence actuelle te va.',
    source: SF + 'F23257', verifieLe: '2026-11-05', statut: 'verifie',
  },
  {
    id: 'acre-demande', libelle: 'Demande d’ACRE à l’URSSAF (aide des quartiers prioritaires) — perdue après cette date', date: '2026-12-12',
    note: 'L’ACRE baisse tes cotisations d’un quart jusqu’au 30/09/2027. Ton adresse a été testée sur sig.ville.gouv.fr le 05/11/2026 (quartier prioritaire, à confirmer par l’URSSAF). Demande à envoyer dans les 60 jours après le début du justificatif : formulaire « Demande d’ACRE » sur autoentrepreneur.urssaf.fr, avec le justificatif de domicile. Décision de Sam.',
    source: SF + 'F11677', verifieLe: '2026-11-05', statut: 'a_verifier',
  },
  {
    id: 'espace-pro-activation', libelle: 'Activer ton espace professionnel sur impots.gouv.fr avec le code reçu par la poste', date: '2027-01-05',
    note: 'Le code envoyé par courrier après ta demande du 22/10/2026 n’est valable que 60 jours. Sans espace pro : pas de messagerie avec les impôts ni de paiement de la CFE en ligne. Si aucune lettre n’est arrivée le 20/11, refais la demande (impots.gouv.fr › Espace professionnel › Créer mon espace). Rien à faire s’il est déjà activé.',
    source: 'https://www.impots.gouv.fr/professionnel', sourceDetail: 'courriel de la DGFiP du 22/10/2026 (code valable 60 jours)', verifieLe: '2026-11-05', statut: 'a_verifier',
  },
  {
    id: 'versement-liberatoire', libelle: 'Dernier jour conseillé pour choisir le versement libératoire de l’impôt (création d’activité)', date: '2027-01-29',
    // Created 13/10/2026: option by the last day of the 3rd month after the creation month (31/01/2027, a Sunday) → act on 29/01.
    // Income ceiling per share: 29 315 or 29 579 € depending on the source (to confirm on the 2025 tax notice). Never automatic.
    note: 'Pas toujours gagnant : simule d’abord avec le simulateur d’impots.gouv.fr. Possible seulement si ton revenu fiscal de référence 2024 (avis d’impôt 2025) est sous le plafond par part. Avec l’option, l’impôt de la micro-entreprise devient un petit pourcentage du chiffre d’affaires payé avec l’URSSAF ; sans elle, il s’ajoute à ton impôt sur le revenu. Demande dans ton espace autoentrepreneur.urssaf.fr. Limite légale : 31/01/2027 (un dimanche), d’où le 29/01. Décision de Sam.',
    source: SF + 'F23267', verifieLe: '2026-11-05', statut: 'a_verifier',
  },
  {
    id: 'occupation-logements', libelle: 'Déclarer l’occupation de tes logements sur impots.gouv.fr (« Gérer mes biens immobiliers »), seulement si quelque chose a changé', mois: 6, jour: 30, aPartirDe: 2027,
    note: 'Seulement si l’occupation d’un logement a changé (loué, vide, résidence secondaire). Un logement oublié ou mal déclaré peut coûter 150 € d’amende. Espace particulier › Biens immobiliers › chaque logement › Déclarer l’occupation.',
    source: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F42', verifieLe: '2026-11-05', statut: 'verifie',
  },
  {
    id: 'acre-fin', libelle: 'Fin de l’ACRE (si elle t’a été accordée) : cotisations au taux plein dès le 1er octobre', date: '2027-09-30',
    note: 'Information seulement : si l’ACRE a été accordée, tes cotisations reviennent au taux normal pour le chiffre d’affaires à partir du 01/10/2027. Pense à réserver un peu plus chaque mois. Rien à faire si l’ACRE n’a pas été demandée.',
    source: SF + 'F11677', verifieLe: '2026-11-05', statut: 'a_verifier',
  },
  {
    id: 'exclusivite-contrat', libelle: 'Fin de la protection contre une clause d’exclusivité de ton contrat de travail (1 an après la création)', date: '2027-10-13', rappels: [120, 30, 7, 1],
    note: 'Pendant 1 an après la création de l’entreprise, une clause d’exclusivité du contrat de travail ne peut pas t’être opposée (code du travail, article L1222-5). Avant l’été 2027 : relis ton contrat (cherche le mot « exclusivité »). S’il y en a une, demande un accord écrit à ton employeur avant cette date.',
    source: 'https://code.travail.gouv.fr/code-du-travail/l1222-5', verifieLe: '2026-11-05', statut: 'verifie',
  },
  {
    id: 'deficit-foncier-double', libelle: 'Dernier jour pour payer des travaux de rénovation énergétique dans un logement loué vide avec le déficit foncier doublé', date: '2027-12-31',
    note: 'Travaux qui font passer un logement loué vide de la classe E, F ou G à A, B, C ou D, payés avant le 31/12/2027 : jusqu’à 21 400 € déductibles du revenu global au lieu de 10 700 €, à condition de louer ensuite plusieurs années. Règle lue dans des guides privés seulement (loi de finances 2026) : à confirmer avant tout devis. Rien à faire sans travaux prévus.',
    source: 'https://www.legifiscal.fr/', sourceSecondaire: true, // guides privés (legifiscal.fr, weblex.fr, 05/11/2026) : aucun texte officiel lu
    verifieLe: '2026-11-05', statut: 'a_verifier',
  },
  {
    id: 'taxe-habitation-reclamation', libelle: 'Dernier jour pour contester une taxe d’habitation payée pour une maison vide et sans meubles (seulement si tu en as reçu une)', mois: 12, jour: 31, aPartirDe: 2026,
    note: 'La taxe d’habitation d’une résidence secondaire n’est due que pour un logement meublé. Si tu as payé pour une maison vide et sans meubles (ou inhabitable), la réclamation se fait avant le 31 décembre de l’année qui suit l’avis, dans ta messagerie impots.gouv.fr. Aucun avis reçu : rien à faire.',
    source: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F42', verifieLe: '2026-11-05', statut: 'verifie',
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

// Which reminders are due today: exactly J-30, J-7 or J-1 (or the rule's own `rappels`) before the deadline, or before
// `rappelAvant` when the rule asks to act earlier than the legal date (a letter to post). `cible` = the date counted to.
export function remindersFor(todayIso, rules = RULES) {
  const horizon = Math.max(...rules.map((r) => Math.max(...(r.rappels || RAPPELS)))) + 1;
  return upcomingDeadlines(todayIso, horizon, rules).map((e) => {
    const cible = e.rappelAvant && e.rappelAvant <= e.date ? e.rappelAvant : e.date;
    return { ...e, cible, jours: Math.round((Date.parse(cible) - Date.parse(todayIso)) / 86400e3) };
  }).filter((e) => (e.rappels || RAPPELS).includes(e.jours));
}
