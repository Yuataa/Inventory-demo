'use strict';
/* Dashboard, asset list and views, asset page and form, assignment and return flows, swap, asset import */

// ---------- filtering (shared by the list and the dashboard, so the counts always match) ----------
function filterAssets(P){
  const f = k => P.get(k) || '';
  let list = db.assets;
  const v = ASSET_VIEWS[f('view')];
  if (v) list = list.filter(v.test);
  if (f('type')) list = list.filter(a => a.type === f('type'));
  if (f('model')) list = list.filter(a => a.modelId === f('model'));
  if (f('loc')) list = list.filter(a => a.holder.kind === f('loc'));
  if (f('status')) list = list.filter(a => a.status === f('status'));
  if (f('service')) list = list.filter(a => assetServiceIs(a, f('service')));
  if (f('office')) list = list.filter(a => assetOfficeId(a) === f('office'));
  if (f('room')) list = list.filter(a => assetRoomId(a) === f('room'));
  if (f('person')) list = list.filter(a => a.holder.kind === 'person' && a.holder.id === f('person'));
  if (f('mode')) list = list.filter(a => (assetPerson(a) || {}).mode === f('mode'));
  if (f('health') === 'faulty') list = list.filter(isFaulty);
  if (f('health') === 'aged') list = list.filter(isAged);
  if (f('health') === 'both') list = list.filter(a => isFaulty(a) && isAged(a));
  if (f('age')) list = list.filter(a => (ageYears(a) ?? -1) >= +f('age'));
  if (f('warr')) list = list.filter(a => { const w = warranty(a), x = f('warr'); return x === 'none' ? w.days === null : x === 'bad' ? w.days !== null && w.days < 0 : w.days !== null && w.days >= 0 && w.days <= 60; });
  if (f('q')){ const n = norm(f('q')); list = list.filter(a => norm([a.tag, a.legacyTag, a.name, modelName(a), a.serial, a.note, a.supplier, a.orderNo, whereText(a), Object.values(a.custom || {}).join(' ')].join(' ')).includes(n)); }
  return list;
}
function typeBreak(list, query){
  const chips = sortHu(db.types.map(t => [t, list.filter(a => a.type === t.id).length]).filter(x => x[1]), x => x[0].name);
  const base = query ? query + '&' : '';
  return `<div class="tbreak">${chips.map(([t, n]) => `<a class="tchip" href="#/assets?${base}type=${encodeURIComponent(t.id)}" title="Show ${esc(t.name)}">${t.icon} <b>${n}</b> <span>${esc(t.name)}</span></a>`).join('') || '<span class="muted">No assets</span>'}</div>`;
}

// ---------- dashboard ----------
function tileQuery(id){
  const d = db.settings.dashboard.defaults, p = new URLSearchParams();
  const set = (k, v) => { if (v) p.set(k, v); };
  if (id !== 'total') p.set('view', id);
  if (id === 'office') set('room', d.officeRoom);
  if (id === 'assigned'){ set('mode', d.assignedMode); set('service', d.assignedService); }
  if (id === 'storage') set('type', d.storageType);
  if (id === 'health') set('health', d.healthCat);
  return p;
}
function dashTile(it){
  const tile = (href, n, sub = '', extra = '') => `<div class="card tile ${it.size}" data-tile="${it.id}"><a class="tmain" href="${href}"><span class="n">${n}</span><span class="l">${esc(DASH_ITEMS[it.id])} ›</span></a>${sub}${extra}</div>`;
  if (DASH_BREAKDOWN.includes(it.id)){
    const P = tileQuery(it.id), list = filterAssets(P), qs = P.toString();
    let sub = '';
    if (it.id === 'storage') sub = `<small class="muted">${list.filter(a => a.status === 'ok').length} working and available</small>`;
    if (it.id === 'health') sub = `<div class="tsplit">
      <a href="#/assets?view=health&health=faulty">Faulty <b>${list.filter(isFaulty).length}</b></a>
      <a href="#/assets?view=health&health=aged">Aged <b>${list.filter(isAged).length}</b></a>
      <a href="#/assets?view=health&health=both">Both <b>${list.filter(a => isFaulty(a) && isAged(a)).length}</b></a></div>`;
    return tile('#/assets' + (qs ? '?' + qs : ''), list.length, sub, it.breakdown ? typeBreak(list, qs) : '');
  }
  if (it.id === 'returns') return tile('#/assets?view=awaiting', db.returns.filter(r => r.state === 'awaiting').length);
  if (it.id === 'transit') return tile('#/assets?view=transit', db.assets.filter(a => a.holder.kind === 'transit').length);
  if (it.id === 'projects') return tile('#/projects?status=active', db.projects.filter(isActive).length);
  if (it.id === 'unsigned') return tile('#/docs?f=wait', db.docs.filter(d => !d.fileId).length);
  return tile('#/docs', db.people.reduce((n, p) => n + uncovered(p.id).length, 0));
}
function dashSection(id){
  if (id === 'warranty'){
    const list = sortHu(db.assets.filter(a => { const w = warranty(a); return w.days !== null && w.days <= 60 && a.status !== 'retired'; }), a => a.warrantyUntil);
    return list.length ? `<h2>⚠️ Warranty expired or expiring within 60 days (${list.length})</h2>${assetRows(list)}` : '';
  }
  if (id === 'models'){
    const list = db.models.map(m => [m, db.assets.filter(a => a.modelId === m.id).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 10);
    return `<h2>Top models</h2>` + (list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Model</th><th>Type</th><th>Count</th></tr></thead><tbody>${list.map(([m, n]) =>
      `<tr><td><a href="#/assets?model=${m.id}">${esc(m.name)}</a></td><td><a href="#/assets?type=${encodeURIComponent(m.typeId)}">${typeIcon(m.typeId)} ${esc(typeLabel(m.typeId))}</a></td><td><a href="#/assets?model=${m.id}"><b>${n}</b></a></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">–</div>');
  }
  if (id === 'services') return `<h2>By Service</h2><div class="grid">${sortHu(db.services, s => s.name).map(s => { const ppl = db.people.filter(p => p.serviceId === s.id);
    return `<a class="card stat" href="#/people?service=${s.id}"><div class="n">${ppl.length}</div><div class="l">🧩 ${esc(s.name)} · ${db.modes.map(m => `${m.icon}${ppl.filter(p => p.mode === m.id).length}`).join(' ')}</div></a>`; }).join('') || '<div class="empty">No Services yet – create them in Settings.</div>'}</div>`;
  if (id === 'remote'){
    const list = sortHu(db.people.filter(p => modeBehavior(p.mode) !== 'onsite'), p => p.name);
    return `<h2>WFH / Hybrid people</h2>` + (list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Service</th><th>Work Mode</th><th>Assets</th></tr></thead><tbody>${list.map(p =>
      `<tr><td>${personLink(p.id)}</td><td>${esc(serviceName(p.serviceId))}</td><td>${modePill(p.mode)}</td><td>${personAssets(p.id).direct.map(a => `<a class="chip" href="#/asset/${a.id}">${typeIcon(a.type)} ${esc(a.tag)}</a>`).join(' ') || '<span class="muted">–</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nobody in these modes.</div>');
  }
  return `<h2>Recent events</h2>${logTable(db.log.slice(0, 8))}`;
}
function viewDashboard(){
  const items = db.settings.dashboard.items.filter(i => i.visible);
  return `<div class="row"><h1>Overview</h1><span class="spacer"></span><a class="btn sm" href="#/settings/dashboard">⚙ Customize</a></div>
    <div class="sub">The state of all IT assets at a glance. Click a number to open the filtered list.</div>
    <div class="dash">${items.filter(i => !DASH_SECTIONS.includes(i.id)).map(dashTile).join('')}</div>
    ${items.filter(i => DASH_SECTIONS.includes(i.id)).map(i => dashSection(i.id)).join('')}`;
}

// ---------- asset list ----------
const LOC_LABEL = {desk:'🪑 On a desk / in a rack', office:'🏢 In a room pool', site:'🏢 At an office, not placed', transit:'🚚 In transit', person:'👤 Assigned to a person', storage:'📦 In Stock'};
function viewAssets(params){
  const f = k => params.get(k) || '';
  const list = sortHu(filterAssets(params), a => a.tag), V = ASSET_VIEWS[f('view')], type = f('type'), mdl = f('model');
  const filtered = [...params.keys()].length > 0;
  const models = sortHu(db.models.filter(m => !type || m.typeId === type), m => m.name);
  const title = V ? V.title : mdl && model(mdl) ? model(mdl).name : type ? typeLabel(type) : 'Assets';
  const opt = (v, cur, l) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${l}</option>`;
  const q = new URLSearchParams(params); q.delete('type'); q.delete('model');
  return `
    <div class="row"><h1>${!V && type ? typeIcon(type) + ' ' : ''}${esc(title)}</h1><span class="spacer"></span>
      <button onclick="exportCSV()">⬇ CSV</button>
      <a class="btn" href="#/import">⬆ Import (Excel / Snipe-IT)</a>
      <button class="primary" onclick="assetForm(null, null, '${esc(type)}')">+ New asset</button></div>
    <div class="sub">${list.length} of ${db.assets.length} assets${filtered ? ' · <a href="#/assets">clear filters</a>' : ''}</div>
    ${V ? typeBreak(filterAssets(q), q.toString()) : ''}
    <div class="row filters" style="margin-bottom:12px">
      <input id="fq" placeholder="Filter: Asset ID, name, S/N, model…" value="${esc(f('q'))}" style="min-width:220px">
      <select id="fview" title="View"><option value="">All assets</option>${Object.entries(ASSET_VIEWS).map(([k, x]) => opt(k, f('view'), x.title)).join('')}</select>
      <select id="ftype" title="Asset Type"><option value="">All types</option>${sortHu(db.types, t => t.name).map(t => opt(t.id, type, `${t.icon} ${esc(t.name)}`)).join('')}</select>
      <select id="fmodel" title="Model"><option value="">All models</option>${models.map(m => opt(m.id, mdl, esc(m.name))).join('')}</select>
      <select id="foffice" title="Office"><option value="">All Offices</option>${sortHu(db.offices, o => o.name).map(o => opt(o.id, f('office'), esc(o.name))).join('')}</select>
      <select id="froom" title="Room"><option value="">All Rooms</option>${sortHu(db.rooms.filter(r => !f('office') || r.officeId === f('office')), r => roomPath(r)).map(r => opt(r.id, f('room'), esc(roomPath(r)))).join('')}</select>
      <select id="fperson" title="Employee"><option value="">All employees</option>${sortHu(db.people, p => p.name).map(p => opt(p.id, f('person'), esc(p.name))).join('')}</select>
      <select id="fsvc" title="Service"><option value="">All Services</option>${sortHu(db.services, s => s.name).map(s => opt(s.id, f('service'), esc(s.name))).join('')}</select>
      <select id="fmode" title="Work Mode"><option value="">All Work Modes</option>${db.modes.map(m => opt(m.id, f('mode'), `${m.icon} ${esc(m.name)}`)).join('')}</select>
      <select id="floc" title="Location"><option value="">Anywhere</option>${Object.entries(LOC_LABEL).map(([k, v]) => opt(k, f('loc'), v)).join('')}</select>
      <select id="fstatus" title="Status"><option value="">All statuses</option>${Object.entries(STATUS).map(([k, s]) => opt(k, f('status'), s.label)).join('')}</select>
      <select id="fwarr" title="Warranty"><option value="">Warranty: all</option>${opt('soon', f('warr'), 'Expires within 60 days')}${opt('bad', f('warr'), 'Expired')}${opt('none', f('warr'), 'Not set')}</select>
      ${f('view') === 'health' ? `<select id="fhealth" title="Category"><option value="">Faulty or Aged</option>${opt('faulty', f('health'), 'Faulty')}${opt('aged', f('health'), 'Aged')}${opt('both', f('health'), 'Faulty and Aged')}</select>
      <select id="fage" title="Minimum age"><option value="">Any age</option>${[3, 4, 5, 6, 7, 8, 10].map(y => opt(String(y), f('age'), `${y}+ years`)).join('')}</select>` : ''}
    </div>
    <div class="bulkbar" id="bulkbar" hidden>
      <b>✔ <span class="bulkCount">0</span> selected</b>
      <div class="picker" style="flex-direction:row;align-items:center;flex-wrap:wrap">${holderFilters()}<input type="search" class="pick-q" placeholder="To whom / where? (search)" style="width:170px">
        <select id="bulkHolder" class="pick-list" style="max-width:280px"><option value="">– To whom / where? –</option>${holderOptions('')}</select></div>
      <button class="primary" onclick="bulkMove($('#bulkHolder').value)">Assign</button>
      <button onclick="bulkMove('storage')">📦 Return to Stock</button>
      <button onclick="labelDialog([...selected])">🏷 Print labels</button>
      <select id="bulkStatus"><option value="">Status…</option>${Object.entries(STATUS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('')}</select>
      <button onclick="bulkStatus()">Set</button>
      <span class="spacer"></span><button class="sm" onclick="selected.clear(); render()">✕ Clear selection</button>
    </div>
    ${assetRows(list, {select:true})}`;
}
function bindAssetFilters(){
  const ids = {q:'#fq', view:'#fview', type:'#ftype', model:'#fmodel', office:'#foffice', room:'#froom', person:'#fperson', service:'#fsvc', mode:'#fmode', loc:'#floc', status:'#fstatus', warr:'#fwarr', health:'#fhealth', age:'#fage'};
  const upd = () => {
    const p = new URLSearchParams();
    for (const [k, sel] of Object.entries(ids)) if ($(sel) && $(sel).value) p.set(k, $(sel).value);
    if (p.get('room') && p.get('office') && (room(p.get('room')) || {}).officeId !== p.get('office')) p.delete('room');
    // a model that does not belong to the newly chosen type is dropped
    if (p.get('model') && p.get('type') && (model(p.get('model')) || {}).typeId !== p.get('type')) p.delete('model');
    history.replaceState(null, '', '#/assets' + (p.toString() ? '?' + p : ''));
    const pos = $('#fq').selectionStart; render(); $('#fq').focus(); $('#fq').setSelectionRange(pos, pos);
  };
  $('#fq').addEventListener('input', upd);
  for (const s of Object.values(ids).slice(1)) if ($(s)) $(s).addEventListener('change', upd);
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
function bulkStatus(){
  const s = $('#bulkStatus').value;
  if (!s){ alert('Choose a status.'); return; }
  for (const a of [...selected].map(asset).filter(Boolean)) if (a.status !== s){ log(a.id, `Status: ${STATUS[a.status].label} → ${STATUS[s].label}`, 'updated'); a.status = s; }
  selected.clear(); save(); render();
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
    <div class="two"><div><label class="f">Return to</label><select name="target"><option value="storage">📦 In Stock</option>${sortHu(db.offices, o => o.name).map(o => `<option value="site:${o.id}">🏢 ${esc(o.name)}</option>`).join('')}${sortHu(db.rooms, r => roomPath(r)).map(r => `<option value="office:${r.id}">🏢 ${esc(roomPath(r))}</option>`).join('')}</select></div>
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
async function quickMove(id){
  const a = asset(id), hs = $('#moveSel').value;
  if (!hs){ alert('Choose a target from the list.'); return; }
  const h = parseHolder(hs);
  if (holderKey(h) === holderKey(a.holder)){ toast('The asset is already there.'); return; }
  if (!await confirmMove([a], h)) return;
  setHolder(a, h); save(); render();
}
function deleteAsset(id){
  const a = asset(id);
  if (!confirm(`Delete ${a.tag}?\nThe Asset ID will not be reused. (To scrap an asset, set its status to “Retired” instead.)`)) return;
  for (const pr of db.projects){
    for (const x of pr.participants){
      if (x.computerId === id) x.computerId = null; if (x.monitorId === id) x.monitorId = null; if (x.monitor2Id === id) x.monitor2Id = null;
      x.otherIds = x.otherIds.filter(o => o !== id);
    }
    for (const l of pr.demand) l.assetIds = l.assetIds.filter(o => o !== id);
  }
  for (const r of db.returns) if (r.assetId === id && r.state === 'awaiting') r.state = 'cancelled';
  log(id, `Deleted: ${a.tag} (${modelName(a)})`, 'updated');
  db.assets = db.assets.filter(x => x.id !== id); save(); location.hash = '#/assets';
}

// ---------- asset page ----------
function viewAsset(id){
  const a = asset(id);
  if (!a) return `<div class="empty">Asset not found.</div>`;
  const hist = db.log.filter(l => l.assetId === id);
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
    <div class="row" style="margin-bottom:16px;align-items:flex-start">
      <span class="muted" style="padding-top:8px">Quick Move:</span>
      <div style="min-width:320px;flex:0 1 460px">${picker('move', holderOptions(holderKey(a.holder)), {id:'moveSel', size:6, filters:true})}</div>
      <button class="primary" onclick="quickMove('${a.id}')">Move</button>
    </div>
    <div class="asset-head">
      ${img ? `<img class="photo" src="${img}" alt="${esc(modelName(a))}">` : `<div class="photo none" title="No image – upload one when editing">${typeIcon(a.type)}</div>`}
      <div class="card"><dl class="kv">
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
    <h2>History</h2>
    ${logTable(hist, {noSubject:true})}`;
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
function assetForm(a, presetHolder, presetType){
  const isNew = !a;
  const t0 = presetType && db.types.some(t => t.id === presetType) ? presetType : 'monitor';
  a = a || {type:t0, name:'', modelId:'', serial:'', status:'ok', holder:presetHolder || {kind:'storage'}, serviceId:null, custom:{}, note:'',
    arrived:todayIso(), warrantyUntil:'', supplier:'', orderNo:'', legacyTag:''};
  const preview = fmtAssetId(Math.max(db.seq.asset || 0, ...db.assets.map(x => assetNum(x.tag)), 0) + 1);
  const curImg = assetImg(a);
  let pendingImg = null, custom = {...a.custom}, curType = a.type;
  openDialog(`
    <h3>${isNew ? 'New asset' : 'Edit asset'}</h3>
    <div class="two">
      <div><label class="f">Asset ID</label><input value="${isNew ? preview + ' (automatic)' : esc(a.tag)}" disabled class="aid"></div>
      <div><label class="f">Legacy ID / sticker (optional)</label><input name="legacyTag" value="${esc(a.legacyTag || '')}"></div>
      <div><label class="f">Asset Type</label><select name="type" id="fType">${sortHu(db.types, t => t.name).map(t => `<option value="${esc(t.id)}"${t.id === a.type ? ' selected' : ''}>${t.icon} ${esc(t.name)}</option>`).join('')}</select></div>
      <div><label class="f">Model</label><select name="modelId" id="fModel">${modelOptions(a.type, a.modelId)}</select>
        <input name="newModel" id="fNewModel" placeholder="New model name, e.g. Dell P2422H" style="display:none;margin-top:4px"></div>
      <div><label class="f" id="fNameLbl">Asset Name</label><input name="name" id="fName" value="${esc(a.name || '')}"></div>
      <div><label class="f">Serial Number</label><input name="serial" value="${esc(a.serial)}"></div>
      <div><label class="f">Status</label><select name="status">${Object.entries(STATUS).map(([k, s]) => `<option value="${k}"${k === a.status ? ' selected' : ''}>${s.label}</option>`).join('')}</select></div>
      <div><label class="f">Service (optional)</label><select name="serviceId">${selOpts(sortHu(db.services, s => s.name), a.serviceId, s => s.name, '–')}</select></div>
    </div>
    <label class="f">Location / assigned to</label>
    ${picker('holder', holderOptions(holderKey(a.holder)), {size:5, filters:true})}
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
      if (t.nameUnique && name && db.assets.some(x => x.id !== a.id && x.type === data.type && norm(x.name) === norm(name))){ alert(`Asset Name “${name}” is already used by another ${t.name}.`); return false; }
      const fields = {type:data.type, name, modelId, serial:data.serial.trim(), status:data.status, serviceId:data.serviceId || null, note:data.note,
        arrived:data.arrived, warrantyUntil:data.warrantyUntil, supplier:data.supplier.trim(), orderNo:data.orderNo.trim(), legacyTag:data.legacyTag.trim(), custom:newCustom};
      if (fields.serial && db.assets.some(x => x.id !== a.id && x.serial && norm(x.serial) === norm(fields.serial)) &&
        !confirm(`An asset with serial number ${fields.serial} already exists. Save anyway?`)) return false;
      let target = a;
      if (isNew){
        target = {id:uid(), tag:nextAssetId(), ...fields, holder:parseHolder(data.holder), placement:null, created:Date.now(), assignedAt:null};
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
  const cands = sortHu(db.assets.filter(a => holderKey(a.holder) !== key && a.status !== 'retired' && a.holder.kind !== 'transit'), a => (a.holder.kind === 'storage' ? '0' : '1') + a.tag);
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
  const cands = sortHu(db.assets.filter(a => a.holder.kind === 'storage' && a.status === 'ok' && !reservedBy(a.id)), a => (a.type === old.type ? '0' : '1') + a.tag);
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
    <label class="f">Fault description / note</label><textarea name="note" style="width:100%" placeholder="e.g. does not power on, striped image"></textarea>
    <label class="f">Replacement asset (working, in stock)</label>
    <label class="cb" style="margin:4px 0"><input type="checkbox" id="swSame"${hasSame ? ' checked' : ''}> Same type only (${esc(typeLabel(old.type))})</label>
    <select name="newId" id="swSel" size="7" required style="width:100%">${cands.map(a =>
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
      const where = whereText(old), h = old.holder, place = old.placement, reason = SWAP_REASONS[data.reason];
      setHolder(nw, h);
      if (place) nw.placement = {...place};
      setHolder(old, {kind:'storage'});
      if (old.status !== data.oldStatus){ log(old.id, `Status: ${STATUS[old.status].label} → ${STATUS[data.oldStatus].label}`, 'updated'); old.status = data.oldStatus; }
      log(old.id, `🔁 Replaced by ${nw.tag} – ${reason}${data.note.trim() ? ': ' + data.note.trim() : ''}`, 'returned');
      log(nw.id, `🔁 Checked out as replacement for ${old.tag} (${where})`, 'checkout');
      const sw = {id:uid(), ts:Date.now(), date:data.date, oldId:old.id, newId:nw.id, oldTag:old.tag, newTag:nw.tag,
        reason, note:data.note.trim(), oldStatus:data.oldStatus, where, personId:owner, docId:null};
      db.swaps.unshift(sw);
      let doc = null;
      if (owner && data.mkdoc){
        doc = createDoc(owner, 'swap', [], {date:data.date, handler:data.handler.trim(), note:data.note.trim(), reason,
          items:[{...snapAsset(nw), role:'out'}, {...snapAsset(old), role:'in'}], swapId:sw.id});
        sw.docId = doc.id;
      }
      save(); render();
      if (doc) printDoc(doc.id);
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
      <td>${esc(s.reason)}${s.note ? `<br><small class="muted">${esc(s.note)}</small>` : ''}</td>
      <td>${o ? statusPill(o.status) + `<br><small class="muted">${esc(whereText(o))}</small>` : '<span class="muted">deleted</span>'}</td>
      <td>${d ? `<span class="tag">${esc(d.no)}</span> ${d.fileId ? '<span class="pill ok">✔</span>' : '<span class="pill warn">awaiting signature</span>'}` : '<span class="muted">–</span>'}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

// ---------- CSV export ----------
function exportCSV(){
  const fsFields = db.fieldSets.flatMap(s => s.fields.filter(f => f.active).map(f => ({...f, setName:s.name})));
  const rows = [['Asset ID', 'Asset Name', 'Legacy ID', 'Type', 'Model', 'Serial Number', 'Status', 'Location type', 'Location', 'On desk (Hybrid)', 'Person', 'Service',
    'Arrived', 'Warranty end', 'Supplier', 'Order/invoice', 'Note', ...fsFields.map(f => `${f.setName}: ${f.name}`)]];
  for (const a of sortHu(db.assets, a => a.tag)){
    const who = holderPerson(a.holder);
    rows.push([a.tag, assetName(a), a.legacyTag, typeLabel(a.type), modelName(a), a.serial, STATUS[a.status].label, LOC_LABEL[a.holder.kind].replace(/^\S+\s/, ''),
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
  if (/javit|repair|broken|hibas/.test(n)) return 'repair';
  if (/lost|stolen|elvesz|lopott/.test(n)) return 'lost';
  if (/archiv|retire|selejt|dispos/.test(n)) return 'retired';
  return 'ok';
}
let imp = null;
async function readImportFile(file){
  try {
    const t = await readTable(file, 'Assets');
    imp = {fileName:file.name, headers:t.headers, rows:t.rows, map:guessColumns(t.headers, IMPORT_FIELDS), createPeople:true};
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
    const dupSerial = s('serial') && db.assets.find(a => a.serial && norm(a.serial) === norm(s('serial')));
    let action = 'new';
    if (!mdl && !s('serial') && !s('legacy')) action = 'empty';
    else if (dupSerial) action = 'dup';
    return {legacy:s('legacy'), type, model:mdl || 'Unknown model', serial:s('serial'), status:parseStatus(s('status')) || 'ok', holder, serviceId:svc ? svc.id : null,
      arrived, warrantyUntil, supplier:s('supplier'), orderNo:s('orderNo'), note, action, dupSerial};
  });
}
const planWhere = p => p.holder.newPerson ? `👤 ${p.holder.newPerson.name} (new person)` : holderText(p.holder.h) + (p.holder.unknown ? ` (unknown: ${p.holder.unknown})` : '');
const PLAN_LABEL = {new:'<span class="pill ok">New</span>', dup:'<span class="pill warn">Skip – S/N exists</span>', empty:'<span class="pill">Empty row</span>'};
function runImport(){
  const plan = planImport(), people = new Map(), types = new Map();
  let created = 0, skipped = 0;
  for (const p of plan){
    if (p.action !== 'new'){ skipped++; continue; }
    let h = p.holder.h;
    if (p.holder.newPerson){
      const k = norm(p.holder.newPerson.name);
      let np = people.get(k);
      if (!np){ np = {id:uid(), name:p.holder.newPerson.name, email:p.holder.newPerson.email, serviceId:p.serviceId, roleId:null, mode:db.modes[0].id, status:'Active', tickets:[], note:'Imported: ' + imp.fileName}; db.people.push(np); people.set(k, np); }
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
    const a = {id:uid(), tag:nextAssetId(), name:'', legacyTag:p.legacy, type:typeId, modelId:m.id, serial:p.serial, status:p.status, holder:{kind:'storage'}, placement:null,
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
      <h2>3. Preview</h2>
      <p>${PLAN_LABEL.new} ${cnt('new')} &nbsp; Skipped: ${cnt('dup') + cnt('empty')} &nbsp; · New people: ${newPeople}${newTypes.length ? ` · New types: ${newTypes.map(esc).join(', ')}` : ''}</p>
      <div class="tbl-wrap"><table><thead><tr><th>Action</th><th>Legacy ID</th><th>Type</th><th>Model</th><th>Serial Number</th><th>Status</th><th>Goes to</th><th>Arrived</th><th>Warranty</th></tr></thead><tbody>
        ${plan.slice(0, 50).map(p => `<tr><td>${PLAN_LABEL[p.action]}</td><td class="tag">${esc(p.legacy) || '<span class="muted">–</span>'}</td>
          <td>${p.type.id ? typeIcon(p.type.id) + ' ' + esc(typeLabel(p.type.id)) : '📦 ' + esc(p.type.newType) + ' <span class="pill warn">new type</span>'}</td>
          <td>${esc(p.model)}</td><td class="muted">${esc(p.serial)}</td><td>${statusPill(p.status)}</td><td>${esc(planWhere(p))}</td><td>${fmtDate(p.arrived)}</td><td>${fmtDate(p.warrantyUntil)}</td></tr>`).join('')}
      </tbody></table></div>
      ${plan.length > 50 ? `<p class="muted">… and ${plan.length - 50} more rows.</p>` : ''}
      <div class="row" style="margin-top:14px"><button class="primary" id="impRun" onclick="runImport()"${cnt('new') ? '' : ' disabled'}>⬆ Import (${cnt('new')} assets)</button>
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
    ['Status', 'Working / Faulty / In Repair / Lost / Retired. Empty: Working.'],
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
