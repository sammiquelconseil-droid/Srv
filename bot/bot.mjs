// Entry point on the server. Env: TELEGRAM_BOT_TOKEN, PAIR_CODE, STATE_DIR, GITHUB_OWNER.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTelegram } from './telegram.mjs';
import { createCore } from './core.mjs';
import { createSync } from './sync.mjs';
import { PROJECTS } from './classify.mjs';

const env = process.env;
const STATE = env.STATE_DIR || '/var/lib/cockpit';
const INBOX = path.join(STATE, 'inbox');
const SECRETS = path.join(STATE, 'secrets');
const RAW = 'https://raw.githubusercontent.com/sammiquelconseil-droid/srv/main';
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

const core = createCore({
  owner: state.owner, pairCode: env.PAIR_CODE, log,
  send: (chat, text, extra) => tg.send(chat, text, extra),
  del: (chat, id) => tg.call('deleteMessage', { chat_id: chat, message_id: id }).catch(() => {}),
  storeSecret: async (name, value) => { await fs.writeFile(path.join(SECRETS, name), value + '\n', { mode: 0o600 }); await log(`secret stored: ${name}`); },
  write: async (project, line) => {
    await fs.appendFile(path.join(INBOX, `${project}.md`), line + '\n');
    try { const ok = await sync(PROJECTS[project].repo, line); return { synced: !!ok }; }
    catch (e) { await log(`sync failed ${project}: ${e.message}`); return { synced: false }; }
  },
  health: async () => {
    const h = await readJson(path.join(STATE, 'sante.json'), null);
    if (!h) return 'Pas encore de contrôle de santé.';
    return `${h.ok ? '✅ Serveur en bonne santé' : '⚠️ Serveur à surveiller'} (${h.date.slice(0, 16).replace('T', ' ')})\nMises à jour : il y a ${h.maj_il_y_a_h} h · sécurité en attente : ${h.securite_en_attente} · redémarrage en attente : ${h.redemarrage_en_attente_h} h · disque : ${h.disque_pct} % · réseau privé : ${h.reseau_prive ? 'oui' : 'NON'}`;
  },
  extra: {
    '/version': async (chat) => tg.send(chat, `Version du bot : ${(await localVersion()) || 'inconnue'}`),
    '/maj': async (chat) => {
      const [here, there] = [await localVersion(), await remoteVersion()];
      if (!there) return tg.send(chat, 'Impossible de lire la version disponible. Réessaie plus tard.');
      if (there === here) return tg.send(chat, `Déjà à jour (${here}).`);
      return tg.send(chat, `Version installée : ${here || 'inconnue'}\nVersion disponible : ${there}\nInstaller la mise à jour ?`, { reply_markup: { inline_keyboard: [[{ text: '✅ Valider', callback_data: `x:maj:${there}` }, { text: 'Annuler', callback_data: 'x:non' }]] } });
    },
    callback: async (chat, data) => {
      if (data.startsWith('maj:')) {
        await fs.writeFile(path.join(STATE, 'maj-demandee'), data.slice(4) + '\n');
        await log(`update requested ${data.slice(4)}`);
        return tg.send(chat, 'Mise à jour lancée. Je redémarre et je te confirme dans une minute.');
      }
      return tg.send(chat, 'Rien n’a été changé.');
    },
  },
});

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
  const stale = !h || Date.now() - Date.parse(h.date) > 36 * 3600e3;
  if ((stale || !h.ok) && state.lastAlert !== today) {
    state.lastAlert = today; await saveState();
    await tg.send(owner, stale ? '⚠️ Le contrôle de santé du serveur n’a pas tourné depuis plus de 36 h.' : '⚠️ Contrôle de santé du serveur : quelque chose cloche. Tape /sante.');
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
