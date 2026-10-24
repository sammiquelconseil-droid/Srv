// Entry point on the server. Env: TELEGRAM_BOT_TOKEN, PAIR_CODE, STATE_DIR, GITHUB_TOKEN (optional), GITHUB_OWNER.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTelegram } from './telegram.mjs';
import { createCore } from './core.mjs';
import { createSync } from './sync.mjs';
import { PROJECTS } from './classify.mjs';

const env = process.env;
const STATE = env.STATE_DIR || '/var/lib/cockpit';
const INBOX = path.join(STATE, 'inbox');
await fs.mkdir(INBOX, { recursive: true });
const readJson = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
const state = await readJson(path.join(STATE, 'bot-state.json'), {});
const saveState = () => fs.writeFile(path.join(STATE, 'bot-state.json'), JSON.stringify(state));

const tg = createTelegram(env.TELEGRAM_BOT_TOKEN);
const sync = createSync({ token: env.GITHUB_TOKEN, owner: env.GITHUB_OWNER || 'sammiquelconseil-droid' });
const log = (line) => fs.appendFile(path.join(STATE, 'bot.log'), `${new Date().toISOString()} ${line}\n`);

const core = createCore({
  owner: state.owner, pairCode: env.PAIR_CODE, log,
  send: (chat, text, extra) => tg.send(chat, text, extra),
  write: async (project, line) => {
    await fs.appendFile(path.join(INBOX, `${project}.md`), line + '\n');
    if (!sync) return { synced: false };
    try { await sync(PROJECTS[project].repo, line); return { synced: true }; }
    catch (e) { await log(`sync failed ${project}: ${e.message}`); return { synced: false }; }
  },
  health: async () => {
    const h = await readJson(path.join(STATE, 'sante.json'), null);
    if (!h) return 'Pas encore de contrôle de santé.';
    return `${h.ok ? '✅ Serveur en bonne santé' : '⚠️ Serveur à surveiller'} (${h.date.slice(0, 16).replace('T', ' ')})\nMises à jour : il y a ${h.maj_il_y_a_h} h · sécurité en attente : ${h.securite_en_attente} · redémarrage en attente : ${h.redemarrage_en_attente_h} h · disque : ${h.disque_pct} % · réseau privé : ${h.reseau_prive ? 'oui' : 'NON'}`;
  },
});

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
        if (core.ownerId && state.owner !== core.ownerId) { state.owner = core.ownerId; }
      } catch (e) { await log(`handle error: ${e.message}`); }
      state.offset = offset; await saveState();
    }
  } catch (e) { await log(`poll error: ${e.message}`); await new Promise((r) => setTimeout(r, 5000)); }
}
