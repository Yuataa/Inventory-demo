'use strict';
/* Accounts, roles and permissions, Admin Panel, Branding.
   Everything here runs in the browser: the checks keep the interface and its actions consistent, but they are not server-side security. */

// ---------- location access ----------
// settings and admin apply to the whole system; everything else is decided per office
const isGlobalKey = k => /^(settings|admin)\./.test(k) || k === 'documents.templates' || k === 'labels.presets';
function roleCan(role, key){
  if (role === 'Superadmin') return true;
  if (role === 'VIEW') return /\.(menu|view)$/.test(key) && !/^(settings|admin)\./.test(key);
  return !!(db.permissions[role] || {})[key];
}
// the role that applies for this account at this office, or null for no access. An office entry beats its country.
function locRole(acct, oid){
  if (!acct || !acct.enabled) return null;
  if (acct.role === 'Superadmin') return 'Superadmin';
  const o = office(oid); if (!o) return null;
  const loc = acct.locations || {}, own = loc['o:' + oid], x = own && own !== 'inherit' ? own : loc['c:' + o.countryId] || 'none';
  return x === 'none' ? null : x === 'view' ? 'VIEW' : x === 'role' ? acct.role : x;
}
const accessibleOffices = (acct = currentAccount()) => tour.on ? db.offices : db.offices.filter(o => locRole(acct, o.id));
function canAt(key, oid, acct = currentAccount()){
  if (tour.on) return true;
  const r = locRole(acct, oid);
  return !!r && roleCan(r, key);
}
function can(key, offices){
  if (tour.on) return true;
  const a = currentAccount();
  if (!a || !a.enabled) return false;
  if (a.role === 'Superadmin') return true;
  if (isGlobalKey(key)) return roleCan(a.role, key);
  return (offices && offices.length ? offices : scopeOfficeIds()).some(o => canAt(key, o, a));
}

// ---------- Country / Office selection ----------
const scope = {countryId:'', officeId:''};
try { Object.assign(scope, JSON.parse(localStorage.getItem(SCOPE_KEY) || '{}')); } catch(e) {}
function ensureScope(){
  const offs = accessibleOffices(), cs = sortHu(db.countries.filter(c => offs.some(o => o.countryId === c.id)), c => c.name);
  if (!cs.some(c => c.id === scope.countryId)) scope.countryId = cs.length ? cs[0].id : '';
  if (!offs.some(o => o.id === scope.officeId && o.countryId === scope.countryId)) scope.officeId = '';
}
function scopeOfficeIds(){
  ensureScope();
  return accessibleOffices().filter(o => o.countryId === scope.countryId && (!scope.officeId || o.id === scope.officeId)).map(o => o.id);
}
function saveScope(){ try { localStorage.setItem(SCOPE_KEY, JSON.stringify(scope)); } catch(e) {} }
function setScope(countryId, officeId){ Object.assign(scope, {countryId, officeId:officeId || ''}); saveScope(); selected.clear(); applyNav(); render(); }
function renderScope(){
  const el = $('#scopeBar'); if (!el) return;
  ensureScope();
  const offs = accessibleOffices(), cs = sortHu(db.countries.filter(c => offs.some(o => o.id && o.countryId === c.id)), c => c.name);
  el.innerHTML = `<label>Country <select id="scopeCountry">${cs.map(c => `<option value="${c.id}"${c.id === scope.countryId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label>City / Office <select id="scopeOffice"><option value="">All Offices</option>${sortHu(offs.filter(o => o.countryId === scope.countryId), o => o.name).map(o => `<option value="${o.id}"${o.id === scope.officeId ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>`;
  $('#scopeCountry').addEventListener('change', e => setScope(e.target.value, ''));
  $('#scopeOffice').addEventListener('change', e => setScope(scope.countryId, e.target.value));
}
// an asset in transit counts for its sending office; the transit view shows it at both ends
function scopeOf(a){ if (a.holder.kind === 'transit'){ const s = findShipment(a.holder.id); return s ? [s.fromOfficeId, s.toOfficeId] : [a.officeId]; } return [assetOfficeId(a)]; }
function scopedAssets(both){
  const ids = new Set(scopeOfficeIds());
  return db.assets.filter(a => a.holder.kind === 'transit' ? (both ? scopeOf(a).some(o => ids.has(o)) : ids.has(a.officeId)) : ids.has(assetOfficeId(a)));
}
const scopedPeople = () => { const ids = new Set(scopeOfficeIds()); return db.people.filter(p => ids.has(p.officeId)); };
function projectOffices(pr){
  const assets = projectAssetIds(pr).map(asset).filter(Boolean).map(a => a.officeId), ppl = pr.participants.map(x => (person(x.personId) || {}).officeId);
  return [...new Set([pr.officeId, ...pr.shipments.flatMap(s => [s.fromOfficeId, s.toOfficeId]), (room(pr.targetRoomId) || {}).officeId, ...assets, ...ppl].filter(Boolean))];
}
const scopedProjects = () => { const ids = new Set(scopeOfficeIds()); return db.projects.filter(pr => projectOffices(pr).some(o => ids.has(o))); };
const scopedDocs = () => { const ids = new Set(scopedPeople().map(p => p.id)); return db.docs.filter(d => ids.has(d.personId) || !person(d.personId)); };
function scopedLog(){
  const a = new Set(scopedAssets(true).map(x => x.id)), p = new Set(scopedPeople().map(x => x.id)), r = new Set(scopedProjects().map(x => x.id));
  return db.log.filter(l => l.assetId && asset(l.assetId) ? a.has(l.assetId) : l.projectId && project(l.projectId) ? r.has(l.projectId) : l.personId && person(l.personId) ? p.has(l.personId) : true);
}
// a record outside the current selection stays hidden: with access the user is offered the switch, otherwise it is denied
function scopeGate(offices, what){
  const ids = scopeOfficeIds();
  if (offices.some(o => ids.includes(o))) return null;
  const o = offices.map(office).find(x => x && accessibleOffices().some(y => y.id === x.id));
  if (!o) return deniedHtml();
  return `<div class="empty"><h2>${esc(what)} belongs to ${esc(o.name)}</h2><p><button class="primary" onclick="setScope('${o.countryId}','${o.id}')">Switch to ${esc((country(o.countryId) || {}).name || '')} · ${esc(o.name)}</button></p></div>`;
}
function routeGate(r, id){
  if (r === 'asset'){ const a = asset(id); return a ? scopeGate(scopeOf(a).filter(Boolean), 'This asset') : null; }
  if (r === 'person'){ const p = person(id); return p ? scopeGate([p.officeId], 'This person') : null; }
  if (r === 'room'){ const x = room(id); return x ? scopeGate([x.officeId], 'This room') : null; }
  if (r === 'project'){ const x = project(id); return x ? scopeGate(projectOffices(x), 'This project') : null; }
  return null;
}

const moveTargetPerm = () => (($('#moveSel') || {}).value || '').startsWith('person') ? 'assets.assign' : 'assets.move';

// which permission each action needs; a function decides from the action's arguments
const GUARDS = {
  assetForm:a => a ? 'assets.edit' : 'assets.create', deleteAsset:'assets.delete', bulkStatus:'assets.edit',
  bulkMove:hs => String(hs || '').startsWith('person') ? 'assets.assign' : 'assets.move', quickMove:moveTargetPerm, toStorage:'assets.move', returnAll:'assets.move',
  assignAssetDialog:'assets.assign', swapDialog:'assets.assign', exportCSV:'assets.export', runImport:'assets.import',
  personForm:p => p ? 'people.edit' : 'people.create', deletePerson:'people.delete', ticketDialog:'people.status', removeTicket:'people.status', markReturn:'people.status', runPeopleImport:'people.import',
  officeForm:'floorplan.office', deleteOffice:'floorplan.office', countryForm:'floorplan.office', deleteCountry:'floorplan.office', roomForm:r => r ? 'floorplan.details' : 'floorplan.createRoom', fpStart:'floorplan.edit', deleteRoom:'floorplan.delete', placeFromSite:'floorplan.edit',
  projectForm:p => p ? 'projects.edit' : 'projects.create', deleteProject:'projects.delete', completeProject:'projects.complete', addParticipantDialog:'projects.edit', demandDialog:'projects.edit',
  replacementDialog:'projects.edit', setRepState:'projects.edit', shipmentDialog:'projects.shipCreate', removeShipment:'projects.shipCreate',
  shipAction:(p, s, act) => act === 'receive' ? 'projects.shipReceive' : 'projects.shipSend',
  docDialog:'documents.create', uploadSigned:'documents.upload', deleteDoc:'documents.delete', saveDocSettings:'documents.templates', labelDialog:'labels.print',
  serviceForm:'settings.services', deleteService:'settings.services', roleForm:'settings.roles', deleteRole:'settings.roles', modeForm:'settings.modes', deleteMode:'settings.modes',
  typeForm:'settings.types', deleteType:'settings.types', modelForm:'settings.types', deleteModel:'settings.types',
  fieldSetForm:'settings.fields', deleteFieldSet:'settings.fields', fieldForm:'settings.fields', moveField:'settings.fields', toggleField:'settings.fields', resetDashboard:'settings.dashboard',
  exportJSON:'settings.data', resetDemo:'settings.data', wipe:'settings.data',
  accountForm:'admin.accounts', deleteAccount:'admin.accounts', toggleAccount:'admin.accounts', setPerm:'admin.permissions', resetPerms:'admin.permissions', accessRoleForm:'admin.permissions', deleteAccessRole:'admin.permissions', saveBranding:'admin.branding', resetBranding:'admin.branding',
};
// the offices an action touches: it must be allowed at every one of them
const aOff = x => { const a = typeof x === 'string' ? asset(x) : x; return a ? [a.officeId] : []; };
const pOff = x => { const p = typeof x === 'string' ? person(x) : x; return p ? [p.officeId] : []; };
const rOff = x => { const r = typeof x === 'string' ? room(x) : x; return r ? [r.officeId] : []; };
const selOff = () => [...selected].map(asset).filter(Boolean).map(a => a.officeId);
const prOff = x => { const p = typeof x === 'string' ? project(x) : x; return p ? projectOffices(p) : []; };
const GUARD_OFF = {
  assetForm:aOff, deleteAsset:aOff, toStorage:aOff, quickMove:aOff, swapDialog:aOff, bulkMove:selOff, bulkStatus:selOff,
  personForm:pOff, deletePerson:pOff, ticketDialog:pOff, removeTicket:pOff, roomForm:rOff, fpStart:rOff, deleteRoom:rOff,
  labelDialog:ids => [].concat(ids || []).map(asset).filter(Boolean).map(a => a.officeId),
  shipAction:(p, sid, act) => { const s = findShipment(sid); return s ? [act === 'receive' ? s.toOfficeId : s.fromOfficeId].filter(Boolean) : []; },
};
const guardPerm = (name, args) => { const g = GUARDS[name]; return typeof g === 'function' ? g(...args) : g; };
function guardOk(name, args){
  const key = guardPerm(name, args), f = GUARD_OFF[name], offs = f ? f(...args).filter(Boolean) : [];
  return offs.length && !isGlobalKey(key) ? tour.on || currentAccount().role === 'Superadmin' || offs.every(o => canAt(key, o)) : can(key);
}
// the actions themselves refuse, so a kept button or a console call cannot get past the check either
for (const name of Object.keys(GUARDS)){
  const fn = window[name];
  if (typeof fn !== 'function') continue;
  window[name] = function(...args){
    if (guardOk(name, args)) return fn.apply(this, args);
    toast('⛔ You do not have permission for this action.');
  };
}
// buttons that lead to a refused action are removed from the page
function applyPerms(){
  const v = $('#view');
  for (const el of v.querySelectorAll('[onclick]')){
    const m = /^\s*(\w+)\((.*)/.exec(el.getAttribute('onclick')); if (!m || !GUARDS[m[1]]) continue;
    const raw = m[2].trim(), args = !raw || raw.startsWith(')') || raw.startsWith('null') ? [] : [...raw.matchAll(/'([^']*)'/g)].map(x => x[1]);
    if (!guardOk(m[1], args)) el.remove();
  }
  if (!can('assets.import')) v.querySelectorAll('a[href="#/import"]').forEach(e => e.remove());
  if (!can('people.import')) v.querySelectorAll('a[href="#/people/import"]').forEach(e => e.remove());
  if (!can('settings.dashboard')) v.querySelectorAll('a[href="#/settings/dashboard"]').forEach(e => e.remove());
  if (!can('projects.edit')) v.querySelectorAll('[data-pp],[data-dadd],[data-dqty],[data-dprep],[data-dlink],[data-drm],[data-dun],[data-rm-other],[data-rm-part],#prStatus').forEach(e => { e.disabled = true; });
  if (!can('assets.move') && !can('assets.assign')) v.querySelectorAll('#moveSel, .selbox, #selAll').forEach(e => { e.disabled = true; });
}
const NAV_PERM = {'':'overview', assets:'assets', people:'people', rooms:'floorplan', projects:'projects', docs:'documents', log:'logs', settings:'settings', admin:'admin'};
function applyNav(){
  document.querySelectorAll('#nav a').forEach(a => { a.hidden = !can(NAV_PERM[a.dataset.r] + '.menu'); });
  const t = document.querySelector('[onclick="startTour()"]'); if (t) t.hidden = currentAccount().role === 'Viewer';
}
function routePerm(r, sub){
  if (r === 'import') return 'assets.import';
  if (r === 'people' && sub === 'import') return 'people.import';
  const mod = {asset:'assets', assets:'assets', people:'people', person:'people', rooms:'floorplan', room:'floorplan', projects:'projects', project:'projects', docs:'documents', log:'logs'}[r];
  return mod ? mod + '.view' : r === 'admin' ? 'admin.view' : r === 'settings' ? null : 'overview.view';
}
const deniedHtml = () => `<div class="empty"><h2>Access denied</h2><p>Your account (${esc(currentUser())}, ${esc(roleLabel(currentAccount().role))}) does not have access to this page.</p></div>`;

// ---------- Admin Panel ----------
const ADMIN_TABS = [['accounts', '👥 Accounts', 'admin.accounts'], ['permissions', '🔐 Roles & Permissions', 'admin.permissions'], ['preview', '👁 Permission Preview', 'admin.permissions'], ['branding', '🎨 Branding', 'admin.branding']];
function viewAdmin(tab){
  const tabs = ADMIN_TABS.filter(t => can(t[2]));
  if (!tabs.length) return deniedHtml();
  tab = tabs.some(t => t[0] === tab) ? tab : tabs[0][0];
  const body = {accounts:admAccounts, permissions:admPerms, preview:admPreview, branding:admBranding}[tab]();
  return `<h1>Admin Panel</h1><div class="sub">System accounts and access. People are managed separately in the People module.</div>
    <div class="tabs">${tabs.map(([k, l]) => `<a href="#/admin/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>${body}
    <div class="warnbox" style="margin-top:16px">Prototype limit: accounts and permissions live in this browser, without passwords or a server. They keep the interface consistent but are not real security.</div>`;
}
const enabledSupers = () => db.accounts.filter(a => a.enabled && a.role === 'Superadmin');
const accessText = a => a.role === 'Superadmin' ? 'All locations · Full access'
  : db.countries.map(c => { const v = (a.locations || {})['c:' + c.id] || 'none'; return `${c.name}: ${v === 'none' ? 'No Access' : v === 'view' ? 'View Only' : v === 'role' ? 'Role' : roleLabel(v)}`; }).join(' · ');
function admAccounts(){
  return `<div class="row"><span class="spacer"></span><button class="primary" onclick="accountForm()">+ New account</button></div>
    <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>Username</th><th>Display name</th><th>Role</th><th>Status</th><th>Location access</th><th>Linked person</th><th></th></tr></thead><tbody>${sortHu(db.accounts, a => a.username).map(a =>
      `<tr><td class="tag">${esc(a.username)}</td><td>${esc(a.displayName)}</td><td><span class="pill ${a.role === 'Superadmin' ? 'acc' : ''}">${esc(roleLabel(a.role))}</span></td>
        <td><span class="pill ${a.enabled ? 'ok' : 'bad'}">${a.enabled ? 'Enabled' : 'Disabled'}</span></td><td class="muted">${esc(accessText(a))}</td>
        <td>${a.personId && person(a.personId) ? personLink(a.personId) : '<span class="muted">No person linked</span>'}</td>
        <td style="text-align:right;white-space:nowrap"><button class="sm" onclick="accountForm(account('${a.id}'))">✎</button> <button class="sm" onclick="toggleAccount('${a.id}')">${a.enabled ? 'Disable' : 'Enable'}</button> <button class="sm danger" onclick="deleteAccount('${a.id}')">🗑</button></td></tr>`).join('')}</tbody></table></div>`;
}
function accountForm(a){
  const isNew = !a; a = a || {username:'', displayName:'', role:'Viewer', enabled:true, personId:null, locations:{['c:' + scope.countryId]:'role'}};
  const isSuper = currentAccount().role === 'Superadmin', loc = a.locations || {};
  const linked = new Set(db.accounts.filter(x => x !== a && x.personId).map(x => x.personId));
  const levels = (cur, inherit) => `${inherit ? `<option value="inherit">Same as country</option>` : ''}<option value="none"${cur === 'none' ? ' selected' : ''}>No Access</option><option value="view"${cur === 'view' ? ' selected' : ''}>View Only</option><option value="role"${cur === 'role' ? ' selected' : ''}>Account role</option>
    ${db.accessRoles.filter(r => r.id !== 'Superadmin').map(r => `<option value="${esc(r.id)}"${cur === r.id ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}`;
  openDialog(`<h3>${isNew ? 'New account' : 'Edit account'}</h3>
    <div class="two"><div><label class="f">Username</label><input name="username" required value="${esc(a.username)}"></div>
      <div><label class="f">Display name (shown in the log)</label><input name="displayName" required value="${esc(a.displayName)}"></div>
      <div><label class="f">Role</label><select name="role" id="acRole">${db.accessRoles.filter(r => isSuper || r.id !== 'Superadmin' || a.role === r.id).map(r => `<option value="${esc(r.id)}"${r.id === a.role ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
      <div><label class="f">Linked person (optional)</label><select name="personId"><option value="">– No person linked –</option>${sortHu(db.people.filter(p => !linked.has(p.id)), p => p.name).map(p => `<option value="${p.id}"${p.id === a.personId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div></div>
    <div id="acLocs"><label class="f">Country and office access</label><div class="checklist">${sortHu(db.countries, c => c.name).map(c => `<div class="locrow"><b>${esc(c.name)}</b><select name="loc_c:${c.id}">${levels(loc['c:' + c.id] || 'none')}</select></div>
      ${sortHu(db.offices.filter(o => o.countryId === c.id), o => o.name).map(o => `<div class="locrow sub">${esc(o.name)}<select name="loc_o:${o.id}">${levels(loc['o:' + o.id] || 'inherit', true)}</select></div>`).join('')}`).join('')}</div>
      <p class="muted" style="font-size:12px">“Account role” uses the role above. An office setting overrides its country.</p></div>
    <p class="muted" style="font-size:12px" id="acSuper">Superadmin has full access to every location; this cannot be limited.</p>
    <p class="muted" style="font-size:12px">Unlinking keeps both the account and the person.</p>${dlgActions(isNew ? 'Create' : 'Save')}`,
    data => {
      const username = data.username.trim();
      if (db.accounts.some(x => x !== a && norm(x.username) === norm(username))){ alert('This username already exists.'); return false; }
      if (!isNew && a.role === 'Superadmin' && data.role !== 'Superadmin' && a.enabled && enabledSupers().length < 2){ alert('The last enabled Superadmin must stay a Superadmin.'); return false; }
      const locations = {};
      for (const [k, x] of Object.entries(data)) if (k.startsWith('loc_') && x !== 'inherit') locations[k.slice(4)] = x;
      const v = {username, displayName:data.displayName.trim(), role:data.role, personId:data.personId || null, locations};
      if (isNew) db.accounts.push({id:uid(), ...v, enabled:true}); else Object.assign(a, v);
      clog(`Account ${isNew ? 'created' : 'updated'}: ${username} (${roleLabel(data.role)})`); save(); render(); applyAccountUi();
    });
  const sync = () => { const s = $('#acRole').value === 'Superadmin'; $('#acLocs').hidden = s; $('#acSuper').hidden = !s; };
  $('#acRole').addEventListener('change', sync); sync();
}
function toggleAccount(id){
  const a = account(id);
  if (a.enabled && a.role === 'Superadmin' && enabledSupers().length < 2){ alert('The last enabled Superadmin cannot be disabled.'); return; }
  a.enabled = !a.enabled; clog(`Account ${a.enabled ? 'enabled' : 'disabled'}: ${a.username}`); save(); render(); applyAccountUi();
}
function deleteAccount(id){
  const a = account(id);
  if (a.role === 'Superadmin' && a.enabled && enabledSupers().length < 2){ alert('The last enabled Superadmin cannot be deleted.'); return; }
  if (!confirm(`Delete account ${a.username}?\nA linked person stays in People.`)) return;
  clog(`Account deleted: ${a.username}`); db.accounts = db.accounts.filter(x => x !== a); save(); render(); applyAccountUi();
}
function admPerms(){
  const roles = db.accessRoles.filter(r => r.id !== 'Superadmin');
  const box = (role, key, on) => `<input type="checkbox" data-perm="${esc(role)}|${key}" onchange="setPerm('${esc(role)}','${key}',this.checked)"${on ? ' checked' : ''}>`;
  const rows = MODULES.flatMap(m => permKeys(m).map(k => {
    const op = k.split('.')[1], label = op === 'menu' ? 'Show in menu' : op === 'view' ? 'View Access' : m.ops[op];
    return `<tr><td>${esc(m.name)}</td><td>${esc(label)}</td><td class="cb">✔</td>${roles.map(r => `<td class="cb">${box(r.id, k, db.permissions[r.id][k])}</td>`).join('')}</tr>`;
  })).join('');
  return `<div class="row"><div class="sub" style="margin:0"><b>Superadmin</b> always has full access to every location, module and action. It cannot be edited or deleted.</div><span class="spacer"></span>
      <button class="primary" onclick="accessRoleForm()">+ New role</button><button onclick="resetPerms()">Reset built-in roles</button></div>
    <div class="tbl-wrap nosort" style="margin-top:10px"><table class="perms"><thead><tr><th>Module</th><th>Permission</th><th>Superadmin 🔒</th>${roles.map(r => `<th>${esc(r.name)}${r.builtin ? '' : `<br><button class="sm" onclick="accessRoleForm(byId(db.accessRoles,'${r.id}'))">✎</button> <button class="sm danger" onclick="deleteAccessRole('${r.id}')">🗑</button>`}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
function accessRoleForm(r){
  const isNew = !r; r = r || {name:''};
  openDialog(`<h3>${isNew ? 'New role' : 'Rename role'}</h3><label class="f">Role name</label><input name="name" required value="${esc(r.name)}" placeholder="e.g. Shipment Manager">
    ${isNew ? `<label class="f">Start from</label><select name="base"><option value="">No permissions</option>${db.accessRoles.filter(x => x.id !== 'Superadmin').map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select>` : ''}
    ${dlgActions(isNew ? 'Create' : 'Save')}`,
    data => {
      const name = data.name.trim();
      if (db.accessRoles.some(x => x !== r && norm(x.name) === norm(name))){ alert('A role with this name already exists.'); return false; }
      if (isNew){ const n = {id:uid(), name, builtin:false}; db.accessRoles.push(n); db.permissions[n.id] = data.base ? {...db.permissions[data.base]} : defaultPerms(n.id); }
      else r.name = name;
      clog(`Role ${isNew ? 'created' : 'renamed'}: ${name}`); save(); render();
    });
}
function deleteAccessRole(id){
  const r = byId(db.accessRoles, id);
  if (!r || r.builtin){ alert('Built-in roles cannot be deleted.'); return; }
  const users = db.accounts.filter(a => a.role === id || Object.values(a.locations || {}).includes(id));
  if (users.length){ alert(`Role “${r.name}” is used by:\n\n• ${users.map(a => a.username).join('\n• ')}\n\nAssign another role to these accounts first.`); return; }
  if (!confirm(`Delete role “${r.name}”?`)) return;
  clog(`Role deleted: ${r.name}`); db.accessRoles = db.accessRoles.filter(x => x !== r); delete db.permissions[id]; save(); render();
}
function setPerm(role, key, on){
  if (role === 'Superadmin' || !db.permissions[role]) return;     // Superadmin has no stored permissions at all
  db.permissions[role][key] = !!on; clog(`Permission ${key} for ${roleLabel(role)}: ${on ? 'allowed' : 'denied'}`); save(); applyNav();
}
function resetPerms(){
  if (!confirm('Reset the Admin and Viewer permissions to the defaults? Custom roles stay as they are.')) return;
  db.permissions.Admin = defaultPerms('Admin'); db.permissions.Viewer = defaultPerms('Viewer'); clog('Permissions reset to defaults'); save(); render(); applyNav();
}
let previewWho = 'role:Viewer', previewOffice = '';
function permSummary(role){
  const has = k => !!role && roleCan(role, k);
  return MODULES.map(m => {
    const ops = Object.entries(m.ops).map(([o, l]) => [l, has(`${m.id}.${o}`)]);
    const view = m.noMenu ? ops.some(x => x[1]) : has(`${m.id}.view`);
    return {name:m.name, menu:m.noMenu ? null : has(`${m.id}.menu`), view, ops, viewOnly:view && !m.noMenu && ops.length > 0 && !ops.some(x => x[1])};
  });
}
function locSummary(role){
  if (!role) return '<span class="pill bad">No Access</span>';
  if (role === 'Superadmin') return '<span class="pill ok">Full Access</span>';
  const edit = MODULES.some(m => Object.keys(m.ops).some(o => roleCan(role, `${m.id}.${o}`)));
  return edit ? `<span class="pill ok">View/Edit</span>${role !== 'VIEW' ? ` <small class="muted">${esc(roleLabel(role))}</small>` : ''}` : '<span class="pill warn">View Only</span>';
}
function admPreview(){
  const [k, id] = previewWho.split(':'), acc = k === 'acc' ? account(id) : null, role = acc ? acc.role : id;
  const at = oid => acc ? locRole(acc, oid) : role;
  const off = office(previewOffice) ? previewOffice : sortHu(db.offices, o => o.name)[0].id, sum = permSummary(at(off));
  return `<div class="row"><label class="muted">Preview for</label><select id="pvWho">
      <optgroup label="Roles">${db.accessRoles.map(r => `<option value="role:${esc(r.id)}"${previewWho === 'role:' + r.id ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</optgroup>
      <optgroup label="Accounts">${db.accounts.map(a => `<option value="acc:${a.id}"${previewWho === 'acc:' + a.id ? ' selected' : ''}>${esc(a.displayName)} (${esc(roleLabel(a.role))})</option>`).join('')}</optgroup></select>
      <span class="muted">Read-only: this page changes nothing.</span></div>
    ${acc && !acc.enabled ? '<div class="warnbox">This account is disabled, so it has no access.</div>' : ''}
    ${role === 'Superadmin' ? '<div class="okbox">Superadmin: full access to every location, module and action.</div>' : ''}
    ${acc ? `<h2>Location access</h2><div class="tbl-wrap nosort"><table id="pvLoc"><thead><tr><th>Location</th><th>Access</th></tr></thead><tbody>${sortHu(db.countries, c => c.name).map(c => {
      const os = sortHu(db.offices.filter(o => o.countryId === c.id), o => o.name), roles = os.map(o => at(o.id));
      return `<tr><td><b>${esc(c.name)}</b></td><td>${roles.some(Boolean) ? locSummary(roles.find(Boolean)) : locSummary(null)}</td></tr>` + os.map((o, i) => `<tr><td style="padding-left:28px">${esc(o.name)}</td><td>${locSummary(roles[i])}</td></tr>`).join('');
    }).join('')}</tbody></table></div>` : ''}
    <h2>Modules and actions</h2>
    ${acc ? `<div class="row" style="margin-bottom:8px"><label class="muted">At office</label><select id="pvOffice">${sortHu(db.offices, o => o.name).map(o => `<option value="${o.id}"${o.id === off ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select></div>` : ''}
    <div class="tbl-wrap nosort"><table id="pvTable"><thead><tr><th>Module</th><th>In menu</th><th>Access</th><th>Allowed actions</th><th>Denied actions</th></tr></thead><tbody>${sum.map(s =>
      `<tr><td><b>${esc(s.name)}</b></td><td>${s.menu === null ? '<span class="muted">–</span>' : s.menu ? '✔' : '✕'}</td>
       <td>${s.view ? (s.viewOnly ? '<span class="pill warn">View only</span>' : '<span class="pill ok">Yes</span>') : '<span class="pill bad">No</span>'}</td>
       <td>${s.ops.filter(o => o[1]).map(o => esc(o[0])).join(', ') || '<span class="muted">–</span>'}</td><td class="muted">${s.ops.filter(o => !o[1]).map(o => esc(o[0])).join(', ') || '–'}</td></tr>`).join('')}</tbody></table></div>`;
}
function bindAdmin(){
  const s = $('#pvWho'); if (s) s.addEventListener('change', () => { previewWho = s.value; render(); });
  const o = $('#pvOffice'); if (o) o.addEventListener('change', () => { previewOffice = o.value; render(); });
  bindBranding();
}

// ---------- branding ----------
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lum = h => { const c = hexRgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const mixHex = (h, t, r) => '#' + hexRgb(h).map((v, i) => Math.round(v + (hexRgb(t)[i] - v) * r).toString(16).padStart(2, '0')).join('');
// keeps the chosen hue but moves it towards readable, whatever colour was picked
function readable(h, bg){ for (let r = 0; r <= 1; r += .05){ const c = mixHex(h, lum(bg) > .5 ? '#000000' : '#ffffff', r); if (contrast(c, bg) >= 4.5) return c; } return lum(bg) > .5 ? '#000000' : '#ffffff'; }
function brandCss(b){
  const vars = (bg, soft) => {
    const out = [];
    if (b.primary) out.push(`--accent:${readable(b.primary, bg)}`, `--brand:${b.primary}`, `--on-brand:${contrast(b.primary, '#ffffff') >= contrast(b.primary, '#000000') ? '#fff' : '#000'}`, `--accent-soft:${mixHex(b.primary, bg, soft)}`);
    if (b.secondary) out.push(`--secondary:${b.secondary}`);
    return out.join(';');
  };
  const dark = vars('#1c2027', .82);
  return `:root{${vars('#ffffff', .88)}}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${dark}}}:root[data-theme="dark"]{${dark}}`;
}
function applyBranding(b = db.settings.branding){
  let s = $('#brandCss');
  if (!s){ s = document.createElement('style'); s.id = 'brandCss'; document.head.appendChild(s); }
  s.textContent = brandCss(b);
  document.documentElement.dataset.corners = b.corners || 'rounded';
  const logo = b.logoId && db.images[b.logoId], el = $('#brandLogo');
  if (el) el.innerHTML = logo ? `<img src="${logo}" alt="Company logo">` : '🗄️';
}
let brandDraft = null;
function admBranding(){
  const b = brandDraft ||= {...db.settings.branding, logoData:null};
  const logo = b.logoData || (b.logoId && db.images[b.logoId]);
  return `<div class="tplgrid"><div class="card">
      <label class="f">Company logo</label><div class="row">${logo ? `<img class="thumb" style="width:64px;height:64px" src="${logo}" alt="">` : ''}<input type="file" id="brLogo" accept="image/*">${logo ? '<button type="button" class="sm" id="brNoLogo">Remove</button>' : ''}</div>
      <div class="two"><div><label class="f">Primary color</label><input type="color" id="brP" value="${esc(b.primary || '#2f6fed')}"></div>
        <div><label class="f">Secondary color</label><input type="color" id="brS" value="${esc(b.secondary || '#7c3aed')}"></div>
        <div><label class="f">Corners</label><select id="brC"><option value="rounded"${b.corners !== 'square' ? ' selected' : ''}>Rounded</option><option value="square"${b.corners === 'square' ? ' selected' : ''}>Square</option></select></div></div>
      <p class="muted" style="font-size:12px" id="brNote"></p>
      <div class="row" style="margin-top:10px"><button class="primary" onclick="saveBranding()">Save</button><button onclick="resetBranding('prev')"${db.settings.branding.prev ? '' : ' disabled'}>Restore previous</button><button onclick="resetBranding('default')">Restore default</button></div></div>
    <div class="card"><b>Preview</b><div id="brPrev" style="margin-top:10px"></div></div></div>`;
}
function brandPreview(){
  const b = brandDraft, f = $('#brPrev'); if (!f) return;
  const logo = b.logoData || (b.logoId && db.images[b.logoId]);
  const p = b.primary || '#2f6fed', s = b.secondary || '#7c3aed', txt = contrast(p, '#ffffff') >= contrast(p, '#000000') ? '#fff' : '#000';
  f.innerHTML = `<div class="row" style="border-bottom:3px solid ${s};padding-bottom:8px">${logo ? `<img src="${logo}" alt="" style="height:28px">` : '🗄️'} <b>TC IT Asset Management</b></div>
    <p><button type="button" style="background:${p};border-color:${p};color:${txt}">Primary button</button> <a href="#/admin/branding" style="color:${readable(p, '#ffffff')}">Link color</a></p>
    <div class="card" style="border-color:${s};background:${mixHex(p, '#ffffff', .88)};color:#1d2330"><b>Highlighted tile</b></div>`;
  $('#brNote').textContent = 'Text colors are adjusted automatically so they stay readable in light and dark mode.';
}
function bindBranding(){
  if (!$('#brP')) return;
  const set = (k, id) => $(id).addEventListener('input', () => { brandDraft[k] = $(id).value; brandPreview(); });
  set('primary', '#brP'); set('secondary', '#brS'); set('corners', '#brC');
  $('#brLogo').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { brandDraft.logoData = await resizeImage(f, 400); render(); } catch(err){ alert(err.message); }
  });
  const rm = $('#brNoLogo'); if (rm) rm.addEventListener('click', () => { Object.assign(brandDraft, {logoId:null, logoData:null}); render(); });
  brandPreview();
}
function saveBranding(){
  const cur = db.settings.branding, {logoData, ...v} = brandDraft;
  if (logoData){ v.logoId = uid(); db.images[v.logoId] = logoData; }
  const {prev, ...before} = cur;
  db.settings.branding = {...v, prev:before};
  clog('Branding saved'); save(); brandDraft = null; applyBranding(); render(); toast('Branding saved.');
}
function resetBranding(which){
  const cur = db.settings.branding;
  db.settings.branding = which === 'prev' && cur.prev ? {...cur.prev, prev:null} : {...DEFAULT_BRANDING};
  clog(`Branding restored (${which === 'prev' ? 'previous' : 'default'})`); save(); brandDraft = null; applyBranding(); render();
}
function applyAccountUi(){ ensureScope(); applyNav(); if (typeof renderUserChip === 'function') renderUserChip(); }
