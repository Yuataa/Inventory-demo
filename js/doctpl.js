'use strict';
/* Document templates (presets): an uploaded page image, data fields placed on it by dragging, and a real PDF made from them.
   No library is used: the browser draws each page on a canvas (so every accented letter prints), and a small writer below
   wraps the pages into a PDF file. The text in that PDF is part of the page image, so it cannot be selected or searched.
   A PDF file cannot be used as the background itself, because reading PDFs needs a PDF library that is not installed. */

const TPL_FIELDS = {
  recipient:'Recipient Name', email:'Recipient E-mail', service:'Service', office:'City / Office', mode:'Work Mode', date:'Date', docNo:'Document Number', title:'Document Title',
  handler:'Handed over by (IT)', company:'Company Name', address:'Company Address', note:'Notes', reason:'Swap Reason',
  assetName:'Asset Name', assetId:'Asset ID', serial:'Serial Number', model:'Model', type:'Asset Type', assetTable:'Asset table (one row per asset)',
  sigRecipient:'Recipient signature', sigHandler:'Handler signature', text:'Custom text',
};
const TPL_KINDS = {any:'Any document', out:'Handover', in:'Return', swap:'Swap'};
const PT_W = 595.28;                                   // A4 width in points; the page height follows the image's proportions
const tplOf = id => (db.docTemplates || []).find(t => t.id === id);
const tplsFor = kind => (db.docTemplates || []).filter(t => t.kind === 'any' || t.kind === kind);
const defaultTplFor = kind => { const id = (db.settings.docTplDefault || {})[kind]; return tplOf(id) && tplsFor(kind).some(t => t.id === id) ? id : ''; };
// a finished document keeps its own copy of the layout, so later template edits or a new background never change it
const tplSnapshotOf = t => t ? {tplId:t.id, name:t.name, version:t.version || 1, pages:t.pages.map(p => ({...p})), fields:t.fields.map(f => ({...f}))} : null;

// ---------- the values a field prints ----------
function docValues(d){
  const p = person(d.personId) || {name:d.personName, serviceId:null, email:'', mode:'', officeId:null}, t = d.tpl || tplSnapshot(d.kind, db.settings);
  const items = d.items || [], join = f => items.map(f).filter(Boolean).join(', ');
  const role = i => d.kind === 'swap' ? (i.role === 'in' ? ' (returned)' : ' (handed over)') : '';
  return {recipient:p.name || '', email:p.email || '', service:serviceName(p.serviceId), office:p.officeId ? officeLabel(p.officeId) : '', mode:p.mode ? modeName(p.mode) : '',
    date:fmtDate(d.date), docNo:d.no, title:t.title, handler:d.handler, company:t.company, address:t.address, note:d.note, reason:d.reason,
    assetName:join(i => { const a = asset(i.assetId); return (a ? assetName(a) : i.model) + role(i); }), assetId:join(i => i.tag + role(i)), serial:join(i => i.serial), model:join(i => i.model), type:join(i => typeLabel(i.type)),
    rows:items.map(i => { const a = asset(i.assetId); return [i.tag, (a ? assetName(a) : i.model) + role(i), i.model, i.serial || '']; }), recipientName:p.name || '', handlerName:d.handler || ''};
}

// ---------- drawing ----------
const FONT = 'Arial, Helvetica, sans-serif';
// wraps and shrinks text to fit the box; returns false when even the smallest size does not fit (the text is then cut with “…”)
function drawFit(ctx, text, x, y, w, h, pt, k, f){
  text = String(text ?? '');
  let size = pt, lines;
  const wrap = () => {
    ctx.font = `${f.bold ? 'bold ' : ''}${size * k}px ${FONT}`;
    const out = [];
    for (const para of text.split('\n')){
      let line = '';
      for (const word of para.split(/\s+/)){
        const t = line ? line + ' ' + word : word;
        if (ctx.measureText(t).width <= w || !line){
          if (ctx.measureText(t).width > w){ let cut = ''; for (const ch of t){ if (ctx.measureText(cut + ch).width > w){ out.push(cut); cut = ch; } else cut += ch; } line = cut; } else line = t;
        } else { out.push(line); line = word; }
      }
      out.push(line);
    }
    return out;
  };
  for (;;){ lines = wrap(); if (lines.length * size * k * 1.2 <= h || size <= 5) break; size = Math.max(5, size - .5); }
  const max = Math.max(1, Math.floor(h / (size * k * 1.2))), fits = lines.length <= max;
  if (!fits){ lines = lines.slice(0, max); let l = lines[max - 1]; while (l && ctx.measureText(l + '…').width > w) l = l.slice(0, -1); lines[max - 1] = l + '…'; }
  ctx.fillStyle = '#000'; ctx.textBaseline = 'top'; ctx.textAlign = f.align || 'left';
  const ax = f.align === 'center' ? x + w / 2 : f.align === 'right' ? x + w : x;
  lines.forEach((l, i) => ctx.fillText(l, ax, y + i * size * k * 1.2));
  return fits;
}
// the asset table: as many rows as fit at a readable size, the rest goes on continuation pages
function drawTable(ctx, rows, x, y, w, h, pt, k, swap){
  const head = ['Asset ID', 'Asset Name', 'Model', 'Serial Number'], cw = [.18, .34, .26, .22];
  let size = pt;
  const rowH = () => size * k * 1.6, fitN = () => Math.floor(h / rowH()) - 1;
  while (fitN() < rows.length && size > 6) size -= .5;
  const n = Math.max(0, Math.min(rows.length, fitN()));
  ctx.strokeStyle = '#555'; ctx.lineWidth = Math.max(1, k * .5);
  const line = (r, cells, bold) => {
    let cx = x; const ry = y + r * rowH();
    cells.forEach((c, i) => { drawFit(ctx, c, cx + 3 * k, ry + 2 * k, w * cw[i] - 6 * k, rowH() - 3 * k, size, k, {bold}); cx += w * cw[i]; });
    ctx.beginPath(); ctx.moveTo(x, ry + rowH()); ctx.lineTo(x + w, ry + rowH()); ctx.stroke();
  };
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke();
  line(0, head, true);
  rows.slice(0, n).forEach((r, i) => line(i + 1, r, false));
  return rows.slice(n);
}
const loadImg = blob => new Promise((res, rej) => { const u = URL.createObjectURL(blob), i = new Image(); i.onload = () => { URL.revokeObjectURL(u); res(i); }; i.onerror = () => { URL.revokeObjectURL(u); rej(new Error('The template image cannot be read.')); }; i.src = u; });
// renders the pages of a layout for one document: [{canvas, ptW, ptH}], plus warnings about text that did not fit
async function renderTplPages(snap, d){
  const v = docValues(d), out = [], warn = [];
  let rest = null;
  for (const [pi, pg] of snap.pages.entries()){
    const rec = await idb.get(pg.fileId);
    if (!rec) throw new Error('A template page image is missing from this browser (for example it was uploaded on another computer).');
    const img = await loadImg(rec.blob), W = Math.min(img.naturalWidth, 2480), H = Math.round(img.naturalHeight * W / img.naturalWidth);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'), k = W / PT_W;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.drawImage(img, 0, 0, W, H);
    for (const f of snap.fields.filter(x => (x.page || 0) === pi)){
      const x = f.x * W, y = f.y * H, w = f.w * W, h = f.h * H;
      if (f.key === 'assetTable'){ const left = drawTable(ctx, v.rows, x, y, w, h, f.size || 9, k, d.kind === 'swap'); if (left.length) rest = left; continue; }
      if (f.key === 'sigRecipient' || f.key === 'sigHandler'){
        ctx.strokeStyle = '#000'; ctx.lineWidth = Math.max(1, k * .6); ctx.beginPath(); ctx.moveTo(x, y + h * .62); ctx.lineTo(x + w, y + h * .62); ctx.stroke();
        drawFit(ctx, `${f.key === 'sigRecipient' ? 'Recipient' : 'Handed over by'}: ${f.key === 'sigRecipient' ? v.recipientName : v.handlerName}`, x, y + h * .66, w, h * .34, Math.min(f.size || 9, 9), k, {align:'center'});
        continue;
      }
      const text = f.key === 'text' ? f.text || '' : v[f.key];
      if (!drawFit(ctx, text, x, y, w, h, f.size || 10, k, f)) warn.push(`“${TPL_FIELDS[f.key]}” did not fit and was shortened.`);
    }
    out.push({canvas:c, ptW:PT_W, ptH:PT_W * H / W});
  }
  // rows that did not fit go on plain continuation pages
  while (rest && rest.length){
    const W = 1240, H = Math.round(W * 297 / 210), k = W / PT_W, c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    drawFit(ctx, `${d.no} – assets (continued)`, 40 * k, 40 * k, W - 80 * k, 20 * k, 12, k, {bold:true});
    const left = drawTable(ctx, rest, 40 * k, 70 * k, W - 80 * k, H - 110 * k, 9, k, d.kind === 'swap');
    if (left.length === rest.length) break;
    rest = left; out.push({canvas:c, ptW:PT_W, ptH:PT_W * 297 / 210});
  }
  return {pages:out, warn};
}

// ---------- a minimal PDF writer: one JPEG image per page ----------
async function pdfFromPages(pages){
  const enc = new TextEncoder(), parts = [], offs = [];
  let len = 0;
  const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n${body}\nendobj\n`); };
  const imgs = [];
  for (const p of pages){ const blob = await new Promise(r => p.canvas.toBlob(r, 'image/jpeg', .9)); imgs.push(new Uint8Array(await blob.arrayBuffer())); }
  push('%PDF-1.4\n');
  const n = pages.length, kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  pages.forEach((p, i) => {
    const pn = 3 + i * 3, w = p.ptW.toFixed(2), h = p.ptH.toFixed(2), content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    obj(pn, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${pn + 1} 0 R >> >> /Contents ${pn + 2} 0 R >>`);
    offs[pn + 1] = len;
    push(`${pn + 1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.canvas.width} /Height ${p.canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgs[i].length} >>\nstream\n`);
    push(imgs[i]); push('\nendstream\nendobj\n');
    obj(pn + 2, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  const total = 3 + n * 3, xref = len;
  push(`xref\n0 ${total}\n0000000000 65535 f \n` + offs.slice(1, total).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join(''));
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, {type:'application/pdf'});
}
async function tplPdf(snap, d){ const r = await renderTplPages(snap, d); return {blob:await pdfFromPages(r.pages), warn:r.warn}; }
function openPdf(blob, name){
  const url = URL.createObjectURL(blob), w = window.open(url, '_blank');
  if (!w){ const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}
async function openDocPdf(d, download){
  try {
    const {blob, warn} = await tplPdf(d.pdfTpl, d), name = `${d.no} ${d.personName || ''}.pdf`.trim();
    if (download) downloadBlob(blob, name); else openPdf(blob, name);
    if (warn.length) toast('⚠ ' + warn[0]);
  } catch(e){ alert('The PDF could not be made: ' + e.message); }
}
const downloadBlob = (blob, name) => download(name, blob);

// ---------- files of the templates in IndexedDB ----------
function tplFileIds(){
  return new Set([...(db.docTemplates || []).flatMap(t => t.pages.map(p => p.fileId)), ...db.docs.flatMap(d => d.pdfTpl ? d.pdfTpl.pages.map(p => p.fileId) : [])]);
}
async function gcTplFiles(dropped){ const keep = tplFileIds(); for (const id of dropped) if (!keep.has(id)) await idb.del(id).catch(() => {}); }
async function storeTplImage(file){
  if (!/^image\/(png|jpeg)$/.test(file.type)){
    throw new Error(file.type === 'application/pdf' ? 'A PDF file cannot be used here yet: reading PDFs needs a PDF library that is not installed. Save the page as a PNG or JPG image (for example from Word or your PDF viewer) and upload that.' : 'Upload a PNG or JPG image.');
  }
  const img = await loadImg(file), id = 'tpl_' + uid();
  await idb.put(id, {name:file.name, type:file.type, blob:file});
  return {fileId:id, w:img.naturalWidth, h:img.naturalHeight};
}

// ---------- Settings → Documents: the template list ----------
function tplListHtml(){
  const list = db.docTemplates || [], def = db.settings.docTplDefault || {};
  return `<h2>📐 Document templates (presets)</h2>
    <div class="card"><p class="muted" style="margin-top:0">Upload your own document page as an image, place the data fields on it, and save it as a preset. Documents made with it are produced as PDF files.
      Upload PNG or JPG; a PDF background is not supported yet (it needs a PDF library).</p>
      <div class="row" style="margin-bottom:10px"><button class="primary" onclick="newDocTemplate()">＋ New template</button></div>
      ${list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Use for</th><th>Pages</th><th>Fields</th><th>Default</th><th>Updated</th><th></th></tr></thead><tbody>${sortHu(list, t => t.name).map(t => `<tr>
        <td><a href="#/settings/docs?tpl=${t.id}"><b>${esc(t.name)}</b></a>${t.desc ? `<br><small class="muted">${esc(t.desc)}</small>` : ''}</td><td>${TPL_KINDS[t.kind]}</td><td>${t.pages.length}</td><td>${t.fields.length}</td>
        <td>${Object.entries(def).filter(([, v]) => v === t.id).map(([k]) => `<span class="pill ok">${DOC_KINDS[k].label}</span>`).join(' ') || '<span class="muted">–</span>'}</td><td class="muted">${t.updatedAt ? fmtTime(t.updatedAt) : '–'}</td>
        <td class="rowact"><a class="btn sm" href="#/settings/docs?tpl=${t.id}">✎ Edit fields</a> ${iconBtn('dup', 'Duplicate ' + t.name, `dupDocTemplate('${t.id}')`)}${iconBtn('del', 'Delete ' + t.name, `deleteDocTemplate('${t.id}')`, 'danger')}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">No templates yet. Documents use the built-in layout.</div>'}</div>`;
}
function newDocTemplate(){
  openDialog(`<h3>New document template</h3>
    <label class="f">Name *</label><input name="name" required placeholder="e.g. Company handover form">
    <label class="f">Description</label><input name="desc">
    <label class="f">Use for</label><select name="kind">${Object.entries(TPL_KINDS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
    <label class="f">Page image(s) * – PNG or JPG, one file per page</label><input type="file" id="tnFiles" accept="image/png,image/jpeg,application/pdf" multiple>
    <p class="muted" style="font-size:12px">Use a sharp image of the whole page, about 150–300 dpi.</p>
    ${dlgActions('Create and place fields')}`,
    (data) => {
      const files = [...$('#tnFiles').files], name = data.name.trim();
      if (!files.length){ alert('Choose at least one page image.'); return false; }
      if ((db.docTemplates || []).some(t => norm(t.name) === norm(name))){ alert('A template with this name already exists.'); return false; }
      $('#dlgOk').disabled = true;
      (async () => {
        try {
          const pages = []; for (const f of files) pages.push(await storeTplImage(f));
          const t = {id:uid(), name, desc:data.desc.trim(), kind:data.kind, pages, fields:[], version:1, updatedAt:Date.now()};
          (db.docTemplates ||= []).push(t); clog('Document template created: ' + name); save();
          $('#dlg').close(); location.hash = '#/settings/docs?tpl=' + t.id;
        } catch(e){ alert(e.message); $('#dlgOk').disabled = false; }
      })();
      return false;
    });
}
function dupDocTemplate(id){
  const t = tplOf(id); if (!t) return;
  let name = t.name + ' (copy)'; for (let i = 2; (db.docTemplates || []).some(x => norm(x.name) === norm(name)); i++) name = `${t.name} (copy ${i})`;
  db.docTemplates.push({...JSON.parse(JSON.stringify(t)), id:uid(), name, version:1, updatedAt:Date.now()});
  clog('Document template duplicated: ' + name); save(); render(); toast('Template duplicated.');
}
async function deleteDocTemplate(id){
  const t = tplOf(id); if (!t) return;
  const used = db.docs.filter(d => d.pdfTpl && d.pdfTpl.tplId === id).length;
  if (!await askConfirm('Delete template', `<p>Delete “${esc(t.name)}”?</p>${used ? `<p>${used} document(s) were made with it. They keep their own copy and still open the same way.</p>` : ''}`, 'Delete template')) return;
  db.docTemplates = db.docTemplates.filter(x => x !== t);
  for (const [k, v] of Object.entries(db.settings.docTplDefault || {})) if (v === id) delete db.settings.docTplDefault[k];
  clog('Document template deleted: ' + t.name); save(); await gcTplFiles(t.pages.map(p => p.fileId)); render();
}

// ---------- the designer: drag the fields on the page, then save the preset ----------
let tplDraft = null;
function tplDesigner(id){
  const t = tplOf(id);
  if (!t) return '<div class="empty">Template not found. <a href="#/settings/docs">Back to Documents</a></div>';
  if (!tplDraft || tplDraft.id !== id) tplDraft = {...JSON.parse(JSON.stringify(t)), page:0, sel:null, dirty:false, defs:Object.fromEntries(Object.keys(DOC_KINDS).map(k => [k, (db.settings.docTplDefault || {})[k] === id]))};
  const d = tplDraft, def = db.settings.docTplDefault || {}, f = d.fields.find(x => x.id === d.sel);
  const kinds = d.kind === 'any' ? Object.keys(DOC_KINDS) : [d.kind];
  return `<div class="row"><a href="#/settings/docs">← Documents</a><span class="spacer"></span><span class="pill ${d.dirty ? 'warn' : 'ok'}" id="tdState">${d.dirty ? 'Unsaved changes' : 'Saved'}</span></div>
    <h2 style="margin-top:8px">📐 ${esc(d.name)}</h2>
    <div class="tpl-designer">
      <div>
        <div class="row" style="margin-bottom:8px">${d.pages.length > 1 ? `<label class="muted">Page <select id="tdPageSel">${d.pages.map((_, i) => `<option value="${i}"${i === d.page ? ' selected' : ''}>${i + 1}</option>`).join('')}</select></label>` : ''}
          <span class="muted" style="font-size:12px">Drag a field to move it, drag its corner to resize. Arrow keys nudge the selected field.</span></div>
        <div id="tdPage" class="tdpage" style="aspect-ratio:${d.pages[d.page].w} / ${d.pages[d.page].h}"><img id="tdImg" alt="Template page ${d.page + 1}">
          ${d.fields.filter(x => (x.page || 0) === d.page).map(x => `<div class="tdf${x.id === d.sel ? ' sel' : ''}" data-f="${x.id}" tabindex="0" role="button" aria-label="${esc(TPL_FIELDS[x.key])}" style="left:${x.x * 100}%;top:${x.y * 100}%;width:${x.w * 100}%;height:${x.h * 100}%;text-align:${x.align || 'left'};font-weight:${x.bold ? 700 : 400}">
            <span>${esc(x.key === 'text' ? x.text || 'Custom text' : TPL_FIELDS[x.key])}</span><i class="rz" aria-hidden="true"></i></div>`).join('')}</div>
      </div>
      <div class="card td-side">
        <label class="f">Name</label><input id="tdName" value="${esc(d.name)}" style="width:100%">
        <label class="f">Description</label><input id="tdDesc" value="${esc(d.desc || '')}" style="width:100%">
        <label class="f">Use for</label><select id="tdKind" style="width:100%">${Object.entries(TPL_KINDS).map(([k, l]) => `<option value="${k}"${k === d.kind ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <label class="f">Default for new documents</label>${kinds.map(k => `<label class="cb" style="margin:4px 0"><input type="checkbox" data-def="${k}"${d.defs[k] ? ' checked' : ''}> ${DOC_KINDS[k].label}</label>`).join('')}
        <h4>Add a field</h4><div class="row"><select id="tdAddKey" class="combo" style="flex:1">${Object.entries(TPL_FIELDS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select><button type="button" id="tdAdd">＋ Add</button></div>
        ${f ? `<h4>Selected field</h4>
          <label class="f">Data</label><select id="tdKey" class="combo" style="width:100%">${Object.entries(TPL_FIELDS).map(([k, l]) => `<option value="${k}"${k === f.key ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
          ${f.key === 'text' ? `<label class="f">Text</label><textarea id="tdText" style="width:100%">${esc(f.text || '')}</textarea>` : ''}
          <div class="two"><div><label class="f">Font size (pt)</label><input type="number" id="tdSize" min="5" max="36" step="0.5" value="${f.size || 10}"></div>
            <div><label class="f">Align</label><select id="tdAlign"><option value="left"${(f.align || 'left') === 'left' ? ' selected' : ''}>Left</option><option value="center"${f.align === 'center' ? ' selected' : ''}>Center</option><option value="right"${f.align === 'right' ? ' selected' : ''}>Right</option></select></div></div>
          <label class="cb"><input type="checkbox" id="tdBold"${f.bold ? ' checked' : ''}> Bold</label>
          <p class="muted" style="font-size:12px;margin:0">Long values wrap and shrink to fit the box.</p>
          <p><button type="button" class="danger sm" id="tdDel">Remove field</button></p>` : '<p class="muted">Click a field on the page to change it.</p>'}
        <h4>Pages</h4><div class="row"><label class="btn sm">Replace this page image<input type="file" id="tdReplace" accept="image/png,image/jpeg,application/pdf" hidden></label>
          <label class="btn sm">＋ Add page<input type="file" id="tdAddPage" accept="image/png,image/jpeg,application/pdf" hidden></label>${d.pages.length > 1 ? '<button type="button" class="sm danger" id="tdDelPage">Remove page</button>' : ''}</div>
        <h4>Preview</h4><label class="f">Sample person</label><select id="tdPerson" class="combo" style="width:100%">${sortHu(db.people.filter(p => personAssets(p.id).direct.length), p => p.name).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}<option value="">Sample data</option></select>
        <div class="row" style="margin-top:12px"><button type="button" class="primary" id="tdSave">💾 Save preset</button><button type="button" id="tdSaveAs">Save as new preset</button><button type="button" id="tdPrev">👁 Preview PDF</button></div>
        <div id="tdWarn"></div>
      </div>
    </div>`;
}
function sampleDocFor(pid, kind){
  const p = person(pid), ids = p ? personAssets(p.id).direct.map(a => a.id) : db.assets.slice(0, 3).map(a => a.id);
  const d = makeDoc(p ? p.id : null, kind === 'any' ? 'out' : kind, ids, {note:'Sample note', reason:'Failure'});
  if (!p) d.personName = 'Sample Person';
  d.no = 'SAMPLE-0001';
  return d;
}
function bindTplDesigner(id){
  const d = tplDraft; if (!d || d.id !== id) return;
  const pageEl = $('#tdPage'), field = fid => d.fields.find(x => x.id === fid);
  const dirty = () => { d.dirty = true; const s = $('#tdState'); if (s){ s.textContent = 'Unsaved changes'; s.className = 'pill warn'; } };
  idb.get(d.pages[d.page].fileId).then(rec => { if (rec && $('#tdImg')) $('#tdImg').src = URL.createObjectURL(rec.blob); });
  const pick = fid => { d.sel = fid; render(); };
  pageEl.querySelectorAll('.tdf').forEach(el => {
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      const f = field(el.dataset.f), r = pageEl.getBoundingClientRect(), resize = e.target.classList.contains('rz');
      const sx = e.clientX, sy = e.clientY, o = {...f};
      try { el.setPointerCapture(e.pointerId); } catch(err) {}
      let moved = false;
      const mv = ev => {
        const dx = (ev.clientX - sx) / r.width, dy = (ev.clientY - sy) / r.height;
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 2) moved = true;
        if (resize){ f.w = Math.min(1 - f.x, Math.max(.02, o.w + dx)); f.h = Math.min(1 - f.y, Math.max(.012, o.h + dy)); el.style.width = f.w * 100 + '%'; el.style.height = f.h * 100 + '%'; }
        else { f.x = Math.min(1 - f.w, Math.max(0, o.x + dx)); f.y = Math.min(1 - f.h, Math.max(0, o.y + dy)); el.style.left = f.x * 100 + '%'; el.style.top = f.y * 100 + '%'; }
      };
      const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); if (moved) dirty(); if (d.sel !== f.id) pick(f.id); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
    });
    el.addEventListener('keydown', e => {
      const f = field(el.dataset.f), st = e.shiftKey ? .01 : .002, mv = {ArrowLeft:[-st, 0], ArrowRight:[st, 0], ArrowUp:[0, -st], ArrowDown:[0, st]}[e.key];
      if (mv){ e.preventDefault(); f.x = Math.min(1 - f.w, Math.max(0, f.x + mv[0])); f.y = Math.min(1 - f.h, Math.max(0, f.y + mv[1])); el.style.left = f.x * 100 + '%'; el.style.top = f.y * 100 + '%'; dirty(); }
      if (e.key === 'Enter') pick(f.id);
    });
  });
  const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
  on('#tdPageSel', 'change', e => { d.page = +e.target.value; d.sel = null; render(); });
  on('#tdName', 'input', e => { d.name = e.target.value; dirty(); });
  on('#tdDesc', 'input', e => { d.desc = e.target.value; dirty(); });
  on('#tdKind', 'change', e => { d.kind = e.target.value; dirty(); render(); });
  document.querySelectorAll('[data-def]').forEach(c => c.addEventListener('change', () => { d.defs = {...(d.defs || {}), [c.dataset.def]:c.checked}; dirty(); }));
  on('#tdAdd', 'click', () => {
    const key = $('#tdAddKey').value, big = key === 'assetTable', sig = key.startsWith('sig');
    const f = {id:uid(), key, page:d.page, x:.1, y:.1 + (d.fields.length % 8) * .05, w:big ? .8 : sig ? .3 : .35, h:big ? .25 : sig ? .06 : .03, size:big ? 9 : 10, align:'left', bold:false};
    d.fields.push(f); d.sel = f.id; d.dirty = true; render();
  });
  const sel = field(d.sel);
  if (sel){
    on('#tdKey', 'change', e => { sel.key = e.target.value; d.dirty = true; render(); });
    on('#tdText', 'input', e => { sel.text = e.target.value; dirty(); const s = pageEl.querySelector(`[data-f="${sel.id}"] span`); if (s) s.textContent = sel.text || 'Custom text'; });
    on('#tdSize', 'change', e => { sel.size = Math.max(5, Math.min(36, +e.target.value || 10)); dirty(); });
    on('#tdAlign', 'change', e => { sel.align = e.target.value; d.dirty = true; render(); });
    on('#tdBold', 'change', e => { sel.bold = e.target.checked; d.dirty = true; render(); });
    on('#tdDel', 'click', () => { d.fields = d.fields.filter(x => x !== sel); d.sel = null; d.dirty = true; render(); });
  }
  const addFile = async (file, replace) => {
    try {
      const pg = await storeTplImage(file);
      if (replace){ const old = d.pages[d.page]; d.pages[d.page] = pg; d.dropped = [...(d.dropped || []), old.fileId]; } else { d.pages.push(pg); d.page = d.pages.length - 1; }
      d.dirty = true; render();
    } catch(e){ alert(e.message); }
  };
  on('#tdReplace', 'change', e => { if (e.target.files[0]) addFile(e.target.files[0], true); });
  on('#tdAddPage', 'change', e => { if (e.target.files[0]) addFile(e.target.files[0], false); });
  on('#tdDelPage', 'click', () => {
    if (!confirm('Remove this page and its fields?')) return;
    const gone = d.page; d.dropped = [...(d.dropped || []), d.pages[gone].fileId];
    d.pages.splice(gone, 1); d.fields = d.fields.filter(f => (f.page || 0) !== gone).map(f => ({...f, page:(f.page || 0) > gone ? f.page - 1 : f.page || 0}));
    d.page = 0; d.sel = null; d.dirty = true; render();
  });
  const commit = asNew => {
    const name = d.name.trim();
    if (!name){ alert('The template needs a name.'); return; }
    if ((db.docTemplates || []).some(t => t.id !== (asNew ? null : d.id) && norm(t.name) === norm(name))){ alert('A template with this name already exists.'); return; }
    const t = {id:asNew ? uid() : d.id, name, desc:(d.desc || '').trim(), kind:d.kind, pages:d.pages.map(p => ({...p})), fields:d.fields.map(f => ({...f})), version:asNew ? 1 : (tplOf(d.id).version || 1) + 1, updatedAt:Date.now()};
    if (asNew) db.docTemplates.push(t); else db.docTemplates[db.docTemplates.findIndex(x => x.id === d.id)] = t;
    db.settings.docTplDefault ||= {};
    // a copy never takes over the default role of the original
    const allowed = asNew ? [] : t.kind === 'any' ? Object.keys(DOC_KINDS) : [t.kind];
    for (const [k, on] of Object.entries(d.defs || {})) if (!asNew){ if (on && allowed.includes(k)) db.settings.docTplDefault[k] = t.id; else if (db.settings.docTplDefault[k] === t.id) delete db.settings.docTplDefault[k]; }
    clog(`Document template ${asNew ? 'created' : 'saved'}: ${name} (${t.fields.length} fields)`);
    save(); const dropped = d.dropped || []; tplDraft = null; gcTplFiles(dropped);
    toast(asNew ? 'Saved as a new preset.' : 'Preset saved.');
    if (asNew) location.hash = '#/settings/docs?tpl=' + t.id; else render();
  };
  on('#tdSave', 'click', () => commit(false));
  on('#tdSaveAs', 'click', () => commit(true));
  on('#tdPrev', 'click', async () => {
    const snap = tplSnapshotOf({...d}), doc = sampleDocFor($('#tdPerson').value, d.kind);
    $('#tdPrev').disabled = true;
    try { const {blob, warn} = await tplPdf(snap, doc); $('#tdWarn').innerHTML = warn.length ? `<div class="warnbox">${warn.map(esc).join('<br>')}</div>` : '<div class="okbox">Every value fits its box.</div>'; openPdf(blob, 'template-preview.pdf'); }
    catch(e){ alert('The preview could not be made: ' + e.message); }
    $('#tdPrev').disabled = false;
  });
}
window.addEventListener('beforeunload', e => { if (tplDraft && tplDraft.dirty && location.hash.includes('tpl=')){ e.preventDefault(); e.returnValue = ''; } });
