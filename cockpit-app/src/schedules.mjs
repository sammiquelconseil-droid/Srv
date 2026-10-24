// Theoretical balances of instalment schedules. Amounts in cents, never floats.
// "Theoretical" = assuming every instalment due so far was paid; actual payment is
// only confirmed later from bank statements.


function dueDate(first, index) {
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth() + index;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(first.getUTCDate(), lastDay)));
}

export function instalmentsDue(schedule, asOf) {
  const first = new Date(schedule.firstDue + 'T00:00:00Z');
  const at = new Date(asOf + 'T00:00:00Z');
  if (at < first) return 0;
  let n = 0;
  while (n < schedule.count && dueDate(first, n) <= at) n++;
  return n;
}

export function theoreticalBalance(schedule, asOf) {
  const n = instalmentsDue(schedule, asOf);
  const upfront = schedule.upfrontCents || 0;
  let paid = upfront + n * schedule.instalmentCents;
  if (n === schedule.count) paid = schedule.totalCents; // last instalment absorbs rounding
  return { due: n, remaining: schedule.count - n, balanceCents: Math.max(0, schedule.totalCents - paid) };
}

export function nextDue(schedule, asOf) {
  const n = instalmentsDue(schedule, asOf);
  if (n >= schedule.count) return null;
  const d = dueDate(new Date(schedule.firstDue + 'T00:00:00Z'), n);
  return d.toISOString().slice(0, 10);
}
