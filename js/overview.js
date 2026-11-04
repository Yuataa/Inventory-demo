'use strict';
/* Overview: widgets with display modes, a per-account layout and a chart builder.
   The layout lives in db.prefs[account], so one person's changes never alter another account's dashboard.
   Every number and chart is computed from the live data each time the page is drawn. */

const MODE_LABEL = {compact:'Compact', normal:'Normal', detailed:'Detailed', pie:'Pie Chart', doughnut:'Doughnut Chart', bar:'Bar Chart', line:'Line Chart', stats:'Statistics', list:'Detailed List'};
const SIZE_MODE = {compact:'compact', normal:'normal', wide:'detailed'};
const CONFIGURABLE = ['office', 'assigned', 'storage', 'health', 'warranty'];
const CHART_COLORS = ['#2f6fed', '#12a150', '#c77700', '#d92d20', '#7c3aed', '#0e7490', '#db2777', '#65a30d', '#475569', '#ea580c'];

// the account's own layout; it starts from the admin default (Settings → Dashboard) and the older show/hide choices
function dashLayout(){
  const p = myPrefs(), base = db.settings.dashboard.items;
  p.overview ||= {items:base.map(i => ({id:i.id, visible:(p.dash || {})[i.id] ?? i.visible, mode:SIZE_MODE[i.size] || 'normal'})), charts:{}};
  const o = p.overview;
  o.charts ||= {};
  o.items = o.items.filter(i => DASH_ITEMS[i.id] || o.charts[i.id]);
  for (const i of base) if (!o.items.some(x => x.id === i.id)) o.items.push({id:i.id, visible:i.visible, mode:SIZE_MODE[i.size] || 'normal'});
  return o;
}
const layoutItem = id => dashLayout().items.find(i => i.id === id);
const isChart = id => !!dashLayout().charts[id];
const widgetTitle = id => isChart(id) ? dashLayout().charts[id].title : DASH_ITEMS[id];
const modesFor = id => isChart(id) ? chartTypesFor(dashLayout().charts[id]) : ['compact', 'normal', 'detailed'];
const widgetMode = it => isChart(it.id) ? dashLayout().charts[it.id].chart : it.mode || 'normal';

// ---------- built-in tiles ----------
function tileQuery(id, cfg = {}){
  const d = {...db.settings.dashboard.defaults, ...cfg}, p = new URLSearchParams();
  const set = (k, v) => { if (v) p.set(k, v); };
  if (id !== 'total') p.set('view', id);
  if (id !== 'health') p.set('status', 'active');
  if (id === 'office') set('room', d.officeRoom);
  if (id === 'assigned'){ set('mode', d.assignedMode); set('service', d.assignedService); }
  if (id === 'storage') set('type', d.storageType);
  if (id === 'health') set('health', d.healthCat);
  return p;
}
const chipsBy = (list, key, label, href) => { const m = new Map(); for (const a of list){ const k = key(a); m.set(k, (m.get(k) || 0) + 1); }
  return `<div class="tbreak">${[...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `<a class="tchip" href="${href(k)}">${esc(label(k))} <b>${n}</b></a>`).join('') || '<span class="muted">–</span>'}</div>`; };
// what a tile shows; the same filter that opens the list counts the number, so the two always match
function tileData(it){
  const id = it.id, cfg = it.cfg || {};
  const assetsAt = q => ({list:filterAssets(new URLSearchParams(q)), href:'#/assets?' + q});
  if (DASH_BREAKDOWN.includes(id)){ const P = tileQuery(id, cfg); return {list:filterAssets(P), href:'#/assets' + (P.toString() ? '?' + P : '')}; }
  if (id === 'lost' || id === 'missing') return assetsAt('status=' + id);
  if (id === 'faulty') return assetsAt('view=health&health=faulty');
  if (id === 'transit') return assetsAt('view=transit');
  if (id === 'returns'){ const ids = new Set(scopedAssets(true).map(a => a.id)), rs = db.returns.filter(r => r.state === 'awaiting' && ids.has(r.assetId));
    return {n:rs.length, href:'#/assets?view=awaiting', items:[...new Set(rs.map(r => r.personId))].map(pid => personLink(pid))}; }
  if (id === 'projects'){ const ps = scopedProjects().filter(isActive); return {n:ps.length, href:'#/projects?status=active', items:ps.map(pr => `<a href="#/project/${pr.id}">${esc(pr.name)}</a>`)}; }
  if (id === 'unsigned'){ const ds = scopedDocs().filter(d => !d.fileId); return {n:ds.length, href:'#/docs?f=wait', items:ds.map(d => `<span class="tag">${esc(d.no)}</span>`)}; }
  const ppl = scopedPeople().filter(p => uncovered(p.id).length);
  return {n:ppl.reduce((s, p) => s + uncovered(p.id).length, 0), href:'#/docs', items:ppl.map(p => personLink(p.id))};
}
function dashTile(it){
  const mode = it.mode || 'normal', t = tileData(it), n = t.list ? t.list.length : t.n, q = t.href.split('?')[1] || '';
  let body = '';
  if (mode !== 'compact'){
    if (it.id === 'storage') body += `<small class="muted">${t.list.filter(a => a.status === 'ok').length} working and available</small>`;
    if (it.id === 'health') body += `<div class="tsplit"><a href="#/assets?view=health&health=faulty">Faulty <b>${t.list.filter(isFaulty).length}</b></a><a href="#/assets?view=health&health=aged">Aged <b>${t.list.filter(isAged).length}</b></a><a href="#/assets?view=health&health=both">Both <b>${t.list.filter(a => isFaulty(a) && isAged(a)).length}</b></a></div>`;
    if (t.list) body += typeBreak(t.list, q);
    else if (mode === 'normal' && t.items.length) body += `<small class="muted">${t.items.slice(0, 3).join(', ')}${t.items.length > 3 ? ` +${t.items.length - 3}` : ''}</small>`;
  }
  if (mode === 'detailed'){
    if (t.list){
      body += `<div class="wsub">By status</div>${chipsBy(t.list, a => a.status, k => STATUS[k].label, k => `#/assets?${q ? q + '&' : ''}status=${k}`)}`;
      body += `<div class="wsub">By office</div>${chipsBy(t.list, a => assetOfficeId(a) || '', k => k ? officeLabel(k) : 'In transit', k => k ? `#/assets?${q ? q + '&' : ''}office=${k}` : '#/assets?view=transit')}`;
    } else body += t.items.length ? `<ul class="wlist">${t.items.slice(0, 12).map(x => `<li>${x}</li>`).join('')}</ul>${t.items.length > 12 ? `<small class="muted">+${t.items.length - 12} more</small>` : ''}` : '<small class="muted">Nothing here.</small>';
  }
  return `<div class="card tile widget w-${mode}" data-w="${it.id}"><a class="tmain" href="${t.href}"><span class="n">${n}</span><span class="l">${esc(DASH_ITEMS[it.id])} ›</span></a>${body}${menuBtn(it.id)}</div>`;
}

// ---------- built-in lists; compact shows the count only, detailed shows more rows ----------
function dashSection(it){
  const id = it.id, mode = it.mode || 'normal', lim = mode === 'detailed' ? 50 : 8, cfg = it.cfg || {};
  const wrap = (n, body, href) => `<section class="card widget wsec w-${mode}" data-w="${id}"><div class="whead"><h2>${esc(DASH_ITEMS[id])}${n !== null ? ` <span class="muted">(${n})</span>` : ''}</h2>${menuBtn(id)}</div>
    ${mode === 'compact' ? (href ? `<a class="tmain" href="${href}"><span class="n">${n}</span><span class="l">Open ›</span></a>` : '') : body}</section>`;
  const more = (n, href) => n > lim ? `<p><a href="${href}">All ${n} ›</a></p>` : '';
  if (id === 'warranty'){
    const days = +cfg.days || 60, list = sortHu(scopedAssets().filter(a => { const w = warranty(a); return w.days !== null && w.days <= days && a.status !== 'retired'; }), a => a.warrantyUntil);
    return wrap(list.length, list.length ? assetRows(list.slice(0, lim)) + more(list.length, '#/assets?warr=bad') : `<div class="empty">Nothing expires within ${days} days.</div>`, '#/assets?warr=bad');
  }
  if (id === 'models'){
    const pool = scopedAssets(), list = db.models.map(m => [m, pool.filter(a => a.modelId === m.id).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]);
    return wrap(list.length, list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Model</th><th>Type</th><th>Count</th></tr></thead><tbody>${list.slice(0, mode === 'detailed' ? 50 : 10).map(([m, n]) =>
      `<tr><td><a href="#/assets?model=${m.id}">${esc(m.name)}</a></td><td><a href="#/assets?type=${encodeURIComponent(m.typeId)}">${typeIcon(m.typeId)} ${esc(typeLabel(m.typeId))}</a></td><td><a href="#/assets?model=${m.id}"><b>${n}</b></a></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">–</div>', '#/assets');
  }
  if (id === 'services'){
    const svcs = sortHu(db.services, s => s.name);
    return wrap(svcs.length, `<div class="grid">${svcs.map(s => { const ppl = scopedPeople().filter(p => p.serviceId === s.id);
      return `<a class="card stat" href="#/people?service=${s.id}"><div class="n">${ppl.length}</div><div class="l">🧩 ${esc(s.name)} · ${db.modes.map(m => `${m.icon}${ppl.filter(p => p.mode === m.id).length}`).join(' ')}</div></a>`; }).join('') || '<div class="empty">No Services yet – create them in Settings.</div>'}</div>`, '#/settings/services');
  }
  if (id === 'remote'){
    const list = sortHu(scopedPeople().filter(p => modeBehavior(p.mode) !== 'onsite'), p => p.name);
    return wrap(list.length, list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Service</th><th>Work Mode</th><th>Assets</th></tr></thead><tbody>${list.slice(0, lim).map(p =>
      `<tr><td>${personLink(p.id)}</td><td>${esc(serviceName(p.serviceId))}</td><td>${modePill(p.mode)}</td><td>${personAssets(p.id).direct.map(a => `<a class="chip" href="#/asset/${a.id}">${typeIcon(a.type)} ${esc(a.tag)}</a>`).join(' ') || '<span class="muted">–</span>'}</td></tr>`).join('')}</tbody></table></div>${more(list.length, '#/people')}` : '<div class="empty">Nobody in these modes.</div>', '#/people');
  }
  if (id === 'activeList'){
    const list = sortHu(scopedProjects().filter(isActive), pr => pr.pickupDate || '9999');
    return wrap(list.length, list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Project Name</th><th>Status</th><th>Project Owner</th><th>Progress</th></tr></thead><tbody>${list.slice(0, lim).map(pr => { const n = projectProgress(pr);
      return `<tr><td><a href="#/project/${pr.id}">${esc(pr.name)}</a></td><td>${projectStatusPill(pr.status)}</td><td>${esc(pr.owner) || '<span class="muted">–</span>'}</td><td data-v="${n}"><div class="progress" title="${n}%"><i style="width:${n}%"></i></div><small class="muted">${n}%</small></td></tr>`; }).join('')}</tbody></table></div>${more(list.length, '#/projects?status=active')}` : '<div class="empty">No active projects.</div>', '#/projects?status=active');
  }
  if (id === 'awaitList'){
    // only real return records count: being assigned to a person does not mean an asset is expected back
    const ids = new Set(scopedAssets(true).map(a => a.id)), by = new Map();
    for (const r of db.returns) if (r.state === 'awaiting' && ids.has(r.assetId)) by.set(r.personId, [...(by.get(r.personId) || []), r]);
    const rows = sortHu([...by], ([pid]) => (person(pid) || {}).name || '');
    return wrap(rows.length, rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Person</th><th>Assets</th><th>Summary</th><th>Return State</th></tr></thead><tbody>${rows.slice(0, lim).map(([pid, rs]) => {
      const as = rs.map(r => asset(r.assetId)).filter(Boolean), late = rs.some(returnOverdue), due = rs.map(returnDue).filter(Boolean).sort()[0];
      return `<tr><td>${personLink(pid)}</td><td><a href="#/assets?view=awaiting&person=${pid}"><b>${as.length}</b></a></td><td>${as.map(a => `<a class="chip" href="#/asset/${a.id}" title="${esc(assetName(a))}">${typeIcon(a.type)} ${esc(a.tag)}</a>`).join(' ')}</td>
        <td><span class="pill ${late ? 'bad' : due ? 'warn' : ''}">${late ? 'Overdue' : 'Awaiting Return'}</span> <small class="muted">${due ? 'due ' + esc(due) : 'No deadline set'}</small></td></tr>`; }).join('')}</tbody></table></div>${more(rows.length, '#/assets?view=awaiting')}` : '<div class="empty">No returns are expected.</div>', '#/assets?view=awaiting');
  }
  if (id === 'equip'){
    // only assets held by a person directly; stock and office assets are not anyone's equipment
    const rows = scopedPeople().map(p => [p, personAssets(p.id).direct]).filter(x => x[1].length).sort((a, b) => b[1].length - a[1].length || String(a[0].name).localeCompare(b[0].name, 'hu'));
    return wrap(rows.length, rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Person</th><th>Service</th><th>In Use</th><th>Needs Attention</th></tr></thead><tbody>${rows.slice(0, lim).map(([p, as]) => {
      const inUse = as.filter(isActiveAsset), bad = as.filter(a => !isActiveAsset(a)), types = [...new Set(inUse.map(a => a.type))];
      return `<tr><td>${personLink(p.id)}</td><td>${esc(serviceName(p.serviceId)) || '<span class="muted">–</span>'}</td>
        <td data-v="${inUse.length}">${types.map(t => `<a class="tchip" href="#/assets?person=${p.id}&type=${encodeURIComponent(t)}" title="${esc(typeLabel(t))}">${typeIcon(t)} <b>${inUse.filter(a => a.type === t).length}</b> <span>${esc(typeLabel(t))}</span></a>`).join(' ') || '<span class="muted">–</span>'}</td>
        <td data-v="${bad.length}">${bad.map(a => `<a href="#/asset/${a.id}" title="${esc(a.tag)}">${statusPill(a.status)}</a>`).join(' ') || '<span class="muted">–</span>'}</td></tr>`; }).join('')}</tbody></table></div>${more(rows.length, '#/assets?view=assigned')}` : '<div class="empty">Nobody holds an asset directly.</div>', '#/assets?view=assigned');
  }
  const log = id === 'moves' ? scopedLog().filter(l => ['moved', 'checkout', 'returned'].includes(l.cat)) : scopedLog();
  return wrap(null, logTable(log.slice(0, lim)) + more(log.length, '#/log'), '#/log');
}

// ---------- the page ----------
const menuBtn = id => `<button type="button" class="wmenu-btn" onclick="widgetMenu(this)" aria-haspopup="menu" aria-label="Options for ${esc(widgetTitle(id))}" title="Widget options">⋮</button>`;
function viewDashboard(){
  const o = dashLayout(), shown = o.items.filter(i => i.visible);
  const body = shown.map(it => isChart(it.id) ? chartWidget(it) : DASH_SECTIONS.includes(it.id) ? dashSection(it) : dashTile(it)).join('');
  return `<div class="row"><h1>Overview</h1><span class="spacer"></span><button onclick="chartDialog()">＋ Add chart</button><button class="primary" onclick="customizeOverview()">⚙ Customize Overview</button><a class="btn" href="#/settings/dashboard" title="The starting layout for accounts that have not customized theirs">Default layout</a></div>
    <div class="sub">The state of all IT assets at a glance. Click a number to open the filtered list. Your layout is saved for your account in this browser.</div>
    ${shown.length ? `<div class="dash">${body}</div>` : `<div class="empty card"><h2>All widgets are hidden</h2><p>Nothing is lost: show them again in Customize Overview.</p><button class="primary" onclick="customizeOverview()">⚙ Customize Overview</button></div>`}`;
}
function bindDashboard(){}

// ---------- widget menu: hide, display mode, configure, right on the card ----------
let wmenu = null;
function closeWMenu(){ if (wmenu){ wmenu.remove(); wmenu = null; } }
function widgetMenu(btn){
  const id = btn.closest('[data-w]').dataset.w, again = wmenu && wmenu.dataset.for === id;
  closeWMenu(); if (again) return;
  const it = layoutItem(id), cur = widgetMode(it), conf = isChart(id) || CONFIGURABLE.includes(id);
  const m = document.createElement('div');
  m.className = 'wmenu'; m.dataset.for = id; m.setAttribute('role', 'menu');
  m.innerHTML = `<button type="button" role="menuitem" data-wa="hide">🙈 Hide widget</button><div class="wm-h">Change display mode</div>
    ${modesFor(id).map(x => `<button type="button" role="menuitemradio" aria-checked="${x === cur}" data-wa="mode" data-m="${x}">${x === cur ? '● ' : '○ '}${MODE_LABEL[x]}</button>`).join('')}
    ${conf ? '<div class="wm-h"></div><button type="button" role="menuitem" data-wa="cfg">⚙ Configure…</button>' : ''}`;
  document.body.appendChild(m); wmenu = m;
  const r = btn.getBoundingClientRect();
  m.style.top = Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8) + 'px';
  m.style.left = Math.max(8, r.right - m.offsetWidth) + 'px';
  m.addEventListener('click', e => {
    const b = e.target.closest('[data-wa]'); if (!b) return;
    closeWMenu();
    if (b.dataset.wa === 'hide'){ it.visible = false; save(); render(); toast(`“${widgetTitle(id)}” hidden. Customize Overview brings it back.`); }
    if (b.dataset.wa === 'mode'){ if (isChart(id)) dashLayout().charts[id].chart = b.dataset.m; else it.mode = b.dataset.m; save(); render(); }
    if (b.dataset.wa === 'cfg') isChart(id) ? chartDialog(id) : configureWidget(id);
  });
  m.querySelector('button').focus();
}
document.addEventListener('mousedown', e => { if (wmenu && !e.target.closest('.wmenu,.wmenu-btn')) closeWMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && wmenu) closeWMenu(); });
window.addEventListener('hashchange', closeWMenu);

function configureWidget(id){
  const it = layoutItem(id), c = {...db.settings.dashboard.defaults, days:60, ...(it.cfg || {})};
  const sel = (name, list, cur, all) => `<select name="${name}" style="width:100%"><option value="">${all}</option>${list.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const ids = scopeOfficeIds();
  const fields = {
    office:`<label class="f">Room</label>${sel('officeRoom', sortHu(db.rooms.filter(r => ids.includes(r.officeId)), r => roomPath(r)).map(r => [r.id, roomPath(r)]), c.officeRoom, 'All rooms')}`,
    assigned:`<label class="f">Work Mode</label>${sel('assignedMode', db.modes.map(m => [m.id, m.name]), c.assignedMode, 'All')}<label class="f">Service</label>${sel('assignedService', sortHu(db.services, s => s.name).map(s => [s.id, s.name]), c.assignedService, 'All')}`,
    storage:`<label class="f">Asset Type</label>${sel('storageType', sortHu(db.types, t => t.name).map(t => [t.id, t.name]), c.storageType, 'All')}`,
    health:`<label class="f">Category</label>${sel('healthCat', [['faulty', 'Faulty'], ['aged', 'Aged'], ['both', 'Faulty and Aged']], c.healthCat, 'All')}`,
    warranty:`<label class="f">Show warranties ending within</label>${sel('days', [30, 60, 90, 180, 365].map(d => [String(d), d + ' days']), String(c.days), '60 days')}`,
  };
  openDialog(`<h3>Configure: ${esc(DASH_ITEMS[id])}</h3>${fields[id]}<p class="muted" style="font-size:12px">This changes your Overview only.</p>${dlgActions('Save')}`,
    data => { it.cfg = Object.fromEntries(Object.entries(data).filter(([, v]) => v)); save(); render(); });
}

// ---------- Customize Overview: every widget, hidden ones included; order, visibility, display mode ----------
function customizeOverview(){
  const o = dashLayout();
  const row = it => `<div class="cvcol" data-w="${it.id}"><button type="button" class="sm" data-up aria-label="Move up">↑</button><button type="button" class="sm" data-down aria-label="Move down">↓</button>
    <label class="cb"><input type="checkbox" data-vis${it.visible ? ' checked' : ''}> ${esc(widgetTitle(it.id))}</label>${isChart(it.id) ? ' <span class="pill acc">chart</span>' : ''}<span class="spacer"></span>
    <select data-mode aria-label="Display mode">${modesFor(it.id).map(m => `<option value="${m}"${m === widgetMode(it) ? ' selected' : ''}>${MODE_LABEL[m]}</option>`).join('')}</select>
    ${isChart(it.id) ? `<button type="button" class="sm" data-edit>Edit</button><button type="button" class="sm danger" data-del>Delete</button>` : ''}</div>`;
  openDialog(`<h3>Customize Overview</h3><p class="muted" style="margin-top:0">All widgets are listed here, also the hidden ones. Tick to show, use the arrows to reorder. Applies to your account only.</p>
    <div class="checklist" id="coList" style="max-height:52vh">${o.items.map(row).join('')}</div>
    <p><button type="button" id="coAdd">＋ Add chart or statistic</button></p>
    <div class="actions"><button type="button" id="coReset" style="margin-right:auto">Reset to default</button><button value="cancel" formnovalidate>Cancel</button><button class="primary" value="ok" id="dlgOk">Save</button></div>`,
    () => { apply(); save(); render(); }, {wide:true});
  const apply = () => {
    const rows = [...document.querySelectorAll('#coList [data-w]')];
    o.items = rows.map(r => { const it = o.items.find(x => x.id === r.dataset.w), m = r.querySelector('[data-mode]').value;
      it.visible = r.querySelector('[data-vis]').checked; if (isChart(it.id)) o.charts[it.id].chart = m; else it.mode = m; return it; });
  };
  $('#coList').addEventListener('click', e => {
    const r = e.target.closest('[data-w]'); if (!r) return;
    if ('up' in e.target.dataset && r.previousElementSibling) r.parentNode.insertBefore(r, r.previousElementSibling);
    if ('down' in e.target.dataset && r.nextElementSibling) r.parentNode.insertBefore(r.nextElementSibling, r);
    if ('edit' in e.target.dataset){ apply(); save(); $('#dlg').close(); chartDialog(r.dataset.w); }
    if ('del' in e.target.dataset && confirm(`Delete the chart “${widgetTitle(r.dataset.w)}”?`)){ delete o.charts[r.dataset.w]; o.items = o.items.filter(x => x.id !== r.dataset.w); r.remove(); save(); }
  });
  $('#coAdd').addEventListener('click', () => { apply(); save(); $('#dlg').close(); chartDialog(); });
  $('#coReset').addEventListener('click', () => {
    if (!confirm('Reset your Overview to the default layout? Your own charts are removed.')) return;
    const p = myPrefs(); delete p.overview; delete p.dash; save(); $('#dlg').close(); render(); toast('Overview reset to the default.');
  });
}

// ---------- chart data: sources and groupings that exist in the data model ----------
const ym = ts => ts ? (typeof ts === 'number' ? new Date(ts).toISOString() : String(ts)).slice(0, 7) : '';
const ASSET_BY = {
  type:{label:'Asset Type', get:a => [a.type], name:typeLabel, href:k => '#/assets?type=' + encodeURIComponent(k)},
  status:{label:'Status', get:a => [a.status], name:k => (STATUS[k] || {}).label || k, href:k => '#/assets?status=' + k},
  office:{label:'City / Office', get:a => [assetOfficeId(a) || ''], name:k => k ? officeLabel(k) : 'In transit', href:k => k ? '#/assets?office=' + k : '#/assets?view=transit'},
  country:{label:'Country', get:a => [officeCountry(a.officeId).id || ''], name:k => (country(k) || {}).name || '–'},
  service:{label:'Service', get:a => [a.serviceId || (assetPerson(a) || {}).serviceId || ''], name:k => serviceName(k) || 'No Service', href:k => k ? '#/assets?service=' + k : null},
  assignment:{label:'Assignment', get:a => [a.holder.kind], name:k => LOC_LABEL[k] || k, href:k => '#/assets?loc=' + k},
  person:{label:'Person', get:a => [(assetPerson(a) || {}).id || ''], name:k => (person(k) || {}).name || 'Not assigned to a person', href:k => k ? '#/assets?person=' + k : null},
  mode:{label:'Work Mode', get:a => [(assetPerson(a) || {}).mode || ''], name:k => k ? modeName(k) : 'Not assigned to a person'},
  model:{label:'Model', get:a => [a.modelId || ''], name:k => (model(k) || {}).name || 'No model', href:k => k ? '#/assets?model=' + k : null},
  warranty:{label:'Warranty', get:a => { const w = warranty(a); return [w.days === null ? 'none' : w.days < 0 ? 'bad' : w.days <= 60 ? 'soon' : 'ok']; }, name:k => ({none:'Not set', bad:'Expired', soon:'Expires within 60 days', ok:'Valid'})[k], href:k => k === 'ok' ? null : '#/assets?warr=' + k},
  project:{label:'Project', get:a => [(reservedBy(a.id) || {project:{}}).project.id || ''], name:k => (project(k) || {}).name || 'Not in a project', href:k => k ? '#/project/' + k : null},
  arrived:{label:'Order arrival month', time:true, get:a => [ym(a.arrived)].filter(Boolean)},
};
const PROJECT_BY = {
  status:{label:'Status', get:p => [p.status], name:k => PROJECT_STATUS[k] || k},
  activity:{label:'Activity', multi:true, get:p => p.activities, name:k => ACTIVITIES[k] || k},
  office:{label:'City / Office', multi:true, get:p => projectOffices(p), name:officeLabel},
  owner:{label:'Project Owner', get:p => [p.owner || ''], name:k => k || 'No owner'},
  service:{label:'Target Service', get:p => [p.targetServiceId || ''], name:k => serviceName(k) || 'No Service'},
  created:{label:'Created month', time:true, get:p => [ym(p.created)].filter(Boolean)},
  completed:{label:'Completed month', time:true, get:p => [ym(p.completedAt)].filter(Boolean)},
};
const PEOPLE_BY = {
  service:{label:'Service', get:p => [p.serviceId || ''], name:k => serviceName(k) || 'No Service', href:k => k ? '#/people?service=' + k : '#/people?service=__none'},
  office:{label:'City / Office', get:p => [p.officeId], name:officeLabel},
  mode:{label:'Work Mode', get:p => [p.mode], name:modeName, href:k => '#/people?mode=' + encodeURIComponent(k)},
  status:{label:'User Status', get:p => [p.status], name:k => k, href:k => '#/people?status=' + k},
  role:{label:'Job Role', get:p => [p.roleId || ''], name:k => roleName(k) || 'No Job Role'},
  isd:{label:'ISD Member', get:p => [p.isd ? 'y' : 'n'], name:k => k === 'y' ? 'ISD Member' : 'Not ISD'},
};
const MOVE_BY = {
  type:{label:'Movement type', get:l => [l.cat], name:k => LOG_CATS[k] || k},
  by:{label:'Done by', get:l => [l.by || ''], name:k => k || 'Unknown'},
  month:{label:'Month', time:true, get:l => [ym(l.ts)]},
};
const projectAssetSet = () => new Set(scopedProjects().flatMap(pr => [...projectAssetIds(pr), ...pr.shipments.flatMap(s => s.assetIds), ...(pr.issuedIds || [])]));
const CHART_SOURCES = {
  assets:{group:'Assets', label:'All assets', unit:'assets', rows:() => scopedAssets(), by:ASSET_BY},
  assets_active:{group:'Assets', label:'Active assets', unit:'assets', rows:() => scopedAssets().filter(isActiveAsset), by:ASSET_BY},
  assets_assigned:{group:'Assets', label:'Assets assigned to people', unit:'assets', rows:() => scopedAssets().filter(a => a.holder.kind === 'person'), by:ASSET_BY},
  assets_stock:{group:'Assets', label:'Assets in stock', unit:'assets', rows:() => scopedAssets().filter(a => a.holder.kind === 'storage' && !isOut(a)), by:ASSET_BY},
  assets_faulty:{group:'Assets', label:'Faulty / In Repair assets', unit:'assets', rows:() => scopedAssets().filter(isFaulty), by:ASSET_BY},
  assets_lost:{group:'Assets', label:'Lost or Missing assets', unit:'assets', rows:() => scopedAssets().filter(a => a.status === 'lost' || a.status === 'missing'), by:ASSET_BY},
  assets_awaiting:{group:'Assets', label:'Assets awaiting return', unit:'assets', rows:() => scopedAssets(true).filter(a => openReturnOf(a.id)), by:ASSET_BY},
  assets_projects:{group:'Projects', label:'Assets in projects', unit:'assets', rows:() => { const s = projectAssetSet(); return db.assets.filter(a => s.has(a.id)); }, by:ASSET_BY},
  projects:{group:'Projects', label:'All projects', unit:'projects', rows:() => scopedProjects(), by:PROJECT_BY},
  projects_active:{group:'Projects', label:'Active projects', unit:'projects', rows:() => scopedProjects().filter(isActive), by:PROJECT_BY},
  projects_done:{group:'Projects', label:'Completed projects', unit:'projects', rows:() => scopedProjects().filter(p => p.status === 'completed'), by:PROJECT_BY},
  people:{group:'People', label:'All people', unit:'people', rows:() => scopedPeople(), by:PEOPLE_BY},
  people_assets:{group:'People', label:'People holding assets', unit:'people', rows:() => scopedPeople().filter(p => personAssets(p.id).direct.length), by:PEOPLE_BY},
  moves:{group:'Activity', label:'Asset movements (log)', unit:'movements', rows:() => scopedLog().filter(l => ['moved', 'checkout', 'returned'].includes(l.cat)), by:MOVE_BY},
};
const chartTypesFor = c => { const by = ((CHART_SOURCES[c.source] || {}).by || {})[c.by]; return by && by.time ? ['bar', 'line', 'stats', 'list'] : ['pie', 'doughnut', 'bar', 'stats', 'list']; };
function chartData(c){
  const src = CHART_SOURCES[c.source], by = src && src.by[c.by];
  if (!by) return null;
  const rows = src.rows(), m = new Map();
  for (const r of rows) for (const k of new Set(by.get(r))) m.set(k, (m.get(k) || 0) + 1);
  let groups = [...m].map(([k, n]) => ({k, n, label:by.time ? k : by.name(k), href:by.href ? by.href(k) : null}));
  if (by.time){
    // every month between the first and the last is shown, empty months as zero
    groups.sort((a, b) => a.k.localeCompare(b.k));
    if (groups.length){ const out = [], [y0, m0] = groups[0].k.split('-').map(Number), [y1, m1] = groups[groups.length - 1].k.split('-').map(Number);
      for (let y = y0, mo = m0; y < y1 || (y === y1 && mo <= m1); mo === 12 ? (y++, mo = 1) : mo++){ const k = `${y}-${String(mo).padStart(2, '0')}`; out.push(groups.find(g => g.k === k) || {k, n:0, label:k}); }
      groups = out.slice(-(+c.top || 36)); }
  } else {
    groups.sort((a, b) => b.n - a.n || String(a.label).localeCompare(b.label, 'hu'));
    const top = +c.top || 0;
    if (top && groups.length > top){ const rest = groups.slice(top); groups = [...groups.slice(0, top), {k:'__other', label:`Other (${rest.length})`, n:rest.reduce((s, g) => s + g.n, 0), other:true}]; }
  }
  const sum = groups.reduce((s, g) => s + g.n, 0);
  groups.forEach((g, i) => { g.p = sum ? g.n / sum * 100 : 0; g.color = g.other ? '#9aa3b2' : CHART_COLORS[i % CHART_COLORS.length]; });
  return {groups, total:rows.length, sum, unit:src.unit, multi:!!by.multi, src, by};
}
const pct = p => (p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1)) + '%';
const gLabel = g => g.href ? `<a href="${g.href}">${esc(g.label)}</a>` : esc(g.label);
function chartSvg(d, type){
  if (!d || !d.groups.length || !d.sum) return '<div class="empty">No data for this selection.</div>';
  const legend = `<ul class="legend2">${d.groups.map(g => `<li><i style="background:${g.color}"></i>${gLabel(g)} <b>${g.n}</b> <span class="muted">${pct(g.p)}</span></li>`).join('')}</ul>`;
  const aria = esc(d.groups.map(g => `${g.label}: ${g.n}`).join(', '));
  if (type === 'pie' || type === 'doughnut'){
    const r = type === 'pie' ? 25 : 38, w = type === 'pie' ? 50 : 18;
    let off = 0;
    const segs = d.groups.map(g => { const s = `<circle r="${r}" cx="60" cy="60" fill="none" stroke="${g.color}" stroke-width="${w}" pathLength="100" stroke-dasharray="${g.p} ${100 - g.p}" stroke-dashoffset="${-off}"><title>${esc(g.label)}: ${g.n} (${pct(g.p)})</title></circle>`; off += g.p; return s; }).join('');
    return `<div class="chartbox"><svg viewBox="0 0 120 120" class="pie" role="img" aria-label="${aria}"><g transform="rotate(-90 60 60)">${segs}</g>${type === 'doughnut' ? `<text x="60" y="58" text-anchor="middle" class="ctot">${d.sum}</text><text x="60" y="72" text-anchor="middle" class="cunit">${esc(d.unit)}</text>` : ''}</svg>${legend}</div>`;
  }
  if (type === 'bar'){
    const max = Math.max(...d.groups.map(g => g.n));
    return `<div class="bars" role="img" aria-label="${aria}">${d.groups.map(g => `<div class="barrow"><span class="bl">${gLabel(g)}</span><span class="bt"><i style="width:${max ? g.n / max * 100 : 0}%;background:${g.color}"></i></span><span class="bv"><b>${g.n}</b> <small class="muted">${pct(g.p)}</small></span></div>`).join('')}</div>`;
  }
  if (type === 'line'){
    const W = 600, H = 200, P = 30, max = Math.max(1, ...d.groups.map(g => g.n)), n = d.groups.length;
    const x = i => P + (n < 2 ? (W - 2 * P) / 2 : i * (W - 2 * P) / (n - 1)), y = v => H - P - v / max * (H - 2 * P);
    const step = Math.ceil(n / 8);
    return `<svg viewBox="0 0 ${W} ${H}" class="line" role="img" aria-label="${aria}"><line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" class="axis"/><line x1="${P}" y1="${P}" x2="${P}" y2="${H - P}" class="axis"/>
      <text x="${P - 6}" y="${P + 4}" text-anchor="end" class="tick">${max}</text><text x="${P - 6}" y="${H - P + 4}" text-anchor="end" class="tick">0</text>
      <polyline fill="none" stroke="${CHART_COLORS[0]}" stroke-width="2.5" points="${d.groups.map((g, i) => `${x(i)},${y(g.n)}`).join(' ')}"/>
      ${d.groups.map((g, i) => `<circle cx="${x(i)}" cy="${y(g.n)}" r="4" fill="${CHART_COLORS[0]}"><title>${g.k}: ${g.n}</title></circle>${i % step === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - P + 16}" text-anchor="middle" class="tick">${g.k}</text>` : ''}`).join('')}</svg>`;
  }
  if (type === 'stats') return `<div class="tmain"><span class="n">${d.total}</span><span class="l">${esc(d.unit)} in total</span></div><div class="statgrid">${d.groups.map(g => `<div class="stat1"><b>${g.n}</b><span>${gLabel(g)}</span><small class="muted">${pct(g.p)}</small></div>`).join('')}</div>`;
  return `<div class="tbl-wrap"><table><thead><tr><th>${esc(d.by.label)}</th><th>Count</th><th>Share</th></tr></thead><tbody>${d.groups.map(g => `<tr><td><i class="dot" style="background:${g.color}"></i>${gLabel(g)}</td><td data-v="${g.n}"><b>${g.n}</b></td><td data-v="${g.p}">${pct(g.p)}</td></tr>`).join('')}
    <tr><td><b>Total</b></td><td><b>${d.sum}</b></td><td>100%</td></tr></tbody></table></div>`;
}
function chartWidget(it){
  const c = dashLayout().charts[it.id], d = chartData(c), type = chartTypesFor(c).includes(c.chart) ? c.chart : chartTypesFor(c)[0];
  return `<section class="card widget wchart w-${type}" data-w="${it.id}"><div class="whead"><h2>${esc(c.title)}</h2>${menuBtn(it.id)}</div>
    <div class="muted" style="font-size:12px;margin:-6px 0 8px">${d ? `${esc(d.src.label)} by ${esc(d.by.label.toLowerCase())} · ${d.total} ${esc(d.unit)}${d.multi ? ' · one item can count in several groups' : ''}` : 'This chart refers to data that no longer exists.'}</div>
    ${chartSvg(d, type)}</section>`;
}
// add or edit a chart: data, grouping, chart type and detail, with a live preview from the real data
function chartDialog(id){
  const o = dashLayout(), c = id ? {...o.charts[id]} : {title:'', source:'people', by:'service', chart:'pie', top:'10'};
  const groups = [...new Set(Object.values(CHART_SOURCES).map(s => s.group))];
  openDialog(`<h3>${id ? 'Edit chart' : 'Add chart or statistic'}</h3>
    <div class="two"><div><label class="f">1. Data</label><select id="chSrc">${groups.map(g => `<optgroup label="${g}">${Object.entries(CHART_SOURCES).filter(([, s]) => s.group === g).map(([k, s]) => `<option value="${k}"${k === c.source ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}</optgroup>`).join('')}</select></div>
      <div><label class="f">2. Group by</label><select id="chBy"></select></div>
      <div><label class="f">3. Chart type</label><select id="chType"></select></div>
      <div><label class="f">4. Detail</label><select id="chTop"><option value="5">Top 5 groups</option><option value="10">Top 10 groups</option><option value="0">All groups</option></select></div></div>
    <label class="f">Title</label><input id="chTitle" value="${esc(c.title)}" style="width:100%" placeholder="Filled in from your choices">
    <label class="f">Preview</label><div class="card" id="chPrev"></div>
    <div class="actions"><button value="cancel" formnovalidate>Cancel</button><button class="primary" value="ok" id="dlgOk">${id ? 'Save' : 'Add to Overview'}</button></div>`,
    () => {
      read();
      const n = {...c, title:$('#chTitle').value.trim() || autoTitle()};
      if (id) o.charts[id] = n; else { const nid = 'c_' + uid(); o.charts[nid] = n; o.items.push({id:nid, visible:true}); }
      save(); render(); toast(id ? 'Chart saved.' : 'Chart added to your Overview.');
    }, {wide:true});
  const autoTitle = () => `${CHART_SOURCES[c.source].label} by ${CHART_SOURCES[c.source].by[c.by].label.toLowerCase()}`;
  const read = () => { c.source = $('#chSrc').value; c.by = $('#chBy').value; c.chart = $('#chType').value; c.top = $('#chTop').value; };
  const fill = () => {
    const by = CHART_SOURCES[$('#chSrc').value].by;
    if (!by[c.by]) c.by = Object.keys(by)[0];
    $('#chBy').innerHTML = Object.entries(by).map(([k, b]) => `<option value="${k}"${k === c.by ? ' selected' : ''}>${esc(b.label)}</option>`).join('');
    c.source = $('#chSrc').value;
    const types = chartTypesFor(c); if (!types.includes(c.chart)) c.chart = types[0];
    $('#chType').innerHTML = types.map(t => `<option value="${t}"${t === c.chart ? ' selected' : ''}>${MODE_LABEL[t]}</option>`).join('');
    $('#chTop').value = String(c.top ?? '10');
    paint();
  };
  const paint = () => { read(); const d = chartData(c); $('#chPrev').innerHTML = `<b>${esc($('#chTitle').value.trim() || autoTitle())}</b><div class="muted" style="font-size:12px;margin-bottom:6px">${d ? `${d.total} ${esc(d.unit)}` : ''}</div>${chartSvg(d, c.chart)}`; };
  $('#chSrc').addEventListener('change', fill);
  $('#chBy').addEventListener('change', () => { c.by = $('#chBy').value; fill(); });
  $('#chType').addEventListener('change', paint); $('#chTop').addEventListener('change', paint); $('#chTitle').addEventListener('input', paint);
  fill();
}
