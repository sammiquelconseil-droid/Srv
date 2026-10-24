// Bot logic, independent of Telegram and of the filesystem so it can be tested.
import { classify, PROJECTS } from './classify.mjs';

const pad = (n) => String(n).padStart(2, '0');
export const stamp = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

const CHOICES = Object.entries(PROJECTS).map(([k, p]) => ({ text: p.label, callback_data: `p:${k}` }));
export const SECRET_COMMANDS = {
  '/jeton': { name: 'github', prompt: 'Envoie maintenant le jeton GitHub, seul dans un message. Je l’enregistre sur le serveur et j’efface ton message. /annuler pour abandonner.' },
  '/test_sauvegarde': { name: 'age', prompt: 'Colle ta clé de sauvegarde (elle commence par AGE-SECRET-KEY-), seule dans un message. Je l’utilise une seule fois pour ouvrir la dernière sauvegarde, puis je l’oublie et j’efface ton message. /annuler pour abandonner.' },
};

export const ASK = { text: 'HOC, LeadGen, Zaff, Lingfi ou Cockpit ?', reply_markup: { inline_keyboard: [CHOICES.slice(0, 3), CHOICES.slice(3)] } };

export function createCore({ extraWords = () => ({}), owner, pairCode, send, write, log, health, del = async () => {}, storeSecret = async () => {}, extra = {}, now = () => new Date() }) {
  const pending = new Map(); // message_id of the question -> note text
  let ownerId = owner || null;
  let awaitingSecret = null; // name of the secret the next owner message contains

  const describe = (m) => {
    if (m.text) return m.text.trim();
    const cap = m.caption ? ` — ${m.caption.trim()}` : '';
    if (m.photo) return `[photo:${m.photo[m.photo.length - 1].file_id}]${cap}`;
    if (m.voice) return `[vocal à transcrire:${m.voice.file_id}]${cap}`;
    if (m.document) return `[fichier ${m.document.file_name || ''}:${m.document.file_id}]${cap}`;
    return null;
  };

  async function file(project, text, chat) {
    const line = `- ${stamp(now())} — ${text}`;
    const r = await write(project, line);
    await send(chat, `Noté pour ${PROJECTS[project].label}.${r && r.synced ? '' : ' (gardé sur le serveur, pas encore envoyé sur GitHub)'}`);
  }

  async function command(cmd, arg, chat) {
    if (extra[cmd]) return extra[cmd](chat, arg);
    if (SECRET_COMMANDS[cmd]) { awaitingSecret = SECRET_COMMANDS[cmd].name; return send(chat, SECRET_COMMANDS[cmd].prompt); }
    if (cmd === '/annuler') { awaitingSecret = null; return send(chat, 'Annulé.'); }
    if (cmd === '/start') return send(chat, 'Bot personnel prêt. Envoie-moi une note, une photo ou un vocal : je la range dans le bon projet. /sante pour l’état du serveur.');
    if (cmd === '/sante') { const h = await health(); return send(chat, h); }
    if (cmd === '/aide') return send(chat, 'Écris ce que tu veux : je devine le projet (HOC, LeadGen, Zaff, Lingfi, Cockpit) ou je te demande. Commandes : /cockpit, /sante, /maj, /version, /test_sauvegarde, /jeton, /aide.');
    return send(chat, 'Commande inconnue. /aide');
  }

  return {
    get ownerId() { return ownerId; },
    async handle(update) {
      const m = update.message, cq = update.callback_query;
      const from = (m || cq || {}).from || {};
      const chat = m ? m.chat.id : cq ? cq.message.chat.id : null;
      if (!ownerId) {
        if (m && m.text && pairCode && m.text.trim() === `/start ${pairCode}`) {
          ownerId = from.id; await log(`owner paired: ${from.id}`); await send(chat, 'Jumelage réussi : je ne parlerai qu’à toi.'); return;
        }
        await log(`ignored (not paired) from ${from.id}`); return;
      }
      if (from.id !== ownerId) { await log(`ignored stranger ${from.id}`); return; }
      if (cq) {
        if (extra.callback && String(cq.data || '').startsWith('x:')) { await extra.callback(chat, cq.data.slice(2)); return { answer: cq.id }; }
        const note = pending.get(cq.message.message_id);
        const key = String(cq.data || '').replace(/^p:/, '');
        if (note && PROJECTS[key]) { pending.delete(cq.message.message_id); await file(key, note, chat); }
        return { answer: cq.id };
      }
      if (!m) return;
      if (awaitingSecret && m.text && !m.text.startsWith('/')) {
        const name = awaitingSecret; awaitingSecret = null;
        await del(chat, m.message_id);
        const reply = await storeSecret(name, m.text.trim());
        return send(chat, reply || 'Jeton enregistré sur le serveur. Ton message a été effacé de la conversation.');
      }
      if (m.text && m.text.startsWith('/')) { const [cmd, ...rest] = m.text.trim().split(/\s+/); return command(cmd, rest.join(' '), chat); }
      const text = describe(m);
      if (!text) return send(chat, 'Je ne sais pas lire ce type de message. Texte, photo, vocal ou fichier.');
      const { project } = classify(text, extraWords());
      if (project) return file(project, text, chat);
      const sent = await send(chat, ASK.text, { reply_markup: ASK.reply_markup });
      pending.set(sent.message_id, text);
    },
  };
}
