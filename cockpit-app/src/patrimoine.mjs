// Derive schedules and figures from dossier/situation.json. Amounts in cents.
import { theoreticalBalance, nextDue } from './schedules.mjs';

export function scheduleOf(bien) {
  const f = bien.financement;
  if (!f) return null;
  return { label: bien.nom, totalCents: f.capitalCents, instalmentCents: f.mensualiteCents, upfrontCents: f.versementSignatureCents || 0, count: f.nombre, firstDue: f.premiereEcheance };
}

export function lastDue(schedule) {
  const [y, m, d] = schedule.firstDue.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + schedule.count - 1, 1));
  const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, lastDay));
  return dt.toISOString().slice(0, 10);
}

export function summarize(data, asOf) {
  const biens = data.biens.map((b) => {
    const s = scheduleOf(b);
    const bal = s ? theoreticalBalance(s, asOf) : null;
    const loyersCents = (b.loyers || []).reduce((t, l) => t + l.montantCents, 0);
    const paidCents = s ? s.totalCents - bal.balanceCents : 0;
    return {
      ...b, schedule: s, balance: bal, loyersCents,
      next: s ? nextDue(s, asOf) : null, end: s ? lastDue(s) : null,
      progress: s ? paidCents / s.totalCents : 0,
    };
  });
  const totals = {
    restantCents: biens.reduce((t, b) => t + (b.balance ? b.balance.balanceCents : 0), 0),
    mensualitesCents: biens.reduce((t, b) => t + (b.balance && b.balance.remaining > 0 ? b.schedule.instalmentCents : 0), 0),
    loyersCents: biens.reduce((t, b) => t + b.loyersCents, 0),
  };
  totals.fluxBrutCents = totals.loyersCents - totals.mensualitesCents;
  return { biens, totals };
}

export function upcoming(summary, asOf, days = 30) {
  const limit = new Date(Date.parse(asOf + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
  return summary.biens.filter((b) => b.next && b.next <= limit).map((b) => ({ nom: b.nom, date: b.next, montantCents: b.schedule.instalmentCents })).sort((a, b) => a.date.localeCompare(b.date));
}
