'use strict';
/* Dashboard, asset list and views, asset page and form, assignment and return flows, swap, asset import */

// ---------- filtering (shared by the list and the dashboard, so the counts always match) ----------
const LOC_LABEL = {desk:'🪑 On a desk / in a rack', office:'🏢 In a room pool', site:'🏢 At an office, not placed', transit:'🚚 In transit', person:'👤 Assigned to a person', storage:'📦 In Stock'};
// every filter is a facet of the shared engine (ui.js): the list and each filter's options come from the same rules
const warrState = a => { const w = warranty(a); return w.days === null ? 'none' : w.days < 0 ? 'bad' : w.days <= 60 ? 'soon' : 'ok'; };
const deskOf = a => a.holder.kind === 'desk' ? a.holder.id : a.placement ? a.placement.deskId : '';
const ASSET_FACETS = {
  view:{label:'View', all:'All assets', order:Object.keys(ASSET_VIEWS), vals:a => Object.keys(ASSET_VIEWS).filter(k => ASSET_VIEWS[k].test(a)), name:v => (ASSET_VIEWS[v] || {}).title},
  type:{label:'Asset Type', all:'All types', vals:a => [a.type], name:v => `${typeIcon(v)} ${typeLabel(v)}`},
  model:{label:'Model', all:'All models', vals:a => [a.modelId], name:v => (model(v) || {}).name},
  office:{label:'Office', all:'All Offices', vals:a => [assetOfficeId(a)], name:officeLabel},
  room:{label:'Room', all:'All Rooms', vals:a => [assetRoomId(a)], name:v => room(v) ? roomPath(room(v)) : v},
  desk:{label:'Desk / Location', all:'All desks', vals:a => [deskOf(a)], name:v => { const k = desk(v); return k ? `${(room(k.roomId) || {}).name || '?'} › ${k.label}` : v; }},
  person:{label:'Employee', all:'All employees', vals:a => [a.holder.kind === 'person' ? a.holder.id : ''], name:v => (person(v) || {}).name},
  service:{label:'Service', all:'All Services', vals:a => [a.serviceId, (assetPerson(a) || {}).serviceId], name:serviceName},
  mode:{label:'Work Mode', all:'All Work Modes', vals:a => [(assetPerson(a) || {}).mode], name:v => `${modeIcon(v)} ${modeName(v)}`},
  loc:{label:'Assignment', all:'Any assignment', order:Object.keys(LOC_LABEL), vals:a => [a.holder.kind], name:v => LOC_LABEL[v]},
  status:{label:'Status', all:'All statuses', order:['active', ...Object.keys(STATUS)], vals:a => [a.status, isActiveAsset(a) ? 'active' : ''], name:v => v === 'active' ? 'Active only' : (STATUS[v] || {}).label},
  cond:{label:'Condition', all:'Any condition', order:['good', 'faulty', 'aged'], vals:a => [isFaulty(a) ? 'faulty' : '', isAged(a) ? 'aged' : '', !isFaulty(a) && !isAged(a) ? 'good' : ''], name:v => ({good:'Working, not aged', faulty:'Faulty / In Repair', aged:'Aged'})[v]},
  warr:{label:'Warranty', all:'Warranty: all', order:['soon', 'bad', 'none', 'ok'], vals:a => [warrState(a)], name:v => ({...WARR_TEXT, ok:'Valid'})[v]},
  project:{label:'Project', all:'All projects', vals:a => [(reservedBy(a.id) || {project:{}}).project.id, ...db.projects.filter(pr => pr.shipments.some(s => s.status !== 'Received' && s.assetIds.includes(a.id))).map(pr => pr.id)], name:v => (project(v) || {}).name},
};
const WARR_TEXT = {soon:'Expires within 60 days', bad:'Expired', none:'Not set'}, HEALTH_TEXT = {faulty:'Faulty', aged:'Aged', both:'Faulty and Aged'};
// what is always applied: the location selection, the search text and the Faulty / Aged sub-filters
function assetBase(P){
  const f = k => P.get(k) || '';
  let list = scopedAssets(f('view') === 'transit');
  if (f('view') === 'health'){
    if (f('health') === 'faulty') list = list.filter(isFaulty);
    if (f('health') === 'aged') list = list.filter(isAged);
    if (f('health') === 'both') list = list.filter(a => isFaulty(a) && isAged(a));
    if (f('age')) list = list.filter(a => (ageYears(a) ?? -1) >= +f('age'));
  }
  if (f('q')) list = list.filter(a => matchWords([a.tag, a.legacyTag, a.name, modelName(a), typeLabel(a.type), a.serial, a.note, a.supplier, a.orderNo, whereText(a), officeLabel(a.officeId), serviceName(a.serviceId), Object.values(a.custom || {}).join(' ')].join(' '), f('q')));
  return list;
}
const ASSET_FILTER_SET = {base:assetBase, defs:ASSET_FACETS};
const filterAssets = P => facetRun(assetBase(P), ASSET_FACETS, P).list;
function typeBreak(list, query){
  const chips = sortHu(db.types.map(t => [t, list.filter(a => a.type === t.id).length]).filter(x => x[1]), x => x[0].name);
  const base = query ? query + '&' : '';
  return `<div class="tbreak">${chips.map(([t, n]) => `<a class="tchip" href="#/assets?${base}type=${encodeURIComponent(t.id)}" title="Show ${esc(t.name)}">${t.icon} <b>${n}</b> <span>${esc(t.name)}</span></a>`).join('') || '<span class="muted">No assets</span>'}</div>`;
}

// ---------- asset list ----------
const ASSET_FILTERS = Object.fromEntries(Object.entries(ASSET_FACETS).map(([k, f]) => [k, f.label]));
const DEFAULT_FILTERS = ['type', 'office', 'person', 'status'];
const shownFilters = () => myPrefs().filters || DEFAULT_FILTERS;
const shownCols = () => (myPrefs().cols || DEFAULT_COLS).filter(c => ASSET_COLS[c]);
const ASSETS_SORT = 'assets#0';
function filterValue(k, v){
  if (ASSET_FACETS[k]) return facetLabel(ASSET_FACETS[k], v);
  return {health:() => HEALTH_TEXT[v], age:() => v + '+ years'}[k]?.() || v;
}
// every active filter is listed, also the hidden ones and the ones that no longer match, so nothing narrows the list unseen
function activeFilterChips(params, route = '#/assets', facets = ASSET_FACETS, shown = shownFilters(), counts = {}){
  const out = [];
  for (const [k, v] of params){
    if (k === 'q') continue;
    const hidden = facets[k] && !shown.includes(k), stale = counts[k] && !counts[k].get(v), rest = new URLSearchParams(params); rest.delete(k);
    if (k === 'view'){ rest.delete('health'); rest.delete('age'); }
    out.push(`<a class="fchip${hidden ? ' hid' : ''}${stale ? ' stale' : ''}" href="${route}${rest.toString() ? '?' + rest : ''}" title="${hidden ? 'This filter is hidden in Customize View but still applied. ' : ''}${stale ? 'Nothing matches this together with the other filters. ' : ''}Click to remove">${esc((facets[k] || {}).label || {health:'Category', age:'Age', from:'Date from', to:'Date to'}[k] || k)}: <b>${esc(facets === ASSET_FACETS ? filterValue(k, v) : facets[k] ? facetLabel(facets[k], v) : v)}</b>${hidden ? ' <small>(hidden filter)</small>' : ''}${stale ? ' <small>(no match)</small>' : ''} ✕</a>`);
  }
  return out.length ? `<div class="row fchiprow"><span class="muted">Active filters:</span>${out.join('')}<a href="${route}">Clear all filters</a></div>` : '';
}
function builtinViews(){
  const p = currentPerson();
  return [...(p && p.officeId ? [{id:'b_office', name:'My Office', query:'office=' + p.officeId}] : []), {id:'b_warr', name:'Warranty Expired', query:'warr=bad'}, {id:'b_ret', name:'Awaiting Returns', query:'view=awaiting'}, {id:'b_faulty', name:'Faulty Assets', query:'view=health&health=faulty'}];
}
function applySavedView(id){
  const v = builtinViews().find(x => x.id === id) || (myPrefs().views || []).find(x => x.id === id);
  if (!v) return;
  if (v.cols){ myPrefs().cols = v.cols.filter(c => ASSET_COLS[c]); save(); }
  const cols = shownCols();
  sortState[ASSETS_SORT] = (v.sort || []).map(s => ({i:cols.indexOf(s.c) + 2, dir:s.dir})).filter(s => s.i >= 2);
  const hash = '#/assets' + (v.query ? '?' + v.query : '');
  if (location.hash === hash) render(); else location.hash = hash;
}
function currentViewData(){
  const cols = shownCols();
  return {query:location.hash.split('?')[1] || '', cols, sort:(sortState[ASSETS_SORT] || []).map(s => ({c:cols[s.i - 2], dir:s.dir})).filter(s => s.c)};
}
function customizeView(){
  const filters = shownFilters(), cols = shownCols(), order = [...cols, ...Object.keys(ASSET_COLS).filter(c => !cols.includes(c))];
  const views = () => (myPrefs().views || []).map(v => `<div class="locrow"><span>${esc(v.name)}</span><button type="button" class="sm danger" data-delview="${v.id}">Delete</button></div>`).join('') || '<p class="muted">No saved views yet.</p>';
  openDialog(`<h3>Customize View</h3>
    <h4>Search Filters</h4><div class="cfg-grid">${Object.entries(ASSET_FILTERS).map(([k, l]) => `<label class="cb"><input type="checkbox" data-filter="${k}"${filters.includes(k) ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div>
    <h4>Table Columns</h4><p class="muted" style="margin:0 0 6px">Only the display changes, never the asset data. Use the arrows to change the order. Widths are set by dragging the column edge in the table.</p>
    <div class="checklist" id="cvCols">${order.map(c => `<div class="cvcol" data-col="${c}"><label class="cb"><input type="checkbox"${cols.includes(c) ? ' checked' : ''}> ${esc(ASSET_COLS[c].label)}</label><span class="spacer"></span><button type="button" class="sm" data-up aria-label="Move ${esc(ASSET_COLS[c].label)} up">↑</button><button type="button" class="sm" data-down aria-label="Move ${esc(ASSET_COLS[c].label)} down">↓</button></div>`).join('')}</div>
    <h4>Saved Views</h4><p class="muted" style="margin:0 0 6px">A saved view keeps the current filters, the columns chosen here, their order and the sorting.</p>
    <div id="cvViews">${views()}</div>
    <div class="row" style="margin-top:6px"><input id="cvName" placeholder="View name, e.g. My Office" style="flex:1;min-width:180px" aria-label="View name"><button type="button" id="cvSave">Save as view</button></div>
    <div class="actions"><button type="button" id="cvReset" style="margin-right:auto">Reset to defaults</button><button value="cancel" formnovalidate>Cancel</button><button class="primary" value="ok" id="dlgOk">Apply</button></div>`,
    () => {
      const cs = readCols();
      if (!cs.length){ alert('Keep at least one column.'); return false; }
      if (cs.join() !== cols.join()) delete sortState[ASSETS_SORT];
      Object.assign(myPrefs(), {filters:[...document.querySelectorAll('[data-filter]:checked')].map(b => b.dataset.filter), cols:cs});
      save(); render();
    }, {wide:true});
  const readCols = () => [...document.querySelectorAll('#cvCols .cvcol')].filter(d => d.querySelector('input').checked).map(d => d.dataset.col);
  $('#cvCols').addEventListener('click', e => {
    const d = e.target.closest('.cvcol'); if (!d) return;
    if ('up' in e.target.dataset && d.previousElementSibling) d.parentNode.insertBefore(d, d.previousElementSibling);
    if ('down' in e.target.dataset && d.nextElementSibling) d.parentNode.insertBefore(d.nextElementSibling, d);
  });
  $('#cvReset').addEventListener('click', () => { const p = myPrefs(); delete p.filters; delete p.cols; delete p.assetColW; delete sortState[ASSETS_SORT]; save(); $('#dlg').close(); render(); toast('Filters and columns reset to the defaults.'); });
  $('#cvSave').addEventListener('click', () => {
    const name = $('#cvName').value.trim(), cs = readCols(), p = myPrefs();
    if (!name){ alert('Enter a name for the view.'); return; }
    if (!cs.length){ alert('Keep at least one column.'); return; }
    if ((p.views || []).some(v => norm(v.name) === norm(name)) || builtinViews().some(v => norm(v.name) === norm(name))){ alert('A view with this name already exists.'); return; }
    (p.views ||= []).push({id:uid(), name, ...currentViewData(), cols:cs});
    save(); $('#cvName').value = ''; $('#cvViews').innerHTML = views(); toast('View saved.');
  });
  $('#cvViews').addEventListener('click', e => {
    const id = e.target.dataset.delview; if (!id) return;
    const p = myPrefs(); p.views = p.views.filter(v => v.id !== id); save(); $('#cvViews').innerHTML = views();
  });
}
// paging state: back to page 1 whenever the filters change
const assetPg = {key:'', page:1};
function sortAssets(list){
  const cols = shownCols(), s = (sortState[ASSETS_SORT] || []).map(x => ({f:ASSET_SORT[cols[x.i - 2]], dir:x.dir})).filter(x => x.f);
  const out = sortHu(list, a => a.tag);
  if (!s.length) return out;
  return out.map((a, n) => [a, n]).sort(([a, x], [b, y]) => { for (const c of s){ const r = String(c.f(a) ?? '').localeCompare(String(c.f(b) ?? ''), 'en', {numeric:true, sensitivity:'base'}); if (r) return r * c.dir; } return x - y; }).map(x => x[0]);
}
function viewAssets(params){
  const f = k => params.get(k) || '';
  const run = facetRun(assetBase(params), ASSET_FACETS, params), list = sortAssets(run.list), V = ASSET_VIEWS[f('view')], type = f('type'), mdl = f('model');
  const filtered = [...params.keys()].length > 0, all = scopedAssets();
  const title = V ? V.title : mdl && model(mdl) ? model(mdl).name : type ? typeLabel(type) : 'Assets';
  const opt = (v, cur, l) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${l}</option>`;
  const q = new URLSearchParams(params); q.delete('type'); q.delete('model');
  const saved = [...builtinViews(), ...(myPrefs().views || [])];
  const key = params.toString();
  if (assetPg.key !== key){ assetPg.key = key; assetPg.page = 1; }
  const size = myPrefs().pageSize || 20, pages = Math.max(1, Math.ceil(list.length / size));
  assetPg.page = Math.min(Math.max(1, assetPg.page), pages);
  const page = list.slice((assetPg.page - 1) * size, assetPg.page * size);
  return `
    <div class="row"><h1>${!V && type ? typeIcon(type) + ' ' : ''}${esc(title)}</h1><span class="spacer"></span>
      <button onclick="scanDialog()">📷 Scan QR Code</button>
      <button onclick="customizeView()">⚙ Customize View</button>
      <button onclick="exportCSV()">⬇ CSV</button>
      <a class="btn" href="#/import">⬆ Import (Excel / Snipe-IT)</a>
      <button class="primary" onclick="assetForm(null, null, '${esc(type)}')">+ New asset</button></div>
    <div class="sub" id="assetCounts">${list.length} shown · <b>${all.filter(isActiveAsset).length}</b> active · <a href="#/assets?status=lost">${all.filter(a => a.status === 'lost').length} Lost</a> · <a href="#/assets?status=missing">${all.filter(a => a.status === 'missing').length} Missing</a> · <a href="#/assets?view=health&health=faulty">${all.filter(isFaulty).length} Faulty</a>${filtered ? ' · <a href="#/assets">clear filters</a>' : ''}</div>
    ${V ? typeBreak(filterAssets(q), q.toString()) : ''}
    <div class="row filters" style="margin-bottom:12px">
      <input id="fq" type="search" placeholder="Search: Asset ID, name, S/N, model, person…" value="${esc(f('q'))}" aria-label="Search assets" style="min-width:260px;flex:1">
      ${Object.keys(ASSET_FACETS).filter(k => shownFilters().includes(k)).map(k => facetSelect(k, ASSET_FACETS[k], run.counts, f(k))).join('')}
      <select id="fsaved" title="Saved views" aria-label="Saved views"><option value="">Saved views…</option>${saved.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select>
      ${f('view') === 'health' ? `<select id="fhealth" title="Category"><option value="">Faulty or Aged</option>${opt('faulty', f('health'), 'Faulty')}${opt('aged', f('health'), 'Aged')}${opt('both', f('health'), 'Faulty and Aged')}</select>
      <select id="fage" title="Minimum age"><option value="">Any age</option>${[3, 4, 5, 6, 7, 8, 10].map(y => opt(String(y), f('age'), `${y}+ years`)).join('')}</select>` : ''}
    </div>
    ${activeFilterChips(params, '#/assets', ASSET_FACETS, shownFilters(), run.counts)}
    <div class="bulkbar" id="bulkbar" hidden>
      <b>✔ <span class="bulkCount">0</span> selected</b>
      <button class="primary" data-bulk="assign" onclick="assignWizard()">Assign Selected Assets</button>
      <button data-bulk="return" onclick="bulkMove('storage')">📦 Return to Stock</button>
      <button onclick="labelDialog([...selected])">🏷 Print labels</button>
      <select id="bulkStatus" aria-label="New status"><option value="">Status…</option>${Object.entries(STATUS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('')}</select>
      <button onclick="bulkStatus()">Set</button>
      <span class="spacer"></span><button class="sm" onclick="selected.clear(); render()">✕ Clear selection</button>
    </div>
    ${list.length ? assetRows(page, {select:true, cols:shownCols(), rowActions:true, dataSort:true, widthsKey:'assetColW', widths:myPrefs().assetColW}) + pager(list.length, assetPg.page, size, 'assets') : '<div class="empty">No assets match these filters.</div>'}`;
}
function bindAssetFilters(){
  // a hidden filter has no control on the page, so its value is kept from the address
  const upd = changed => {
    const view = $('[data-facet=view]') ? $('[data-facet=view]').value : new URLSearchParams(location.hash.split('?')[1] || '').get('view');
    facetUpdate('#/assets', ASSET_FILTER_SET, changed, {q:$('#fq').value, health:view === 'health' && $('#fhealth') ? $('#fhealth').value : '', age:view === 'health' && $('#fage') ? $('#fage').value : ''});
    const pos = $('#fq').selectionStart, typing = document.activeElement === $('#fq');
    render(); if (typing){ $('#fq').focus(); $('#fq').setSelectionRange(pos, pos); }
  };
  $('#fq').addEventListener('input', () => upd('q'));
  document.querySelectorAll('#view [data-facet]').forEach(s => s.addEventListener('change', () => upd(s.dataset.facet)));
  for (const s of ['#fhealth', '#fage']) if ($(s)) $(s).addEventListener('change', () => upd(''));
  $('#fsaved').addEventListener('change', e => applySavedView(e.target.value));
  const pg = document.querySelector('[data-pager=assets]');
  if (pg){
    pg.addEventListener('click', e => { const b = e.target.closest('[data-page]'); if (b && !b.disabled){ assetPg.page = +b.dataset.page; render(); } });
    pg.querySelector('[data-pagesize]').addEventListener('change', e => { myPrefs().pageSize = +e.target.value; assetPg.page = 1; save(); render(); });
  }
}

// ---------- assignment and return: one rule set for every screen ----------
function releaseReservation(r, a){
  if (r.rep) r.rep.newId = null;
  else if (r.line) r.line.assetIds = r.line.assetIds.filter(x => x !== a.id);
  else if (r.slot === 'other'){ r.part.otherIds = r.part.otherIds.filter(x => x !== a.id); delete r.part.prep[a.id]; }
  else { const s = SLOTS.find(x => x[1] === r.slot); r.part[s[0]] = null; delete r.part.prep[r.slot]; }
  plog(r.project.id, `Asset released from the project: ${a.tag} (moved elsewhere)`);
}
// asks whatever has to be asked before the move; true = go ahead. Nothing changes on Cancel.
async function confirmMove(list, h){
  list = list.filter(a => holderKey(a.holder) !== holderKey(h));
  if (!list.length) return true;
  const moving = list.filter(a => a.holder.kind === 'transit');
  if (moving.length){ alert(`${moving.map(a => a.tag).join(', ')} is in transit. Record the shipment as received first.`); return false; }
  // the location of an asset only changes between offices through a shipment
  const tOff = holderOffice(h), tCountry = h.kind === 'person' ? (office((person(h.id) || {}).officeId) || {}).countryId : null;
  const away = list.filter(a => (tOff && tOff !== a.officeId) || (tCountry && tCountry !== (office(a.officeId) || {}).countryId));
  if (away.length){ alert(`${away.map(a => a.tag).join(', ')} belongs to another ${tOff ? 'office' : 'country'}. Move it with a Shipment in Projects.`); return false; }
  const target = h.kind === 'person' ? person(h.id) : null, targetText = holderText(h);
  const notes = [], conflicts = [];
  const atOffice = list.filter(a => target && ['office', 'desk', 'site'].includes(a.holder.kind));
  const other = list.filter(a => target && a.holder.kind === 'person');
  const back = list.filter(a => !target && (h.kind === 'storage' || a.holder.kind === 'person'));
  if (atOffice.length) notes.push(`This asset is currently assigned to an office location. Do you want to assign it directly to this employee?`);
  if (other.length) notes.push(`${other.length === 1 ? 'This asset is' : 'These assets are'} currently assigned to ${[...new Set(other.map(a => (assetPerson(a) || {}).name || '?'))].join(', ')}. The existing assignment ends and the change is logged.`);
  if (back.length) notes.push(`${back.length === 1 ? 'This asset' : `${back.length} assets`} will be returned to: ${targetText}.`);
  for (const a of list){
    const r = reservedBy(a.id);
    if (r && !(target && r.part && r.part.personId === target.id)){
      conflicts.push([a, r]);
      notes.push(`⚠ ${a.tag} is reserved in project “${r.project.name}”${r.part ? ` for ${(person(r.part.personId) || {}).name || '?'}` : ''}. Confirming removes it from that project.`);
    }
  }
  if (target && target.status !== 'Active') notes.push(`⚠ ${target.name} is ${target.status}. The asset will be listed as awaiting return.`);
  if (!notes.length) return true;
  const ok = await askConfirm(target ? 'Assign asset' : 'Move asset', `${notes.map(n => `<p>${esc(n)}</p>`).join('')}
    <div class="tbl-wrap"><table><thead><tr><th>Asset ID</th><th>Asset Name</th><th>Current Location</th><th>${target ? 'Target Employee' : 'Target'}</th></tr></thead><tbody>${list.map(a =>
      `<tr><td class="tag">${esc(a.tag)}</td><td>${esc(assetName(a))}</td><td>${esc(whereText(a))}</td><td>${esc(target ? target.name : targetText)}</td></tr>`).join('')}</tbody></table></div>`);
  if (ok) for (const [a, r] of conflicts) releaseReservation(r, a);
  return ok;
}
async function bulkMove(hs){
  if (!hs){ alert('Choose where the assets should go or who gets them.'); return; }
  const list = [...selected].map(asset).filter(Boolean);
  if (!list.length) return;
  const h = parseHolder(hs);
  if (!await confirmMove(list, h)) return;
  const from = new Map();
  for (const a of list.filter(x => x.holder.kind === 'person' && h.kind !== 'person')) from.set(a.holder.id, [...(from.get(a.holder.id) || []), a.id]);
  for (const a of list) setHolder(a, h);
  selected.clear(); save(); render();
  if (h.kind === 'person'){
    if (confirm(`${list.length} asset(s) checked out to ${person(h.id).name}.\n\nCreate a handover document for them?`)) docDialog(h.id, 'out', list.map(a => a.id));
  } else if (from.size === 1){
    const [pid, ids] = [...from][0];
    if (confirm(`${ids.length} asset(s) returned from ${person(pid).name}.\n\nCreate a return document?`)) docDialog(pid, 'in', ids);
  }
}
async function bulkStatus(){
  const s = $('#bulkStatus').value;
  if (!s){ alert('Choose a status.'); return; }
  const list = [...selected].map(asset).filter(Boolean), change = list.filter(a => a.status !== s);
  if (!change.length){ toast(`Already ${STATUS[s].label}.`); return; }
  const ok = await askConfirm('Change status', `<p>${change.length} of ${list.length} selected asset(s) change to <b>${STATUS[s].label}</b>.</p>
    <div class="tbl-wrap"><table><thead><tr><th>Asset ID</th><th>Asset Name</th><th>Current Status</th><th>New Status</th></tr></thead><tbody>${change.map(a => `<tr><td class="tag">${esc(a.tag)}</td><td>${esc(assetName(a))}</td><td>${statusPill(a.status)}</td><td>${statusPill(s)}</td></tr>`).join('')}</tbody></table></div>`, `Set ${change.length} asset(s)`);
  if (!ok) return;
  for (const a of change){ log(a.id, `Status: ${STATUS[a.status].label} → ${STATUS[s].label}`, 'updated'); a.status = s; }
  selected.clear(); save(); render(); toast(`${change.length} asset(s) set to ${STATUS[s].label}.`);
}

// ---------- checks shared by Assign Selected Assets and Move Asset ----------
// state: ok = goes ahead | review = needs an explicit tick | blocked = cannot go | same = nothing to change
const canTouch = (a, key) => canAt(key, a.officeId);
function assignCheck(a, t){
  const out = (state, reason) => ({a, state, reason});
  const key = t.serviceId ? 'assets.edit' : t.h.kind === 'person' ? 'assets.assign' : 'assets.move';
  if (!canTouch(a, key)) return out('blocked', `You do not have permission for this at ${officeLabel(a.officeId)}.`);
  if (a.holder.kind === 'transit') return out('blocked', 'In transit. Record the shipment as received first.');
  if (inOpenShipment(a.id)) return out('blocked', 'Part of a shipment that is being prepared. Finish or remove the shipment first.');
  if (t.serviceId){
    if (a.serviceId === t.serviceId) return out('same', 'Already linked to this Service.');
    if (a.serviceId) return out('review', `Linked to ${serviceName(a.serviceId)} now. That link is replaced.`);
    const p = assetPerson(a);
    if (p && p.serviceId && p.serviceId !== t.serviceId) return out('review', `Held by ${p.name} (${serviceName(p.serviceId)}). The person keeps the asset.`);
    return out('ok', 'Only the Service link changes, not the location.');
  }
  const h = t.h, target = h.kind === 'person' ? person(h.id) : null, tOff = holderOffice(h), tCountry = target ? (office(target.officeId) || {}).countryId : null;
  if (holderKey(h) === holderKey(a.holder)) return out('same', 'Already there.');
  if ((tOff && tOff !== a.officeId) || (tCountry && tCountry !== (office(a.officeId) || {}).countryId)) return out('blocked', `Belongs to ${officeCountry(a.officeId).name || '?'} · ${officeLabel(a.officeId)}. Moving it there needs a Shipment.`);
  const why = [];
  if (a.holder.kind === 'person') why.push(`Assigned to ${(assetPerson(a) || {}).name || '?'} now. That assignment ends.`);
  const ret = openReturnOf(a.id);
  if (ret) why.push('A return is expected for this asset. It will be recorded as returned.');
  if (target && target.officeId !== a.officeId) why.push(`Belongs to ${officeLabel(a.officeId)}, ${target.name} works at ${officeLabel(target.officeId)}. The office of the asset stays.`);
  if (target && target.status !== 'Active') why.push(`${target.name} is ${target.status}. The asset will be listed as awaiting return.`);
  const r = reservedBy(a.id);
  if (r && !(target && r.part && r.part.personId === target.id)) why.push(`Reserved in project “${r.project.name}”. Confirming removes it from that project.`);
  if (a.status !== 'ok') why.push(`Status is ${STATUS[a.status].label}.`);
  if (why.length) return out('review', why.join(' '));
  return out('ok', a.holder.kind === 'storage' ? 'Leaves the stock.' : a.holder.kind === 'site' || a.holder.kind === 'office' || a.holder.kind === 'desk' ? 'Leaves its current location.' : '');
}
function applyTarget(a, t, extra){
  if (t.serviceId){ setAssetService(a, t.serviceId, extra); return; }
  const r = reservedBy(a.id), target = t.h.kind === 'person' ? person(t.h.id) : null;
  if (r && !(target && r.part && r.part.personId === target.id)) releaseReservation(r, a);
  setHolder(a, t.h, extra);
}
const CHECK_PILL = {ok:['ok', 'Ready'], review:['warn', 'Needs your check'], blocked:['bad', 'Cannot be changed'], same:['', 'No change']};
const targetLabel = t => t.serviceId ? '🧩 ' + serviceName(t.serviceId) : holderText(t.h);
const targetKind = t => t.serviceId ? 'Service' : {person:'Person', storage:'Warehouse', site:'Office', office:'Room', desk:'Desk'}[t.h.kind] || 'Location';

// ---------- Assign Selected Assets: Review → Target → Check → Preview → Result ----------
const WIZ_STEPS = ['Review assets', 'Choose target', 'Check', 'Preview', 'Result'];
function assignWizard(){
  const w = {ids:[...selected].filter(asset), step:0, type:'person', person:'', office:'', place:'', service:'', ack:{}, ticket:'', note:'', busy:false, res:null};
  if (!w.ids.length) return;
  const offs = [...new Set(w.ids.map(i => asset(i).officeId))];
  w.office = offs.length === 1 ? offs[0] : '';
  const target = () => w.type === 'person' ? (w.person && {h:{kind:'person', id:w.person}}) : w.type === 'office' ? (w.office && {h:w.place ? parseHolder(w.place) : {kind:'site', id:w.office}})
    : w.type === 'service' ? (w.service && {serviceId:w.service}) : {h:{kind:'storage'}};
  const checks = () => w.ids.map(asset).filter(Boolean).map(a => assignCheck(a, target()));
  const going = () => checks().filter(c => c.state === 'ok' || (c.state === 'review' && w.ack[c.a.id]));
  const stepper = () => `<ol class="wiz-steps">${WIZ_STEPS.map((s, i) => `<li class="${i === w.step ? 'on' : i < w.step ? 'done' : ''}">${i + 1}. ${s}</li>`).join('')}</ol>`;
  const assetCell = a => `<td class="tag">${esc(a.tag)}</td><td>${esc(assetName(a))}</td>`;
  const steps = [
    () => `<p><b>${w.ids.length}</b> asset(s) selected. Remove any that should not be included.</p>
      <div class="tbl-wrap nosort"><table><thead><tr><th>Asset Name</th><th>Asset ID</th><th>Type</th><th>Model</th><th>Current Location</th><th></th></tr></thead><tbody>${w.ids.map(asset).map(a => `<tr><td>${esc(assetName(a))}</td><td class="tag">${esc(a.tag)}</td><td>${esc(typeLabel(a.type))}</td><td>${esc(modelName(a))}</td><td>${esc(whereText(a))}</td><td><button type="button" class="sm" data-rm="${a.id}" aria-label="Remove ${esc(a.tag)}">✕</button></td></tr>`).join('')}</tbody></table></div>`,
    () => {
      const cid = scope.countryId, ppl = sortHu(db.people.filter(p => (office(p.officeId) || {}).countryId === cid), p => p.name), ofs = sortHu(db.offices.filter(o => o.countryId === cid), o => o.name);
      const types = [['person', '👤 Person'], ['office', '🏢 Office'], ['service', '🧩 Service'], ['stock', '📦 Warehouse']];
      const rooms = w.office ? sortHu(officeRooms(w.office), r => r.name) : [];
      const p = person(w.person);
      return `<div class="segs" role="radiogroup" aria-label="Target type">${types.map(([k, l]) => `<button type="button" role="radio" aria-checked="${k === w.type}" class="${k === w.type ? 'primary' : ''}" data-type="${k}">${l}</button>`).join('')}</div>
        ${w.type === 'person' ? `<label class="f">Person *</label><select id="wzPerson" class="combo" style="width:100%"><option value="">– choose a person –</option>${ppl.map(x => `<option value="${x.id}"${x.id === w.person ? ' selected' : ''}>${esc(x.name)} – ${esc(serviceName(x.serviceId) || 'no Service')} · ${esc(officeLabel(x.officeId))}${x.status !== 'Active' ? ' · ' + x.status : ''}</option>`).join('')}</select>
          ${p ? `<div class="loc-box" style="font-size:14px">👤 <b>${esc(p.name)}</b><br>Service: ${esc(serviceName(p.serviceId) || '–')} · Office: ${esc(officeLabel(p.officeId))} · ${esc(modeName(p.mode))}</div>` : ''}` : ''}
        ${w.type === 'office' ? `<label class="f">Office *</label><select id="wzOffice" class="combo" style="width:100%"><option value="">– choose an office –</option>${ofs.map(o => `<option value="${o.id}"${o.id === w.office ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
          ${rooms.length ? `<label class="f">Room or desk (optional)</label><select id="wzPlace" class="combo" style="width:100%"><option value="">Not placed yet – at the office</option>${rooms.map(r => `<option value="office:${r.id}"${w.place === 'office:' + r.id ? ' selected' : ''}>🏢 ${esc(r.name)} – room pool</option>${sortHu(db.desks.filter(k => k.roomId === r.id), k => k.label).map(k => `<option value="desk:${k.id}"${w.place === 'desk:' + k.id ? ' selected' : ''}>${furnIcon(k)} ${esc(r.name)} › ${esc(k.label)}</option>`).join('')}`).join('')}</select>` : ''}
          <p class="muted" style="font-size:12px">The asset stays at the office and is not assigned to anyone.</p>` : ''}
        ${w.type === 'service' ? `<label class="f">Service *</label><select id="wzService" class="combo" style="width:100%"><option value="">– choose a Service –</option>${sortHu(db.services, s => s.name).map(s => `<option value="${s.id}"${s.id === w.service ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
          <p class="muted" style="font-size:12px">A Service link is added to the asset. Its location does not change.</p>` : ''}
        ${w.type === 'stock' ? '<p class="muted">The assets go back to the stock of their own office.</p>' : ''}
        <div class="two"><div><label class="f">Ticket (optional)</label><input id="wzTicket" value="${esc(w.ticket)}"></div><div><label class="f">Note (optional)</label><input id="wzNote" value="${esc(w.note)}"></div></div>`;
    },
    () => {
      const cs = checks(), n = s => cs.filter(c => c.state === s).length;
      return `<p>${n('ok')} ready · ${n('review')} need your check · ${n('blocked')} cannot be changed · ${n('same')} no change</p>
        <div class="tbl-wrap nosort"><table><thead><tr><th>Asset ID</th><th>Asset Name</th><th>Current Location</th><th>Result</th></tr></thead><tbody>${cs.map(c => `<tr>${assetCell(c.a)}<td>${esc(whereText(c.a))}</td><td><span class="pill ${CHECK_PILL[c.state][0]}">${CHECK_PILL[c.state][1]}</span>${c.reason ? `<br><small>${esc(c.reason)}</small>` : ''}
          ${c.state === 'review' ? `<label class="cb" style="margin:4px 0 0"><input type="checkbox" data-ack="${c.a.id}"${w.ack[c.a.id] ? ' checked' : ''}> Include this asset</label>` : ''}</td></tr>`).join('')}</tbody></table></div>
        ${n('review') ? '<p class="muted" style="font-size:12px">An asset that needs your check stays unchanged unless you include it.</p>' : ''}`;
    },
    () => {
      const cs = checks(), go = going(), t = target(), left = cs.filter(c => !go.includes(c)), p = t.h && t.h.kind === 'person' ? person(t.h.id) : null;
      return `<dl class="kv card"><dt>Selected</dt><dd><b>${cs.length}</b> asset(s)</dd><dt>Target</dt><dd><b>${esc(targetLabel(t))}</b></dd><dt>Assignment type</dt><dd>${targetKind(t)}</dd>
        ${p ? `<dt>Service</dt><dd>${esc(serviceName(p.serviceId) || '–')}</dd>` : ''}<dt>Will change</dt><dd><b>${go.length}</b> asset(s)</dd><dt>Stay unchanged</dt><dd><b>${left.length}</b> asset(s)</dd>${w.ticket ? `<dt>Ticket</dt><dd>${esc(w.ticket)}</dd>` : ''}${w.note ? `<dt>Note</dt><dd>${esc(w.note)}</dd>` : ''}</dl>
        ${go.length ? `<h4>What changes</h4><div class="tbl-wrap nosort"><table><thead><tr><th>Asset ID</th><th>Asset Name</th><th>From</th><th>To</th></tr></thead><tbody>${go.map(c => `<tr>${assetCell(c.a)}<td>${esc(t.serviceId ? serviceName(c.a.serviceId) || '–' : whereText(c.a))}</td><td>${esc(targetLabel(t))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="errbox">Nothing would change. Go back and choose another target.</div>'}
        ${left.length ? `<h4>Stay unchanged</h4><div class="tbl-wrap nosort"><table><tbody>${left.map(c => `<tr>${assetCell(c.a)}<td>${c.state === 'review' ? 'Not included: ' + esc(c.reason) : esc(c.reason)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
    },
    () => {
      const {done, failed, skipped} = w.res, t = target();
      return `<div class="${failed.length || skipped.length ? 'warnbox' : 'okbox'}"><b>${done.length}</b> of ${done.length + failed.length + skipped.length} asset(s) changed. Target: ${esc(targetLabel(t))}.</div>
        ${failed.length ? `<h4>Failed</h4><div class="tbl-wrap nosort"><table><tbody>${failed.map(x => `<tr>${assetCell(x.a)}<td>${esc(x.reason)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${skipped.length ? `<h4>Not changed</h4><div class="tbl-wrap nosort"><table><tbody>${skipped.map(x => `<tr>${assetCell(x.a)}<td>${esc(x.reason)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${done.length && t.h && t.h.kind === 'person' && can('documents.create') ? '<p><button type="button" id="wzDoc">📄 Create handover document</button></p>' : ''}`;
    },
  ];
  const nextOk = () => w.step === 0 ? w.ids.length > 0 : w.step === 1 ? !!target() : w.step === 2 ? going().length > 0 : w.step === 3 ? going().length > 0 : false;
  const paint = () => {
    $('#wzBody').innerHTML = stepper() + steps[w.step]();
    const last = w.step === 4;
    $('#wzBack').hidden = w.step === 0 || last;
    $('#wzNext').hidden = last;
    $('#wzClose').textContent = last ? 'Close' : 'Cancel';
    $('#wzNext').textContent = w.step === 3 ? `Confirm: change ${going().length} asset(s)` : 'Continue';
    $('#wzNext').disabled = !nextOk();
    const doc = $('#wzDoc');
    if (doc) doc.onclick = () => { const pid = target().h.id, ids = w.res.done.map(a => a.id); $('#dlg').close(); docDialog(pid, 'out', ids); };
  };
  const run = () => {
    if (w.busy) return;
    w.busy = true;
    const t = target(), res = {done:[], failed:[], skipped:[]}, included = new Set(going().map(c => c.a.id)), extra = {ticket:w.ticket.trim(), note:w.note.trim()};
    for (const c of checks()){
      if (!included.has(c.a.id)){ res.skipped.push({a:c.a, reason:c.state === 'review' ? 'Not included: ' + c.reason : c.reason}); continue; }
      try { applyTarget(c.a, t, extra); res.done.push(c.a); selected.delete(c.a.id); }
      catch(e){ res.failed.push({a:c.a, reason:e.message}); }
    }
    save(); render();
    w.res = res; w.step = 4; w.busy = false; paint();
    toast(`${res.done.length} asset(s) changed.`);
  };
  openDialog(`<h3>Assign Selected Assets</h3><div id="wzBody"></div>
    <div class="actions"><button type="button" id="wzClose">Cancel</button><button type="button" id="wzBack">Back</button><button type="button" class="primary" id="wzNext">Continue</button></div>`, () => false, {wide:true});
  $('#wzClose').onclick = () => $('#dlg').close();
  $('#wzBack').onclick = () => { w.step--; paint(); };
  $('#wzNext').onclick = () => { if (!nextOk()) return; if (w.step === 3) run(); else { w.step++; paint(); } };
  $('#wzBody').addEventListener('click', e => {
    const rm = e.target.closest('[data-rm]'), ty = e.target.closest('[data-type]');
    if (rm){ w.ids = w.ids.filter(i => i !== rm.dataset.rm); selected.delete(rm.dataset.rm); updateBulk(); paint(); }
    if (ty){ w.type = ty.dataset.type; w.ack = {}; paint(); }
  });
  $('#wzBody').addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'wzPerson'){ w.person = t.value; w.ack = {}; paint(); }
    if (t.id === 'wzOffice'){ w.office = t.value; w.place = ''; w.ack = {}; paint(); }
    if (t.id === 'wzPlace'){ w.place = t.value; w.ack = {}; }
    if (t.id === 'wzService'){ w.service = t.value; w.ack = {}; paint(); }
    if (t.dataset.ack){ w.ack[t.dataset.ack] = t.checked; $('#wzNext').disabled = !nextOk(); }
  });
  $('#wzBody').addEventListener('input', e => { if (e.target.id === 'wzTicket') w.ticket = e.target.value; if (e.target.id === 'wzNote') w.note = e.target.value; });
  paint();
}
function returnAll(pid){
  const ids = personAssets(pid).direct.map(a => a.id);
  if (!ids.length) return;
  selected.clear(); ids.forEach(id => selected.add(id));
  bulkMove('storage');
}
// the Return to Stock dialog: shows what comes back from where, the dialog itself is the confirmation
function toStorage(id){
  const a = asset(id), pid = a.holder.kind === 'person' ? a.holder.id : null;
  if (a.holder.kind === 'transit'){ alert('This asset is in transit. Record the shipment as received first.'); return; }
  openDialog(`<h3>↩ Return to Stock</h3>
    <div class="tbl-wrap"><table><thead><tr><th>Asset ID</th><th>Asset Name</th><th>Current Location</th></tr></thead><tbody><tr><td class="tag">${esc(a.tag)}</td><td>${esc(assetName(a))}</td><td>${esc(whereText(a))}</td></tr></tbody></table></div>
    <div class="two"><div><label class="f">Return to</label><select name="target"><option value="storage">📦 In Stock</option><option value="site:${a.officeId}">🏢 ${esc(officeLabel(a.officeId))}</option>${sortHu(db.rooms.filter(r => r.officeId === a.officeId), r => roomPath(r)).map(r => `<option value="office:${r.id}">🏢 ${esc(roomPath(r))}</option>`).join('')}</select></div>
      <div><label class="f">Status after return</label><select name="status">${Object.entries(STATUS).map(([k, s]) => `<option value="${k}"${k === a.status ? ' selected' : ''}>${s.label}</option>`).join('')}</select></div></div>
    ${pid ? `<label class="cb"><input type="checkbox" name="mkdoc"> Create a return document</label>` : ''}
    ${dlgActions('Confirm return')}`,
    data => {
      const r = reservedBy(a.id); if (r) releaseReservation(r, a);
      setHolder(a, parseHolder(data.target));
      if (a.status !== data.status){ log(a.id, `Status: ${STATUS[a.status].label} → ${STATUS[data.status].label}`, 'updated'); a.status = data.status; }
      save(); render();
      if (data.mkdoc) setTimeout(() => docDialog(pid, 'in', [a.id]));
    });
}
// the warehouses of an office: its stock, plus any room marked as a Storage room
const warehousesOf = oid => [{v:'storage', l:`📦 In Stock – ${officeLabel(oid)}`}, ...sortHu(officeRooms(oid).filter(r => r.kind === 'storage'), r => r.name).map(r => ({v:'office:' + r.id, l:`📦 ${roomPath(r)} – storage room`}))];
function returnToWarehouse(id){
  const a = asset(id);
  if (a.holder.kind === 'transit'){ alert('This asset is in transit. Record the shipment as received first.'); return; }
  if (a.holder.kind === 'storage'){ toast('The asset is already in stock.'); return; }
  const ws = warehousesOf(a.officeId), res = reservedBy(a.id), ret = openReturnOf(a.id), pid = a.holder.kind === 'person' ? a.holder.id : null;
  openDialog(`<h3>📦 Return to Warehouse</h3>
    <dl class="kv card"><dt>Asset</dt><dd><b class="tag">${esc(a.tag)}</b> ${esc(assetName(a))}</dd><dt>Current location</dt><dd>${esc(whereText(a))}</dd>${ws.length < 2 ? `<dt>Warehouse</dt><dd><b>${esc(ws[0].l)}</b></dd>` : ''}</dl>
    ${ws.length > 1 ? `<label class="f">Warehouse</label><select name="target" style="width:100%">${ws.map(w => `<option value="${w.v}">${esc(w.l)}</option>`).join('')}</select>` : `<input type="hidden" name="target" value="storage">`}
    ${pid ? `<div class="warnbox">The assignment to ${esc((person(pid) || {}).name || '?')} ends.</div>` : ''}
    ${ret ? '<div class="warnbox">The expected return is recorded as returned.</div>' : ''}
    ${res ? `<div class="warnbox">⚠ Reserved in project “${esc(res.project.name)}”. Confirming removes it from that project.</div>` : ''}
    ${fp.editing ? '<div class="warnbox">The floorplan is being edited: this change is saved together with the floorplan.</div>' : ''}
    ${pid && can('documents.create') ? '<label class="cb"><input type="checkbox" name="mkdoc"> Create a return document</label>' : ''}
    ${dlgActions('Return to Warehouse')}`,
    data => {
      const r = reservedBy(a.id); if (r) releaseReservation(r, a);
      setHolder(a, parseHolder(data.target)); save(); render(); toast(`${a.tag} returned to the warehouse.`);
      if (data.mkdoc) setTimeout(() => docDialog(pid, 'in', [a.id]));
    });
}
// one searchable list for every target; a target that needs a Shipment is shown as such and never moves the asset here
function moveDialog(id){
  const a = asset(id), others = sortHu(db.offices.filter(o => o.id !== a.officeId), o => (country(o.countryId) || {}).name + o.name);
  const opts = `<option value="">– choose a target –</option>${holderOptions('', {officeId:a.officeId})}
    <optgroup label="Service">${sortHu(db.services, s => s.name).map(s => `<option value="service:${s.id}">🧩 ${esc(s.name)}</option>`).join('')}</optgroup>
    ${others.length ? `<optgroup label="Another office or country – Shipment required">${others.map(o => `<option value="ship:${o.id}">🚚 ${esc((country(o.countryId) || {}).name || '')} › ${esc(o.name)}</option>`).join('')}</optgroup>` : ''}`;
  const parse = v => v.startsWith('service:') ? {serviceId:v.slice(8)} : {h:parseHolder(v)};
  openDialog(`<h3>Move Asset</h3>
    <dl class="kv card"><dt>Asset</dt><dd><b class="tag">${esc(a.tag)}</b> ${esc(assetName(a))}</dd><dt>Current location</dt><dd>${esc(whereText(a))}</dd></dl>
    <label class="f">Target</label><select id="mvTarget" class="combo" style="width:100%">${opts}</select>
    <div id="mvPrev"></div>
    <div class="row" style="margin-top:8px"><div style="flex:1;min-width:160px"><label class="f">Ticket (optional)</label><input id="mvTicket" style="width:100%"></div><div style="flex:1;min-width:160px"><label class="f">Note (optional)</label><input id="mvNote" style="width:100%"></div></div>
    <div class="actions"><button value="cancel" formnovalidate>Cancel</button><button type="button" class="primary" id="mvOk" disabled>Confirm move</button></div>`, () => false);
  let done = false;
  const paint = () => {
    const v = $('#mvTarget').value, box = $('#mvPrev'), ok = $('#mvOk');
    ok.disabled = true;
    if (!v){ box.innerHTML = ''; return; }
    if (v.startsWith('ship:')){
      box.innerHTML = `<div class="warnbox">🚚 ${esc(officeLabel(v.slice(5)))} is another office, so this asset can only get there with a Shipment. Nothing is moved from here.<br><a href="#/projects" id="mvShip">Open Projects to create a Shipment ›</a></div>`;
      $('#mvShip').addEventListener('click', () => $('#dlg').close());
      return;
    }
    const t = parse(v), c = assignCheck(a, t);
    box.innerHTML = `<dl class="kv card" style="margin-top:8px"><dt>Planned</dt><dd><b>${esc(targetLabel(t))}</b></dd><dt>Type</dt><dd>${targetKind(t)}</dd></dl>
      <div class="${{blocked:'errbox', review:'warnbox', same:'warnbox', ok:'okbox'}[c.state]}">${esc(c.reason || 'Ready to move.')}</div>
      ${c.state === 'review' ? '<label class="cb"><input type="checkbox" id="mvAck"> I checked this, go ahead</label>' : ''}`;
    ok.disabled = c.state === 'blocked' || c.state === 'same' || c.state === 'review';
    const ack = $('#mvAck'); if (ack) ack.addEventListener('change', () => { ok.disabled = !ack.checked; });
  };
  $('#mvTarget').addEventListener('change', paint);
  $('#mvOk').addEventListener('click', () => {
    if (done) return;
    const t = parse($('#mvTarget').value), c = assignCheck(a, t);
    if (c.state === 'blocked' || c.state === 'same') return paint();
    done = true;
    applyTarget(a, t, {ticket:$('#mvTicket').value.trim(), note:$('#mvNote').value.trim()});
    save(); $('#dlg').close(); render(); toast(`${a.tag} moved: ${targetLabel(t)}`);
  });
}
async function deleteAsset(id){
  const a = asset(id);
  if (!a) return;
  const res = reservedBy(id), ret = openReturnOf(id), docs = db.docs.filter(d => d.items.some(i => i.assetId === id)).length;
  if (a.holder.kind === 'transit' || inOpenShipment(id)){ alert(`${a.tag} is part of a shipment. Finish or remove the shipment first.`); return; }
  const ok = await askConfirm('Delete asset', `<p>Delete <b class="tag">${esc(a.tag)}</b> ${esc(assetName(a))}? This cannot be undone.</p>
    <ul><li>The Asset ID is never given out again.</li>${a.holder.kind === 'person' ? `<li>It is assigned to ${esc((assetPerson(a) || {}).name || '?')}; that assignment ends.</li>` : ''}
    ${res ? `<li>It is removed from project “${esc(res.project.name)}”.</li>` : ''}${ret ? '<li>The expected return is cancelled.</li>' : ''}${docs ? `<li>${docs} document(s) keep their own copy of its data.</li>` : ''}</ul>
    <p class="muted">To scrap an asset but keep its history, set its status to “Retired” instead.</p>`, 'Delete asset');
  if (!ok) return;
  for (const pr of db.projects){
    for (const x of pr.participants){
      if (x.computerId === id) x.computerId = null; if (x.monitorId === id) x.monitorId = null; if (x.monitor2Id === id) x.monitor2Id = null;
      x.otherIds = x.otherIds.filter(o => o !== id);
    }
    for (const l of pr.demand) l.assetIds = l.assetIds.filter(o => o !== id);
  }
  for (const r of db.returns) if (r.assetId === id && r.state === 'awaiting') r.state = 'cancelled';
  log(id, `Deleted: ${a.tag} (${modelName(a)})`, 'updated');
  selected.delete(id);
  db.assets = db.assets.filter(x => x.id !== id); save();
  if (location.hash.startsWith('#/asset/')) location.hash = '#/assets'; else render();
  toast(`${a.tag} deleted.`);
}
// a copy for a new asset: same type, model, purchase data and custom fields; never the Asset ID, Serial Number or a unique name
function duplicateAsset(id){ const a = asset(id); if (a) assetForm(null, null, a.type, a); }
// unique values, checked when saving: an unchanged value of an existing asset is never treated as a new conflict
function uniqueErrors(f, self){
  const out = [], same = (x, y) => norm(x) === norm(y), others = db.assets.filter(x => !self || x.id !== self.id);
  if (f.serial && !(self && same(self.serial, f.serial))){ const o = others.find(x => x.serial && same(x.serial, f.serial)); if (o) out.push(`Serial Number “${f.serial}” is already used by ${o.tag}.`); }
  if (f.name && !(self && same(self.name, f.name))){ const o = others.find(x => x.name && same(x.name, f.name)); if (o) out.push(`Asset Name “${f.name}” is already used by ${o.tag}.`); }
  return out;
}

// ---------- asset page ----------
function viewAsset(id){
  const a = asset(id);
  if (!a) return `<div class="empty"><h2>Asset not found</h2><p>It may have been deleted. Data is stored per browser, so a link opened on another device only works if that browser holds the same data.</p></div>`;
  const hist = db.log.filter(l => l.assetId === id), canMove = canTouch(a, 'assets.move') || canTouch(a, 'assets.assign');
  const docs = db.docs.filter(d => d.items.some(i => i.assetId === id));
  const swaps = db.swaps.filter(s => s.oldId === id || s.newId === id);
  const img = assetImg(a), res = reservedBy(id), ret = currentReturn(id);
  const fields = fieldsForType(a.type);
  return `
    <div class="row"><a href="#/assets">← Assets</a></div>
    <div class="row" style="margin-top:8px"><h1>${typeIcon(a.type)} <span class="aid">${esc(a.tag)}</span>${copyBtn(a.tag)}</h1><span class="spacer"></span>
      ${a.holder.kind !== 'storage' ? `<button onclick="swapDialog('${a.id}')">🔁 Swap</button>` : ''}
      <button onclick="labelDialog(['${a.id}'])">🏷 Label</button>
      <button onclick="assetForm(asset('${a.id}'))">✎ Edit</button>
      <button class="danger" onclick="deleteAsset('${a.id}')">Delete</button></div>
    <div class="sub"><b>${esc(assetName(a))}</b> · ${typeLink(a)} · ${modelLink(a)}${a.serial ? ` · S/N <span class="tag">${esc(a.serial)}</span>${copyBtn(a.serial)}` : ''}${a.legacyTag ? ` · legacy ID: ${esc(a.legacyTag)}` : ''}</div>
    <div class="loc-box">Currently: <b>${holderLink(a.holder)}</b>${a.placement ? `<br><span style="font-size:14px">${esc(placementText(a))} – <a href="#/room/${(desk(a.placement.deskId) || {}).roomId}/${a.placement.deskId}">open on the floorplan</a></span>` : ''}
      ${res ? `<br><span style="font-size:14px">📋 Reserved for project: <a href="#/project/${res.project.id}">${esc(res.project.name)}</a>${res.part ? ' – ' + esc((person(res.part.personId) || {}).name || '?') : ''}${res.prep ? ` · <b>${esc(res.prep)}</b>` : ''} (not checked out yet)</span>` : ''}
      ${ret ? `<br><span style="font-size:14px">↩ <b>${RETURN_STATE[ret.state]}</b> from ${personLink(ret.personId)}${ret.state === 'awaiting' ? ` <button class="sm" onclick="toStorage('${a.id}')">Record return</button>` : ''}</span>` : ''}</div>
    ${canMove ? `<div class="row" style="margin-bottom:16px">
      <button class="primary" onclick="moveDialog('${a.id}')"${a.holder.kind === 'transit' ? ' disabled title="In transit: record the shipment as received first."' : ''}>Move Asset</button>
      <button onclick="returnToWarehouse('${a.id}')"${['transit', 'storage'].includes(a.holder.kind) ? ` disabled title="${a.holder.kind === 'storage' ? 'Already in stock.' : 'In transit: record the shipment as received first.'}"` : ''}>📦 Return to Warehouse</button>
    </div>` : ''}
    <div class="asset-head">
      ${img ? `<img class="photo" src="${img}" alt="${esc(modelName(a))}">` : `<div class="photo none" title="No image – upload one when editing">${typeIcon(a.type)}</div>`}
      <div class="card"><dl class="kv">
        <dt>Country</dt><dd>${esc(officeCountry(a.officeId).name || '–')}</dd>
        <dt>City / Office</dt><dd>${esc(officeLabel(a.officeId))}${a.holder.kind === 'transit' ? ' <small class="muted">(sent from here)</small>' : ''}</dd>
        <dt>Asset ID</dt><dd class="aid">${esc(a.tag)}</dd>
        <dt>Asset Name</dt><dd>${esc(assetName(a))}${a.name ? '' : ' <small class="muted">(model name)</small>'}</dd>
        <dt>Type</dt><dd>${typeLink(a)}</dd>
        <dt>Model</dt><dd>${modelLink(a)}</dd>
        <dt>Serial Number</dt><dd>${esc(a.serial) || '–'}</dd>
        <dt>Status</dt><dd>${statusPill(a.status)}</dd>
        <dt>Service</dt><dd>${a.serviceId ? `<a href="#/assets?service=${a.serviceId}">${esc(serviceName(a.serviceId))}</a>` : '–'}</dd>
        <dt>Note</dt><dd style="white-space:pre-wrap">${esc(a.note) || '–'}</dd>
      </dl></div>
      <div class="card"><dl class="kv">
        <dt>Order arrived</dt><dd>${fmtDate(a.arrived)}${ageYears(a) !== null ? ` <small class="muted">(${ageYears(a).toFixed(1)} years)</small>` : ''}${isAged(a) ? ' <span class="pill warn">Aged</span>' : ''}</dd>
        <dt>Warranty end</dt><dd>${a.warrantyUntil ? fmtDate(a.warrantyUntil) + ' ' + warrantyPill(a) : '–'}</dd>
        <dt>Supplier</dt><dd>${esc(a.supplier) || '–'}</dd>
        <dt>Order / invoice</dt><dd>${esc(a.orderNo) || '–'}</dd>
        <dt>Added</dt><dd>${a.created ? fmtTime(a.created) : '–'}</dd>
      </dl></div>
    </div>
    ${fields.length ? `<h2>Custom fields <span class="muted" style="font-weight:400">(${esc([...new Set(fields.map(f => f.setName))].join(', '))})</span></h2>
      <div class="card"><dl class="kv">${fields.map(f => `<dt>${esc(f.name)}${f.required ? ' *' : ''}</dt><dd>${esc(fieldValueText(f, a.custom[f.id]))}</dd>`).join('')}</dl></div>` : ''}
    ${swaps.length ? `<h2>🔁 Swaps</h2>${swapTable(swaps)}` : ''}
    ${docs.length ? `<h2>📄 Documents that include it</h2>${docTable(docs, true)}` : ''}
    <h2>Movement history</h2>
    ${moveHistory(hist)}
    <p class="muted" style="font-size:12px">Kept in this browser with the rest of the data. It is a working record, not a tamper-proof audit log.</p>
    <h2>All changes</h2>
    ${logTable(hist, {noSubject:true})}`;
}
// older entries have no from/to fields, so those two are read from the logged text
function moveHistory(hist){
  const rows = hist.filter(l => ['moved', 'checkout', 'returned'].includes(l.cat) || l.from).map(l => {
    const m = l.from ? null : /: (.*) → (.*)$/.exec(l.text);
    return {...l, from:l.from || (m ? m[1] : ''), to:l.to || (m ? m[2] : ''), label:l.text.startsWith('🔁') ? 'Replacement' : l.text.startsWith('Service') ? 'Service' : LOG_CATS[l.cat] || l.cat};
  });
  if (!rows.length) return '<div class="empty">No movements recorded.</div>';
  return `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>From</th><th>To</th><th>By</th><th>Ticket</th><th>Note</th></tr></thead><tbody>${rows.map(r => `<tr><td class="muted" style="white-space:nowrap" data-v="${r.ts}">${fmtTime(r.ts)}</td><td><span class="pill ${CAT_PILL[r.cat] || ''}">${esc(r.label)}</span></td><td>${esc(r.from) || (r.label === 'Replacement' ? esc(r.text) : '–')}</td><td>${esc(r.to) || '–'}</td><td class="muted">${esc(r.by || '–')}</td><td>${esc(r.ticket || '–')}</td>${clipCell(r.note)}</tr>`).join('')}</tbody></table></div>`;
}

// ---------- asset form ----------
function customInputs(typeId, values){
  const fields = fieldsForType(typeId);
  if (!fields.length) return '<p class="muted" style="font-size:12px">No field set is assigned to this type (Settings → Custom Field Sets).</p>';
  let set = '';
  return fields.map(f => {
    const v = values[f.id], name = 'cf_' + f.id, req = f.required && f.kind !== 'bool' ? ' required' : '';
    const head = f.setName !== set ? `<div class="muted" style="font-size:11px;margin-top:10px;text-transform:uppercase;letter-spacing:.05em">${esc(set = f.setName)}</div>` : '';
    let inp;
    if (f.kind === 'bool') inp = `<label class="cb" style="margin:6px 0"><input type="checkbox" name="${name}"${v ? ' checked' : ''}> ${esc(f.name)}</label>`;
    else if (f.kind === 'select') inp = `<label class="f">${esc(f.name)}${f.required ? ' *' : ''}</label><select name="${name}"${req}><option value="">–</option>${f.options.map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else inp = `<label class="f">${esc(f.name)}${f.required ? ' *' : ''}</label><input name="${name}" type="${f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : 'text'}"${f.kind === 'number' ? ' step="any"' : ''} value="${esc(v ?? '')}"${req}>`;
    return head + inp;
  }).join('');
}
function readCustom(typeId, form, prev){
  const out = {...prev};
  for (const f of fieldsForType(typeId)){
    const el = form.elements['cf_' + f.id];
    if (!el) continue;
    out[f.id] = f.kind === 'bool' ? el.checked : f.kind === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value.trim();
  }
  return out;
}
function modelOptions(typeId, cur){
  return sortHu(db.models.filter(m => m.typeId === typeId), m => m.name).map(m => `<option value="${m.id}"${m.id === cur ? ' selected' : ''}>${esc(m.name)}</option>`).join('') +
    '<option value="__new">＋ New model…</option>';
}
function assetForm(a, presetHolder, presetType, copyFrom){
  const isNew = !a, src = copyFrom || null;
  const t0 = presetType && db.types.some(t => t.id === presetType) ? presetType : 'monitor';
  const newOffice = src && scopeOfficeIds().includes(src.officeId) ? src.officeId : scope.officeId || scopeOfficeIds()[0];
  a = a || {officeId:newOffice, type:t0, name:'', modelId:src ? src.modelId : '', serial:'', status:'ok', holder:presetHolder || {kind:'storage'}, serviceId:src ? src.serviceId : null, custom:src ? JSON.parse(JSON.stringify(src.custom || {})) : {}, note:src ? src.note : '',
    arrived:src ? src.arrived : todayIso(), warrantyUntil:src ? src.warrantyUntil : '', supplier:src ? src.supplier : '', orderNo:src ? src.orderNo : '', legacyTag:''};
  const preview = fmtAssetId(Math.max(db.seq.asset || 0, ...db.assets.map(x => assetNum(x.tag)), 0) + 1);
  const curImg = assetImg(a);
  let pendingImg = null, custom = {...a.custom}, curType = a.type;
  openDialog(`
    <h3>${src ? `Duplicate asset <small class="muted">(from ${esc(src.tag)})</small>` : isNew ? 'New asset' : 'Edit asset'}</h3>
    ${src ? '<div class="warnbox">The copy gets a new Asset ID. Serial Number, Legacy ID and any own Asset Name are left empty because they must be unique. Check the values, then save.</div>' : ''}
    ${isNew ? `<label class="f">Country / Office *</label><select name="officeId" id="fOffice">${sortHu(db.offices.filter(o => scopeOfficeIds().includes(o.id)), o => o.name).map(o => `<option value="${o.id}"${o.id === a.officeId ? ' selected' : ''}>${esc(officeCountry(o.id).name)} · ${esc(o.name)}</option>`).join('')}</select>`
      : `<p class="muted">Location: ${esc(officeCountry(a.officeId).name || '–')} · ${esc(officeLabel(a.officeId))} <small>(changes through a Shipment)</small></p>`}
    <div class="two">
      <div><label class="f">Asset ID</label><input value="${isNew ? preview + ' (automatic)' : esc(a.tag)}" disabled class="aid"></div>
      <div><label class="f">Legacy ID / sticker (optional)</label><input name="legacyTag" value="${esc(a.legacyTag || '')}"></div>
      <div><label class="f">Asset Type</label><select name="type" id="fType">${sortHu(db.types, t => t.name).map(t => `<option value="${esc(t.id)}"${t.id === a.type ? ' selected' : ''}>${t.icon} ${esc(t.name)}</option>`).join('')}</select></div>
      <div><label class="f">Model</label><select name="modelId" id="fModel">${modelOptions(a.type, a.modelId)}</select>
        <input name="newModel" id="fNewModel" placeholder="New model name, e.g. Dell P2422H" style="display:none;margin-top:4px"></div>
      <div><label class="f" id="fNameLbl">Asset Name</label><input name="name" id="fName" value="${esc(a.name || '')}" aria-describedby="fUniq"></div>
      <div><label class="f">Serial Number</label><input name="serial" id="fSerial" value="${esc(a.serial)}" aria-describedby="fUniq"></div>
    </div>
    <div id="fUniq" class="errbox" role="alert" hidden></div>
    <div class="two">
      <div><label class="f">Status</label><select name="status">${Object.entries(STATUS).map(([k, s]) => `<option value="${k}"${k === a.status ? ' selected' : ''}>${s.label}</option>`).join('')}</select></div>
      <div><label class="f">Service (optional)</label><select name="serviceId">${selOpts(sortHu(db.services, s => s.name), a.serviceId, s => s.name, '–')}</select></div>
    </div>
    <label class="f">Location / assigned to</label>
    <select name="holder" class="combo">${holderOptions(holderKey(a.holder), {officeId:a.officeId})}</select>
    <h3 style="margin-top:18px;font-size:14px">Custom fields</h3>
    <div id="fCustom">${customInputs(a.type, custom)}</div>
    <h3 style="margin-top:18px;font-size:14px">Purchase & warranty</h3>
    <div class="two">
      <div><label class="f">Order arrived</label><input name="arrived" id="fArrived" type="date" value="${esc(a.arrived || '')}"></div>
      <div><label class="f">Warranty end</label><input name="warrantyUntil" id="fWarr" type="date" value="${esc(a.warrantyUntil || '')}"></div>
      <div><label class="f">Supplier</label><input name="supplier" value="${esc(a.supplier || '')}"></div>
      <div><label class="f">Order / invoice number</label><input name="orderNo" value="${esc(a.orderNo || '')}"></div>
    </div>
    <div class="row" style="margin-top:6px"><span class="muted" style="font-size:12px">Warranty from arrival:</span>
      ${[1, 2, 3, 5].map(y => `<button type="button" class="sm" data-wy="${y}">${y} yr</button>`).join('')}</div>
    <h3 style="margin-top:18px;font-size:14px">Image (belongs to the model)</h3>
    <div class="row"><img id="fImgPrev" class="thumb" style="width:64px;height:64px;${curImg ? '' : 'display:none'}" src="${curImg || ''}" alt="">
      <input type="file" id="fImg" accept="image/*" style="flex:1;min-width:200px"></div>
    <p class="muted" style="font-size:12px;margin:4px 0 0">The image appears on every asset of the selected model.</p>
    <label class="f">Note</label><textarea name="note" style="width:100%">${esc(a.note)}</textarea>
    ${dlgActions(isNew ? 'Create' : 'Save')}`,
    (data, form) => {
      // unique values are checked here, at saving, whatever the live hint said
      const uq = uniqueErrors({serial:data.serial.trim(), name:data.name.trim()}, isNew ? null : a);
      if (uq.length){ alert(uq.join('\n') + '\n\nNothing was saved.'); return false; }
      let modelId = data.modelId;
      if (modelId === '__new'){
        const nm = (data.newModel || '').trim();
        if (!nm){ alert('Enter the new model name.'); return false; }
        const ex = db.models.find(m => m.typeId === data.type && norm(m.name) === norm(nm));
        modelId = ex ? ex.id : (db.models.push({id:uid(), typeId:data.type, name:nm, imageId:null}), db.models[db.models.length - 1].id);
      }
      if (!modelId){ alert('Choose or create a model.'); return false; }
      const newCustom = readCustom(data.type, form, custom);
      const t = typeOf(data.type), name = data.name.trim();
      if (isNew && t.nameRule === 'custom' && !name){ alert(`Asset Name is required for ${t.name}.`); return false; }
      const fields = {type:data.type, name, modelId, serial:data.serial.trim(), status:data.status, serviceId:data.serviceId || null, note:data.note,
        arrived:data.arrived, warrantyUntil:data.warrantyUntil, supplier:data.supplier.trim(), orderNo:data.orderNo.trim(), legacyTag:data.legacyTag.trim(), custom:newCustom};
      let target = a;
      if (isNew){
        const nh = parseHolder(data.holder);
        if (holderOffice(nh) && holderOffice(nh) !== data.officeId){ alert('The chosen location belongs to another office.'); return false; }
        target = {id:uid(), tag:nextAssetId(), officeId:data.officeId, ...fields, holder:nh, placement:null, created:Date.now(), assignedAt:null};
        db.assets.push(target);
        log(target.id, `Created: ${target.tag} · ${typeLabel(target.type)} · ${modelName(target)}`, 'created');
        const h = target.holder; target.holder = {kind:'storage'};
        if (h.kind !== 'storage') setHolder(target, h);
      } else {
        const changes = [];
        const lbl = {type:'Type', name:'Asset Name', modelId:'Model', serial:'Serial Number', serviceId:'Service', supplier:'Supplier', orderNo:'Order', arrived:'Arrived', warrantyUntil:'Warranty', legacyTag:'Legacy ID', note:'Note'};
        const show = (k, v) => k === 'type' ? typeLabel(v) : k === 'modelId' ? (model(v) || {}).name : k === 'serviceId' ? serviceName(v) : v;
        for (const k of Object.keys(lbl)) if ((a[k] || '') !== (fields[k] || '')) changes.push(`${lbl[k]}: ${show(k, a[k]) || '–'} → ${show(k, fields[k]) || '–'}`);
        const fl = fieldsForType(fields.type).filter(f => String(a.custom[f.id] ?? '') !== String(newCustom[f.id] ?? ''));
        if (fl.length) changes.push('Custom fields: ' +fl.map(f => f.name).join(', '));
        if (a.status !== data.status) log(a.id, `Status: ${STATUS[a.status].label} → ${STATUS[data.status].label}`, 'updated');
        Object.assign(a, fields);
        if (changes.length) log(a.id, 'Updated – ' + changes.join('; '), 'updated');
      }
      if (pendingImg){ const iid = uid(); db.images[iid] = pendingImg; model(target.modelId).imageId = iid; }
      save(); render();
      // a location change from the form follows the same rules as any other move
      const h = parseHolder(data.holder);
      if (!isNew && holderKey(h) !== holderKey(a.holder)) confirmMove([a], h).then(ok => { if (ok){ setHolder(a, h); save(); render(); } });
    });
  const syncName = () => { const c = typeOf($('#fType').value).nameRule === 'custom'; $('#fNameLbl').textContent = c ? 'Asset Name *' : 'Asset Name'; $('#fName').placeholder = c ? 'e.g. computer name' : 'Empty = uses the Model Name'; };
  syncName(); $('#fType').addEventListener('change', syncName);
  // a hint while typing; the save itself checks again
  const liveUniq = () => { const e = uniqueErrors({serial:$('#fSerial').value.trim(), name:$('#fName').value.trim()}, isNew ? null : a); $('#fUniq').hidden = !e.length; $('#fUniq').textContent = e.join(' '); $('#dlgOk').disabled = !!e.length; };
  $('#fSerial').addEventListener('input', liveUniq); $('#fName').addEventListener('input', liveUniq);
  if (isNew) $('#fOffice').addEventListener('change', e => { const s = $('#dlgForm').elements.holder; s.innerHTML = holderOptions('storage', {officeId:e.target.value}); });
  const syncModel = () => { $('#fNewModel').style.display = $('#fModel').value === '__new' ? '' : 'none'; };
  $('#fModel').addEventListener('change', syncModel);
  $('#fType').addEventListener('change', e => {
    custom = readCustom(curType, $('#dlgForm'), custom); curType = e.target.value;
    $('#fModel').innerHTML = modelOptions(e.target.value, '');
    if ($('#fModel').options.length === 1) $('#fModel').value = '__new';
    syncModel();
    $('#fCustom').innerHTML = customInputs(e.target.value, custom);
  });
  if (!a.modelId && $('#fModel').options.length === 1) $('#fModel').value = '__new';
  syncModel();
  $('#fImg').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    $('#dlgOk').disabled = true;
    try { pendingImg = await resizeImage(f); $('#fImgPrev').src = pendingImg; $('#fImgPrev').style.display = ''; }
    catch(err){ alert(err.message); e.target.value = ''; }
    $('#dlgOk').disabled = false;
  });
  document.querySelectorAll('[data-wy]').forEach(b => b.addEventListener('click', () => {
    const base = $('#fArrived').value; if (!base){ alert('Enter the arrival date first.'); return; }
    const d = new Date(base); d.setFullYear(d.getFullYear() + +b.dataset.wy); $('#fWarr').value = d.toISOString().slice(0, 10);
  }));
}

// pick an existing asset and move it to holder h (person page "issue existing asset")
function assignAssetDialog(h, title){
  const key = holderKey(h);
  const cands = sortHu(scopedAssets().filter(a => holderKey(a.holder) !== key && a.status !== 'retired' && a.holder.kind !== 'transit'), a => (a.holder.kind === 'storage' ? '0' : '1') + a.tag);
  if (!cands.length){ alert('There is no asset to move. Create one first.'); return; }
  openDialog(`<h3>${esc(title)}</h3><p class="muted" style="margin:0 0 6px">Target: <b>${esc(holderText(h))}</b></p>
    <label class="f">Asset</label>${picker('asset', cands.map(a => `<option value="${a.id}">${typeIcon(a.type)} ${esc(a.tag)} · ${esc(assetName(a))} · ${esc(a.serial)} — ${esc(whereText(a))}</option>`).join(''), {size:10, required:true})}
    ${dlgActions('Assign / move')}`,
    data => {
      const a = asset(data.asset); if (!a){ alert('Choose an asset.'); return false; }
      confirmMove([a], h).then(ok => { if (ok){ setHolder(a, h); save(); render(); } });
    });
}

// ---------- swap ----------
function swapDialog(oldId){
  const old = asset(oldId);
  if (old.holder.kind === 'storage'){ alert('An asset in stock does not need a swap – swaps are for assets in use.'); return; }
  if (old.holder.kind === 'transit'){ alert('This asset is in transit. Record the shipment as received first.'); return; }
  const cands = sortHu(db.assets.filter(a => a.holder.kind === 'storage' && a.officeId === old.officeId && a.status === 'ok' && !reservedBy(a.id)), a => (a.type === old.type ? '0' : '1') + a.tag);
  if (!cands.length){ alert('There is no free working asset in stock. Add one first, then do the swap.'); return; }
  const owner = holderPerson(old.holder), hasSame = cands.some(a => a.type === old.type);
  openDialog(`
    <h3>🔁 Asset swap</h3>
    <div class="loc-box" style="font-size:14px;margin-top:4px">Replacing: ${assetIcon(old)} <b class="aid">${esc(old.tag)}</b> · ${esc(typeLabel(old.type))} · ${esc(modelName(old))}<br>
      <small class="muted">${esc(whereText(old))}</small></div>
    <div class="two">
      <div><label class="f">Reason</label><select name="reason" id="swReason">${Object.entries(SWAP_REASONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div><label class="f">New status of the replaced asset</label><select name="oldStatus" id="swStatus">${Object.entries(STATUS).map(([k, s]) => `<option value="${k}"${k === 'repair' ? ' selected' : ''}>${s.label}</option>`).join('')}</select></div>
    </div>
    <label class="f">Target</label><p style="margin:0"><b>${owner ? '👤 ' + esc(person(owner).name) : old.serviceId ? '🧩 ' + esc(serviceName(old.serviceId)) : esc(whereText(old))}</b> <small class="muted">${owner ? 'Person' : old.serviceId ? 'Service' : 'Location'}</small></p>
    <label class="f">Ticket (optional)</label><input name="ticket" style="width:100%" placeholder="e.g. INC-20417">
    <label class="f">Fault description / note</label><textarea name="note" style="width:100%" placeholder="e.g. does not power on, striped image"></textarea>
    <label class="f">Replacement asset (working, in stock)</label>
    <label class="cb" style="margin:4px 0"><input type="checkbox" id="swSame"${hasSame ? ' checked' : ''}> Same type only (${esc(typeLabel(old.type))})</label>
    <select name="newId" id="swSel" class="combo" required style="width:100%">${cands.map(a =>
      `<option value="${a.id}" data-type="${esc(a.type)}">${typeIcon(a.type)} ${esc(a.tag)} · ${esc(modelName(a))} · ${esc(a.serial)}</option>`).join('')}</select>
    <div class="two">
      <div><label class="f">Date</label><input type="date" name="date" required value="${todayIso()}"></div>
      <div><label class="f">Handed over by (IT)</label><input name="handler" value="${esc(db.settings.handler)}"></div>
    </div>
    ${owner ? `<label class="cb"><input type="checkbox" name="mkdoc" checked> Create a swap document – ${esc(person(owner).name)}</label>` : '<p class="muted" style="font-size:12px">Asset at a shared location – no document is created, the swap is recorded in the register.</p>'}
    ${dlgActions('Do the swap')}`,
    data => {
      const nw = asset(data.newId);
      if (!nw){ alert('Choose the replacement asset.'); return false; }
      const where = whereText(old), reason = SWAP_REASONS[data.reason], ticket = data.ticket.trim();
      // nothing has changed yet: the summary is the last stop before the swap
      askConfirm('Confirm the swap', `<dl class="kv card"><dt>Target</dt><dd><b>${owner ? esc(person(owner).name) : old.serviceId ? esc(serviceName(old.serviceId)) : esc(where)}</b></dd>
        <dt>Old asset (comes back)</dt><dd><b class="tag">${esc(old.tag)}</b> ${esc(assetName(old))}<br><small class="muted">To stock, status: ${STATUS[data.oldStatus].label}</small></dd>
        <dt>New asset (handed over)</dt><dd><b class="tag">${esc(nw.tag)}</b> ${esc(assetName(nw))}<br><small class="muted">To: ${esc(where)}</small></dd>
        <dt>Reason</dt><dd>${esc(reason)}</dd>${ticket ? `<dt>Ticket</dt><dd>${esc(ticket)}</dd>` : ''}${data.note.trim() ? `<dt>Note</dt><dd>${esc(data.note.trim())}</dd>` : ''}</dl>`, 'Do the swap').then(ok => {
        if (!ok) return;
        const h = old.holder, place = old.placement, extra = ticket ? {ticket} : {};
        setHolder(nw, h, {...extra, note:'Replacement for ' + old.tag});
        if (place) nw.placement = {...place};
        if (!owner && old.serviceId && nw.serviceId !== old.serviceId) setAssetService(nw, old.serviceId, extra);
        setHolder(old, {kind:'storage'}, {...extra, note:'Replaced by ' + nw.tag});
        if (old.status !== data.oldStatus){ log(old.id, `Status: ${STATUS[old.status].label} → ${STATUS[data.oldStatus].label}`, 'updated'); old.status = data.oldStatus; }
        log(old.id, `🔁 Replaced by ${nw.tag} – ${reason}${data.note.trim() ? ': ' + data.note.trim() : ''}`, 'returned', extra);
        log(nw.id, `🔁 Checked out as replacement for ${old.tag} (${where})`, 'checkout', extra);
        const sw = {id:uid(), ts:Date.now(), date:data.date, oldId:old.id, newId:nw.id, oldTag:old.tag, newTag:nw.tag,
          reason, note:data.note.trim(), ticket, oldStatus:data.oldStatus, where, personId:owner, docId:null};
        db.swaps.unshift(sw);
        let doc = null;
        if (owner && data.mkdoc){
          doc = createDoc(owner, 'swap', [], {date:data.date, handler:data.handler.trim(), note:data.note.trim(), reason,
            items:[{...snapAsset(nw), role:'out'}, {...snapAsset(old), role:'in'}], swapId:sw.id});
          sw.docId = doc.id;
        }
        $('#dlg').close(); save(); render();
        if (doc) printDoc(doc.id);
      });
      return false;
    });
  const filt = () => {
    const same = $('#swSame').checked, sel = $('#swSel');
    for (const o of sel.options) o.hidden = same && o.dataset.type !== old.type;
    if (!sel.selectedOptions[0] || sel.selectedOptions[0].hidden){ const first = [...sel.options].find(o => !o.hidden); if (first) sel.value = first.value; }
  };
  $('#swSame').addEventListener('change', filt); filt();
  $('#swReason').addEventListener('change', e => { $('#swStatus').value = {lost:'lost', upgrade:'ok'}[e.target.value] || 'repair'; });
}
function swapTable(list, opts = {}){
  if (!list.length) return '<div class="empty">No swaps yet.</div>';
  const tagLink = (id, tag) => asset(id) ? `<a class="tag" href="#/asset/${id}">${esc(asset(id).tag)}</a>` : `<span class="tag">${esc(tag)}</span>`;
  return `<div class="tbl-wrap"><table><thead><tr><th>Date</th>${opts.noWhere ? '' : '<th>Person / place</th>'}<th>Replaced asset</th><th></th><th>Replacement</th><th>Reason</th><th>Replaced asset now</th><th>Document</th></tr></thead><tbody>${list.map(s => {
    const o = asset(s.oldId), d = s.docId && byId(db.docs, s.docId);
    return `<tr><td style="white-space:nowrap">${fmtDate(s.date)}</td>
      ${opts.noWhere ? '' : `<td>${s.personId && person(s.personId) ? personLink(s.personId) : esc(s.where)}</td>`}
      <td>${tagLink(s.oldId, s.oldTag)}</td><td>➜</td><td>${tagLink(s.newId, s.newTag)}</td>
      <td>${esc(s.reason)}${s.ticket ? ` <span class="tag">${esc(s.ticket)}</span>` : ''}${s.note ? `<br><small class="muted">${esc(s.note)}</small>` : ''}</td>
      <td>${o ? statusPill(o.status) + `<br><small class="muted">${esc(whereText(o))}</small>` : '<span class="muted">deleted</span>'}</td>
      <td>${d ? `<span class="tag">${esc(d.no)}</span> ${d.fileId ? '<span class="pill ok">✔</span>' : '<span class="pill warn">awaiting signature</span>'}` : '<span class="muted">–</span>'}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

// ---------- CSV export ----------
function exportCSV(){
  const fsFields = db.fieldSets.flatMap(s => s.fields.filter(f => f.active).map(f => ({...f, setName:s.name})));
  const rows = [['Asset ID', 'Asset Name', 'Country', 'City / Office', 'Legacy ID', 'Type', 'Model', 'Serial Number', 'Status', 'Location type', 'Location', 'On desk (Hybrid)', 'Person', 'Service',
    'Arrived', 'Warranty end', 'Supplier', 'Order/invoice', 'Note', ...fsFields.map(f => `${f.setName}: ${f.name}`)]];
  for (const a of sortHu(scopedAssets(), a => a.tag)){
    const who = holderPerson(a.holder);
    rows.push([a.tag, assetName(a), officeCountry(a.officeId).name, officeLabel(a.officeId), a.legacyTag, typeLabel(a.type), modelName(a), a.serial, STATUS[a.status].label, LOC_LABEL[a.holder.kind].replace(/^\S+\s/, ''),
      holderText(a.holder).replace(/^\S+\s/, ''), placementText(a).replace(/^\S+\s/, ''), who ? (person(who) || {}).name : '', serviceName(a.serviceId),
      a.arrived, a.warrantyUntil, a.supplier, a.orderNo, a.note, ...fsFields.map(f => fsFields && fieldsForType(a.type).some(x => x.id === f.id) ? fieldValueText(f, a.custom[f.id]).replace(/^–$/, '') : '')]);
  }
  download(`tc-itam-assets-${stamp()}.csv`, '﻿' + rows.map(csvLine).join('\r\n'), 'text/csv');
}

// ---------- import helpers (shared with the people import) ----------
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
let xlsxP;
const loadXLSX = () => xlsxP ||= new Promise((res, rej) => {
  if (window.XLSX) return res(window.XLSX);
  const s = document.createElement('script'); s.src = XLSX_URL;
  s.onload = () => res(window.XLSX);
  s.onerror = () => { xlsxP = null; s.remove(); rej(new Error('The Excel library could not be loaded (no internet connection?). CSV files can still be imported.')); };
  document.head.appendChild(s);
});
const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function toISO(v){
  if (v instanceof Date && !isNaN(v)) return isoLocal(v);
  if (typeof v === 'number' && v > 20000 && v < 80000) return isoLocal(new Date(Math.round((v - 25569) * 864e5)));
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})[.\-/ ]+(\d{1,2})[.\-/ ]+(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  if (m){ const [x, y] = +m[1] > 12 ? [m[2], m[1]] : [m[1], m[2]]; return `${m[3]}-${x.padStart(2, '0')}-${y.padStart(2, '0')}`; }
  return '';
}
function parseCSV(text){
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0];
  const delim = [';', '\t', ','].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i];
    if (q){ if (c === '"'){ if (text[i + 1] === '"'){ cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim){ row.push(cur); cur = ''; }
    else if (c === '\n'){ row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur || row.length){ row.push(cur); rows.push(row); }
  return rows;
}
// Excel or CSV → {headers, rows}
async function readTable(file, preferSheet){
  const buf = await file.arrayBuffer();
  let rows;
  if (/\.(csv|txt)$/i.test(file.name)){
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('windows-1250').decode(buf); // Excel's Hungarian CSV
    rows = parseCSV(text);
  } else {
    const X = await loadXLSX();
    const wb = X.read(buf, {type:'array', cellDates:true});
    const name = wb.SheetNames.find(n => norm(n) === norm(preferSheet || '')) || wb.SheetNames.find(n => !/útmutató|guide/i.test(n)) || wb.SheetNames[0];
    rows = X.utils.sheet_to_json(wb.Sheets[name], {header:1, raw:true, defval:''});
  }
  rows = rows.filter(r => r.some(c => String(c ?? '').trim()));
  const hi = rows.findIndex(r => r.filter(c => String(c ?? '').trim()).length >= 2);
  if (hi < 0 || rows.length <= hi + 1) throw new Error('No header and data rows found in the file.');
  return {headers: rows[hi].map(h => String(h ?? '').trim()), rows: rows.slice(hi + 1)};
}
// guess which column holds which field: exact header name first, then a partial match; aliases are in priority order
function guessColumns(headers, fields){
  const map = {}, used = new Set(), clean = h => norm(h).replace(/\*/g, '').trim();
  for (const exact of [true, false]) for (const f of fields){
    if (map[f.key] >= 0) continue;
    let i = -1;
    for (const a of f.aliases){
      i = headers.findIndex((h, j) => !used.has(j) && (exact ? clean(h) === norm(a) : a.length > 4 && clean(h).includes(norm(a))));
      if (i >= 0) break;
    }
    map[f.key] = i; if (i >= 0) used.add(i);
  }
  return map;
}
const mapSelect = (f, headers, map, attr = 'data-map') => `<select ${attr}="${f.key}" style="width:100%"><option value="-1">– none –</option>${headers.map((h, i) =>
  `<option value="${i}"${map[f.key] === i ? ' selected' : ''}>${esc(h || '(column ' + (i + 1) + ')')}</option>`).join('')}</select>`;

// ---------- asset import (Excel / CSV / Snipe-IT export) ----------
const IMPORT_FIELDS = [
  {key:'legacy',         label:'Legacy ID / sticker', aliases:['legacy id / sticker', 'legacy id', 'régi id / matrica', 'régi id', 'eszköz id', 'asset tag', 'asset_tag', 'leltári szám', 'tag']},
  {key:'type',           label:'Asset Type',          aliases:['típus', 'category', 'kategória', 'type', 'asset category']},
  {key:'manufacturer',   label:'Manufacturer',        aliases:['gyártó', 'manufacturer']},
  {key:'model',          label:'Model',               aliases:['modell', 'gyártó / modell', 'model', 'model name', 'asset model']},
  {key:'serial',         label:'Serial Number',       aliases:['sorozatszám', 'serial', 'serial number', 's/n']},
  {key:'status',         label:'Status',              aliases:['állapot', 'status', 'status label']},
  {key:'holder',         label:'Holder / location',   aliases:['holder / location', 'kinél / hol', 'kinél', 'checked out to', 'assigned to', 'assigned_to', 'kiadva']},
  {key:'email',          label:'Person e-mail',       aliases:['személy e-mail', 'e-mail', 'email', 'user email']},
  {key:'service',        label:'Service',             aliases:['service', 'szolgáltatás', 'team', 'csapat', 'department']},
  {key:'location',       label:'Location',            aliases:['location', 'hely', 'helyszín', 'default location']},
  {key:'country',        label:'Country',             aliases:['country', 'ország']},
  {key:'office',         label:'City / Office',       aliases:['city / office', 'office', 'city', 'iroda', 'város']},
  {key:'arrived',        label:'Order arrived',       aliases:['order arrived', 'rendelés érkezése', 'érkezés', 'purchase date', 'beszerzés dátuma']},
  {key:'warrantyUntil',  label:'Warranty end',        aliases:['warranty end', 'garancia vége', 'warranty expires', 'warranty expiration', 'warranty_expires']},
  {key:'warrantyMonths', label:'Warranty (months)',   aliases:['warranty (months)', 'garancia (hónap)', 'warranty', 'warranty months']},
  {key:'supplier',       label:'Supplier',            aliases:['beszállító', 'supplier']},
  {key:'orderNo',        label:'Order / invoice',     aliases:['order / invoice number', 'rendelés / számla száma', 'order number', 'invoice', 'számla']},
  {key:'note',           label:'Note',                aliases:['megjegyzés', 'notes', 'note', 'asset name', 'name']},
];
const TYPE_WORDS = [
  ['monitor', ['monitor', 'display', 'kijelző', 'képernyő']], ['headset', ['headset', 'headphone', 'fejhallgató', 'fülhallgató']],
  ['dock', ['dock', 'dokkoló']], ['keyboard', ['keyboard', 'mouse', 'billentyű', 'egér']], ['phone', ['phone', 'mobile', 'telefon', 'iphone']],
  ['printer', ['printer', 'nyomtató']], ['switch', ['switch']], ['router', ['router', 'firewall', 'tűzfal', 'fortigate']],
  ['server', ['server', 'szerver']], ['ups', ['ups', 'szünetmentes']],
  ['pc', ['laptop', 'notebook', 'desktop', 'computer', 'számítógép', 'pc', 'workstation', 'thinkpad', 'latitude', 'elitebook', 'macbook']],
];
// known type id, or {newType: name} when the file names a type we do not have yet
function resolveType(v, mdl){
  const n = norm(v);
  for (const t of db.types) if (n && (n === norm(t.id) || n === norm(t.name))) return {id:t.id};
  const hay = norm(v + ' ' + mdl);
  for (const [k, ws] of TYPE_WORDS) if (db.types.some(t => t.id === k) && ws.some(w => hay.includes(norm(w)))) return {id:k};
  return n ? {newType:String(v).trim()} : {id:'other'};
}
function parseStatus(v){
  const n = norm(v);
  if (!n) return '';
  if (/javit|repair/.test(n)) return 'repair';
  if (/faulty|defect|broken|hibas/.test(n)) return 'faulty';
  if (/missing|hianyz/.test(n)) return 'missing';
  if (/lost|stolen|elvesz|lopott/.test(n)) return 'lost';
  if (/archiv|retire|selejt|dispos/.test(n)) return 'retired';
  return 'ok';
}
let imp = null;
async function readImportFile(file){
  try {
    const t = await readTable(file, 'Assets');
    imp = {fileName:file.name, headers:t.headers, rows:t.rows, map:guessColumns(t.headers, IMPORT_FIELDS), createPeople:true, countryId:scope.countryId, officeId:scope.officeId};
    render();
  } catch(e){ alert('Could not read the file: ' + e.message); }
}
function findDeskByText(t){
  const [a, b] = t.split(/\s*[/›>]\s*/);
  if (!b) return null;
  const r = db.rooms.find(r => norm(r.name).startsWith(norm(a))) || db.rooms.find(r => norm(r.name).includes(norm(a)));
  return r && db.desks.find(k => k.roomId === r.id && norm(k.label) === norm(b)) || null;
}
function findRoomByText(t){
  const n = norm(t.replace(/^(iroda|office)\s*:\s*/i, ''));
  return n ? db.rooms.find(r => norm(r.name) === n || norm(r.name).startsWith(n + ' ')) || null : null;
}
function resolveHolder(text, email, loc){
  const byMail = email && db.people.find(p => p.email && norm(p.email) === norm(email));
  if (byMail) return {h:{kind:'person', id:byMail.id}};
  if (!text || /^(raktar|storage|-)$/.test(norm(text))){
    const k = loc && findDeskByText(loc), r = loc && findRoomByText(loc);
    return k ? {h:{kind:'desk', id:k.id}, usedLoc:true} : r ? {h:{kind:'office', id:r.id}, usedLoc:true} : {h:{kind:'storage'}};
  }
  const p = db.people.find(p => norm(p.name) === norm(text) || (p.email && norm(p.email) === norm(text)));
  if (p) return {h:{kind:'person', id:p.id}};
  const k = findDeskByText(text); if (k) return {h:{kind:'desk', id:k.id}};
  const r = findRoomByText(text); if (r) return {h:{kind:'office', id:r.id}};
  if (imp.createPeople) return {newPerson:{name:text, email:email || ''}};
  return {h:{kind:'storage'}, unknown:text};
}
function planImport(){
  const seenSerial = new Set();
  return imp.rows.map(r => {
    const s = k => { const i = imp.map[k]; return i >= 0 ? String(r[i] ?? '').trim() : ''; };
    const raw = k => { const i = imp.map[k]; return i >= 0 ? r[i] : ''; };
    let mdl = s('model');
    const man = s('manufacturer');
    if (man && !norm(mdl).startsWith(norm(man))) mdl = (man + ' ' + mdl).trim();
    const type = resolveType(s('type'), mdl), arrived = toISO(raw('arrived'));
    let warrantyUntil = toISO(raw('warrantyUntil'));
    const months = parseInt(s('warrantyMonths'), 10);
    if (!warrantyUntil && months && arrived){ const d = new Date(arrived); d.setMonth(d.getMonth() + months); warrantyUntil = isoLocal(d); }
    const loc = s('location'), holder = resolveHolder(s('holder'), s('email'), loc);
    const svc = s('service') && db.services.find(x => norm(x.name) === norm(s('service')));
    const note = [s('note'), loc && !holder.usedLoc ? 'Location (import): ' + loc : '', holder.unknown ? 'Holder (import): ' + holder.unknown : '',
      s('service') && !svc ? 'Service (import, unknown): ' + s('service') : ''].filter(Boolean).join('\n');
    // a Serial Number is unique: one already in the system or earlier in the same file is skipped
    const dupSerial = s('serial') && (db.assets.find(a => a.serial && norm(a.serial) === norm(s('serial'))) || seenSerial.has(norm(s('serial'))));
    if (s('serial')) seenSerial.add(norm(s('serial')));
    // the target is one concrete office; a row may only confirm it, never redirect the asset somewhere else
    const errs = [], target = imp.officeId, rowOff = s('office'), rowC = s('country');
    if (rowOff){ const o = db.offices.find(x => norm(x.name) === norm(rowOff) || norm(x.code || '') === norm(rowOff)); if (!o) errs.push(`unknown office: ${rowOff}`); else if (target && o.id !== target) errs.push(`row says ${o.name}, target is ${officeLabel(target)}`); }
    if (rowC){ const c = db.countries.find(x => norm(x.name) === norm(rowC) || norm(x.code || '') === norm(rowC)); if (!c) errs.push(`unknown country: ${rowC}`); else if (target && c.id !== office(target).countryId) errs.push(`row says ${c.name}, target is ${officeCountry(target).name}`); }
    const hOff = holder.h && holderOffice(holder.h);
    if (hOff && target && hOff !== target) errs.push(`location belongs to ${officeLabel(hOff)}`);
    if (holder.h && holder.h.kind === 'person' && target && (office(person(holder.h.id).officeId) || {}).countryId !== office(target).countryId) errs.push(`${person(holder.h.id).name} works in another country`);
    let action = 'new';
    if (!mdl && !s('serial') && !s('legacy')) action = 'empty';
    else if (dupSerial) action = 'dup';
    else if (errs.length) action = 'error';
    return {errs, legacy:s('legacy'), type, model:mdl || 'Unknown model', serial:s('serial'), status:parseStatus(s('status')) || 'ok', holder, serviceId:svc ? svc.id : null,
      arrived, warrantyUntil, supplier:s('supplier'), orderNo:s('orderNo'), note, action, dupSerial};
  });
}
const planWhere = p => p.holder.newPerson ? `👤 ${p.holder.newPerson.name} (new person)` : holderText(p.holder.h) + (p.holder.unknown ? ` (unknown: ${p.holder.unknown})` : '');
const PLAN_LABEL = {new:'<span class="pill ok">New</span>', dup:'<span class="pill warn">Skip – S/N exists</span>', empty:'<span class="pill">Empty row</span>', error:'<span class="pill bad">Error – skip</span>'};
function runImport(){
  if (!imp.officeId){ alert('Choose a target Country and City / Office first.'); return; }
  if (!canAt('assets.import', imp.officeId)){ alert('You do not have import access for this office.'); return; }
  const plan = planImport(), people = new Map(), types = new Map();
  let created = 0, skipped = 0;
  for (const p of plan){
    if (p.action !== 'new'){ skipped++; continue; }
    let h = p.holder.h;
    if (p.holder.newPerson){
      const k = norm(p.holder.newPerson.name);
      let np = people.get(k);
      if (!np){ np = {id:uid(), name:p.holder.newPerson.name, email:p.holder.newPerson.email, serviceId:p.serviceId, roleId:null, mode:db.modes[0].id, status:'Active', tickets:[], officeId:imp.officeId, note:'Imported: ' + imp.fileName}; db.people.push(np); people.set(k, np); }
      h = {kind:'person', id:np.id};
    }
    let typeId = p.type.id;
    if (!typeId){
      const k = norm(p.type.newType);
      if (!types.has(k)){ const t = {id:uid(), name:p.type.newType, icon:'📦'}; db.types.push(t); types.set(k, t.id); }
      typeId = types.get(k);
    }
    let m = db.models.find(x => x.typeId === typeId && norm(x.name) === norm(p.model));
    if (!m){ m = {id:uid(), typeId, name:p.model, imageId:null}; db.models.push(m); }
    const a = {id:uid(), officeId:imp.officeId, tag:nextAssetId(), name:'', legacyTag:p.legacy, type:typeId, modelId:m.id, serial:p.serial, status:p.status, holder:{kind:'storage'}, placement:null,
      serviceId:p.serviceId, custom:{}, arrived:p.arrived, warrantyUntil:p.warrantyUntil, supplier:p.supplier, orderNo:p.orderNo, note:p.note, created:Date.now(), assignedAt:null};
    db.assets.push(a); log(a.id, `Imported (${imp.fileName}): ${a.tag} · ${modelName(a)}`, 'created'); created++;
    if (h.kind !== 'storage') setHolder(a, h);
  }
  save();
  alert(`Import finished.\n\nNew assets: ${created} (Asset IDs assigned automatically)\nSkipped: ${skipped}\nNew people: ${people.size}\nNew types: ${types.size}`);
  imp = null; location.hash = '#/assets';
}
function viewImport(){
  let body = '';
  if (imp){
    const plan = planImport(), cnt = k => plan.filter(p => p.action === k).length;
    const newPeople = new Set(plan.filter(p => p.action === 'new' && p.holder.newPerson).map(p => norm(p.holder.newPerson.name))).size;
    const newTypes = [...new Set(plan.filter(p => p.action === 'new' && p.type.newType).map(p => p.type.newType))];
    body = `
      <h2>2. Map the columns – ${esc(imp.fileName)} (${imp.rows.length} rows)</h2>
      <div class="card"><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:4px 16px">
        ${IMPORT_FIELDS.map(f => `<div><label class="f">${f.label}</label>${mapSelect(f, imp.headers, imp.map)}</div>`).join('')}</div>
        <label class="cb"><input type="checkbox" id="impPeople"${imp.createPeople ? ' checked' : ''}> Create new people for unknown names (otherwise the asset goes to stock and the name into the note)</label>
        <p class="muted" style="font-size:12px;margin:0">Asset IDs (HU……) are assigned automatically; the ID in the file is kept as Legacy ID.</p>
      </div>
      <h2>3. Target location</h2>
      <div class="card row" id="impTarget"><label class="muted">Country *</label><select id="impCountry">${sortHu(db.countries.filter(c => accessibleOffices().some(o => o.countryId === c.id)), c => c.name).map(c => `<option value="${c.id}"${c.id === imp.countryId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <label class="muted">City / Office *</label><select id="impOffice"><option value="">– choose an office –</option>${sortHu(accessibleOffices().filter(o => o.countryId === imp.countryId), o => o.name).map(o => `<option value="${o.id}"${o.id === imp.officeId ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
        ${imp.officeId ? '' : '<span class="pill warn">A concrete office is required</span>'}</div>
      <h2>4. Preview</h2>
      <p>${PLAN_LABEL.new} ${cnt('new')} &nbsp; ${cnt('error') ? `${PLAN_LABEL.error} ${cnt('error')} &nbsp; ` : ''}Skipped: ${cnt('dup') + cnt('empty')} &nbsp; · New people: ${newPeople}${newTypes.length ? ` · New types: ${newTypes.map(esc).join(', ')}` : ''}</p>
      <div class="tbl-wrap"><table><thead><tr><th>Action</th><th>Legacy ID</th><th>Type</th><th>Model</th><th>Serial Number</th><th>Status</th><th>Goes to</th><th>Arrived</th><th>Warranty</th><th>Problem</th></tr></thead><tbody>
        ${plan.slice(0, 50).map(p => `<tr><td>${PLAN_LABEL[p.action]}</td><td class="tag">${esc(p.legacy) || '<span class="muted">–</span>'}</td>
          <td>${p.type.id ? typeIcon(p.type.id) + ' ' + esc(typeLabel(p.type.id)) : '📦 ' + esc(p.type.newType) + ' <span class="pill warn">new type</span>'}</td>
          <td>${esc(p.model)}</td><td class="muted">${esc(p.serial)}</td><td>${statusPill(p.status)}</td><td>${imp.officeId ? `<b>${esc(officeLabel(imp.officeId))}</b> · ` : ''}${esc(planWhere(p))}</td><td>${fmtDate(p.arrived)}</td><td>${fmtDate(p.warrantyUntil)}</td><td style="color:var(--danger)">${esc(p.errs.join('; '))}</td></tr>`).join('')}
      </tbody></table></div>
      ${plan.length > 50 ? `<p class="muted">… and ${plan.length - 50} more rows.</p>` : ''}
      <div class="row" style="margin-top:14px"><button class="primary" id="impRun" onclick="runImport()"${cnt('new') && imp.officeId ? '' : ' disabled'}>⬆ Import (${cnt('new')} assets)</button>
        <button onclick="imp=null;render()">Cancel</button></div>`;
  }
  return `
    <div class="row"><a href="#/assets">← Assets</a></div>
    <h1 style="margin-top:8px">Import assets from Excel / CSV</h1>
    <div class="sub">For larger orders or moving from Snipe-IT. (People import: People → ⬆ Import.)</div>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">
      <div class="card"><b>📄 Excel template</b>
        <p class="muted">Download the template, enter the order items (one asset per row), then load it below. Asset IDs are assigned automatically.</p>
        <div class="row"><button class="primary" onclick="downloadTemplate()">⬇ Excel template (.xlsx)</button><button onclick="downloadCSVTemplate()">⬇ CSV template</button></div></div>
      <div class="card"><b>🔄 Moving from Snipe-IT</b>
        <ol class="muted" style="padding-left:18px;margin:8px 0 0">
          <li>Snipe-IT: <b>Assets → All</b>, columns: Asset Tag, Model, Manufacturer, Category, Serial, Status, Checked Out To, Location, Purchase Date, Warranty, Supplier, Order Number, Notes.</li>
          <li><b>Export</b> to CSV or Excel.</li>
          <li>Load it here – the Snipe-IT column names are recognized.</li>
        </ol></div>
    </div>
    <h2>1. Choose a file</h2>
    <div class="card row"><input type="file" id="impFile" accept=".xlsx,.xls,.csv,.txt"><span class="muted">Excel (.xlsx, .xls) or CSV (comma or semicolon separated)</span></div>
    ${body}`;
}
function bindImport(){
  $('#impFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) readImportFile(f); });
  if (!imp) return;
  document.querySelectorAll('[data-map]').forEach(s => s.addEventListener('change', () => { imp.map[s.dataset.map] = +s.value; render(); }));
  $('#impPeople').addEventListener('change', e => { imp.createPeople = e.target.checked; render(); });
  $('#impCountry').addEventListener('change', e => { imp.countryId = e.target.value; imp.officeId = ''; render(); });
  $('#impOffice').addEventListener('change', e => { imp.officeId = e.target.value; render(); });
}
const TEMPLATE_HEADERS = ['Legacy ID / sticker', 'Type*', 'Model', 'Serial Number', 'Status', 'Holder / location', 'Service', 'Order arrived', 'Warranty end', 'Warranty (months)', 'Supplier', 'Order / invoice number', 'Note'];
const TEMPLATE_EXAMPLES = [
  ['', 'Monitor', 'Dell P2422H', 'CN0ABC123', 'Working', '', '', '2026-10-20', '', 36, 'Example Supplier Ltd.', 'RND-2026-118', 'Goes to stock (Holder / location empty)'],
  ['', 'Computer', 'Lenovo ThinkPad T14 Gen 5', 'PF5ABC01', 'Working', 'Kiss Péter', 'Development', '2026-10-20', '2029-10-20', '', 'Example Supplier Ltd.', 'RND-2026-118', 'Assigned to a person'],
  ['', 'Headset', 'Jabra Evolve2 40', 'JB40-9001', 'Working', '2.12 / A3', '', '2026-10-20', '', 24, 'Example Supplier Ltd.', 'RND-2026-118', 'On a desk: Room / Desk'],
  ['', 'Dock', 'Lenovo USB-C Dock Gen2', 'DK-10001', 'Working', 'Office: 1.04 – Customer Support', '', '2026-10-20', '', 36, '', '', 'To the office pool'],
];
function buildTemplate(X){
  const wb = X.utils.book_new();
  const ws = X.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...TEMPLATE_EXAMPLES]);
  ws['!cols'] = [14, 14, 28, 16, 14, 26, 18, 16, 14, 14, 22, 22, 36].map(wch => ({wch}));
  X.utils.book_append_sheet(wb, ws, 'Assets');
  const g = X.utils.aoa_to_sheet([
    ['Column', 'What to enter'],
    ['Legacy ID / sticker', 'Optional. Asset IDs (HU000001…) are assigned automatically.'],
    ['Type*', 'Required. Current types: ' + db.types.map(t => t.name).join(', ') + '. An unknown type name creates a new type.'],
    ['Model', 'e.g. Dell P2422H – created if it does not exist.'],
    ['Status', 'Working / Faulty / In Repair / Missing / Lost / Retired. Empty: Working.'],
    ['Holder / location', 'Empty = In Stock. A person name or e-mail. Desk: “Room / Desk”, e.g. 2.12 / A1. Office pool: “Office: <room name>”.'],
    ['Service', 'Optional, the name of an existing Service.'],
    ['Warranty end / (months)', 'If the end is empty but months are set, it is calculated from the arrival date.'],
    [], ['Tip', 'Delete the example rows before importing. Keep the first row (header).'],
  ]);
  g['!cols'] = [{wch:24}, {wch:110}];
  X.utils.book_append_sheet(wb, g, 'Guide');
  return wb;
}
async function downloadTemplate(){
  try { const X = await loadXLSX(); X.writeFile(buildTemplate(X), 'tc-itam-asset-import-template.xlsx'); }
  catch(e){ alert(e.message + '\nDownloading the CSV template instead.'); downloadCSVTemplate(); }
}
function downloadCSVTemplate(){ download('tc-itam-asset-import-template.csv', '﻿' + [TEMPLATE_HEADERS, ...TEMPLATE_EXAMPLES].map(csvLine).join('\r\n'), 'text/csv'); }
