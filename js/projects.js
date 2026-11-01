'use strict';
/* Projects: preparing equipment for named people or for a demand without names yet.
   Planned quantities, selected assets and issued assets are separate: selected assets are only reserved, the checkout and the document
   happen at completion through the regular flow. Cables are checklist items only. Replaced assets use the shared return records (db.returns). */

const SLOTS = [['computerId', 'computer', 'Computer'], ['monitorId', 'monitor', 'Monitor'], ['monitor2Id', 'monitor2', '2nd Monitor']];
const isActive = pr => pr.status !== 'completed' && pr.status !== 'cancelled';
const projectStatusPill = s => `<span class="pill ${{completed:'ok', cancelled:'bad', ready:'acc', progress:'warn'}[s] || ''}">${s === 'completed' ? '✅ ' : ''}${PROJECT_STATUS[s] || s}</span>`;
const hasAct = (pr, a) => pr.activities.includes(a);
const actPills = pr => pr.activities.map(a => `<span class="pill acc">${esc(ACTIVITIES[a])}</span>`).join(' ');
const shipRoute = s => s.fromOfficeId && s.toOfficeId ? `${shipOffice(s.fromOfficeId)} → ${shipOffice(s.toOfficeId)}` : `to ${(person(s.recvPersonId) || {}).name || '?'}`;
// what this project has to achieve: only the selected activities count; "Received" is the only success for a shipment
function projectTasks(pr){
  const t = [];
  if (hasAct(pr, 'shipment')){
    if (!pr.shipments.length) t.push({label:'Shipment', done:false, detail:'no shipment added yet'});
    for (const s of pr.shipments) t.push({label:'Shipment ' + shipRoute(s), done:s.status === 'Received', optional:s.required === false, detail:s.status === 'Sent' ? 'sent, receipt not confirmed' : s.status === 'Received' ? 'received' : 'not sent yet'});
  }
  if (hasAct(pr, 'preparation')){
    // named people are prepared in the participant table, so a demand line is only needed without them
    if (!pr.demand.length) t.push({label:'Equipment Preparation', done:pr.participants.length > 0, detail:pr.participants.length ? 'prepared per participant' : 'no demand line added yet'});
    for (const l of pr.demand){ const c = demandCounts(pr, l); t.push({label:'Preparation: ' + typeLabel(l.typeId), done:c.selected >= l.qty, detail:`${c.selected} of ${l.qty} selected`}); }
  }
  if (hasAct(pr, 'assignment')){
    const n = pr.participants.filter(x => partAssetIds(x).length).length;
    t.push({label:'Asset Assignment', done:n > 0, detail:n ? `${n} participant(s) with assets` : 'no asset selected for any participant'});
  }
  if (hasAct(pr, 'replacement')){
    const open = pr.replacements.filter(r => (repReturn(pr, r) || {}).state === 'awaiting').length;
    t.push({label:'Replacement', done:pr.replacements.length > 0, detail:pr.replacements.length ? `${pr.replacements.length} replacement(s)${open ? `, ${open} old asset(s) still awaited (does not block)` : ''}` : 'no replacement added yet'});
  }
  return t;
}
const taskLine = t => `${t.done ? '✔' : t.optional ? '○' : '✕'} ${t.label}: ${t.detail}${t.optional ? ' (optional)' : ''}`;
function taskCard(pr){
  const list = projectTasks(pr);
  return `<div class="card" id="prTasks" style="margin-bottom:12px"><b>${isActive(pr) ? 'Completion checklist' : 'Result'}</b>${pr.result === 'successful' ? ' <span class="pill ok">Successful</span>' : ''}
    ${list.map(t => `<div class="ptask"><span style="color:var(--${t.done ? 'ok' : t.optional ? 'muted' : 'warn'})">${t.done ? '✔' : t.optional ? '○' : '✕'}</span> ${esc(t.label)} <small class="muted">${esc(t.detail)}${t.optional ? ' · optional' : ''}</small></div>`).join('')}</div>`;
}
const partAssetIds = x => [x.computerId, x.monitorId, x.monitor2Id, ...(x.otherIds || [])].filter(Boolean);
// which active project has reserved this asset
function reservedBy(assetId){
  for (const pr of db.projects) if (isActive(pr)){
    for (const part of pr.participants){
      const slot = SLOTS.find(([f]) => part[f] === assetId);
      if (slot) return {project:pr, part, slot:slot[1], prep:part.prep[slot[1]] || ''};
      if (part.otherIds.includes(assetId)) return {project:pr, part, slot:'other', prep:part.prep[assetId] || ''};
    }
    for (const line of pr.demand) if (line.assetIds.includes(assetId)) return {project:pr, part:null, line, slot:'demand', prep:(line.prep || {})[assetId] || ''};
    for (const rep of pr.replacements) if (rep.newId === assetId) return {project:pr, part:{personId:rep.personId}, rep, slot:'replacement', prep:''};
  }
  return null;
}
// free stock for a slot: working, in storage, not reserved by anyone else
function slotCandidates(kind, current){
  return sortHu(db.assets.filter(a => {
    if (a.id === current) return true;
    if (a.status !== 'ok' || !['storage', 'site'].includes(a.holder.kind) || reservedBy(a.id)) return false;
    return kind === 'other' ? a.type !== 'pc' && a.type !== 'monitor' : a.type === kind;
  }), a => modelName(a) + a.tag);
}
function projectProgress(pr){
  let done = 0, total = 0;
  for (const x of pr.participants){
    total += 2 + CHECKLIST.length;
    if (x.computerId) done++;
    if (x.monitorId || (x.manualSerial || {}).monitor) done++;
    done += CHECKLIST.filter(([k]) => x.checklist[k]).length;
  }
  for (const l of pr.demand){ const c = demandCounts(pr, l); total += l.qty; done += Math.min(l.qty, c.selected); }
  for (const s of pr.shipments) if (s.required !== false){ total++; if (s.status === 'Received') done++; }
  return total ? Math.round(done / total * 100) : 0;
}
const projectAssetIds = pr => [...pr.participants.flatMap(partAssetIds), ...pr.demand.flatMap(l => l.assetIds), ...pr.replacements.map(r => r.newId).filter(Boolean)];
function demandCounts(pr, l){
  const linked = pr.participants.flatMap(partAssetIds).map(asset).filter(a => a && a.type === l.typeId);
  const issued = new Set([...(pr.issuedIds || []).filter(id => (asset(id) || {}).type === l.typeId),
    ...pr.participants.flatMap(x => partAssetIds(x).filter(id => { const a = asset(id); return a && a.type === l.typeId && a.holder.kind === 'person' && a.holder.id === x.personId; }))]);
  return {selected:l.assetIds.length + linked.length, issued:issued.size};
}
const demandText = pr => pr.demand.map(l => `${l.qty} × ${typeLabel(l.typeId)}`).join(', ');

function viewProjects(params){
  const q = params.get('q') || '', st = params.get('status') || '';
  let list = db.projects;
  if (st === 'active') list = list.filter(isActive); else if (st) list = list.filter(p => p.status === st);
  if (q){ const n = norm(q); list = list.filter(pr => norm([pr.name, pr.ticket, pr.owner, pr.note, ...pr.participants.map(x => (person(x.personId) || {}).name)].join(' ')).includes(n)); }
  list = sortHu(list, pr => (isActive(pr) ? '0' : '1') + (pr.pickupDate || '9999'));
  return `
    <div class="row"><h1>Projects</h1><span class="spacer"></span><button class="primary" onclick="projectForm()">+ New project</button></div>
    <div class="sub">Preparing equipment for people or for a demand without names yet. Assets stay reserved until the project is completed; nothing is checked out before that.</div>
    <div class="row" style="margin-bottom:12px">
      <input id="prq" placeholder="Search: name, ticket, owner, participant…" value="${esc(q)}" style="min-width:280px">
      <select id="prst"><option value="">All statuses</option><option value="active"${st === 'active' ? ' selected' : ''}>Active (not closed)</option>
        ${Object.entries(PROJECT_STATUS).map(([k, v]) => `<option value="${k}"${k === st ? ' selected' : ''}>${v}</option>`).join('')}</select>
    </div>
    ${list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Project name</th><th>Activities</th><th>Participants / demand</th><th>Pickup / deadline</th><th>Owner</th><th>Ticket</th><th>Status</th><th>Preparation</th><th>Note</th></tr></thead><tbody>${list.map(pr => {
      const pct = projectProgress(pr);
      return `<tr><td><a href="#/project/${pr.id}"><b>${esc(pr.name)}</b></a></td><td>${actPills(pr)}</td>
        <td>${pr.participants.map(x => esc((person(x.personId) || {}).name || '?')).join(', ') || (pr.demand.length ? `<span class="muted">${esc(demandText(pr))}</span>` : pr.shipments.length ? `<span class="muted">${esc(pr.shipments.map(shipRoute).join(', '))}</span>` : '<span class="muted">–</span>')}</td>
        <td style="white-space:nowrap">${fmtDate(pr.pickupDate)}</td><td>${esc(pr.owner) || '<span class="muted">–</span>'}</td>
        <td class="tag">${esc(pr.ticket) || '<span class="muted">–</span>'}</td><td>${projectStatusPill(pr.status)}</td>
        <td><div class="progress" title="${pct}%"><i style="width:${pct}%"></i></div><small class="muted">${pct}%</small></td>
        <td class="muted">${esc(pr.note)}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="empty">No projects match the filter.</div>'}`;
}
function bindProjects(){
  const upd = () => {
    const p = new URLSearchParams(); if ($('#prq').value) p.set('q', $('#prq').value); if ($('#prst').value) p.set('status', $('#prst').value);
    history.replaceState(null, '', '#/projects' + (p.toString() ? '?' + p : ''));
    const pos = $('#prq').selectionStart; render(); $('#prq').focus(); $('#prq').setSelectionRange(pos, pos);
  };
  $('#prq').addEventListener('input', upd); $('#prst').addEventListener('change', upd);
}
function projectForm(pr){
  const isNew = !pr;
  pr = pr || {name:'', owner:currentUser(), pickupDate:'', ticket:'', note:'', status:'planning', targetServiceId:null, targetRoomId:null, accessories:'', activities:[]};
  const tmp = {participants:[], demand:[], replacements:[]};
  // a block is shown only when one of the activities in data-act is selected
  const block = (acts, html) => `<div data-act="${acts}">${html}</div>`;
  openDialog(`
    <h3>${isNew ? 'New project' : 'Project details'}</h3>
    <label class="f">Project name</label><input name="name" required value="${esc(pr.name)}" placeholder="e.g. Debrecen to Budapest – 5 computers">
    <label class="f">Included Activities *</label>
    <div class="grid" id="prActs" style="grid-template-columns:repeat(2,1fr);gap:0 8px">${Object.entries(ACTIVITIES).map(([k, l]) => `<label class="cb" style="margin:4px 0"><input type="checkbox" name="act_${k}" data-actk="${k}"${pr.activities.includes(k) ? ' checked' : ''}> ${l}</label>`).join('')}</div>
    <div class="two">
      <div><label class="f">Project owner</label><input name="owner" list="ownerList" value="${esc(pr.owner)}"><datalist id="ownerList">${sortHu(db.people, p => p.name).map(p => `<option value="${esc(p.name)}">`).join('')}</datalist></div>
      <div><label class="f">Ticket ID</label><input name="ticket" value="${esc(pr.ticket)}" placeholder="e.g. INC-20417"></div>
      <div><label class="f">Project status</label><select name="status">${Object.entries(PROJECT_STATUS).filter(([k]) => k !== 'completed').map(([k, v]) => `<option value="${k}"${k === pr.status ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
      ${block('preparation assignment replacement', `<label class="f">Planned pickup date / deadline</label><input type="date" name="pickupDate" value="${esc(pr.pickupDate)}" style="width:100%">`)}
    </div>
    ${block('preparation', `<div class="two">
      <div><label class="f">Target Service</label><select name="targetServiceId">${selOpts(sortHu(db.services, s => s.name), pr.targetServiceId, s => s.name, '–')}</select></div>
      <div><label class="f">Target location</label><select name="targetRoomId">${selOpts(sortHu(db.rooms, r => r.name), pr.targetRoomId, r => r.name, '–')}</select></div></div>
      <label class="f">Planned accessories</label><input name="accessories" value="${esc(pr.accessories)}" placeholder="e.g. headset, monitor, dock">`)}
    ${isNew ? block('shipment', `<h3 style="margin-top:14px;font-size:14px">📦 Shipment</h3>${shipFields()}`) : ''}
    <label class="f">Note</label><textarea name="note" style="width:100%">${esc(pr.note)}</textarea>
    ${block('assignment', '<p class="muted" style="font-size:12px">Add the participants on the project page.</p>')}
    ${block('preparation', '<p class="muted" style="font-size:12px">Add the planned quantities on the project page. People can be linked later.</p>')}
    ${block('replacement', '<p class="muted" style="font-size:12px">Add the old and replacement assets on the project page.</p>')}
    ${dlgActions(isNew ? 'Create' : 'Save')}`,
    data => {
      const activities = Object.keys(ACTIVITIES).filter(k => data['act_' + k]);
      if (!activities.length){ alert('Select at least one activity.'); return false; }
      const v = {name:data.name.trim(), owner:data.owner.trim(), pickupDate:data.pickupDate, ticket:data.ticket.trim(), note:data.note.trim(), status:data.status,
        targetServiceId:data.targetServiceId || null, targetRoomId:data.targetRoomId || null, accessories:data.accessories.trim(), activities};
      if (isNew){
        const n = {id:uid(), ...v, created:Date.now(), completedAt:null, participants:[], demand:[], shipments:[], replacements:[]};
        let ship = null;
        if (activities.includes('shipment') && (data.from || data.to || data.recvP || shipPicked(tmp, data).length)){ ship = readShipment(tmp, data); if (!ship) return false; }
        db.projects.push(n); plog(n.id, `Project created: ${n.name} (${activities.map(a => ACTIVITIES[a]).join(', ')})`);
        if (ship){ n.shipments.push(ship); plog(n.id, `Shipment created: ${shipRoute(ship)} – ${ship.assetIds.map(i => asset(i).tag).join(', ')}`); }
        save(); location.hash = '#/project/' + n.id; return;
      }
      // removing an activity keeps its records; the user is told before it happens
      const removed = pr.activities.filter(a => !activities.includes(a)), used = {shipment:pr.shipments.length, preparation:pr.demand.length, assignment:pr.participants.length, replacement:pr.replacements.length};
      const affected = removed.filter(a => used[a]);
      if (affected.length && !confirm(`These activities have recorded data:\n\n${affected.map(a => `• ${ACTIVITIES[a]}: ${used[a]} record(s)`).join('\n')}\n\nThe records are kept and stay visible, but they no longer count when the project is completed, and their assets are not checked out. Continue?`)) return false;
      const lbl = {name:'Name', owner:'Owner', pickupDate:'Planned pickup', ticket:'Ticket', note:'Note', status:'Status', accessories:'Accessories'};
      const show = (k, x) => k === 'status' ? PROJECT_STATUS[x] : x;
      const ch = Object.keys(lbl).filter(k => (pr[k] || '') !== (v[k] || '')).map(k => `${lbl[k]}: ${show(k, pr[k]) || '–'} → ${show(k, v[k]) || '–'}`);
      if (pr.activities.join() !== activities.join()) ch.push(`Activities: ${activities.map(a => ACTIVITIES[a]).join(', ')}`);
      // a new project-level date is passed on to participants that still had the old one
      if (pr.pickupDate !== v.pickupDate) for (const x of pr.participants) if (!x.pickupDate || x.pickupDate === pr.pickupDate) x.pickupDate = v.pickupDate;
      Object.assign(pr, v);
      if (ch.length) plog(pr.id, 'Project updated – ' + ch.join('; '));
      save(); render();
    });
  const sync = () => {
    const on = [...document.querySelectorAll('[data-actk]')].filter(c => c.checked).map(c => c.dataset.actk);
    document.querySelectorAll('#dlgForm [data-act]').forEach(b => { b.hidden = !b.dataset.act.split(' ').some(a => on.includes(a)); });
  };
  document.querySelectorAll('[data-actk]').forEach(c => c.addEventListener('change', sync));
  if (isNew) bindShipFields(tmp);
  sync();
}

function slotCell(pr, x, f, slot, ro){
  const a = x[f] && asset(x[f]);
  if (ro) return a ? `${aidLink(a)}<div class="sn">${esc(a.serial)}</div>` : '<span class="muted">–</span>';
  const kind = slot === 'computer' ? 'pc' : 'monitor';
  const opts = slotCandidates(kind, x[f]).map(c => `<option value="${c.id}"${c.id === x[f] ? ' selected' : ''}>${esc(c.tag)} · ${esc(modelName(c))}</option>`).join('');
  return `<select data-pp="${x.id}" data-pf="${f}"><option value="">– none –</option>${opts}</select>
    ${a ? `<div class="sn">S/N ${esc(a.serial) || '–'}${a.holder.kind !== 'storage' && !(a.holder.kind === 'person' && a.holder.id === x.personId) ? ' <span style="color:var(--danger)">⚠ no longer in stock</span>' : ''}</div>` : ''}
    ${slot !== 'computer' && !a ? `<input type="text" data-pp="${x.id}" data-pf="serial_${slot}" value="${esc((x.manualSerial || {})[slot] || '')}" placeholder="S/N manually" style="margin-top:3px">` : ''}
    ${a ? `<div class="prep"><select data-pp="${x.id}" data-pf="prep_${slot}" title="Preparation status">${PREP_STATUS.map(s => `<option value="${esc(s)}"${(x.prep[slot] || '') === s ? ' selected' : ''}>${s || 'Preparation: –'}</option>`).join('')}</select></div>` : ''}`;
}
function demandHtml(pr, ro){
  if (!pr.demand.length && ro) return '';
  const rows = pr.demand.map(l => {
    const c = demandCounts(pr, l);
    const chosen = l.assetIds.map(asset).filter(Boolean).map(a => `<div class="dline">${aidLink(a)} <small class="muted">${esc(assetName(a))}</small>
      ${ro ? '' : `<select data-dprep="${l.id}|${a.id}" title="Preparation status">${PREP_STATUS.map(s => `<option value="${esc(s)}"${((l.prep || {})[a.id] || '') === s ? ' selected' : ''}>${s || 'Preparation: –'}</option>`).join('')}</select>
      ${pr.participants.length ? `<select data-dlink="${l.id}|${a.id}"><option value="">Link to person…</option>${pr.participants.map(x => `<option value="${x.id}">${esc((person(x.personId) || {}).name || '?')}</option>`).join('')}</select>` : ''}
      <button class="sm" data-dun="${l.id}|${a.id}" title="Remove from project">✕</button>`}</div>`).join('');
    return `<tr><td>${typeIcon(l.typeId)} ${esc(typeLabel(l.typeId))}</td>
      <td>${ro ? l.qty : `<input type="number" min="0" data-dqty="${l.id}" value="${l.qty}" style="width:70px">`}</td>
      <td><b>${c.selected}</b> / ${l.qty}${chosen}${ro ? '' : `<select data-dadd="${l.id}" style="margin-top:4px"><option value="">+ select asset…</option>${slotCandidates(l.typeId).map(a => `<option value="${a.id}">${esc(a.tag)} · ${esc(assetName(a))}</option>`).join('')}</select>`}</td>
      <td><b>${c.issued}</b></td>
      ${ro ? '' : `<td><button class="sm danger" data-drm="${l.id}" title="Remove line">✕</button></td>`}</tr>`;
  }).join('');
  return `<div class="row"><h2>Planned demand</h2><span class="spacer"></span>${ro ? '' : `<button class="sm" onclick="demandDialog('${pr.id}')">+ Demand line</button>`}</div>
    ${pr.demand.length ? `<div class="tbl-wrap"><table><thead><tr><th>Asset Type</th><th>Planned quantity</th><th>Selected assets (reserved)</th><th>Issued</th>${ro ? '' : '<th></th>'}</tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">No demand recorded. Use it when only the quantities are known.</div>'}`;
}
const repReturn = (pr, r) => db.returns.filter(x => x.assetId === r.oldId && x.personId === r.personId && x.projectId === pr.id).pop();
function replacementHtml(pr){
  const rows = pr.replacements.map(r => {
    const ret = repReturn(pr, r), old = asset(r.oldId), nw = r.newId && asset(r.newId), st = ret ? ret.state : 'notRequired';
    return `<tr><td>${personLink(r.personId)}</td><td>${old ? `${aidLink(old)}<br><small class="muted">${esc(assetName(old))}</small>` : '<span class="muted">deleted</span>'}</td>
      <td>${nw ? `${aidLink(nw)}<br><small class="muted">${esc(assetName(nw))}</small>` : '<span class="muted">–</span>'}</td>
      <td><span class="pill ${ret ? returnCls(ret) : ''}" data-rep-state="${r.id}">${RETURN_STATE[st]}</span>${ret ? returnBadge(ret) : ''}${ret && ret.closedAt ? `<br><small class="muted">${fmtTime(ret.closedAt)}</small>` : ''}</td>
      <td style="text-align:right;white-space:nowrap">${st === 'awaiting' && old ? `<button class="sm primary" onclick="toStorage('${old.id}')">↩ Record return</button> <button class="sm" onclick="setRepState('${pr.id}','${r.id}','notRequired')">Not Required</button>` : ''}
        ${st === 'notRequired' && old ? `<button class="sm" onclick="setRepState('${pr.id}','${r.id}','awaiting')">Expect return</button>` : ''}</td></tr>`;
  }).join('');
  return `<div class="row"><h2>🔁 Replacements</h2><span class="spacer"></span><button class="sm" onclick="replacementDialog('${pr.id}')">+ Replacement</button></div>
    ${pr.replacements.length ? `<div class="tbl-wrap"><table><thead><tr><th>Recipient</th><th>Old asset</th><th>Replacement asset</th><th>Return</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted" style="font-size:12px">“Returned” is set only by the real return. The project can be completed while an old asset is still on its way back.</p>` : '<div class="empty">No replacements in this project.</div>'}`;
}
const shipOffice = id => (office(id) || {}).name || '–';
function shipmentHtml(pr, ro){
  const rows = pr.shipments.map(s => {
    const moving = s.fromOfficeId && s.toOfficeId;
    return `<tr data-ship="${s.id}"><td>${esc(moving ? shipOffice(s.fromOfficeId) : s.from || '–')}</td><td>${esc(shipOffice(s.toOfficeId))}</td>
      <td>${s.sendPersonId ? personLink(s.sendPersonId) : '<span class="muted">–</span>'}</td><td>${s.recvPersonId ? personLink(s.recvPersonId) : '<span class="muted">–</span>'}</td>
      <td>${s.assetIds.map(asset).filter(Boolean).map(a => `${aidLink(a)} <small class="muted">${esc(assetName(a))}</small>`).join('<br>') || '<span class="muted">–</span>'}</td>
      <td><span class="pill ${{Sent:'warn', Received:'ok'}[s.status] || ''}">${s.status === 'Sent' ? 'Sent, awaiting receipt' : s.status}</span>${s.required === false ? ' <span class="pill">Optional</span>' : ''}${s.receivedAt ? `<br><small class="muted">${fmtTime(s.receivedAt)}</small>` : ''}</td>
      <td style="text-align:right;white-space:nowrap">
        ${s.status === 'Preparing' ? `<button class="sm primary" onclick="shipAction('${pr.id}','${s.id}','send')">Mark as Sent</button> <button class="sm danger" onclick="removeShipment('${pr.id}','${s.id}')">✕</button>` : ''}
        ${s.status === 'Sent' ? `<button class="sm primary" onclick="shipAction('${pr.id}','${s.id}','receive')">Record receipt</button> <button class="sm" onclick="shipAction('${pr.id}','${s.id}','cancel')">Cancel sending</button>` : ''}</td></tr>`;
  }).join('');
  return `<div class="row"><h2>📦 Shipments</h2><span class="spacer"></span><button class="sm" onclick="shipmentDialog('${pr.id}')">+ Shipment</button></div>
    ${pr.shipments.length ? `<div class="tbl-wrap"><table><thead><tr><th>Sending Office</th><th>Receiving Office</th><th>Sending Person</th><th>Receiving Person</th><th>Shipment Items</th><th>Shipment Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">No shipments in this project.</div>'}`;
}
function viewProject(id){
  const pr = project(id);
  if (!pr) return `<div class="empty">Project not found.</div>`;
  const ro = !isActive(pr), docs = db.docs.filter(d => d.projectId === id), logs = db.log.filter(l => l.projectId === id);
  const rows = pr.participants.map(x => {
    const p = person(x.personId);
    const others = (x.otherIds || []).map(asset).filter(Boolean);
    return `<tr>
      <td>${p ? esc(serviceName(p.serviceId)) || '<span class="muted">–</span>' : '–'}</td>
      <td>${ro ? fmtDate(x.pickupDate) : `<input type="date" data-pp="${x.id}" data-pf="pickupDate" value="${esc(x.pickupDate || '')}">`}</td>
      <td>${p ? `<a href="#/person/${p.id}"><b>${esc(p.name)}</b></a><br>${modePill(p.mode)}` : '<span class="muted">deleted person</span>'}</td>
      <td>${slotCell(pr, x, 'computerId', 'computer', ro)}</td>
      <td>${slotCell(pr, x, 'monitorId', 'monitor', ro)}</td>
      <td>${slotCell(pr, x, 'monitor2Id', 'monitor2', ro)}</td>
      ${CHECKLIST.map(([k, l]) => `<td class="cb"><input type="checkbox" data-pp="${x.id}" data-pf="ck_${k}"${x.checklist[k] ? ' checked' : ''}${ro ? ' disabled' : ''} title="${l}"></td>`).join('')}
      <td>${others.map(a => `<div style="white-space:nowrap">${aidLink(a)} <small class="muted">${esc(typeLabel(a.type))}</small>${ro ? '' : ` <button class="sm" data-rm-other="${x.id}|${a.id}" title="Remove">✕</button>`}</div>`).join('')}
        ${ro ? (others.length ? '' : '<span class="muted">–</span>') : `<select data-pp="${x.id}" data-pf="addOther"><option value="">+ asset…</option>${slotCandidates('other').map(c => `<option value="${c.id}">${typeIcon(c.type)} ${esc(c.tag)} · ${esc(modelName(c))}</option>`).join('')}</select>`}</td>
      ${ro ? '' : `<td><button class="sm danger" data-rm-part="${x.id}" title="Remove participant">✕</button></td>`}
    </tr>`;
  }).join('');
  const pct = projectProgress(pr);
  return `
    <div class="row"><a href="#/projects">← Projects</a></div>
    <div class="row" style="margin-top:8px"><h1>📋 ${esc(pr.name)}</h1> ${projectStatusPill(pr.status)}<span class="spacer"></span>
      ${ro ? '' : `<button onclick="projectForm(project('${pr.id}'))">✎ Project details</button>
        ${hasAct(pr, 'assignment') || hasAct(pr, 'preparation') ? `<button onclick="addParticipantDialog('${pr.id}')">+ Participant</button>` : ''}
        <button class="primary" onclick="completeProject('${pr.id}')">✅ Complete project</button>`}
      <button class="danger" onclick="deleteProject('${pr.id}')">Delete</button></div>
    <div class="card" style="margin:12px 0"><dl class="kv">
      <dt>Included Activities</dt><dd id="prActivities">${actPills(pr)}</dd>
      <dt>Project owner</dt><dd>${esc(pr.owner) || '–'}</dd>
      <dt>Pickup / deadline</dt><dd>${fmtDate(pr.pickupDate)}</dd>
      <dt>Ticket ID</dt><dd>${pr.ticket ? `<span class="tag">${esc(pr.ticket)}</span>${copyBtn(pr.ticket)}` : '–'}</dd>
      <dt>Target</dt><dd>${[serviceName(pr.targetServiceId), (room(pr.targetRoomId) || {}).name].filter(Boolean).map(esc).join(' · ') || '–'}</dd>
      <dt>Planned accessories</dt><dd>${esc(pr.accessories) || '–'}</dd>
      <dt>Status</dt><dd>${ro ? projectStatusPill(pr.status) : `<select id="prStatus">${Object.entries(PROJECT_STATUS).filter(([k]) => k !== 'completed').map(([k, v]) => `<option value="${k}"${k === pr.status ? ' selected' : ''}>${v}</option>`).join('')}</select>`}</dd>
      <dt>Preparation</dt><dd><div class="progress" style="width:200px;display:inline-block;vertical-align:middle"><i style="width:${pct}%"></i></div> ${pct}%</dd>
      <dt>Note</dt><dd style="white-space:pre-wrap">${esc(pr.note) || '–'}</dd>
      ${pr.completedAt ? `<dt>Completed</dt><dd>${fmtTime(pr.completedAt)}</dd>` : ''}
    </dl></div>
    ${taskCard(pr)}
    ${[...pr.activities.length ? [] : [], ...Object.keys(ACTIVITIES).filter(a => !hasAct(pr, a) && {shipment:pr.shipments.length, preparation:pr.demand.length, assignment:pr.participants.length, replacement:pr.replacements.length}[a])].map(a => `<div class="warnbox">${esc(ACTIVITIES[a])} is not selected for this project. Its records are kept below but do not count at completion.</div>`).join('')}
    ${hasAct(pr, 'shipment') || pr.shipments.length ? shipmentHtml(pr, ro) : ''}
    ${hasAct(pr, 'preparation') || pr.demand.length ? demandHtml(pr, ro) : ''}
    ${hasAct(pr, 'assignment') || pr.participants.length ? `<h2>Participants and equipment (${pr.participants.length})</h2>
    <p class="muted" style="font-size:12px;margin-top:-4px">Inventory items (with Asset ID): Computer, Monitor, 2nd Monitor, other assets – reserved until completion.
      Checklist (no Asset ID, never inventory): ${CHECKLIST.map(([, l]) => l).join(', ')}.</p>
    ${pr.participants.length ? `<div class="tbl-wrap"><table class="ptable"><thead><tr><th>Service</th><th>Planned pickup date</th><th>Name of the Agent</th>
      <th>Computer</th><th>Monitor Serialnumber</th><th>2nd Monitor</th>${CHECKLIST.map(([, l]) => `<th class="cb">${l}</th>`).join('')}<th>Other assets</th>${ro ? '' : '<th></th>'}</tr></thead>
      <tbody>${rows}</tbody></table></div>` : `<div class="empty">No participants yet. ${ro ? '' : `<button class="sm" onclick="addParticipantDialog('${pr.id}')">+ Participant</button>`}</div>`}` : ''}
    ${hasAct(pr, 'replacement') || pr.replacements.length ? replacementHtml(pr) : ''}
    ${docs.length ? `<h2>📄 Project documents</h2>${docTable(docs, true)}` : ''}
    <h2>Project log</h2>
    ${logTable(logs, {noSubject:true})}`;
}
function bindProject(id){
  const pr = project(id);
  if (!pr) return;
  const view = $('#view');
  const on = (sel, ev, fn) => view.querySelectorAll(sel).forEach(el => el.addEventListener(ev, () => fn(el)));
  if (!isActive(pr)) return;
  const st = $('#prStatus');
  if (st) st.addEventListener('change', () => { plog(pr.id, `Project status: ${PROJECT_STATUS[pr.status]} → ${PROJECT_STATUS[st.value]}`); pr.status = st.value; save(); render(); });
  const line = id => pr.demand.find(l => l.id === id);
  on('[data-dqty]', 'change', el => { const l = line(el.dataset.dqty), q = Math.max(0, +el.value || 0); plog(pr.id, `Planned quantity – ${typeLabel(l.typeId)}: ${l.qty} → ${q}`); l.qty = q; save(); render(); });
  on('[data-drm]', 'click', el => { const l = line(el.dataset.drm); if (!confirm(`Remove the ${typeLabel(l.typeId)} demand line?${l.assetIds.length ? '\nIts selected assets are released.' : ''}`)) return; pr.demand = pr.demand.filter(x => x !== l); plog(pr.id, `Demand line removed: ${typeLabel(l.typeId)}`); save(); render(); });
  on('[data-dadd]', 'change', el => { const a = asset(el.value); if (!a) return; line(el.dataset.dadd).assetIds.push(a.id); plog(pr.id, `Asset selected for demand: ${a.tag} · ${assetName(a)}`); save(); render(); });
  on('[data-dun]', 'click', el => { const [l, aid] = el.dataset.dun.split('|'), a = asset(aid); line(l).assetIds = line(l).assetIds.filter(x => x !== aid); plog(pr.id, `Asset removed from demand: ${a ? a.tag : aid}`); save(); render(); });
  on('[data-dprep]', 'change', el => { const [l, aid] = el.dataset.dprep.split('|'), L = line(l), a = asset(aid); L.prep ||= {}; L.prep[aid] = el.value; plog(pr.id, `Preparation – ${a ? a.tag : aid}: ${el.value || 'not set'}`); save(); render(); });
  on('[data-dlink]', 'change', el => {
    const [l, aid] = el.dataset.dlink.split('|'), L = line(l), x = pr.participants.find(p => p.id === el.value), a = asset(aid);
    if (!x || !a) return;
    L.assetIds = L.assetIds.filter(i => i !== aid);
    const prep = (L.prep || {})[aid] || '';
    const slot = a.type === 'pc' && !x.computerId ? SLOTS[0] : a.type === 'monitor' && !x.monitorId ? SLOTS[1] : a.type === 'monitor' && !x.monitor2Id ? SLOTS[2] : null;
    if (slot){ x[slot[0]] = aid; if (prep) x.prep[slot[1]] = prep; } else { x.otherIds.push(aid); if (prep) x.prep[aid] = prep; }
    plog(pr.id, `Asset linked to ${(person(x.personId) || {}).name || '?'}: ${a.tag}`); save(); render();
  });
  view.querySelectorAll('[data-pp]').forEach(el => el.addEventListener('change', () => {
    const x = pr.participants.find(p => p.id === el.dataset.pp), f = el.dataset.pf, who = (person(x.personId) || {}).name || '?';
    if (f === 'pickupDate'){ plog(pr.id, `${who}: planned pickup ${fmtDate(x.pickupDate)} → ${fmtDate(el.value)}`); x.pickupDate = el.value; }
    else if (f.startsWith('ck_')){
      const k = f.slice(3), lbl = CHECKLIST.find(c => c[0] === k)[1];
      x.checklist[k] = el.checked; plog(pr.id, `Checklist – ${who}: ${lbl} ${el.checked ? '✔ done' : '✗ undone'}`);
    }
    else if (f.startsWith('prep_')){
      const slot = f.slice(5), a = asset(x[SLOTS.find(s => s[1] === slot)[0]]);
      plog(pr.id, `Preparation – ${who}: ${a ? a.tag : slot} → ${el.value || 'not set'}`); x.prep[slot] = el.value;
    }
    else if (f.startsWith('serial_')){ const slot = f.slice(7); x.manualSerial[slot] = el.value.trim(); plog(pr.id, `${who}: ${slot === 'monitor' ? 'Monitor' : '2nd Monitor'} S/N entered manually: ${el.value.trim() || '–'}`); }
    else if (f === 'addOther'){
      const a = asset(el.value); if (!a) return;
      x.otherIds.push(a.id); plog(pr.id, `Asset added to project – ${who}: ${a.tag} · ${typeLabel(a.type)} · ${modelName(a)}`);
    }
    else {
      const slot = SLOTS.find(s => s[0] === f), old = x[f] && asset(x[f]), a = el.value && asset(el.value);
      x[f] = el.value || null; delete x.prep[slot[1]];
      if (old) plog(pr.id, `Asset removed from project – ${who}: ${slot[2]} ${old.tag}`);
      if (a) plog(pr.id, `Asset added to project – ${who}: ${slot[2]} ${a.tag} (S/N ${a.serial || '–'})`);
    }
    save(); render();
  }));
  view.querySelectorAll('[data-rm-other]').forEach(b => b.addEventListener('click', () => {
    const [pid, aid] = b.dataset.rmOther.split('|'), x = pr.participants.find(p => p.id === pid), a = asset(aid);
    x.otherIds = x.otherIds.filter(o => o !== aid); delete x.prep[aid];
    plog(pr.id, `Asset removed from project – ${(person(x.personId) || {}).name}: ${a ? a.tag : aid}`); save(); render();
  }));
  view.querySelectorAll('[data-rm-part]').forEach(b => b.addEventListener('click', () => {
    const x = pr.participants.find(p => p.id === b.dataset.rmPart), who = (person(x.personId) || {}).name || '?';
    if (!confirm(`Remove ${who} from the project?\nTheir reserved assets are released.`)) return;
    pr.participants = pr.participants.filter(p => p !== x); plog(pr.id, 'Participant removed: ' + who); save(); render();
  }));
}
function demandDialog(prId){
  const pr = project(prId);
  openDialog(`<h3>+ Demand line</h3><div class="two">
    <div><label class="f">Asset Type</label><select name="typeId">${sortHu(db.types, t => t.name).map(t => `<option value="${esc(t.id)}">${t.icon} ${esc(t.name)}</option>`).join('')}</select></div>
    <div><label class="f">Planned quantity</label><input type="number" name="qty" min="1" value="1" required></div></div>${dlgActions('Add')}`,
    data => {
      pr.demand.push({id:uid(), typeId:data.typeId, qty:+data.qty, assetIds:[], prep:{}});
      plog(pr.id, `Demand added: ${data.qty} × ${typeLabel(data.typeId)}`); save(); render();
    });
}
function addParticipantDialog(prId){
  const pr = project(prId), inProj = new Set(pr.participants.map(x => x.personId));
  const cands = sortHu(db.people.filter(p => !inProj.has(p.id)), p => p.name);
  openDialog(`<h3>+ Participant – ${esc(pr.name)}</h3>
    <label class="f">Person</label>
    ${cands.length ? picker('personId', cands.map(p => `<option value="${p.id}">👤 ${esc(p.name)} – ${esc(serviceName(p.serviceId) || 'no Service')} · ${esc(modeName(p.mode))}</option>`).join(''), {size:9}) : '<p class="muted">Everyone is already a participant.</p>'}
    <p style="margin-top:10px"><button type="button" class="sm" id="newPartBtn">＋ Create a new person and add them</button></p>
    ${dlgActions('Add')}`,
    data => {
      if (!data.personId){ alert('Choose a person.'); return false; }
      addParticipant(prId, data.personId);
    });
  $('#newPartBtn').addEventListener('click', () => { $('#dlg').close(); personForm(null, n => { addParticipant(prId, n.id); location.hash = '#/project/' + prId; render(); }); });
}
function addParticipant(prId, personId){
  const pr = project(prId);
  pr.participants.push({id:uid(), personId, pickupDate:pr.pickupDate || '', computerId:null, monitorId:null, monitor2Id:null, otherIds:[], prep:{}, manualSerial:{}, checklist:{}});
  plog(pr.id, 'Participant added: ' + ((person(personId) || {}).name || '?'));
  save(); render();
}
function replacementDialog(prId){
  const pr = project(prId);
  const heldBy = pid => personAssets(pid).direct.filter(a => !pr.replacements.some(r => r.oldId === a.id));
  const people = sortHu(db.people.filter(p => personAssets(p.id).direct.length), p => (pr.participants.some(x => x.personId === p.id) ? '0' : '1') + p.name);
  if (!people.length){ alert('Nobody holds an asset that could be replaced.'); return; }
  const newOpts = sortHu(db.assets.filter(a => a.status === 'ok' && ['storage', 'site'].includes(a.holder.kind) && !reservedBy(a.id)), a => a.tag);
  openDialog(`<h3>🔁 Replacement</h3>
    <label class="f">Recipient</label><select name="personId" id="repP">${selOpts(people, null, p => p.name)}</select>
    <label class="f">Old assets</label><div class="checklist" id="repOld"></div>
    <label class="f">Replacement asset (optional, reserved until completion)</label>
    ${picker('newId', `<option value="">– none –</option>` + newOpts.map(a => `<option value="${a.id}">${typeIcon(a.type)} ${esc(a.tag)} · ${esc(assetName(a))}</option>`).join(''), {size:5})}
    <div class="two"><div><label class="f">Return of the old asset</label><select name="ret"><option value="awaiting">Awaiting Return</option><option value="notRequired">Not Required</option></select></div>
      <div><label class="f">Return deadline (optional)</label><input type="date" name="due"></div></div>
    ${dlgActions('Add')}`,
    data => {
      const olds = heldBy(data.personId).filter(a => data['old_' + a.id]);
      if (!olds.length){ alert('Choose at least one old asset.'); return false; }
      olds.forEach((old, i) => {
        const rep = {id:uid(), personId:data.personId, oldId:old.id, newId:i === 0 ? data.newId || null : null, ts:Date.now()};
        pr.replacements.push(rep);
        const r = openReturn(old.id, data.personId, 'project', {projectId:pr.id, due:data.due});
        if (data.ret === 'notRequired') setReturnState(r, 'notRequired');
        plog(pr.id, `Replacement added – ${(person(data.personId) || {}).name}: ${old.tag}${rep.newId ? ' → ' + asset(rep.newId).tag : ''} (${RETURN_STATE[data.ret]})`);
      });
      save(); render();
    });
  const fill = () => { $('#repOld').innerHTML = heldBy($('#repP').value).map(a => `<label><input type="checkbox" name="old_${a.id}"> <b class="tag">${esc(a.tag)}</b> ${esc(assetName(a))}</label>`).join('') || '<span class="muted">No further assets.</span>'; };
  $('#repP').addEventListener('change', fill); fill();
}
function setRepState(prId, repId, state){
  const pr = project(prId), rep = pr.replacements.find(r => r.id === repId), r = repReturn(pr, rep);
  if (r){ setReturnState(r, state); plog(pr.id, `Return of ${(asset(rep.oldId) || {}).tag || '?'}: ${RETURN_STATE[state]}`); save(); render(); }
}
// assets in an open shipment cannot be picked for another one
const inOpenShipment = id => db.projects.some(pr => pr.shipments.some(s => s.status !== 'Received' && s.assetIds.includes(id)));
function shipCandidates(pr, fromId){
  const own = new Set(projectAssetIds(pr));
  return sortHu(db.assets.filter(a => !inOpenShipment(a.id) && a.holder.kind !== 'transit' && !isOut(a) &&
    (fromId ? a.holder.kind === 'storage' || assetOfficeId(a) === fromId : own.has(a.id))), a => (own.has(a.id) ? '0' : '1') + a.tag).map(a => [a, own.has(a.id)]);
}
function shipFields(){
  const offs = sortHu(db.offices, o => o.name), ppl = sortHu(db.people, p => p.name);
  const opts = `<option value="">– none –</option>` + offs.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('');
  const pOpts = `<option value="">– none –</option>` + ppl.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  return `<div class="two">
    <div><label class="f">Sending Office</label><select name="from" id="shFrom">${opts}</select></div>
    <div><label class="f">Receiving Office</label><select name="to">${opts}</select></div>
    <div><label class="f">Sending Person</label><select name="sendP">${pOpts}</select></div>
    <div><label class="f">Receiving Person</label><select name="recvP">${pOpts}</select></div></div>
    <label class="f">Shipment Items</label><div class="checklist" id="shItems"></div>
    <label class="cb"><input type="checkbox" name="shReq" checked> Required for completing the project</label>
    <p class="muted" style="font-size:12px">Assets only change place when the shipment is marked as sent and received. A person-only shipment is recorded without moving anything.</p>`;
}
const shipPicked = (pr, data) => shipCandidates(pr, data.from).map(x => x[0]).filter(a => data['a_' + a.id]).map(a => a.id);
// returns the new shipment, or null after telling the user what is missing
function readShipment(pr, data){
  const assetIds = shipPicked(pr, data);
  if (!assetIds.length){ alert('Choose at least one asset.'); return null; }
  if (data.from && data.from === data.to){ alert('The Sending and Receiving Office must be different.'); return null; }
  if (!data.to && !data.recvP){ alert('Choose a Receiving Office or a Receiving Person.'); return null; }
  if (data.from && !data.to){ alert('Choose the Receiving Office.'); return null; }
  if (data.to && !data.from){ alert('Choose the Sending Office.'); return null; }
  if (data.from && assetIds.some(i => asset(i).holder.kind === 'person')){ alert('Assets assigned to a person cannot be sent between offices. Return them first.'); return null; }
  return {id:uid(), from:'', fromOfficeId:data.from || null, toOfficeId:data.to || null, sendPersonId:data.sendP || null, recvPersonId:data.recvP || null, toPersonId:data.recvP || null, toRoomId:null, assetIds, status:'Preparing', required:!!data.shReq, origin:{}, ts:Date.now()};
}
function bindShipFields(pr){
  const fill = () => {
    const c = shipCandidates(pr, $('#shFrom').value);
    $('#shItems').innerHTML = c.map(([a, own]) => `<label><input type="checkbox" name="a_${a.id}"> <b class="tag">${esc(a.tag)}</b> ${esc(assetName(a))} <small class="muted">${own ? '📋 ' : ''}${esc(whereText(a))}</small></label>`).join('') || '<span class="muted">No assets available. Choose a Sending Office or select project assets first.</span>';
  };
  $('#shFrom').addEventListener('change', fill); fill();
}
function shipmentDialog(prId){
  const pr = project(prId);
  openDialog(`<h3>📦 Shipment</h3>${shipFields()}${dlgActions('Add')}`,
    data => {
      const s = readShipment(pr, data);
      if (!s) return false;
      pr.shipments.push(s);
      plog(pr.id, `Shipment created: ${shipRoute(s)} – ${s.assetIds.map(i => asset(i).tag).join(', ')}`);
      save(); render();
    });
  bindShipFields(pr);
}
function removeShipment(prId, sid){
  const pr = project(prId);
  if (!confirm('Remove this shipment record?')) return;
  pr.shipments = pr.shipments.filter(x => x.id !== sid); plog(pr.id, 'Shipment record removed'); save(); render();
}
// sending and receiving are separate steps: in between the asset is at neither office
function shipAction(prId, sid, act){
  const pr = project(prId), s = pr.shipments.find(x => x.id === sid), moving = s.fromOfficeId && s.toOfficeId, list = s.assetIds.map(asset).filter(Boolean);
  const label = moving ? `${shipOffice(s.fromOfficeId)} → ${shipOffice(s.toOfficeId)}` : `to ${(person(s.recvPersonId) || {}).name || '?'}`;
  if (act === 'send'){
    if (moving){
      const bad = list.filter(a => a.holder.kind === 'person' || a.holder.kind === 'transit');
      if (bad.length){ alert(`Cannot send: ${bad.map(a => `${a.tag} (${whereText(a)})`).join(', ')}`); return; }
      for (const a of list){ s.origin[a.id] = a.holder; setHolder(a, {kind:'transit', id:s.id}, {projectId:pr.id}); }
    }
    s.status = 'Sent'; plog(pr.id, `Shipment sent: ${label}`);
  } else if (act === 'receive'){
    if (!confirm(`Record the receipt of ${list.length} asset(s)${moving ? ' at ' + shipOffice(s.toOfficeId) : ''}?`)) return;
    if (moving) for (const a of list) if (a.holder.kind === 'transit' && a.holder.id === s.id) setHolder(a, {kind:'site', id:s.toOfficeId}, {projectId:pr.id});
    s.status = 'Received'; s.receivedAt = Date.now(); plog(pr.id, `Shipment received: ${label}`);
  } else if (act === 'cancel'){
    if (!confirm('Cancel the sending? The assets go back to where they were.')) return;
    for (const a of list) if (a.holder.kind === 'transit' && a.holder.id === s.id) setHolder(a, s.origin[a.id] || {kind:'storage'}, {projectId:pr.id});
    s.status = 'Preparing'; s.origin = {}; plog(pr.id, `Shipment sending cancelled: ${label}`);
  }
  save(); render();
}
function deleteProject(id){
  const pr = project(id);
  if (pr.shipments.some(s => s.status === 'Sent')){ alert('A shipment of this project is on its way. Record the receipt or cancel the sending first.'); return; }
  if (!confirm(`Delete project “${pr.name}”?${isActive(pr) ? '\nReserved assets are released, nothing is checked out.' : '\nChecked-out assets and documents stay.'}`)) return;
  plog(pr.id, 'Project deleted: ' + pr.name);
  db.projects = db.projects.filter(x => x.id !== id); save(); location.hash = '#/projects';
}
// everything that would stop a clean completion; only the selected activities are looked at
function projectProblems(pr){
  const out = projectTasks(pr).filter(t => !t.done && !t.optional).map(t => `${t.label}: ${t.detail}.`), seen = new Map();
  const assign = hasAct(pr, 'assignment'), repNew = hasAct(pr, 'replacement') ? pr.replacements.filter(r => r.newId) : [];
  if (assign) for (const l of pr.demand) if (l.assetIds.length) out.push(`${l.assetIds.length} selected ${typeLabel(l.typeId)} asset(s) are not linked to a person yet.`);
  const check = (aid, pid, who) => {
    const a = asset(aid);
    if (!a){ out.push(`${who}: a selected asset no longer exists.`); return; }
    if (seen.has(aid)) out.push(`${a.tag} is selected for two people (${seen.get(aid)}, ${who}).`);
    seen.set(aid, who);
    if (a.status !== 'ok') out.push(`${a.tag} (${who}) status: ${STATUS[a.status].label}.`);
    if (!['storage', 'site'].includes(a.holder.kind) && !(a.holder.kind === 'person' && a.holder.id === pid)) out.push(`${a.tag} (${who}) is not available: ${whereText(a)}.`);
    const r = reservedBy(aid);
    if (r && r.project.id !== pr.id) out.push(`${a.tag} (${who}) is also reserved for another project: ${r.project.name}.`);
  };
  if (assign) for (const x of pr.participants){
    const p = person(x.personId), who = p ? p.name : 'deleted person';
    if (!p){ out.push('A participant no longer exists.'); continue; }
    if (p.status === 'Leaver' && partAssetIds(x).length) out.push(`${p.name} is a Leaver and cannot receive assets.`);
    for (const aid of partAssetIds(x)) check(aid, x.personId, who);
  }
  for (const r of repNew) check(r.newId, r.personId, (person(r.personId) || {}).name || 'deleted person');
  return out;
}
function completeProject(id){
  const pr = project(id), problems = projectProblems(pr);
  if (problems.length){
    plog(pr.id, `Completion stopped – ${problems.length} problem(s): ${problems.join(' ')}`); save(); render();
    alert('The project cannot be completed:\n\n• ' + problems.join('\n• ') + '\n\nFix these and try again.');
    return;
  }
  const byPerson = new Map();
  if (hasAct(pr, 'assignment')) for (const x of pr.participants) if (partAssetIds(x).length) byPerson.set(x.personId, {ids:partAssetIds(x), x});
  if (hasAct(pr, 'replacement')) for (const r of pr.replacements) if (r.newId){ const e = byPerson.get(r.personId) || {ids:[], x:null}; e.ids.push(r.newId); byPerson.set(r.personId, e); }
  const lines = projectTasks(pr).map(taskLine).join('\n');
  if (!confirm(`${byPerson.size ? 'Are you sure you want to complete the project and finalize the asset checkouts?' : 'Are you sure you want to complete the project?'}\n\n${lines}`)) return;
  let issued = 0;
  const docs = [];
  pr.issuedIds ||= [];
  for (const [pid, {ids, x}] of byPerson){
    // the regular checkout path, so logs and assignment dates are the same as for a manual checkout
    for (const aid of ids){ const a = asset(aid); pr.issuedIds.push(aid); if (!(a.holder.kind === 'person' && a.holder.id === pid)){ setHolder(a, {kind:'person', id:pid}, {projectId:pr.id}); issued++; } }
    const acc = x ? CHECKLIST.filter(([k]) => x.checklist[k]).map(([, l]) => l) : [];
    docs.push(createDoc(pid, 'out', ids, {date:todayIso(), handler:db.settings.handler, projectId:pr.id,
      note:`Project: ${pr.name}${pr.ticket ? ' (' + pr.ticket + ')' : ''}` + (acc.length ? `\nHanded-over accessories (not inventory): ${acc.join(', ')}` : '')}));
  }
  pr.status = 'completed'; pr.result = 'successful'; pr.completedAt = Date.now();
  plog(pr.id, `Project completed successfully: ${pr.name} – ${issued} asset(s) checked out, ${docs.length} document(s)${docs.length ? ' (' + docs.map(d => d.no).join(', ') + ')' : ''}`);
  save(); render();
  toast(`✅ Project completed${docs.length ? `: ${issued} asset(s) checked out, ${docs.length} document(s)` : ''}.`);
}
