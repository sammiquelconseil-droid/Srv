// Backups page helpers. The backup key is shown ONCE here, over Tailscale and after Face ID, and never
// goes through Telegram (REGLES-COMMUNES §N). Keys and tokens never reach a log or a message.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runDefault = promisify(execFile);
export const KEY_RE = /^AGE-SECRET-KEY-1[0-9A-Z]{20,}$/;
export const TOKEN_RE = /^(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$/;

export async function pendingKey(keyFile) {
  try { return (await fs.readFile(keyFile, 'utf8')).split('\n').find((l) => l.startsWith('AGE-SECRET-KEY-')) || null; } catch { return null; }
}

export async function latestBackup(dir) {
  const names = (await fs.readdir(dir).catch(() => [])).filter((n) => n.endsWith('.tar.age')).sort();
  return names.length ? path.join(dir, names[names.length - 1]) : null;
}

// Opens the latest backup with the pasted key and lists it IN A STREAM: the decrypted archive never
// touches the disk. Only the key file lives in a private temp dir for the duration of the test.
export async function testBackup({ key, backupsDir, tmpBase, run = runDefault }) {
  const k = String(key || '').trim();
  if (!KEY_RE.test(k)) return { ok: false, text: 'Ce n’est pas une clé de sauvegarde (elle commence par AGE-SECRET-KEY-1). Rien n’a été gardé.' };
  const file = await latestBackup(backupsDir);
  if (!file) return { ok: false, text: 'Aucune sauvegarde à tester pour l’instant.' };
  const tmp = await fs.mkdtemp(path.join(tmpBase, 'tmp-'));
  try {
    await fs.writeFile(path.join(tmp, 'k'), k + '\n', { mode: 0o600 });
    const { stdout } = await run('bash', ['-o', 'pipefail', '-c', 'age -d -i "$1" -- "$2" | tar -tf -', 'age-tar', path.join(tmp, 'k'), file]);
    const n = String(stdout).split('\n').filter(Boolean).length;
    return { ok: true, text: `✅ Ta clé ouvre bien la dernière sauvegarde (${path.basename(file)}) : ${n} éléments lisibles. La clé a été oubliée aussitôt.` };
  } catch {
    return { ok: false, text: '❌ Cette clé n’ouvre pas la dernière sauvegarde. Vérifie que tu as copié la bonne clé (AGE-SECRET-KEY-…). Rien n’a été gardé.' };
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
}

export async function storeGithubToken({ token, secretsDir }) {
  const t = String(token || '').trim();
  if (!TOKEN_RE.test(t)) return { ok: false, text: 'Ce n’est pas un jeton GitHub (il commence par github_pat_ ou ghp_). Rien n’a été enregistré.' };
  await fs.mkdir(secretsDir, { recursive: true, mode: 0o700 });
  const f = path.join(secretsDir, 'github');
  await fs.writeFile(f + '.tmp', t + '\n', { mode: 0o600 }); await fs.rename(f + '.tmp', f);
  return { ok: true, text: '✅ Jeton GitHub enregistré sur ton serveur. Le bot s’en sert dès sa prochaine note. Révoque l’ancien sur github.com/settings/personal-access-tokens.' };
}
