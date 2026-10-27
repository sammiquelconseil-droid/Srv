// Retention on the server (C-061, rule N): the local copies of Sam's notes (STATE/inbox/*.md) and the bot's journal
// (STATE/bot.log) are kept 90 days, then removed. The notes already sit in each project's INBOX.md on GitHub,
// where each session handles them; these copies only feed the « Dernières notes » card.
export const KEEP_DAYS = 90;
const DAY = 864e5;
const ENTRY = /^- (\d{2})\/(\d{2}) \d{2}:\d{2} — /;

// Notes: « - JJ/MM HH:MM — texte » entries (a long note continues on the next lines), oldest first, with no year.
// The year is found from the end: each step back to a later day of the calendar means one year earlier.
export function purgeNotes(text, todayIso, days = KEEP_DAYS) {
  const lines = String(text || '').replace(/\n+$/, '').split('\n').filter((l, i, a) => a.length > 1 || l);
  const entries = [];
  for (const l of lines) {
    if (ENTRY.test(l) || !entries.length) entries.push([l]); else entries[entries.length - 1].push(l);
  }
  const today = Date.parse(todayIso + 'T00:00:00Z');
  let year = Number(todayIso.slice(0, 4)), next = null;
  const keep = new Array(entries.length).fill(true);
  for (let i = entries.length - 1; i >= 0; i--) {
    const m = entries[i][0].match(ENTRY);
    if (!m) continue; // a first line that is not a dated note is kept as it is
    const md = `${m[2]}-${m[1]}`;
    if (next === null) { if (Date.parse(`${year}-${md}T00:00:00Z`) > today + DAY) year--; } else if (md > next) year--;
    next = md;
    const t = Date.parse(`${year}-${md}T00:00:00Z`);
    if (!Number.isNaN(t) && today - t > days * DAY) keep[i] = false;
  }
  const kept = entries.filter((_, i) => keep[i]).map((e) => e.join('\n'));
  return kept.length ? kept.join('\n') + '\n' : ''; // always ends with a new line: the next note starts on its own line
}

// Journal: one « ISO-date message » line each. Lines without a date stay with the line before them.
export function purgeLog(text, nowMs, days = KEEP_DAYS) {
  const out = []; let keeping = true;
  for (const l of String(text || '').replace(/\n+$/, '').split('\n')) {
    if (!l) continue;
    const m = l.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) /);
    if (m) keeping = nowMs - Date.parse(m[1]) <= days * DAY;
    if (keeping) out.push(l);
  }
  return out.length ? out.join('\n') + '\n' : '';
}
