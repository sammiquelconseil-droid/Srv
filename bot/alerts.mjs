// Alerts in three levels (REGLES-COMMUNES §I): critique and décision are sent, information stays in /sante.
// A known problem is announced again only when its level changes.
const H = 3600e3;

export function evaluate({ sante, sauvegarde, ficheRappel, now = Date.now() }) {
  const out = [];
  const add = (cause, level, text) => out.push({ cause, level, text });
  if (!sante || now - Date.parse(sante.date) > 36 * H) add('sante', 'critique', 'Le contrôle de santé du serveur n’a pas tourné depuis plus de 36 h.');
  else {
    if (sante.reseau_prive === false) add('reseau', 'critique', 'Le serveur n’est plus sur ton réseau privé (Tailscale).');
    if (sante.disque_pct > 85) add('disque', 'critique', `Disque du serveur plein à ${sante.disque_pct} %.`);
    else if (sante.disque_pct >= 80) add('disque', 'information', `Disque du serveur à ${sante.disque_pct} %.`);
    if (sante.securite_en_attente > 0 && sante.maj_il_y_a_h > 48) add('maj', 'critique', 'Des mises à jour de sécurité attendent depuis plus de 2 jours.');
    // The health check flags 24 h; the nightly reboot (04:30) can legitimately take up to ~24 h, so 30 h means it was missed.
    if (sante.redemarrage_en_attente_h > 30) add('redemarrage', 'critique', 'Le redémarrage automatique du serveur ne se fait plus.');
    if (sante.ok === false && !out.some((a) => a.level === 'critique')) add('sante-autre', 'critique', 'Le contrôle de santé signale un problème.');
  }
  if (!sauvegarde || now - Date.parse(sauvegarde.date) > 36 * H) add('sauvegarde', 'critique', 'Aucune sauvegarde depuis plus de 36 h.');
  else if (!sauvegarde.distant) add('sauvegarde', 'critique', 'La dernière sauvegarde n’a pas pu être copiée hors du serveur.');
  if (!ficheRappel || now - ficheRappel > 182 * 24 * H) add('fiche', 'decision', 'Rappel semestriel : vérifie ta fiche de secours papier (/secours pour la liste) et mets-y la date du jour.');
  return out;
}

// One hourly tick. The memory is updated only once the message really left: a Telegram failure
// means the same alert is tried again at the next tick, never lost.
export async function alertTick({ current, state, send, log = async () => {}, now = Date.now() }) {
  const { message, known } = toNotify(current, state.alertes || {});
  if (message) { try { await send(message); } catch (e) { await log(`alert send failed: ${e.message}`); return { sent: false }; } }
  if (current.some((a) => a.cause === 'fiche')) state.ficheRappel = now;
  state.alertes = known;
  return { sent: !!message };
}

// known: { cause: level } from the previous run. Returns the message to send (or '') and the new memory.
export function toNotify(current, known = {}) {
  const fresh = current.filter((a) => a.level !== 'information' && known[a.cause] !== a.level);
  const next = Object.fromEntries(current.filter((a) => a.level !== 'information').map((a) => [a.cause, a.level]));
  const crit = fresh.filter((a) => a.level === 'critique'), dec = fresh.filter((a) => a.level === 'decision');
  const parts = [];
  if (crit.length) parts.push('🚨 Incident\n' + crit.map((a) => `• ${a.text}`).join('\n') + '\nDétails : /sante');
  if (dec.length) parts.push('🧑 À faire par toi\n' + dec.map((a) => `• ${a.text}`).join('\n'));
  return { message: parts.join('\n\n'), known: next };
}
