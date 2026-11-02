'use strict';
/* Shared UI: helpers, dialog, searchable list, asset table, bulk selection, log, global search */

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// every word has to appear, in any order: "dell debrecen" finds a Dell at the Debrecen office
const matchWords = (text, q) => { const t = norm(text); return norm(q).split(/\s+/).filter(Boolean).every(w => t.includes(w)); };
const sortHu = (arr, f) => arr.slice().sort((a, b) => String(f(a)).localeCompare(String(f(b)), 'hu', {numeric:true}));
const fmtTime = ts => new Date(ts).toLocaleString('en-GB', {year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'});
const todayIso = () => new Date().toISOString().slice(0, 10);
const statusPill = s => { const x = STATUS[s] || STATUS.ok; return `<span class="pill ${x.cls}">${x.label}</span>`; };
const warrantyPill = a => { const w = warranty(a); return w.days === null ? '<span class="muted">–</span>' : `<span class="pill ${w.cls}">${w.text}</span>`; };
const modePill = m => m ? `<span class="pill ${{onsite:'Onsite', hybrid:'Hybrid', wfh:'WFH'}[modeBehavior(m)]}">${modeIcon(m)} ${esc(modeName(m))}</span>` : '<span class="muted">–</span>';
const userPill = s => `<span class="pill ${(USER_STATUS[s] || {}).cls || ''}">${esc(s)}</span>`;
const assetImg = a => { const m = model(a.modelId); return (m && m.imageId && db.images[m.imageId]) || (a.imageId && db.images[a.imageId]) || null; };
const assetIcon = a => { const img = assetImg(a); return img ? `<img class="thumb" src="${img}" alt="" title="${esc(typeLabel(a.type))}">` : `<span class="ico" title="${esc(typeLabel(a.type))}">${typeIcon(a.type)}</span>`; };
const holderLink = h => `<a href="${holderHref(h)}">${esc(holderText(h))}</a>`;
const whereLink = a => holderLink(a.holder) + (a.placement ? `<br><small class="muted">${esc(placementText(a))}</small>` : '');
const aidLink = a => `<a class="tag aid" href="#/asset/${a.id}">${esc(a.tag)}</a>`;
const copyBtn = t => `<button type="button" class="copy sm" data-copy="${esc(t)}" title="Copy to clipboard">⧉</button>`;
const typeLink = a => `<a href="#/assets?type=${encodeURIComponent(a.type)}" title="All ${esc(typeLabel(a.type))}">${esc(typeLabel(a.type))}</a>`;
const modelLink = a => a.modelId ? `<a href="#/assets?model=${encodeURIComponent(a.modelId)}" title="All of this model">${esc(modelName(a))}</a>` : '<span class="muted">–</span>';
const personLink = id => { const p = person(id); return p ? `<a href="#/person/${p.id}">${esc(p.name)}</a>` : '<span class="muted">–</span>'; };

function toast(msg){
  let t = $('#toast');
  if (!t){ t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}
async function copyText(t){
  try { await navigator.clipboard.writeText(t); }
  catch(e){ const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  toast('Copied: ' + t);
}
document.addEventListener('click', e => { const b = e.target.closest('[data-copy]'); if (b){ e.preventDefault(); e.stopPropagation(); copyText(b.dataset.copy); } });

// ---------- dialog ----------
function openDialog(html, onSubmit, o = {}){
  const dlg = $('#dlg'), form = $('#dlgForm');
  dlg.classList.toggle('wide', !!o.wide);
  form.innerHTML = html;
  form.onsubmit = e => {
    const btn = e.submitter;
    if (btn && btn.value === 'cancel') return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    if (onSubmit(data, form) !== false) dlg.close();
  };
  dlg.showModal();
  const first = form.querySelector('input:not([type=search]),select,textarea'); if (first) first.focus();
}
const dlgActions = (ok = 'Save') => `<div class="actions"><button value="cancel" formnovalidate>Cancel</button><button class="primary" value="ok" id="dlgOk">${ok}</button></div>`;
const selOpts = (list, cur, label = x => x.name, empty) => (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') +
  list.map(x => `<option value="${esc(x.id)}"${x.id === cur ? ' selected' : ''}>${esc(label(x))}</option>`).join('');

// a second modal on top of the form dialog; resolves to true only on Confirm
function askConfirm(title, html, ok = 'Confirm'){
  return new Promise(res => {
    let d = $('#cfm');
    if (!d){ d = document.createElement('dialog'); d.id = 'cfm'; document.body.appendChild(d); }
    d.innerHTML = `<form onsubmit="return false"><h3>${esc(title)}</h3>${html}<div class="actions"><button type="button" id="cfmNo">Cancel</button><button type="button" class="primary" id="cfmOk">${esc(ok)}</button></div></form>`;
    const done = v => { d.close(); res(v); };
    $('#cfmOk').onclick = () => done(true);
    $('#cfmNo').onclick = () => done(false);
    d.oncancel = e => { e.preventDefault(); done(false); };
    d.showModal();
  });
}

// ---------- searchable picker: a filter box above a list ----------
const picker = (name, optionsHtml, o = {}) => `<div class="picker"><input type="search" class="pick-q" placeholder="Search the list…">
  <select class="pick-list" name="${name}"${o.id ? ` id="${o.id}"` : ''} size="${o.size || 7}"${o.required ? ' required' : ''}>${optionsHtml}</select></div>`;
function applyPicker(wrap){
  const sel = wrap.querySelector('.pick-list'), q = wrap.querySelector('.pick-q').value;
  for (const o of sel.options) o.hidden = !!q.trim() && !matchWords(o.textContent + ' ' + (o.parentElement.label || ''), q);
  for (const g of sel.querySelectorAll('optgroup')) g.hidden = ![...g.children].some(o => !o.hidden);
  const first = [...sel.options].find(o => !o.hidden);
  if (first && (!sel.selectedOptions[0] || sel.selectedOptions[0].hidden)) sel.value = first.value;
}
document.addEventListener('input', e => { if (e.target.classList.contains('pick-q')) applyPicker(e.target.closest('.picker')); });

// ---------- searchable dropdown: every long <select> opens this list instead of the native one.
// The select stays the only source of truth, so values, change handlers, validation and permissions work as before. ----------
const COMBO_MIN = 7;
const comboFor = s => s.matches('select:not([multiple]):not([size]):not(:disabled)') && (s.options.length >= COMBO_MIN || s.classList.contains('combo'));
let combo = null;
function closeCombo(refocus){
  if (!combo) return;
  const {el, sel} = combo; combo = null; el.remove();
  if (refocus) sel.focus();
}
function paintCombo(){
  const {sel, el} = combo, q = el.querySelector('input').value, list = el.querySelector('.combo-list');
  const rows = [...sel.options].filter(o => !o.hidden && (!q.trim() || matchWords(o.textContent + ' ' + (o.parentElement.label || ''), q)));
  combo.rows = rows.filter(o => !o.disabled);
  combo.act = Math.max(0, combo.rows.findIndex(o => o.selected && !q.trim()));
  let grp = '';
  list.innerHTML = rows.map(o => {
    const g = o.parentElement.label || '', head = g !== grp && g ? `<div class="combo-grp">${esc(g)}</div>` : ''; grp = g;
    return `${head}<div class="combo-opt${o.disabled ? ' off' : ''}${o.selected ? ' on' : ''}" role="option" data-i="${o.index}">${esc(o.textContent)}</div>`;
  }).join('') || `<div class="empty" style="padding:12px">No matches for “${esc(q)}”.</div>`;
  markCombo();
}
function markCombo(){
  const {rows, act, el} = combo, cur = rows[act];
  el.querySelectorAll('.combo-opt').forEach(d => {
    const on = !!cur && +d.dataset.i === cur.index;
    d.classList.toggle('act', on); if (on) d.scrollIntoView({block:'nearest'});
  });
}
function pickCombo(o){
  const {sel} = combo;
  closeCombo(true);
  if (!o || sel.value === o.value) return;
  sel.value = o.value;
  sel.dispatchEvent(new Event('input', {bubbles:true})); sel.dispatchEvent(new Event('change', {bubbles:true}));
}
function openCombo(sel, typed = ''){
  closeCombo();
  const el = document.createElement('div'), r = sel.getBoundingClientRect(), w = Math.min(Math.max(r.width, 280), innerWidth - 16);
  el.className = 'combo-pop';
  el.innerHTML = `<input type="search" placeholder="Type to search…" autocomplete="off" aria-label="Search the list"><div class="combo-list" role="listbox"></div>`;
  el.style.width = w + 'px'; el.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
  (sel.closest('dialog') || document.body).appendChild(el);
  combo = {sel, el, rows:[], act:0};
  const inp = el.querySelector('input'); inp.value = typed;
  paintCombo();
  const below = innerHeight - r.bottom > el.offsetHeight + 8 || r.top < el.offsetHeight + 8;
  el.style.top = (below ? Math.min(r.bottom + 2, innerHeight - el.offsetHeight - 8) : r.top - el.offsetHeight - 2) + 'px';
  inp.addEventListener('input', paintCombo);
  inp.addEventListener('keydown', e => {
    const n = combo.rows.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){ e.preventDefault(); if (n){ combo.act = (combo.act + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; markCombo(); } }
    else if (e.key === 'Home' || e.key === 'End'){ if (n){ e.preventDefault(); combo.act = e.key === 'Home' ? 0 : n - 1; markCombo(); } }
    else if (e.key === 'Enter'){ e.preventDefault(); e.stopPropagation(); if (n) pickCombo(combo.rows[combo.act]); }
    else if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); closeCombo(true); }
    else if (e.key === 'Tab') closeCombo();
  });
  // the press is taken here so the input keeps the focus until the choice is made
  el.addEventListener('mousedown', e => {
    if (e.target === inp) return;
    e.preventDefault();
    const d = e.target.closest('.combo-opt:not(.off)');
    if (d) pickCombo(sel.options[+d.dataset.i]);
  });
  inp.focus();
}
document.addEventListener('mousedown', e => {
  const s = e.target.closest && e.target.closest('select');
  if (combo && !e.target.closest('.combo-pop')){ const same = combo.sel === s; closeCombo(); if (same){ e.preventDefault(); return; } }
  if (s && e.button === 0 && comboFor(s)){ e.preventDefault(); s.focus(); openCombo(s); }
}, true);
document.addEventListener('keydown', e => {
  const s = e.target;
  if (s.tagName !== 'SELECT' || !comboFor(s) || e.ctrlKey || e.altKey || e.metaKey) return;
  if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)){ e.preventDefault(); openCombo(s); }
  else if (e.key.length === 1){ e.preventDefault(); openCombo(s, e.key); }
}, true);
window.addEventListener('resize', () => closeCombo());
document.addEventListener('scroll', e => { if (combo && !combo.el.contains(e.target)) closeCombo(); }, true);
// every place an asset can go: storage, people, office pools, desks
// only the people and places of one country: moving further away is a shipment
function holderOptions(current, o = {}){
  const ids = o.officeId ? [o.officeId] : scopeOfficeIds(), cid = o.officeId ? (office(o.officeId) || {}).countryId : scope.countryId;
  const sel = v => v === current ? ' selected' : '';
  let h = o.noStorage ? '' : `<option value="storage"${sel('storage')}>📦 In Stock</option>`;
  h += '<optgroup label="Assign to a person">' + sortHu(db.people.filter(p => (office(p.officeId) || {}).countryId === cid), p => p.name).map(p =>
    `<option value="person:${p.id}"${sel('person:' + p.id)}>👤 ${esc(p.name)} – ${esc(serviceName(p.serviceId) || 'no Service')} · ${esc(officeLabel(p.officeId))} · ${esc(modeName(p.mode))}${p.status !== 'Active' ? ' · ' + p.status : ''}</option>`).join('') + '</optgroup>';
  const offices = sortHu(db.rooms.filter(r => ids.includes(r.officeId)), r => roomPath(r));
  h += '<optgroup label="Office, not placed yet">' + sortHu(db.offices.filter(x => ids.includes(x.id)), x => x.name).map(o => `<option value="site:${o.id}" data-office="${o.id}"${sel('site:' + o.id)}>🏢 ${esc(o.name)}</option>`).join('') + '</optgroup>';
  if (offices.length) h += '<optgroup label="Room pool (not on a desk)">' + offices.map(r =>
    `<option value="office:${r.id}" data-office="${r.officeId}"${sel('office:' + r.id)}>🏢 ${esc(roomPath(r))}</option>`).join('') + '</optgroup>';
  for (const r of offices){
    const ks = sortHu(db.desks.filter(k => k.roomId === r.id), k => k.label);
    if (!ks.length) continue;
    h += `<optgroup label="${esc(roomPath(r))} – desks">` + ks.map(k => {
      const ow = deskOwnerText(k);
      return `<option value="desk:${k.id}" data-office="${r.officeId}"${sel('desk:' + k.id)}>${furnIcon(k)} ${esc(k.label)}${ow ? ' – ' + esc(ow) : ''}</option>`;
    }).join('') + '</optgroup>';
  }
  return h;
}

// ---------- files ----------
function resizeImage(file, max = 240){
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('The file cannot be read as an image.')); };
    img.src = url;
  });
}
function download(name, text, type){
  const url = URL.createObjectURL(text instanceof Blob ? text : new Blob([text], {type}));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const stamp = () => new Date().toISOString().slice(0, 10);
const csvLine = r => r.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(';');

// ---------- table sorting: click = sort, click again = reverse, third click = off, Shift+click = add a further column ----------
const sortState = {};
const sortTables = () => [...document.querySelectorAll('#view .tbl-wrap:not(.nosort) table')].filter(t => t.tHead && t.tBodies[0] && !t.classList.contains('ptable') && !t.classList.contains('fields') && t.id !== 'dashCfg');
const cellVal = td => td ? td.dataset.v ?? td.innerText.trim() : '';
function applySorts(){
  sortTables().forEach((t, ti) => {
    const key = lastRoute.split('/')[0] + '#' + ti, list = sortState[key] || [], ths = [...t.tHead.rows[0].cells];
    ths.forEach((th, i) => {
      if (!th.innerText.trim()) return;
      th.classList.add('sortable'); th.dataset.sk = key; th.dataset.si = i;
      th.title = 'Click to sort · Shift+click to add a further sort column';
      const p = list.findIndex(s => s.i === i);
      th.querySelector('.sa')?.remove();
      if (p >= 0) th.insertAdjacentHTML('beforeend', `<span class="sa">${list[p].dir > 0 ? '▲' : '▼'}${list.length > 1 ? p + 1 : ''}</span>`);
    });
    if (!list.length) return;
    const rows = [...t.tBodies[0].rows];
    if (rows.length < 2) return;
    rows.map((r, n) => [r, n]).sort(([a, x], [b, y]) => {
      for (const s of list){ const c = cellVal(a.cells[s.i]).localeCompare(cellVal(b.cells[s.i]), 'en', {numeric:true, sensitivity:'base'}); if (c) return c * s.dir; }
      return x - y;
    }).forEach(([r]) => t.tBodies[0].appendChild(r));
  });
}
document.addEventListener('click', e => {
  const th = e.target.closest('th[data-sk]'); if (!th || e.target.closest('input,button,a')) return;
  const key = th.dataset.sk, i = +th.dataset.si, list = sortState[key] ||= [], cur = list.find(s => s.i === i);
  if (e.shiftKey){ if (!cur) list.push({i, dir:1}); else if (cur.dir > 0) cur.dir = -1; else list.splice(list.indexOf(cur), 1); }
  else if (!cur || list.length > 1) sortState[key] = [{i, dir:cur ? -cur.dir : 1}];
  else if (cur.dir > 0) cur.dir = -1;
  else sortState[key] = [];
  render();
});

// ---------- bulk selection (asset list and person page) ----------
const selected = new Set();
function updateBulk(){
  const boxes = [...document.querySelectorAll('.selbox')];
  boxes.forEach(b => b.closest('tr').classList.toggle('picked', b.checked));
  const all = $('#selAll');
  if (all){ all.checked = boxes.length > 0 && boxes.every(b => b.checked); all.indeterminate = !all.checked && boxes.some(b => b.checked); }
  const bar = $('#bulkbar');
  if (bar){
    bar.hidden = !selected.size;
    const hidden = [...selected].filter(id => !boxes.some(b => b.dataset.id === id)).length;
    bar.querySelectorAll('.bulkCount').forEach(s => s.textContent = selected.size + (hidden ? ` (${hidden} hidden by the filter)` : ''));
    // an action stays active only if it can do something for at least one selected asset
    const list = [...selected].map(asset).filter(Boolean), at = (a, k) => canAt(k, a.officeId), free = a => a.holder.kind !== 'transit';
    const set = (sel, ok, why) => { const b = bar.querySelector(sel); if (b){ b.disabled = !ok; b.title = ok ? '' : why; } };
    set('[data-bulk=assign]', list.some(a => free(a) && (at(a, 'assets.assign') || at(a, 'assets.move'))), 'Nothing here can be assigned: the selected assets are in transit, or you lack permission.');
    set('[data-bulk=return]', list.some(a => free(a) && a.holder.kind !== 'storage' && at(a, 'assets.move')), 'Nothing to return: the selected assets are in stock or in transit, or you lack permission.');
  }
}
document.addEventListener('change', e => {
  const t = e.target;
  if (t.classList.contains('selbox')){ t.checked ? selected.add(t.dataset.id) : selected.delete(t.dataset.id); updateBulk(); }
  else if (t.id === 'selAll'){
    document.querySelectorAll('.selbox').forEach(b => { b.checked = t.checked; t.checked ? selected.add(b.dataset.id) : selected.delete(b.dataset.id); });
    updateBulk();
  }
});

// ---------- asset table ----------
// one definition per column, so the customized table and the fixed tables render the same cells
const clipCell = t => t ? `<td title="${esc(t)}"><div class="clip">${esc(t)}</div></td>` : '<td><span class="muted">–</span></td>';
const ASSET_COLS = {
  tag:{label:'Asset ID', cell:a => { const res = reservedBy(a.id), ret = openReturnOf(a.id);
    return `<td>${aidLink(a)}${copyBtn(a.tag)}${res ? `<br><a class="pill acc" href="#/project/${res.project.id}" title="Reserved for a project">📋 ${esc(res.project.name)}</a>` : ''}${ret ? `<br><span class="pill ${returnCls(ret)}" title="${esc(returnDue(ret) ? 'Due ' + returnDue(ret) : 'No deadline set')}">↩ Awaiting Return</span>` : ''}</td>`; }},
  name:{label:'Asset Name', cell:a => `<td><a href="#/asset/${a.id}">${esc(assetName(a))}</a></td>`},
  type:{label:'Type', cell:a => `<td>${typeLink(a)}</td>`},
  model:{label:'Model', cell:a => `<td>${modelLink(a)}</td>`},
  serial:{label:'Serial Number', cell:a => `<td class="muted serial" data-v="${esc(a.serial)}">${esc(a.serial)}${a.serial ? copyBtn(a.serial) : ''}</td>`},
  status:{label:'Status', cell:a => `<td>${statusPill(a.status)}${isAged(a) ? ' <span class="pill warn">Aged</span>' : ''}</td>`},
  warranty:{label:'Warranty', cell:a => `<td data-v="${esc(a.warrantyUntil || '')}">${warrantyPill(a)}</td>`},
  location:{label:'Location', cell:a => `<td>${whereLink(a)}</td>`},
  country:{label:'Country', cell:a => `<td>${esc(officeCountry(a.officeId).name || '–')}</td>`},
  office:{label:'City / Office', cell:a => `<td>${esc(officeLabel(a.officeId))}</td>`},
  note:{label:'Notes', cell:a => clipCell(a.note)},
  service:{label:'Service', cell:a => `<td>${esc(serviceName(a.serviceId || (assetPerson(a) || {}).serviceId) || '–')}</td>`},
  person:{label:'Assigned To', cell:a => `<td>${assetPerson(a) ? personLink(a.holder.id) : '<span class="muted">–</span>'}</td>`},
  supplier:{label:'Supplier', cell:a => clipCell(a.supplier)},
  orderNo:{label:'Order / Invoice', cell:a => clipCell(a.orderNo)},
  arrived:{label:'Order Arrived', cell:a => `<td style="white-space:nowrap">${esc(fmtDate(a.arrived))}</td>`},
  legacy:{label:'Legacy ID', cell:a => clipCell(a.legacyTag)},
};
const DEFAULT_COLS = ['tag', 'name', 'type', 'model', 'serial', 'status', 'warranty', 'location', 'country', 'office'];
function assetRows(list, opts = {}){
  if (!list.length) return `<div class="empty">No assets.</div>`;
  const cols = opts.cols || (opts.noLoc ? DEFAULT_COLS.slice(0, 7) : DEFAULT_COLS);
  return `<div class="tbl-wrap"><table class="atable"><thead><tr>${opts.select ? '<th class="sel"><input type="checkbox" id="selAll" title="Select all"></th>' : ''}<th></th>${cols.map(c => `<th>${ASSET_COLS[c].label}</th>`).join('')}${opts.actions ? '<th></th>' : ''}</tr></thead><tbody>` +
    list.map(a => `<tr${selected.has(a.id) ? ' class="picked"' : ''}>
      ${opts.select ? `<td class="sel"><input type="checkbox" class="selbox" data-id="${a.id}"${selected.has(a.id) ? ' checked' : ''}></td>` : ''}
      <td style="width:40px">${assetIcon(a)}</td>
      ${cols.map(c => ASSET_COLS[c].cell(a)).join('')}
      ${opts.actions ? `<td style="text-align:right;white-space:nowrap">${opts.actions(a)}</td>` : ''}
    </tr>`).join('') + '</tbody></table></div>';
}

// ---------- logs ----------
const CAT_PILL = {created:'ok', updated:'', moved:'acc', checkout:'warn', returned:'ok', project:'acc'};
function logSubject(l){
  const a = l.assetId && asset(l.assetId), pr = l.projectId && project(l.projectId), p = l.personId && person(l.personId);
  return [a ? aidLink(a) : l.assetId ? '<span class="muted">deleted asset</span>' : '', pr ? `<a href="#/project/${pr.id}">📋 ${esc(pr.name)}</a>` : '', p ? personLink(p.id) : ''].filter(Boolean).join('<br>') || '<span class="muted">–</span>';
}
function logTable(entries, o = {}){
  if (!entries.length) return `<div class="empty">No entries.</div>`;
  return `<div class="tbl-wrap"><table><thead><tr><th>Time</th><th>Type</th>${o.noSubject ? '' : '<th>Subject</th>'}<th>Event</th><th>By</th></tr></thead><tbody>${entries.map(l =>
    `<tr><td class="muted" style="white-space:nowrap" data-v="${l.ts}">${fmtTime(l.ts)}</td><td><span class="pill ${CAT_PILL[l.cat] || ''}">${LOG_CATS[l.cat] || l.cat}</span></td>
     ${o.noSubject ? '' : `<td>${logSubject(l)}</td>`}<td>${esc(l.text)}</td><td class="muted">${esc(l.by || '–')}</td></tr>`).join('')}</tbody></table></div>`;
}
// "Project activity" covers every entry linked to a project (checkouts done by a project completion too)
const logMatches = (l, cat) => !cat ? true : cat === 'project' ? l.cat === 'project' || !!l.projectId : l.cat === cat;
function viewLogs(params){
  const cat = params.get('cat') || '', q = params.get('q') || '';
  const base = scopedLog();
  let list = base.filter(l => logMatches(l, cat));
  if (q){ const n = norm(q); list = list.filter(l => norm([l.text, l.by, (asset(l.assetId) || {}).tag, (project(l.projectId) || {}).name, (person(l.personId) || {}).name].join(' ')).includes(n)); }
  const chip = (c, label) => { const n = base.filter(l => logMatches(l, c)).length;
    return `<a href="#/log${c ? '?cat=' + c : ''}" class="${c === cat ? 'on' : ''}">${label} <small>${n}</small></a>`; };
  return `<h1>Logs</h1><div class="sub">Moves, checkouts, returns, changes, status updates and project events.</div>
    <div class="fchips">${chip('', 'All')}${Object.entries(LOG_CATS).map(([k, v]) => chip(k, v)).join('')}</div>
    <div class="row" style="margin-bottom:12px"><input id="lq" placeholder="Filter by text, Asset ID, project…" value="${esc(q)}" style="min-width:300px">
      <span class="muted">${list.length} entries${list.length > 500 ? ' (first 500 shown)' : ''}</span></div>
    ${logTable(list.slice(0, 500))}`;
}
function bindLogs(params){
  $('#lq').addEventListener('input', e => {
    const p = new URLSearchParams(); if (params.get('cat')) p.set('cat', params.get('cat')); if (e.target.value) p.set('q', e.target.value);
    history.replaceState(null, '', '#/log' + (p.toString() ? '?' + p : ''));
    const pos = e.target.selectionStart; render(); $('#lq').focus(); $('#lq').setSelectionRange(pos, pos);
  });
}

// ---------- global search ----------
function search(q){
  const n = norm(q.trim()); if (!n) return [];
  const out = [];
  for (const p of scopedPeople()) if (norm([p.name, p.email, serviceName(p.serviceId), roleName(p.roleId), modeName(p.mode), p.status, ...p.tickets.map(t => t.no)].join(' ')).includes(n)){
    const pa = personAssets(p.id);
    out.push({grp:'People', href:'#/person/' + p.id, title:'👤 ' + p.name, sub:`${serviceName(p.serviceId) || 'no Service'} · ${modeName(p.mode)} · ${p.status} · ${pa.direct.length + pa.onDesk.length} assets`});
  }
  for (const a of scopedAssets(true)){
    const custom = Object.values(a.custom || {}).join(' ');
    if (norm([a.tag, a.legacyTag, a.name, a.serial, modelName(a), typeLabel(a.type), a.note, custom].join(' ')).includes(n))
      out.push({grp:'Assets', href:'#/asset/' + a.id, title:`${typeIcon(a.type)} ${a.tag} · ${assetName(a)}`, sub:whereText(a) + (a.serial ? ' · S/N ' + a.serial : '')});
  }
  const ids = scopeOfficeIds();
  for (const k of db.desks.filter(x => ids.includes((room(x.roomId) || {}).officeId))){ const r = room(k.roomId); if (norm([k.label, k.port, r ? r.name : '', k.sharedNote].join(' ')).includes(n))
    out.push({grp:'Desks', href:`#/room/${k.roomId}/${k.id}`, title:`${furnIcon(k)} ${k.label}${k.port ? ' · port ' + k.port : ''}`, sub:(r ? r.name : '') + (deskOwnerText(k) ? ' – ' + deskOwnerText(k) : '')}); }
  for (const o of db.offices.filter(x => ids.includes(x.id))) if (norm(o.name + ' ' + (o.code || '')).includes(n))
    out.push({grp:'Offices', href:'#/rooms?office=' + o.id, title:'🏢 ' + o.name, sub:`${officeRooms(o.id).length} rooms`});
  for (const pr of scopedProjects()) if (norm([pr.name, pr.ticket, pr.owner].join(' ')).includes(n))
    out.push({grp:'Projects', href:'#/project/' + pr.id, title:'📋 ' + pr.name, sub:`${PROJECT_STATUS[pr.status]} · ${pr.ticket || 'no ticket'} · ${pr.participants.length} participants`});
  for (const s of db.services) if (norm(s.name).includes(n))
    out.push({grp:'Service', href:'#/people?service=' + s.id, title:'🧩 ' + s.name, sub:`${db.people.filter(p => p.serviceId === s.id).length} people`});
  for (const r of db.rooms.filter(x => ids.includes(x.officeId))) if (norm(r.name + ' ' + r.floor).includes(n))
    out.push({grp:'Floorplan', href:'#/room/' + r.id, title:(ROOM_KINDS[r.kind] || '🏢').split(' ')[0] + ' ' + r.name, sub:roomPath(r) + ' · ' + r.floor});
  const allowed = {People:'people', Assets:'assets', Desks:'floorplan', Offices:'floorplan', Floorplan:'floorplan', Projects:'projects', Service:'people'};
  return out.filter(r => can(allowed[r.grp] + '.view')).slice(0, 40);
}
let resIdx = 0;
function showResults(){
  const box = $('#results'), list = search($('#q').value); resIdx = 0;
  if (!$('#q').value.trim()){ box.classList.remove('show'); return; }
  let grp = '';
  box.innerHTML = list.length ? list.map((r, i) => {
    const g = r.grp !== grp ? `<div class="grp">${grp = r.grp}</div>` : '';
    return g + `<a href="${r.href}" data-i="${i}"${i === 0 ? ' class="act"' : ''}>${esc(r.title)}<small>${esc(r.sub)}</small></a>`;
  }).join('') : '<div class="empty">No results.</div>';
  box.classList.add('show');
}
function closeSearch(){ $('#results').classList.remove('show'); $('#q').value = ''; $('#q').blur(); }
function bindSearch(){
  $('#q').addEventListener('input', showResults);
  $('#q').addEventListener('focus', showResults);
  $('#q').addEventListener('keydown', e => {
    const links = [...$('#results').querySelectorAll('a')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      e.preventDefault(); if (!links.length) return;
      resIdx = (resIdx + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
      links.forEach((l, i) => l.classList.toggle('act', i === resIdx)); links[resIdx].scrollIntoView({block:'nearest'});
    } else if (e.key === 'Enter' && links[resIdx]){ location.hash = links[resIdx].getAttribute('href'); closeSearch(); }
    else if (e.key === 'Escape') closeSearch();
  });
  $('#results').addEventListener('click', e => { if (e.target.closest('a')) closeSearch(); });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) $('#results').classList.remove('show'); });
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'){ e.preventDefault(); $('#q').focus(); $('#q').select(); } });
}
