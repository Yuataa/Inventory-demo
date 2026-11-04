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
// ---------- linked filters, one engine for every list ----------
// The options of a filter come from the items that pass all the OTHER active filters, so any two filters narrow each other
// in both directions (Type limits the people, a person limits the types). A facet: {label, all, vals(item) → values, name(value)}.
function facetRun(items, facets, params){
  const keys = Object.keys(facets), active = keys.filter(k => params.get(k));
  const test = (k, x) => { const f = facets[k], v = params.get(k); return f.test ? f.test(x, v) : f.vals(x).includes(v); };
  const counts = Object.fromEntries(keys.map(k => [k, new Map()])), list = [];
  for (const x of items){
    let fails = 0, failKey = null;
    for (const k of active) if (!test(k, x)){ fails++; failKey = k; if (fails > 1) break; }
    if (fails > 1) continue;
    if (!fails) list.push(x);
    // an item counts for a filter when it passes every other filter
    for (const k of keys) if (!fails || failKey === k) for (const v of new Set(facets[k].vals(x))) if (v !== '' && v != null) counts[k].set(v, (counts[k].get(v) || 0) + 1);
  }
  return {list, counts};
}
const facetLabel = (f, v) => (f.name ? f.name(v) : v) || v;
// the values that no longer match anything because of the other filters
const facetStale = (facets, params, counts) => Object.keys(facets).filter(k => params.get(k) && !counts[k].get(params.get(k)));
function facetSelect(k, f, counts, cur){
  const m = counts[k], order = f.order ? f.order.filter(v => m.has(v)) : sortHu([...m.keys()], v => facetLabel(f, v));
  const stale = cur && !m.has(cur);
  return `<select data-facet="${k}" title="${esc(f.label)}" aria-label="${esc(f.label)}"${stale ? ' class="stale"' : ''}><option value="">${esc(f.all)}</option>
    ${stale ? `<option value="${esc(cur)}" selected>${esc(facetLabel(f, cur))} (no match)</option>` : ''}${order.map(v => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(facetLabel(f, v))} (${m.get(v)})</option>`).join('')}</select>`;
}
// reads the filter controls into the address; filters that a change made impossible are removed and named
function facetUpdate(route, facets, changed, extra = {}){
  const p = new URLSearchParams(location.hash.split('?')[1] || '');
  document.querySelectorAll('#view [data-facet]').forEach(s => { if (s.value) p.set(s.dataset.facet, s.value); else p.delete(s.dataset.facet); });
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v); else p.delete(k);
  // only a filter choice clears others; typing in the search box never removes filters, the chips show what no longer matches
  if (facets.base && facets.defs[changed]){
    const {counts} = facetRun(facets.base(p), facets.defs, p), drop = facetStale(facets.defs, p, counts).filter(k => k !== changed);
    drop.forEach(k => p.delete(k));
    if (drop.length) toast(`Cleared: ${drop.map(k => facets.defs[k].label).join(', ')} – no match with the other filters`);
  }
  history.replaceState(null, '', route + (p.toString() ? '?' + p : ''));
}

// the same filter bar for every list: search, linked dropdowns, optional date range, chips, result count
const inRange = (d, from, to) => { if (!from && !to) return true; if (!d) return false; return (!from || d >= from) && (!to || d <= to); };
const isoDay = ts => ts ? (typeof ts === 'number' ? isoLocalDay(new Date(ts)) : String(ts).slice(0, 10)) : '';
const isoLocalDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function filterBar(o){
  const {route, facets, params, counts, shown = Object.keys(facets), placeholder, dates, total, n} = o, v = k => params.get(k) || '';
  return `<div class="row filters" style="margin-bottom:8px">
      <input id="fbq" type="search" placeholder="${esc(placeholder)}" value="${esc(v('q'))}" aria-label="Search" style="min-width:240px;flex:1">
      ${shown.map(k => facetSelect(k, facets[k], counts, v(k))).join('')}
      ${dates ? `<label class="muted">${esc(dates)} from <input type="date" id="fbfrom" value="${esc(v('from'))}" aria-label="Date from"></label><label class="muted">to <input type="date" id="fbto" value="${esc(v('to'))}" aria-label="Date to"></label>` : ''}
    </div>${activeFilterChips(params, route, facets, shown, counts)}
    <div class="sub" style="margin-bottom:10px"><b>${n}</b> of ${total} shown${[...params.keys()].length ? ` · <a href="${route}">Clear all filters</a>` : ''}</div>`;
}
function bindFilterBar(route, set){
  const upd = changed => {
    const val = s => $(s) ? $(s).value : '';
    facetUpdate(route, set, changed, {q:val('#fbq'), from:val('#fbfrom'), to:val('#fbto')});
    const typing = document.activeElement && document.activeElement.id === 'fbq', pos = typing ? $('#fbq').selectionStart : 0;
    render(); if (typing){ $('#fbq').focus(); $('#fbq').setSelectionRange(pos, pos); }
  };
  if ($('#fbq')) $('#fbq').addEventListener('input', () => upd('q'));
  for (const s of ['#fbfrom', '#fbto']) if ($(s)) $(s).addEventListener('change', () => upd(''));
  document.querySelectorAll('#view [data-facet]').forEach(s => s.addEventListener('change', () => upd(s.dataset.facet)));
}

// ---------- icons for the row actions, the same in every table ----------
const ICON = {
  edit:'<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
  del:'<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  dup:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  move:'<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  view:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};
const iconBtn = (kind, title, onclick, cls = '') => `<button type="button" class="ib ${cls}" onclick="${onclick}" title="${esc(title)}" aria-label="${esc(title)}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[kind]}</svg></button>`;

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
    // a paged table is sorted on all its data before paging, so only the arrows are shown here
    if (!list.length || t.dataset.datasort) return;
    const rows = [...t.tBodies[0].rows];
    if (rows.length < 2) return;
    rows.map((r, n) => [r, n]).sort(([a, x], [b, y]) => {
      for (const s of list){ const c = cellVal(a.cells[s.i]).localeCompare(cellVal(b.cells[s.i]), 'en', {numeric:true, sensitivity:'base'}); if (c) return c * s.dir; }
      return x - y;
    }).forEach(([r]) => t.tBodies[0].appendChild(r));
  });
}
document.addEventListener('click', e => {
  const th = e.target.closest('th[data-sk]'); if (!th || e.target.closest('input,button,a,.colgrip') || colDrag.justDone) return;
  const key = th.dataset.sk, i = +th.dataset.si, list = sortState[key] ||= [], cur = list.find(s => s.i === i);
  if (e.shiftKey){ if (!cur) list.push({i, dir:1}); else if (cur.dir > 0) cur.dir = -1; else list.splice(list.indexOf(cur), 1); }
  else if (!cur || list.length > 1) sortState[key] = [{i, dir:cur ? -cur.dir : 1}];
  else if (cur.dir > 0) cur.dir = -1;
  else sortState[key] = [];
  render();
});

// ---------- column widths: drag the edge of a header, like in Excel; double-click resets ----------
// On the first drag every column is measured and the table switches to fixed widths, so nothing else jumps.
const COL_MIN = 60, COL_MAX = 600, colDrag = {justDone:false};
const colWidthsOf = t => Object.fromEntries([...t.tHead.rows[0].cells].filter(th => th.dataset.col).map(th => [th.dataset.col, th.offsetWidth]));
function fixColumns(t){
  if (t.style.tableLayout === 'fixed') return;
  const ths = [...t.tHead.rows[0].cells], w = ths.map(th => th.offsetWidth);
  ths.forEach((th, i) => { th.style.width = w[i] + 'px'; });
  t.style.width = w.reduce((s, x) => s + x, 0) + 'px'; t.style.tableLayout = 'fixed';
}
document.addEventListener('pointerdown', e => {
  const g = e.target.closest('.colgrip'); if (!g || e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  const th = g.closest('th'), t = th.closest('table');
  fixColumns(t);
  const x0 = e.clientX, w0 = th.offsetWidth, tw0 = t.offsetWidth;
  try { g.setPointerCapture(e.pointerId); } catch(err) {}
  t.classList.add('resizing');
  const mv = ev => { const w = Math.max(COL_MIN, Math.min(COL_MAX, w0 + ev.clientX - x0)); th.style.width = w + 'px'; t.style.width = (tw0 + w - w0) + 'px'; };
  const up = () => {
    g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); t.classList.remove('resizing');
    colDrag.justDone = true; setTimeout(() => { colDrag.justDone = false; }, 0);
    const key = t.dataset.widths; if (key){ myPrefs()[key] = colWidthsOf(t); save(); }
  };
  g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up);
});
document.addEventListener('dblclick', e => {
  const g = e.target.closest('.colgrip'); if (!g) return;
  const key = g.closest('table').dataset.widths; if (key){ delete myPrefs()[key]; save(); render(); toast('Column widths reset.'); }
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
    return `<td>${aidLink(a)}${res ? `<br><a class="pill acc" href="#/project/${res.project.id}" title="Reserved for a project">📋 ${esc(res.project.name)}</a>` : ''}${ret ? `<br><span class="pill ${returnCls(ret)}" title="${esc(returnDue(ret) ? 'Due ' + returnDue(ret) : 'No deadline set')}">↩ Awaiting Return</span>` : ''}</td>`; }},
  name:{label:'Asset Name', cell:a => `<td><a href="#/asset/${a.id}">${esc(assetName(a))}</a>${assetName(a) ? copyBtn(assetName(a)) : ''}</td>`},
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
// the values a column sorts by, before paging
const ASSET_SORT = {tag:a => a.tag, name:assetName, type:a => typeLabel(a.type), model:modelName, serial:a => a.serial, status:a => STATUS[a.status].label, warranty:a => a.warrantyUntil || '',
  location:whereText, country:a => officeCountry(a.officeId).name || '', office:a => officeLabel(a.officeId), note:a => a.note, service:a => serviceName(a.serviceId || (assetPerson(a) || {}).serviceId),
  person:a => (assetPerson(a) || {}).name || '', supplier:a => a.supplier, orderNo:a => a.orderNo, arrived:a => a.arrived || '', legacy:a => a.legacyTag};
function assetRows(list, opts = {}){
  if (!list.length) return `<div class="empty">No assets.</div>`;
  const cols = opts.cols || (opts.noLoc ? DEFAULT_COLS.slice(0, 7) : DEFAULT_COLS), W = opts.widths || null;
  const fixed = W && cols.every(c => W[c]), wd = k => fixed && W[k] ? ` style="width:${W[k]}px"` : '';
  const grip = opts.widthsKey ? '<span class="colgrip" title="Drag to resize · double-click to reset"></span>' : '';
  const total = fixed ? Object.entries(W).filter(([k]) => ['sel', 'icon', 'act', ...cols].includes(k)).reduce((s, [, w]) => s + w, 0) : 0;
  return `<div class="tbl-wrap"><table class="atable"${opts.dataSort ? ' data-datasort="1"' : ''}${opts.widthsKey ? ` data-widths="${opts.widthsKey}"` : ''}${fixed ? ` style="table-layout:fixed;width:${total}px"` : ''}><thead><tr>
    ${opts.select ? `<th class="sel" data-col="sel"${wd('sel')}><input type="checkbox" id="selAll" title="Select all on this page" aria-label="Select all on this page"></th>` : ''}<th data-col="icon"${wd('icon')}></th>
    ${cols.map(c => `<th data-col="${c}"${wd(c)}>${ASSET_COLS[c].label}${grip}</th>`).join('')}${opts.actions || opts.rowActions ? `<th class="actcol" data-col="act"${wd('act')}>${opts.rowActions ? 'Actions' : ''}</th>` : ''}</tr></thead><tbody>` +
    list.map(a => `<tr${selected.has(a.id) ? ' class="picked"' : ''}>
      ${opts.select ? `<td class="sel"><input type="checkbox" class="selbox" data-id="${a.id}"${selected.has(a.id) ? ' checked' : ''} aria-label="Select ${esc(a.tag)}"></td>` : ''}
      <td style="width:40px">${assetIcon(a)}</td>
      ${cols.map(c => ASSET_COLS[c].cell(a)).join('')}
      ${opts.rowActions ? `<td class="rowact">${assetRowActions(a)}</td>` : opts.actions ? `<td style="text-align:right;white-space:nowrap">${opts.actions(a)}</td>` : ''}
    </tr>`).join('') + '</tbody></table></div>';
}
// Edit · Duplicate · Move · Delete; the permission layer removes what this account may not do at the asset's office
function assetRowActions(a){
  const mv = canAt('assets.move', a.officeId) || canAt('assets.assign', a.officeId);
  return iconBtn('edit', 'Edit ' + a.tag, `assetForm(asset('${a.id}'))`) + iconBtn('dup', 'Duplicate ' + a.tag, `duplicateAsset('${a.id}')`)
    + (mv ? iconBtn('move', a.holder.kind === 'transit' ? 'In transit – cannot be moved' : 'Move ' + a.tag, `moveDialog('${a.id}')`, a.holder.kind === 'transit' ? 'off' : '') : '')
    + iconBtn('del', 'Delete ' + a.tag, `deleteAsset('${a.id}')`, 'danger');
}
// below a paged table: the range shown, the pages and the page size
const PAGE_SIZES = [10, 20, 50, 100];
function pager(total, page, size, key){
  const pages = Math.max(1, Math.ceil(total / size)), from = total ? (page - 1) * size + 1 : 0, to = Math.min(total, page * size);
  const nums = [...new Set([1, page - 1, page, page + 1, pages])].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  const btn = (n, l, on, lbl) => `<button type="button" class="sm${on ? ' primary' : ''}" data-page="${n}" ${n < 1 || n > pages || (on && l === String(n)) ? 'disabled' : ''} aria-label="${lbl || 'Page ' + n}">${l}</button>`;
  return `<div class="pager" data-pager="${key}"><span>Showing <b>${from}–${to}</b> of <b>${total}</b></span><span class="spacer"></span>
    ${btn(page - 1, '‹', false, 'Previous page')}${nums.map((n, i) => (i && n - nums[i - 1] > 1 ? '<span class="muted">…</span>' : '') + btn(n, String(n), n === page)).join('')}${btn(page + 1, '›', false, 'Next page')}
    <label class="muted">Rows per page <select data-pagesize aria-label="Rows per page">${PAGE_SIZES.map(s => `<option${s === size ? ' selected' : ''}>${s}</option>`).join('')}</select></label></div>`;
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
// the module an entry belongs to, read from what the entry is about
const LOG_MODULES = {assets:'Assets', people:'People', floorplan:'Floorplan', projects:'Projects', documents:'Documents', settings:'Settings', admin:'Admin Panel', system:'Other'};
function logModule(l){
  const t = l.text || '';
  if (l.cat === 'config') return /^(Country|Office)\b/.test(t) ? 'floorplan' : /^(Document template|Label preset)/.test(t) ? 'documents' : /^(Account|Role|Permission|Branding)/.test(t) ? 'admin' : 'settings';
  if (l.projectId || l.cat === 'project') return 'projects';
  if (/^Floorplan saved/.test(t)) return 'floorplan';
  if (/document/i.test(t)) return 'documents';
  if (l.assetId) return 'assets';
  if (l.cat === 'status' || l.personId || /^(Person deleted|\d+ people imported)/.test(t)) return 'people';
  return 'system';
}
const logSubjectText = l => [(asset(l.assetId) || {}).tag || (l.assetId ? 'deleted asset' : ''), (project(l.projectId) || {}).name, (person(l.personId) || {}).name].filter(Boolean).join(' · ');
const LOG_FACETS = {
  cat:{label:'Type', all:'All types', order:Object.keys(LOG_CATS), vals:l => [l.cat], name:v => LOG_CATS[v] || v},
  module:{label:'Module', all:'All modules', order:Object.keys(LOG_MODULES), vals:l => [logModule(l)], name:v => LOG_MODULES[v]},
  by:{label:'By', all:'Everyone', vals:l => [l.by || '__none'], name:v => v === '__none' ? 'Unknown' : v},
};
// the date range is inclusive at both ends, in local time
const logBase = P => { const q = P.get('q') || '', from = P.get('from') || '', to = P.get('to') || '';
  return scopedLog().filter(l => (!q || matchWords([l.text, l.by, logSubjectText(l), l.ticket, l.note].join(' '), q)) && inRange(isoDay(l.ts), from, to)); };
const LOG_SET = {base:logBase, defs:LOG_FACETS};
const logsFiltered = P => facetRun(logBase(P), LOG_FACETS, P).list;
function viewLogs(params){
  const run = facetRun(logBase(params), LOG_FACETS, params), list = run.list, cat = params.get('cat') || '';
  // the quick type chips keep the other filters and show how many each type has under them
  const chip = (c, label) => { const p = new URLSearchParams(params); if (c) p.set('cat', c); else p.delete('cat');
    const n = c ? run.counts.cat.get(c) || 0 : [...run.counts.cat.values()].reduce((s, x) => s + x, 0);
    return `<a href="#/log${p.toString() ? '?' + p : ''}" class="${c === cat ? 'on' : ''}">${label} <small>${n}</small></a>`; };
  return `<div class="row"><h1>Logs</h1><span class="spacer"></span><button onclick="exportLogs('csv')">⬇ CSV</button><button onclick="exportLogs('xlsx')">⬇ Excel</button></div>
    <div class="sub">Moves, checkouts, returns, changes, status updates and project events. Exports contain every entry that matches the filters.</div>
    <div class="fchips">${chip('', 'All')}${Object.entries(LOG_CATS).map(([k, v]) => chip(k, v)).join('')}</div>
    ${filterBar({route:'#/log', facets:LOG_FACETS, params, counts:run.counts, placeholder:'Search: text, Asset ID, project, person, ticket…', dates:'Date', total:scopedLog().length, n:list.length})}
    ${list.length > 500 ? '<p class="muted">The first 500 entries are shown; the export contains all of them.</p>' : ''}
    ${logTable(list.slice(0, 500))}`;
}
const bindLogs = () => bindFilterBar('#/log', LOG_SET);
function exportLogs(kind){
  const P = new URLSearchParams(location.hash.split('?')[1] || ''), list = logsFiltered(P);
  if (!list.length){ toast('No log entries match the filters – nothing to export.'); return; }
  const head = ['Date', 'By', 'Type', 'Module', 'Subject', 'Description', 'From', 'To', 'Ticket', 'Note'];
  const rows = list.map(l => [fmtTime(l.ts), l.by || '', LOG_CATS[l.cat] || l.cat, LOG_MODULES[logModule(l)], logSubjectText(l), l.text, l.from || '', l.to || '', l.ticket || '', l.note || '']);
  if (kind === 'csv') download(`tc-itam-logs-${stamp()}.csv`, '﻿' + [head, ...rows].map(csvLine).join('\r\n'), 'text/csv');
  else download(`tc-itam-logs-${stamp()}.xlsx`, xlsxBlob([xlTable('Logs', head, rows, [17, 16, 14, 12, 24, 60, 30, 30, 12, 24])]));
  toast(`${rows.length} log entries exported.`);
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
