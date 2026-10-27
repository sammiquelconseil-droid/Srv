// Tiny PDF writer (text, lines, shaded boxes): no library to install, opens in every PDF reader.
// Standard Helvetica fonts with WinAnsi (Windows-1252) encoding: French accents, ’ « » and € included;
// characters outside it become « ? ».

export const A4 = [595, 842]; // points (1/72 inch)
// Helvetica widths (thousandths of the size), ASCII 32–126, from the standard font metrics.
const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const CP1252 = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, 'œ': 0x9c, 'Œ': 0x8c, 'Ÿ': 0x9f, ' ': 0xa0, ' ': 0x20, '−': 0x2d };

const base = (c) => c.normalize('NFD')[0];
function width1(c) {
  const b = base(c).charCodeAt(0);
  if (b >= 32 && b <= 126) return W[b - 32];
  return c === '€' ? 556 : c === '«' || c === '»' ? 556 : c === '—' ? 1000 : c === '…' ? 1000 : c === 'œ' ? 944 : 556;
}
export const textWidth = (text, size, bold = false) => ([...String(text)].reduce((n, c) => n + width1(c), 0) * size * (bold ? 1.06 : 1)) / 1000;

function encode(text) {
  const out = [];
  for (const c of String(text)) {
    const code = c.charCodeAt(0);
    let b = CP1252[c] ?? (code < 256 ? code : 0x3f);
    if (b < 32 && b !== 9) b = 0x20;
    if (b === 0x28 || b === 0x29 || b === 0x5c) out.push(0x5c);
    out.push(b);
  }
  return Buffer.from(out);
}

// Splits a text into lines no wider than `max` points (breaks on spaces; a too-long word is cut).
export function wrap(text, size, max, bold = false) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/ +/)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, bold) <= max) { line = next; continue; }
      if (line) lines.push(line);
      let w = word;
      while (textWidth(w, size, bold) > max) { let i = w.length; while (i > 1 && textWidth(w.slice(0, i), size, bold) > max) i--; lines.push(w.slice(0, i)); w = w.slice(i); }
      line = w;
    }
    lines.push(line);
  }
  return lines;
}

export class Page {
  constructor() { this.ops = []; }
  text(x, y, text, { size = 10, bold = false, align = 'left', gray = 0 } = {}) {
    if (align === 'right') x -= textWidth(text, size, bold);
    this.ops.push(Buffer.concat([Buffer.from(`${gray.toFixed(2)} g BT /${bold ? 'F2' : 'F1'} ${size.toFixed(1)} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (`), encode(text), Buffer.from(') Tj ET')]));
  }
  line(x1, y1, x2, y2, w = 0.5) { this.ops.push(Buffer.from(`${w.toFixed(2)} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`)); }
  box(x, y, w, h, gray = 0.93) { this.ops.push(Buffer.from(`${gray.toFixed(2)} g ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f 0 g`)); }
}

export function buildPdf(pages, { title = '', author = '' } = {}) {
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    null, // page list, filled below
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
    Buffer.concat([Buffer.from('<< /Title ('), encode(title), Buffer.from(') /Author ('), encode(author), Buffer.from(') /Producer ('), encode(author), Buffer.from(') >>')]),
  ];
  const kids = [];
  for (const p of pages) {
    const stream = Buffer.concat(p.ops.flatMap((o) => [o, Buffer.from('\n')]));
    objects.push(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from('\nendstream')]));
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4[0]} ${A4[1]}] /Contents ${objects.length} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`));
    kids.push(`${objects.length} 0 R`);
  }
  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`);
  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let size = parts[0].length; const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(size);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    parts.push(chunk); size += chunk.length;
  });
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${size}\n%%EOF\n`));
  return Buffer.concat(parts);
}
