// Server-rendered pages. No script, no external resource: works on iPhone and desktop.
import { ETAPES, trier, compter, aRelancer } from '../src/prospects.mjs';
import { TYPES, filtrer, annee, compterPar, aFaire, libelle } from '../src/coffre.mjs';
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
nav{display:flex;gap:2px}nav a{color:var(--ink2);text-decoration:none;font-weight:600;padding:8px 12px;border-radius:12px;min-height:44px;line-height:28px;display:inline-flex;align-items:center;gap:6px}
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
li.task details{margin-top:6px}li.task summary{cursor:pointer;color:var(--accent);font-size:14px;font-weight:600;list-style:none}li.task summary::-webkit-details-marker{display:none}li.task summary::after{content:' ▾'}li.task details[open] summary::after{content:' ▴'}
.proj{font-size:12.5px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.6px;margin:14px 0 2px}.proj:first-child{margin-top:0}
.dl{display:flex;gap:12px;align-items:flex-start}.dl .dt{flex:0 0 auto;min-width:64px;text-align:center;background:var(--bg);border-radius:12px;padding:6px 8px;line-height:1.15}.dl .dt b{display:block;font-size:19px;letter-spacing:-.3px}.dl .dt span{font-size:11.5px;color:var(--ink2);text-transform:uppercase;letter-spacing:.4px}
form .f{display:flex;flex-direction:column;gap:4px;margin:10px 0}form label{font-weight:600;font-size:14px;color:var(--ink2)}
input{font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--bg);color:var(--ink);min-height:44px;width:100%}input:focus{outline:2px solid var(--accent);outline-offset:1px;background:var(--card)}
button{font:inherit;font-weight:700;background:var(--accent);color:#fff;border:0;border-radius:14px;padding:12px 18px;min-height:44px;margin-top:8px;cursor:pointer}
button.ghost{background:transparent;color:var(--ink2);border:1px solid var(--line);padding:6px 12px;margin:0;font-size:14px;min-height:36px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
select,textarea{font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--bg);color:var(--ink);min-height:44px;width:100%}textarea{min-height:72px;resize:vertical}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}h3{font-size:14px;color:var(--ink2);text-transform:uppercase;letter-spacing:.5px;margin:16px 0 4px}
a.btn{display:inline-block;font-weight:700;background:var(--accentbg);color:var(--accent);border-radius:14px;padding:10px 16px;min-height:44px;line-height:24px;text-decoration:none;margin-top:8px}
button.danger{background:var(--badbg);color:var(--bad)}
footer.foot{display:none}@media(max-width:899px){nav a.more{display:none}footer.foot{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:22px}footer.foot a{color:var(--ink2);font-weight:600;text-decoration:none;padding:10px 14px;border-radius:12px;background:var(--card);min-height:44px}}
.chips.f a{background:var(--card);color:var(--ink2);border:1px solid var(--line);text-decoration:none;border-radius:999px;padding:8px 12px;font-size:14px;font-weight:600;white-space:nowrap;min-height:40px;display:inline-flex;align-items:center}.chips.f a[aria-current]{background:var(--accent);color:#fff;border-color:var(--accent)}
li.doc{display:flex;gap:12px;align-items:flex-start}li.doc .ic{font-size:24px;line-height:1.2}li.doc a.t{font-weight:700;color:var(--ink);text-decoration:none;font-size:16px}li.doc .m{color:var(--ink2);font-size:13.5px;margin-top:2px}li.doc details{margin-top:6px}li.doc summary{cursor:pointer;color:var(--accent);font-size:14px;font-weight:600}
`;

// Five tabs on the phone (bottom bar); « more » ones are in the header on a computer and in the footer on a phone.
const NAV = [['/', '🏠', "Aujourd'hui"], ['/patrimoine', '🏡', 'Patrimoine'], ['/coffre', '🗄', 'Coffre'], ['/dossier', '🗂', 'Dossier'], ['/prospects', '🎯', 'Prospects'], ['/mes-chiffres', '💶', 'Mes chiffres', 'more'], ['/sauvegardes', '🔐', 'Sauvegardes', 'more']];
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
const taskHtml = (line) => {
  const t = parseTask(line);
  const detail = !t.reste ? '' : t.reste.length <= 170 ? `<p class="d">${esc(t.reste)}</p>` : `<details><summary>Le détail</summary><p class="d">${esc(t.reste)}</p></details>`;
  return `<li class="task">${t.quand ? `<span class="when ${t.urgence}">${esc(t.quand)}</span>` : ''}<span class="t">${esc(t.geste)}</span>${detail}${t.pourquoi ? `<p class="w">Pourquoi toi · ${esc(t.pourquoi)}</p>` : ''}</li>`;
};

export function todayPage({ now, sante, sauvegarde, notes, echeances, fiscal = [], alertes, attentes = null, budget = null }) {
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
    ? attentes.projets.map((p) => `<p class="proj">${esc(p.label)}</p><ol class="plain">${p.lignes.map(taskHtml).join('')}</ol>`).join('')
      + `<p class="note">Mis à jour ${esc(new Date(attentes.date).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }))}, dans l’ordre où les faire. Lu dans les fichiers de tes projets ; le bot ne montre que le nombre.</p>`
    : (attentes ? empty('✨', 'Rien n’attend ta décision. Profite.') : empty('⏳', 'Pas encore lu : le bot remplit cette liste dans l’heure qui suit son démarrage.'));
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

const ACCES_JS = `
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
export function coffrePage({ index = [], places = [], filtre = {}, token, message, sent = null, distant = null, cle = true, todayIso, nonce = null, script = null, verif = '' }) {
  const counts = compterPar(index);
  const docs = filtrer(index, filtre).filter((d) => !filtre.afaire || d.afaire === 'a_faire');
  const todo = aFaire(index).length;
  const AF = [['', '·', 'Rien à faire'], ['a_faire', '📌', 'À faire (devis à signer, courrier à répondre…)'], ['fait', '✅', 'Fait']];
  // p = prefix of the element ids only (one form per paper on the page); names stay the same. `back` = what was typed, re-shown after a refusal.
  const metaFields = (p, d = {}, back = null) => {
    const v = (name, stored) => (back && name in back ? back[name] : stored ?? '');
    const inp = (name, label, value, { type = 'text', max, ph = '' } = {}) => `<div class="f"><label for="${p}${name}">${label}</label><input id="${p}${name}" name="${name}" type="${type}" value="${esc(v(name, value))}"${max ? ` maxlength="${max}"` : ''} placeholder="${esc(ph)}" autocomplete="off"></div>`;
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
    return `<li class="doc"><span class="ic" aria-hidden="true">${ic}</span><div style="flex:1;min-width:0"><a class="t" href="/coffre/voir/${esc(d.id)}">${d.e2e ? '🔒 ' : ''}${esc(d.titre)}</a>${badges}
      <div class="m">${esc(tl)}${d.date ? ` · ${esc(fmt(d.date))}` : ''} · ${esc(libelle(places, d.rattache))}${d.note ? ` · ${esc(d.note)}` : ''}</div>
      <details><summary>Modifier</summary><form method="post" action="/coffre/modifier">${tok}<input type="hidden" name="id" value="${esc(d.id)}">${metaFields(`e${d.id}-`, d)}<button type="submit">Enregistrer</button></form>
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
   <p class="sub">Tes papiers, chiffrés sur ton serveur. Ils s’ouvrent seulement ici, après Face ID. Rien ne va sur GitHub en clair, rien dans Telegram, rien chez une IA.</p>
   <div class="chips"><span class="chip">📄 ${index.length} papier${index.length > 1 ? 's' : ''}</span>${todo ? `<span class="chip">📌 ${todo} à faire</span>` : ''}${copies}</div></section>
  ${cle ? '' : '<div class="alert warn">Le coffre s’ouvre après la prochaine mise à jour du serveur (/maj dans le bot). Tu pourras alors ranger tes papiers.</div>'}
  ${message ? `<div class="alert ${message.ok ? 'ok' : 'bad'}">${esc(message.text)}</div>` : ''}
  <div class="cards" style="margin-top:12px">
   <section class="card wide"><details${!index.length || (message && !message.ok && sent) ? ' open' : ''}><summary style="cursor:pointer;font-weight:700;font-size:17px;list-style:none">➕ Ranger un papier${here ? ` dans ${esc(here)}` : ''}</summary>
    <form method="post" action="/coffre/ajouter" enctype="multipart/form-data" style="margin-top:10px" id="form-ranger" data-verif="${esc(verif)}">${tok}
     <div class="f"><label for="fichier">Photo ou PDF (15 Mo maximum)</label><input id="fichier" name="fichier" type="file" accept="application/pdf,image/jpeg,image/png,image/heic" required></div>
     <p class="note" style="margin-top:0">Pour un papier : « Choisir un fichier », puis <b>⋯</b> en haut à droite, puis <b>Scanner des documents</b>. L’iPhone redresse la page tout seul.</p>
     ${metaFields('n-', {}, sent)}
     <label style="display:flex;gap:10px;align-items:flex-start;font-size:15px;margin:12px 0 4px"><input type="checkbox" id="n-sensible" name="sensible" value="1" style="width:22px;height:22px;min-height:0;flex:none;margin-top:2px"><span><b>🔒 Très sensible</b> (identité, RIB, santé) : chiffré sur ton iPhone avec ton mot de passe du coffre, avant l’envoi. Le serveur ne peut pas le lire.</span></label>
     <div id="pw-wrap" hidden><div class="grid2"><div class="f"><label for="pw1">Mot de passe du coffre</label><input id="pw1" name="pw1" type="password" autocomplete="off" minlength="8"></div>${verif ? '' : '<div class="f"><label for="pw2">Retape-le (première fois)</label><input id="pw2" name="pw2" type="password" autocomplete="off"></div>'}</div>
      <p class="note" style="margin-top:0">${verif ? 'Le même mot de passe que pour tes autres papiers « très sensibles ».' : 'Choisis-le maintenant, une fois pour toutes, et écris-le sur ta fiche de secours. Perdu = ces papiers sont perdus, même pour Claude.'}</p></div>
     <div id="pw-msg" class="alert" hidden></div>
     <button type="submit">🔐 Ranger dans le coffre</button></form></details></section>
   <section class="card wide"><div class="chips f" style="margin-bottom:10px">${chips}</div>${list}</section>
   <section class="card wide"><h2>💡 Bon à savoir</h2><ul class="plain">
    <li>Pièce d’identité, RIB, papiers de santé : coche <b>🔒 Très sensible</b>. Le papier est alors chiffré sur ton iPhone avec ton mot de passe du coffre, que le serveur ne reçoit jamais : même quelqu’un qui prendrait le serveur ou une sauvegarde ne pourrait pas le lire. C’est le même principe que la protection avancée d’iCloud.</li>
    <li>Ce mot de passe du coffre : 8 caractères au moins, écrit sur ta fiche de secours. Il n’est stocké nulle part. Perdu = les papiers « très sensibles » sont perdus pour de bon.</li>
    <li>Factures et papiers de ta micro-entreprise : garde-les 10 ans (règle des papiers de comptabilité).</li>
    <li>Une date limite (fin de contrat, devis à signer, garantie) : le bot te prévient 30 jours avant, 7 jours avant et le jour même, sans dire de quel papier il s’agit.</li>
    <li>Chaque papier est aussi copié hors du serveur, chiffré avec ta clé de sauvegarde (celle de ta fiche de secours). Un papier retiré ici disparaît du serveur ; sa copie chiffrée reste dans les sauvegardes.</li></ul></section>
  </div>`, { nonce, script });
}

// One paper, shown inside the app (the app opened from the home screen has no back button: never a new tab).
export function coffreViewPage({ doc, places, nonce = null, script = null }) {
  const t = TYPES.find(([k]) => k === doc.type) || ['autre', '📄', 'Autre'];
  const src = `/coffre/f/${esc(doc.id)}`;
  if (doc.e2e) return layout(doc.titre, '/coffre', `<p style="margin:0 0 10px"><a class="btn" href="/coffre?r=${encodeURIComponent(doc.rattache)}">← Retour au coffre</a></p>
  <section class="card"><h2>🔒 ${esc(doc.titre)}</h2><p class="sub" style="margin-top:-6px">${esc(t[2])} · ${esc(libelle(places, doc.rattache))}${doc.date ? ` · ${esc(date(doc.date))}` : ''} · chiffré sur ton iPhone</p>
   <form id="form-ouvrir" data-src="${src}" data-mime="${esc(doc.mime)}"><div class="f"><label for="pw">Mot de passe du coffre</label><input id="pw" name="pw" type="password" autocomplete="off" required></div><button type="submit">🔓 Ouvrir ici</button></form>
   <div id="pw-msg" class="alert" hidden></div><div id="papier" hidden></div>
   <p class="note">Le papier est déchiffré dans ton téléphone, le temps de le lire. Rien n’est envoyé ni gardé.</p></section>`, { nonce, script });
  const view = doc.mime === 'application/pdf'
    ? `<iframe src="${src}" title="${esc(doc.titre)}" style="width:100%;height:70vh;border:0;border-radius:12px;background:#fff"></iframe>
       <p class="note">Le document ne s’affiche pas en entier ? Touche « Ouvrir en grand », puis glisse depuis le bord gauche de l’écran pour revenir.</p>`
    : `<img src="${src}" alt="${esc(doc.titre)}" style="max-width:100%;border-radius:12px;display:block">`;
  return layout(doc.titre, '/coffre', `<p style="margin:0 0 10px"><a class="btn" href="/coffre?r=${encodeURIComponent(doc.rattache)}">← Retour au coffre</a></p>
  <section class="card"><h2>${t[1]} ${esc(doc.titre)}</h2><p class="sub" style="margin-top:-6px">${esc(t[2])} · ${esc(libelle(places, doc.rattache))}${doc.date ? ` · ${esc(date(doc.date))}` : ''}</p>
   ${view}<p><a class="btn" href="${src}">🔍 Ouvrir en grand</a></p></section>`);
}
