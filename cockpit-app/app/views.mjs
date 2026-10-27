// Server-rendered pages. No script, no external resource: works on iPhone and desktop.
import { ETAPES, trier, compter, aRelancer } from '../src/prospects.mjs';
import { TYPES, filtrer, annee, compterPar, aFaire, libelle, isE2 } from '../src/coffre.mjs';
import { cleTache } from '../src/faits.mjs';
import { ECHEANCES, LIGNES, MENTIONS, SUGGESTIONS, resumeFactures } from '../src/factures.mjs';
import { MODES, TAUX, TAUX_SPECIAUX, BONUS_POINTS, BONUS_MIN_APPORTEURS, resume as apporteursResume, releve as apporteursReleve, key as apporteursKey, codeOf } from '../src/apporteurs.mjs';
import { ACTIVITES, PARAMS as MICRO, resume as microResume, nomMois, PREMIERE_DECLARATION, PREMIERE_A_VERIFIER } from '../src/micro.mjs';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (c) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);
const date = (iso) => iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }) : '—';
const dateCourte = (iso) => iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' }) : '—';
const STATUT = { verifie: ['Vérifié', 'ok'], declare: ['Déclaré', 'info'], estime: ['Estimé', 'warn'], hypothese: ['Hypothèse', 'warn'], a_saisir: ['À saisir', 'muted'], a_verifier: ['À vérifier', 'warn'] };
const badge = (s) => { const [t, c] = STATUT[s] || [s, 'muted']; return `<span class="badge ${c}">${esc(t)}</span>`; };
const pill = (n) => (n ? `<span class="pill">${n}</span>` : '');

// Design: one calm, airy system. Tokens first, dark mode kept, bottom tabs on the phone, cards without
// borders in the light theme, a hero that says in one glance how things are. Phone first, then desktop.
const CSS = `
:root{--bg:#f3f5f9;--card:#ffffff;--ink:#141a24;--ink2:#5b6675;--ink3:#8a94a3;--line:#e6e9ef;--accent:#2457e6;--accent2:#6a3df5;--accentbg:#e9eefc;--ok:#157347;--okbg:#e1f4e9;--warn:#8a5a00;--warnbg:#fff1d6;--bad:#b3261e;--badbg:#fbe4e2;--info:#2457e6;--infobg:#e9eefc;--shadow:0 1px 2px rgba(20,26,36,.04),0 8px 24px rgba(20,26,36,.06);--r:18px;--hero1:#2457e6;--hero2:#6a3df5}
@media (prefers-color-scheme:dark){:root{--bg:#0e1116;--card:#171b22;--ink:#e9ecf1;--ink2:#a9b2bf;--ink3:#737d8b;--line:#272d37;--accent:#86a4ff;--accent2:#b39cff;--accentbg:#1b2440;--ok:#63d697;--okbg:#14301f;--warn:#f2c466;--warnbg:#33270f;--bad:#ff8a80;--badbg:#3a1714;--info:#86a4ff;--infobg:#1b2440;--shadow:none;--hero1:#2748b8;--hero2:#5a34c4}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif}
header{position:sticky;top:0;background:var(--card);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;gap:12px;align-items:center;z-index:2}
header .brand{font-weight:800;font-size:17px;letter-spacing:-.2px;margin-right:auto;display:flex;align-items:center;gap:8px}
header .brand i{width:10px;height:10px;border-radius:50%;background:var(--ok);display:inline-block;box-shadow:0 0 0 3px var(--okbg)}
nav{display:flex;gap:2px}@media(min-width:900px){header nav{flex:1;min-width:0;flex-wrap:wrap}}nav a{color:var(--ink2);text-decoration:none;font-weight:600;padding:8px 10px;border-radius:12px;min-height:44px;line-height:28px;display:inline-flex;align-items:center;gap:6px}
nav a[aria-current]{color:var(--accent);background:var(--accentbg)}nav a em{font-style:normal}
@media(max-width:899px){header nav{position:fixed;left:0;right:0;bottom:0;background:color-mix(in srgb,var(--card) 92%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-top:1px solid var(--line);padding:6px 8px calc(6px + env(safe-area-inset-bottom));justify-content:space-around;z-index:3}
nav a{flex-direction:column;gap:0;padding:4px 4px;font-size:11px;line-height:1.2;min-width:58px;border-radius:14px}nav a em{font-size:22px;line-height:1.1}main{padding-bottom:96px}}
main{max-width:1180px;margin:0 auto;padding:18px 16px 32px}
h1{font-size:30px;line-height:1.15;letter-spacing:-.4px;margin:6px 0 2px;font-weight:800}h2{font-size:17px;margin:0 0 12px;display:flex;align-items:center;gap:8px;letter-spacing:-.1px}
.sub{color:var(--ink2);margin:0 0 14px;font-size:15px}
.hero{background:linear-gradient(135deg,var(--hero1),var(--hero2));color:#fff;border-radius:22px;padding:20px 20px 18px;box-shadow:var(--shadow);margin:4px 0 16px}
.hero h1{color:#fff;margin:0 0 2px}.hero .sub{color:rgba(255,255,255,.85);margin:0 0 14px}
.chips{display:flex;flex-wrap:wrap;gap:8px}.chip{background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.28);color:#fff;border-radius:999px;padding:6px 12px;font-size:13.5px;font-weight:600;white-space:nowrap}
.cards{display:grid;gap:14px}@media(min-width:900px){.cards{grid-template-columns:repeat(3,1fr)}.two{grid-template-columns:1fr 1fr}.cards .wide{grid-column:1/-1}}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:18px;min-width:0;box-shadow:var(--shadow)}
@media (prefers-color-scheme:light){.card{border-color:transparent}}
.pill{margin-left:auto;background:var(--accentbg);color:var(--accent);font-size:13px;font-weight:700;padding:2px 10px;border-radius:999px;min-width:28px;text-align:center}
.empty{display:flex;gap:10px;align-items:center;color:var(--ink2);font-size:15px;padding:6px 0}.empty b{font-size:22px}
.kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:14px}@media(min-width:900px){.kpis{grid-template-columns:repeat(4,1fr)}}
.kpi{background:var(--card);border-radius:var(--r);padding:14px 16px;box-shadow:var(--shadow);border:1px solid var(--line)}@media (prefers-color-scheme:light){.kpi{border-color:transparent}}
.kpi span{display:block;font-size:13px;color:var(--ink2)}.kpi b{font-size:24px;letter-spacing:-.3px;font-variant-numeric:tabular-nums}
.row{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid var(--line);font-size:15px}.row:first-of-type{border-top:0}.row span:first-child{color:var(--ink2)}.row span:last-child{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
.badge{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:999px;margin-left:6px;vertical-align:middle}
.ok{color:var(--ok);background:var(--okbg)}.warn{color:var(--warn);background:var(--warnbg)}.bad{color:var(--bad);background:var(--badbg)}.info{color:var(--info);background:var(--infobg)}.muted{color:var(--ink2);background:var(--bg)}
.bar{height:8px;background:var(--bg);border-radius:4px;overflow:hidden;margin:8px 0 12px}.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:4px}
.alert{border-radius:14px;padding:12px 14px;font-size:14.5px;margin-top:10px}.note{font-size:13.5px;color:var(--ink2);margin-top:10px;line-height:1.5}
ul.plain,ol.plain{list-style:none;padding:0;margin:0}ul.plain li,ol.plain li{padding:10px 0;border-top:1px solid var(--line);font-size:15px}ul.plain li:first-child,ol.plain li:first-child{border-top:0}
.when{display:inline-block;font-size:12.5px;font-weight:700;padding:3px 10px;border-radius:999px;margin-bottom:6px;letter-spacing:.1px}
.when.now{color:#fff;background:var(--accent)}.when.soon{color:var(--warn);background:var(--warnbg)}.when.later{color:var(--ink2);background:var(--bg)}
li.task{padding:14px 0}li.task .t{font-weight:700;font-size:16px;line-height:1.35;display:block}li.task .d{color:var(--ink2);font-size:14px;margin:6px 0 0;line-height:1.5}li.task .w{font-size:13px;color:var(--ink3);margin:6px 0 0}
li.task details{margin-top:6px}li.task form.fait{margin:8px 0 0}li.task form.fait button{min-height:44px;padding:8px 14px;font-size:15px}details.faites{margin-top:12px}details.faites summary{cursor:pointer;color:var(--accent);font-weight:600;font-size:14px}li.task summary{cursor:pointer;color:var(--accent);font-size:14px;font-weight:600;list-style:none}li.task summary::-webkit-details-marker{display:none}li.task summary::after{content:' ▾'}li.task details[open] summary::after{content:' ▴'}
.proj{font-size:12.5px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.6px;margin:14px 0 2px}.proj:first-child{margin-top:0}
.dl{display:flex;gap:12px;align-items:flex-start}.dl .dt{flex:0 0 auto;min-width:64px;text-align:center;background:var(--bg);border-radius:12px;padding:6px 8px;line-height:1.15}.dl .dt b{display:block;font-size:19px;letter-spacing:-.3px}.dl .dt span{font-size:11.5px;color:var(--ink2);text-transform:uppercase;letter-spacing:.4px}
form .f{display:flex;flex-direction:column;gap:4px;margin:10px 0}form label{font-weight:600;font-size:14px;color:var(--ink2)}
input{font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--bg);color:var(--ink);min-height:44px;width:100%}input:focus{outline:2px solid var(--accent);outline-offset:1px;background:var(--card)}
button{font:inherit;font-weight:700;background:var(--accent);color:#fff;border:0;border-radius:14px;padding:12px 18px;min-height:44px;margin-top:8px;cursor:pointer}button.small{padding:8px 12px;margin-top:0;font-size:14px;min-width:44px}@media(max-width:480px){.grid2.stack{grid-template-columns:1fr}}li.row form{margin:0}.grid2>*{min-width:0}select,input,textarea{max-width:100%}
button.ghost{background:transparent;color:var(--ink2);border:1px solid var(--line);padding:6px 12px;margin:0;font-size:14px;min-height:36px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
select,textarea{font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--bg);color:var(--ink);min-height:44px;width:100%}textarea{min-height:72px;resize:vertical}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}h3{font-size:14px;color:var(--ink2);text-transform:uppercase;letter-spacing:.5px;margin:16px 0 4px}
a.btn{display:inline-block;font-weight:700;background:var(--accentbg);color:var(--accent);border-radius:14px;padding:10px 16px;min-height:44px;line-height:24px;text-decoration:none;margin-top:8px}
button.danger{background:var(--badbg);color:var(--bad)}
#papier.plein{position:fixed;inset:0;z-index:60;background:#1c1c1e;overflow:auto;-webkit-overflow-scrolling:touch;padding:calc(60px + env(safe-area-inset-top)) 8px calc(20px + env(safe-area-inset-bottom));margin:0}
footer.foot{display:none}@media(max-width:899px){nav a.more{display:none}footer.foot{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:22px}footer.foot a{color:var(--ink2);font-weight:600;text-decoration:none;padding:10px 14px;border-radius:12px;background:var(--card);min-height:44px}}
.chips.f a{background:var(--card);color:var(--ink2);border:1px solid var(--line);text-decoration:none;border-radius:999px;padding:8px 12px;font-size:14px;font-weight:600;white-space:nowrap;min-height:40px;display:inline-flex;align-items:center}.chips.f a[aria-current]{background:var(--accent);color:#fff;border-color:var(--accent)}
li.doc{display:flex;gap:12px;align-items:flex-start}li.doc .ic{font-size:24px;line-height:1.2}li.doc a.t{font-weight:700;color:var(--ink);text-decoration:none;font-size:16px}li.doc .m{color:var(--ink2);font-size:13.5px;margin-top:2px}li.doc details{margin-top:6px}li.doc summary{cursor:pointer;color:var(--accent);font-size:14px;font-weight:600}
`;

// Five tabs on the phone (bottom bar); « more » ones are in the header on a computer and in the footer on a phone.
const NAV = [['/', '🏠', "Aujourd'hui"], ['/patrimoine', '🏡', 'Patrimoine'], ['/coffre', '🗄', 'Coffre'], ['/dossier', '🗂', 'Dossier'], ['/prospects', '🎯', 'Prospects'], ['/factures', '🧾', 'Factures', 'more'], ['/apporteurs', '🤝', 'Apporteurs', 'more'], ['/micro', '💼', 'Micro-entreprise', 'more'], ['/mes-chiffres', '💶', 'Mes chiffres', 'more'], ['/sauvegardes', '🔐', 'Sauvegardes', 'more']];
function layout(title, current, body, { nonce, script, noNav, ok = true } = {}) {
  const link = ([href, icon, label, more]) => `<a href="${href}"${more ? ' class="more"' : ''}${current === href ? ' aria-current="page"' : ''}><em aria-hidden="true">${icon}</em>${label}</a>`;
  const foot = noNav ? '' : `<footer class="foot">${NAV.filter((n) => n[3]).map(([h, i, l]) => `<a href="${h}">${i} ${l}</a>`).join('')}</footer>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#2457e6"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Cockpit">
<title>${esc(title)} · Cockpit</title><style>${CSS}</style></head><body>
<header><span class="brand"><i style="background:var(--${ok ? 'ok' : 'warn'})"></i>Mon Cockpit</span>${noNav ? '' : `<nav>${NAV.map(link).join('')}</nav><form method="post" action="/deconnexion" style="margin:0"><button type="submit" class="ghost">Verrouiller</button></form>`}</header><main>${body}${foot}</main>${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`;
}

const empty = (icon, text) => `<div class="empty"><b>${icon}</b><span>${text}</span></div>`;

// One line of « Décisions de Sam » → when · gesture · detail · why him. Written as « **Quand · Geste** détail — pourquoi ».
export function parseTask(line) {
  const l = String(line || '').trim();
  const m = l.match(/^\*\*(.+?)\*\*\s*(.*)$/s);
  let quand = '', geste = l.replace(/\*\*/g, ''), reste = '';
  if (m) { const parts = m[1].split(' · '); if (parts.length > 1) { quand = parts[0].trim(); geste = parts.slice(1).join(' · ').trim(); } else geste = m[1].trim(); reste = m[2]; }
  let pourquoi = ''; const i = reste.lastIndexOf(' — '); if (i >= 0) { pourquoi = reste.slice(i + 3).trim(); reste = reste.slice(0, i); }
  reste = reste.replace(/\*\*/g, '').replace(/^[\s—–-]+/, '').trim();
  const urgence = /maintenant|aujourd/i.test(quand) ? 'now' : /avant le|cette semaine|demain/i.test(quand) ? 'soon' : 'later';
  return { quand, geste, reste, pourquoi, urgence };
}
const taskHtml = (line, token) => {
  const t = parseTask(line);
  const detail = !t.reste ? '' : t.reste.length <= 170 ? `<p class="d">${esc(t.reste)}</p>` : `<details><summary>Le détail</summary><p class="d">${esc(t.reste)}</p></details>`;
  const fait = token ? `<form method="post" action="/fait" class="fait"><input type="hidden" name="jeton" value="${esc(token)}"><input type="hidden" name="cle" value="${cleTache(line)}"><button type="submit" class="ghost">✅ C’est fait</button></form>` : '';
  return `<li class="task">${t.quand ? `<span class="when ${t.urgence}">${esc(t.quand)}</span>` : ''}<span class="t">${esc(t.geste)}</span>${detail}${t.pourquoi ? `<p class="w">Pourquoi toi · ${esc(t.pourquoi)}</p>` : ''}${fait}</li>`;
};
// Ticked by mistake: one tap puts it back.
const faitesHtml = (faites, token, auto = []) => {
  const n = (faites || []).length + (auto || []).length;
  if (!n || !token) return '';
  const vus = (auto || []).map((f) => `<li class="task"><span class="t">✔︎ ${esc(parseTask(f.ligne).geste)}</span><p class="w">Vu tout seul par le Cockpit</p></li>`).join('');
  const coches = (faites || []).map((f) => `<li class="task"><span class="t">✅ ${esc(parseTask(f.ligne).geste)}</span><form method="post" action="/fait/annuler" class="fait"><input type="hidden" name="jeton" value="${esc(token)}"><input type="hidden" name="cle" value="${f.cle}"><button type="submit" class="ghost">↩︎ Remettre dans la liste</button></form></li>`).join('');
  return `<details class="faites"><summary>Déjà faits (${n})</summary><ul class="plain">${vus}${coches}</ul></details>`;
};

export function todayPage({ now, sante, sauvegarde, notes, echeances, fiscal = [], alertes, attentes = null, budget = null, token = '', micro = null, factures = null }) {
  const d = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
  const h = Number(now.toLocaleString('fr-FR', { hour: 'numeric', hour12: false, timeZone: 'Europe/Paris' }).replace(/\D/g, ''));
  const hello = h < 5 ? 'Bonne nuit' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
  const total = attentes && attentes.total ? attentes.total : 0;
  const chips = [
    total ? `🧑 ${total} chose${total > 1 ? 's' : ''} à faire` : '🧑 Rien à faire',
    sante ? (sante.ok ? '✅ Serveur en forme' : '⚠️ Serveur à surveiller') : '🖥 Serveur : pas encore de contrôle',
    sauvegarde ? (sauvegarde.distant ? '💾 Sauvegarde vérifiée' : '💾 Copie hors serveur absente') : '💾 Pas encore de sauvegarde',
  ].map((c) => `<span class="chip">${esc(c)}</span>`).join('');
  // What waits for Sam (date · gesture · why him), read by the bot in each project's files, shown HERE only.
  const att = attentes && attentes.projets && attentes.projets.length
    ? attentes.projets.map((p) => `<p class="proj">${esc(p.label)}</p><ol class="plain">${p.lignes.map((l) => taskHtml(l, token)).join('')}</ol>`).join('')
      + faitesHtml(attentes.faites, token, attentes.auto) + `<p class="note">Une ligne s’ajoute ou s’en va toute seule quand le Cockpit peut le vérifier (toutes les 5 minutes) ; sinon touche « ✅ C’est fait ». Mis à jour ${esc(new Date(attentes.date).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }))}, dans l’ordre où les faire. Lu dans les fichiers de tes projets ; le bot ne montre que le nombre.</p>`
    : (attentes ? empty('✨', 'Rien n’attend ta décision. Profite.') + faitesHtml(attentes.faites, token, attentes.auto) : empty('⏳', 'Pas encore lu : le bot remplit cette liste dans l’heure qui suit son démarrage.'));
  const srv = sante ? `${sante.ok ? '<span class="badge ok">En bonne santé</span>' : '<span class="badge bad">À surveiller</span>'}
    <div class="row"><span>Correctifs de sécurité en attente</span><span>${sante.securite_en_attente}</span></div>
    <div class="row"><span>Disque utilisé</span><span>${sante.disque_pct} %</span></div>
    <div class="row"><span>Réseau privé</span><span>${sante.reseau_prive ? 'oui' : 'NON'}</span></div>` : empty('🖥', 'Pas encore de contrôle.');
  const sv = sauvegarde ? `${sauvegarde.distant ? '<span class="badge ok">Copie hors serveur vérifiée</span>' : '<span class="badge bad">Copie hors serveur absente</span>'}
    <div class="row"><span>Dernière</span><span>${esc(new Date(sauvegarde.date).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }))}</span></div>
    <div class="row"><span>Taille</span><span>${Math.ceil(sauvegarde.taille / 1024)} Ko</span></div>` : empty('💾', 'Pas encore de sauvegarde.');
  const dl = (iso) => { const dd = new Date(iso + 'T12:00:00Z'); return `<div class="dt"><b>${dd.toLocaleDateString('fr-FR', { day: 'numeric', timeZone: 'Europe/Paris' })}</b><span>${esc(dd.toLocaleDateString('fr-FR', { month: 'short', timeZone: 'Europe/Paris' }).replace('.', ''))}</span></div>`; };
  const ech = echeances.length ? `<ul class="plain">${echeances.map((e) => `<li class="dl">${dl(e.date)}<div><b>${esc(e.nom)}</b><div class="d" style="color:var(--ink2);font-size:14px">${eur(e.montantCents)}</div></div></li>`).join('')}</ul><p class="note">Montants prévus par les actes. Le paiement réel sera confirmé par ton relevé bancaire.</p>` : empty('🗓', 'Aucune échéance dans les 30 prochains jours.');
  const fis = fiscal.length ? `<ul class="plain">${fiscal.map((e) => `<li class="dl">${dl(e.date)}<div><b>${esc(e.libelle)}</b> ${badge(e.statut)}<div class="note" style="margin-top:4px">${esc(e.note)}</div></div></li>`).join('')}</ul>` : empty('🧾', 'Aucune échéance d’impôt ou d’URSSAF dans les 45 prochains jours.');
  const nts = notes.length ? `<ul class="plain">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : empty('💬', 'Aucune note. Envoie-en une à ton bot Telegram.');
  const al = alertes.map((a) => `<div class="alert warn">⚠️ ${esc(a)}</div>`).join('');
  const bud = budget ? `<div class="row"><span>Entrées (salaire + loyers)</span><span>${budget.complet ? eur(budget.entrees) : `${eur(budget.entrees)} + salaire ?`}</span></div>
    <div class="row"><span>Mensualités des biens</span><span>− ${eur(budget.mensualites)}</span></div>
    <div class="row"><span>Abonnements</span><span>− ${eur(budget.abonnements)}</span></div>
    <div class="row"><span>Dépenses fixes</span><span>− ${eur(budget.charges)}</span></div>
    <div class="row"><span><b>Il reste (estimé)</b></span><span><b>${budget.complet ? eur(budget.solde) : '—'}</b></span></div>
    <p class="note">${budget.complet ? 'Estimation à partir de ton dossier, pas ton compte en banque : sans impôts, cotisations ni dépenses imprévues.' : 'Saisis ton salaire dans « Mes chiffres » pour voir ce qu’il reste.'} Liste à compléter dans « Dossier ».</p>` : '';
  return layout("Aujourd'hui", '/', `<section class="hero"><h1>${hello} Sam 👋</h1><p class="sub">${esc(d)}</p><div class="chips">${chips}</div></section>${al}
  <div class="cards">
   <section class="card wide"><h2>🧑 À faire par toi${pill(total)}</h2>${att}</section>
   ${bud ? `<section class="card"><h2>💶 Budget du mois</h2>${bud}</section>` : ''}
   ${factures && factures.nbOuvertes ? `<section class="card"><h2>🧾 À encaisser</h2><div class="row"><span>${factures.nbOuvertes} facture${factures.nbOuvertes > 1 ? 's' : ''} pas encore payée${factures.nbOuvertes > 1 ? 's' : ''}</span><span>${eur(factures.aEncaisser)}</span></div>${factures.enRetard.length ? `<p class="alert warn">${factures.enRetard.length} en retard : relance ton client.</p>` : ''}<p class="note"><a href="/factures">Voir mes factures →</a></p></section>` : ''}
   ${micro && (micro.caAnnee || micro.aGarder) ? `<section class="card"><h2>💼 Micro-entreprise</h2><div class="row"><span>Reçu en ${esc(micro.annee)}</span><span>${eur(micro.caAnnee)}</span></div><div class="row"><span>Seuil de TVA</span><span>${micro.tva.niveau === 'due' ? 'TVA due' : `${micro.tva.pctBase} %`}</span></div><div class="row"><span>À garder de côté</span><span>${eur(micro.aGarder)}</span></div><p class="note"><a href="/micro">Ce qu’il faut déclarer →</a></p></section>` : ''}
   <section class="card"><h2>🗓 Échéances à venir <span class="note" style="margin:0;font-weight:500">30 jours</span></h2>${ech}</section>
   <section class="card"><h2>🧾 Impôts et URSSAF (45 jours)</h2>${fis}<p class="note">Le bot te prévient 30 jours, 7 jours et la veille. Une échéance n’est jamais comptée comme payée sans ta confirmation.</p></section>
   <section class="card"><h2>💬 Dernières notes</h2>${nts}</section>
   <section class="card"><h2>🖥 Serveur</h2>${srv}</section>
   <section class="card"><h2>💾 Sauvegarde</h2>${sv}</section>
  </div>`, { ok: !sante || sante.ok });
}

export function patrimoinePage({ summary, asOf, vide = false, papiers = {} }) {
  const t = summary.totals;
  const kpis = `<div class="kpis">
   <div class="kpi"><span>Reste à payer (théorique)</span><b>${eur(t.restantCents)}</b></div>
   <div class="kpi"><span>Mensualités</span><b>${eur(t.mensualitesCents)}</b></div>
   <div class="kpi"><span>Loyers bruts / mois</span><b>${eur(t.loyersCents)}</b></div>
   <div class="kpi"><span>Loyers − mensualités</span><b>${eur(t.fluxBrutCents)}</b></div></div>
   <p class="note" style="margin:0 0 14px">« Loyers − mensualités » est un flux brut : avant charges, taxe foncière, assurance et impôts. Ce n'est ni ton bénéfice ni ton revenu imposable.</p>`;
  const cards = summary.biens.map((b) => {
    const f = b.financement; const bal = b.balance;
    const loyers = b.loyers.length ? b.loyers.map((l) => `<div class="row"><span>Loyer ${esc(l.libelle.toLowerCase())}${badge(l.statut)}</span><span>${eur(l.montantCents)} / mois</span></div>`).join('') : `<div class="row"><span>Loyer</span><span>0 € · ${esc(b.situation)}</span></div>`;
    const hyp = (b.hypotheses || []).map((h) => `<div class="row"><span>${esc(h.libelle)}${badge(h.statut)}</span><span>${eur(h.montantCents)}</span></div>`).join('');
    const al = (b.alertes || []).map((a) => `<div class="alert warn">⚠️ ${esc(a)}</div>`).join('');
    return `<section class="card"><h2>🏡 ${esc(b.nom)}</h2><p class="sub" style="margin:-6px 0 10px">${esc(b.type)} · ${esc(b.situation)}</p>
     <div class="row"><span>Achat${badge((b.achat || {}).statut)}</span><span>${eur((b.achat || {}).prixCents || 0)} · ${esc(date((b.achat || {}).date))}</span></div>
     ${f && bal ? `<div class="row"><span>${esc(f.type)}${badge('estime')}</span><span>reste ${eur(bal.balanceCents)}</span></div>
     <div class="bar" role="img" aria-label="${Math.round(b.progress * 100)} % payé"><i style="width:${(b.progress * 100).toFixed(1)}%"></i></div>
     <div class="row"><span>Mensualité</span><span>${eur(f.mensualiteCents)}</span></div>
     <div class="row"><span>Échéances restantes</span><span>${bal.remaining} sur ${f.nombre}</span></div>
     <div class="row"><span>Prochaine</span><span>${esc(date(b.next))}</span></div>
     <div class="row"><span>Dernière</span><span>${esc(date(b.end))}</span></div>` : '<div class="row"><span>Crédit</span><span>aucun</span></div>'}
     ${loyers}${hyp}${al}${f ? `<p class="note">Paiement : ${esc(f.paiement || '—')}.</p>` : ''}<a class="btn" href="/coffre?r=${encodeURIComponent('bien:' + b.id)}">📎 Ses papiers (${papiers['bien:' + b.id] || 0})</a></section>`;
  }).join('');
  const body = vide ? `<section class="card">${empty('🗂', 'Aucun bien pour l’instant.')}<a class="btn" href="/dossier">Remplir mon dossier</a></section>` : `${kpis}<div class="cards">${cards}</div><p style="margin-top:14px"><a class="btn" href="/dossier">✏️ Modifier mon dossier</a></p>`;
  return layout('Patrimoine', '/patrimoine', `<h1>Patrimoine</h1><p class="sub">Calculé au ${esc(date(asOf))}, en supposant toutes les échéances payées jusqu'ici. La valeur actuelle des biens n'est pas encore estimée.</p>${body}`);
}

export function chiffresPage({ data, prive, token, message }) {
  const v = (k) => (prive && prive[k] != null ? (prive[k].montantCents / 100).toFixed(2).replace('.', ',') : '');
  const when = (k) => (prive && prive[k] ? ` <span class="badge info">Saisi le ${esc(new Date(prive[k].le).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }))}</span>` : '');
  const abos = data.abonnements.map((a, i) => `<div class="f"><label for="abo${i}">${esc(a.nom)} ${badge(a.statut)}${when('abo:' + a.nom)}</label>
    <input id="abo${i}" name="abo:${esc(a.nom)}" inputmode="decimal" autocomplete="off" placeholder="${(a.montantCents / 100).toFixed(2).replace('.', ',')} (${esc((STATUT[a.statut] || [a.statut])[0].toLowerCase())})" value="${v('abo:' + a.nom)}"></div>`).join('');
  return layout('Mes chiffres', '/mes-chiffres', `<h1>Mes chiffres</h1>
  <p class="sub">Ces montants restent sur ton serveur privé (et dans tes sauvegardes chiffrées). Ils ne vont jamais sur GitHub ni dans une conversation.</p>
  ${message ? `<div class="alert ${message.ok ? 'ok' : 'bad'}">${esc(message.text)}</div>` : ''}
  <form method="post" action="/mes-chiffres" class="cards two" style="margin-top:12px">
   <input type="hidden" name="jeton" value="${esc(token)}">
   <section class="card"><h2>💼 Revenus</h2>
    <div class="f"><label for="salaire">Salaire net mensuel (€)${when('salaire')}</label><input id="salaire" name="salaire" inputmode="decimal" autocomplete="off" placeholder="ex. 1 650,00" value="${v('salaire')}"></div>
    <p class="note">Laisse vide ce que tu ne sais pas encore.</p></section>
   <section class="card"><h2>🔁 Abonnements réels (€ / mois)</h2>${abos}
    <button type="submit">Enregistrer</button></section>
  </form>`);
}

// « Ma micro-entreprise » (src/micro.mjs): received per month and activity → URSSAF lines, money to set aside, gauges.
const dateFr = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
const TVA_TEXTE = (t) => ({
  ok: 'Tu es loin du seuil : pas de TVA à facturer.',
  orange: 'Tu approches du seuil : surveille tes encaissements de fin d’année.',
  rouge: `Seuil de ${eur(t.base)} passé : TVA à facturer à partir du 1er janvier prochain. Et si tu passes ${eur(t.majore)} cette année, dès le jour du dépassement. Préviens Claude.`,
  due: 'L’an dernier, tu as passé le seuil de TVA : tu dois facturer la TVA depuis le 1er janvier. Préviens Claude aujourd’hui.',
  depasse: '2e seuil passé : tu dois facturer la TVA dès maintenant. Préviens Claude aujourd’hui.',
})[t.niveau];
export function microPage({ data, enc = null, todayIso, token, message, sent = null }) {
  const r = microResume(data, todayIso, enc);
  const warn = '<span class="badge warn">taux à vérifier</span>';
  const gauge = (p, label) => `<div class="bar" role="img" aria-label="${p} % ${esc(label)}"><i style="width:${Math.min(100, p)}%"></i></div>`;
  const mois = (x) => `<li class="task"><span class="t">${esc(nomMois(x.mois))}${x.enCours ? ' (mois en cours)' : ''} — à déclarer avant le ${esc(dateFr(x.echeance))}</span>
      ${ACTIVITES.filter(([, , , debut]) => x.mois >= debut).map(([k, , ligne]) => `<div class="row"><span>${esc(ligne[0].toUpperCase() + ligne.slice(1))}</span><span>${eur(x[k])}</span></div>`).join('')}
      ${x.total ? `<div class="row"><span>Cotisations estimées ${warn}</span><span>${eur(x.cotis)}</span></div>
      <div class="row"><span><b>À mettre de côté</b> (cotisations + ${MICRO.provisionImpotPct} % pour l’impôt)</span><span><b>${eur(x.deCote)}</b></span></div>` : '<p class="note">Rien reçu : déclare 0 €, c’est obligatoire quand même.</p>'}</li>`;
  const aVenir = r.mois.filter((x) => x.aDeclarer).reverse(), passes = r.mois.filter((x) => !x.aDeclarer).reverse();
  const declare = `<ul class="plain">${aVenir.map(mois).join('')}</ul>
      ${r.mois.some((x) => x.mois <= '2027-01' && x.aDeclarer) ? `<p class="note">Sur autoentrepreneur.urssaf.fr › Déclarer et payer : un montant par mois et par ligne. Ta 1re déclaration (au plus tard le ${esc(dateFr(PREMIERE_DECLARATION))}${PREMIERE_A_VERIFIER ? ' <span class="badge warn">date à vérifier dans ton espace URSSAF</span>' : ''}) regroupe octobre, novembre, décembre et janvier, chacun à part, zéros compris.</p>` : '<p class="note">Chaque mois sur autoentrepreneur.urssaf.fr › Déclarer et payer, même à 0 €. Si la date tombe un week-end, tu as jusqu’au jour ouvré suivant.</p>'}
      ${passes.length ? `<details><summary>Mois déjà passés (${passes.length})</summary><ul class="plain">${passes.map(mois).join('')}</ul></details>` : ''}`;
  const v = (m, k) => { const b = sent && `m.${m}.${k}` in sent ? sent[`m.${m}.${k}`] : (((data && data.mois) || {})[m] || {})[k]; return typeof b === 'number' ? (b / 100).toFixed(2).replace('.', ',').replace(',00', '') : esc(b || ''); };
  const lignes = [...r.mois].reverse().map((x) => `<fieldset style="border:0;padding:0;margin:0 0 12px"><legend style="font-weight:700;margin-bottom:4px">${esc(nomMois(x.mois))}</legend><div class="grid2">${ACTIVITES.filter(([, , , debut]) => x.mois >= debut).map(([k, label]) => `<div class="f"><label for="m-${x.mois}-${k}">${esc(label)} (€)${x.factures[k] ? ` — en plus de tes factures payées (${eur(x.factures[k])})` : ''}</label><input id="m-${x.mois}-${k}" name="m.${x.mois}.${k}" inputmode="decimal" autocomplete="off" placeholder="0" value="${v(x.mois, k)}"></div>`).join('')}</div></fieldset>`).join('');
  const prorata = r.tva.prorata ? `<p class="note">Année de création : le seuil est ramené à tes ${MICRO.creation.jours} jours d’activité (37 500 € × ${MICRO.creation.jours}/365). <span class="badge warn">règle à vérifier</span></p>` : '';
  const pc = (n) => String(n).replace('.', ',');
  return layout('Micro-entreprise', '/micro', `<section class="hero"><h1>💼 Ma micro-entreprise</h1>
   <p class="sub">Ce que tu as reçu chaque mois, ce que tu déclares à l’URSSAF et ce que tu mets de côté. Tout reste sur ton serveur.</p>
   <div class="chips"><span class="chip">💶 ${esc(r.annee)} : ${eur(r.caAnnee)} reçus</span><span class="chip">🧾 TVA : ${r.tva.niveau === 'due' ? 'due' : `${r.tva.pctBase} % du seuil`}</span><span class="chip">💰 À garder : ${eur(r.aGarder)}</span></div></section>
  ${message ? `<div class="alert ${message.ok ? 'ok' : 'bad'}">${esc(message.text)}</div>` : ''}
  <div class="cards">
   <section class="card wide"><h2>📮 À déclarer à l’URSSAF</h2>${declare}</section>
   <section class="card"><h2>🧾 Seuil de TVA ${badge(r.tva.prorata ? MICRO.creation.statut : MICRO.tva.statut)}</h2>${gauge(r.tva.pctBase, 'du seuil de TVA')}
    <p class="${r.tva.niveau === 'ok' ? 'note' : 'alert warn'}">${esc(TVA_TEXTE(r.tva))}</p>
    <div class="row"><span>Reste avant ${eur(r.tva.base)}</span><span>${eur(r.tva.resteBase)}</span></div>
    <div class="row"><span>Reste avant ${eur(r.tva.majore)}</span><span>${eur(r.tva.resteMajore)}</span></div>
    ${prorata}<p class="note">Toutes tes activités comptent ensemble. Le bot te prévient à 80 %, sans jamais écrire de montant.</p></section>
   <section class="card"><h2>📈 Plafond de la micro-entreprise ${badge(MICRO.plafondMicro.statut)}</h2>${gauge(r.plafond.pct, 'du plafond')}
    <div class="row"><span>Utilisé en ${esc(r.annee)}</span><span>${r.plafond.pct} %</span></div>
    <div class="row"><span>Reste avant ${eur(r.plafond.cents)}</span><span>${eur(r.plafond.reste)}</span></div></section>
   <section class="card"><h2>💰 À garder de côté : ${eur(r.aGarder)}</h2>
    <p class="note">Les cotisations pas encore payées (jusqu’à la date de chaque déclaration) et la réserve pour l’impôt de chaque année (gardée jusqu’au 30 septembre de l’année suivante, quand l’impôt est réglé).</p></section>
   <section class="card wide"><h2>✏️ Ce que tu as reçu</h2>
    <p class="note">Écris l’argent <b>réellement arrivé sur ton compte</b> dans le mois (pas ce que tu as facturé) : tout ce que tes clients t’ont payé, frais que tu leur refactures compris. Vide = rien reçu. Vendix commence en novembre 2026. <b>Tes factures marquées payées comptent déjà toutes seules</b> : n’écris ici que l’argent reçu sans facture du Cockpit.</p>
    <form method="post" action="/micro"><input type="hidden" name="jeton" value="${esc(token)}">${lignes}<button type="submit">Enregistrer</button></form>
    <p class="note">Taux utilisés : ${pc(MICRO.taux.bnc.pct)} % (libéral) et ${pc(MICRO.taux.bic.pct)} % (Vendix), plus la formation professionnelle (${pc(MICRO.formation.bnc)} % et ${pc(MICRO.formation.bic)} %), d’après plusieurs sources concordantes : à confirmer sur ton espace URSSAF à ta 1re déclaration. Les ${MICRO.provisionImpotPct} % pour l’impôt sont une réserve de prudence, pas un calcul d’impôt.</p></section>
  </div>`);
}

// « 🧾 Factures » (src/factures.mjs): create, PDF, paid in one tap (→ « Ma micro-entreprise »), cancel by a credit note.
export function facturesPage({ data, todayIso, token, message, sent = null }) {
  const k = dossierKit(sent);
  const e = data.emetteur;
  const r = resumeFactures(data, todayIso);
  const val = (name, v) => (sent && name in sent ? sent[name] : v);
  const hid = `<input type="hidden" name="jeton" value="${esc(token)}">`;
  const act = Object.fromEntries(ACTIVITES.map(([kk, label]) => [kk, label]));
  const statut = (f) => (f.avoir ? '<span class="badge muted">Annulée</span>' : f.payee ? `<span class="badge ok">Payée le ${esc(dateFr(f.payee.date))}</span>` : f.echeance < todayIso ? '<span class="badge bad">En retard</span>' : '<span class="badge info">À encaisser</span>');
  const ligne = (f) => `<li class="task"><span class="t">${esc(f.numero)} · ${esc(f.client.nom)} · <b>${eur(f.total)}</b></span>
      <div class="row"><span>${esc(f.periode)} · ${esc(act[f.activite] || '')}</span>${statut(f)}</div>
      <p class="note" style="margin:4px 0">Émise le ${esc(dateFr(f.date))}${f.avoir ? '' : ` · à payer ${f.echeance === f.date ? 'à réception' : `avant le ${esc(dateFr(f.echeance))}`}`}</p>
      <p style="margin:6px 0"><a class="btn" href="/factures/${esc(f.numero)}.pdf">📄 Facture (PDF)</a>${f.avoir ? ` <a class="btn" href="/factures/${esc(f.avoir.numero)}.pdf">📄 Avoir ${esc(f.avoir.numero)}</a>` : ''}</p>
      ${!f.avoir && !f.payee ? `<form method="post" action="/factures/payee" class="grid2">${hid}<input type="hidden" name="numero" value="${esc(f.numero)}"><div class="f"><label for="d-${esc(f.numero)}">Payée le</label><input id="d-${esc(f.numero)}" name="date" type="date" value="${esc(todayIso)}" max="${esc(todayIso)}"></div><div class="f" style="align-self:end"><button type="submit">✅ Marquer payée</button></div></form>
      <details><summary>Une erreur dans cette facture ?</summary><p class="note">Une facture ne se modifie pas et ne s’efface pas (c’est la loi : numéros qui se suivent). Tu l’annules par un « avoir », puis tu en refais une juste.</p><form method="post" action="/factures/annuler">${hid}<input type="hidden" name="numero" value="${esc(f.numero)}"><button type="submit">Annuler ${esc(f.numero)} par un avoir</button></form></details>` : ''}
      ${f.payee && !f.avoir ? `<details><summary>Marquée payée par erreur, ou client à rembourser ?</summary><form method="post" action="/factures/retirer">${hid}<input type="hidden" name="numero" value="${esc(f.numero)}"><button type="submit">Retirer le paiement (erreur de ma part)</button></form><p class="note">Le client n’a en fait jamais payé : le paiement ne compte plus dans ta page Micro-entreprise.</p>
       <form method="post" action="/factures/annuler">${hid}<input type="hidden" name="numero" value="${esc(f.numero)}"><button type="submit">Je rembourse le client : faire un avoir</button></form><p class="note">Le remboursement est retiré de ton chiffre d’affaires du mois de l’avoir (pas du mois du paiement, déjà déclaré).</p></details>` : ''}</li>`;
  const list = [...(data.factures || [])].reverse();
  const coord = `<form method="post" action="/factures/coordonnees">${hid}
     <div class="grid2">${k.inp('nom', 'Ton prénom et ton nom', e && e.nom, { max: 80, ph: 'tel que sur ton avis de situation' })}${k.inp('commercial', 'Nom commercial (facultatif)', e ? e.commercial : 'Vendix', { max: 60 })}</div>
     ${k.area('adresse', 'Adresse de ton entreprise (3 lignes au plus)', e && e.adresse, 'n° et rue\ncode postal et ville')}
     <div class="grid2">${k.inp('siret', 'SIRET (14 chiffres)', e && e.siret, { mode: 'numeric', max: 20 })}${k.inp('email', 'E-mail (facultatif)', e && e.email, { type: 'email', max: 120 })}</div>
     ${k.inp('rcs', 'Immatriculation, si tu en as une (facultatif)', e && e.rcs, { max: 60, ph: 'ex. RCS Bobigny 123 456 789 — voir annuaire-entreprises.data.gouv.fr' })}
     ${k.area('paiement', 'Comment te payer (écrit sur chaque facture)', e ? e.paiement : 'Par virement bancaire (coordonnées jointes à la facture).', '')}
     <p class="note">N’écris pas ton IBAN ici : envoie ton RIB à part (PDF de ta banque), une seule fois à chaque client.</p>
     <button type="submit">💾 Enregistrer mes coordonnées</button></form>`;
  const lignesForm = Array.from({ length: LIGNES }, (_, j) => j + 1).map((i) => `<div>${k.inp(`l${i}_designation`, `Ligne ${i} : ce que tu factures`, '', { max: 120, ph: i === 1 ? 'ex. Abonnement Vendix, formule Boutique, novembre 2026' : 'facultatif' }).replace('<input ', '<input list="suggestions" ')}<div class="grid2">${k.inp(`l${i}_qte`, 'Quantité', '', { mode: 'numeric', ph: '1', max: 3 })}${k.inp(`l${i}_pu`, 'Prix (€)', '', { mode: 'decimal', ph: i === 1 ? 'ex. 249' : '0 = offert', max: 12 })}</div></div>`);
  const nouvelle = `<form method="post" action="/factures">${hid}<input type="hidden" name="envoi" value="${esc(globalThis.crypto.randomUUID())}">
     <div class="grid2">${k.inp('client_nom', 'Client (nom ou raison sociale)', '', { max: 80, ph: 'ex. Les Zaff' })}${k.inp('client_siren', 'SIREN du client (s’il en a un)', '', { mode: 'numeric', max: 11, ph: '9 chiffres, facultatif' })}</div>
     ${k.area('client_adresse', 'Adresse du client (3 lignes au plus)', '', 'n° et rue\ncode postal et ville')}
     <div><div class="f"><label for="client_pro">Ton client est</label><select id="client_pro" name="client_pro"><option value="1"${val('client_pro', '1') === '1' ? ' selected' : ''}>un professionnel (vendeur, entreprise)</option><option value="0"${val('client_pro', '1') === '0' ? ' selected' : ''}>un particulier</option></select></div>
      <div class="f"><label for="activite">Activité</label><select id="activite" name="activite">${ACTIVITES.filter(([, , , debut]) => todayIso >= `${debut}-01`).map(([kk, label]) => `<option value="${kk}"${val('activite', 'bic') === kk ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></div></div>
     <div class="grid2">${k.inp('periode', 'Période ou date de la prestation', '', { max: 60, ph: 'ex. novembre 2026' })}<div class="f"><label for="echeance">À payer</label><select id="echeance" name="echeance">${ECHEANCES.map(([kk, l]) => `<option value="${kk}"${val('echeance', '0') === kk ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div></div>
     ${lignesForm.slice(0, 2).join('')}<details><summary>Plus de lignes</summary>${lignesForm.slice(2).join('')}</details>
     <datalist id="suggestions">${SUGGESTIONS.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
     <p class="note">En touchant une ligne, des débuts de phrase te sont proposés : choisis-en un et complète. Vérifie bien : une fois créée, une facture ne se modifie plus (tu pourras seulement l’annuler par un avoir). Numéro et date sont mis tout seuls. Client à l’étranger : demande-moi avant (autres mentions).</p>
     <button type="submit">🧾 Créer la facture</button></form>`;
  return layout('Factures', '/factures', `<section class="hero"><h1>🧾 Mes factures</h1>
   <p class="sub">Tu crées la facture, tu l’envoies en PDF, tu la marques payée : le montant va tout seul dans ta page Micro-entreprise. Tout reste sur ton serveur.</p>
   <div class="chips"><span class="chip">💶 À encaisser : ${eur(r.aEncaisser)} (${r.nbOuvertes})</span><span class="chip">${r.enRetard.length ? `⏰ ${r.enRetard.length} en retard` : '✅ Aucun retard'}</span></div></section>
  ${message ? `<div class="alert ${message.ok ? 'ok' : 'bad'}">${esc(message.text)}${message.ok ? '' : ' Ce que tu as tapé est encore là : corrige la case et recommence.'}</div>` : ''}
  <div class="cards">
   ${e ? `<section class="card wide"><h2>➕ Nouvelle facture</h2>${nouvelle}</section>` : `<section class="card wide"><h2>👤 D’abord, tes coordonnées (une seule fois)</h2><p class="note">Elles sont écrites en haut de chaque facture. Ton SIRET est sur ton avis de situation (INSEE) ou sur annuaire-entreprises.data.gouv.fr.</p>${coord}</section>`}
   <section class="card wide"><h2>📋 Mes factures</h2>${list.length ? `<ul class="plain">${list.map(ligne).join('')}</ul>` : '<div class="empty"><b>🧾</b><span>Aucune facture pour l’instant.</span></div>'}
    <p class="note">Pour l’envoyer : ouvre le PDF, touche le bouton Partager (carré avec une flèche), puis WhatsApp, Mail ou Messages.</p></section>
   ${e ? `<section class="card wide"><details><summary>👤 Mes coordonnées sur les factures</summary>${coord}</details></section>` : ''}
   <section class="card wide"><h2>⚖️ Ce qui est écrit sur chaque facture ${badge(MENTIONS.statut)}</h2><ul class="plain">
    <li>Ton nom suivi de « EI » (entrepreneur individuel), ton adresse, ton SIRET (et ton immatriculation si tu en as une).</li>
    <li>Un numéro qui se suit sans trou (F2026-001, F2026-002…), la date, le client, ce que tu factures et le prix.</li>
    <li>« ${esc(MENTIONS.tva.texte)} » : tu ne factures pas de TVA tant que tu restes sous le seuil (voir ta page Micro-entreprise). Le numéro de cette loi doit changer en 2027 : je mettrai la phrase à jour.</li>
    <li>Pour un client professionnel : les pénalités de retard et l’indemnité de 40 €, obligatoires sur la facture même si tu ne les réclames pas.</li>
    <li>Chaque facture garde pour toujours tes coordonnées et ces mentions telles qu’au jour où tu l’as faite.</li>
    <li>Garde tes factures 10 ans : elles restent ici et dans tes sauvegardes.</li></ul>
    <p class="note">Liste vérifiée sur plusieurs guides concordants ; les sites officiels n’étaient pas joignables depuis ma session le 27/10 : à confirmer (service-public.fr, fiche « Factures : mentions obligatoires »).</p></section>
  </div>`);
}

// « 🤝 Apporteurs » (src/apporteurs.mjs): who brings clients, what they earn (from the paid invoices), what Sam paid.
export function apporteursPage({ data, factures, todayIso, token, message, sent = null, facturesIllisibles = false, enLigne = null }) {
  const k = dossierKit(sent);
  const r = apporteursResume(data, factures, todayIso);
  const hid = `<input type="hidden" name="jeton" value="${esc(token)}">`;
  const dfr = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
  const clientsFactures = [...new Set((factures.factures || []).map((f) => f.client && f.client.nom).filter(Boolean))].filter((n) => !data.clients.some((c) => apporteursKey(c.nom) === apporteursKey(n)));
  const actifs = r.apporteurs.filter((a) => a.actif);
  const card = (a) => `<section class="card"${a.actif ? '' : ' style="opacity:.6"'}><h3 style="margin-top:0">${esc(a.nom)} ${a.rang ? `<span class="badge info">n°${a.rang}</span>` : '<span class="badge muted">En pause</span>'}${a.contrat ? '' : ' <span class="badge warn">Contrat à signer</span>'}${a.parrain ? ` <span class="badge muted">présenté par ${esc((r.apporteurs.find((x) => x.id === a.parrain) || {}).nom || '')}</span>` : ''}</h3>
    <p class="note" style="margin:0 0 6px">${a.contact ? `${esc(a.contact)} · ` : ''}depuis le ${esc(dfr(a.depuis))}${a.taux ? ` · <b>${esc((TAUX_SPECIAUX.find(([kk]) => kk === a.taux) || [])[1] || a.taux)}</b>` : ''}</p>
    <div class="row"><span>À verser ce mois</span><span><b>${eur(a.ceMois)}</b></span></div>
    <div class="row"><span>${a.solde < 0 ? 'Trop versé (à déduire du prochain)' : 'Reste à verser (tout compris)'}</span><span><b>${eur(Math.abs(a.solde))}</b></span></div>
    <div class="row"><span>Dû depuis le début · déjà versé</span><span>${eur(a.du)} · ${eur(a.verse)}</span></div>
    ${a.aVenir ? `<div class="row"><span>Le mois prochain (déjà encaissé)</span><span>${eur(a.aVenir)}</span></div>` : ''}
    ${a.objectif ? `<p class="${a.objectif.ok ? 'alert ok' : a.objectif.depasse ? 'alert bad' : 'note'}">Objectif : ${a.objectif.atteints}/${a.objectif.clients} boutiques payantes avant le ${esc(dfr(a.objectif.avant))}${a.objectif.ok ? ' ✅ atteint' : a.objectif.depasse ? ' — pas atteint : son abonnement devient payant' : ''}${a.objectif.offert_jusqua ? ` · abonnement offert jusqu’au ${esc(dfr(a.objectif.offert_jusqua))}` : ''}</p>` : ''}
    <h4 style="margin:10px 0 4px">Ses boutiques (${a.clients.length})</h4>
    ${a.clients.length ? `<ul class="plain">${a.clients.map((c) => `<li class="row"><span>${esc(c.nom)}<br><small class="note">${c.premierPaiement ? `${c.payees} mois payé${c.payees > 1 ? 's' : ''}, 1er le ${esc(dfr(c.premierPaiement))}` : 'pas encore payé'}${c.enRetard ? ` · <b>${c.enRetard} en retard</b>` : c.enAttente ? ` · ${c.enAttente} en attente` : ''}</small></span><details><summary>Retirer ?</summary><form method="post" action="/apporteurs/client/retirer">${hid}<input type="hidden" name="client" value="${esc(c.nom)}"><button type="submit" class="small" style="background:var(--accentbg);color:var(--accent)">Oui, retirer (ses commissions passées disparaissent)</button></form></details></li>`).join('')}</ul>` : '<p class="note">Aucune boutique attribuée.</p>'}
    ${enLigne && enLigne.url && a.token ? `<details><summary>🔗 Son lien à donner aux vendeurs</summary><textarea readonly style="min-height:48px;font-size:14px">${esc(`${enLigne.url}/essai?de=${codeOf(a.token)}`)}</textarea><p class="note">Tout vendeur qui ouvre la boutique d’essai par ce lien est marqué à son nom : tu le vois dans la demande « Je veux ma boutique », et lui voit le compte sur sa page.</p></details>
    <details><summary>🌐 Son lien privé (tableau de bord en ligne)</summary><textarea readonly style="min-height:60px;font-size:14px">${esc(`${enLigne.url}/apporteur/${a.token}`)}</textarea><p class="note">Envoie-lui ce lien une fois. Il n’ouvre que SA page. Lien parti chez la mauvaise personne ? <form method="post" action="/apporteurs/lien" style="display:inline">${hid}<input type="hidden" name="id" value="${esc(a.id)}"><button type="submit" class="small" style="background:var(--accentbg);color:var(--accent)">🔁 Nouveau lien</button></form></p></details>` : ''}
    <details><summary>📋 Relevé du mois à lui envoyer</summary><textarea readonly style="min-height:200px;font-size:14px">${esc(apporteursReleve(data, factures, a.id, todayIso))}</textarea><p class="note">Touche le texte, « Tout sélectionner », « Copier », puis colle-le dans WhatsApp ou Telegram. Il ne contient que ses boutiques et son rang.</p></details>
    <details><summary>💶 Noter un versement</summary><form method="post" action="/apporteurs/verser">${hid}<input type="hidden" name="apporteur" value="${esc(a.id)}"><div class="grid2">${k.inp('montant', 'Montant (€)', '', { mode: 'decimal', ph: (Math.max(0, a.solde) / 100).toFixed(2).replace('.', ',') }).replace('id="montant"', `id="montant-${esc(a.id)}"`).replace('for="montant"', `for="montant-${esc(a.id)}"`)}<div class="f"><label for="mode-${esc(a.id)}">Comment</label><select id="mode-${esc(a.id)}" name="mode">${MODES.map(([kk, l]) => `<option value="${kk}">${esc(l)}</option>`).join('')}</select></div></div><div class="grid2"><div class="f"><label for="date-${esc(a.id)}">Le</label><input id="date-${esc(a.id)}" name="date" type="date" value="${esc(todayIso)}" max="${esc(todayIso)}"></div>${k.inp('note', 'Note (facultatif)', '', { max: 80 }).replace('id="note"', `id="note-${esc(a.id)}"`).replace('for="note"', `for="note-${esc(a.id)}"`)}</div><button type="submit">💶 Versé</button></form>
     ${a.versements.length ? `<ul class="plain">${[...a.versements].reverse().map((v) => `<li class="row"><span>${esc(dfr(v.date))} · ${eur(v.montant)} · ${v.mode === 'avoir' ? 'avoir' : 'virement'}${v.note ? ` · ${esc(v.note)}` : ''}</span><form method="post" action="/apporteurs/verser/annuler">${hid}<input type="hidden" name="id" value="${esc(v.id)}"><button type="submit" class="small" style="background:var(--accentbg);color:var(--accent)">✖</button></form></li>`).join('')}</ul>` : ''}</details>
    <details><summary>⚙️ Contrat, pause</summary><form method="post" action="/apporteurs/modifier">${hid}<input type="hidden" name="id" value="${esc(a.id)}"><div class="grid2"><div class="f"><label for="ct-${esc(a.id)}">Contrat d’apporteur</label><select id="ct-${esc(a.id)}" name="contrat"><option value="1"${a.contrat ? ' selected' : ''}>signé</option><option value="0"${a.contrat ? '' : ' selected'}>pas encore signé</option></select></div><div class="f"><label for="ac-${esc(a.id)}">État</label><select id="ac-${esc(a.id)}" name="actif"><option value="1"${a.actif ? ' selected' : ''}>actif</option><option value="0"${a.actif ? '' : ' selected'}>en pause</option></select></div></div>${k.inp('contact', 'Contact', a.contact, { max: 80 }).replace('id="contact"', `id="contact-${esc(a.id)}"`).replace('for="contact"', `for="contact-${esc(a.id)}"`)}<button type="submit">Enregistrer</button></form></details></section>`;
  const ajout = `<form method="post" action="/apporteurs/ajouter">${hid}
    <div class="grid2 stack">${k.inp('nom', 'Nom (ou nom de sa boutique)', '', { max: 60, ph: 'ex. Les Zaff' })}${k.inp('contact', 'Contact (Telegram, WhatsApp…)', '', { max: 80 })}</div>
    <div class="grid2 stack"><div class="f"><label for="parrain">Présenté par (facultatif)</label><select id="parrain" name="parrain"><option value="">personne : apporteur direct (${TAUX.direct.join(' / ')} %)</option>${r.apporteurs.filter((a) => !a.parrain).map((a) => `<option value="${esc(a.id)}"${sent && sent.parrain === a.id ? ' selected' : ''}>${esc(a.nom)} (lui ${TAUX.second.join(' / ')} %, ${esc(a.nom)} ${TAUX.parrain.join(' / ')} %)</option>`).join('')}</select></div>
     <div class="f"><label for="contrat">Contrat d’apporteur</label><select id="contrat" name="contrat"><option value="0">pas encore signé</option><option value="1"${sent && sent.contrat === '1' ? ' selected' : ''}>signé</option></select></div></div>
    <div class="f"><label for="taux">Taux</label><select id="taux" name="taux">${TAUX_SPECIAUX.map(([kk, l]) => `<option value="${kk}"${sent && sent.taux === kk ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
    <details${sent && sent.objectif_clients ? ' open' : ''}><summary>🎁 Abonnement offert contre un objectif (Les Zaff)</summary>${r.apporteurs.some((x) => x.objectif && !x.objectifDe) ? `<div class="f"><label for="objectif_avec">Objectif commun avec (son associé)</label><select id="objectif_avec" name="objectif_avec"><option value="">non, son propre objectif ci-dessous</option>${r.apporteurs.filter((x) => x.objectif && !x.objectifDe).map((x) => `<option value="${esc(x.id)}">${esc(x.nom)}</option>`).join('')}</select></div>` : ''}<div class="grid2">${k.inp('objectif_clients', 'Boutiques payantes à amener', '', { mode: 'numeric', ph: '3', max: 2 })}${k.inp('objectif_avant', 'Avant le', '', { type: 'date' })}</div>${k.inp('offert_jusqua', 'Abonnement offert jusqu’au', '', { type: 'date' })}</details>
    <button type="submit">➕ Ajouter l’apporteur</button></form>`;
  const attribuer = actifs.length ? `<form method="post" action="/apporteurs/client">${hid}
    <div class="grid2 stack"><div class="f"><label for="client">Boutique cliente (nom sur ses factures)</label><input id="client" name="client" list="clients-factures" maxlength="80" value="${esc(sent && sent.client ? sent.client : '')}" placeholder="tel qu’écrit sur la facture"><datalist id="clients-factures">${clientsFactures.map((n) => `<option value="${esc(n)}">`).join('')}</datalist></div>
     <div class="f"><label for="apporteur">Apportée par</label><select id="apporteur" name="apporteur">${actifs.map((a) => `<option value="${esc(a.id)}"${sent && sent.apporteur === a.id ? ' selected' : ''}>${esc(a.nom)}</option>`).join('')}</select></div></div>
    <div class="grid2">${k.inp('depuis', 'Apportée le', todayIso, { type: 'date' })}<div class="f" style="align-self:end"><button type="submit">🤝 Attribuer</button></div></div>
    <p class="note">Le nom doit être exactement celui que tu mets sur ses factures : c’est ainsi que ses paiements sont retrouvés. Un client = un seul apporteur, le premier qui l’a présenté.</p></form>` : '<p class="note">Ajoute d’abord un apporteur (avec son contrat signé).</p>';
  return layout('Apporteurs', '/apporteurs', `<section class="hero"><h1>🤝 Mes apporteurs</h1>
   <p class="sub">Qui t’amène des boutiques, ce qu’ils gagnent (calculé tout seul à partir de tes factures payées), ce que tu leur as versé. Confidentiel : tout reste sur ton serveur.</p>
   <div class="chips"><span class="chip">💶 À verser : ${eur(r.aVerserCeMois)}</span><span class="chip">🤝 ${actifs.length} apporteur${actifs.length > 1 ? 's' : ''} actif${actifs.length > 1 ? 's' : ''}</span><span class="chip">🏪 ${r.nbClients} boutique${r.nbClients > 1 ? 's' : ''} apportée${r.nbClients > 1 ? 's' : ''}</span></div></section>
  ${facturesIllisibles ? '<div class="alert bad">Tes factures sont illisibles sur le serveur : les commissions affichées ici sont fausses (0 €) tant que ce n’est pas réparé. Dis-le à Claude.</div>' : ''}
  ${message ? `<div class="alert ${message.ok ? 'ok' : 'bad'}">${esc(message.text)}${message.ok ? '' : ' Ce que tu as tapé est encore là : corrige la case et recommence.'}</div>` : ''}
  <div class="cards">
   <section class="card wide"><h2>📜 Les règles (gravées)</h2><ul class="plain">
    <li>Commission sur les lignes « Abonnement » <b>encaissées</b> seulement (jamais la création, les options, le conseil), due le mois suivant : ${TAUX.direct[0]} % la 1re année du client (comptée depuis son 1er paiement), ${TAUX.direct[1]} % la 2e, ${TAUX.direct[2]} % ensuite. Un remboursement rend exactement ce qui a été gagné.</li>
    <li>Pause = plus de commission à partir du mois de la pause, plus de bonus. Un apporteur sans contrat signé ne gagne rien, même comme parrain.</li>
    <li>Apporteur présenté par un apporteur : lui ${TAUX.second.join(' / ')} %, celui qui l’a présenté ${TAUX.parrain.join(' / ')} %. Jamais plus de ${TAUX.direct[0]} % au total.</li>
    <li>Bonus du mois (dès ${BONUS_MIN_APPORTEURS} apporteurs actifs) : le n°1 en nouvelles boutiques payantes gagne +${BONUS_POINTS} points ce mois-là (partagés à parts égales en cas d’égalité, jamais sur la part de parrain) ${r.bonusActif ? '— <b>actif</b>' : '— pas encore actif'}.</li>
    <li>Un versement se note ici, en avoir ou en virement (sur sa facture). Rien ne part tout seul.</li></ul></section>
   <section class="card wide"><h2>🌐 Tableau de bord en ligne des apporteurs ${enLigne && enLigne.cle ? '<span class="badge ok">clé créée</span>' : '<span class="badge warn">à brancher</span>'}</h2>
    <p class="note">Chaque apporteur voit sa page sur le site Vendix (démo) : signé, payé, en attente, en retard, sa commission, le classement. Le bot y envoie les chiffres à chaque changement et chaque heure.</p>
    <form method="post" action="/apporteurs/enligne">${hid}${k.inp('url', 'Adresse du site Vendix', enLigne && enLigne.url ? enLigne.url : 'https://streetwear-demo.onrender.com', { max: 120 })}
     ${enLigne && enLigne.cle ? `<div class="f"><label for="cle-enligne">La clé à coller sur le site (APPORTEURS_KEY)</label><textarea id="cle-enligne" readonly style="min-height:48px;font-size:14px">${esc(enLigne.cle)}</textarea></div><label style="display:flex;gap:8px;align-items:center;font-size:14px"><input type="checkbox" name="nouvelle" value="1"> Refaire une nouvelle clé (l’ancienne ne marchera plus : à recoller)</label>` : ''}
     <button type="submit">${enLigne && enLigne.cle ? '💾 Enregistrer' : '🔑 Créer la clé'}</button></form>
    ${enLigne && enLigne.cle ? `<details><summary>Où coller la clé (une seule fois, 2 min)</summary><ol style="padding-left:20px;font-size:14px"><li>Sur ton iPhone, ouvre dashboard.render.com, puis le service <b>streetwear-demo</b>.</li><li>Touche <b>Environment</b>, puis <b>Add Environment Variable</b>.</li><li>Dans « Key » tape <b>APPORTEURS_KEY</b> ; dans « Value » colle la clé ci-dessus ; <b>Save</b>. Le site redémarre tout seul (2 minutes).</li><li>Reviens ici : la ligne « dernier envoi » passe au vert au prochain changement (ou dans l’heure).</li></ol></details>` : ''}
    ${enLigne && enLigne.dernier ? `<p class="${enLigne.ok ? 'alert ok' : 'alert bad'}">Dernier envoi : ${esc(enLigne.dernier)} — ${enLigne.ok ? 'reçu par le site' : esc(enLigne.erreur || 'refusé')}</p>` : ''}</section>
   <section class="card wide"><h2>🏆 Classement</h2>${r.classement.length ? `<ol style="margin:0;padding-left:22px">${r.classement.map((c) => `<li>${esc(c.nom)} — ${c.payants} boutique${c.payants > 1 ? 's' : ''} payante${c.payants > 1 ? 's' : ''}</li>`).join('')}</ol>` : '<p class="note">Personne pour l’instant.</p>'}</section>
   ${r.apporteurs.map(card).join('')}
   <section class="card wide"><h2>🏪 Attribuer une boutique à un apporteur</h2>${attribuer}</section>
   <section class="card wide"><h2>➕ Nouvel apporteur</h2>${ajout}</section>
  </div>`);
}

const ACCES_JS = `
try{indexedDB.deleteDatabase('cockpit-coffre')}catch(e){} // locked or not yet in: the vault key leaves this phone too
const b2a=(s)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const a2b=(b)=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
const post=async(u,d)=>{const r=await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d||{})});const j=await r.json();if(!r.ok)throw new Error(j.erreur||'erreur');return j;};
const say=(t,ok)=>{const e=document.getElementById('msg');e.textContent=t;e.className='alert '+(ok?'ok':'bad');e.hidden=false;};
async function connexion(){try{const o=await post('/acces/options-connexion');o.challenge=b2a(o.challenge);o.allowCredentials=o.allowCredentials.map(c=>({...c,id:b2a(c.id)}));
const c=await navigator.credentials.get({publicKey:o});const r=c.response;
await post('/acces/connexion',{id:c.id,response:{clientDataJSON:a2b(r.clientDataJSON),authenticatorData:a2b(r.authenticatorData),signature:a2b(r.signature)}});location.replace('/');}
catch(e){say('Connexion refusée : '+e.message,false);}}
async function inscription(){try{const code=document.getElementById('code').value.trim();const label=document.getElementById('label').value.trim()||'appareil';
const o=await post('/acces/options-inscription',{code});o.challenge=b2a(o.challenge);o.user.id=b2a(o.user.id);o.excludeCredentials=(o.excludeCredentials||[]).map(c=>({...c,id:b2a(c.id)}));
const c=await navigator.credentials.create({publicKey:o});const r=c.response;
await post('/acces/inscription',{id:c.id,label,response:{clientDataJSON:a2b(r.clientDataJSON),attestationObject:a2b(r.attestationObject)}});say('Appareil enregistré. Touche « Ouvrir avec Face ID ».',true);document.getElementById('btn-connexion').hidden=false;}
catch(e){say('Enregistrement refusé : '+e.message,false);}}
document.getElementById('btn-connexion').addEventListener('click',connexion);
const bi=document.getElementById('btn-inscription');if(bi)bi.addEventListener('click',inscription);
if(!window.PublicKeyCredential)say("Ce navigateur ne sait pas faire les clés d'accès. Utilise Safari sur iPhone, ou un navigateur récent.",false);
`;

export function accesPage({ nonce, hasKeys }) {
  return layout('Accès', '', `<section class="hero"><h1>Mon Cockpit 🔒</h1><p class="sub">Face ID (ou le code de ton appareil) ouvre tes écrans. Rien d'autre n'est demandé.</p></section>
  <div id="msg" class="alert" hidden></div>
  <div class="cards two">
   <section class="card"><h2>🔓 Ouvrir</h2><p class="note" style="margin-top:0">${hasKeys ? 'Avec un appareil déjà enregistré.' : 'Aucun appareil enregistré pour l’instant : enregistre d’abord celui-ci.'}</p>
    <button type="button" id="btn-connexion"${hasKeys ? '' : ' hidden'}>Ouvrir avec Face ID</button></section>
   <section class="card"><h2>📱 Enregistrer cet appareil</h2>
    <p class="note" style="margin-top:0">Envoie <b>/acces</b> à ton bot Telegram : il te donne un code valable 10 minutes.</p>
    <div class="f"><label for="code">Code reçu du bot</label><input id="code" inputmode="numeric" autocomplete="one-time-code" placeholder="6 chiffres"></div>
    <div class="f"><label for="label">Nom de l’appareil</label><input id="label" placeholder="ex. iPhone de Sam" maxlength="40"></div>
    <button type="button" id="btn-inscription">Enregistrer avec Face ID</button></section>
  </div>`, { nonce, script: ACCES_JS, noNav: true });
}

export function sauvegardesPage({ key, tested = false, token, message, backup }) {
  const b = backup ? `Dernière sauvegarde : ${esc(new Date(backup.date).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }))} · copie hors du serveur : ${backup.distant ? 'oui (vérifiée)' : 'NON'}` : 'Pas encore de sauvegarde.';
  const hidden = `<input type="hidden" name="jeton" value="${esc(token)}">`;
  const keyCard = key ? `<section class="card wide"><h2>🔑 Ta clé de sauvegarde (à ranger maintenant)</h2>
    <p>Sans elle, personne ne peut ouvrir tes sauvegardes, pas même toi. Elle ne s'affiche qu'ici, sur ton réseau privé, et jamais dans Telegram.</p>
    <ol><li>Appuie longuement sur la clé et copie-la.</li><li>App Mots de passe → + → titre « Cockpit — clé de sauvegarde » → colle-la → Enregistrer.</li><li>Écris-la aussi sur ta fiche papier.</li><li>Teste-la dans « Tester ma clé » ci-dessous, en la collant depuis Mots de passe (pas depuis cet écran).</li><li>Quand le test est ✅, touche le bouton : la clé sera effacée du serveur.</li></ol>
    <p><code style="word-break:break-all;font-size:15px;user-select:all;-webkit-user-select:all">${esc(key)}</code></p>
    <form method="post" action="/sauvegardes/rangee">${hidden}<button type="submit"${tested ? '' : ' disabled title="Teste d’abord ta clé"'}>✅ Testée et rangée — effacer du serveur${tested ? '' : ' (après le test)'}</button></form></section>`
    : `<section class="card"><h2>🔑 Clé de sauvegarde</h2><p class="note" style="margin-top:0">Aucune clé en attente sur le serveur : elle t'a déjà été remise (app Mots de passe, « Cockpit — clé de sauvegarde »). Pour en créer une nouvelle (seulement si l'ancienne est perdue) : <code>/nouvelle_cle</code> dans le bot.</p></section>`;
  return layout('Sauvegardes', '/sauvegardes', `<h1>Sauvegardes et secrets</h1>
  <p class="sub">${b}</p>
  ${message ? `<div class="alert ${message.ok ? 'ok' : 'bad'}">${esc(message.text)}</div>` : ''}
  <div class="cards" style="margin-top:12px">
   ${keyCard}
   <section class="card"><h2>🧪 Tester ma clé <span class="note" style="margin:0;font-weight:500">une fois par mois</span></h2>
    <p class="note" style="margin-top:0">Je l'utilise une seule fois pour ouvrir la dernière sauvegarde, puis je l'oublie. Elle n'est ni gardée ni écrite nulle part.</p>
    <form method="post" action="/sauvegardes/test">${hidden}<div class="f"><label for="cle">Colle ta clé</label><input id="cle" name="cle" type="password" autocomplete="off" placeholder="AGE-SECRET-KEY-1…"></div><button type="submit">Tester</button></form></section>
   <section class="card"><h2>🔐 Nouveau jeton GitHub</h2>
    <p class="note" style="margin-top:0">Seulement quand Claude te le demande (le jeton actuel expire le 24/10/2027). Il est rangé sur le serveur, jamais affiché.</p>
    <form method="post" action="/sauvegardes/github">${hidden}<div class="f"><label for="github">Colle le jeton</label><input id="github" name="github" type="password" autocomplete="off" placeholder="github_pat_…"></div><button type="submit">Enregistrer</button></form></section>
  </div>`);
}

export function errorPage(msg) { return layout('Erreur', '', `<h1>Oups</h1><p>${esc(msg)}</p>`); }

// ---- Dossier : biens, crédits, loyers, revenus, abonnements — édités ici, gardés sur le serveur seulement (C-094).
// `sent` = what Sam just typed, shown again when a save is refused (nothing he typed is lost on one wrong box).
const STATUT_OPTS = [['declare', 'Déclaré (tu me l’as dit)'], ['verifie', 'Vérifié (vu sur un document)'], ['estime', 'Estimé (calculé)'], ['hypothese', 'Hypothèse (à confirmer)']];
const cents = (c) => (c == null ? '' : (c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ').replace('.', ',').replace(/,00$/, ''));
function dossierKit(sent) {
  const val = (name, stored) => (sent && name in sent ? sent[name] : stored);
  const inp = (name, label, value, { type = 'text', mode, ph = '', max } = {}) => `<div class="f"><label for="${esc(name)}">${label}</label><input id="${esc(name)}" name="${esc(name)}" type="${type}" value="${esc(val(name, value ?? ''))}"${mode ? ` inputmode="${mode}"` : ''}${max ? ` maxlength="${max}"` : ''} placeholder="${esc(ph)}" autocomplete="off"></div>`;
  const sel = (name, label, value) => { const v = val(name, value || 'declare'); const opts = STATUT_OPTS.some(([k]) => k === v) ? STATUT_OPTS : [[v, v], ...STATUT_OPTS]; return `<div class="f"><label for="${esc(name)}">${label}</label><select id="${esc(name)}" name="${esc(name)}">${opts.map(([k, l]) => `<option value="${esc(k)}"${v === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`; };
  const money = (name, label, value, ph = 'ex. 1 650,50') => inp(name, label, cents(value), { mode: 'decimal', ph });
  const hidden = (name, value) => `<input type="hidden" name="${esc(name)}" value="${esc(val(name, value))}">`;
  const area = (name, label, value, ph) => `<div class="f"><label for="${esc(name)}">${label}</label><textarea id="${esc(name)}" name="${esc(name)}" maxlength="1100" placeholder="${esc(ph)}">${esc(val(name, value))}</textarea></div>`;
  return { inp, sel, money, hidden, area };
}

function bienForm(k, p, b = {}) {
  const a = b.achat || {}, f = b.financement || {}, loyers = [...(b.loyers || [])];
  while (loyers.length < 3) loyers.push({});
  return `${b.id ? k.hidden(`${p}.id`, b.id) : ''}
   ${k.inp(`${p}.nom`, 'Nom du bien', b.nom, { ph: 'ex. Maison de Ville-A', max: 60 })}
   <div class="grid2">${k.inp(`${p}.type`, 'Type', b.type, { ph: 'Maison, appartement…', max: 40 })}${k.inp(`${p}.situation`, 'Situation', b.situation, { ph: 'Louée, non louée, travaux…', max: 80 })}</div>
   <h3>Achat</h3><div class="grid2">${k.money(`${p}.achat.prix`, 'Prix d’achat (€)', a.prixCents)}${k.money(`${p}.achat.comptant`, 'Payé comptant (€)', a.comptantCents)}</div>
   <div class="grid2">${k.inp(`${p}.achat.date`, 'Date d’achat', a.date, { type: 'date' })}${k.sel(`${p}.achat.statut`, 'Ces chiffres sont…', a.statut)}</div>
   <p class="note" style="margin-top:0">Payé comptant : la somme versée le jour de l’achat, sans crédit.</p>
   <h3>Crédit (laisse tout vide s’il n’y en a pas)</h3>${k.inp(`${p}.fin.type`, 'Type de crédit', f.type, { ph: 'Crédit-vendeur à 0 %, crédit bancaire, vente à terme…', max: 60 })}
   <div class="grid2">${k.money(`${p}.fin.capital`, 'Capital (€)', f.capitalCents)}${k.money(`${p}.fin.mensualite`, 'Mensualité (€)', f.mensualiteCents)}</div>
   <div class="grid2">${k.inp(`${p}.fin.premiere`, 'Première échéance', f.premiereEcheance, { type: 'date' })}${k.inp(`${p}.fin.nombre`, 'Nombre d’échéances', f.nombre, { mode: 'numeric', ph: 'ex. 120', max: 4 })}</div>
   <div class="grid2">${k.money(`${p}.fin.signature`, 'Versé à la signature (€)', f.versementSignatureCents, 'facultatif')}${k.sel(`${p}.fin.statut`, 'Ces chiffres sont…', f.statut)}</div>
   ${k.inp(`${p}.fin.paiement`, 'Comment tu paies', f.paiement, { ph: 'virement permanent le 10, prélèvement…', max: 80 })}
   <p class="note" style="margin-top:0">Capital : la somme empruntée (ou restant à payer au vendeur le jour de l’achat). Versé à la signature : payé le jour de l’acte, avant les mensualités.</p>
   <h3>Loyers reçus (par mois)</h3>${loyers.map((l, i) => `<div class="grid2">${k.inp(`${p}.loyer${i}.libelle`, i ? `Loyer n°${i + 1}` : 'Loyer', l.libelle, { ph: 'qui paie, ex. Locataire du 1er', max: 60 })}${k.money(`${p}.loyer${i}.montant`, 'Montant (€)', l.montantCents)}</div>${k.hidden(`${p}.loyer${i}.statut`, l.statut || 'declare')}`).join('')}
   <h3>Points de vigilance</h3>${k.area(`${p}.alertes`, 'Une alerte par ligne, 5 au plus (affichées sur Aujourd’hui)', (b.alertes || []).join('\n'), 'ex. Relire la clause de l’acte avant toute location')}`;
}

export function dossierPage({ data, token, message, vide = false, sent = null, dernieres = {} }) {
  const k = dossierKit(sent);
  const jeton = `<input type="hidden" name="jeton" value="${esc(token)}">`;
  const biens = data.biens.map((b, i) => `<section class="card"><h2>🏡 ${esc(b.nom)}</h2>${dernieres[b.id] ? `<p class="note" style="margin-top:-6px">📅 Dernière échéance : <b>${esc(date(dernieres[b.id]))}</b> (calculée à partir du crédit)</p>` : ''}${bienForm(k, `b${i}`, b)}</section>`).join('');
  const newOpen = vide || (sent && Object.keys(sent).some((n) => n.startsWith('new.') && !n.endsWith('.statut') && String(sent[n]).trim()));
  const rfr = (data.revenus && data.revenus.revenuFiscalReferenceCents) || {};
  const abos = data.abonnements || [];
  const renewA = (p, it = {}) => `<div class="grid2">${k.inp(`${p}.renouv`, 'Se renouvelle le (facultatif)', it.renouvellement, { type: 'date' })}${k.inp(`${p}.preavis`, 'Préavis pour résilier (jours)', it.preavisJours, { mode: 'numeric', ph: 'ex. 30', max: 3 })}</div>`;
  const abosHtml = abos.map((a, i) => `<div class="grid2">${k.inp(`a${i}.nom`, 'Nom (vide = supprimé)', a.nom, { max: 40 })}${k.money(`a${i}.montant`, 'Prix par mois (€)', a.montantCents)}</div>${renewA(`a${i}`, a)}${k.hidden(`a${i}.statut`, a.statut || 'estime')}`).join('<hr style="border:0;border-top:1px solid var(--line);margin:12px 0">')
    + `<h3>Ajouter un abonnement</h3><div class="grid2">${k.inp('anew.nom', 'Nom', '', { max: 40, ph: 'ex. Netflix' })}${k.money('anew.montant', 'Prix par mois (€)', null)}</div>${renewA('anew')}${k.hidden('anew.statut', 'estime')}`;
  const freqSel = (name, value) => { const f = sent && name in sent ? sent[name] : (value || 'mois'); return `<div class="f"><label for="${esc(name)}">Tous les…</label><select id="${esc(name)}" name="${esc(name)}"><option value="mois"${f === 'mois' ? ' selected' : ''}>par mois</option><option value="an"${f === 'an' ? ' selected' : ''}>par an</option></select></div>`; };
  const renewHtml = (p, it = {}) => `<div class="grid2">${k.inp(`${p}.renouv`, 'Se renouvelle le (facultatif)', it.renouvellement, { type: 'date' })}${k.inp(`${p}.preavis`, 'Préavis pour résilier (jours)', it.preavisJours, { mode: 'numeric', ph: 'ex. 30', max: 3 })}</div>`;
  const chargesHtml = (data.charges || []).map((c, i) => `<div class="grid2">${k.inp(`c${i}.nom`, 'Nom (vide = supprimé)', c.nom, { max: 40 })}${k.money(`c${i}.montant`, 'Montant (€)', c.montantCents)}</div>${freqSel(`c${i}.freq`, c.frequence)}${renewHtml(`c${i}`, c)}`).join('<hr style="border:0;border-top:1px solid var(--line);margin:12px 0">')
    + `<h3>Ajouter une dépense</h3><div class="grid2">${k.inp('cnew.nom', 'Nom', '', { max: 40, ph: 'ex. Assurance auto' })}${k.money('cnew.montant', 'Montant (€)', null)}</div>${freqSel('cnew.freq', 'mois')}${renewHtml('cnew')}`;
  const retirer = data.biens.length ? `<section class="card"><h2>🗑 Retirer un bien</h2><p class="note" style="margin-top:0">Seulement si tu l’as vendu ou si c’est une erreur. Enregistre d’abord tes autres changements : ce bouton recharge la page.</p>${data.biens.map((b) => `<form method="post" action="/dossier/retirer" style="margin-top:10px">${jeton}<input type="hidden" name="id" value="${esc(b.id)}"><label style="display:flex;gap:8px;align-items:center;font-size:15px"><input type="checkbox" name="sur" value="1" required style="width:22px;height:22px;min-height:0">Oui, retirer « ${esc(b.nom)} »${b.type ? ` (${esc(b.type)})` : ''}</label><button type="submit" class="danger">Retirer</button></form>`).join('')}</section>` : '';
  const save = '<button type="submit">💾 Enregistrer tout le dossier</button>';
  return layout('Dossier', '/dossier', `<h1>Mon dossier</h1>
  <p class="sub">Tes biens, crédits, loyers et abonnements. Ils restent sur ton serveur privé (copie chiffrée dans tes sauvegardes) : rien ne va sur GitHub ni dans une conversation. Les autres pages sont calculées à partir d’ici.</p>
  ${message ? `<div class="alert ${message.ok ? 'ok' : 'bad'}">${esc(message.text)}${message.ok ? '' : ' Ce que tu as tapé est encore là : corrige la case et réenregistre.'}</div>` : ''}
  ${vide ? `<div class="alert info">Ton dossier est vide. Remplis « Ajouter un bien » ci-dessous, puis touche « Enregistrer tout le dossier ».</div>` : ''}
  <form method="post" action="/dossier" class="cards" style="margin-top:12px">${jeton}
   <div class="wide" style="text-align:right">${save}</div>
   ${biens}
   <section class="card"><details${newOpen ? ' open' : ''}><summary style="cursor:pointer;font-weight:700;font-size:17px;list-style:none">➕ Ajouter un bien</summary><div style="margin-top:10px">${bienForm(k, 'new', {})}</div></details></section>
   <section class="card"><h2>💼 Revenus</h2><div class="grid2">${k.money('rfr', 'Revenu fiscal de référence (€)', rfr.valeur)}${k.sel('rfrStatut', 'Ce chiffre est…', rfr.statut === 'a_saisir' ? 'declare' : rfr.statut)}</div><p class="note">En haut de ton dernier avis d’imposition. Il sert au calcul du versement libératoire. Ton salaire se saisit dans « Mes chiffres ».</p></section>
   <section class="card"><h2>🔁 Abonnements</h2>${abosHtml}<p class="note">Ici, la liste et le prix prévu ; ce que tu paies vraiment se saisit dans « Mes chiffres ».</p></section>
   <section class="card"><h2>🧾 Dépenses fixes</h2>${chargesHtml}<p class="note">Assurances, électricité, téléphone, internet, salle de sport… Ce qui se paie par an (taxe, assurance) : choisis « par an », le Cockpit le divise par 12. Avec une date de renouvellement, le bot te prévient 30 et 7 jours avant la date limite pour résilier.</p></section>
   <section class="card wide"><details${sent && String(sent.coller || '').trim() ? ' open' : ''}><summary style="cursor:pointer;font-weight:700;font-size:17px;list-style:none">📋 Coller une liste (abonnements et dépenses)</summary><div style="margin-top:10px">${k.area('coller', 'Une ligne par élément : Abonnement ou Dépense ; nom ; montant ; mois ou an ; date de renouvellement (jj/mm/aaaa, facultatif) ; préavis en jours (facultatif)', '', 'Abonnement ; Netflix ; 13,49 ; mois\nDépense ; Assurance auto ; 540 ; an ; 01/03/2027 ; 60')}<p class="note">Un nom déjà dans la liste est mis à jour, pas doublé. Pratique quand Claude te prépare la liste : tu la colles ici, puis « Enregistrer tout le dossier ».</p></div></details></section>
   <div class="wide" style="text-align:right">${save}</div>
  </form>
  <div class="cards" style="margin-top:14px">${retirer}</div>`);
}

// Ready-made messages (no price: the prices live in Les Zaff OFFRES.md, the only source). Selected by a long press.
const MSG_PREMIER = `Salut ! Moi c'est Sam, je monte des boutiques en ligne clé en main pour les vendeurs de vêtements.

Un seul lien à mettre partout (Insta, Snap, WhatsApp). Ton client choisit, paie par carte, et le reste se fait tout seul : confirmation, suivi du colis, relances, tes chiffres. Tu gères tout depuis Telegram, avec des boutons.

Exemple en vrai : leszaff.fr

Offre de lancement : création offerte, 3 premiers mois moins chers, aucune commission sur tes ventes.

On en parle 10 minutes ? Si ça ne t'intéresse pas, réponds juste « non merci » et je ne t'écris plus.`;
const MSG_RELANCE = `Re ! Une seule relance de ma part pour la boutique en ligne : je peux te montrer en 5 minutes, sur mon téléphone, comment ça marche avec tes propres articles. Ça te dit ? Sinon pas de souci, je ne t'écris plus.`;
const MSG_APRES_DEMO = `Merci pour ton temps ! Le récap : formule [nom], création offerte, [prix] par mois les 3 premiers mois, puis [prix]. Payé d'avance, sans commission sur tes ventes. Si c'est bon pour toi, je t'envoie les conditions à signer et on lance ta boutique.`;

export function prospectsPage({ list = [], token, message, sent = null, todayIso }) {
  const k = dossierKit(sent);
  const sorted = trier(list);
  const c = compter(list);
  const due = aRelancer(list, todayIso).length;
  const enCours = list.length - c.signe - c.non;
  const etapeSel = (name, value) => { const v = sent && name in sent ? sent[name] : value; return `<div class="f"><label for="${esc(name)}">Où on en est</label><select id="${esc(name)}" name="${esc(name)}">${ETAPES.map(([e, l]) => `<option value="${e}"${v === e ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`; };
  const label = Object.fromEntries(ETAPES);
  const row = (p, x = {}) => {
    const late = x.relance && x.relance <= todayIso && !['signe', 'non'].includes(x.etape);
    const head = x.nom ? `<h3 style="margin-top:0">${esc(x.nom)} <span class="badge ${x.etape === 'signe' ? 'ok' : x.etape === 'non' ? 'muted' : late ? 'warn' : 'info'}">${late ? 'À relancer' : esc(label[x.etape] || '')}</span></h3>` : '';
    return `${head}${x.id ? k.hidden(`${p}.id`, x.id) : ''}<div class="grid2">${k.inp(`${p}.nom`, x.nom ? 'Pseudo (vide = effacé)' : 'Pseudo', x.nom, { max: 40, ph: 'ex. @streetwear.lyon' })}${k.inp(`${p}.ou`, 'Où tu l’as trouvé', x.ou, { max: 40, ph: 'ex. Insta, ami de Karim' })}</div>
     <div class="grid2">${etapeSel(`${p}.etape`, x.etape || 'a_contacter')}${k.inp(`${p}.relance`, 'Relancer le', x.relance, { type: 'date' })}</div>
     ${k.inp(`${p}.note`, 'Note (facultatif)', x.note, { max: 200, ph: 'ex. vend des sneakers, 2 000 abonnés' })}`;
  };
  const rows = sorted.map((x, i) => `<section class="card">${row(`p${i}`, x)}</section>`).join('');
  const copy = (t) => `<textarea readonly style="min-height:150px;font-size:15px">${esc(t)}</textarea>`;
  const save = '<button type="submit">💾 Enregistrer</button>';
  return layout('Prospects', '/prospects', `<section class="hero"><h1>🎯 Prospects</h1>
   <p class="sub">Les vendeurs à qui proposer une boutique. Gardé sur ton serveur seulement : rien sur GitHub, aucun pseudo dans Telegram.</p>
   <div class="chips"><span class="chip">${due ? `⏰ ${due} à relancer aujourd’hui` : '✅ Personne à relancer'}</span><span class="chip">💬 ${enCours} en cours</span><span class="chip">🎉 ${c.signe} client${c.signe > 1 ? 's' : ''}</span></div></section>
  ${message ? `<div class="alert ${message.ok ? 'ok' : 'bad'}">${esc(message.text)}${message.ok ? '' : ' Ce que tu as tapé est encore là : corrige la case et réenregistre.'}</div>` : ''}
  <form method="post" action="/prospects" class="cards" style="margin-top:12px"><input type="hidden" name="jeton" value="${esc(token)}">
   <section class="card wide"><h2>➕ Ajouter un prospect</h2>${row('pnew')}${save}
    <p class="note">Quand tu choisis une étape sans date, le Cockpit met la relance tout seul (message envoyé : 4 jours ; relancé : 7 jours ; démo : 2 jours ; offre : 3 jours). Le bot te dit chaque matin combien de personnes relancer, sans leur nom.</p></section>
   ${rows}
   ${list.length ? `<div class="wide" style="text-align:right">${save}</div>` : ''}
  </form>
  <div class="cards two" style="margin-top:14px">
   <section class="card"><h2>⚖️ Qui contacter, et comment</h2><ul class="plain">
    <li>✅ Les gens que tu connais, que tu as rencontrés, ou qui t’ont posé la question.</li>
    <li>✅ Les boutiques et vendeurs <b>professionnels</b> : un message qui parle de leur activité de vendeur, avec ton prénom et « réponds non merci ».</li>
    <li>⚠️ Un particulier qui revend et que tu ne connais pas (trouvé sur Insta, Vinted…) : <b>ne lui écris pas en premier</b>. La CNIL (l’autorité des données personnelles) demande son accord avant un message commercial quand le contact vient d’internet — point à confirmer. Fais-le venir à toi : une story « je monte des boutiques », ou une présentation par quelqu’un qui le connaît.</li>
    <li>1 message, 1 relance au maximum. « Non », ou rien après la relance : passe-le en « Pas intéressé / stop ».</li>
    <li>Jamais de message envoyé à plusieurs d’un coup, jamais de liste achetée.</li>
    <li>Ici, un pseudo suffit : pas de nom complet, pas d’adresse. S’il demande à être effacé : vide son pseudo, puis « Enregistrer ».</li></ul></section>
   <section class="card"><h2>💬 Messages prêts</h2><p class="note" style="margin-top:0">Touche le texte, puis « Tout sélectionner » et « Copier ».</p>
    <h3>1 · Premier message</h3>${copy(MSG_PREMIER)}
    <h3>2 · La relance (une seule)</h3>${copy(MSG_RELANCE)}
    <h3>3 · Après la démo</h3>${copy(MSG_APRES_DEMO)}
    <p class="note">Remplace les [crochets] par les prix de la formule choisie. La démo en 5 minutes : leszaff.fr, un article, « Commander sur Telegram », puis ton espace vendeur.</p></section>
  </div>`);
}

// The safe: file a paper (photo or PDF) in two gestures, find it again by house or project, sorted by year.
// The vault password panel: create it (first time), convert the first sealed papers (v1), or open the vault.
// Hidden until the phone's script runs (so it can never be posted to the server); the password never leaves the phone.
// « abime »: the wrapped key is missing or damaged while sealed papers exist: never offer to create a new one.
function keyPanel({ vaultInfo = { etat: 'absent' }, verif, token, index = [], indice = '' }) {
  const v1 = index.filter((d) => d.e2e && !isE2(d.titre));
  const v2 = index.some((d) => d.e2e && isE2(d.titre));
  const mode = vaultInfo.etat === 'ok' ? 'ouvrir' : vaultInfo.etat === 'abime' || v2 ? 'abime' : v1.length || verif ? 'migrer' : 'creer';
  const text = {
    ouvrir: 'Tape ton mot de passe du coffre pour lire et ranger tes papiers 🔒.',
    migrer: 'Nouvelle protection : tape une fois ton mot de passe du coffre habituel. Tes papiers 🔒 déjà rangés, leurs titres et leurs notes seront chiffrés à nouveau sur ton téléphone.',
    creer: 'Choisis ton mot de passe du coffre : 12 caractères au moins, le plus sûr est 4 ou 5 mots au hasard (ex. « tortue bleu cerise orage »). Écris-le sur ta fiche de secours : il n’est gardé nulle part, et sans lui personne ne peut ouvrir tes papiers 🔒, pas même Claude.',
    abime: 'La clé de ton coffre est introuvable ou abîmée sur le serveur. Ne crée rien et ne range rien : dis-le à Claude, elle est dans ta dernière sauvegarde.',
  }[mode];
  const rows = v1.map((d) => `<span data-v1-id="${esc(d.id)}" data-titre="${esc(d.titre)}" data-note="${esc(d.note || '')}"></span>`).join('');
  const form = mode === 'abime' ? '' : `<form><div class="grid2"><div class="f"><label for="cpw1">Mot de passe du coffre</label><input id="cpw1" name="cpw1" type="password" autocomplete="off" required></div>${mode === 'creer' ? '<div class="f"><label for="cpw2">Retape-le</label><input id="cpw2" name="cpw2" type="password" autocomplete="off" required></div>' : ''}</div>
   <button type="submit">${mode === 'creer' ? '🔑 Créer et ouvrir le coffre' : '🔓 Ouvrir le coffre'}</button></form>`;
  return `<div id="coffre-etat" hidden data-vault="${vaultInfo.vault ? esc(JSON.stringify(vaultInfo.vault)) : ''}" data-verif="${esc(verif || '')}" data-v1="${esc(v1.map((d) => d.id).join(','))}">${rows}</div>
  <section class="card" id="panneau-cle" data-mode="${mode}" data-jeton="${esc(token)}" hidden style="margin-top:12px"${mode === 'abime' ? ' role="alert"' : ''}><h2>${mode === 'abime' ? '⚠️ Clé du coffre introuvable' : mode === 'creer' ? '🔑 Créer ton mot de passe du coffre' : '🔑 Ouvrir le coffre'}</h2><p class="note" style="margin-top:-6px">${text}</p>
   ${form}${indice && mode !== 'abime' && mode !== 'creer' ? `<details class="indice" style="margin-top:10px"><summary style="cursor:pointer;color:var(--accent);font-weight:600">💡 Voir mon indice</summary><p class="d" style="margin:6px 0 0">${esc(indice)}</p></details>` : ''}<div id="cle-msg" class="alert" hidden></div></section>
  <p id="cle-ouverte" hidden class="note" style="margin-top:12px">🔓 Coffre ouvert sur ce téléphone (il se referme seul après 15 min). <button type="button" class="ghost" id="verrouiller-coffre">🔒 Refermer maintenant</button></p>`;
}

export function coffrePage({ index = [], places = [], filtre = {}, token, message, sent = null, distant = null, cle = true, todayIso, nonce = null, script = null, verif = '', vaultInfo = { etat: 'absent' }, indice = '' }) {
  const counts = compterPar(index);
  const docs = filtrer(index, filtre).filter((d) => !filtre.afaire || d.afaire === 'a_faire');
  const todo = aFaire(index).length;
  const AF = [['', '·', 'Rien à faire'], ['a_faire', '📌', 'À faire (devis à signer, courrier à répondre…)'], ['fait', '✅', 'Fait']];
  // p = prefix of the element ids only (one form per paper on the page); names stay the same. `back` = what was typed, re-shown after a refusal.
  const metaFields = (p, d = {}, back = null) => {
    const v = (name, stored) => (back && name in back ? back[name] : stored ?? '');
    // A sealed title or note is never put in the page as a value: the phone fills it once the vault is open.
    const inp = (name, label, value, { type = 'text', max, ph = '' } = {}) => { const val = v(name, value); const sealed = isE2(val); return `<div class="f"><label for="${p}${name}">${label}</label><input id="${p}${name}" name="${name}" type="${type}" value="${sealed ? '' : esc(val)}"${sealed ? ` data-e2v="${esc(val)}" data-aad="${esc(d.id)}:${name}"` : ''}${max ? ` maxlength="${max}"` : ''} placeholder="${esc(sealed ? '🔒 ouvre le coffre pour lire' : ph)}" autocomplete="off"></div>`; };
    const sel = (name, label, list, value) => { const val = v(name, value); return `<div class="f"><label for="${p}${name}">${label}</label><select id="${p}${name}" name="${name}">${list.map(([key, ic, l]) => `<option value="${esc(key)}"${val === key ? ' selected' : ''}>${ic} ${esc(l)}</option>`).join('')}</select></div>`; };
    return `${inp('titre', 'Titre', d.titre, { max: 80, ph: 'ex. Bail de la maison, devis toiture' })}
    <div class="grid2">${sel('rattache', 'Rangé dans', places, d.rattache || filtre.r || 'perso')}${sel('type', 'Type', TYPES, d.type || 'facture')}</div>
    <div class="grid2">${inp('date', 'Date du papier', d.date, { type: 'date' })}${inp('echeance', 'Date limite (facultatif)', d.echeance, { type: 'date' })}</div>
    ${sel('afaire', 'À faire ?', AF, d.afaire || '')}${inp('note', 'Note (facultatif)', d.note, { max: 200 })}`;
  };
  const tok = `<input type="hidden" name="jeton" value="${esc(token)}">`;
  const typeOf = Object.fromEntries(TYPES.map(([key, ic, l]) => [key, [ic, l]]));
  const fmt = (iso) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' }) : '');
  const soon = (iso) => iso && (Date.parse(iso) - Date.parse(todayIso)) / 864e5 <= 30;
  const item = (d) => {
    const [ic, tl] = typeOf[d.type] || ['📄', 'Autre'];
    const badges = `${d.afaire === 'a_faire' ? '<span class="badge warn">📌 À faire</span>' : ''}${d.echeance && d.afaire !== 'fait' ? `<span class="badge ${soon(d.echeance) ? 'bad' : 'info'}">⏰ ${esc(fmt(d.echeance))}</span>` : ''}`;
    const sealedT = isE2(d.titre), sealedN = isE2(d.note);
    const title = sealedT ? `<span data-e2t="${esc(d.titre)}" data-aad="${esc(d.id)}:titre">Papier chiffré</span>` : esc(d.titre);
    const note = d.note ? ` · ${sealedN ? `<span data-e2t="${esc(d.note)}" data-aad="${esc(d.id)}:note">note chiffrée</span>` : esc(d.note)}` : '';
    return `<li class="doc"><span class="ic" aria-hidden="true">${ic}</span><div style="flex:1;min-width:0"><a class="t" href="/coffre/voir/${esc(d.id)}">${d.e2e ? '🔒 ' : ''}${title}</a>${badges}
      <div class="m">${esc(tl)}${d.date ? ` · ${esc(fmt(d.date))}` : ''} · ${esc(libelle(places, d.rattache))}${note}</div>
      <details><summary>Modifier</summary><form method="post" action="/coffre/modifier"${d.e2e ? ` data-e2e="1" data-id="${esc(d.id)}"` : ''}>${tok}<input type="hidden" name="id" value="${esc(d.id)}">${metaFields(`e${d.id}-`, d)}<button type="submit">Enregistrer</button></form>
       <form method="post" action="/coffre/modifier" style="margin-top:12px">${tok}<input type="hidden" name="id" value="${esc(d.id)}"><input type="hidden" name="supprimer" value="1"><label style="display:flex;gap:8px;align-items:center;font-size:15px"><input type="checkbox" name="sur" value="1" required style="width:22px;height:22px;min-height:0">Oui, le retirer du coffre</label><button type="submit" class="danger">Retirer</button></form></details></div></li>`;
  };
  const years = [...new Set(docs.map(annee))];
  const list = docs.length ? years.map((y) => `<h3>${esc(y)}</h3><ul class="plain">${docs.filter((d) => annee(d) === y).map(item).join('')}</ul>`).join('')
    : empty('🗄', filtre.r || filtre.afaire ? 'Aucun papier ici pour l’instant.' : 'Ton coffre est vide. Range ton premier papier ci-dessus.');
  const chip = (href, label, on) => `<a href="${href}"${on ? ' aria-current="page"' : ''}>${label}</a>`;
  const chips = [chip('/coffre', `Tous (${index.length})`, !filtre.r && !filtre.afaire), ...(todo ? [chip('/coffre?afaire=1', `📌 À faire (${todo})`, !!filtre.afaire)] : []),
    ...places.filter(([key]) => counts[key] || key === filtre.r).map(([key, ic, l]) => chip(`/coffre?r=${encodeURIComponent(key)}`, `${ic} ${esc(l)} (${counts[key] || 0})`, filtre.r === key))].join('');
  const here = filtre.r ? libelle(places, filtre.r) : null;
  const copies = distant && index.length ? `<span class="chip">☁️ ${Math.min(distant, index.length)}/${index.length} copiés hors du serveur</span>` : '';
  return layout('Coffre', '/coffre', `<section class="hero"><h1>🗄 Mon coffre</h1>
   <p class="sub">Les papiers 🔒, leurs titres et leurs notes sont chiffrés sur ton iPhone avant d’être envoyés. Le serveur et les sauvegardes ne peuvent pas les lire tant que ton mot de passe du coffre est long. Restent visibles : le type, le rangement et les dates, pour tes rappels.</p>
   <div class="chips"><span class="chip">📄 ${index.length} papier${index.length > 1 ? 's' : ''}</span>${todo ? `<span class="chip">📌 ${todo} à faire</span>` : ''}${copies}</div></section>
  ${cle ? '' : '<div class="alert warn">Le coffre s’ouvre après la prochaine mise à jour du serveur (/maj dans le bot). Tu pourras alors ranger tes papiers.</div>'}
  ${message ? `<div class="alert ${message.ok ? 'ok' : 'bad'}">${esc(message.text)}</div>` : ''}
  ${keyPanel({ vaultInfo, verif, token, index, indice })}
  <div class="cards" style="margin-top:12px">
   <section class="card wide"><details${!index.length || (message && !message.ok && sent) ? ' open' : ''}><summary style="cursor:pointer;font-weight:700;font-size:17px;list-style:none">➕ Ranger un papier${here ? ` dans ${esc(here)}` : ''}</summary>
    <form method="post" action="/coffre/ajouter" enctype="multipart/form-data" style="margin-top:10px" id="form-ranger">${tok}
     <div class="f"><label for="fichier">Photo ou PDF (15 Mo maximum)</label><input id="fichier" name="fichier" type="file" accept="application/pdf,image/jpeg,image/png,image/heic" required></div>
     <p class="note" style="margin-top:0">Pour un papier : « Choisir un fichier », puis <b>⋯</b> en haut à droite, puis <b>Scanner des documents</b>. L’iPhone redresse la page tout seul.</p>
     ${metaFields('n-', {}, sent)}
     <label style="display:flex;gap:10px;align-items:flex-start;font-size:15px;margin:12px 0 4px"><input type="checkbox" id="n-sensible" name="sensible" value="1" checked style="width:22px;height:22px;min-height:0;flex:none;margin-top:2px"><span><b>🔒 Protégé comme iCloud</b> (conseillé) : le papier, son titre et sa note sont chiffrés sur ton iPhone avec ton mot de passe du coffre. Décoche seulement pour un papier sans importance.</span></label>
     <div id="pw-msg" class="alert" hidden></div>
     <button type="submit">🔐 Ranger dans le coffre</button></form></details></section>
   <section class="card wide"><div class="chips f" style="margin-bottom:10px">${chips}</div>${list}</section>
   <section class="card wide"><details${indice ? '' : ' open'}><summary style="cursor:pointer;font-weight:700;font-size:17px;list-style:none">💡 Indice du mot de passe${indice ? ' (enregistré)' : ''}</summary>
    <p class="note">Une phrase qui te fait penser au mot de passe, <b>jamais le mot de passe ni un de ses mots</b> : quelqu’un qui verrait l’indice ne doit pas pouvoir le deviner. Exemple : « les 4 mots écrits sur ma fiche de secours, rangée dans le classeur bleu ». Il s’affiche sous « Ouvrir le coffre », derrière Face ID.</p>
    <form method="post" action="/coffre/indice" id="form-indice">${tok}<div class="f"><label for="indice">Ton indice (80 caractères maximum, vide = effacé)</label><input id="indice" name="indice" maxlength="80" value="${esc(indice)}" autocomplete="off"></div><div id="indice-msg" class="alert" hidden></div><button type="submit">💡 Enregistrer l’indice</button></form></details></section>
   <section class="card wide"><h2>💡 Bon à savoir</h2><ul class="plain">
    <li>Ton mot de passe du coffre ne quitte jamais ton iPhone et n’est gardé nulle part : même quelqu’un qui prendrait le serveur ou une sauvegarde ne pourrait rien lire. Écris-le sur ta fiche de secours : perdu = les papiers 🔒 sont perdus pour de bon.</li>
    <li>Une fois tapé, le coffre reste ouvert 15 minutes sur ce téléphone, puis se referme tout seul (aussi quand tu touches « Verrouiller »).</li>
    <li>Factures et papiers de ta micro-entreprise : garde-les 10 ans (règle des papiers de comptabilité).</li>
    <li>Une date limite (fin de contrat, devis à signer, garantie) : le bot te prévient 30 jours avant, 7 jours avant et le jour même, sans dire de quel papier il s’agit.</li>
    <li>Chaque papier est aussi copié hors du serveur, chiffré avec ta clé de sauvegarde (celle de ta fiche de secours). Un papier retiré ici disparaît du serveur ; sa copie chiffrée reste dans les sauvegardes.</li></ul></section>
  </div>`, { nonce, script });
}

// One paper, shown inside the app (the app opened from the home screen has no back button: never a new tab).
export function coffreViewPage({ doc, places, nonce = null, script = null, token = '', vaultInfo = { etat: 'absent' }, verif = '', index = [], indice = '' }) {
  const t = TYPES.find(([k]) => k === doc.type) || ['autre', '📄', 'Autre'];
  const src = `/coffre/f/${esc(doc.id)}`;
  const sealedT = isE2(doc.titre);
  const name = `${String(sealedT ? 'papier' : doc.titre).replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 60) || 'papier'}.${doc.ext || 'pdf'}`;
  const back = `<a class="btn" href="/coffre?r=${encodeURIComponent(doc.rattache)}">← Retour au coffre</a>`;
  const title = sealedT ? `<span id="titre-papier" data-e2t="${esc(doc.titre)}" data-aad="${esc(doc.id)}:titre">Papier chiffré</span>` : `<span id="titre-papier">${esc(doc.titre)}</span>`;
  // Before a sealed paper leaves the vault: what keeps the iCloud level, what does not.
  const warn = doc.e2e ? `<div id="avertir" class="alert warn" hidden><b>Ce papier va sortir du coffre.</b> Hors du coffre, il n’est plus protégé par ton mot de passe. Pour garder le niveau iCloud :
     <ul style="margin:8px 0 8px 18px;padding:0"><li><b>Enregistrer dans Fichiers › iCloud Drive</b>, avec la protection avancée d’iCloud activée (Réglages › ton nom › iCloud › Protection avancée des données).</li><li>Ou l’envoyer par <b>Messages, WhatsApp ou Signal</b> (chiffrés de bout en bout).</li><li>Évite Mail, l’impression dans un lieu public et les applis que tu ne connais pas.</li></ul>
     <button type="button" id="avertir-ok">J’ai compris, continuer</button> <button type="button" class="ghost" id="avertir-non">Annuler</button></div>` : '';
  return layout(sealedT ? 'Papier chiffré' : doc.titre, '/coffre', `<p style="margin:0 0 10px">${back}</p>
  ${doc.e2e ? keyPanel({ vaultInfo, verif, token, index, indice }) : ''}
  <section class="card" style="margin-top:12px"><h2>${doc.e2e ? '🔒' : t[1]} ${title}</h2><p class="sub" style="margin-top:-6px">${esc(t[2])} · ${esc(libelle(places, doc.rattache))}${doc.date ? ` · ${esc(date(doc.date))}` : ''}${doc.e2e ? ' · chiffré sur ton iPhone' : ''}</p>
   <div id="papier" data-id="${esc(doc.id)}" data-src="${src}" data-mime="${esc(doc.mime)}" data-name="${esc(name)}" data-e2e="${doc.e2e ? '1' : '0'}"${doc.e2e ? ' hidden' : ''}>Chargement…</div>
   <div class="grid2"><button type="button" id="pleinecran" hidden>⛶ Plein écran</button><button type="button" id="partager" hidden>📤 Enregistrer ou envoyer</button></div>${warn}
   <p class="note">${doc.e2e ? 'Le papier est déchiffré dans ton téléphone, le temps de le lire. ' : ''}« Enregistrer ou envoyer » ouvre le menu de partage de l’iPhone. Rien ne part sans ton choix.</p></section>
  <p style="margin-top:14px">${back}</p>`, { nonce, script });
}
