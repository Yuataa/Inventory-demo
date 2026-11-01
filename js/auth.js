'use strict';
/* Accounts, roles and permissions, Admin Panel, Branding.
   Everything here runs in the browser: the checks keep the interface and its actions consistent, but they are not server-side security. */

function can(key){
  if (tour.on) return true;
  const a = currentAccount();
  if (!a || !a.enabled) return false;
  return a.role === 'Superadmin' || !!(db.permissions[a.role] || {})[key];
}
const roleCan = (role, key) => role === 'Superadmin' || !!(db.permissions[role] || {})[key];
const moveTargetPerm = () => (($('#moveSel') || {}).value || '').startsWith('person') ? 'assets.assign' : 'assets.move';

// which permission each action needs; a function decides from its first argument
const GUARDS = {
  assetForm:a => a ? 'assets.edit' : 'assets.create', deleteAsset:'assets.delete', bulkStatus:'assets.edit',
  bulkMove:hs => String(hs || '').startsWith('person') ? 'assets.assign' : 'assets.move', quickMove:moveTargetPerm, toStorage:'assets.move', returnAll:'assets.move',
  assignAssetDialog:'assets.assign', swapDialog:'assets.assign', exportCSV:'assets.export', runImport:'assets.import',
  personForm:p => p ? 'people.edit' : 'people.create', deletePerson:'people.delete', ticketDialog:'people.status', removeTicket:'people.status', markReturn:'people.status', runPeopleImport:'people.import',
  officeForm:'floorplan.office', deleteOffice:'floorplan.office', roomForm:r => r ? 'floorplan.details' : 'floorplan.createRoom', fpStart:'floorplan.edit', deleteRoom:'floorplan.delete', placeFromSite:'floorplan.edit',
  projectForm:p => p ? 'projects.edit' : 'projects.create', deleteProject:'projects.delete', completeProject:'projects.complete', addParticipantDialog:'projects.edit', demandDialog:'projects.edit',
  replacementDialog:'projects.edit', setRepState:'projects.edit', shipmentDialog:'projects.ship', shipAction:'projects.ship', removeShipment:'projects.ship',
  docDialog:'documents.create', uploadSigned:'documents.upload', deleteDoc:'documents.delete', saveDocSettings:'documents.templates', labelDialog:'labels.print',
  serviceForm:'settings.services', deleteService:'settings.services', roleForm:'settings.roles', deleteRole:'settings.roles', modeForm:'settings.modes', deleteMode:'settings.modes',
  typeForm:'settings.types', deleteType:'settings.types', modelForm:'settings.types', deleteModel:'settings.types',
  fieldSetForm:'settings.fields', deleteFieldSet:'settings.fields', fieldForm:'settings.fields', moveField:'settings.fields', toggleField:'settings.fields', resetDashboard:'settings.dashboard',
  exportJSON:'settings.data', resetDemo:'settings.data', wipe:'settings.data',
  accountForm:'admin.accounts', deleteAccount:'admin.accounts', toggleAccount:'admin.accounts', setPerm:'admin.permissions', resetPerms:'admin.permissions', saveBranding:'admin.branding', resetBranding:'admin.branding',
};
const guardPerm = (name, arg) => { const g = GUARDS[name]; return typeof g === 'function' ? g(arg) : g; };
// the actions themselves refuse, so a kept button or a console call cannot get past the check either
for (const name of Object.keys(GUARDS)){
  const fn = window[name];
  if (typeof fn !== 'function') continue;
  window[name] = function(...args){
    const key = guardPerm(name, args[0]);
    if (can(key)) return fn.apply(this, args);
    toast('⛔ You do not have permission for this action.');
  };
}
// buttons that lead to a refused action are removed from the page
function applyPerms(){
  const v = $('#view');
  for (const el of v.querySelectorAll('[onclick]')){
    const m = /^\s*(\w+)\((.*)/.exec(el.getAttribute('onclick')); if (!m || !GUARDS[m[1]]) continue;
    const raw = m[2].trim(), arg = !raw || raw.startsWith(')') || raw.startsWith('null') ? undefined : raw.replace(/^'/, '').replace(/'.*$/, '');
    if (!can(guardPerm(m[1], arg))) el.remove();
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
  const t = document.querySelector('[onclick="startTour()"]'); if (t) t.hidden = currentAccount().role === 'Visitor';
}
function routePerm(r, sub){
  if (r === 'import') return 'assets.import';
  if (r === 'people' && sub === 'import') return 'people.import';
  const mod = {asset:'assets', assets:'assets', people:'people', person:'people', rooms:'floorplan', room:'floorplan', projects:'projects', project:'projects', docs:'documents', log:'logs'}[r];
  return mod ? mod + '.view' : r === 'admin' ? 'admin.view' : r === 'settings' ? null : 'overview.view';
}
const deniedHtml = () => `<div class="empty"><h2>Access denied</h2><p>Your account (${esc(currentUser())}, ${esc(currentAccount().role)}) does not have access to this page.</p></div>`;

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
function admAccounts(){
  return `<div class="row"><span class="spacer"></span><button class="primary" onclick="accountForm()">+ New account</button></div>
    <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>Username</th><th>Display name</th><th>Role</th><th>Status</th><th>Linked person</th><th></th></tr></thead><tbody>${sortHu(db.accounts, a => a.username).map(a =>
      `<tr><td class="tag">${esc(a.username)}</td><td>${esc(a.displayName)}</td><td><span class="pill ${a.role === 'Superadmin' ? 'acc' : ''}">${a.role}</span></td>
        <td><span class="pill ${a.enabled ? 'ok' : 'bad'}">${a.enabled ? 'Enabled' : 'Disabled'}</span></td>
        <td>${a.personId && person(a.personId) ? personLink(a.personId) : '<span class="muted">No person linked</span>'}</td>
        <td style="text-align:right;white-space:nowrap"><button class="sm" onclick="accountForm(account('${a.id}'))">✎</button> <button class="sm" onclick="toggleAccount('${a.id}')">${a.enabled ? 'Disable' : 'Enable'}</button> <button class="sm danger" onclick="deleteAccount('${a.id}')">🗑</button></td></tr>`).join('')}</tbody></table></div>`;
}
function accountForm(a){
  const isNew = !a; a = a || {username:'', displayName:'', role:'Visitor', enabled:true, personId:null};
  const isSuper = currentAccount().role === 'Superadmin';
  const linked = new Set(db.accounts.filter(x => x !== a && x.personId).map(x => x.personId));
  openDialog(`<h3>${isNew ? 'New account' : 'Edit account'}</h3>
    <div class="two"><div><label class="f">Username</label><input name="username" required value="${esc(a.username)}"></div>
      <div><label class="f">Display name (shown in the log)</label><input name="displayName" required value="${esc(a.displayName)}"></div>
      <div><label class="f">Role</label><select name="role">${ROLES.filter(r => isSuper || r !== 'Superadmin' || a.role === r).map(r => `<option${r === a.role ? ' selected' : ''}>${r}</option>`).join('')}</select></div>
      <div><label class="f">Linked person (optional)</label><select name="personId"><option value="">– No person linked –</option>${sortHu(db.people.filter(p => !linked.has(p.id)), p => p.name).map(p => `<option value="${p.id}"${p.id === a.personId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div></div>
    <p class="muted" style="font-size:12px">Unlinking keeps both the account and the person.</p>${dlgActions(isNew ? 'Create' : 'Save')}`,
    data => {
      const username = data.username.trim();
      if (db.accounts.some(x => x !== a && norm(x.username) === norm(username))){ alert('This username already exists.'); return false; }
      if (!isNew && a.role === 'Superadmin' && data.role !== 'Superadmin' && a.enabled && enabledSupers().length < 2){ alert('The last enabled Superadmin must stay a Superadmin.'); return false; }
      const v = {username, displayName:data.displayName.trim(), role:data.role, personId:data.personId || null};
      if (isNew) db.accounts.push({id:uid(), ...v, enabled:true}); else Object.assign(a, v);
      clog(`Account ${isNew ? 'created' : 'updated'}: ${username} (${data.role})`); save(); render(); applyAccountUi();
    });
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
  const box = (role, key, on) => `<input type="checkbox" onchange="setPerm('${role}','${key}',this.checked)"${on ? ' checked' : ''}>`;
  const rows = MODULES.flatMap(m => permKeys(m).map(k => {
    const op = k.split('.')[1], label = op === 'menu' ? 'Show in menu' : op === 'view' ? 'Access content' : m.ops[op];
    return `<tr><td>${esc(m.name)}</td><td>${esc(label)}</td><td class="cb">✔ <small class="muted">locked</small></td><td class="cb">${box('Admin', k, db.permissions.Admin[k])}</td><td class="cb">${box('Visitor', k, db.permissions.Visitor[k])}</td></tr>`;
  })).join('');
  return `<div class="row"><div class="sub" style="margin:0">Superadmin always has full access; this cannot be changed.</div><span class="spacer"></span><button onclick="resetPerms()">Reset to defaults</button></div>
    <div class="tbl-wrap nosort" style="margin-top:10px"><table class="perms"><thead><tr><th>Module</th><th>Permission</th><th>Superadmin</th><th>Admin</th><th>Visitor</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function setPerm(role, key, on){
  if (!['Admin', 'Visitor'].includes(role)) return;     // Superadmin has no stored permissions at all
  db.permissions[role][key] = !!on; clog(`Permission ${key} for ${role}: ${on ? 'allowed' : 'denied'}`); save(); applyNav();
}
function resetPerms(){
  if (!confirm('Reset Admin and Visitor permissions to the defaults?')) return;
  db.permissions = {Admin:defaultPerms('Admin'), Visitor:defaultPerms('Visitor')}; clog('Permissions reset to defaults'); save(); render(); applyNav();
}
let previewWho = 'role:Visitor';
function permSummary(role, enabled = true){
  const has = k => enabled && roleCan(role, k);
  return MODULES.map(m => {
    const ops = Object.entries(m.ops).map(([o, l]) => [l, has(`${m.id}.${o}`)]);
    const view = m.noMenu ? ops.some(x => x[1]) : has(`${m.id}.view`);
    return {name:m.name, menu:m.noMenu ? null : has(`${m.id}.menu`), view, ops, viewOnly:view && !m.noMenu && ops.length > 0 && !ops.some(x => x[1])};
  });
}
function admPreview(){
  const [k, id] = previewWho.split(':'), acc = k === 'acc' ? account(id) : null, role = acc ? acc.role : id, sum = permSummary(role, acc ? acc.enabled : true);
  return `<div class="row"><label class="muted">Preview for</label><select id="pvWho">
      <optgroup label="Roles">${ROLES.map(r => `<option value="role:${r}"${previewWho === 'role:' + r ? ' selected' : ''}>${r}</option>`).join('')}</optgroup>
      <optgroup label="Accounts">${db.accounts.map(a => `<option value="acc:${a.id}"${previewWho === 'acc:' + a.id ? ' selected' : ''}>${esc(a.displayName)} (${a.role})</option>`).join('')}</optgroup></select>
      <span class="muted">Read-only: this page changes nothing.</span></div>
    ${acc && !acc.enabled ? '<div class="warnbox">This account is disabled, so it has no access.</div>' : ''}
    <div class="tbl-wrap nosort" style="margin-top:10px"><table id="pvTable"><thead><tr><th>Module</th><th>In menu</th><th>Access</th><th>Allowed actions</th><th>Denied actions</th></tr></thead><tbody>${sum.map(s =>
      `<tr><td><b>${esc(s.name)}</b></td><td>${s.menu === null ? '<span class="muted">–</span>' : s.menu ? '✔' : '✕'}</td>
       <td>${s.view ? (s.viewOnly ? '<span class="pill warn">View only</span>' : '<span class="pill ok">Yes</span>') : '<span class="pill bad">No</span>'}</td>
       <td>${s.ops.filter(o => o[1]).map(o => esc(o[0])).join(', ') || '<span class="muted">–</span>'}</td><td class="muted">${s.ops.filter(o => !o[1]).map(o => esc(o[0])).join(', ') || '–'}</td></tr>`).join('')}</tbody></table></div>`;
}
function bindAdmin(){ const s = $('#pvWho'); if (s) s.addEventListener('change', () => { previewWho = s.value; render(); }); bindBranding(); }

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
function applyAccountUi(){ applyNav(); if (typeof renderUserChip === 'function') renderUserChip(); }
