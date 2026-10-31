'use strict';
/* QR codes and Avery L4732REV labels. The encoder is built in so printing works offline.
   The QR code holds the Serial Number and nothing else; an asset without one gets no label. */

// byte mode, error correction level M, versions 1–10
const QR_TOTAL = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
const QR_EC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const QR_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const QR_ALIGN = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const GF = (() => {
  const exp = new Array(512), log = new Array(256);
  for (let i = 0, x = 1; i < 255; i++){ exp[i] = x; log[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
  return {exp, log, mul:(a, b) => a && b ? exp[log[a] + log[b]] : 0};
})();
function rsBlock(data, ecLen){
  let gen = [1];
  for (let i = 0; i < ecLen; i++){
    const next = new Array(gen.length + 1).fill(0);
    gen.forEach((g, j) => { next[j] ^= g; next[j + 1] ^= GF.mul(g, GF.exp[i]); });
    gen = next;
  }
  const out = [...data, ...new Array(ecLen).fill(0)];
  for (let i = 0; i < data.length; i++){
    const c = out[i];
    if (c) for (let j = 0; j < gen.length; j++) out[i + j] ^= GF.mul(gen[j], c);
  }
  return out.slice(data.length);
}
function qrEncode(text){
  const bytes = [...new TextEncoder().encode(text)];
  let v = 1;
  const cap = n => QR_TOTAL[n] - QR_EC[n] * QR_BLOCKS[n] - (n < 10 ? 2 : 3);
  while (v <= 10 && bytes.length > cap(v)) v++;
  if (v > 10) throw new Error('Serial Number is too long for a QR code.');
  const dataLen = QR_TOTAL[v] - QR_EC[v] * QR_BLOCKS[v];
  // bit stream: mode, length, bytes, terminator, padding
  const bits = [];
  const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
  put(0, Math.min(4, dataLen * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const cw = [];
  for (let i = 0; i < bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let p = 0; cw.length < dataLen; p++) cw.push(p % 2 ? 0x11 : 0xec);
  // blocks, then interleave
  const nb = QR_BLOCKS[v], shortLen = Math.floor(dataLen / nb), longCnt = dataLen % nb, blocks = [], ecs = [];
  for (let i = 0, o = 0; i < nb; i++){
    const len = shortLen + (i >= nb - longCnt ? 1 : 0), b = cw.slice(o, o + len);
    o += len; blocks.push(b); ecs.push(rsBlock(b, QR_EC[v]));
  }
  const all = [];
  for (let i = 0; i <= shortLen; i++) for (const b of blocks) if (i < b.length) all.push(b[i]);
  for (let i = 0; i < QR_EC[v]; i++) for (const e of ecs) all.push(e[i]);
  // function patterns
  const size = 17 + v * 4, M = Array.from({length:size}, () => new Array(size).fill(0)), F = M.map(r => r.map(() => false));
  const set = (r, c, val) => { M[r][c] = val ? 1 : 0; F[r][c] = true; };
  const finder = (r0, c0) => { for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++){
    const y = r0 + r, x = c0 + c;
    if (y < 0 || x < 0 || y >= size || x >= size) continue;
    set(y, x, r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)));
  } };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++){ set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const al = QR_ALIGN[v];
  for (const r of al) for (const c of al){
    const last = al[al.length - 1];
    if ((r === 6 && c === 6) || (r === 6 && c === last) || (r === last && c === 6)) continue;   // these would overlap the finders
    for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) set(r + y, c + x, Math.max(Math.abs(x), Math.abs(y)) !== 1);
  }
  set(size - 8, 8, 1);                                      // dark module
  for (let i = 0; i < 9; i++){ if (!F[8][i]) F[8][i] = true; if (!F[i][8]) F[i][8] = true; }
  for (let i = 0; i < 8; i++){ F[8][size - 1 - i] = true; F[size - 1 - i][8] = true; }
  if (v >= 7) for (let i = 0; i < 18; i++){ F[size - 11 + i % 3][Math.floor(i / 3)] = true; F[Math.floor(i / 3)][size - 11 + i % 3] = true; }
  // data, zigzag from the bottom right
  const dataBits = all.flatMap(b => [7, 6, 5, 4, 3, 2, 1, 0].map(i => (b >> i) & 1));
  const cells = [];
  for (let c = size - 1, up = true; c > 0; c -= 2, up = !up){
    if (c === 6) c--;
    for (let k = 0; k < size; k++){ const r = up ? size - 1 - k : k; for (const x of [c, c - 1]) if (!F[r][x]) cells.push([r, x]); }
  }
  const MASKS = [(r, c) => (r + c) % 2 === 0, r => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
    (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0, (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0];
  const build = m => {
    const G = M.map(r => r.slice());
    cells.forEach(([r, c], i) => { G[r][c] = (dataBits[i] || 0) ^ (MASKS[m](r, c) ? 1 : 0); });
    // format info: level M = 00
    let d = m << 10, rem = d;
    for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
    const fmt = (d | rem) ^ 0x5412;
    const bit = i => (fmt >> i) & 1;
    for (let i = 0; i <= 5; i++) G[i][8] = bit(i);
    G[7][8] = bit(6); G[8][8] = bit(7); G[8][7] = bit(8);
    for (let i = 9; i < 15; i++) G[8][14 - i] = bit(i);
    for (let i = 0; i < 8; i++) G[8][size - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) G[size - 15 + i][8] = bit(i);
    G[size - 8][8] = 1;
    if (v >= 7){
      let rem2 = v << 12;
      for (let i = 17; i >= 12; i--) if ((rem2 >> i) & 1) rem2 ^= 0x1f25 << (i - 12);
      const info = (v << 12) | rem2;
      for (let i = 0; i < 18; i++){ const b = (info >> i) & 1; G[size - 11 + i % 3][Math.floor(i / 3)] = b; G[Math.floor(i / 3)][size - 11 + i % 3] = b; }
    }
    return G;
  };
  const penalty = G => {
    let p = 0, dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++){
      dark += G[r][c];
      if (r < size - 1 && c < size - 1 && G[r][c] === G[r + 1][c] && G[r][c] === G[r][c + 1] && G[r][c] === G[r + 1][c + 1]) p += 3;
    }
    for (const line of [...G, ...G[0].map((_, c) => G.map(r => r[c]))]) for (let i = 0, run = 1; i < size; i++){
      if (i && line[i] === line[i - 1]){ run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
    }
    return p + Math.floor(Math.abs(dark * 100 / (size * size) - 50) / 5) * 10;
  };
  let best = null, bp = Infinity;
  for (let m = 0; m < 8; m++){ const G = build(m), s = penalty(G); if (s < bp){ bp = s; best = G; } }
  return best;
}
function qrSvg(text){
  const G = qrEncode(text), n = G.length, q = 2;
  let d = '';
  G.forEach((row, r) => row.forEach((v, c) => { if (v) d += `M${c + q} ${r + q}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + q * 2} ${n + q * 2}" shape-rendering="crispEdges"><path d="${d}" fill="#000"/></svg>`;
}

// ---------- Avery L4732REV: 35.6 × 16.9 mm, 80 labels on A4 (5 across, 16 down) ----------
const LABEL = {w:35.6, h:16.9, cols:5, rows:16};
function labelHtml(list, start, g){
  const per = LABEL.cols * LABEL.rows, slots = [...new Array(start - 1).fill(null), ...list], pages = [];
  for (let i = 0; i < slots.length; i += per) pages.push(slots.slice(i, i + per));
  const cell = (a, i) => {
    if (!a) return '';
    const x = g.left + (i % LABEL.cols) * g.pitchX, y = g.top + Math.floor(i / LABEL.cols) * g.pitchY;
    return `<div class="lb" style="left:${x.toFixed(2)}mm;top:${y.toFixed(2)}mm"><div class="qr">${qrSvg(a.serial)}</div>
      <div class="tx"><b>${esc(a.serial)}</b><span>${esc(assetName(a))}</span><span>${esc(modelName(a))}</span></div></div>`;
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Asset labels – Avery L4732REV</title><style>
    @page{size:A4;margin:0}
    body{margin:0;background:#e9ebee;font-family:Arial,sans-serif;color:#000}
    .bar{position:sticky;top:0;background:#1d2330;color:#fff;padding:10px 16px;display:flex;gap:14px;align-items:center;font:14px system-ui;flex-wrap:wrap}
    .bar button{font:inherit;padding:7px 16px;border-radius:6px;border:0;background:#2f6fed;color:#fff;cursor:pointer;font-weight:600}
    .sheet{position:relative;width:210mm;height:297mm;background:#fff;margin:16px auto;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.15)}
    .lb{position:absolute;width:${LABEL.w}mm;height:${LABEL.h}mm;box-sizing:border-box;display:flex;align-items:center;gap:1mm;padding:1mm;overflow:hidden;outline:.1mm dashed #bbb}
    .qr{flex:0 0 14.5mm;height:14.5mm} .qr svg{display:block;width:100%;height:100%}
    .tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:.3mm;line-height:1.1}
    .tx b{font:700 6.5pt Consolas,monospace;overflow-wrap:anywhere}
    .tx span{font-size:5.5pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    @media print{.bar{display:none} body{background:#fff} .sheet{margin:0;box-shadow:none;page-break-after:always} .sheet:last-child{page-break-after:auto} .lb{outline:0}}
  </style></head><body>
  <div class="bar"><button onclick="print()">🖨 Print</button><span>${list.length} label(s). Print at 100% / Actual size on A4, with no scaling.</span></div>
  ${pages.map(p => `<div class="sheet">${p.map(cell).join('')}</div>`).join('')}</body></html>`;
}
function labelDialog(ids){
  const list = ids.map(asset).filter(Boolean), ok = list.filter(a => (a.serial || '').trim()), missing = list.filter(a => !(a.serial || '').trim());
  if (!list.length) return;
  const g = db.settings.label, num = (k, l) => `<div><label class="f">${l}</label><input type="number" step="0.1" name="${k}" value="${g[k]}"></div>`;
  openDialog(`<h3>🏷 Print labels – Avery L4732REV</h3>
    <p>${ok.length} label(s) · ${LABEL.w} × ${LABEL.h} mm · ${LABEL.cols * LABEL.rows} labels per A4 sheet</p>
    ${missing.length ? `<div class="warnbox" id="lblMissing">⚠️ No Serial Number, so no QR code and no label: ${missing.map(a => `<a href="#/asset/${a.id}">${esc(a.tag)}</a>`).join(', ')}</div>` : ''}
    <label class="f">Start at label position (to reuse a partly used sheet)</label><input type="number" name="start" min="1" max="${LABEL.cols * LABEL.rows}" value="1">
    <details><summary class="muted">Sheet calibration (mm)</summary><div class="two">${num('top', 'Top margin')}${num('left', 'Left margin')}${num('pitchX', 'Horizontal pitch')}${num('pitchY', 'Vertical pitch')}</div>
      <p class="muted" style="font-size:12px">Print one test sheet on plain paper and hold it against a label sheet. Adjust these values if it does not line up.</p></details>
    ${dlgActions(ok.length ? 'Open print preview' : 'Close')}`,
    data => {
      if (!ok.length) return;
      db.settings.label = {top:+data.top, left:+data.left, pitchX:+data.pitchX, pitchY:+data.pitchY};
      save();
      openPrintWindow(labelHtml(ok, Math.max(1, +data.start || 1), db.settings.label));
    });
}
