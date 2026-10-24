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
form .f{display:flex;flex-direction:column;gap:4px;margin:10px 0}form label{font-weight:600;font-size:14px;color:var(--ink2)}
input{font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);min-height:44px;width:100%}
button.ghost{background:transparent;color:var(--ink2);border:1px solid var(--line);padding:6px 10px;margin:0;font-size:14px}
button{font:inherit;font-weight:700;background:var(--accent);color:#fff;border:0;border-radius:12px;padding:12px 18px;min-height:44px;margin-top:8px}
header{flex-wrap:wrap}ul.plain{list-style:none;padding:0;margin:0}ul.plain li{padding:7px 0;border-top:1px solid var(--line);font-size:15px}ul.plain li:first-child{border-top:0}
`;

function layout(title, current, body, { nonce, script, noNav } = {}) {
  const link = (href, label) => `<a href="${href}"${current === href ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#2f5bd3"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Cockpit">
<title>${esc(title)} · Cockpit</title><style>${CSS}</style></head><body>
<header><b>Cockpit</b>${noNav ? '' : `<nav>${link('/', "Aujourd'hui")}${link('/patrimoine', 'Patrimoine')}${link('/mes-chiffres', 'Mes chiffres')}</nav><form method="post" action="/deconnexion" style="margin:0"><button type="submit" class="ghost">Verrouiller</button></form>`}</header><main>${body}</main>${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`;
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
   <section class="card"><h2>Revenus</h2>
    <div class="f"><label for="salaire">Salaire net mensuel (€)${when('salaire')}</label><input id="salaire" name="salaire" inputmode="decimal" autocomplete="off" placeholder="ex. 1 650,00" value="${v('salaire')}"></div>
    <p class="note">Laisse vide ce que tu ne sais pas encore.</p></section>
   <section class="card"><h2>Abonnements réels (€ / mois)</h2>${abos}
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
  return layout('Accès', '', `<h1>Accès au Cockpit</h1>
  <p class="sub">Face ID (ou le code de ton appareil) ouvre tes écrans. Rien d'autre n'est demandé.</p>
  <div id="msg" class="alert" hidden></div>
  <div class="cards two">
   <section class="card"><h2>Ouvrir</h2><p class="note">${hasKeys ? 'Avec un appareil déjà enregistré.' : 'Aucun appareil enregistré pour l’instant : enregistre d’abord celui-ci.'}</p>
    <button type="button" id="btn-connexion"${hasKeys ? '' : ' hidden'}>Ouvrir avec Face ID</button></section>
   <section class="card"><h2>Enregistrer cet appareil</h2>
    <p class="note">Envoie <b>/acces</b> à ton bot Telegram : il te donne un code valable 10 minutes.</p>
    <div class="f"><label for="code">Code reçu du bot</label><input id="code" inputmode="numeric" autocomplete="one-time-code" placeholder="6 chiffres"></div>
    <div class="f"><label for="label">Nom de l’appareil</label><input id="label" placeholder="ex. iPhone de Sam" maxlength="40"></div>
    <button type="button" id="btn-inscription">Enregistrer avec Face ID</button></section>
  </div>`, { nonce, script: ACCES_JS, noNav: true });
}

export function errorPage(msg) { return layout('Erreur', '', `<h1>Oups</h1><p>${esc(msg)}</p>`); }
