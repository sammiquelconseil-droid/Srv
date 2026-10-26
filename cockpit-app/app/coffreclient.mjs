// Runs IN SAFARI (inlined in the Coffre pages with a nonce): « très sensible » papers are encrypted here, on the
// phone, with a vault password the server never receives. The server stores and backs up only the result; without
// the password, nobody can read these papers: not the server, not a backup, not Claude. Same idea as iCloud's
// advanced data protection. Plain script (no import/export): also loaded by the tests in Node, same WebCrypto.
/* global crypto, TextEncoder, FormData, fetch, document, URL, Blob, alert */
const CoffreE2E = (() => {
  const MAGIC = new TextEncoder().encode('CKE1'); // 4 bytes, then 16 salt, 12 iv, then AES-GCM ciphertext+tag
  const ITER = 600000; // PBKDF2-SHA256 (OWASP 2023 figure); ~1 s on a recent iPhone
  const MIMES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic' };
  const bytes = (b) => new Uint8Array(b instanceof ArrayBuffer ? b : b.buffer ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b);
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  // What the file really is, by its first bytes (same rule as the server for ordinary papers).
  function detect(u8) {
    const s = (i, n) => String.fromCharCode(...u8.subarray(i, i + n));
    if (u8.length >= 5 && s(0, 5) === '%PDF-') return 'application/pdf';
    if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'image/jpeg';
    if (u8.length >= 8 && same(u8.subarray(0, 8), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (u8.length >= 12 && s(4, 4) === 'ftyp' && ['heic', 'heix', 'mif1', 'msf1', 'hevc'].includes(s(8, 4))) return 'image/heic';
    return null;
  }
  async function key(password, salt) {
    const raw = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encrypt(data, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = bytes(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(password, salt), bytes(data)));
    const out = new Uint8Array(4 + 16 + 12 + ct.length);
    out.set(MAGIC, 0); out.set(salt, 4); out.set(iv, 20); out.set(ct, 32);
    return out;
  }
  const isSealed = (u8) => u8.length > 32 && same(u8.subarray(0, 4), MAGIC);
  // Wrong password (or a damaged file) throws: AES-GCM refuses anything it cannot authenticate.
  async function decrypt(blob, password) {
    const u8 = bytes(blob);
    if (!isSealed(u8)) throw new Error('format inconnu');
    return bytes(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(20, 32) }, await key(password, u8.subarray(4, 20)), u8.subarray(32)));
  }
  // The « verifier »: a known sentence sealed with the vault password, kept by the server so that a later upload
  // can check the password is the usual one (a typo would otherwise seal a paper for ever).
  const SENTENCE = 'cockpit-coffre-ok';
  const makeVerifier = (password) => encrypt(new TextEncoder().encode(SENTENCE), password);
  async function checkVerifier(blob, password) {
    try { return new TextDecoder().decode(await decrypt(blob, password)) === SENTENCE; } catch { return false; }
  }
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  // --- Page « Coffre » : the filing form -------------------------------------------------------------------
  function wireUpload() {
    const form = document.getElementById('form-ranger'); if (!form) return;
    const box = document.getElementById('n-sensible'), pw = document.getElementById('pw-wrap'), msg = document.getElementById('pw-msg');
    const show = (t, bad = true) => { msg.textContent = t; msg.className = 'alert ' + (bad ? 'bad' : 'ok'); msg.hidden = false; };
    box.addEventListener('change', () => { pw.hidden = !box.checked; });
    form.addEventListener('submit', async (ev) => {
      if (!box.checked) return; // ordinary paper: the plain form does the job
      ev.preventDefault();
      const file = form.fichier.files[0]; const p1 = form.pw1.value, p2 = form.pw2 ? form.pw2.value : '';
      if (!file) return show('Choisis d’abord un fichier.');
      if (p1.length < 8) return show('Le mot de passe du coffre fait au moins 8 caractères.');
      const data = new Uint8Array(await file.arrayBuffer());
      const mime = detect(data);
      if (!mime) return show('Seuls les PDF et les photos (JPEG, PNG, HEIC) sont acceptés.');
      const verif = form.dataset.verif || ''; // existing verifier (base64) or empty on the first sensitive paper
      if (verif) { if (!(await checkVerifier(unb64(verif), p1))) return show('Ce n’est pas ton mot de passe du coffre. Rien n’a été rangé.'); }
      else if (p1 !== p2) return show('Les deux mots de passe ne sont pas identiques. Rien n’a été rangé.');
      show('Chiffrement sur ton téléphone…', false);
      const sealed = await encrypt(data, p1);
      const fd = new FormData();
      for (const [k, v] of new FormData(form)) if (!['fichier', 'pw1', 'pw2'].includes(k)) fd.append(k, v);
      fd.append('mime', mime);
      if (!verif) fd.append('verifier', b64(await makeVerifier(p1)));
      fd.append('fichier', new Blob([sealed]), 'papier.ckf');
      form.pw1.value = ''; if (form.pw2) form.pw2.value = '';
      let j;
      try { const r = await fetch('/coffre/ajouter', { method: 'POST', body: fd, credentials: 'same-origin', headers: { accept: 'application/json' } }); j = await r.json(); }
      catch { return show('Le serveur n’a pas répondu. Rien n’a été rangé : réessaie.'); }
      if (!j.ok) return show(j.text);
      show(j.text, false);
      setTimeout(() => location.assign('/coffre?r=' + encodeURIComponent(form.rattache.value)), 1200); // the list, with the new paper and its lock
    });
  }
  // --- Page of one sensitive paper: ask the password, fetch the sealed file, open it here ----------------------
  function wireView() {
    const f = document.getElementById('form-ouvrir'); if (!f) return;
    const out = document.getElementById('papier'), msg = document.getElementById('pw-msg');
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const password = f.pw.value; f.pw.value = '';
      msg.hidden = false; msg.className = 'alert ok'; msg.textContent = 'Déchiffrement sur ton téléphone…';
      try {
        const r = await fetch(f.dataset.src, { credentials: 'same-origin' });
        if (!r.ok) throw new Error('introuvable');
        const plain = await decrypt(await r.arrayBuffer(), password);
        const mime = MIMES[f.dataset.mime] ? f.dataset.mime : null; // never a type the browser could run
        if (!mime) throw new Error('type');
        const url = URL.createObjectURL(new Blob([plain], { type: mime }));
        out.innerHTML = mime === 'application/pdf' ? `<iframe title="papier" style="width:100%;height:70vh;border:0;border-radius:12px;background:#fff"></iframe>` : `<img alt="papier" style="max-width:100%;border-radius:12px;display:block">`;
        out.firstChild.src = url; out.hidden = false; msg.hidden = true; f.hidden = true;
      } catch { msg.className = 'alert bad'; msg.textContent = 'Mot de passe incorrect, ou papier illisible. Rien n’a été ouvert.'; }
    });
  }
  if (typeof document !== 'undefined') { wireUpload(); wireView(); }
  return { detect, encrypt, decrypt, isSealed, makeVerifier, checkVerifier, b64, unb64, MIMES, ITER };
})();
if (typeof globalThis !== 'undefined') globalThis.CoffreE2E = CoffreE2E;
