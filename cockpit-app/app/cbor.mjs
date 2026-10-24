// Minimal CBOR decoder: enough for WebAuthn attestation objects and COSE keys.
export function decode(buf) {
  let pos = 0;
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  function head() {
    const b = u8[pos++]; const major = b >> 5; let info = b & 31;
    if (info < 24) return [major, info];
    if (info === 24) return [major, u8[pos++]];
    if (info === 25) { const v = dv.getUint16(pos); pos += 2; return [major, v]; }
    if (info === 26) { const v = dv.getUint32(pos); pos += 4; return [major, v]; }
    if (info === 27) { const v = Number(dv.getBigUint64(pos)); pos += 8; return [major, v]; }
    throw new Error('cbor: indefinite length not supported');
  }
  function item() {
    const [major, n] = head();
    switch (major) {
      case 0: return n;
      case 1: return -1 - n;
      case 2: { const v = u8.slice(pos, pos + n); pos += n; return v; }
      case 3: { const v = new TextDecoder().decode(u8.slice(pos, pos + n)); pos += n; return v; }
      case 4: { const a = []; for (let i = 0; i < n; i++) a.push(item()); return a; }
      case 5: { const m = new Map(); for (let i = 0; i < n; i++) { const k = item(); m.set(k, item()); } return m; }
      case 7: if (n === 20) return false; if (n === 21) return true; if (n === 22) return null; throw new Error('cbor: unsupported simple value');
      default: throw new Error('cbor: unsupported type');
    }
  }
  const v = item();
  if (pos !== u8.byteLength) throw new Error('cbor: trailing bytes');
  return v;
}
