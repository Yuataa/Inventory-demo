'use strict';
/* People: list and filters, detail page, user status and tickets, awaited returns, form, Excel import (name, Service, Work Mode) */

function viewPeople(params){
  const q = params.get('q') || '', svc = params.get('service') || '', mode = params.get('mode') || '', st = params.get('status') || '';
  let list = db.people;
  if (svc) list = list.filter(p => svc === '__none' ? !p.serviceId : p.serviceId === svc);
  if (mode) list = list.filter(p => p.mode === mode);
  if (st) list = list.filter(p => p.status === st);
  if (q){ const n = norm(q); list = list.filter(p => norm([p.name, p.email, serviceName(p.serviceId), roleName(p.roleId), modeName(p.mode), p.status, ...p.tickets.map(t => t.no)].join(' ')).includes(n)); }
  list = sortHu(list, p => p.name);
  return `
    <div class="row"><h1>People</h1><span class="spacer"></span>
      <a class="btn" href="#/people/import">⬆ Import from Excel</a>
      <button class="primary" onclick="personForm()">+ New person</button></div>
    <div class="sub">${list.length} of ${db.people.length} people${q || svc || mode || st ? ' · <a href="#/people">clear filters</a>' : ''}</div>
    <div class="row" style="margin-bottom:12px">
      <input id="pq" placeholder="Filter: name, e-mail, ticket ID…" value="${esc(q)}" style="min-width:220px">
      <select id="psvc"><option value="">All Services</option>${sortHu(db.services, s => s.name).map(s => `<option value="${s.id}"${s.id === svc ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}
        <option value="__none"${svc === '__none' ? ' selected' : ''}>– no Service –</option></select>
      <select id="pmode"><option value="">All Work Modes</option>${db.modes.map(m => `<option value="${esc(m.id)}"${m.id === mode ? ' selected' : ''}>${m.icon} ${esc(m.name)}</option>`).join('')}</select>
      <select id="pstatus"><option value="">All User Statuses</option>${Object.keys(USER_STATUS).map(s => `<option${s === st ? ' selected' : ''}>${s}</option>`).join('')}</select>
    </div>
    ${list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Service</th><th>Job Role</th><th>Work Mode</th><th>User Status</th><th>Tickets</th><th>Desk</th><th>Assets</th><th>Protocol</th></tr></thead><tbody>${list.map(p => {
      const pa = personAssets(p.id), all = [...pa.direct, ...pa.onDesk];
      return `<tr><td><a href="#/person/${p.id}">${esc(p.name)}</a><br><small class="muted">${esc(p.email)}</small></td>
        <td>${p.serviceId ? `<a href="#/people?service=${p.serviceId}">${esc(serviceName(p.serviceId))}</a>` : '<span class="muted">–</span>'}</td>
        <td>${esc(roleName(p.roleId)) || '<span class="muted">–</span>'}</td><td>${modePill(p.mode)}</td>
        <td>${userPill(p.status)}${openReturns(p.id).length ? `<br><span class="pill warn">↩ ${openReturns(p.id).length} awaiting</span>` : ''}</td>
        <td>${p.tickets.map(t => `<span class="tag">${esc(t.no)}</span>`).join('<br>') || '<span class="muted">–</span>'}</td>
        <td>${pa.desks.map(k => `<a href="#/room/${k.roomId}/${k.id}">${esc((room(k.roomId) || {}).name || '?')} › ${esc(k.label)}</a>`).join('<br>') || '<span class="muted">–</span>'}</td>
        <td>${all.map(a => `<a class="chip" href="#/asset/${a.id}">${typeIcon(a.type)} ${esc(a.tag)}</a>`).join(' ') || '<span class="muted">–</span>'}</td>
        <td>${docBadges(p.id)}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="empty">Nobody matches the filter.</div>'}`;
}
function bindPeopleFilters(){
  const upd = () => {
    const p = new URLSearchParams();
    if ($('#pq').value) p.set('q', $('#pq').value); if ($('#psvc').value) p.set('service', $('#psvc').value); if ($('#pmode').value) p.set('mode', $('#pmode').value); if ($('#pstatus').value) p.set('status', $('#pstatus').value);
    history.replaceState(null, '', '#/people' + (p.toString() ? '?' + p : ''));
    const pos = $('#pq').selectionStart; render(); $('#pq').focus(); $('#pq').setSelectionRange(pos, pos);
  };
  $('#pq').addEventListener('input', upd); $('#psvc').addEventListener('change', upd); $('#pmode').addEventListener('change', upd); $('#pstatus').addEventListener('change', upd);
}

// ---------- user status, tickets and awaited returns ----------
const statusEffect = (p, s) => {
  const n = personAssets(p.id).direct.length;
  if (s === p.status) return 'The User Status does not change.';
  if (s === 'Active') return 'Return expectations opened because of the User Status are cancelled. Nothing else changes.';
  return `${n} assigned asset(s) will be listed as Awaiting Return. They stay assigned until each return is recorded; no asset moves and no history is removed.`;
};
function ticketDialog(pid){
  const p = person(pid);
  openDialog(`<h3>Ticket / User Status – ${esc(p.name)}</h3>
    <div class="two"><div><label class="f">Ticket ID</label><input name="no" placeholder="e.g. INC-20417"></div>
      <div><label class="f">User Status</label><select name="status" id="tkStatus">${Object.keys(USER_STATUS).map(s => `<option${s === p.status ? ' selected' : ''}>${s}</option>`).join('')}</select></div></div>
    <label class="f">Note</label><input name="note">
    <div class="warnbox" id="tkEffect"></div>
    ${dlgActions('Confirm')}`,
    data => {
      const no = data.no.trim(), note = data.note.trim(), changed = data.status !== p.status;
      if (!no && !changed){ alert('Enter a ticket ID or choose a new User Status.'); return false; }
      if (no){
        p.tickets.push({id:uid(), no, note, ts:Date.now(), statusFrom:changed ? p.status : null, statusTo:changed ? data.status : null});
        log(null, `Ticket ${no} added to ${p.name}${note ? ' – ' + note : ''}`, 'status', {personId:p.id});
      }
      if (changed) setUserStatus(p, data.status, no, note);
      save(); render();
    });
  const upd = () => { $('#tkEffect').textContent = statusEffect(p, $('#tkStatus').value); };
  $('#tkStatus').addEventListener('change', upd); upd();
}
function removeTicket(pid, tid){
  const p = person(pid), t = p.tickets.find(x => x.id === tid);
  if (!confirm(`Remove ticket ${t.no}?\nThe User Status and the log stay unchanged.`)) return;
  p.tickets = p.tickets.filter(x => x !== t);
  log(null, `Ticket ${t.no} removed from ${p.name}`, 'status', {personId:p.id}); save(); render();
}
function awaitingHtml(p){
  const list = personReturns(p.id).filter(r => r.state !== 'returned'), done = personReturns(p.id).filter(r => r.state === 'returned');
  if (!list.length && !done.length) return p.status === 'Active' ? '' : `<div class="okbox">Nothing is awaited from ${esc(p.name)}.</div>`;
  const open = list.filter(r => r.state === 'awaiting');
  return `<h2>↩ Assets Awaiting Return</h2>
    ${open.length ? `<div class="warnbox" style="font-size:14px">⚠️ <b>${esc(p.name)}</b> (${esc(p.status)}): ${open.length} asset(s) must be returned.</div>` : '<div class="okbox">All return items are settled for this person.</div>'}
    <div class="tbl-wrap"><table><thead><tr><th>Asset ID</th><th>Asset Name</th><th>Return</th><th>Reason</th><th></th></tr></thead><tbody>${[...list, ...done].map(r => {
      const a = asset(r.assetId), pr = r.projectId && project(r.projectId);
      return `<tr><td>${a ? aidLink(a) : '<span class="muted">deleted</span>'}</td><td>${a ? esc(assetName(a)) : ''}</td>
        <td><span class="pill ${{awaiting:'warn', returned:'ok'}[r.state] || ''}">${RETURN_STATE[r.state]}</span>${r.closedAt ? ` <small class="muted">${fmtTime(r.closedAt)}</small>` : ''}</td>
        <td class="muted">${[r.sources.includes('status') ? 'User Status' : '', r.sources.includes('project') ? 'Replacement' : '', r.ticket].filter(Boolean).map(esc).join(' · ')}${pr ? ` · <a href="#/project/${pr.id}">${esc(pr.name)}</a>` : ''}</td>
        <td style="text-align:right;white-space:nowrap">${r.state === 'awaiting' && a ? `<button class="sm primary" onclick="toStorage('${a.id}')">↩ Record return</button> <button class="sm" onclick="markReturn('${r.id}','notRequired')">Not Required</button>` : ''}
          ${r.state === 'notRequired' ? `<button class="sm" onclick="markReturn('${r.id}','awaiting')">Expect return</button>` : ''}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}
function markReturn(id, state){ setReturnState(byId(db.returns, id), state); save(); render(); }

function viewPerson(id){
  const p = person(id);
  if (!p) return `<div class="empty">Person not found.</div>`;
  const pa = personAssets(id), unc = uncovered(id), docs = db.docs.filter(d => d.personId === id), swaps = db.swaps.filter(s => s.personId === id);
  const projects = db.projects.filter(pr => pr.participants.some(x => x.personId === id));
  const swapBtn = a => `<button class="sm" onclick="swapDialog('${a.id}')" title="Swap a faulty asset">🔁 Swap</button>`;
  const back = a => swapBtn(a) + ` <button class="sm" onclick="toStorage('${a.id}')">↩ Return to Stock</button>`;
  return `
    <div class="row"><a href="#/people">← People</a></div>
    <div class="row" style="margin-top:8px"><h1>👤 ${esc(p.name)}</h1><span class="spacer"></span>
      <button onclick="ticketDialog('${p.id}')">🎫 Ticket / User Status</button>
      <button onclick="personForm(person('${p.id}'))">✎ Edit</button>
      <button class="danger" onclick="deletePerson('${p.id}')">Delete</button></div>
    <div class="sub row" style="gap:10px">
      <span>User Status: ${userPill(p.status)}</span>
      <span>🧩 Service: ${p.serviceId ? `<a href="#/people?service=${p.serviceId}">${esc(serviceName(p.serviceId))}</a>` : '<span class="muted">none</span>'}</span>
      <span>Job Role: <b>${esc(roleName(p.roleId)) || '–'}</b></span>
      <span>Work Mode:${modePill(p.mode)}</span>
      ${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ''}</div>
    ${p.note ? `<div class="card" style="white-space:pre-wrap;margin-bottom:8px">${esc(p.note)}</div>` : ''}
    ${p.tickets.length ? `<div class="row" style="margin-bottom:8px"><span class="muted">Tickets:</span> ${p.tickets.map(t => `<span class="pill" title="${esc([fmtTime(t.ts), t.statusTo ? `${t.statusFrom} → ${t.statusTo}` : '', t.note].filter(Boolean).join(' · '))}"><span class="tag">${esc(t.no)}</span>${t.statusTo ? ' → ' + esc(t.statusTo) : ''} <a href="#" onclick="removeTicket('${p.id}','${t.id}');return false" title="Remove">✕</a></span>`).join(' ')}</div>` : ''}
    ${awaitingHtml(p)}
    <div class="loc-box"><b>${pa.direct.length + pa.onDesk.length}</b> assets in total:
      <b>${pa.direct.length}</b> assigned, <b>${pa.onDesk.length}</b> on their own office desk.</div>
    ${unc.length ? `<div class="warnbox" style="font-size:14px">⚠️ ${unc.length} assigned asset(s) have no handover protocol yet:
      ${unc.map(a => `<b class="tag">${esc(a.tag)}</b>`).join(', ')}
      <button class="sm" onclick="docDialog('${p.id}','out',[${unc.map(a => `'${a.id}'`).join(',')}])">📄 Create protocol</button></div>` : ''}
    <div class="row"><h2>👤 Assigned assets</h2><span class="spacer"></span>
      <button class="sm" onclick="assignAssetDialog({kind:'person',id:'${p.id}'}, 'Check out asset: ${esc(p.name).replace(/'/g, '')}')">+ Check out existing asset</button>
      <button class="sm" onclick="assetForm(null,{kind:'person',id:'${p.id}'})">+ New asset</button>
      ${pa.direct.length ? `<button class="sm" onclick="returnAll('${p.id}')">↩ Return all to Stock</button>` : ''}</div>
    <div class="bulkbar" id="bulkbar" hidden>
      <b>✔ <span class="bulkCount">0</span> selected</b>
      <button onclick="bulkMove('storage')">↩ Return selected to Stock</button>
      <button onclick="docDialog('${p.id}','out',[...selected])">📄 Handover protocol for selection</button>
      <button onclick="docDialog('${p.id}','in',[...selected])">📄 Return protocol</button>
      <span class="spacer"></span><button class="sm" onclick="selected.clear(); render()">✕</button>
    </div>
    ${assetRows(pa.direct, {actions:back, select:true})}
    ${projects.length ? `<h2>📋 Projects</h2><div class="tbl-wrap"><table><thead><tr><th>Project</th><th>Status</th><th>Planned pickup</th></tr></thead><tbody>${projects.map(pr =>
      `<tr><td><a href="#/project/${pr.id}">${esc(pr.name)}</a></td><td>${projectStatusPill(pr.status)}</td><td>${fmtDate((pr.participants.find(x => x.personId === id) || {}).pickupDate || pr.pickupDate)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="row"><h2>📄 Documents (${docs.length})</h2><span class="spacer"></span>
      <button class="sm" onclick="docDialog('${p.id}','out')">+ Handover protocol</button>
      <button class="sm" onclick="docDialog('${p.id}','in')">+ Return protocol</button></div>
    ${docTable(docs)}
    ${swaps.length ? `<h2>🔁 Swaps (${swaps.length})</h2>${swapTable(swaps, {noWhere:true})}` : ''}
    <h2>🕘 History</h2>
    ${logTable(db.log.filter(l => l.personId === id).slice(0, 50), {noSubject:false})}
    <h2>🪑 Own office desk</h2>
    ${pa.desks.length ? pa.desks.map(k => `
      <p><a href="#/room/${k.roomId}/${k.id}">${esc((room(k.roomId) || {}).name || '?')} › ${esc(k.label)}</a>${k.port ? ` · 🔌 port <span class="tag">${esc(k.port)}</span>` : ''} – open on the floorplan</p>
      ${assetRows(deskAssets(k.id), {noLoc:true, actions:swapBtn})}`).join('') : '<div class="empty">No own office desk. (Desks are assigned in the floorplan editor.)</div>'}`;
}
function personForm(p, onCreated){
  const isNew = !p;
  p = p || {name:'', email:'', serviceId:'', roleId:'', mode:db.modes[0].id, note:''};
  openDialog(`
    <h3>${isNew ? 'New person' : 'Edit person'}</h3>
    <label class="f">Full Name</label><input name="name" required value="${esc(p.name)}">
    <label class="f">E-mail</label><input name="email" type="email" value="${esc(p.email)}">
    <div class="two">
      <div><label class="f">Service</label><select name="serviceId">${selOpts(sortHu(db.services, s => s.name), p.serviceId, s => s.name, '– none –')}</select></div>
      <div><label class="f">Job Role</label><select name="roleId">${selOpts(sortHu(db.roles, r => r.name), p.roleId, r => r.name, '– none –')}</select></div>
    </div>
    <label class="f">Work Mode</label>
    <select name="mode">${db.modes.map(m => `<option value="${esc(m.id)}"${m.id === p.mode ? ' selected' : ''}>${m.icon} ${esc(m.name)}</option>`).join('')}</select>
    <p class="muted" style="font-size:12px;margin:6px 0 0">New Services and Job Roles are created in Settings. The User Status is changed with the Ticket / User Status button.</p>
    <label class="f">Note (e.g. home address, phone)</label><textarea name="note">${esc(p.note)}</textarea>
    ${dlgActions(isNew ? 'Create' : 'Save')}`,
    data => {
      const v = {name:data.name.trim(), email:data.email.trim(), serviceId:data.serviceId || null, roleId:data.roleId || null, mode:data.mode, note:data.note};
      if (isNew){
        const n = {id:uid(), ...v, status:'Active', tickets:[]}; db.people.push(n); save();
        if (onCreated) onCreated(n); else location.hash = '#/person/' + n.id;
      } else { Object.assign(p, v); save(); render(); }
    });
}
function deletePerson(id){
  const p = person(id), pa = personAssets(id);
  if (db.projects.some(pr => pr.status !== 'completed' && pr.status !== 'cancelled' && pr.participants.some(x => x.personId === id))){
    alert('This person is a participant of an active project. Remove them from it first.'); return;
  }
  if (!confirm(`Delete ${p.name}?\nTheir ${pa.direct.length} asset(s) go back to stock and their desk becomes free.\nTheir protocols stay in Documents.`)) return;
  for (const a of pa.direct) setHolder(a, {kind:'storage'});
  for (const k of pa.desks) k.personId = null;
  db.people = db.people.filter(x => x.id !== id); save(); location.hash = '#/people';
}

// ---------- people import: exactly three columns – full name, Service, Work Mode ----------
const PEOPLE_FIELDS = [
  {key:'name',    label:'Full Name',          aliases:['teljes név', 'név', 'name', 'full name', 'dolgozó', 'agent', 'name of the agent', 'munkatárs']},
  {key:'service', label:'Service',             aliases:['service', 'szolgáltatás', 'team', 'csapat', 'osztály', 'department']},
  {key:'mode',    label:'Work Mode',    aliases:['munkavégzési mód', 'munkavégzés', 'work mode', 'mode', 'mód', 'onsite / hybrid / wfh', 'working mode']},
];
// accepts the configured names and the common spellings, returns a mode id or null
function parseMode(v){
  const n = norm(v).replace(/[\s_-]+/g, '');
  if (!n) return null;
  const named = db.modes.find(m => norm(m.name).replace(/[\s_-]+/g, '') === n);
  if (named) return named.id;
  if (['onsite', 'iroda', 'irodai', 'office', 'irodaban', 'helyszini', 'site'].includes(n)) return 'Onsite';
  if (['hybrid', 'hibrid', 'vegyes'].includes(n)) return 'Hybrid';
  if (['wfh', 'home', 'homeoffice', 'otthon', 'otthonrol', 'remote', 'tavmunka', 'workfromhome'].includes(n)) return 'WFH';
  return null;
}
let pimp = null;
async function readPeopleFile(file){
  try {
    const t = await readTable(file, 'People');
    pimp = {fileName:file.name, headers:t.headers, rows:t.rows, map:guessColumns(t.headers, PEOPLE_FIELDS), svcMap:{}, allowDup:false, defMode:''};
    render();
  } catch(e){ alert('Could not read the file: ' + e.message); }
}
// one plan row per data row: what will happen and what is wrong with it
function planPeople(){
  const seen = new Set();
  return pimp.rows.map((r, i) => {
    const s = k => { const j = pimp.map[k]; return j >= 0 ? String(r[j] ?? '').trim() : ''; };
    const name = s('name'), svcText = s('service'), modeText = s('mode'), mode = modeText ? parseMode(modeText) : pimp.defMode || null;
    const errors = [];
    if (pimp.map.name < 0 || pimp.map.service < 0 || (pimp.map.mode < 0 && !pimp.defMode)) errors.push('column not mapped');
    if (!name) errors.push('missing name');
    if (!svcText) errors.push('missing Service');
    if (!mode) errors.push(modeText ? `invalid Work Mode: “${modeText}” (${db.modes.map(m => m.name).join(' / ')})` : 'missing Work Mode');
    let svc = svcText ? db.services.find(x => norm(x.name) === norm(svcText)) : null, unknownSvc = null;
    if (svcText && !svc){
      unknownSvc = svcText;
      const choice = pimp.svcMap[norm(svcText)] || '';
      if (!choice) errors.push(`unknown Service: “${svcText}” – choose below`);
      else if (choice === '__skip') errors.push('row skipped (unknown Service)');
      else if (choice !== '__new') svc = service(choice);
    }
    const exists = name && db.people.find(p => norm(p.name) === norm(name));
    const dupInFile = name && seen.has(norm(name));
    if (name) seen.add(norm(name));
    let action = errors.length ? 'error' : 'new';
    if (action === 'new' && dupInFile) action = 'dupfile';
    if (action === 'new' && exists && !pimp.allowDup) action = 'exists';
    return {row:i + 2, name, svcText, svc, unknownSvc, mode, modeText, errors, action, exists};
  });
}
const PPLAN = {new:'<span class="pill ok">New</span>', error:'<span class="pill bad">Error</span>', exists:'<span class="pill warn">Already exists – skip</span>', dupfile:'<span class="pill warn">Duplicate in file – skip</span>'};
function runPeopleImport(){
  const plan = planPeople(), ok = plan.filter(p => p.action === 'new');
  if (!ok.length) return;
  if (!confirm(`${ok.length} people will be created from ${pimp.fileName}.\n${plan.length - ok.length} row(s) are skipped.\n\nContinue?`)) return;
  const created = new Map();
  for (const p of ok){
    let svcId = p.svc ? p.svc.id : null;
    if (!svcId && p.unknownSvc){
      const k = norm(p.unknownSvc);
      if (!created.has(k)){ const s = {id:uid(), name:p.unknownSvc, note:'Created during import'}; db.services.push(s); created.set(k, s.id); }
      svcId = created.get(k);
    }
    db.people.push({id:uid(), name:p.name, email:'', serviceId:svcId, roleId:null, mode:p.mode, status:'Active', tickets:[], note:''});
  }
  log(null, `${ok.length} people imported (${pimp.fileName})${created.size ? ` · new Services: ${[...created.keys()].length}` : ''}`, 'created');
  save();
  alert(`Import finished.\n\nPeople created: ${ok.length}\nNew Services: ${created.size}\nRows skipped: ${plan.length - ok.length}`);
  pimp = null; location.hash = '#/people';
}
function viewPeopleImport(){
  let body = '';
  if (pimp){
    const plan = planPeople(), cnt = k => plan.filter(p => p.action === k).length;
    const unknown = [...new Map(plan.filter(p => p.unknownSvc).map(p => [norm(p.unknownSvc), p.unknownSvc])).entries()];
    body = `
      <h2>2. Columns – ${esc(pimp.fileName)} (${pimp.rows.length} rows)</h2>
      <div class="card"><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:4px 16px">
        ${PEOPLE_FIELDS.map(f => `<div><label class="f">${f.label} *</label>${mapSelect(f, pimp.headers, pimp.map, 'data-pmap')}</div>`).join('')}</div>
        <div style="max-width:320px"><label class="f">Work Mode for rows without one</label><select id="pDefMode"><option value="">– report as an error –</option>${db.modes.map(m => `<option value="${esc(m.id)}"${pimp.defMode === m.id ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
        <p class="muted" style="font-size:12px;margin:8px 0 0">Only these three values are needed. E-mail, Job Role and the rest can be set later. Existing people are never changed by the import.</p></div>
      ${unknown.length ? `<h2>⚠️ Unknown Service (${unknown.length})</h2><div class="warnbox" style="font-size:14px">The file names a Service that is not in the system yet. Choose what to do:</div>
        <div class="tbl-wrap"><table><thead><tr><th>Service in the file</th><th>Rows</th><th>Action</th></tr></thead><tbody>${unknown.map(([k, name]) =>
          `<tr><td><b>${esc(name)}</b></td><td>${plan.filter(p => p.unknownSvc && norm(p.unknownSvc) === k).length}</td><td><select data-svc="${esc(k)}">
            <option value="">– choose –</option><option value="__new"${pimp.svcMap[k] === '__new' ? ' selected' : ''}>＋ Create as a new Service</option>
            <optgroup label="Map to an existing one">${sortHu(db.services, s => s.name).map(s => `<option value="${s.id}"${pimp.svcMap[k] === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</optgroup>
            <option value="__skip"${pimp.svcMap[k] === '__skip' ? ' selected' : ''}>Skip these rows</option></select></td></tr>`).join('')}</tbody></table></div>` : ''}
      <h2>3. Preview</h2>
      <p>${PPLAN.new} ${cnt('new')} &nbsp; ${PPLAN.error} ${cnt('error')} &nbsp; Skipped:${cnt('exists') + cnt('dupfile')}
        <label class="cb" style="display:inline-flex;margin:0 0 0 12px"><input type="checkbox" id="pAllowDup"${pimp.allowDup ? ' checked' : ''}> Also create people whose name already exists</label></p>
      <div class="tbl-wrap"><table><thead><tr><th>Row</th><th>Action</th><th>Full Name</th><th>Service</th><th>Work Mode</th><th>Note</th></tr></thead><tbody>
        ${plan.slice(0, 200).map(p => `<tr><td class="muted">${p.row}</td><td>${PPLAN[p.action]}</td><td>${esc(p.name) || '<span class="muted">–</span>'}${p.exists ? ` <a href="#/person/${p.exists.id}" class="muted">(existing)</a>` : ''}</td>
          <td>${p.svc ? esc(p.svc.name) : p.unknownSvc ? esc(p.unknownSvc) + (pimp.svcMap[norm(p.unknownSvc)] === '__new' ? ' <span class="pill acc">new</span>' : '') : '<span class="muted">–</span>'}</td>
          <td>${p.mode ? modePill(p.mode) : esc(p.modeText) || '<span class="muted">–</span>'}</td>
          <td>${p.errors.length ? `<span style="color:var(--danger)">${esc(p.errors.join('; '))}</span>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
      ${plan.length > 200 ? `<p class="muted">… and ${plan.length - 200} more rows.</p>` : ''}
      <div class="row" style="margin-top:14px"><button class="primary" id="pRun" onclick="runPeopleImport()"${cnt('new') ? '' : ' disabled'}>⬆ Import (${cnt('new')} people)</button>
        <button onclick="pimp=null;render()">Cancel</button></div>`;
  }
  return `
    <div class="row"><a href="#/people">← People</a></div>
    <h1 style="margin-top:8px">Import people from Excel</h1>
    <div class="sub">Exactly three values are needed: <b>Full Name</b>, <b>Service</b> and <b>Work Mode</b>.</div>
    <div class="card"><b>📄 Template</b>
      <p class="muted">Columns: Full Name · Service · Work Mode. Common spellings such as “office”, “hibrid” and “home office” are recognized.</p>
      <div class="row"><button class="primary" onclick="downloadPeopleTemplate()">⬇ Excel template (.xlsx)</button><button onclick="downloadPeopleCSV()">⬇ CSV template</button></div></div>
    <h2>1. Choose a file</h2>
    <div class="card row"><input type="file" id="pimpFile" accept=".xlsx,.xls,.csv,.txt"><span class="muted">Excel (.xlsx, .xls) or CSV</span></div>
    ${body}`;
}
function bindPeopleImport(){
  $('#pimpFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) readPeopleFile(f); });
  if (!pimp) return;
  document.querySelectorAll('[data-pmap]').forEach(s => s.addEventListener('change', () => { pimp.map[s.dataset.pmap] = +s.value; render(); }));
  document.querySelectorAll('[data-svc]').forEach(s => s.addEventListener('change', () => { pimp.svcMap[s.dataset.svc] = s.value; render(); }));
  $('#pAllowDup').addEventListener('change', e => { pimp.allowDup = e.target.checked; render(); });
  $('#pDefMode').addEventListener('change', e => { pimp.defMode = e.target.value; render(); });
}
const PEOPLE_TEMPLATE = [['Full Name', 'Service', 'Work Mode'], ['Sample Sarah', 'Customer Support', 'Onsite'], ['Example Eric', 'IT Support', 'Hybrid'], ['Test Tina', 'Finance', 'WFH']];
async function downloadPeopleTemplate(){
  try {
    const X = await loadXLSX(), wb = X.utils.book_new(), ws = X.utils.aoa_to_sheet(PEOPLE_TEMPLATE);
    ws['!cols'] = [{wch:28}, {wch:24}, {wch:20}];
    X.utils.book_append_sheet(wb, ws, 'People');
    const g = X.utils.aoa_to_sheet([['Column', 'What to enter'], ['Full Name', 'Required.'], ['Service', 'Required. An unknown Service can be created or mapped during import.'],
      ['Work Mode', 'Required, or choose a default during import.'], [], ['Tip', 'Delete the example rows before importing.']]);
    g['!cols'] = [{wch:20}, {wch:100}];
    X.utils.book_append_sheet(wb, g, 'Guide');
    X.writeFile(wb, 'tc-itam-people-import-template.xlsx');
  } catch(e){ alert(e.message + '\nDownloading the CSV template instead.'); downloadPeopleCSV(); }
}
function downloadPeopleCSV(){ download('tc-itam-people-import-template.csv', '﻿' + PEOPLE_TEMPLATE.map(csvLine).join('\r\n'), 'text/csv'); }
