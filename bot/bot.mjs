// Entry point on the server. Env: TELEGRAM_BOT_TOKEN, PAIR_CODE, STATE_DIR, GITHUB_OWNER.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import dns from 'node:dns/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createTelegram } from './telegram.mjs';
import { createCore } from './core.mjs';
import { createSync } from './sync.mjs';
import { PROJECTS, normalize } from './classify.mjs';
import { findSecret } from './secrets.mjs';
import { createQueue, itemFor, createDeliver } from './queue.mjs';
import { evaluate, alertTick } from './alerts.mjs';
import { synthese, attentes } from './projets.mjs';
import { keyMessage, restoreTestMessage, tokenMessage, newKeyMessage, guardSend } from './secours.mjs';

const env = process.env;
const STATE = env.STATE_DIR || '/var/lib/cockpit';
const INBOX = path.join(STATE, 'inbox');
const SECRETS = path.join(STATE, 'secrets');
const RAW = 'https://raw.githubusercontent.com/sammiquelconseil-droid/srv/main';
const KEY_FILE = path.join(STATE, 'cle-a-remettre');
const run = promisify(execFile);
await fs.mkdir(INBOX, { recursive: true });
await fs.mkdir(SECRETS, { recursive: true, mode: 0o700 });
const readJson = async (f, d) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
const readText = async (f) => { try { return (await fs.readFile(f, 'utf8')).trim(); } catch { return ''; } };
const state = await readJson(path.join(STATE, 'bot-state.json'), {});
const saveState = () => fs.writeFile(path.join(STATE, 'bot-state.json'), JSON.stringify(state));
// Write then rename: a stop in the middle never leaves a half-written file.
const saveJson = (name, o) => { const f = path.join(STATE, name); fsSync.writeFileSync(f + '.tmp', JSON.stringify(o)); fsSync.renameSync(f + '.tmp', f); };

const tg = createTelegram(env.TELEGRAM_BOT_TOKEN);
const log = (line) => fs.appendFile(path.join(STATE, 'bot.log'), `${new Date().toISOString()} ${line}\n`);
tg.send = guardSend(tg.send, log); // nothing that looks like a secret ever leaves through Telegram
const cockpitUrl = () => readText(path.join(STATE, 'url'));
const RECEPTION = 'boite'; // reception branch used only once a repo's main refuses the bot's writes
const sync = createSync({ getToken: () => readText(path.join(SECRETS, 'github')), owner: env.GITHUB_OWNER || 'sammiquelconseil-droid', branchOf: (repo) => (state.branches || {})[repo] || null });
const localVersion = () => readText(new URL('./VERSION', import.meta.url));

async function remoteVersion() {
  const r = await fetch(`${RAW}/VERSION?t=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } });
  return r.ok ? (await r.text()).trim() : '';
}

const deliver = createDeliver(sync, (p) => PROJECTS[p].repo, {
  onProtected: async (repo) => {
    await sync.ensureBranch(repo, RECEPTION);
    state.branches = { ...(state.branches || {}), [repo]: RECEPTION }; await saveState();
    await log(`${repo}: main refused the write, notes now go to branch ${RECEPTION}`);
  },
});
const queueFile = path.join(STATE, 'a-renvoyer.json');
const queue = createQueue({ deliver, log,
  load: () => { try { return JSON.parse(fsSync.readFileSync(queueFile, 'utf8')); } catch { return []; } },
  save: (items) => saveJson('a-renvoyer.json', items) });
const retry = async () => { if (queue.size) { const n = await queue.flush(); if (n) await log(`retried ${n} note(s)`); } };
setTimeout(() => retry().catch(() => {}), 30e3); setInterval(() => retry().catch(() => {}), 3600e3);

// Property names come from the private data file, so they never appear in published code.
let extra = {};
const loadExtra = async () => {
  const d = await readJson(path.join(STATE, 'data', 'situation.json'), null);
  const words = (d && d.biens || []).flatMap((b) => normalize(`${b.id} ${b.nom}`).split(/[^a-z0-9]+/)).filter((w) => w.length > 3);
  extra = { cockpit: [...new Set(words)] };
};
await loadExtra(); setInterval(loadExtra, 3600e3);

// What waits for Sam, in full, for the Cockpit screen only (STATE/decisions.json; never sent to Telegram).
// Checks the server makes by itself, so a line tagged « {auto:…} » in ROADMAP.md leaves the list once done.
// Read-only: a version number, the presence of the safe's wrapped key, a public DNS answer. Nothing is sent anywhere.
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const verifier = async (kind, arg) => {
  if (kind === 'maj') { const [here, there] = [await localVersion(), await remoteVersion()]; return !!here && here === there; }
  if (kind === 'coffre') return fsSync.existsSync(path.join(STATE, 'data', 'coffre-vault.json'));
  if (kind === 'ns') {
    const [dom, want] = String(arg).toLowerCase().split('=');
    if (!DOMAIN_RE.test(dom || '') || !DOMAIN_RE.test(want || '')) return false;
    const ns = await dns.resolveNs(dom);
    return ns.length > 0 && ns.every((n) => n.toLowerCase().replace(/\.$/, '').endsWith(want));
  }
  return false;
};
const refreshDecisions = async () => { try { saveJson('decisions.json', await attentes({ read: sync.read, verifier })); } catch (e) { await log(`decisions.json: ${e.message}`); } };
const projets = async (chat, decisionsOnly) => {
  await tg.send(chat, '⏳ Je lis tes projets…');
  await refreshDecisions();
  const alertes = evaluate({ sante: await readJson(path.join(STATE, 'sante.json'), null), sauvegarde: await readJson(path.join(STATE, 'sauvegarde.json'), null), ficheRappel: state.ficheRappel });
  const text = await synthese({ read: sync.read, commit: sync.commit, decisionsOnly, alertes, queued: queue.size, faits: await readJson(path.join(STATE, 'data', 'faits.json'), {}), verifier });
  if (findSecret(text)) { await log('projets: summary withheld (secret-looking)'); return tg.send(chat, '🔒 Synthèse retenue : une ligne ressemblait à un secret. Lis-la dans le Cockpit.'); }
  for (let i = 0; i < text.length; i += 3900) await tg.send(chat, text.slice(i, i + 3900));
};

const core = createCore({
  edit: (chat, id, markup) => tg.call('editMessageReplyMarkup', { chat_id: chat, message_id: id, reply_markup: markup }).catch(() => {}),
  extraWords: () => extra,
  owner: state.owner, pairCode: env.PAIR_CODE, log,
  send: (chat, text, extra) => tg.send(chat, text, extra),
  del: (chat, id) => tg.call('deleteMessage', { chat_id: chat, message_id: id }).catch(() => {}),
  memoryStore: { load: () => { try { return JSON.parse(fsSync.readFileSync(path.join(STATE, 'memoire.json'), 'utf8')); } catch { return null; } }, save: (o) => saveJson('memoire.json', o) },
  pendingStore: { load: () => { try { return JSON.parse(fsSync.readFileSync(path.join(STATE, 'pending.json'), 'utf8')); } catch { return {}; } }, save: (o) => saveJson('pending.json', o) },
  fetchDocument: async (fileId) => {
    try { const url = await tg.fileUrl(fileId); const r = await fetch(url); if (!r.ok) return null; const t = await r.text(); return t.length <= 200000 ? t : t.slice(0, 200000) + '\n[tronqué]'; } catch { return null; }
  },
  write: async (project, line, meta = {}) => {
    await fs.appendFile(path.join(INBOX, `${project}.md`), line + '\n');
    const item = itemFor(project, line, meta, new Date().toISOString(), crypto.createHash('sha256').update(line).digest('hex').slice(0, 6));
    try { if (await deliver(item)) return { synced: true }; } catch (e) { await log(`sync failed ${project}: ${e.message}`); }
    queue.add(item); return { synced: false };
  },
  health: async () => {
    const h = await readJson(path.join(STATE, 'sante.json'), null);
    const head = !h ? 'Pas encore de contrôle de santé.' : `${h.ok ? '✅ Serveur en bonne santé' : '⚠️ Serveur à surveiller'} (${h.date.slice(0, 16).replace('T', ' ')})\nMises à jour : il y a ${h.maj_il_y_a_h} h · sécurité en attente : ${h.securite_en_attente} · redémarrage en attente : ${h.redemarrage_en_attente_h} h · disque : ${h.disque_pct} % · réseau privé : ${h.reseau_prive ? 'oui' : 'NON'}`;
    return `${head}\n${backupLine(await readJson(path.join(STATE, 'sauvegarde.json'), null))}`;
  },
  extra: {
    '/projets': (chat) => projets(chat, false),
    '/point': (chat) => projets(chat, false),
    '/decisions': (chat) => projets(chat, true),
    '/moi': (chat) => projets(chat, true),
    '/version': async (chat) => tg.send(chat, `Version du bot : ${(await localVersion()) || 'inconnue'}`),
    '/maj': async (chat) => {
      const [here, there] = [await localVersion(), await remoteVersion()];
      if (!there) return tg.send(chat, 'Impossible de lire la version disponible. Réessaie plus tard.');
      if (there === here) return tg.send(chat, `Déjà à jour (${here}).`);
      return tg.send(chat, `Version installée : ${here || 'inconnue'}\nVersion disponible : ${there}\nInstaller la mise à jour ?`, { reply_markup: { inline_keyboard: [[{ text: '✅ Valider', callback_data: `x:maj:${there}` }, { text: 'Annuler', callback_data: 'x:non' }]] } });
    },
    '/cle': async (chat) => tg.send(chat, keyMessage({ pending: !!(await readText(KEY_FILE)), installed: !!(await readText('/etc/cockpit/sauvegarde.pub')), url: await cockpitUrl() })),
    '/test_sauvegarde': async (chat) => tg.send(chat, restoreTestMessage(await cockpitUrl())),
    '/jeton': async (chat) => tg.send(chat, tokenMessage(await cockpitUrl())),
    '/nouvelle_cle': async (chat) => tg.send(chat, '⚠️ Nouvelle clé de sauvegarde : les sauvegardes déjà faites deviendront illisibles (le serveur, lui, garde tout). À faire seulement si l’ancienne clé est perdue. Continuer ?', { reply_markup: { inline_keyboard: [[{ text: '✅ Valider', callback_data: 'x:nouvelle-cle' }, { text: 'Annuler', callback_data: 'x:non' }]] } }),
    '/secours': async (chat) => tg.send(chat, SECOURS_TEXT),
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
      if (data === 'nouvelle-cle') {
        delete state.keyNotified; await saveState();
        await fs.writeFile(path.join(STATE, 'cle-demandee'), new Date().toISOString());
        await log('new backup key requested');
        return tg.send(chat, newKeyMessage(await cockpitUrl()));
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

const SECOURS_TEXT = `🧾 Ta fiche de secours papier doit contenir :
1. Clé de sauvegarde (app Mots de passe ; affichée une seule fois dans le Cockpit, page Sauvegardes)
2. Mot de passe root du serveur (app Mots de passe)
3. 10 codes de secours GitHub (github.com/settings/security)
4. 10 codes de secours Google (myaccount.google.com/security)
5. Clé de secours Apple, 28 caractères (Réglages → ton nom → Connexion et sécurité)
6. Code de jumelage du bot (console serveur : grep PAIR /etc/cockpit/bot.env)
7. L’adresse du Cockpit (/cockpit)
Range-la chez toi, jamais en photo ni dans Notes. Une copie dans une enveloppe fermée chez une personne de confiance, si tu veux.
Les scénarios complets (iPhone perdu, iCloud, Telegram, Google, GitHub, serveur) sont dans docs/SECOURS.md de ton dépôt privé.
Je te rappelle de vérifier la fiche tous les 6 mois.`;

function backupLine(b) {
  if (!b) return '💾 Sauvegarde : pas encore faite.';
  const age = Math.round((Date.now() - Date.parse(b.date)) / 3600e3);
  return `💾 Sauvegarde : il y a ${age} h · ${Math.ceil(b.taille / 1024)} Ko · copie hors du serveur : ${b.distant ? 'oui (vérifiée)' : 'NON'}${b.erreur ? ` (${b.erreur})` : ''}`;
}

// A new key (made by root after /nouvelle_cle) waits in KEY_FILE: say once that it is ready, never what it is.
setInterval(async () => {
  const owner = core.ownerId; if (!owner) return;
  const pending = !!(await readText(KEY_FILE));
  if (pending && !state.keyNotified) { state.keyNotified = Date.now(); await saveState(); await tg.send(owner, keyMessage({ pending: true, installed: true, url: await cockpitUrl() })); }
  if (!pending && state.keyNotified) { delete state.keyNotified; await saveState(); await log('backup key taken from the server by the Cockpit page'); }
}, 60e3);

// Report the result of an update, if one just happened.
const result = await readText(path.join(STATE, 'maj-resultat'));
if (result && state.owner) {
  await tg.send(state.owner, result.startsWith('ok') ? `✅ Mise à jour installée (${result.slice(3)}).` : `⚠️ Mise à jour refusée : ${result}. Rien n’a été changé.`).catch(() => {});
  await fs.rm(path.join(STATE, 'maj-resultat'), { force: true });
}

// Hourly check, three levels (alerts.mjs): only incidents and decisions are sent, each once per change.
setInterval(async () => {
  const owner = core.ownerId; if (!owner) return;
  const todayIso = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });
  const current = evaluate({ sante: await readJson(path.join(STATE, 'sante.json'), null), sauvegarde: await readJson(path.join(STATE, 'sauvegarde.json'), null), ficheRappel: state.ficheRappel, todayIso, dossier: await readJson(path.join(STATE, 'data', 'situation.json'), null), prospects: await readJson(path.join(STATE, 'data', 'prospects.json'), null), coffre: await readJson(path.join(STATE, 'data', 'coffre.json'), null) });
  if (queue.size >= 3) current.push({ cause: 'github', level: 'critique', text: `${queue.size} notes n’arrivent pas sur GitHub (jeton expiré ?). Elles sont gardées sur le serveur.` });
  await alertTick({ current, state, send: (m) => tg.send(owner, m), log });
  await saveState();
}, 3600e3);
setTimeout(() => refreshDecisions(), 20e3);
// The « À faire par toi » list follows the projects' files and the checks above every 5 minutes (a few small reads).
setInterval(() => refreshDecisions(), 300e3);

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
