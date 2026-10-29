'use strict';
/* Jegyzőkönyvek: átadás-átvételi, visszavételi, eszközcsere – kitöltés, nyomtatás / PDF, aláírt példány feltöltése */

// assets the person holds that are not on any handover protocol made since they got them
function uncovered(pid){
  return personAssets(pid).direct.filter(a => !db.docs.some(d => d.personId === pid && (d.kind === 'out' || d.kind === 'swap')
    && d.createdAt >= (a.assignedAt || 0) - 60000 && d.items.some(i => i.assetId === a.id && i.role !== 'in')));
}
function docBadges(pid){
  const unc = uncovered(pid).length, wait = db.docs.filter(d => d.personId === pid && !d.fileId).length;
  return [unc && `<span class="pill bad" title="Eszköz jegyzőkönyv nélkül">${unc} jkv. nélkül</span>`,
    wait && `<span class="pill warn">${wait} aláírásra vár</span>`].filter(Boolean).join(' ') || '<span class="muted">–</span>';
}
function nextDocNo(kind){
  const pre = `${DOC_KINDS[kind].prefix}-${new Date().getFullYear()}-`;
  let m = 0;
  for (const d of db.docs) if (d.no.startsWith(pre)) m = Math.max(m, parseInt(d.no.slice(pre.length), 10) || 0);
  return pre + String(m + 1).padStart(4, '0');
}
const replacedAfter = (assetId, ts) => db.swaps.find(s => s.oldId === assetId && s.ts >= ts);
const snapAsset = a => ({assetId:a.id, tag:a.tag, type:a.type, model:modelName(a), serial:a.serial, assignedAt:a.assignedAt || null});
// the one place protocols are created (person page, bulk checkout, swap, project completion)
function createDoc(pid, kind, ids, o = {}){
  const p = person(pid);
  const doc = {id:uid(), no:nextDocNo(kind), kind, personId:pid, personName:p ? p.name : '', date:o.date || todayIso(), handler:o.handler || db.settings.handler,
    note:o.note || '', reason:o.reason || '', createdAt:Date.now(), fileId:null, projectId:o.projectId || null, swapId:o.swapId || null,
    items:o.items || ids.map(asset).filter(Boolean).map(snapAsset)};
  db.docs.unshift(doc);
  if (o.handler) db.settings.handler = o.handler;
  const label = `${DOC_KINDS[kind].label} jegyzőkönyv létrehozva: ${doc.no} (${doc.personName})`;
  if (doc.projectId) log(null, label, 'project', {projectId:doc.projectId});
  else for (const i of doc.items) if (asset(i.assetId)) log(i.assetId, label, 'updated');
  return doc;
}
function docChips(d){
  const chip = i => { const a = asset(i.assetId); return a ? `<a class="chip" href="#/asset/${a.id}">${typeIcon(i.type)} ${esc(a.tag)}</a>` : `<span class="chip">${esc(i.tag)}</span>`; };
  if (d.kind === 'swap'){
    const o = d.items.find(i => i.role === 'in'), n = d.items.find(i => i.role === 'out');
    return `<s>${o ? chip(o) : ''}</s> ➜ ${n ? chip(n) : ''}`;
  }
  // items swapped out after this protocol show what replaced them
  return d.items.map(i => {
    const s = d.kind === 'out' && replacedAfter(i.assetId, d.createdAt);
    return s ? `<span title="${esc(`Lecserélve ${fmtDate(s.date)}: ${s.reason}`)}"><s>${chip(i)}</s> 🔁 <a class="chip" href="#/asset/${s.newId}">${esc((asset(s.newId) || {}).tag || s.newTag)}</a></span>` : chip(i);
  }).join(' ');
}
function docTable(docs, showPerson){
  if (!docs.length) return '<div class="empty">Még nincs dokumentum.</div>';
  return `<div class="tbl-wrap"><table><thead><tr><th>Iktatószám</th><th>Típus</th>${showPerson ? '<th>Személy</th>' : ''}<th>Kelt</th><th>Eszközök</th><th>Állapot</th><th></th></tr></thead><tbody>${docs.map(d => {
    const p = person(d.personId), pr = d.projectId && project(d.projectId);
    return `<tr><td class="tag">${esc(d.no)}${pr ? `<br><a class="pill acc" href="#/project/${pr.id}">📋 ${esc(pr.name)}</a>` : ''}</td><td>${DOC_KINDS[d.kind].label}</td>
      ${showPerson ? `<td>${p ? `<a href="#/person/${p.id}">${esc(p.name)}</a>` : esc(d.personName || '?')}</td>` : ''}
      <td style="white-space:nowrap">${fmtDate(d.date)}</td>
      <td>${docChips(d)}</td>
      <td>${d.fileId ? `<span class="pill ok">✔ Aláírva</span><br><small class="muted">feltöltve: ${fmtTime(d.signedAt)}</small>` : '<span class="pill warn">Aláírásra vár</span>'}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="sm" onclick="printDoc('${d.id}')" title="Kitöltött jegyzőkönyv megnyitása – nyomtatás / mentés PDF-ként">🖨 Kitöltött PDF</button>
        ${d.fileId ? `<button class="sm" onclick="openDocFile('${d.id}')" title="Aláírt példány megnyitása">👁 Aláírt</button><button class="sm" onclick="openDocFile('${d.id}', true)" title="Aláírt példány letöltése">⬇</button>` : ''}
        <button class="sm${d.fileId ? '' : ' primary'}" onclick="uploadSigned('${d.id}')">⬆ ${d.fileId ? 'Csere' : 'Aláírt feltöltése'}</button>
        <button class="sm danger" onclick="deleteDoc('${d.id}')" title="Törlés">🗑</button></td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function docDialog(pid, kind, preIds){
  const p = person(pid), pa = personAssets(pid);
  const pre = new Set(preIds || (kind === 'out' ? pa.direct.map(a => a.id) : []));
  const cand = [...new Map([...(preIds || []).map(asset).filter(Boolean), ...pa.direct, ...pa.onDesk].map(a => [a.id, a])).values()];
  if (!cand.length){ alert('Ehhez a személyhez jelenleg nem tartozik eszköz.'); return; }
  const where = a => a.holder.kind === 'desk' ? 'irodai asztalán' : a.holder.kind === 'storage' ? 'raktárban' : a.holder.kind === 'person' && a.holder.id !== pid ? 'másnál' : '';
  openDialog(`
    <h3>📄 Jegyzőkönyv – ${esc(p.name)}</h3>
    <label class="f">Típus</label>
    <select name="kind">${Object.entries(DOC_KINDS).filter(([k]) => k !== 'swap').map(([k, v]) => `<option value="${k}"${k === kind ? ' selected' : ''}>${v.title}</option>`).join('')}</select>
    <label class="f">Eszközök a jegyzőkönyvön</label>
    <div class="checklist">${cand.map(a => `<label><input type="checkbox" name="a_${a.id}"${pre.has(a.id) ? ' checked' : ''}> ${assetIcon(a)}
      <span><b class="tag">${esc(a.tag)}</b> · ${esc(typeLabel(a.type))} · ${esc(modelName(a))} <span class="muted">${where(a) ? '(' + where(a) + ')' : ''}</span></span></label>`).join('')}</div>
    <div class="two">
      <div><label class="f">Kelt (dátum)</label><input type="date" name="date" required value="${todayIso()}"></div>
      <div><label class="f">Átadó / visszavevő (IT) neve</label><input name="handler" value="${esc(db.settings.handler)}"></div>
    </div>
    <label class="f">Megjegyzés a jegyzőkönyvre (opcionális)</label><textarea name="note" style="width:100%" placeholder="pl. a laptop táskával és töltővel együtt"></textarea>
    ${dlgActions('Létrehozás és megnyitás')}`,
    data => {
      const ids = cand.filter(a => data['a_' + a.id]).map(a => a.id);
      if (!ids.length){ alert('Jelölj ki legalább egy eszközt.'); return false; }
      const doc = createDoc(pid, data.kind, ids, {date:data.date, handler:data.handler.trim(), note:data.note.trim()});
      save(); render(); printDoc(doc.id);
    });
}
function docHtml(d){
  const s = db.settings, K = DOC_KINDS[d.kind], isOut = d.kind !== 'in';
  const p = person(d.personId) || {name:d.personName, serviceId:null, email:'', mode:''};
  const day = ts => new Date(ts).toLocaleDateString('hu-HU');
  const tbl = (items, lastHead, last) => `<table class="items"><thead><tr><th>#</th><th>Asset ID</th><th>Típus</th><th>Gyártó / modell</th><th>Sorozatszám</th><th>${lastHead}</th></tr></thead><tbody>${
    items.map((i, n) => `<tr><td>${n + 1}.</td><td class="m"><b>${esc(i.tag)}</b></td><td>${esc(typeLabel(i.type))}</td><td>${esc(i.model)}</td><td class="m">${esc(i.serial)}</td>${last(i)}</tr>`).join('')}</tbody></table>`;
  const issued = i => `<td>${i.assignedAt ? day(i.assignedAt) : fmtDate(d.date)}</td>`;
  const body = d.kind === 'swap' ? `
    <h2>Csere oka</h2><div><b>${esc(d.reason || '')}</b>${d.note ? ' – ' + esc(d.note) : ''}</div>
    <h2>Visszavett (lecserélt) eszköz</h2>
    ${tbl(d.items.filter(i => i.role === 'in'), 'Állapot visszavételkor', () => `<td>${esc(d.reason || '')}</td>`)}
    <h2>Átadott csereeszköz</h2>
    ${tbl(d.items.filter(i => i.role === 'out'), 'Kiadás dátuma', issued)}
    <p class="stmt">${esc(s.swapText)}</p>` : `
    <h2>${isOut ? 'Átadott' : 'Visszavett'} eszközök (${d.items.length} db)</h2>
    ${tbl(d.items, isOut ? 'Kiadás dátuma' : 'Állapot / megjegyzés', i => isOut ? issued(i) : '<td class="blank"></td>')}
    ${d.note ? `<h2>Megjegyzés</h2><div style="white-space:pre-wrap">${esc(d.note)}</div>` : ''}
    <p class="stmt">${esc(isOut ? s.outText : s.inText)}</p>`;
  return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><title>${esc(d.no + ' ' + p.name)}</title><style>
    @page{size:A4;margin:15mm}
    body{font:10.5pt/1.45 "Segoe UI",Arial,sans-serif;color:#111;margin:0;background:#e9ebee}
    .page{background:#fff;max-width:210mm;margin:16px auto;padding:15mm;box-shadow:0 2px 12px rgba(0,0,0,.15);box-sizing:border-box}
    .bar{position:sticky;top:0;background:#1d2330;color:#fff;padding:10px 16px;display:flex;gap:14px;align-items:center;font:14px system-ui;flex-wrap:wrap}
    .bar button{font:inherit;padding:7px 16px;border-radius:6px;border:0;background:#2f6fed;color:#fff;cursor:pointer;font-weight:600}
    @media print{.bar{display:none} body{background:#fff} .page{margin:0;padding:0;box-shadow:none;max-width:none}}
    .hd{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:14px}
    h1{font-size:16pt;text-align:center;margin:10px 0 16px;letter-spacing:.03em}
    h2{font-size:11pt;margin:16px 0 6px}
    table{border-collapse:collapse;width:100%}
    .kv td{padding:2px 8px 2px 0;vertical-align:top} .kv td:first-child{color:#555;width:35%}
    .items th,.items td{border:1px solid #888;padding:5px 6px;text-align:left;font-size:9.5pt}
    .items th{background:#eee}
    .m{font-family:Consolas,monospace}
    td.blank{min-width:40mm}
    .stmt{text-align:justify;margin-top:14px}
    .place{margin-top:12mm}
    .sig{display:grid;grid-template-columns:1fr 1fr;gap:20mm;margin-top:24mm}
    .sig div{border-top:1px solid #111;padding-top:4px;text-align:center;font-size:9.5pt}
    .ft{margin-top:14mm;font-size:8pt;color:#777;text-align:center}
  </style></head><body>
  <div class="bar"><button onclick="print()">🖨 Nyomtatás / Mentés PDF-ként</button>
    <span>A nyomtatási ablakban a cél legyen „Mentés PDF-ként”. A PDF-et Adobe-ban írasd alá, majd az IT Raktárban töltsd fel az „⬆ Aláírt feltöltése” gombbal.</span></div>
  <div class="page">
    <div class="hd"><div><b>${esc(s.company)}</b><br>${esc(s.address)}</div><div style="text-align:right">Iktatószám: <b class="m">${esc(d.no)}</b><br>Kelt: ${fmtDate(d.date)}</div></div>
    <h1>${esc(K.title.toUpperCase())}</h1>
    <h2>${isOut ? 'Átvevő' : 'Visszaadó'} (munkavállaló)</h2>
    <table class="kv"><tr><td>Név:</td><td><b>${esc(p.name)}</b></td></tr><tr><td>Service:</td><td>${esc(serviceName(p.serviceId))}</td></tr>
      <tr><td>E-mail:</td><td>${esc(p.email || '')}</td></tr><tr><td>Munkavégzési mód:</td><td>${esc(p.mode || '')}</td></tr></table>
    <h2>${isOut ? 'Átadó' : 'Visszavevő'} (munkáltató)</h2>
    <table class="kv"><tr><td>Név:</td><td>${esc(d.handler)}</td></tr><tr><td>Munkáltató:</td><td>${esc(s.company)}</td></tr></table>
    ${body}
    <div class="place">Kelt: ………………………………, ${fmtDate(d.date)}</div>
    <div class="sig"><div>${isOut ? 'Átadó' : 'Visszavevő'} aláírása<br><small>${esc(d.handler)}</small></div><div>${isOut ? 'Átvevő' : 'Visszaadó'} aláírása<br><small>${esc(p.name)}</small></div></div>
    <div class="ft">Készült az IT Raktár nyilvántartásból · ${esc(d.no)}</div>
  </div></body></html>`;
}
function printDoc(id){
  const html = docHtml(byId(db.docs, id));
  if (tour.on){ showTourDoc(html); return; }
  const w = window.open('', '_blank');
  if (w){ w.document.open(); w.document.write(html); w.document.close(); return; }
  // popup blocked: print straight from a hidden frame
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0';
  document.body.appendChild(f);
  f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
  setTimeout(() => { f.contentWindow.print(); setTimeout(() => f.remove(), 60000); }, 300);
}
function uploadSigned(docId){
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/pdf,image/*';
  inp.onchange = async () => {
    const f = inp.files[0], d = byId(db.docs, docId);
    if (!f || !d) return;
    try {
      const id = uid();
      await idb.put(id, {name:f.name, type:f.type, blob:f});
      if (d.fileId) await idb.del(d.fileId);
      Object.assign(d, {fileId:id, fileName:f.name, fileSize:f.size, signedAt:Date.now()});
      const label = `${DOC_KINDS[d.kind].label} jegyzőkönyv aláírva feltöltve (${d.no})`;
      if (d.projectId) log(null, label, 'project', {projectId:d.projectId});
      for (const i of d.items) if (asset(i.assetId)) log(i.assetId, label, 'updated');
      save(); render();
    } catch(e){ alert('Nem sikerült menteni a fájlt: ' + e.message); }
  };
  inp.click();
}
async function openDocFile(docId, dl){
  const d = byId(db.docs, docId);
  const w = dl ? null : window.open('', '_blank');
  const rec = d && d.fileId && await idb.get(d.fileId);
  if (!rec){ if (w) w.close(); alert('Az aláírt fájl nem található ebben a böngészőben (pl. más gépen töltötték fel, vagy a mentés nem tartalmazta).'); return; }
  const url = URL.createObjectURL(rec.blob);
  if (w) w.location.href = url;
  else { const a = document.createElement('a'); a.href = url; a.download = rec.name; document.body.appendChild(a); a.click(); a.remove(); }
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}
async function deleteDoc(id){
  const d = byId(db.docs, id);
  if (!confirm(`Törlöd a(z) ${d.no} jegyzőkönyvet${d.fileId ? ' és az aláírt példányát' : ''}?`)) return;
  if (d.fileId) await idb.del(d.fileId).catch(() => {});
  db.docs = db.docs.filter(x => x.id !== id); save(); render();
}
function viewDocs(params){
  const f = params.get('f') || '';
  let docs = db.docs;
  if (f === 'wait') docs = docs.filter(d => !d.fileId);
  if (f === 'signed') docs = docs.filter(d => d.fileId);
  const missing = db.people.filter(p => uncovered(p.id).length);
  const opt = (v, l) => `<option value="${v}"${f === v ? ' selected' : ''}>${l}</option>`;
  return `
    <h1>Dokumentumok</h1>
    <div class="sub">Átadás-átvételi, visszavételi és csere jegyzőkönyvek. Új jegyzőkönyv a személy adatlapján, kiadáskor vagy projekt lezárásakor készül.</div>
    ${missing.length ? `<div class="warnbox" style="font-size:14px">⚠️ Eszköz jegyzőkönyv nélkül ezeknél: ${missing.map(p => `<a href="#/person/${p.id}">${esc(p.name)}</a> (${uncovered(p.id).length})`).join(', ')}</div>` : ''}
    <div class="row" style="margin:12px 0"><span class="spacer"></span><select id="df">${opt('', 'Mind')}${opt('wait', 'Aláírásra vár')}${opt('signed', '✔ Aláírva')}</select></div>
    ${docTable(docs, true)}
    <h2>🔁 Eszközcserék (${db.swaps.length})</h2>
    <div class="sub" style="margin-bottom:8px">Hibás / lecserélt eszközök nyomon követése. Cserét a személy vagy az eszköz adatlapján a „🔁 Csere” gombbal indíthatsz.</div>
    ${swapTable(db.swaps)}`;
}
