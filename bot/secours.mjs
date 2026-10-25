// Everything about keys and tokens that the bot may SAY. No secret ever leaves through Telegram:
// the key is shown once on the Cockpit page /sauvegardes (Tailscale + Face ID), the restore test and
// the GitHub token renewal happen on that same page.
import { findSecret } from './secrets.mjs';

const page = (url) => (url ? `${url.replace(/\/$/, '')}/sauvegardes` : 'la page « Sauvegardes » du Cockpit (/cockpit pour l’adresse, après /maj)');

export function keyMessage({ pending, installed, url }) {
  if (pending) return `🔑 Une clé de sauvegarde t’attend dans le Cockpit : ${page(url)} (Tailscale allumé, puis Face ID). Elle ne s’affiche que là, jamais ici. Range-la dans Mots de passe et sur ta fiche papier, puis touche « effacer du serveur ».`;
  if (installed) return 'Il n’y a plus de clé sur le serveur : elle t’a déjà été remise. Elle est dans ton app Mots de passe (« Cockpit — clé de sauvegarde »). Pour la tester : page « Sauvegardes » du Cockpit.';
  return 'Les sauvegardes ne sont pas encore installées sur le serveur, donc pas encore de clé. Dis-le à Claude.';
}
export const restoreTestMessage = (url) => `🧪 Le test de sauvegarde se fait dans le Cockpit, jamais ici (Telegram n’est pas un coffre) : ${page(url)} → « Tester ma clé ».`;
export const tokenMessage = (url) => `🔐 Un jeton GitHub ne se colle jamais dans Telegram. Range-le dans le Cockpit : ${page(url)} → « Nouveau jeton GitHub ».`;
export const newKeyMessage = (url) => `Nouvelle clé en cours. Dans la minute, elle sera affichée UNE fois dans le Cockpit : ${page(url)}. Range-la dans Mots de passe et sur ta fiche papier avant de toucher « effacer du serveur ».`;

// Last barrier on the way out: a message that looks like it carries a secret is never sent.
export function guardSend(send, log = async () => {}) {
  return async (chat, text, extra) => {
    const why = findSecret(String(text ?? ''));
    if (why) { await log(`send refused: message looked like a ${why}`); return send(chat, '🔒 Message retenu : il contenait quelque chose qui ressemble à un secret. Rien n’a été envoyé. Les secrets se lisent dans le Cockpit.'); }
    return send(chat, text, extra);
  };
}
