// Alerts in three levels (REGLES-COMMUNES §I): critique and décision are sent, information stays in /sante.
// A known problem is announced again only when its level changes.
import { remindersFor } from './echeancier.mjs';
import { rappelsDossier } from './rappels.mjs';
import { rappelsProspects } from './prospects.mjs';
import { rappelsCoffre } from './coffre.mjs';
const H = 3600e3;
const fr = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

// todayIso (Paris date) enables the fiscal reminders: one « décision » per deadline at J-30, J-7 and J-1,
// each with its own cause so it is sent exactly once.
export function evaluate({ sante, sauvegarde, ficheRappel, todayIso = null, dossier = null, prospects = null, coffre = null, integrite = null, integriteInstalle = false, now = Date.now() }) {
  const out = [];
  const add = (cause, level, text) => out.push({ cause, level, text });
  if (todayIso) for (const e of remindersFor(todayIso)) add(`echeance:${e.id}:${e.date}:J-${e.jours}`, 'decision', `📅 ${e.jours === 1 ? 'Demain' : `Dans ${e.jours} jours`} (${fr(e.date)}) : ${e.libelle}.${e.statut === 'a_verifier' ? ' Date à revérifier cette année.' : ''} Détail sur l’écran Aujourd’hui du Cockpit.`);
  if (todayIso && dossier) for (const r of rappelsDossier(dossier, todayIso)) add(r.cause, 'decision', r.text);
  if (todayIso && Array.isArray(coffre)) for (const r of rappelsCoffre(coffre, todayIso)) add(r.cause, 'decision', r.text);
  // Prospects: once a day, not before 9 a.m. Paris (no work notification in the night), count only.
  const heure = Number(new Date(now).toLocaleString('fr-FR', { hour: 'numeric', hour12: false, timeZone: 'Europe/Paris' }).replace(/\D/g, ''));
  if (todayIso && Array.isArray(prospects) && heure >= 9) for (const r of rappelsProspects(prospects, todayIso)) add(r.cause, 'decision', r.text);
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
  // Code of the Cockpit changed outside /maj (root compares every hour, C-113). Absent = not installed yet: silent.
  // Two causes: a stopped check followed by a real change must still send the second alert.
  if (integrite && integrite.ok === false && integrite.cause === 'maj') add('integrite', 'critique', 'La dernière mise à jour s’est arrêtée en pleine installation. Refais /maj puis Valider ; n’ouvre pas ton coffre avant.');
  else if (integrite && integrite.ok === false) add('integrite', 'critique', 'Le code des écrans du Cockpit a été modifié sur ton serveur en dehors d’une mise à jour. N’ouvre pas ton coffre et préviens Claude.');
  if (integriteInstalle && !(integrite && Date.parse(integrite.date) > now - 26 * H)) add('integrite-age', 'critique', 'Le contrôle d’intégrité du code du Cockpit ne tourne plus (ou son résultat a disparu). N’ouvre pas ton coffre et préviens Claude.');
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
