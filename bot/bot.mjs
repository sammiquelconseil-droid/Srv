// Entry point on the server. Env: TELEGRAM_BOT_TOKEN, PAIR_CODE, STATE_DIR, GITHUB_OWNER.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createTelegram } from './telegram.mjs';
import { createCore } from './core.mjs';
import { createSync } from './sync.mjs';
import { PROJECTS, normalize } from './classify.mjs';
import { findSecret } from './secrets.mjs';

const env = process.env;
const STATE = env.STATE_DIR || '/var/lib/cockpit';
const INBOX = path.join(STATE, 'inbox');
const SECRETS = path.join(STATE, 'secrets');
const RAW = 'https://raw.githubusercontent.com/sammiquelconseil-droid/srv/main';
const BACKUPS = '/var/backups/cockpit';
const KEY_FILE = path.join(STATE, 'cle-a-remettre');
const run = promisify(execFile);
await fs.mkdir(INBOX, { recursive: true });
await fs.mkdir(SECRETS, { recursive: true, mode: 0o700 });
const readJson = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
const readText = async (f) => { try { return (await fs.readFile(f, 'utf8')).trim(); } catch { return ''; } };
const state = await readJson(path.join(STATE, 'bot-state.json'), {});
const saveState = () => fs.writeFile(path.join(STATE, 'bot-state.json'), JSON.stringify(state));

const tg = createTelegram(env.TELEGRAM_BOT_TOKEN);
const sync = createSync({ getToken: () => readText(path.join(SECRETS, 'github')), owner: env.GITHUB_OWNER || 'sammiquelconseil-droid' });
const log = (line) => fs.appendFile(path.join(STATE, 'bot.log'), `${new Date().toISOString()} ${line}\n`);
const localVersion = () => readText(new URL('./VERSION', import.meta.url));

async function remoteVersion() {
  const r = await fetch(`${RAW}/VERSION?t=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } });
  return r.ok ? (await r.text()).trim() : '';
}

// Property names come from the private data file, so they never appear in published code.
let extra = {};
const loadExtra = async () => {
  const d = await readJson(path.join(STATE, 'data', 'situation.json'), null);
  const words = (d && d.biens || []).flatMap((b) => normalize(`${b.id} ${b.nom}`).split(/[^a-z0-9]+/)).filter((w) => w.length > 3);
  extra = { cockpit: [...new Set(words)] };
};
await loadExtra(); setInterval(loadExtra, 3600e3);

const core = createCore({
  extraWords: () => extra,
  owner: state.owner, pairCode: env.PAIR_CODE, log,
  send: (chat, text, extra) => tg.send(chat, text, extra),
  del: (chat, id) => tg.call('deleteMessage', { chat_id: chat, message_id: id }).catch(() => {}),
  storeSecret: async (name, value) => {
    if (name === 'age') return testBackup(value);
    await fs.writeFile(path.join(SECRETS, name), value + '\n', { mode: 0o600 }); await log(`secret stored: ${name}`);
  },
  write: async (project, line) => {
    await fs.appendFile(path.join(INBOX, `${project}.md`), line + '\n');
    try { const ok = await sync(PROJECTS[project].repo, line); return { synced: !!ok }; }
    catch (e) { await log(`sync failed ${project}: ${e.message}`); return { synced: false }; }
  },
  health: async () => {
    const h = await readJson(path.join(STATE, 'sante.json'), null);
    const head = !h ? 'Pas encore de contrôle de santé.' : `${h.ok ? '✅ Serveur en bonne santé' : '⚠️ Serveur à surveiller'} (${h.date.slice(0, 16).replace('T', ' ')})\nMises à jour : il y a ${h.maj_il_y_a_h} h · sécurité en attente : ${h.securite_en_attente} · redémarrage en attente : ${h.redemarrage_en_attente_h} h · disque : ${h.disque_pct} % · réseau privé : ${h.reseau_prive ? 'oui' : 'NON'}`;
    return `${head}\n${backupLine(await readJson(path.join(STATE, 'sauvegarde.json'), null))}`;
  },
  extra: {
    '/version': async (chat) => tg.send(chat, `Version du bot : ${(await localVersion()) || 'inconnue'}`),
    '/maj': async (chat) => {
      const [here, there] = [await localVersion(), await remoteVersion()];
      if (!there) return tg.send(chat, 'Impossible de lire la version disponible. Réessaie plus tard.');
      if (there === here) return tg.send(chat, `Déjà à jour (${here}).`);
      return tg.send(chat, `Version installée : ${here || 'inconnue'}\nVersion disponible : ${there}\nInstaller la mise à jour ?`, { reply_markup: { inline_keyboard: [[{ text: '✅ Valider', callback_data: `x:maj:${there}` }, { text: 'Annuler', callback_data: 'x:non' }]] } });
    },
    '/cle': async (chat) => sendKey(chat, true),
    '/acces': async (chat) => {
      const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
      const f = path.join(STATE, 'data', 'acces-code.json');
      await fs.writeFile(f + '.tmp', JSON.stringify({ code, exp: Date.now() + 10 * 60e3 }), { mode: 0o600 }); await fs.rename(f + '.tmp', f);
      await log('access code issued');
      const sent = await tg.send(chat, `Code d’enregistrement : ${code}\nValable 10 minutes, une seule fois. Entre-le sur la page « Accès » du Cockpit, puis Face ID.\n(Ce message s’efface dans 10 minutes.)`);
      setTimeout(() => tg.call('deleteMessage', { chat_id: chat, message_id: sent.message_id }).catch(() => {}), 10 * 60e3);
    },
    '/appareils': async (chat) => {
      const keys = await readJson(path.join(STATE, 'data', 'passkeys.json'), []);
      if (!keys.length) return tg.send(chat, 'Aucun appareil enregistré.');
      return tg.send(chat, 'Appareils qui peuvent ouvrir le Cockpit :\n' + keys.map((k) => `• ${k.label} — enregistré le ${k.created.slice(0, 10)}${k.lastUsed ? `, utilisé le ${k.lastUsed.slice(0, 10)}` : ''}`).join('\n') + '\n\nPour en retirer un : /retirer puis son nom.');
    },
    '/retirer': async (chat, arg) => {
      const f = path.join(STATE, 'data', 'passkeys.json');
      const keys = await readJson(f, []);
      const left = keys.filter((k) => k.label !== String(arg || '').trim());
      if (!arg || left.length === keys.length) return tg.send(chat, 'Donne le nom exact de l’appareil, par exemple : /retirer iPhone de Sam');
      await fs.writeFile(f + '.tmp', JSON.stringify(left), { mode: 0o600 }); await fs.rename(f + '.tmp', f);
      await fs.writeFile(path.join(STATE, 'data', 'sessions.json'), '{}').catch(() => {});
      await log(`passkey removed: ${arg}`);
      return tg.send(chat, `Appareil « ${arg} » retiré. Toutes les sessions ouvertes ont été fermées.`);
    },
    '/journal': async (chat) => {
      const lines = (await readText('/var/log/cockpit-maj.log')).split('\n').filter((l) => l && !findSecret(l)).slice(-15);
      return tg.send(chat, lines.length ? `Dernières lignes de la mise à jour :\n${lines.join('\n').slice(-3500)}` : 'Journal de mise à jour vide.');
    },
    '/cockpit': async (chat) => {
      const url = await readText(path.join(STATE, 'url'));
      if (!url) return tg.send(chat, 'Les écrans du Cockpit ne sont pas encore installés. Envoie /maj.');
      const enable = await readText(path.join(STATE, 'serve-a-activer'));
      const tip = url.startsWith('https') ? '' : `\n\nAdresse simple (sans cadenas) mais privée : seuls tes appareils reliés à Tailscale y accèdent.${enable ? `\nPour une adresse avec cadenas, ouvre ce lien et touche Enable, puis envoie /maj : ${enable}` : ''}`;
      return tg.send(chat, `🧭 Ton Cockpit : ${url}\n\nOuvre-le dans Safari, avec Tailscale allumé sur ton iPhone. Pour l'avoir comme une appli : bouton Partager → « Sur l'écran d'accueil ».${tip}`);
    },
    callback: async (chat, data) => {
      if (data === 'cle-ok') {
        await fs.rm(KEY_FILE, { force: true });
        if (state.keyMsg) await tg.call('deleteMessage', { chat_id: chat, message_id: state.keyMsg }).catch(() => {});
        delete state.keyMsg; delete state.keySent; await saveState(); await log('backup key handed over and deleted');
        return tg.send(chat, '✅ Clé effacée du serveur. Elle n’existe plus que dans ton app Mots de passe. Teste-la une fois avec /test_sauvegarde.');
      }
      if (data.startsWith('maj:')) {
        await fs.writeFile(path.join(STATE, 'maj-demandee'), data.slice(4) + '\n');
        await log(`update requested ${data.slice(4)}`);
        return tg.send(chat, 'Mise à jour lancée. Je redémarre et je te confirme dans une minute.');
      }
      return tg.send(chat, 'Rien n’a été changé.');
    },
  },
});

function backupLine(b) {
  if (!b) return '💾 Sauvegarde : pas encore faite.';
  const age = Math.round((Date.now() - Date.parse(b.date)) / 3600e3);
  return `💾 Sauvegarde : il y a ${age} h · ${Math.ceil(b.taille / 1024)} Ko · copie hors du serveur : ${b.distant ? 'oui (vérifiée)' : 'NON'}${b.erreur ? ` (${b.erreur})` : ''}`;
}

async function latestBackup() {
  const names = (await fs.readdir(BACKUPS).catch(() => [])).filter((n) => n.endsWith('.tar.age')).sort();
  return names.length ? path.join(BACKUPS, names[names.length - 1]) : null;
}

async function testBackup(key) {
  const file = await latestBackup();
  if (!file) return 'Aucune sauvegarde à tester pour l’instant.';
  if (!/^AGE-SECRET-KEY-1[0-9A-Z]+$/.test(key)) return 'Ce n’est pas une clé de sauvegarde (elle commence par AGE-SECRET-KEY-1). Rien n’a été gardé.';
  const tmp = await fs.mkdtemp(path.join(STATE, 'tmp-'));
  const keyPath = path.join(tmp, 'k');
  try {
    await fs.writeFile(keyPath, key + '\n', { mode: 0o600 });
    await run('age', ['-d', '-i', keyPath, '-o', path.join(tmp, 'a.tar'), file]);
    const { stdout } = await run('tar', ['-tf', path.join(tmp, 'a.tar')]);
    const n = stdout.split('\n').filter(Boolean).length;
    await log('backup restore test ok');
    return `✅ Ta clé ouvre bien la dernière sauvegarde (${path.basename(file)}) : ${n} éléments lisibles. La clé a été oubliée et ton message effacé.`;
  } catch {
    await log('backup restore test failed');
    return '❌ Cette clé n’ouvre pas la dernière sauvegarde. Vérifie que tu as copié la bonne clé (AGE-SECRET-KEY-…). Ton message a été effacé.';
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
}

// Hand the backup key to Sam once, then wait for his confirmation before deleting it from the server.
async function sendKey(chat, force) {
  const key = await readText(KEY_FILE);
  if (!key) {
    if (!force) return null;
    const installed = !!(await readText('/etc/cockpit/sauvegarde.pub'));
    return tg.send(chat, installed
      ? 'Il n’y a plus de clé sur le serveur : elle t’a déjà été remise. Elle est dans ton app Mots de passe (« Cockpit — clé de sauvegarde »).'
      : 'Les sauvegardes ne sont pas encore installées sur le serveur, donc pas encore de clé. Dis-le à Claude.');
  }
  if (state.keySent && !force) return null;
  const sent = await tg.send(chat, `🔑 Clé de tes sauvegardes. Sans elle, personne ne peut les ouvrir, pas même toi.\n\n1. Appuie longuement sur la clé ci-dessous et copie-la.\n2. App Mots de passe → + → titre « Cockpit — clé de sauvegarde » → colle-la dans Mot de passe → Enregistrer.\n3. Reviens ici et touche le bouton.\n\nCe message s’efface dans 10 minutes (/cle pour le revoir tant que tu n’as pas touché le bouton).\n\n<code>${key.split('\n').find((l) => l.startsWith('AGE-SECRET-KEY-')) || ''}</code>`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '✅ Rangée dans Mots de passe', callback_data: 'x:cle-ok' }]] } });
  state.keySent = Date.now(); state.keyMsg = sent.message_id; await saveState();
  setTimeout(() => tg.call('deleteMessage', { chat_id: chat, message_id: sent.message_id }).catch(() => {}), 10 * 60e3);
}
setInterval(() => { if (core.ownerId) sendKey(core.ownerId, false).catch((e) => log(`key send: ${e.message}`)); }, 60e3);

// Report the result of an update, if one just happened.
const result = await readText(path.join(STATE, 'maj-resultat'));
if (result && state.owner) {
  await tg.send(state.owner, result.startsWith('ok') ? `✅ Mise à jour installée (${result.slice(3)}).` : `⚠️ Mise à jour refusée : ${result}. Rien n’a été changé.`).catch(() => {});
  await fs.rm(path.join(STATE, 'maj-resultat'), { force: true });
}

// Daily alert, only when something is wrong, at most once a day.
setInterval(async () => {
  const owner = core.ownerId; if (!owner) return;
  const h = await readJson(path.join(STATE, 'sante.json'), null);
  const today = new Date().toISOString().slice(0, 10);
  const b = await readJson(path.join(STATE, 'sauvegarde.json'), null);
  const stale = !h || Date.now() - Date.parse(h.date) > 36 * 3600e3;
  const badBackup = b && (!b.distant || Date.now() - Date.parse(b.date) > 36 * 3600e3);
  if ((stale || !h.ok || badBackup) && state.lastAlert !== today) {
    state.lastAlert = today; await saveState();
    await tg.send(owner, stale ? '⚠️ Le contrôle de santé du serveur n’a pas tourné depuis plus de 36 h.' : '⚠️ Serveur ou sauvegarde : quelque chose cloche. Tape /sante.');
  }
}, 3600e3);

let offset = state.offset || 0;
for (;;) {
  try {
    const updates = await tg.getUpdates(offset);
    for (const u of updates) {
      offset = u.update_id + 1;
      try {
        const r = await core.handle(u);
        if (r && r.answer) await tg.answerCallback(r.answer);
        if (core.ownerId && state.owner !== core.ownerId) state.owner = core.ownerId;
      } catch (e) { await log(`handle error: ${e.message}`); }
      state.offset = offset; await saveState();
    }
  } catch (e) { await log(`poll error: ${e.message}`); await new Promise((r) => setTimeout(r, 5000)); }
}
