// Runs IN SAFARI (inlined in the Coffre pages with a nonce). Papers, their titles and notes are encrypted HERE, on the
// phone, before anything is sent: the server and the backups hold only what they cannot read. Same idea as iCloud's
// advanced data protection (names included). Plain script (no import/export): the tests load it in Node too.
//
// Keys (« vault », v2): a random vault key VK (AES-256) encrypts every paper. VK is stored on the server only WRAPPED
// (encrypted) by a key derived from the vault password (PBKDF2-SHA256, 600 000 rounds). Unlocking = typing the
// password once: VK comes back as a NON-EXTRACTABLE key (the page can use it, never read it), kept in this phone's
// IndexedDB for 15 minutes after its last use, wiped by « Verrouiller » and by the Face ID page.
// v1 papers (CKE1: one key per paper derived from the password) still open with the password.
/* global crypto, TextEncoder, TextDecoder, FormData, fetch, document, URL, Blob, File, navigator, window, location, btoa, atob, indexedDB */
const CoffreE2E = (() => {
  const enc = new TextEncoder();
  const V1 = enc.encode('CKE1'); // 4 + salt 16 + iv 12 + ciphertext/tag (legacy, per-paper password key)
  const V2 = enc.encode('CKE2'); // 4 + iv 12 + ciphertext/tag (vault key)
  const ITER = 600000;
  const KEEP_MS = 15 * 60e3; // same as the app's auto-lock
  const MIN_PW = 12; // the wrapped key sits on the server: a short password could be guessed offline
  const MIMES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic' };
  const bytes = (b) => new Uint8Array(b instanceof ArrayBuffer ? b : b.buffer ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b);
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

  // What the file really is, by its first bytes (same rule as the server for unencrypted papers).
  function detect(u8) {
    const s = (i, n) => String.fromCharCode(...u8.subarray(i, i + n));
    if (u8.length >= 5 && s(0, 5) === '%PDF-') return 'application/pdf';
    if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'image/jpeg';
    if (u8.length >= 8 && same(u8.subarray(0, 8), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (u8.length >= 12 && s(4, 4) === 'ftyp' && ['heic', 'heix', 'mif1', 'msf1', 'hevc'].includes(s(8, 4))) return 'image/heic';
    return null;
  }
  async function pwKey(password, salt, usages) {
    const raw = await crypto.subtle.importKey('raw', enc.encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, raw, { name: 'AES-GCM', length: 256 }, false, usages);
  }

  // --- Vault (v2) ---------------------------------------------------------------------------------------------
  async function createVault(password) {
    const salt = rand(16), iv = rand(12);
    const kek = await pwKey(password, salt, ['wrapKey', 'unwrapKey']);
    const vk = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const wrapped = bytes(await crypto.subtle.wrapKey('raw', vk, kek, { name: 'AES-GCM', iv }));
    const vault = { v: 2, salt: b64(salt), iv: b64(iv), wrapped: b64(wrapped) };
    return { vault, key: await unlockVault(vault, password) }; // the extractable copy is dropped here
  }
  // Wrong password: AES-GCM refuses to unwrap (throws). The key that comes back can never be exported.
  async function unlockVault(vault, password) {
    const kek = await pwKey(password, unb64(vault.salt), ['unwrapKey']);
    return crypto.subtle.unwrapKey('raw', unb64(vault.wrapped), kek, { name: 'AES-GCM', iv: unb64(vault.iv) }, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  // `aad` = « <paper id>:<field> »: a sealed file, title or note only opens as what it was sealed for (the server
  // cannot swap two papers' contents or move a note into a title without it being refused).
  const ad = (aad) => (aad ? { additionalData: enc.encode(String(aad)) } : {});
  async function sealBytes(key, data, aad = '') {
    const iv = rand(12);
    const ct = bytes(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, ...ad(aad) }, key, bytes(data)));
    const out = new Uint8Array(16 + ct.length); out.set(V2, 0); out.set(iv, 4); out.set(ct, 16);
    return out;
  }
  const isV2 = (u8) => u8.length > 16 && same(u8.subarray(0, 4), V2);
  const isV1 = (u8) => u8.length > 32 && same(u8.subarray(0, 4), V1);
  const isSealed = (u8) => isV1(u8) || isV2(u8);
  async function openBytes(key, blob, aad = '') {
    const u8 = bytes(blob);
    if (!isV2(u8)) throw new Error('format');
    return bytes(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(4, 16), ...ad(aad) }, key, u8.subarray(16)));
  }
  const sealText = async (key, text, aad = '') => 'e2:' + b64(await sealBytes(key, enc.encode(String(text)), aad));
  const openText = async (key, s, aad = '') => new TextDecoder().decode(await openBytes(key, unb64(String(s).slice(3)), aad));
  const newId = () => Array.from(rand(12), (x) => x.toString(16).padStart(2, '0')).join('');

  // --- Legacy v1 (kept to open papers sealed before the vault existed) ----------------------------------------
  async function encrypt(data, password) {
    const salt = rand(16), iv = rand(12);
    const ct = bytes(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await pwKey(password, salt, ['encrypt']), bytes(data)));
    const out = new Uint8Array(32 + ct.length); out.set(V1, 0); out.set(salt, 4); out.set(iv, 20); out.set(ct, 32);
    return out;
  }
  async function decrypt(blob, password) {
    const u8 = bytes(blob);
    if (!isV1(u8)) throw new Error('format inconnu');
    return bytes(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(20, 32) }, await pwKey(password, u8.subarray(4, 20), ['decrypt']), u8.subarray(32)));
  }
  const SENTENCE = 'cockpit-coffre-ok';
  const makeVerifier = (password) => encrypt(enc.encode(SENTENCE), password);
  async function checkVerifier(blob, password) {
    try { return new TextDecoder().decode(await decrypt(blob, password)) === SENTENCE; } catch { return false; }
  }

  // --- The unlocked key on this phone (IndexedDB, 15 min after last use) ---------------------------------------
  const DB = 'cockpit-coffre';
  const idb = (mode, fn) => new Promise((ok, ko) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('k');
    r.onerror = () => ko(r.error);
    r.onsuccess = () => { const t = r.result.transaction('k', mode); const q = fn(t.objectStore('k')); t.oncomplete = () => { r.result.close(); ok(q && q.result); }; t.onerror = () => ko(t.error); };
  });
  async function cachedKey() {
    try {
      const v = await idb('readonly', (s) => s.get('vk'));
      if (!v || v.exp < Date.now()) { await forget(); return null; }
      await idb('readwrite', (s) => s.put({ key: v.key, exp: Date.now() + KEEP_MS }, 'vk'));
      return v.key;
    } catch { return null; }
  }
  const remember = (key) => idb('readwrite', (s) => s.put({ key, exp: Date.now() + KEEP_MS }, 'vk')).catch(() => {});
  const forget = () => idb('readwrite', (s) => s.delete('vk')).catch(() => {});

  // --- Shared page helpers ------------------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const say = (el, t, bad = true) => { el.textContent = t; el.className = 'alert ' + (bad ? 'bad' : 'ok'); el.hidden = false; };
  const state = () => {
    const e = $('coffre-etat'); let vault = null;
    try { vault = e && e.dataset.vault ? JSON.parse(e.dataset.vault) : null; } catch { vault = null; }
    return { vault, verif: (e && e.dataset.verif) || '', v1: ((e && e.dataset.v1) || '').split(',').filter(Boolean) };
  };
  // Titles and notes sealed on the phone are shown, once unlocked, with textContent (never as HTML).
  async function revealTexts(key) {
    for (const el of document.querySelectorAll('[data-e2t]')) { try { el.textContent = await openText(key, el.dataset.e2t, el.dataset.aad); } catch { el.textContent = '🔒 illisible'; } }
    for (const el of document.querySelectorAll('input[data-e2v]')) { try { el.value = await openText(key, el.dataset.e2v, el.dataset.aad); } catch { /* left empty */ } }
  }
  // v1 → v2, once: each paper sealed with the first method is opened with the password and sealed again with the
  // vault key, title and note included, then replaces the old one on the server (same id).
  async function migrate(key, password, ids, jeton) {
    let done = 0;
    for (const id of ids) {
      const r = await fetch('/coffre/f/' + id, { credentials: 'same-origin' }); if (!r.ok) continue;
      const plain = await decrypt(await r.arrayBuffer(), password);
      const row = document.querySelector(`[data-v1-id="${id}"]`);
      const fd = new FormData();
      fd.append('jeton', jeton); fd.append('id', id);
      fd.append('titre', await sealText(key, row ? row.dataset.titre : 'papier', id + ':titre'));
      if (row && row.dataset.note) fd.append('note', await sealText(key, row.dataset.note, id + ':note'));
      fd.append('fichier', new Blob([await sealBytes(key, plain, id + ':fichier')]), 'papier.ckf');
      const j = await fetch('/coffre/remplacer', { method: 'POST', body: fd, credentials: 'same-origin', headers: { accept: 'application/json' } }).then((x) => x.json()).catch(() => ({ ok: false }));
      if (j.ok) done += 1;
    }
    return done;
  }
  // The key panel: create the vault password (first time), move from v1, or unlock. Calls back with the key.
  function wirePanel(onKey) {
    const p = $('panneau-cle'); if (!p) return;
    const msg = $('cle-msg'), mode = p.dataset.mode, { vault, verif, v1 } = state();
    const status = $('cle-ouverte'), close = $('verrouiller-coffre');
    const opened = (key) => { p.hidden = true; if (status) status.hidden = false; onKey(key); };
    if (close) close.onclick = async () => { await forget(); location.reload(); };
    if (mode === 'abime' || mode === 'migrer') { p.hidden = false; if (mode === 'abime') return; }
    const form = p.querySelector('form'); if (!form) { p.hidden = false; return; } // « abîmé »: nothing to type
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target, p1 = f.cpw1.value, p2 = f.cpw2 ? f.cpw2.value : '';
      f.cpw1.value = ''; if (f.cpw2) f.cpw2.value = '';
      if (mode !== 'ouvrir' && p1.length < MIN_PW) return say(msg, `Au moins ${MIN_PW} caractères : le plus sûr, 4 ou 5 mots au hasard (ex. « tortue bleu cerise orage »).`);
      say(msg, 'Un instant…', false);
      try {
        let key;
        if (mode === 'ouvrir') key = await unlockVault(vault, p1).catch(() => null);
        else {
          if (mode === 'creer' && p1 !== p2) return say(msg, 'Les deux mots de passe ne sont pas identiques.');
          if (mode === 'migrer') {
            // the password must open the papers already sealed (verifier, else the first old paper itself)
            let ok = verif ? await checkVerifier(unb64(verif), p1) : false;
            if (!ok && v1.length) { try { const r = await fetch('/coffre/f/' + v1[0], { credentials: 'same-origin' }); await decrypt(await r.arrayBuffer(), p1); ok = true; } catch { ok = false; } }
            if (!ok) return say(msg, 'Ce n’est pas ton mot de passe du coffre (celui de tes papiers 🔒 déjà rangés).');
          }
          const made = await createVault(p1);
          const r = await fetch('/coffre/cle', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ jeton: p.dataset.jeton, vault: made.vault }) });
          const j = await r.json().catch(() => ({ ok: false, text: 'Le serveur n’a pas répondu.' }));
          if (!j.ok) return say(msg, j.text);
          key = made.key;
          if (mode === 'migrer' && v1.length) {
            say(msg, 'Conversion de tes papiers 🔒 déjà rangés…', false);
            const n = await migrate(key, p1, v1, p.dataset.jeton);
            if (n < v1.length) { await remember(key); return say(msg, `${v1.length - n} papier(s) n’ont pas pu être convertis. Recharge la page et rouvre le coffre pour réessayer.`); }
            await remember(key); location.reload(); return;
          }
        }
        if (!key) return say(msg, 'Mot de passe incorrect. Le coffre reste fermé.');
        await remember(key); msg.hidden = true; opened(key);
      } catch { say(msg, 'Le coffre n’a pas pu être ouvert. Réessaie.'); }
    });
    if (mode === 'ouvrir') cachedKey().then((k) => { if (k) opened(k); else p.hidden = false; }); else p.hidden = false;
  }

  // --- Page « Coffre » : list + filing form ---------------------------------------------------------------------
  function wireList() {
    const form = $('form-ranger'); if (!form) return;
    let key = null;
    const box = $('n-sensible'), msg = $('pw-msg');
    // The listeners come first: if anything else on the page fails, a 🔒 paper is still never sent in clear
    // (and the server refuses a « sensible » paper that is not sealed).
    form.addEventListener('submit', async (ev) => {
      if (!box.checked) return; // ticked off: the plain form (server-side encryption only)
      ev.preventDefault();
      if (!key) { const pc = $('panneau-cle'); if (pc) pc.scrollIntoView({ behavior: 'smooth' }); return say(msg, 'Ouvre d’abord ton coffre avec ton mot de passe (en haut de la page).'); }
      const file = form.fichier.files[0];
      if (!file) return say(msg, 'Choisis d’abord un fichier.');
      const data = new Uint8Array(await file.arrayBuffer());
      const mime = detect(data);
      if (!mime) return say(msg, 'Seuls les PDF et les photos (JPEG, PNG, HEIC) sont acceptés.');
      if (!form.titre.value.trim()) return say(msg, 'Donne un titre au papier.');
      say(msg, 'Chiffrement sur ton téléphone…', false);
      const id = newId();
      const fd = new FormData();
      for (const [k, v] of new FormData(form)) if (!['fichier', 'titre', 'note'].includes(k)) fd.append(k, v);
      fd.append('id', id);
      fd.append('titre', await sealText(key, form.titre.value.trim(), id + ':titre'));
      if (form.note.value.trim()) fd.append('note', await sealText(key, form.note.value.trim(), id + ':note'));
      fd.append('mime', mime);
      fd.append('fichier', new Blob([await sealBytes(key, data, id + ':fichier')]), 'papier.ckf');
      let j;
      try { const r = await fetch('/coffre/ajouter', { method: 'POST', body: fd, credentials: 'same-origin', headers: { accept: 'application/json' } }); j = await r.json(); }
      catch { return say(msg, 'Le serveur n’a pas répondu. Rien n’a été rangé : réessaie.'); }
      if (!j.ok) return say(msg, j.text);
      say(msg, j.text, false);
      setTimeout(() => location.assign('/coffre?r=' + encodeURIComponent(form.rattache.value)), 1000);
    });
    // Editing a 🔒 paper: any title or note not already sealed is sealed before leaving the phone (decided field by
    // field at each submit; f.submit() does not fire this handler again).
    for (const f of document.querySelectorAll('form[data-e2e="1"]')) {
      f.addEventListener('submit', async (ev) => {
        if (!f.titre) return; // the « retirer » form
        ev.preventDefault();
        if (!key) return say(msg, 'Ouvre d’abord ton coffre avec ton mot de passe (en haut de la page).');
        for (const n of ['titre', 'note']) {
          const v = f[n].value.trim();
          if (v && !v.startsWith('e2:')) { f[n].removeAttribute('maxlength'); f[n].value = await sealText(key, v, f.dataset.id + ':' + n); }
        }
        f.submit();
      });
    }
    wirePanel(async (k) => { key = k; await revealTexts(k); });
  }
  // --- Page of one paper ----------------------------------------------------------------------------------------
  // Every page of a PDF is drawn with PDF.js (the iPhone shows only the first page of a PDF placed in a page).
  async function showPaper(out, data, mime, name, sensitive) {
    out.hidden = false; out.className = ''; out.textContent = 'Affichage…';
    if (mime === 'application/pdf') {
      const pdfjs = await import('/coffre/pdfjs.mjs?v=4.10.38');
      pdfjs.GlobalWorkerOptions.workerSrc = '/coffre/pdfworker.mjs?v=4.10.38';
      const pdf = await pdfjs.getDocument({ data: data.slice(), isEvalSupported: false }).promise;
      out.textContent = '';
      const width = Math.max(out.clientWidth, 280), ratio = Math.min(window.devicePixelRatio || 1, 3);
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * ratio });
        const c = document.createElement('canvas');
        c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
        c.style.cssText = 'width:100%;height:auto;display:block;background:#fff;border-radius:8px;margin:0 0 10px;box-shadow:0 1px 4px rgba(0,0,0,.15)';
        c.setAttribute('aria-label', `page ${i} sur ${pdf.numPages}`);
        out.append(c);
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      }
    } else {
      const img = document.createElement('img');
      img.alt = name; img.style.cssText = 'max-width:100%;border-radius:12px;display:block';
      img.src = URL.createObjectURL(new Blob([data], { type: mime }));
      out.textContent = ''; out.append(img);
    }
    // « Enregistrer ou envoyer »: the iPhone's share sheet, from memory. A paper leaving the vault is no longer
    // protected by it: for a sealed paper, a warning first, with the choices that keep the iCloud level.
    const share = $('partager'), warn = $('avertir');
    if (!share) return;
    const file = new File([data], name, { type: mime });
    const go = async () => {
      try { if (navigator.canShare && navigator.canShare({ files: [file] })) return await navigator.share({ files: [file] }); }
      catch (e) { if (e && e.name === 'AbortError') return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.append(a); a.click(); a.remove();
    };
    share.hidden = false;
    share.onclick = () => { if (sensitive && warn) { warn.hidden = false; share.hidden = true; } else go(); };
    if (warn) { $('avertir-ok').onclick = () => { warn.hidden = true; share.hidden = false; go(); }; $('avertir-non').onclick = () => { warn.hidden = true; share.hidden = false; }; }
  }
  function wireView() {
    const out = $('papier'); if (!out) return;
    const mime = MIMES[out.dataset.mime] ? out.dataset.mime : null; // never a type the browser could run
    const fail = (t) => { out.hidden = false; out.className = 'alert bad'; out.textContent = t; };
    const fetchBytes = () => fetch(out.dataset.src, { credentials: 'same-origin' }).then((r) => { if (!r.ok) throw new Error(); return r.arrayBuffer(); }).then((b) => new Uint8Array(b));
    if (!mime) return fail('Type de papier inconnu.');
    if (out.dataset.e2e !== '1') {
      fetchBytes().then((b) => showPaper(out, b, mime, out.dataset.name || 'papier', false)).catch(() => fail('Le papier n’a pas pu être affiché. Recharge la page.'));
      return;
    }
    wirePanel(async (key) => {
      await revealTexts(key);
      const title = $('titre-papier');
      const name = `${(title ? title.textContent : 'papier').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 60) || 'papier'}.${MIMES[mime]}`;
      out.hidden = false; out.className = ''; out.textContent = 'Déchiffrement sur ton téléphone…';
      try {
        const sealed = await fetchBytes();
        if (!isV2(sealed)) return fail('Ce papier date d’avant la nouvelle protection : retourne au coffre, il sera converti dès que tu l’ouvres avec ton mot de passe.');
        await showPaper(out, await openBytes(key, sealed, out.dataset.id + ':fichier'), mime, name, true);
      } catch { fail('Papier illisible avec cette clé. Rien n’a été ouvert.'); }
    });
  }
  if (typeof document !== 'undefined') { wireList(); wireView(); }
  return { detect, createVault, unlockVault, sealBytes, openBytes, sealText, openText, newId, isSealed, isV1, isV2, encrypt, decrypt, makeVerifier, checkVerifier, b64, unb64, MIMES, ITER, KEEP_MS, MIN_PW };
})();
if (typeof globalThis !== 'undefined') globalThis.CoffreE2E = CoffreE2E;
