// Detect text that looks like a secret or a sensitive identifier, so the bot never files it
// into a GitHub INBOX. Conservative on purpose: a false alarm only asks Sam to rephrase.
const PATTERNS = [
  ['clé de sauvegarde', /AGE-SECRET-KEY-1[0-9A-Z]{20,}/],
  ['jeton GitHub', /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['jeton de bot Telegram', /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/],
  ['clé d’API', /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{10,}\b|\bsk-[A-Za-z0-9_-]{20,}\b|\bAKIA[0-9A-Z]{16}\b/],
  ['IBAN', /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/],
  ['numéro de carte', /\b(?:\d[ -]?){13,19}\b/],
  ['numéro de sécurité sociale', /\b[12]\s?\d{2}\s?(0[1-9]|1[0-2])\s?(\d{2}|2A|2B)\s?\d{3}\s?\d{3}(\s?\d{2})?\b/],
  ['mot de passe', /\b(mot de passe|mdp|password|passwd|code pin|pin)\s*[:=]\s*\S+/i],
];

export function findSecret(text) {
  const t = String(text || '');
  for (const [label, re] of PATTERNS) if (re.test(t)) return label;
  return null;
}
