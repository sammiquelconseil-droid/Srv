// Server-rendered pages. No script, no external resource: works on iPhone and desktop.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (c) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);
const date = (iso) => iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }) : '—';
const STATUT = { verifie: ['Vérifié', 'ok'], declare: ['Déclaré', 'info'], estime: ['Estimé', 'warn'], hypothese: ['Hypothèse', 'warn'], a_saisir: ['À saisir', 'muted'] };
const badge = (s) => { const [t, c] = STATUT[s] || [s, 'muted']; return `<span class="badge ${c}">${esc(t)}</span>`; };

const CSS = `
:root{--bg:#f4f5f7;--card:#fff;--ink:#14181f;--ink2:#4a5361;--line:#dfe3e8;--accent:#2f5bd3;--ok:#1d7a46;--okbg:#e3f3ea;--warn:#8a5a00;--warnbg:#fbf0d9;--bad:#b3261e;--badbg:#fbe4e2;--info:#2f5bd3;--infobg:#e6edfb}
@media (prefers-color-scheme:dark){:root{--bg:#0f1216;--card:#181c22;--ink:#e8ebef;--ink2:#a7b0bc;--line:#2a3039;--accent:#7ea1ff;--ok:#5fd394;--okbg:#14301f;--warn:#f0c060;--warnbg:#33270f;--bad:#ff8a80;--badbg:#3a1714;--info:#7ea1ff;--infobg:#18233d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
header{position:sticky;top:0;background:var(--card);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;gap:16px;align-items:center;z-index:2}
header b{font-size:17px;margin-right:auto}nav a{color:var(--ink2);text-decoration:none;font-weight:600;padding:8px 10px;border-radius:10px;display:inline-block;min-height:44px;line-height:28px}
nav a[aria-current]{color:var(--accent);background:var(--infobg)}
main{max-width:1200px;margin:0 auto;padding:16px}h1{font-size:26px;margin:4px 0 4px}h2{font-size:19px;margin:0 0 8px}.sub{color:var(--ink2);margin:0 0 16px;font-size:14px}
.grid{display:grid;gap:12px}.cards{display:grid;gap:12px}@media(min-width:900px){.cards{grid-template-columns:repeat(3,1fr)}.two{grid-template-columns:1fr 1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;min-width:0}
.kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:12px}@media(min-width:900px){.kpis{grid-template-columns:repeat(4,1fr)}}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px}.kpi span{display:block;font-size:13px;color:var(--ink2)}.kpi b{font-size:22px;font-variant-numeric:tabular-nums}
.row{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid var(--line);font-size:15px}.row:first-of-type{border-top:0}.row span:first-child{color:var(--ink2)}.row span:last-child{text-align:right;font-variant-numeric:tabular-nums}
.badge{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:999px;margin-left:6px;vertical-align:middle}
.ok{color:var(--ok);background:var(--okbg)}.warn{color:var(--warn);background:var(--warnbg)}.bad{color:var(--bad);background:var(--badbg)}.info{color:var(--info);background:var(--infobg)}.muted{color:var(--ink2);background:var(--bg)}
.bar{height:8px;background:var(--bg);border-radius:4px;overflow:hidden;margin:6px 0 10px}.bar i{display:block;height:100%;background:var(--ok)}
.alert{border-radius:12px;padding:10px 12px;font-size:14px;margin-top:10px}.note{font-size:13px;color:var(--ink2);margin-top:8px}
ul.plain{list-style:none;padding:0;margin:0}ul.plain li{padding:7px 0;border-top:1px solid var(--line);font-size:15px}ul.plain li:first-child{border-top:0}
`;

function layout(title, current, body) {
  const link = (href, label) => `<a href="${href}"${current === href ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#2f5bd3"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Cockpit">
<title>${esc(title)} · Cockpit</title><style>${CSS}</style></head><body>
<header><b>Cockpit</b><nav>${link('/', "Aujourd'hui")}${link('/patrimoine', 'Patrimoine')}</nav></header><main>${body}</main></body></html>`;
}

export function todayPage({ now, sante, sauvegarde, notes, echeances, alertes }) {
  const d = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
  const srv = sante ? `${sante.ok ? '<span class="badge ok">En bonne santé</span>' : '<span class="badge bad">À surveiller</span>'}
    <div class="row"><span>Correctifs de sécurité en attente</span><span>${sante.securite_en_attente}</span></div>
    <div class="row"><span>Disque utilisé</span><span>${sante.disque_pct} %</span></div>
    <div class="row"><span>Réseau privé</span><span>${sante.reseau_prive ? 'oui' : 'NON'}</span></div>` : '<p class="note">Pas encore de contrôle.</p>';
  const sv = sauvegarde ? `${sauvegarde.distant ? '<span class="badge ok">Copie hors serveur vérifiée</span>' : '<span class="badge bad">Copie hors serveur absente</span>'}
    <div class="row"><span>Dernière</span><span>${esc(new Date(sauvegarde.date).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }))}</span></div>
    <div class="row"><span>Taille</span><span>${Math.ceil(sauvegarde.taille / 1024)} Ko</span></div>` : '<p class="note">Pas encore de sauvegarde.</p>';
  const ech = echeances.length ? `<ul class="plain">${echeances.map((e) => `<li><b>${esc(date(e.date))}</b> · ${esc(e.nom)} · ${eur(e.montantCents)}</li>`).join('')}</ul><p class="note">Montants prévus par les actes. Le paiement réel sera confirmé par ton relevé bancaire.</p>` : '<p class="note">Aucune échéance dans les 30 prochains jours.</p>';
  const nts = notes.length ? `<ul class="plain">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '<p class="note">Aucune note. Envoie-en une à ton bot Telegram.</p>';
  const al = alertes.map((a) => `<div class="alert warn">${esc(a)}</div>`).join('');
  return layout("Aujourd'hui", '/', `<h1>Bonjour Sam</h1><p class="sub">${esc(d)}</p>${al}
  <div class="cards" style="margin-top:12px">
   <section class="card"><h2>Échéances à venir (30 jours)</h2>${ech}</section>
   <section class="card"><h2>Dernières notes</h2>${nts}</section>
   <section class="card"><h2>Serveur</h2>${srv}<h2 style="margin-top:14px">Sauvegarde</h2>${sv}</section>
  </div>`);
}

export function patrimoinePage({ summary, asOf }) {
  const t = summary.totals;
  const kpis = `<div class="kpis">
   <div class="kpi"><span>Reste à payer (théorique)</span><b>${eur(t.restantCents)}</b></div>
   <div class="kpi"><span>Mensualités</span><b>${eur(t.mensualitesCents)}</b></div>
   <div class="kpi"><span>Loyers bruts / mois</span><b>${eur(t.loyersCents)}</b></div>
   <div class="kpi"><span>Loyers − mensualités</span><b>${eur(t.fluxBrutCents)}</b></div></div>
   <p class="note">« Loyers − mensualités » est un flux brut : avant charges, taxe foncière, assurance et impôts. Ce n'est ni ton bénéfice ni ton revenu imposable.</p>`;
  const cards = summary.biens.map((b) => {
    const f = b.financement; const bal = b.balance;
    const loyers = b.loyers.length ? b.loyers.map((l) => `<div class="row"><span>Loyer ${esc(l.libelle.toLowerCase())}${badge(l.statut)}</span><span>${eur(l.montantCents)} / mois</span></div>`).join('') : `<div class="row"><span>Loyer</span><span>0 € · ${esc(b.situation)}</span></div>`;
    const hyp = (b.hypotheses || []).map((h) => `<div class="row"><span>${esc(h.libelle)}${badge(h.statut)}</span><span>${eur(h.montantCents)}</span></div>`).join('');
    const al = (b.alertes || []).map((a) => `<div class="alert warn">⚠️ ${esc(a)}</div>`).join('');
    return `<section class="card"><h2>${esc(b.nom)}</h2><p class="sub" style="margin:0 0 8px">${esc(b.type)} · ${esc(b.situation)}</p>
     <div class="row"><span>Achat${badge(b.achat.statut)}</span><span>${eur(b.achat.prixCents)} · ${esc(date(b.achat.date))}</span></div>
     <div class="row"><span>${esc(f.type)}${badge('estime')}</span><span>reste ${eur(bal.balanceCents)}</span></div>
     <div class="bar" role="img" aria-label="${Math.round(b.progress * 100)} % payé"><i style="width:${(b.progress * 100).toFixed(1)}%"></i></div>
     <div class="row"><span>Mensualité</span><span>${eur(f.mensualiteCents)}</span></div>
     <div class="row"><span>Échéances restantes</span><span>${bal.remaining} sur ${f.nombre}</span></div>
     <div class="row"><span>Prochaine</span><span>${esc(date(b.next))}</span></div>
     <div class="row"><span>Dernière</span><span>${esc(date(b.end))}</span></div>
     ${loyers}${hyp}${al}<p class="note">Paiement : ${esc(f.paiement)}.</p></section>`;
  }).join('');
  return layout('Patrimoine', '/patrimoine', `<h1>Patrimoine</h1><p class="sub">Calculé au ${esc(date(asOf))}, en supposant toutes les échéances payées jusqu'ici. La valeur actuelle des biens n'est pas encore estimée.</p>${kpis}<div class="cards">${cards}</div>`);
}

export function errorPage(msg) { return layout('Erreur', '', `<h1>Oups</h1><p>${esc(msg)}</p>`); }
