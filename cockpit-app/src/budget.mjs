// Monthly budget estimate from the dossier + what Sam typed in « Mes chiffres ». Amounts in cents, never floats.
// An ESTIMATE for steering (règle R) : not a bank balance, not a taxable income.
export const monthly = (c) => (c.frequence === 'an' ? Math.round(c.montantCents / 12) : c.montantCents);

export function budget(data, summary, prive = {}) {
  const salaire = prive.salaire ? prive.salaire.montantCents : null;
  const loyers = summary.totals.loyersCents;
  const mensualites = summary.totals.mensualitesCents;
  const abonnements = (data.abonnements || []).reduce((t, a) => t + (prive['abo:' + a.nom] ? prive['abo:' + a.nom].montantCents : a.montantCents), 0);
  const charges = (data.charges || []).reduce((t, c) => t + monthly(c), 0);
  const entrees = (salaire || 0) + loyers;
  const sorties = mensualites + abonnements + charges;
  return { salaire, loyers, mensualites, abonnements, charges, entrees, sorties, solde: entrees - sorties, complet: salaire !== null };
}
