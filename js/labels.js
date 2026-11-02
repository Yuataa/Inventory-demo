'use strict';
/* QR codes and Avery L4732REV labels. The encoder is built in so printing works offline.
   A preset decides what the QR code holds: the Serial Number, or a link to the asset page. */

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
  if (v > 10) throw new Error('The text is too long for a QR code.');
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
const LABEL_FIELDS = {qr:'QR code', tag:'Asset ID', serial:'Serial Number', name:'Asset Name', model:'Model', type:'Asset Type'};
const LABEL_CSS = `.lb{width:${LABEL.w}mm;height:${LABEL.h}mm;box-sizing:border-box;display:flex;align-items:center;gap:1mm;padding:1mm;overflow:hidden;background:#fff;color:#000;font-family:Arial,sans-serif}
  .lb .qr{flex:0 0 14.5mm;height:14.5mm} .lb .qr svg{display:block;width:100%;height:100%}
  .lb .tx{flex:1;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:center;gap:.2mm;line-height:1.12;overflow:hidden}
  .lb .tx b{font-family:Consolas,monospace;font-weight:700;overflow-wrap:anywhere}
  .lb .tx span{overflow-wrap:anywhere}
  .lb .lg{flex:0 0 auto;display:block;max-width:60%;height:2.8mm;object-fit:contain}`;
const assetLink = a => location.href.split('#')[0] + '#/asset/' + a.id;
const qrValue = (a, p) => p.qrMode === 'link' ? assetLink(a) : (a.serial || '').trim();
// the logo sits in its own thin line above the text, so it never takes width from the values.
// Sizes follow the real room: text shrinks to one line where it can, then wraps, and the whole block scales to the label height.
function labelInner(a, p){
  const f = p.fields, logo = p.logo && db.settings.branding.logoId && db.images[db.settings.branding.logoId], qr = f.qr && qrValue(a, p);
  const W = LABEL.w - 2 - (qr ? 15.5 : 0), H = LABEL.h - 2 - (logo ? 3 : 0), MM = .3528;
  const fit = (text, mono, base, min) => {
    const k = (mono ? .55 : .5) * MM, n = String(text).length, pt = Math.max(min, Math.min(base, W / (n * k)));
    return {text, mono, pt, rows:Math.max(1, Math.ceil(n * k * pt / W))};
  };
  const rows = [f.tag && fit(a.tag, true, 6.5, 4.5), f.serial && a.serial && fit(a.serial, true, 6.5, 4.5), f.name && assetName(a) && fit(assetName(a), false, 5.5, 4.5),
    f.model && modelName(a) && fit(modelName(a), false, 5.5, 4.5), f.type && fit(typeLabel(a.type), false, 5.5, 4.5)].filter(Boolean);
  const need = rows.reduce((s, r) => s + r.rows * r.pt * MM * 1.12 + .2, 0), s = Math.max(.72, Math.min(1, H / (need || 1)));
  const lines = rows.map(r => `<${r.mono ? 'b' : 'span'} style="font-size:${(r.pt * s).toFixed(2)}pt">${esc(r.text)}</${r.mono ? 'b' : 'span'}>`).join('');
  const img = logo ? `<img class="lg" src="${logo}" alt="" style="align-self:${p.logoPos === 'left' ? 'flex-start' : 'flex-end'}">` : '';
  return `${qr ? `<div class="qr">${qrSvg(qr)}</div>` : ''}<div class="tx">${img}${lines}</div>`;
}
function labelHtml(list, start, p){
  const per = LABEL.cols * LABEL.rows, slots = [...new Array(start - 1).fill(null), ...list], pages = [];
  for (let i = 0; i < slots.length; i += per) pages.push(slots.slice(i, i + per));
  const cell = (a, i) => {
    if (!a) return '';
    const x = p.left + (i % LABEL.cols) * p.pitchX, y = p.top + Math.floor(i / LABEL.cols) * p.pitchY;
    return `<div class="lb" style="position:absolute;left:${x.toFixed(2)}mm;top:${y.toFixed(2)}mm">${labelInner(a, p)}</div>`;
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Asset labels – Avery L4732REV</title><style>
    @page{size:A4;margin:0}
    body{margin:0;background:#e9ebee}
    .bar{position:sticky;top:0;background:#1d2330;color:#fff;padding:10px 16px;display:flex;gap:14px;align-items:center;font:14px system-ui;flex-wrap:wrap}
    .bar button{font:inherit;padding:7px 16px;border-radius:6px;border:0;background:#2f6fed;color:#fff;cursor:pointer;font-weight:600}
    .sheet{position:relative;width:210mm;height:297mm;background:#fff;margin:16px auto;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.15)}
    ${LABEL_CSS} .lb{outline:.1mm dashed #bbb}
    @media print{.bar{display:none} body{background:#fff} .sheet{margin:0;box-shadow:none;page-break-after:always} .sheet:last-child{page-break-after:auto} .lb{outline:0}}
  </style></head><body>
  <div class="bar"><button onclick="print()">🖨 Print</button><span>${list.length} label(s). Print at 100% / Actual size on A4, with no scaling.</span></div>
  ${pages.map(p2 => `<div class="sheet">${p2.map(cell).join('')}</div>`).join('')}</body></html>`;
}
const curPreset = () => byId(db.settings.labelPresets, db.settings.labelPresetId) || db.settings.labelPresets[0];
function labelDialog(ids){
  const list = ids.map(asset).filter(Boolean);
  if (!list.length) return;
  let p = JSON.parse(JSON.stringify(curPreset()));
  const hasLogo = !!db.settings.branding.logoId, sample = list.find(a => a.serial) || list[0], manage = can('labels.presets');
  const printable = () => p.fields.qr ? list.filter(a => qrValue(a, p)) : list;
  const paint = () => {
    const missing = p.fields.qr ? list.filter(a => !qrValue(a, p)) : [];
    $('#lblPrev').innerHTML = `<style>${LABEL_CSS}</style><div class="lbzoom"><div class="lb">${labelInner(sample, p)}</div></div>`;
    $('#lblMissing').hidden = !missing.length;
    $('#lblMissing').innerHTML = `⚠️ No Serial Number, so no QR code and no label: ${missing.map(a => `<a href="#/asset/${a.id}">${esc(a.tag)}</a>`).join(', ')}`;
    $('#lQrNote').textContent = p.qrMode === 'link' ? (location.protocol === 'file:' ? 'This page is opened as a local file, so the link only works on this computer. Print link labels from the published site.' : 'Opens the asset page. A phone only finds the asset if its browser holds the same data.') : 'A scanner reads the Serial Number as text.';
    $('#lblCount').textContent = `${printable().length} label(s) · ${LABEL.w} × ${LABEL.h} mm · ${LABEL.cols * LABEL.rows} labels per A4 sheet`;
  };
  const fill = () => {
    for (const k of Object.keys(LABEL_FIELDS)) $('#lf_' + k).checked = !!p.fields[k];
    $('#lLogo').checked = !!p.logo; $('#lPos').value = p.logoPos; $('#lQr').value = p.qrMode || 'serial';
    for (const k of ['top', 'left', 'pitchX', 'pitchY']) $('#lg_' + k).value = p[k];
    paint();
  };
  const num = (k, l) => `<div><label class="f">${l}</label><input type="number" step="0.1" id="lg_${k}"></div>`;
  const presets = () => db.settings.labelPresets.map(x => `<option value="${x.id}"${x.id === p.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
  openDialog(`<h3>🏷 Print labels – Avery L4732REV</h3>
    <div class="row"><label class="muted">Preset</label><select id="lPreset" style="flex:1">${presets()}</select>
      ${manage ? '<button type="button" class="sm" id="lSave">Save</button><button type="button" class="sm" id="lSaveAs">Save as new</button><button type="button" class="sm danger" id="lDel">Delete</button>' : ''}</div>
    <p id="lblCount"></p><div class="warnbox" id="lblMissing" hidden></div>
    <label class="f">Fields on the label</label><div class="grid" style="grid-template-columns:repeat(3,1fr);gap:0 8px">${Object.entries(LABEL_FIELDS).map(([k, l]) => `<label class="cb" style="margin:4px 0"><input type="checkbox" id="lf_${k}"> ${l}</label>`).join('')}</div>
    <label class="f">QR code content</label><select id="lQr" style="width:100%"><option value="serial">Serial Number</option><option value="link">Link to the asset page</option></select><small class="muted" id="lQrNote"></small>
    <div class="two"><div><label class="cb"><input type="checkbox" id="lLogo"${hasLogo ? '' : ' disabled'}> Company logo</label>${hasLogo ? '' : '<small class="muted">Set a logo in Admin Panel → Branding.</small>'}</div>
      <div><label class="f">Logo position</label><select id="lPos"><option value="right">Right</option><option value="left">Left</option></select></div></div>
    <label class="f">Preview</label><div id="lblPrev"></div>
    <label class="f">Start at label position (to reuse a partly used sheet)</label><input type="number" name="start" min="1" max="${LABEL.cols * LABEL.rows}" value="1">
    <details><summary class="muted">Sheet calibration (mm)</summary><div class="two">${num('top', 'Top margin')}${num('left', 'Left margin')}${num('pitchX', 'Horizontal pitch')}${num('pitchY', 'Vertical pitch')}</div>
      <p class="muted" style="font-size:12px">Print one test sheet on plain paper and hold it against a label sheet. Adjust these values if it does not line up.</p></details>
    ${dlgActions('Open print preview')}`,
    data => {
      if (!printable().length){ alert('Nothing to print with these fields.'); return false; }
      openPrintWindow(labelHtml(printable(), Math.max(1, +data.start || 1), p));
    });
  for (const k of Object.keys(LABEL_FIELDS)) $('#lf_' + k).addEventListener('change', e => { p.fields[k] = e.target.checked; paint(); });
  $('#lLogo').addEventListener('change', e => { p.logo = e.target.checked; paint(); });
  $('#lPos').addEventListener('change', e => { p.logoPos = e.target.value; paint(); });
  $('#lQr').addEventListener('change', e => { p.qrMode = e.target.value; paint(); });
  for (const k of ['top', 'left', 'pitchX', 'pitchY']) $('#lg_' + k).addEventListener('change', e => { p[k] = +e.target.value; });
  $('#lPreset').addEventListener('change', e => { db.settings.labelPresetId = e.target.value; p = JSON.parse(JSON.stringify(curPreset())); save(); fill(); });
  if (manage){
    const list2 = () => { $('#lPreset').innerHTML = presets(); };
    $('#lSave').addEventListener('click', () => { Object.assign(curPreset(), JSON.parse(JSON.stringify(p))); clog(`Label preset saved: ${p.name}`); save(); toast('Preset saved.'); });
    $('#lSaveAs').addEventListener('click', () => {
      const name = (prompt('Preset name') || '').trim(); if (!name) return;
      if (db.settings.labelPresets.some(x => norm(x.name) === norm(name))){ alert('A preset with this name already exists.'); return; }
      p = {...JSON.parse(JSON.stringify(p)), id:uid(), name}; db.settings.labelPresets.push(JSON.parse(JSON.stringify(p))); db.settings.labelPresetId = p.id;
      clog(`Label preset created: ${name}`); save(); list2();
    });
    $('#lDel').addEventListener('click', () => {
      if (db.settings.labelPresets.length < 2){ alert('The last preset cannot be deleted.'); return; }
      if (!confirm(`Delete preset “${p.name}”?`)) return;
      clog(`Label preset deleted: ${p.name}`);
      db.settings.labelPresets = db.settings.labelPresets.filter(x => x.id !== p.id); db.settings.labelPresetId = db.settings.labelPresets[0].id;
      p = JSON.parse(JSON.stringify(curPreset())); save(); list2(); fill();
    });
  }
  fill();
}

// ---------- Scan QR Code ----------
// what a scan or a typed value points to: an asset link, an Asset ID, a legacy ID or a Serial Number, always an exact match
function resolveScan(text){
  const t = String(text || '').trim();
  if (!t) return {err:'Enter or scan a value.'};
  const m = /#\/asset\/([\w-]+)\s*$/.exec(t);
  if (m){ const a = asset(m[1]); return a ? {a} : {err:'This QR code points to an asset that is not in this browser.'}; }
  if (/^[a-z]+:\/\//i.test(t)) return {err:'This QR code does not belong to an asset.'};
  const n = norm(t), hits = db.assets.filter(a => [a.tag, a.serial, a.legacyTag].some(v => v && norm(v) === n));
  if (hits.length === 1) return {a:hits[0]};
  if (hits.length > 1) return {err:'Several assets share this value:', hits};
  return {err:`No asset found for “${t}”.`};
}
function scanDialog(){
  const dlg = $('#dlg'), api = 'BarcodeDetector' in window, cam = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;
  let stream = null, stop = false, lastBad = '';
  openDialog(`<h3>📷 Scan QR Code</h3>
    <div id="scanCam"${api && cam ? '' : ' hidden'}><video id="scanVid" playsinline muted class="scanvid"></video></div>
    <div id="scanInfo" class="warnbox"${api && cam ? ' hidden' : ''}>${!cam ? 'The camera needs a secure HTTPS page and browser support.' : 'This browser cannot read QR codes on a page.'} Type the value below. On a phone, the camera app can open link QR codes directly.</div>
    <div id="scanMsg"></div>
    <label class="f">Asset ID, Serial Number or scanned text</label>
    <div class="row"><input id="scanText" style="flex:1;min-width:200px" autocomplete="off"><button type="button" id="scanFind">Find</button></div>
    <div class="actions"><button value="cancel" formnovalidate>Close</button></div>`, () => false);
  const end = () => { stop = true; if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; };
  dlg.addEventListener('close', end, {once:true});
  const go = text => {
    const r = resolveScan(text);
    if (r.a){ dlg.close(); location.hash = '#/asset/' + r.a.id; return true; }
    $('#scanMsg').innerHTML = `<div class="errbox">${esc(r.err)}${r.hits ? ' ' + r.hits.map(a => `<a href="#/asset/${a.id}">${esc(a.tag)}</a>`).join(', ') : ''}</div>`;
    return false;
  };
  $('#scanFind').addEventListener('click', () => go($('#scanText').value));
  $('#scanText').addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); go(e.target.value); } });
  if (!api || !cam) return;
  (async () => {
    try {
      const det = new BarcodeDetector({formats:['qr_code']}), vid = $('#scanVid');
      stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
      if (stop){ end(); return; }
      vid.srcObject = stream; await vid.play();
      while (!stop){
        const [hit] = await det.detect(vid).catch(() => []);
        if (hit && hit.rawValue !== lastBad && !stop){ if (go(hit.rawValue)) return; lastBad = hit.rawValue; }
        await new Promise(r => setTimeout(r, 300));
      }
    } catch(e){
      $('#scanCam').hidden = true; $('#scanInfo').hidden = false;
      $('#scanInfo').textContent = e.name === 'NotAllowedError' ? 'Camera access was refused. Type the value below instead.' : 'The camera could not be started. Type the value below instead.';
    }
  })();
}
