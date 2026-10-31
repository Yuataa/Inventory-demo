'use strict';
/* Settings: Services, Job Roles, Work Modes, Types & Models, Custom Field Sets, Dashboard, protocols, data, log user */

const SETTINGS_TABS = [['services', '🧩 Services'], ['roles', '👔 Job Roles'], ['modes', '🏠 Work Modes'], ['types', '🏷️ Types & Models'], ['fields', '🧾 Custom Field Sets'],
  ['dashboard', '📊 Dashboard'], ['docs', '📄 Protocols'], ['data', '💾 Data'], ['user', '👤 User']];
function viewSettings(tab, sub, params = new URLSearchParams()){
  tab = SETTINGS_TABS.some(t => t[0] === tab) ? tab : 'services';
  const body = {services:setServices, roles:setRoles, modes:setModes, types:() => setTypes(params), fields:() => sub ? setFieldSet(sub) : setFields(), dashboard:setDashboard, docs:setDocs, data:setData, user:setUser}[tab]();
  return `<h1>Settings</h1><div class="tabs">${SETTINGS_TABS.map(([k, l]) => `<a href="#/settings/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>${body}`;
}

// ---------- services ----------
function setServices(){
  return `<div class="row"><div class="sub" style="margin:0">The single organizational unit. People and assets can be assigned to it; offices link to it on the Floorplan.</div>
    <span class="spacer"></span><button class="primary" onclick="serviceForm()">+ New Service</button></div>
    ${db.services.length ? `<div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Service</th><th>People</th><th>Assets (assigned to Service)</th><th>Offices</th><th>Note</th><th></th></tr></thead><tbody>${sortHu(db.services, s => s.name).map(s => {
      const ppl = db.people.filter(p => p.serviceId === s.id), rooms = db.rooms.filter(r => r.serviceIds.includes(s.id));
      return `<tr><td><b>${esc(s.name)}</b></td><td><a href="#/people?service=${s.id}">${ppl.length}</a> <small class="muted">${db.modes.map(m => m.icon + ppl.filter(p => p.mode === m.id).length).join(' ')}</small></td>
        <td><a href="#/assets?service=${s.id}">${db.assets.filter(a => a.serviceId === s.id).length}</a></td>
        <td>${rooms.map(r => `<a href="#/room/${r.id}">${esc(r.name)}</a>`).join(', ') || '<span class="muted">–</span>'}</td><td class="muted">${esc(s.note)}</td>
        <td style="text-align:right;white-space:nowrap"><button class="sm" onclick="serviceForm(service('${s.id}'))">✎</button> <button class="sm danger" onclick="deleteService('${s.id}')">🗑</button></td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="empty">No Services yet.</div>'}`;
}
function serviceForm(s){
  const isNew = !s; s = s || {name:'', note:''};
  openDialog(`<h3>${isNew ? 'New Service' : 'Edit Service'}</h3>
    <label class="f">Name</label><input name="name" required value="${esc(s.name)}" placeholder="e.g. Customer Support">
    <label class="f">Note</label><input name="note" value="${esc(s.note)}">${dlgActions(isNew ? 'Create' : 'Save')}`,
    data => {
      const name = data.name.trim();
      if (db.services.some(x => x !== s && norm(x.name) === norm(name))){ alert('A Service with this name already exists.'); return false; }
      if (isNew) db.services.push({id:uid(), name, note:data.note.trim()}); else Object.assign(s, {name, note:data.note.trim()});
      clog(`Service ${isNew ? 'created' : 'updated'}: ${name}`); save(); render();
    });
}
function deleteService(id){
  const s = service(id), n = db.people.filter(p => p.serviceId === id).length + db.assets.filter(a => a.serviceId === id).length;
  if (!confirm(`Delete Service “${s.name}”?` + (n ? `\n${n} person/asset record(s) stay without a Service.` : ''))) return;
  for (const p of db.people) if (p.serviceId === id) p.serviceId = null;
  for (const a of db.assets) if (a.serviceId === id) a.serviceId = null;
  for (const r of db.rooms) r.serviceIds = r.serviceIds.filter(x => x !== id);
  db.services = db.services.filter(x => x.id !== id); save(); render();
}

// ---------- roles ----------
function setRoles(){
  return `<div class="row"><div class="sub" style="margin:0">Job Roles (e.g. Agent, TeamLeader). Independent of the Work Mode.</div>
    <span class="spacer"></span><button class="primary" onclick="roleForm()">+ New Job Role</button></div>
    ${db.roles.length ? `<div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Job Role</th><th>People</th><th></th></tr></thead><tbody>${sortHu(db.roles, r => r.name).map(r =>
      `<tr><td><b>${esc(r.name)}</b></td><td>${db.people.filter(p => p.roleId === r.id).map(p => personLink(p.id)).join(', ') || '<span class="muted">–</span>'}</td>
       <td style="text-align:right;white-space:nowrap"><button class="sm" onclick="roleForm(role('${r.id}'))">✎</button> <button class="sm danger" onclick="deleteRole('${r.id}')">🗑</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No Job Roles yet.</div>'}`;
}
function roleForm(r){
  const isNew = !r; r = r || {name:''};
  openDialog(`<h3>${isNew ? 'New Job Role' : 'Edit Job Role'}</h3><label class="f">Name</label><input name="name" required value="${esc(r.name)}" placeholder="e.g. TeamLeader">${dlgActions(isNew ? 'Create' : 'Save')}`,
    data => {
      const name = data.name.trim();
      if (db.roles.some(x => x !== r && norm(x.name) === norm(name))){ alert('A Job Role with this name already exists.'); return false; }
      if (isNew) db.roles.push({id:uid(), name}); else r.name = name;
      clog(`Job Role ${isNew ? 'created' : 'updated'}: ${name}`); save(); render();
    });
}
function deleteRole(id){
  const r = role(id), n = db.people.filter(p => p.roleId === id).length;
  if (!confirm(`Delete Job Role “${r.name}”?` + (n ? `\n${n} person(s) stay without a Job Role.` : ''))) return;
  for (const p of db.people) if (p.roleId === id) p.roleId = null;
  db.roles = db.roles.filter(x => x.id !== id); save(); render();
}

// ---------- work modes ----------
const MODE_BEHAVIOR = {onsite:'Onsite – assets are not placed from a person', hybrid:'Hybrid – assets may be placed on a desk', wfh:'WFH – assets never go on a desk'};
function setModes(){
  return `<div class="row"><div class="sub" style="margin:0">Work Mode describes where a person works. It is separate from the User Status.</div>
    <span class="spacer"></span><button class="primary" onclick="modeForm()">+ New Work Mode</button></div>
    <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th></th><th>Work Mode</th><th>Floorplan rule</th><th>People</th><th></th></tr></thead><tbody>${db.modes.map(m => {
      const n = db.people.filter(p => p.mode === m.id).length;
      return `<tr><td style="font-size:20px">${m.icon}</td><td><b>${esc(m.name)}</b></td><td class="muted">${MODE_BEHAVIOR[m.behavior]}</td><td><a href="#/people?mode=${encodeURIComponent(m.id)}">${n}</a></td>
        <td style="text-align:right;white-space:nowrap"><button class="sm" onclick="modeForm(modeOf('${esc(m.id)}'))">✎</button> ${n || db.modes.length < 2 ? '' : `<button class="sm danger" onclick="deleteMode('${esc(m.id)}')">🗑</button>`}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}
function modeForm(m){
  const isNew = !m; m = m || {name:'', icon:'🏢', behavior:'onsite'};
  openDialog(`<h3>${isNew ? 'New Work Mode' : 'Edit Work Mode'}</h3>
    <div class="two"><div><label class="f">Name</label><input name="name" required value="${esc(m.name)}"></div><div><label class="f">Icon (emoji)</label><input name="icon" value="${esc(m.icon)}" maxlength="4"></div></div>
    <label class="f">Floorplan rule</label><select name="behavior">${Object.entries(MODE_BEHAVIOR).map(([k, v]) => `<option value="${k}"${k === m.behavior ? ' selected' : ''}>${v}</option>`).join('')}</select>
    ${dlgActions(isNew ? 'Create' : 'Save')}`,
    data => {
      const name = data.name.trim();
      if (db.modes.some(x => x !== m && norm(x.name) === norm(name))){ alert('A Work Mode with this name already exists.'); return false; }
      const v = {name, icon:data.icon.trim() || '🏢', behavior:data.behavior};
      if (isNew) db.modes.push({id:uid(), ...v}); else Object.assign(m, v);
      clog(`Work Mode ${isNew ? 'created' : 'updated'}: ${name}`); save(); render();
    });
}
function deleteMode(id){
  if (!confirm(`Delete Work Mode “${modeName(id)}”?`)) return;
  clog(`Work Mode deleted: ${modeName(id)}`);
  db.modes = db.modes.filter(m => m.id !== id); save(); render();
}

// ---------- dashboard ----------
function setDashboard(){
  const D = db.settings.dashboard, d = D.defaults;
  const sel = (id, list, cur, all) => `<select data-dd="${id}"><option value="">${all}</option>${list.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const services = sortHu(db.services, s => s.name).map(s => [s.id, s.name]);
  return `<div class="sub">Choose what the Overview shows. Changes are saved at once in the current storage.</div>
    <div class="tbl-wrap"><table id="dashCfg"><thead><tr><th>Order</th><th>Item</th><th>Visible</th><th>Size</th><th>Asset Type breakdown</th></tr></thead><tbody>${D.items.map((it, i) => `<tr data-it="${it.id}">
      <td style="white-space:nowrap"><button class="sm" data-up="-1"${i ? '' : ' disabled'}>▲</button> <button class="sm" data-up="1"${i < D.items.length - 1 ? '' : ' disabled'}>▼</button></td>
      <td><b>${esc(DASH_ITEMS[it.id])}</b></td>
      <td><input type="checkbox" data-v="visible"${it.visible ? ' checked' : ''}></td>
      <td>${DASH_SECTIONS.includes(it.id) ? '<span class="muted">–</span>' : `<select data-v="size">${[['compact', 'Compact'], ['normal', 'Normal'], ['wide', 'Highlighted']].map(([k, l]) => `<option value="${k}"${k === it.size ? ' selected' : ''}>${l}</option>`).join('')}</select>`}</td>
      <td>${DASH_BREAKDOWN.includes(it.id) ? `<input type="checkbox" data-v="breakdown"${it.breakdown ? ' checked' : ''}>` : '<span class="muted">–</span>'}</td></tr>`).join('')}</tbody></table></div>
    <h2>Default filters</h2>
    <div class="card"><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">
      <div><label class="f">Office / Onsite: office</label>${sel('officeRoom', sortHu(db.rooms, r => r.name).map(r => [r.id, r.name]), d.officeRoom, 'All Offices')}</div>
      <div><label class="f">Assigned: Work Mode</label>${sel('assignedMode', db.modes.map(m => [m.id, m.name]), d.assignedMode, 'All')}</div>
      <div><label class="f">Assigned: Service</label>${sel('assignedService', services, d.assignedService, 'All')}</div>
      <div><label class="f">Storage / Spare: Asset Type</label>${sel('storageType', sortHu(db.types, t => t.name).map(t => [t.id, t.name]), d.storageType, 'All')}</div>
      <div><label class="f">Faulty / Aged: category</label>${sel('healthCat', [['faulty', 'Faulty'], ['aged', 'Aged'], ['both', 'Faulty and Aged']], d.healthCat, 'All')}</div>
      <div><label class="f">Aged Assets threshold (years)</label><input type="number" id="agedYears" min="1" max="30" value="${db.settings.agedYears}"></div>
    </div></div>
    <div class="row" style="margin-top:12px"><button onclick="resetDashboard()">Reset to default layout</button></div>`;
}
function bindDashSettings(){
  const D = db.settings.dashboard, done = text => { clog('Dashboard settings: ' + text); save(); render(); };
  document.querySelectorAll('#dashCfg tr[data-it]').forEach(tr => {
    const it = D.items.find(x => x.id === tr.dataset.it), name = DASH_ITEMS[it.id];
    tr.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => {
      const i = D.items.indexOf(it), j = i + +b.dataset.up;
      [D.items[i], D.items[j]] = [D.items[j], D.items[i]]; done(`${name} moved`);
    }));
    tr.querySelectorAll('[data-v]').forEach(el => el.addEventListener('change', () => {
      it[el.dataset.v] = el.type === 'checkbox' ? el.checked : el.value; done(`${name}: ${el.dataset.v} = ${it[el.dataset.v]}`);
    }));
  });
  document.querySelectorAll('[data-dd]').forEach(el => el.addEventListener('change', () => { D.defaults[el.dataset.dd] = el.value; done(`default filter ${el.dataset.dd}`); }));
  $('#agedYears').addEventListener('change', e => { const y = Math.max(1, +e.target.value || 5); db.settings.agedYears = y; done(`Aged threshold = ${y} years`); });
}
function resetDashboard(){
  if (!confirm('Reset the Overview to the default layout?')) return;
  db.settings.dashboard = defaultDashboard(); db.settings.agedYears = 5;
  clog('Dashboard settings: reset to default'); save(); render();
}

// ---------- types & models ----------
function bindModelFilters(){
  const upd = () => {
    const p = new URLSearchParams(); if ($('#mq').value) p.set('mq', $('#mq').value); if ($('#mt').value) p.set('mt', $('#mt').value);
    history.replaceState(null, '', '#/settings/types' + (p.toString() ? '?' + p : ''));
    const pos = $('#mq').selectionStart; render(); $('#mq').focus(); $('#mq').setSelectionRange(pos, pos);
  };
  $('#mq').addEventListener('input', upd); $('#mt').addEventListener('change', upd);
}
function setTypes(params){
  const mt = params.get('mt') || '', mq = norm(params.get('mq') || '');
  const models = sortHu(db.models.filter(m => (!mt || m.typeId === mt) && (!mq || norm(m.name).includes(mq))), m => typeLabel(m.typeId) + m.name);
  return `<div class="row"><h2 style="margin:0">Asset Types</h2><span class="spacer"></span><button class="primary" onclick="typeForm()">+ New type</button></div>
    <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th></th><th>Asset Type</th><th>Asset Name rule</th><th>Field sets</th><th>Models</th><th>Assets</th><th></th></tr></thead><tbody>${sortHu(db.types, t => t.name).map(t => {
      const sets = db.fieldSets.filter(s => s.typeIds.includes(t.id)), n = db.assets.filter(a => a.type === t.id).length;
      return `<tr><td style="font-size:20px">${t.icon}</td><td><b>${esc(t.name)}</b>${t.system ? ' <span class="pill" title="Used by Projects, cannot be deleted">system</span>' : ''}</td>
        <td class="muted">${t.nameRule === 'custom' ? 'Custom name' : 'Uses Model Name'}${t.nameUnique ? ' · unique' : ''}</td>
        <td>${sets.map(s => `<a href="#/settings/fields/${s.id}">${esc(s.name)}</a>`).join(', ') || '<span class="muted">–</span>'}</td>
        <td>${db.models.filter(m => m.typeId === t.id).length}</td><td><a href="#/assets?type=${encodeURIComponent(t.id)}">${n}</a></td>
        <td style="text-align:right;white-space:nowrap"><button class="sm" onclick="typeForm(typeOf('${t.id}'))">✎</button> ${t.system || n ? '' : `<button class="sm danger" onclick="deleteType('${t.id}')">🗑</button>`}</td></tr>`;
    }).join('')}</tbody></table></div>
    <div class="row" style="margin-top:24px"><h2 style="margin:0">Models</h2><span class="spacer"></span><button class="primary" onclick="modelForm()">+ New model</button></div>
    <div class="row" style="margin-top:8px"><input id="mq" placeholder="Search model name…" value="${esc(params.get('mq') || '')}" style="min-width:240px">
      <select id="mt"><option value="">All Asset Types</option>${sortHu(db.types, t => t.name).map(t => `<option value="${esc(t.id)}"${t.id === mt ? ' selected' : ''}>${t.icon} ${esc(t.name)}</option>`).join('')}</select>
      <span class="muted">${models.length} of ${db.models.length}</span></div>
    <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th></th><th>Model</th><th>Asset Type</th><th>Assets</th><th></th></tr></thead><tbody>${models.map(m => {
      const n = db.assets.filter(a => a.modelId === m.id).length, img = m.imageId && db.images[m.imageId];
      return `<tr><td style="width:40px">${img ? `<img class="thumb" src="${img}" alt="">` : `<span class="ico">${typeIcon(m.typeId)}</span>`}</td><td><b>${esc(m.name)}</b></td>
        <td><a href="#/assets?type=${encodeURIComponent(m.typeId)}">${typeIcon(m.typeId)} ${esc(typeLabel(m.typeId))}</a></td><td><a href="#/assets?model=${m.id}">${n}</a></td>
        <td style="text-align:right;white-space:nowrap"><button class="sm" onclick="modelForm(model('${m.id}'))">✎</button> ${n ? '' : `<button class="sm danger" onclick="deleteModel('${m.id}')">🗑</button>`}</td></tr>`;
    }).join('') || '<tr><td colspan="5" class="empty">No models yet.</td></tr>'}</tbody></table></div>`;
}
function typeForm(t){
  const isNew = !t; t = t || {name:'', icon:'📦', nameRule:'model', nameUnique:false};
  openDialog(`<h3>${isNew ? 'New Asset Type' : 'Edit Asset Type'}</h3>
    <div class="two"><div><label class="f">Name</label><input name="name" required value="${esc(t.name)}" placeholder="e.g. Monitor"></div>
      <div><label class="f">Icon (emoji)</label><input name="icon" value="${esc(t.icon)}" maxlength="4"></div></div>
    <label class="f">Asset Name</label><select name="nameRule"><option value="model"${t.nameRule === 'model' ? ' selected' : ''}>Uses the Model Name and follows it, unless a name is entered</option><option value="custom"${t.nameRule === 'custom' ? ' selected' : ''}>Custom name required for new assets (e.g. computer name)</option></select>
    <label class="cb"><input type="checkbox" name="nameUnique"${t.nameUnique ? ' checked' : ''}> Asset Name must be unique within this type</label>
    <p class="muted" style="font-size:12px">Entered names are never overwritten. Assign field sets on the Custom Field Sets tab.</p>${dlgActions(isNew ? 'Create' : 'Save')}`,
    data => {
      const name = data.name.trim();
      if (db.types.some(x => x !== t && norm(x.name) === norm(name))){ alert('A type with this name already exists.'); return false; }
      const v = {name, icon:data.icon.trim() || '📦', nameRule:data.nameRule, nameUnique:!!data.nameUnique};
      if (isNew) db.types.push({id:uid(), ...v}); else Object.assign(t, v);
      clog(`Asset Type ${isNew ? 'created' : 'updated'}: ${name}`); save(); render();
    });
}
function deleteType(id){
  if (!confirm(`Delete type “${typeLabel(id)}” and its empty models?`)) return;
  db.models = db.models.filter(m => m.typeId !== id);
  for (const s of db.fieldSets) s.typeIds = s.typeIds.filter(x => x !== id);
  db.types = db.types.filter(x => x.id !== id); save(); render();
}
function modelForm(m){
  const isNew = !m; m = m || {name:'', typeId:'monitor', imageId:null};
  let pendingImg = null;
  const img = m.imageId && db.images[m.imageId];
  openDialog(`<h3>${isNew ? 'New model' : 'Edit model'}</h3>
    <div class="two"><div><label class="f">Asset Type</label><select name="typeId"${!isNew && db.assets.some(a => a.modelId === m.id) ? ' disabled title="Assets of this model exist"' : ''}>${sortHu(db.types, t => t.name).map(t => `<option value="${esc(t.id)}"${t.id === m.typeId ? ' selected' : ''}>${t.icon} ${esc(t.name)}</option>`).join('')}</select></div>
      <div><label class="f">Model Name</label><input name="name" required value="${esc(m.name)}" placeholder="e.g. Dell P2422H"></div></div>
    <label class="f">Image (shown as the icon on every asset of this model)</label>
    <div class="row"><img id="mImgPrev" class="thumb" style="width:64px;height:64px;${img ? '' : 'display:none'}" src="${img || ''}" alt=""><input type="file" id="mImg" accept="image/*"></div>
    ${dlgActions(isNew ? 'Create' : 'Save')}`,
    data => {
      const typeId = data.typeId || m.typeId, name = data.name.trim();
      if (db.models.some(x => x !== m && x.typeId === typeId && norm(x.name) === norm(name))){ alert('This type already has a model with this name.'); return false; }
      clog(`Model ${isNew ? 'created' : 'updated'}: ${name}`);
      if (isNew){ m = {id:uid(), typeId, name, imageId:null}; db.models.push(m); } else Object.assign(m, {typeId, name});
      if (pendingImg){ const iid = uid(); db.images[iid] = pendingImg; m.imageId = iid; }
      save(); render();
    });
  $('#mImg').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { pendingImg = await resizeImage(f); $('#mImgPrev').src = pendingImg; $('#mImgPrev').style.display = ''; } catch(err){ alert(err.message); }
  });
}
function deleteModel(id){ if (confirm(`Delete model “${model(id).name}”?`)){ db.models = db.models.filter(m => m.id !== id); save(); render(); } }

// ---------- custom field sets ----------
function setFields(){
  return `<div class="row"><div class="sub" style="margin:0">First create a field set (e.g. <b>Monitor_Fields</b>), add its fields, then assign it to Asset Types.
    The fields then appear on the forms and pages of those assets.</div><span class="spacer"></span><button class="primary" onclick="fieldSetForm()">+ New field set</button></div>
    ${db.fieldSets.length ? `<div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Field set</th><th>Fields</th><th>Asset Types</th><th></th></tr></thead><tbody>${sortHu(db.fieldSets, s => s.name).map(s =>
      `<tr><td><a href="#/settings/fields/${s.id}"><b>${esc(s.name)}</b></a></td>
        <td>${s.fields.map(f => `<span class="pill"${f.active ? '' : ' style="opacity:.5" title="inactive"'}>${esc(f.name)}${f.required ? ' *' : ''}</span>`).join(' ') || '<span class="muted">no fields</span>'}</td>
        <td>${s.typeIds.map(t => `${typeIcon(t)} ${esc(typeLabel(t))}`).join(', ') || '<span class="muted">not assigned</span>'}</td>
        <td style="text-align:right"><a class="btn sm" href="#/settings/fields/${s.id}">✎ Edit</a></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No field sets yet.</div>'}`;
}
function fieldSetForm(s){
  const isNew = !s; s = s || {name:''};
  openDialog(`<h3>${isNew ? 'New field set' : 'Rename field set'}</h3><label class="f">Name</label><input name="name" required value="${esc(s.name)}" placeholder="e.g. Monitor_Fields">${dlgActions(isNew ? 'Create' : 'Save')}`,
    data => {
      const name = data.name.trim();
      if (db.fieldSets.some(x => x !== s && norm(x.name) === norm(name))){ alert('A field set with this name already exists.'); return false; }
      if (isNew){ const n = {id:uid(), name, typeIds:[], fields:[]}; db.fieldSets.push(n); save(); location.hash = '#/settings/fields/' + n.id; }
      else { s.name = name; save(); render(); }
    });
}
function setFieldSet(id){
  const s = byId(db.fieldSets, id);
  if (!s) return '<div class="empty">Field set not found.</div>';
  const n = db.assets.filter(a => s.typeIds.includes(a.type)).length;
  return `<div class="row"><a href="#/settings/fields">← Custom Field Sets</a></div>
    <div class="row" style="margin-top:8px"><h2 style="margin:0">🧾 ${esc(s.name)}</h2><span class="spacer"></span>
      <button onclick="fieldSetForm(byId(db.fieldSets,'${s.id}'))">✎ Rename</button><button class="danger" onclick="deleteFieldSet('${s.id}')">Delete</button></div>
    <h2>Fields</h2>
    ${s.fields.length ? `<div class="tbl-wrap"><table class="fields"><thead><tr><th>Order</th><th>Field name</th><th>Type</th><th>Required</th><th>Options</th><th>Status</th><th></th></tr></thead><tbody>${s.fields.map((f, i) =>
      `<tr class="${f.active ? '' : 'inactive'}"><td style="white-space:nowrap"><button class="sm" onclick="moveField('${s.id}','${f.id}',-1)"${i ? '' : ' disabled'} title="Up">▲</button> <button class="sm" onclick="moveField('${s.id}','${f.id}',1)"${i < s.fields.length - 1 ? '' : ' disabled'} title="Down">▼</button></td>
       <td><b>${esc(f.name)}</b></td><td>${FIELD_KINDS[f.kind]}</td><td>${f.required ? '✔' : ''}</td><td class="muted">${f.kind === 'select' ? f.options.map(esc).join(', ') : ''}</td>
       <td>${f.active ? '<span class="pill ok">active</span>' : '<span class="pill">inactive</span>'}</td>
       <td style="text-align:right;white-space:nowrap"><button class="sm" onclick="fieldForm('${s.id}','${f.id}')">✎</button> <button class="sm" onclick="toggleField('${s.id}','${f.id}')">${f.active ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No fields yet.</div>'}
    <div class="row" style="margin-top:10px"><button class="primary" onclick="fieldForm('${s.id}')">+ New field</button>
      <span class="muted" style="font-size:12px">A deactivated field is hidden, but recorded values are kept.</span></div>
    <h2>Asset Types using this set</h2>
    <div class="card"><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px">${sortHu(db.types, t => t.name).map(t =>
      `<label class="cb" style="margin:4px 0"><input type="checkbox" data-fst="${esc(t.id)}"${s.typeIds.includes(t.id) ? ' checked' : ''}> ${t.icon} ${esc(t.name)}</label>`).join('')}</div>
      <p class="muted" style="font-size:12px;margin:6px 0 0">These fields currently appear on ${n} asset(s). Changing the assignment deletes no data.</p></div>`;
}
function bindFieldSet(id){
  const s = byId(db.fieldSets, id); if (!s) return;
  document.querySelectorAll('[data-fst]').forEach(c => c.addEventListener('change', () => {
    s.typeIds = c.checked ? [...new Set([...s.typeIds, c.dataset.fst])] : s.typeIds.filter(t => t !== c.dataset.fst);
    save(); render(); toast(`${s.name} ${c.checked ? 'assigned to' : 'removed from'} ${typeLabel(c.dataset.fst)}`);
  }));
}
function fieldForm(setId, fieldId){
  const s = byId(db.fieldSets, setId), f = fieldId ? s.fields.find(x => x.id === fieldId) : null, isNew = !f;
  const v = f || {name:'', kind:'text', required:false, options:[]};
  openDialog(`<h3>${isNew ? 'New field' : 'Edit field'} –${esc(s.name)}</h3>
    <div class="two"><div><label class="f">Field name</label><input name="name" required value="${esc(v.name)}" placeholder="e.g. Screen Size"></div>
      <div><label class="f">Field type</label><select name="kind" id="ffKind">${Object.entries(FIELD_KINDS).map(([k, l]) => `<option value="${k}"${k === v.kind ? ' selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div id="ffOpts"${v.kind === 'select' ? '' : ' style="display:none"'}><label class="f">Options (one per line)</label><textarea name="options" style="width:100%" rows="4">${esc(v.options.join('\n'))}</textarea></div>
    <label class="cb"><input type="checkbox" name="required"${v.required ? ' checked' : ''}> Required field</label>
    ${!isNew && v.kind !== 'text' ? '<p class="muted" style="font-size:12px">Existing values are kept when the field type changes, but they may need checking.</p>' : ''}
    ${dlgActions(isNew ? 'Add' : 'Save')}`,
    data => {
      const opts = (data.options || '').split('\n').map(x => x.trim()).filter(Boolean);
      if (data.kind === 'select' && !opts.length){ alert('A dropdown needs at least one option.'); return false; }
      const nv = {name:data.name.trim(), kind:data.kind, required:!!data.required, options:data.kind === 'select' ? opts : []};
      if (isNew) s.fields.push({id:uid(), ...nv, active:true}); else Object.assign(f, nv);
      clog(`Field ${isNew ? 'added to' : 'updated in'} ${s.name}: ${nv.name}`); save(); render();
    });
  $('#ffKind').addEventListener('change', e => { $('#ffOpts').style.display = e.target.value === 'select' ? '' : 'none'; });
}
function moveField(setId, fieldId, dir){
  const s = byId(db.fieldSets, setId), i = s.fields.findIndex(f => f.id === fieldId), j = i + dir;
  if (j < 0 || j >= s.fields.length) return;
  [s.fields[i], s.fields[j]] = [s.fields[j], s.fields[i]]; save(); render();
}
function toggleField(setId, fieldId){ const f = byId(db.fieldSets, setId).fields.find(x => x.id === fieldId); f.active = !f.active; save(); render(); }
function deleteFieldSet(id){
  const s = byId(db.fieldSets, id);
  if (!confirm(`Delete field set “${s.name}”?\nThe fields disappear from the asset pages, but recorded values stay in the background (a new field with the same name does not bring them back).`)) return;
  db.fieldSets = db.fieldSets.filter(x => x.id !== id); save(); location.hash = '#/settings/fields';
}

// ---------- protocol texts ----------
function setDocs(){
  const s = db.settings;
  return `<div class="card">
    <div class="two">
      <div><label class="f">Company name (header)</label><input id="sCompany" value="${esc(s.company)}"></div>
      <div><label class="f">Address (header)</label><input id="sAddress" value="${esc(s.address)}"></div>
      <div><label class="f">Default IT handler name</label><input id="sHandler" value="${esc(s.handler)}"></div>
    </div>
    <label class="f">Handover statement</label><textarea id="sOut" rows="6" style="width:100%">${esc(s.outText)}</textarea>
    <label class="f">Return statement</label><textarea id="sIn" rows="4" style="width:100%">${esc(s.inText)}</textarea>
    <label class="f">Swap statement</label><textarea id="sSwap" rows="4" style="width:100%">${esc(s.swapText)}</textarea>
    <div class="row" style="margin-top:12px"><button class="primary" onclick="saveDocSettings()">Save</button>
      <button onclick="if(confirm('Restore the default statements?')){Object.assign(db.settings,{outText:DEFAULT_SETTINGS.outText,inText:DEFAULT_SETTINGS.inText,swapText:DEFAULT_SETTINGS.swapText});save();render();}">Restore default text</button>
      <span class="muted" style="font-size:12px">Have the sample statements reviewed by HR / legal.</span></div></div>`;
}
function saveDocSettings(){
  Object.assign(db.settings, {company:$('#sCompany').value.trim(), address:$('#sAddress').value.trim(), handler:$('#sHandler').value.trim(),
    outText:$('#sOut').value.trim(), inText:$('#sIn').value.trim(), swapText:$('#sSwap').value.trim()});
  save(); toast('Settings saved.'); render();
}

// ---------- data ----------
function setData(){
  const kb = Math.round(JSON.stringify(db).length / 1024), imgKb = Math.round(JSON.stringify(db.images).length / 1024);
  return `<div class="sub">Data is stored in this browser (localStorage, signed PDFs in IndexedDB). There is no backend or database. Make regular backups!</div>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
      <div class="card"><b>Backup (export)</b><p class="muted">All data, including images and signed protocols, in one JSON file. Also the way to hand it to a colleague.</p><button class="primary" onclick="exportJSON()">⬇ JSON backup</button></div>
      <div class="card"><b>Restore (import)</b><p class="muted">Load a JSON backup – this overwrites the current data. Older backups are supported.</p><button onclick="$('#importFile').click()">⬆ Load JSON</button></div>
      <div class="card"><b>Import assets</b><p class="muted">From the Excel template (larger orders) or a Snipe-IT export.</p><a class="btn" href="#/import">⬆ Asset import</a></div>
      <div class="card"><b>Import people</b><p class="muted">From Excel: Full Name, Service, Work Mode.</p><a class="btn" href="#/people/import">⬆ People import</a></div>
      <div class="card"><b>Asset list for Excel</b><p class="muted">CSV export of all assets, with custom fields.</p><button onclick="exportCSV()">⬇ CSV</button></div>
      <div class="card"><b>Demo data</b><p class="muted">Restore the sample data (the current data is lost).</p><button onclick="resetDemo()">Load demo</button></div>
      <div class="card"><b>Start empty</b><p class="muted">Delete all data to start with your own assets.</p><button class="danger" onclick="wipe()">Delete everything</button></div>
    </div>
    <h2>Statistics</h2>
    <p>${db.assets.length} assets (last Asset ID: ${db.seq.asset ? fmtAssetId(db.seq.asset) : '–'}) · ${db.people.length} people · ${db.services.length} Services · ${db.rooms.length} rooms · ${db.projects.length} projects ·
      ${db.docs.length} protocols (${db.docs.filter(d => d.fileId).length} signed) · ${db.log.length} log entries</p>
    <p class="muted">Storage used: about ${kb} KB (images: ${imgKb} KB) of the browser's roughly 5000 KB limit.</p>`;
}
async function exportJSON(){
  const files = {};
  for (const d of db.docs) if (d.fileId){
    const rec = await idb.get(d.fileId).catch(() => null);
    if (rec) files[d.fileId] = {name:rec.name, type:rec.type, data:await blobToDataURL(rec.blob)};
  }
  download(`tc-itam-backup-${stamp()}.json`, JSON.stringify({...db, files}, null, 2), 'application/json');
}
async function importJSONFile(f){
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.assets) || !Array.isArray(d.people) || !Array.isArray(d.rooms)) throw new Error('Not a TC IT Asset Management backup.');
    if (!confirm(`Load it? ${d.assets.length} assets, ${d.people.length} people. The current data is overwritten.`)) return;
    const files = d.files || {}; delete d.files;
    await idb.clear();
    for (const [id, x] of Object.entries(files)) await idb.put(id, {name:x.name, type:x.type, blob:await (await fetch(x.data)).blob()});
    db = migrate(d); save(); location.hash = '#/'; render();
  } catch(err){ alert('Invalid file: ' + err.message); }
}
function resetDemo(){ if (confirm('Restore the demo data? The current data and uploaded signed documents are lost.')){ idb.clear().catch(() => {}); db = demo(); save(); location.hash = '#/'; render(); } }
function wipe(){ if (confirm('ALL data is deleted, including uploaded signed documents. Are you sure? (Make a JSON backup first.)')){ idb.clear().catch(() => {}); db = migrate({version:2, modes:DEFAULT_MODES.map(m => ({...m}))}); save(); location.hash = '#/'; render(); } }

// ---------- log user ----------
function setUser(){
  return `<div class="card" style="max-width:520px"><b>Who is working in this browser?</b>
    <p class="muted">The prototype has no login. The name entered here goes into the “By” column of the log (stored in this browser only).</p>
    <label class="f">Name</label><input id="uName" value="${esc(currentUser())}" list="uList" placeholder="e.g. Molnár Tamás"><datalist id="uList">${sortHu(db.people, p => p.name).map(p => `<option value="${esc(p.name)}">`).join('')}</datalist>
    <div class="row" style="margin-top:12px"><button class="primary" onclick="saveUser()">Save</button></div></div>`;
}
function saveUser(){ try { localStorage.setItem(USER_KEY, $('#uName').value.trim()); } catch(e) {} toast('Saved – this name appears in the log.'); renderUserChip(); }
