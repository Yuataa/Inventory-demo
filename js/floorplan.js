'use strict';
/* Floorplan per office. View mode (read only) and edit mode (Save / Cancel).
   While editing, changes stay in memory (fp.editing); Save stores them and Cancel reloads the saved state.
   The floorplan neither creates nor checks out assets: only office and Hybrid assets can be dragged onto a desk. */

function curOffice(params){
  const q = params && params.get('office');
  if (q && accessibleOffices().some(o => o.id === q)){ Object.assign(scope, {countryId:office(q).countryId, officeId:q}); saveScope(); }
  const ids = scopeOfficeIds();
  return office(scope.officeId) || sortHu(db.offices.filter(o => ids.includes(o.id)), o => o.name)[0];
}
function viewRooms(params){
  const o = curOffice(params), rooms = sortHu(officeRooms(o.id), r => r.name), pool = sortHu(sitePool(o.id), a => a.tag);
  return `
    <div class="row"><h1>Floorplan</h1><span class="spacer"></span>
      ${rooms.length ? `<button onclick="printFloorplan('${o.id}')" title="Every room of this office">🖨 Print</button><button onclick="exportFloorplanXlsx('${o.id}')" title="Every room of this office">⬇ Export to Excel</button>` : ''}
      <button class="primary" onclick="roomForm()">+ New room</button></div>
    <div class="officebar"><label class="muted">Office</label><select id="fpOffice">${sortHu(accessibleOffices().filter(x => x.countryId === o.countryId), x => x.name).map(x => `<option value="${x.id}"${x.id === o.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <button class="sm" onclick="countryForm()">+ New country</button><button class="sm" onclick="countryForm(country('${o.countryId}'))">✎ Edit country</button><button class="sm danger" onclick="deleteCountry('${o.countryId}')">Delete country</button>
      <button class="sm" onclick="officeForm()">+ New office</button><button class="sm" onclick="officeForm(office('${o.id}'))">✎ Edit office</button><button class="sm danger" onclick="deleteOffice('${o.id}')">Delete office</button>
      <span class="muted">${rooms.length} rooms · ID ${esc(o.code || o.id)}</span></div>
    ${rooms.length ? `<div class="grid room-cards">${rooms.map(r => {
      const os = roomObjs(r.id), ks = os.filter(x => x.kind === 'desk'), rk = os.filter(x => x.kind === 'rack');
      const n = db.assets.filter(a => assetRoomId(a) === r.id).length;
      return `<div class="card" onclick="location.hash='#/room/${r.id}'">
        <b>${esc(r.name)}</b><div class="muted">${ROOM_KINDS[r.kind] || ''} · ${esc(r.floor)}</div>
        <div class="muted">${[ks.length && ks.length + ' desks', rk.length && rk.length + ' racks', n + ' assets', officePool(r.id).length && officePool(r.id).length + ' in the pool'].filter(Boolean).join(' · ')}</div>
        <div class="muted" style="font-size:12px">🧩 ${r.serviceIds.map(serviceName).filter(Boolean).map(esc).join(', ') || 'no Service linked'}</div>
        <div class="mini-map">${os.map(k => `<div class="${k.kind}" style="left:${k.x / r.w * 100}%;top:${k.y / r.h * 100}%;width:${k.w / r.w * 100}%;height:${k.h / r.h * 100}%"></div>`).join('')}</div>
      </div>`;
    }).join('')}</div>` : '<div class="empty">This office has no rooms yet.</div>'}
    <h2>📦 At this office, not placed yet (${pool.length})</h2>
    ${pool.length ? `<div class="card" id="sitePool">${pool.map(a => `<div class="siteitem">${assetIcon(a)} ${aidLink(a)} <span>${esc(assetName(a))}</span><span class="spacer"></span>
      <select onchange="placeFromSite('${a.id}',this.value)"${can('floorplan.edit') ? '' : ' disabled'}><option value="">Move to room…</option>${rooms.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></div>`).join('')}</div>`
      : '<div class="empty">Received assets appear here until they are moved to a room.</div>'}`;
}
function bindRooms(){ $('#fpOffice').addEventListener('change', e => { location.hash = '#/rooms?office=' + e.target.value; }); }
function placeFromSite(id, roomId){
  const a = asset(id);
  if (!roomId || a.holder.kind !== 'site' || (room(roomId) || {}).officeId !== a.holder.id) return;
  setHolder(a, {kind:'office', id:roomId}); save(); render();
}
function countryForm(c){
  const isNew = !c; c = c || {name:'', code:''};
  openDialog(`<h3>${isNew ? 'New country' : 'Edit country'}</h3><div class="two"><div><label class="f">Country name</label><input name="name" required value="${esc(c.name)}" placeholder="e.g. Poland"></div>
    <div><label class="f">Code</label><input name="code" required value="${esc(c.code)}" placeholder="e.g. PL"></div></div>${dlgActions(isNew ? 'Create' : 'Save')}`,
    data => {
      const name = data.name.trim();
      if (db.countries.some(x => x !== c && norm(x.name) === norm(name))){ alert('A country with this name already exists.'); return false; }
      clog(`Country ${isNew ? 'created' : 'updated'}: ${name}`);
      if (isNew) db.countries.push({id:uid(), name, code:data.code.trim().toUpperCase()}); else Object.assign(c, {name, code:data.code.trim().toUpperCase()});
      save(); render();
    });
}
function deleteCountry(id){
  const c = country(id), n = db.offices.filter(o => o.countryId === id).length;
  if (n){ alert(`${c.name} still has ${n} office(s). Delete or move them first.`); return; }
  if (db.countries.length < 2){ alert('The last country cannot be deleted.'); return; }
  if (!confirm(`Delete ${c.name}?`)) return;
  clog(`Country deleted: ${c.name}`); db.countries = db.countries.filter(x => x !== c); save(); render();
}
function officeForm(o){
  const isNew = !o; o = o || {name:'', code:'', countryId:scope.countryId};
  openDialog(`<h3>${isNew ? 'New office' : 'Edit office'}</h3>
    ${isNew ? `<label class="f">Country</label><select name="countryId">${sortHu(db.countries, c => c.name).map(c => `<option value="${c.id}"${c.id === o.countryId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : `<p class="muted">Country: ${esc((country(o.countryId) || {}).name || '–')}</p>`}
    <div class="two"><div><label class="f">Office Name</label><input name="name" required value="${esc(o.name)}" placeholder="e.g. Debrecen Office"></div>
    <div><label class="f">Office ID (unique)</label><input name="code" required value="${esc(o.code)}" placeholder="e.g. DEB"></div></div>${dlgActions(isNew ? 'Create' : 'Save')}`,
    data => {
      const name = data.name.trim(), code = data.code.trim().toUpperCase();
      if (db.offices.some(x => x !== o && norm(x.name) === norm(name))){ alert('An office with this name already exists.'); return false; }
      if (db.offices.some(x => x !== o && norm(x.code) === norm(code))){ alert('This Office ID is already used.'); return false; }
      clog(`Office ${isNew ? 'created' : 'updated'}: ${name}`);
      if (isNew){ const n = {id:uid(), name, code, countryId:data.countryId}; db.offices.push(n); save(); location.hash = '#/rooms?office=' + n.id; }
      else { Object.assign(o, {name, code}); save(); render(); }
    });
}
// an office only goes when nothing depends on it, so no room, asset or shipment is lost silently
function deleteOffice(id){
  const o = office(id), rooms = officeRooms(id), site = db.assets.filter(a => a.officeId === id), ppl = db.people.filter(p => p.officeId === id);
  const ships = db.projects.flatMap(pr => pr.shipments).filter(s => (s.fromOfficeId === id || s.toOfficeId === id) && s.status !== 'Received');
  const why = [rooms.length && `${rooms.length} room(s)`, site.length && `${site.length} asset(s)`, ppl.length && `${ppl.length} person/people`, ships.length && `${ships.length} active shipment(s)`].filter(Boolean);
  if (db.offices.length < 2){ alert('The last office cannot be deleted.'); return; }
  if (why.length){ alert(`${o.name} cannot be deleted while it has:\n\n• ${why.join('\n• ')}\n\nMove or remove these first.`); return; }
  if (!confirm(`Delete ${o.name}?`)) return;
  clog(`Office deleted: ${o.name}`); db.offices = db.offices.filter(x => x !== o); save(); location.hash = '#/rooms';
}
function roomForm(r){
  const isNew = !r;
  r = r || {name:'', floor:'', kind:'office', w:900, h:500, serviceIds:[]};
  openDialog(`
    <h3>${isNew ? 'New room' : 'Room details'}</h3>
    <label class="f">Name</label><input name="name" required value="${esc(r.name)}" placeholder="e.g. 2.12 – Development Office">
    ${isNew ? `<label class="f">Office</label><select name="officeId">${sortHu(accessibleOffices().filter(o => o.countryId === scope.countryId), o => o.name).map(o => `<option value="${o.id}"${o.id === curOffice().id ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select>` : `<p class="muted">Office: ${esc((office(r.officeId) || {}).name || '?')}</p>`}
    <div class="two">
      <div><label class="f">Room type</label><select name="kind">${Object.entries(ROOM_KINDS).map(([k, v]) => `<option value="${k}"${k === r.kind ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
      <div><label class="f">Floor / building</label><input name="floor" value="${esc(r.floor)}"></div>
      <div><label class="f">Plan width (px)</label><input name="w" type="number" min="300" max="4000" step="20" value="${r.w}"></div>
      <div><label class="f">Plan height (px)</label><input name="h" type="number" min="200" max="4000" step="20" value="${r.h}"></div>
    </div>
    <label class="f">Services using this office (for the Hybrid / WFH pools)</label>
    <div class="checklist">${sortHu(db.services, s => s.name).map(s => `<label><input type="checkbox" name="svc_${s.id}"${r.serviceIds.includes(s.id) ? ' checked' : ''}> 🧩 ${esc(s.name)}</label>`).join('') || '<span class="muted">No Services yet (Settings → Services).</span>'}</div>
    ${dlgActions(isNew ? 'Create' : 'Save')}`,
    data => {
      const v = {name:data.name.trim(), kind:data.kind, floor:data.floor.trim(), w:+data.w || 900, h:+data.h || 500, serviceIds:db.services.filter(s => data['svc_' + s.id]).map(s => s.id)};
      if (isNew){ const n = {id:uid(), ...v, officeId:data.officeId || curOffice().id}; db.rooms.push(n); save(); location.hash = '#/room/' + n.id; }
      else { Object.assign(r, v); for (const o of roomObjs(r.id)) clampObj(o); save(); render(); }
    });
}

let flashObj = null;
function viewRoom(id, selId){
  const r = room(id);
  if (!r) return `<div class="empty">Room not found.</div>`;
  const ed = fp.editing && fp.roomId === id;
  const os = roomObjs(id), sel = selId ? findObj(selId) : null;
  const ordered = [...os.filter(o => o.kind !== 'door'), ...os.filter(o => o.kind === 'door')];
  return `
    <div class="row"><a href="#/rooms?office=${r.officeId}">← ${esc((office(r.officeId) || {}).name || 'Floorplan')}</a></div>
    <div class="row" style="margin-top:8px"><h1>${(ROOM_KINDS[r.kind] || '🏢').split(' ')[0]} ${esc(r.name)}</h1><span class="spacer"></span>
      ${ed ? '' : `<button onclick="printFloorplan('${r.officeId}','${r.id}')">🖨 Print</button><button onclick="exportFloorplanXlsx('${r.officeId}','${r.id}')">⬇ Export to Excel</button>
        <button class="primary" onclick="fpStart('${r.id}')">✎ Edit floorplan</button>
        <button onclick="roomForm(room('${r.id}'))">⚙ Room details</button>
        <button class="danger" onclick="deleteRoom('${r.id}')">Delete</button>`}</div>
    <div class="sub">${ROOM_KINDS[r.kind] || ''} · ${esc(r.floor)} · 🧩 ${r.serviceIds.map(serviceName).filter(Boolean).map(esc).join(', ') || 'no Service'}${r.savedAt ? ` · last saved: ${fmtTime(r.savedAt)}` : ''}</div>
    ${ed ? `<div class="editbar"><b>✎ Edit mode</b><span class="muted">${fp.dirty ? 'There are unsaved changes.' : 'Move desks by dragging; drag assets from the pools onto desks.'}</span>
      <span class="spacer"></span>
      <button onclick="addObj('${r.id}','desk')">🪑 + Desk</button><button onclick="addObj('${r.id}','rack')">🗄️ + Rack</button><button onclick="addObj('${r.id}','door')">🚪 + Door</button>
      <button class="primary" onclick="fpSave()" id="fpSaveBtn">💾 Save</button><button onclick="fpCancel()">✕ Cancel</button></div>` : ''}
    <div class="room-layout${ed ? ' editing' : ''}">
      <div class="map-wrap"><div class="map" id="map" style="width:${r.w}px;height:${r.h}px">
        ${ordered.map(o => objHtml(o, sel && sel.id === o.id, ed)).join('')}
      </div></div>
      <div class="side">
        <div class="card">${sel && sel.roomId === id ? objPanel(sel, ed) : legend()}</div>
        ${r.kind === 'server' && !officePool(id).length && !sitePool(r.officeId).length ? '' : poolsHtml(r, ed)}
      </div>
    </div>`;
}
function legend(){
  return `<b>Legend</b>
    <p class="muted">Click a desk for details. Turn on editing to place or rearrange.</p>
    <div class="legend">
      <i style="background:var(--desk-person);border-color:var(--desk-person-line)"></i><span>Desk – has an owner</span>
      <i style="background:var(--desk-shared);border-color:var(--desk-shared-line)"></i><span>Desk – shared / shift</span>
      <i style="background:var(--desk);border-color:var(--desk-line)"></i><span>Desk – free / hot-desk</span>
      <i style="background:var(--rack);border-color:var(--rack-line)"></i><span>Rack / server cabinet</span>
      <i style="background:repeating-linear-gradient(45deg,var(--door) 0 3px,transparent 3px 6px);border-color:var(--door)"></i><span>Door / entrance</span>
      <i style="border-color:var(--hybrid)"></i><span>Hybrid asset on a desk (stays with the person)</span>
      <span class="tag" style="color:var(--accent)">🔌 R4-5-15</span><span>The desk's floor network port</span>
    </div>`;
}
function objHtml(o, selected, ed){
  const cls = ['obj', o.kind];
  if (selected) cls.push('sel');
  if (flashObj === o.id) cls.push('flash');
  const st = `left:${o.x}px;top:${o.y}px;width:${o.w}px;${o.kind === 'door' ? 'height' : 'min-height'}:${o.h}px`;
  if (o.kind === 'door') return `<div class="${cls.join(' ')}" data-id="${o.id}" style="${st}" title="🚪 ${esc(o.label)}"><span>🚪</span></div>`;
  const p = o.personId ? person(o.personId) : null;
  if (o.kind === 'desk'){ if (p) cls.push('has-person'); else if (o.shared) cls.push('shared'); }
  const as = sortHu(deskAssets(o.id), a => a.type + a.tag);
  const owner = o.kind === 'rack' ? '' : `<div class="dp">${p ? '👤 ' + esc(p.name) : o.shared ? '🔁 ' + esc(o.sharedNote || 'Shared / shift') : '<i>free</i>'}</div>`;
  return `<div class="${cls.join(' ')}" data-id="${o.id}" style="${st}">
    <div class="dl">${o.kind === 'rack' ? '🗄️ ' : ''}${esc(o.label)}${o.port ? `<span class="dport" title="Floor network port">🔌${esc(o.port)}</span>` : ''}</div>${owner}
    <div>${as.map(a => `<span class="chip${a.placement ? ' hy' : ''}" data-aid="${a.id}"${ed ? ' draggable="true"' : ''} title="${esc(typeLabel(a.type) + ' · ' + modelName(a) + (a.placement ? ' · Hybrid, stays with ' + (person(a.holder.id) || {}).name : ''))}">${typeIcon(a.type)}${esc(a.tag)}</span>`).join(o.kind === 'rack' ? '<br>' : '')}</div>
  </div>`;
}
function poolsHtml(r, ed){
  const site = sortHu(sitePool(r.officeId), a => a.tag), off = sortHu(officePool(r.id), a => a.type + a.tag), hy = sortHu(modePool(r.id, 'hybrid'), a => a.tag), wfh = sortHu(modePool(r.id, 'wfh'), a => a.tag);
  const chip = (a, cls, drag) => {
    const k = a.placement && desk(a.placement.deskId), p = a.holder.kind === 'person' ? person(a.holder.id) : null;
    return `<span class="pchip ${cls}${k ? ' placed' : ''}" data-aid="${a.id}"${drag && ed ? ' draggable="true"' : ''}
      title="${esc(`${a.tag} · ${typeLabel(a.type)} · ${modelName(a)}${p ? ' · ' + p.name + ' (' + modeName(p.mode) + ')' : ''}${cls === 'wfh' ? ' – WFH asset, cannot go on a desk' : ''}`)}">
      ${typeIcon(a.type)} <a href="#/asset/${a.id}" draggable="false">${esc(a.tag)}</a>${p ? ` <small>${esc(p.name)}</small>` : ''}${k ? ` <small>→ ${esc(k.label)}</small>` : ''}</span>`;
  };
  return `<div class="card" style="margin-top:12px">
    <b>Asset pools</b> <span class="muted" style="font-size:12px">${ed ? '– drag an asset onto a desk' : '– turn on editing to place assets'}</span>
    <div class="pool office" id="poolOffice"><h4>🏢 Office pool <span class="muted">(${off.length})</span></h4>
      ${off.map(a => chip(a, '', true)).join('') || '<span class="muted" style="font-size:12px">Empty. Office assets not yet on a desk appear here; they can be dragged back from a desk.</span>'}</div>
    <div class="pool"><h4>📦 At this office, not placed <span class="muted">(${site.length})</span></h4>
      ${site.map(a => chip(a, '', true)).join('') || '<span class="muted" style="font-size:12px">None.</span>'}</div>
    <div class="pool hybrid"><h4>🔀 Hybrid assets <span class="muted">(${hy.length})</span></h4>
      ${hy.map(a => chip(a, 'hy', true)).join('') || '<span class="muted" style="font-size:12px">No assets of Hybrid people.</span>'}
      ${hy.length ? '<div class="muted" style="font-size:11px;margin-top:4px">Can go on a desk – the assignment stays, this is not a new checkout.</div>' : ''}</div>
    <div class="pool wfh"><h4>🏠 WFH assets <span class="muted">(${wfh.length}) – cannot go on a desk</span></h4>
      ${wfh.map(a => chip(a, 'wfh', false)).join('') || '<span class="muted" style="font-size:12px">No assets of WFH people.</span>'}</div>
    ${r.serviceIds.length ? '' : '<div class="warnbox">No Service is linked to this office, so the Hybrid and WFH pools are empty. (⚙ Room details)</div>'}
  </div>`;
}
function objPanel(o, ed){
  const head = (icon, title) => `<div class="row"><b>${icon} ${title}</b><span class="spacer"></span><a href="#/room/${o.roomId}">✕ close</a></div>`;
  const sizeRow = (wl, hl) => ed ? `<div class="row" style="gap:8px;align-items:flex-end">
      <div style="flex:1"><label class="f">${wl}</label><input data-f="w" type="number" min="10" step="10" value="${o.w}" style="width:100%"></div>
      <div style="flex:1"><label class="f">${hl}</label><input data-f="h" type="number" min="10" step="10" value="${o.h}" style="width:100%"></div>
      <button onclick="rotateObj('${o.id}')" title="Rotate">⟲ 90°</button></div>` : '';
  const del = ed ? `<div style="margin-top:18px;text-align:right"><button class="danger sm" onclick="deleteObj('${o.id}')">Delete ${OBJ[o.kind].label}</button></div>` : '';
  if (o.kind === 'door') return head('🚪', 'Door') + (ed ? `<label class="f">Name</label><input data-f="label" value="${esc(o.label)}">${sizeRow('Width', 'Thickness')}
    <p class="muted" style="font-size:12px">Tip: drag it to a wall; rotate by 90° for a vertical wall.</p>` : `<p>${esc(o.label)}</p>`) + del;
  const as = sortHu(deskAssets(o.id), a => a.type + a.tag), isRack = o.kind === 'rack', p = o.personId ? person(o.personId) : null;
  const ownerVal = o.personId || (o.shared ? 'shared' : '');
  const list = as.length ? as.map(a => `<div class="item">${assetIcon(a)} <div style="flex:1"><a class="tag" href="#/asset/${a.id}">${esc(a.tag)}</a>
      <br><small class="muted">${esc(typeLabel(a.type))} · ${esc(modelName(a))}${a.placement ? ` · <span style="color:var(--hybrid)">Hybrid – ${esc((person(a.holder.id) || {}).name || '')}</span>` : ''}</small></div>
      <div class="toolbar" style="justify-content:flex-end">${ed ? `<button class="sm" onclick="dropToPool(asset('${a.id}'))" title="${a.placement ? 'Remove from the desk (stays with the person)' : 'Back to the office pool'}">↩ To pool</button>` : ''}
      <button class="sm" onclick="returnToWarehouse('${a.id}')" title="Take it off the desk and put it back in stock">📦 Return to Warehouse</button></div></div>`).join('')
    : '<p class="muted">No assets.</p>';
  return head(isRack ? '🗄️' : '🪑', isRack ? 'Rack / cabinet' : 'Desk') + (ed ? `
    <label class="f">Label</label><input data-f="label" value="${esc(o.label)}">
    ${isRack ? '' : `<label class="f">Desk owner</label>
    <select data-f="owner">
      <option value=""${ownerVal === '' ? ' selected' : ''}>– free / hot-desk –</option>
      <option value="shared"${ownerVal === 'shared' ? ' selected' : ''}>🔁 Shared / shift (not one person's)</option>
      <optgroup label="Assigned to a person">${sortHu(db.people.filter(x => x.officeId === (room(o.roomId) || {}).officeId), x => x.name).map(x => `<option value="${x.id}"${x.id === o.personId ? ' selected' : ''}>👤 ${esc(x.name)}</option>`).join('')}</optgroup>
    </select>
    ${o.shared ? `<label class="f">Used by (e.g. Service, shifts)</label><input data-f="sharedNote" value="${esc(o.sharedNote || '')}" placeholder="e.g. Customer Support – 2 shifts">` : ''}
    <label class="f">🔌 Floor port ID</label><input data-f="port" value="${esc(o.port || '')}" placeholder="e.g. R4-5-15" class="tag">`}
    ${sizeRow('Width', isRack ? 'Height' : 'Depth')}` : `
    <dl class="kv" style="margin-top:8px"><dt>Label</dt><dd><b>${esc(o.label)}</b></dd>
      ${isRack ? '' : `<dt>Owner</dt><dd>${p ? personLink(p.id) : o.shared ? '🔁 ' + esc(o.sharedNote || 'Shared / shift') : '<i>free</i>'}</dd>
      <dt>🔌 Port</dt><dd>${o.port ? `<span class="tag">${esc(o.port)}</span>${copyBtn(o.port)}` : '<span class="muted">not set</span>'}</dd>`}</dl>`) + `
    <h2 style="margin-top:18px">Assets ${isRack ? 'in the rack' : 'on the desk'} (${as.length})</h2>${list}
    ${ed ? '' : '<p class="muted" style="font-size:12px;margin-top:10px">To change: ✎ Edit floorplan.</p>'}${del}`;
}

// ---------- edit mode ----------
function fpStart(roomId){ Object.assign(fp, {editing:true, roomId, dirty:false}); render(); }
function fpSave(){
  const r = room(fp.roomId);
  if (r) r.savedAt = Date.now();
  if (r && fp.dirty) log(null, `Floorplan saved: ${r.name}`, 'updated');
  Object.assign(fp, {editing:false, dirty:false});
  save(); toast('💾 Floorplan saved'); render();
}
function fpCancel(){
  if (fp.dirty && !confirm('Discard the unsaved floorplan changes?')) return;
  Object.assign(fp, {editing:false, dirty:false});
  db = load(); toast('Changes discarded – showing the saved state.'); render();
}
// leaving the room while editing: offer to save
function fpLeaveCheck(nextPath){
  if (!fp.editing || nextPath.startsWith('room/' + fp.roomId)) return;
  if (fp.dirty && confirm('The floorplan changes are not saved.\n\nOK = Save   ·   Cancel = Discard')){ fpSave(); return; }
  Object.assign(fp, {editing:false, dirty:false});
  db = load();
}
window.addEventListener('beforeunload', e => { if (fp.editing && fp.dirty){ e.preventDefault(); e.returnValue = ''; } });

// ---------- drag & drop placement ----------
// null = allowed, otherwise the reason why not
function dropRule(a, k){
  if (!k || k.kind === 'door') return 'Assets cannot be placed here.';
  if (a.holder.kind === 'transit') return 'This asset is in transit.';
  if (a.holder.kind === 'site') return (room(k.roomId) || {}).officeId === a.holder.id ? null : 'This asset belongs to another office.';
  if (a.holder.kind === 'person'){
    const p = person(a.holder.id);
    if (!p) return 'Unknown person.';
    if (modeBehavior(p.mode) === 'wfh') return 'A WFH asset cannot be placed on an office desk.';
    if (modeBehavior(p.mode) !== 'hybrid') return 'An assigned asset can only go on a desk for a Hybrid employee.';
    if (k.kind === 'rack') return 'A Hybrid asset cannot go in a rack.';
    return null;
  }
  if (a.holder.kind === 'office') return a.holder.id === k.roomId ? null : 'This asset belongs to another office.';
  if (a.holder.kind === 'desk') return (desk(a.holder.id) || {}).roomId === k.roomId ? null : 'This asset belongs to another office.';
  return 'This asset is not assigned to this office – the floorplan does not check out assets.';
}
function dropOnDesk(a, k){
  const err = dropRule(a, k);
  if (err){ toast('⛔ ' + err); return false; }
  if (a.holder.kind === 'person'){ if (!(a.placement && a.placement.deskId === k.id)) setPlacement(a, k.id); }
  else if (!(a.holder.kind === 'desk' && a.holder.id === k.id)) setHolder(a, {kind:'desk', id:k.id});
  save(); render(); return true;
}
function dropToPool(a){
  if (a.holder.kind === 'person'){ if (a.placement) setPlacement(a, null); }
  else if (a.holder.kind === 'desk') setHolder(a, {kind:'office', id:desk(a.holder.id).roomId});
  save(); render();
}
let dragAid = null;
function bindRoom(roomId, selId){
  const r = room(roomId), map = $('#map'), ed = fp.editing && fp.roomId === roomId;
  const snap = v => Math.round(v / 10) * 10;
  map.querySelectorAll('.obj').forEach(el => {
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('[draggable=true]')) return;
      const o = findObj(el.dataset.id), sx = e.clientX, sy = e.clientY, ox = o.x, oy = o.y;
      let moved = false;
      if (ed) el.setPointerCapture(e.pointerId);
      const mv = ev => {
        if (!ed) return;
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        moved = true; el.classList.add('dragging');
        o.x = Math.max(0, Math.min(r.w - o.w, snap(ox + dx))); o.y = Math.max(0, Math.min(r.h - o.h, snap(oy + dy)));
        el.style.left = o.x + 'px'; el.style.top = o.y + 'px';
      };
      const up = () => {
        el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up);
        el.classList.remove('dragging');
        if (moved) save();
        selectObj(o);
      };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
    });
  });
  if (ed){
    const clear = () => document.querySelectorAll('.drop-ok,.drop-no').forEach(x => x.classList.remove('drop-ok', 'drop-no'));
    document.querySelectorAll('[draggable=true][data-aid]').forEach(c => {
      c.addEventListener('dragstart', e => {
        dragAid = c.dataset.aid; e.dataTransfer.setData('text/plain', dragAid); e.dataTransfer.effectAllowed = 'move';
        const a = asset(dragAid);
        map.querySelectorAll('.obj.desk,.obj.rack').forEach(d => d.classList.add(dropRule(a, findObj(d.dataset.id)) ? 'drop-no' : 'drop-ok'));
        if (a.holder.kind === 'desk' || a.placement) $('#poolOffice').classList.add('drop-ok');
      });
      c.addEventListener('dragend', () => { dragAid = null; clear(); });
    });
    map.querySelectorAll('.obj.desk,.obj.rack').forEach(d => {
      d.addEventListener('dragover', e => { if (dragAid && !dropRule(asset(dragAid), findObj(d.dataset.id))){ e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
      d.addEventListener('drop', e => { e.preventDefault(); const id = dragAid || e.dataTransfer.getData('text/plain'); clear(); if (id) dropOnDesk(asset(id), findObj(d.dataset.id)); });
    });
    const pool = $('#poolOffice');
    if (pool){
      pool.addEventListener('dragover', e => { const a = dragAid && asset(dragAid); if (a && (a.holder.kind === 'desk' || a.placement)){ e.preventDefault(); } });
      pool.addEventListener('drop', e => { e.preventDefault(); const id = dragAid || e.dataTransfer.getData('text/plain'); clear(); if (id) dropToPool(asset(id)); });
    }
  }
  const o = selId && findObj(selId);
  if (!o || !ed) return;
  document.querySelectorAll('.side [data-f]').forEach(el => el.addEventListener('change', () => {
    const f = el.dataset.f, v = el.value;
    if (f === 'owner'){ o.shared = v === 'shared'; o.personId = v && v !== 'shared' ? v : null; }
    else if (f === 'w' || f === 'h'){ o[f] = Math.max(10, +v || o[f]); clampObj(o); }
    else if (f === 'label') o.label = String(v).trim() || o.label;
    else if (f === 'port') o.port = String(v).trim();
    else o[f] = v;
    save(); render();
  }));
}
function selectObj(o){
  const target = `#/room/${o.roomId}/${o.id}`;
  if (location.hash === target) render(); else location.hash = target;
}
function clampObj(o){ const r = room(o.roomId); o.w = Math.min(o.w, r.w); o.h = Math.min(o.h, r.h); o.x = Math.max(0, Math.min(r.w - o.w, o.x)); o.y = Math.max(0, Math.min(r.h - o.h, o.y)); }
// first free grid spot so new objects don't stack on top of each other
function findSpot(r, w, h){
  const os = roomObjs(r.id);
  for (let y = 20; y <= r.h - h; y += 20) for (let x = 20; x <= r.w - w; x += 20)
    if (!os.some(k => x < k.x + k.w + 10 && x + w + 10 > k.x && y < k.y + k.h + 10 && y + h + 10 > k.y)) return {x, y};
  return {x:0, y:0};
}
function addObj(roomId, kind){
  if (!fp.editing) return;
  const r = room(roomId), def = OBJ[kind], same = roomObjs(roomId).filter(o => o.kind === kind).length + 1;
  const {x, y} = kind === 'door' ? {x:Math.max(0, r.w - def.w - 40), y:0} : findSpot(r, def.w, def.h);
  const o = {id:uid(), roomId, kind, x, y, w:def.w, h:def.h};
  if (kind === 'desk') Object.assign(o, {label:'Desk ' + same, personId:null, shared:false, sharedNote:'', port:''});
  if (kind === 'rack') Object.assign(o, {label:'Rack ' + same, personId:null, shared:false, port:''});
  if (kind === 'door') o.label = same === 1 ? 'Entrance' : 'Door ' + same;
  (kind === 'door' ? db.items : db.desks).push(o);
  clampObj(o); save(); selectObj(o);
}
function rotateObj(id){ const o = findObj(id); [o.w, o.h] = [o.h, o.w]; clampObj(o); save(); render(); }
// removing a desk never returns assets to storage: they go back to the office pool / stay with their person
function deleteObj(id){
  const o = findObj(id), name = `${OBJ[o.kind].label} “${o.label}”`;
  if (o.kind === 'desk' || o.kind === 'rack'){
    const as = deskAssets(id);
    if (!confirm(`Delete ${name}?` + (as.length ? `\nIts ${as.length} asset(s) go back to the office pool (Hybrid assets stay with the person).` : ''))) return;
    for (const a of as){ if (a.placement) setPlacement(a, null); else setHolder(a, {kind:'office', id:o.roomId}); }
    db.desks = db.desks.filter(x => x.id !== id);
  } else {
    if (!confirm(`Delete ${name}?`)) return;
    db.items = db.items.filter(x => x.id !== id);
  }
  save(); location.hash = '#/room/' + o.roomId;
}
// ---------- print and Excel export: the same rows feed the printout, the overview sheet and the drawn plan ----------
const fpRooms = (oid, rid) => rid ? [room(rid)].filter(Boolean) : sortHu(officeRooms(oid), r => r.name);
const deskPersonText = k => k.personId && person(k.personId) ? person(k.personId).name : k.shared ? k.sharedNote || 'Shared / shift' : '';
// one row per asset on a desk or rack; a desk without assets still gets its own row; room pool assets are listed too
function floorRows(rooms){
  const out = [];
  for (const r of rooms){
    const base = [officeLabel(r.officeId), r.floor || '', r.name];
    for (const k of sortHu(db.desks.filter(x => x.roomId === r.id), x => x.label)){
      const as = sortHu(deskAssets(k.id), a => a.type + a.tag), desk = `${k.label}${k.kind === 'rack' ? ' (rack)' : ''}${k.port ? ' · port ' + k.port : ''}`;
      if (!as.length) out.push([...base, desk, deskPersonText(k), serviceName((person(k.personId) || {}).serviceId), '', '', '', '', '', '']);
      for (const a of as){
        const p = a.placement ? person(a.holder.id) : person(k.personId);
        out.push([...base, desk, a.placement ? `${p ? p.name : '?'} (Hybrid)` : deskPersonText(k), serviceName(a.serviceId || (p || {}).serviceId), a.tag, assetName(a), typeLabel(a.type), modelName(a), a.serial || '', STATUS[a.status].label]);
      }
    }
    for (const a of sortHu(officePool(r.id), a => a.tag)) out.push([...base, '(room pool, not on a desk)', '', serviceName(a.serviceId), a.tag, assetName(a), typeLabel(a.type), modelName(a), a.serial || '', STATUS[a.status].label]);
  }
  return out;
}
const FLOOR_HEAD = ['Office', 'Floor', 'Room', 'Desk ID / Desk Name', 'Person', 'Service / Department', 'Asset ID', 'Asset Name', 'Asset Type', 'Model', 'Serial Number', 'Status'];
function printFloorplan(oid, rid){
  const rooms = fpRooms(oid, rid);
  if (!rooms.length){ toast('This office has no rooms.'); return; }
  const page = r => {
    const s = Math.min(1, 960 / r.w), objs = roomObjs(r.id);
    const box = o => {
      if (o.kind === 'door') return `<div class="o door" style="left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.h}px"></div>`;
      const as = sortHu(deskAssets(o.id), a => a.type + a.tag), who = deskPersonText(o);
      return `<div class="o ${o.kind}${o.personId ? ' own' : o.shared ? ' sh' : ''}" style="left:${o.x}px;top:${o.y}px;width:${o.w}px;min-height:${o.h}px"><b>${esc(o.label)}</b>${o.port ? ` <small>🔌${esc(o.port)}</small>` : ''}${who ? `<div>${esc(who)}</div>` : ''}<div class="t">${as.map(a => esc(a.tag)).join(' ')}</div></div>`;
    };
    const rows = floorRows([r]);
    return `<section class="pg"><h1>${esc(officeLabel(r.officeId))} › ${esc(r.name)}</h1><p class="meta">${esc(r.floor || '')}${r.floor ? ' · ' : ''}printed ${fmtTime(Date.now())}</p>
      <div class="mapw" style="width:${r.w * s}px;height:${r.h * s}px"><div class="map" style="width:${r.w}px;height:${r.h}px;transform:scale(${s})">${objs.map(box).join('')}</div></div>
      <table><thead><tr>${FLOOR_HEAD.slice(3).map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(x => `<tr>${x.slice(3).map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="9">No desks.</td></tr>'}</tbody></table></section>`;
  };
  openPrintWindow(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Floorplan – ${esc(officeLabel(oid))}</title><style>
    @page{size:A4 landscape;margin:10mm} body{font:11px/1.35 Arial,sans-serif;color:#111;margin:0;background:#e9ebee}
    .bar{position:sticky;top:0;background:#1d2330;color:#fff;padding:10px 16px;display:flex;gap:14px;align-items:center;font:14px system-ui}
    .bar button{font:inherit;padding:7px 16px;border-radius:6px;border:0;background:#2f6fed;color:#fff;cursor:pointer;font-weight:600}
    .pg{background:#fff;margin:16px auto;padding:12mm;max-width:277mm;box-sizing:border-box;page-break-after:always} .pg:last-child{page-break-after:auto}
    h1{font-size:16px;margin:0} .meta{color:#555;margin:2px 0 10px}
    .mapw{position:relative;margin-bottom:12px} .map{position:absolute;top:0;left:0;transform-origin:0 0;border:3px solid #444;background:#fafafa}
    .o{position:absolute;box-sizing:border-box;border:2px solid #b09460;background:#f3ead9;padding:3px 5px;overflow:hidden;font-size:11px}
    .o.own{background:#e6f4ea;border-color:#5b8f6b} .o.sh{background:#e4ecfb;border-color:#6a8fd0} .o.rack{background:#3b3f46;border-color:#1f2226;color:#fff}
    .o.door{background:repeating-linear-gradient(45deg,#9a7442 0 4px,transparent 4px 8px);border:2px solid #9a7442;padding:0}
    .o .t{font-family:Consolas,monospace;font-size:10px}
    table{border-collapse:collapse;width:100%} th,td{border:1px solid #999;padding:3px 5px;text-align:left;vertical-align:top} th{background:#eee}
    @media print{.bar{display:none} body{background:#fff} .pg{margin:0;padding:0;max-width:none}}
  </style></head><body><div class="bar"><button onclick="print()">🖨 Print</button><span>${rooms.length} room(s). Landscape A4.</span></div>${rooms.map(page).join('')}</body></html>`);
}
// sheet 1 draws each room on a grid (one cell = 20 px of the plan), sheet 2 is an editable table with filters
function floorplanBook(oid, rid){
  const rooms = fpRooms(oid, rid), sh = xlSheet('Floorplan'), G = 20;
  sh.landscape = true;
  sh.set(0, 0, `Floorplan – ${officeLabel(oid)}${rid && rooms[0] ? ' › ' + rooms[0].name : ''}`, XL_STYLE.title);
  const legend = [['Desk with owner', XL_STYLE.owner], ['Shared / shift desk', XL_STYLE.shared], ['Free desk', XL_STYLE.free], ['Rack', XL_STYLE.rack], ['Door', XL_STYLE.door]];
  let c = 0; for (const [l, s] of legend){ for (let i = 0; i < 6; i++) sh.set(1, c + i, i ? '' : l, s); sh.merges.push([1, c, 1, c + 5]); c += 7; }
  sh.set(2, 0, 'Details of every desk are on the “Desk & Asset Overview” sheet.', XL_STYLE.note);
  let top = 4, maxC = 34;
  for (const r of rooms){
    const cols = Math.ceil(r.w / G), rows = Math.ceil(r.h / G);
    sh.set(top, 0, `${r.name}${r.floor ? ' · ' + r.floor : ''}`, XL_STYLE.title); sh.rows[top] = 21;
    const r0 = top + 1, used = new Set();
    // the walls, then the floor
    for (let y = 0; y <= rows + 1; y++) for (let x = 0; x <= cols + 1; x++) sh.set(r0 + y, x, '', y === 0 || x === 0 || y === rows + 1 || x === cols + 1 ? XL_STYLE.wall : XL_STYLE.floor);
    for (const o of sortHu(roomObjs(r.id), o => o.kind === 'door' ? 1 : 0)){
      const x0 = Math.min(cols, Math.round(o.x / G) + 1), y0 = Math.min(rows, Math.round(o.y / G) + 1);
      const x1 = Math.max(x0, Math.min(cols, Math.round((o.x + o.w) / G))), y1 = Math.max(y0, Math.min(rows, Math.round((o.y + o.h) / G)));
      const style = o.kind === 'door' ? XL_STYLE.door : o.kind === 'rack' ? XL_STYLE.rack : o.personId ? XL_STYLE.owner : o.shared ? XL_STYLE.shared : XL_STYLE.free;
      const cells = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push([y, x]);
      const free = cells.filter(([y, x]) => !used.has(y + ',' + x));
      if (!free.length) continue;
      const as = o.kind === 'door' ? [] : sortHu(deskAssets(o.id), a => a.type + a.tag);
      const text = o.kind === 'door' ? '' : [o.label + (o.port ? ` · ${o.port}` : ''), deskPersonText(o), as.map(a => a.tag).join(', ')].filter(Boolean).join('\n');
      free.forEach(([y, x], i) => { used.add(y + ',' + x); sh.set(r0 + y, x, i ? '' : text, style); });
      // merged only when nothing else overlaps, so the sheet always opens cleanly
      if (free.length === cells.length && cells.length > 1) sh.merges.push([r0 + y0, x0, r0 + y1, x1]);
    }
    for (let y = 0; y <= rows + 1; y++) sh.rows[r0 + y] = 15;
    maxC = Math.max(maxC, cols + 2);
    top = r0 + rows + 4;
  }
  sh.cols = Array.from({length:maxC}, () => 2.9);
  return {sheets:[sh, xlTable('Desk & Asset Overview', FLOOR_HEAD, floorRows(rooms), [18, 12, 22, 22, 22, 20, 11, 24, 14, 22, 16, 11])], rooms};
}
function exportFloorplanXlsx(oid, rid){
  const {sheets, rooms} = floorplanBook(oid, rid);
  if (!rooms.length){ toast('This office has no rooms.'); return; }
  download(`floorplan-${(rid ? rooms[0].name : officeLabel(oid)).replace(/[^\w.-]+/g, '-')}-${stamp()}.xlsx`, xlsxBlob(sheets));
  toast(`Excel file with ${rooms.length} room(s) downloaded.`);
}
function deleteRoom(id){
  const r = room(id), ks = db.desks.filter(k => k.roomId === id);
  const as = db.assets.filter(a => (a.holder.kind === 'desk' && ks.some(k => k.id === a.holder.id)) || (a.holder.kind === 'office' && a.holder.id === id));
  const placed = db.assets.filter(a => a.placement && ks.some(k => k.id === a.placement.deskId));
  if (!confirm(`Delete room “${r.name}” with all desks, racks and doors?` + (as.length ? `\nIts ${as.length} asset(s) stay at the office as not placed.` : ''))) return;
  for (const a of as) setHolder(a, {kind:'site', id:r.officeId});
  for (const a of placed) setPlacement(a, null);
  db.desks = db.desks.filter(k => k.roomId !== id); db.items = db.items.filter(i => i.roomId !== id);
  db.rooms = db.rooms.filter(x => x.id !== id); save(); location.hash = '#/rooms?office=' + r.officeId;
}
