// Reminders computed from the dossier (on the server; shared with the bot by a link, like echeancier.mjs):
// - each instalment of a bien, 3 days before and on the day (a late instalment can trigger an
//   « exigibilité anticipée » clause : the whole balance due at once) ;
// - each subscription / fixed expense with a renewal date, 30 and 7 days before the last day to cancel.
// Texts never carry an amount (Telegram is not end-to-end encrypted, règle N).
import { nextDue } from './schedules.mjs';

const DAY = 86400e3;
const days = (fromIso, toIso) => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / DAY);
const fr = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const shift = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const addYear = (iso) => { const [y, m, d] = iso.split('-').map(Number); const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate(); return `${y + 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`; };

export function scheduleFromBien(b) {
  const f = b.financement;
  if (!f || !f.premiereEcheance || !f.nombre) return null;
  return { totalCents: f.capitalCents, instalmentCents: f.mensualiteCents, upfrontCents: f.versementSignatureCents || 0, count: f.nombre, firstDue: f.premiereEcheance };
}

// The next renewal on or after today: a yearly item rolls to the next year once its date has passed.
export function nextRenewal(item, todayIso) {
  let d = item.renouvellement;
  if (!d) return null;
  if (item.frequence === 'an') while (shift(d, -(item.preavisJours || 0)) < todayIso) d = addYear(d);
  return d >= todayIso ? d : null;
}

export function rappelsDossier(data, todayIso) {
  const out = [];
  for (const b of (data && data.biens) || []) {
    const s = scheduleFromBien(b);
    if (!s) continue;
    const next = nextDue(s, shift(todayIso, -1)); // instalment due today counts as « next »
    if (!next) continue;
    const n = days(todayIso, next);
    if (n === 3 || n === 0) out.push({ cause: `mensualite:${b.id}:${next}:J-${n}`, text: `🏡 Mensualité « ${b.nom} » ${n ? `dans 3 jours (${fr(next)})` : `aujourd’hui (${fr(next)})`} : vérifie que le paiement part bien.` });
  }
  for (const item of [...((data && data.abonnements) || []), ...((data && data.charges) || [])]) {
    const renew = nextRenewal(item, todayIso);
    if (!renew) continue;
    const limit = shift(renew, -(item.preavisJours || 0));
    const n = days(todayIso, limit);
    if (n === 30 || n === 7) out.push({ cause: `renouvellement:${item.nom}:${renew}:J-${n}`, text: `🔁 « ${item.nom} » se renouvelle le ${fr(renew)}${item.preavisJours ? ` (préavis ${item.preavisJours} j)` : ''} : décide avant le ${fr(limit)} — résilier, renégocier ou garder.` });
  }
  return out;
}
