// Integrity of the safe's code (C-113). Two guards, both read-only for the bot:
// 1. before /maj: the bot compares the code of the safe installed on the server with the version offered,
//    and says so when it changes (Sam validates only a change Claude announced: « ⚠️ touche au chiffrement »);
// 2. every hour: root compares the installed app files with what the last /maj installed and writes
//    /var/lib/cockpit/integrite.json; a difference = an alert (somebody changed the code outside /maj).
export const COFFRE_FILES = ['app/coffreclient.mjs', 'app/coffre.mjs', 'src/coffre.mjs', 'app/pdfjs.mjs', 'app/pdfworker.mjs'];
// The pages that carry the safe's script (they could change what runs in Safari too): said, at a lower level.
export const ECRAN_FILES = ['app/server.mjs', 'app/views.mjs', 'app/auth.mjs'];

// « <sha256>  cockpit-app/app/x.mjs » lines (SHA256SUMS published with each version) → { 'app/x.mjs': sha256 }.
export function parseSums(text, prefix = 'cockpit-app/') {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^([a-f0-9]{64}) [ *]?(\S+)$/);
    if (m && m[2].startsWith(prefix)) out[m[2].slice(prefix.length)] = m[1];
  }
  return out;
}

// Files of the safe that the offered version changes. Unknown on either side = counted as changed (never silent).
export function coffreChange(remote, local, files = COFFRE_FILES) {
  if (!remote || !Object.keys(remote).length) return null; // no list published: nothing can be said
  return files.filter((f) => !remote[f] || remote[f] !== local[f]);
}

// Read from the list published WITH the version (same place as the code): it tells what changes, it proves nothing.
export const avertissementMaj = (coffre, ecrans = []) => (coffre === null
  ? 'ℹ️ Je n’ai pas pu comparer le code du coffre (liste absente) : valide seulement si Claude t’a annoncé cette mise à jour.'
  : coffre.length
    ? '⚠️ D’après la liste publiée, cette mise à jour touche au chiffrement du coffre. Valide seulement si Claude te l’a annoncé dans la session Cockpit ; sinon, Annuler et préviens-le.'
    : ecrans && ecrans.length
      ? 'ℹ️ D’après la liste publiée, elle modifie les écrans du Cockpit, pas le chiffrement du coffre.'
      : '🔒 D’après la liste publiée, le code du coffre ne change pas.');
