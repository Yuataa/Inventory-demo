'use strict';
/* Projects: preparing equipment for named people or for a demand without names yet.
   Planned quantities, selected assets and issued assets are separate: selected assets are only reserved, the checkout and the protocol
   happen at completion through the regular flow. Cables are checklist items only. Replaced assets use the shared return records (db.returns). */

const SLOTS = [['computerId', 'computer', 'Computer'], ['monitorId', 'monitor', 'Monitor'], ['monitor2Id', 'monitor2', '2nd Monitor']];
const isActive = pr => pr.status !== 'completed' && pr.status !== 'cancelled';
const projectStatusPill = s => `<span class="pill ${{completed:'ok', cancelled:'bad', ready:'acc', progress:'warn'}[s] || ''}">${PROJECT_STATUS[s] || s}</span>`;
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
    if (a.status !== 'ok' || a.holder.kind !== 'storage' || reservedBy(a.id)) return false;
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
    ${list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Project name</th><th>Participants / demand</th><th>Pickup / deadline</th><th>Owner</th><th>Ticket</th><th>Status</th><th>Preparation</th><th>Note</th></tr></thead><tbody>${list.map(pr => {
      const pct = projectProgress(pr);
      return `<tr><td><a href="#/project/${pr.id}"><b>${esc(pr.name)}</b></a></td>
        <td>${pr.participants.map(x => esc((person(x.personId) || {}).name || '?')).join(', ') || (pr.demand.length ? `<span class="muted">${esc(demandText(pr))}</span>` : '<span class="muted">–</span>')}</td>
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
  pr = pr || {name:'', owner:currentUser(), pickupDate:'', ticket:'', note:'', status:'planning', targetServiceId:null, targetRoomId:null, accessories:''};
  openDialog(`
    <h3>${isNew ? 'New project' : 'Project details'}</h3>
    <label class="f">Project name</label><input name="name" required value="${esc(pr.name)}" placeholder="e.g. Customer Support – December joiners">
    <div class="two">
      <div><label class="f">Project owner</label><input name="owner" list="ownerList" value="${esc(pr.owner)}"><datalist id="ownerList">${sortHu(db.people, p => p.name).map(p => `<option value="${esc(p.name)}">`).join('')}</datalist></div>
      <div><label class="f">Planned pickup date / deadline</label><input type="date" name="pickupDate" value="${esc(pr.pickupDate)}"></div>
      <div><label class="f">Ticket ID</label><input name="ticket" value="${esc(pr.ticket)}" placeholder="e.g. INC-20417"></div>
      <div><label class="f">Project status</label><select name="status">${Object.entries(PROJECT_STATUS).filter(([k]) => k !== 'completed').map(([k, v]) => `<option value="${k}"${k === pr.status ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
      <div><label class="f">Target Service</label><select name="targetServiceId">${selOpts(sortHu(db.services, s => s.name), pr.targetServiceId, s => s.name, '–')}</select></div>
      <div><label class="f">Target location</label><select name="targetRoomId">${selOpts(sortHu(db.rooms, r => r.name), pr.targetRoomId, r => r.name, '–')}</select></div>
    </div>
    <label class="f">Planned accessories</label><input name="accessories" value="${esc(pr.accessories)}" placeholder="e.g. headset, monitor, dock">
    <label class="f">Note</label><textarea name="note" style="width:100%">${esc(pr.note)}</textarea>
    <p class="muted" style="font-size:12px">People are optional: add participants now, or record the demand first and link the people later.</p>
    ${dlgActions(isNew ? 'Create' : 'Save')}`,
    data => {
      const v = {name:data.name.trim(), owner:data.owner.trim(), pickupDate:data.pickupDate, ticket:data.ticket.trim(), note:data.note.trim(), status:data.status,
        targetServiceId:data.targetServiceId || null, targetRoomId:data.targetRoomId || null, accessories:data.accessories.trim()};
      if (isNew){
        const n = {id:uid(), ...v, created:Date.now(), completedAt:null, participants:[], demand:[], shipments:[], replacements:[]};
        db.projects.push(n); plog(n.id, 'Project created: ' + n.name); save(); location.hash = '#/project/' + n.id; return;
      }
      const lbl = {name:'Name', owner:'Owner', pickupDate:'Planned pickup', ticket:'Ticket', note:'Note', status:'Status', accessories:'Accessories'};
      const show = (k, x) => k === 'status' ? PROJECT_STATUS[x] : x;
      const ch = Object.keys(lbl).filter(k => (pr[k] || '') !== (v[k] || '')).map(k => `${lbl[k]}: ${show(k, pr[k]) || '–'} → ${show(k, v[k]) || '–'}`);
      // a new project-level date is passed on to participants that still had the old one
      if (pr.pickupDate !== v.pickupDate) for (const x of pr.participants) if (!x.pickupDate || x.pickupDate === pr.pickupDate) x.pickupDate = v.pickupDate;
      Object.assign(pr, v);
      if (ch.length) plog(pr.id, 'Project updated – ' + ch.join('; '));
      save(); render();
    });
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
      <td><span class="pill ${{awaiting:'warn', returned:'ok'}[st] || ''}" data-rep-state="${r.id}">${RETURN_STATE[st]}</span>${ret && ret.closedAt ? `<br><small class="muted">${fmtTime(ret.closedAt)}</small>` : ''}</td>
      <td style="text-align:right;white-space:nowrap">${st === 'awaiting' && old ? `<button class="sm primary" onclick="toStorage('${old.id}')">↩ Record return</button> <button class="sm" onclick="setRepState('${pr.id}','${r.id}','notRequired')">Not Required</button>` : ''}
        ${st === 'notRequired' && old ? `<button class="sm" onclick="setRepState('${pr.id}','${r.id}','awaiting')">Expect return</button>` : ''}</td></tr>`;
  }).join('');
  return `<div class="row"><h2>🔁 Replacements</h2><span class="spacer"></span><button class="sm" onclick="replacementDialog('${pr.id}')">+ Replacement</button></div>
    ${pr.replacements.length ? `<div class="tbl-wrap"><table><thead><tr><th>Recipient</th><th>Old asset</th><th>Replacement asset</th><th>Return</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted" style="font-size:12px">“Returned” is set only by the real return. The project can be completed while an old asset is still on its way back.</p>` : '<div class="empty">No replacements in this project.</div>'}`;
}
function shipmentHtml(pr, ro){
  const rows = pr.shipments.map(s => `<tr><td>${esc(s.from) || '<span class="muted">–</span>'}</td><td>${s.toPersonId ? personLink(s.toPersonId) : esc((room(s.toRoomId) || {}).name || '–')}</td>
    <td>${s.assetIds.map(asset).filter(Boolean).map(a => aidLink(a)).join(' ') || '<span class="muted">–</span>'}</td>
    <td><select data-ship="${s.id}">${SHIP_STATUS.map(x => `<option${x === s.status ? ' selected' : ''}>${x}</option>`).join('')}</select></td>
    <td><button class="sm danger" data-ship-rm="${s.id}">✕</button></td></tr>`).join('');
  return `<div class="row"><h2>📦 Shipping</h2><span class="spacer"></span><button class="sm" onclick="shipmentDialog('${pr.id}')">+ Shipment</button></div>
    ${pr.shipments.length ? `<div class="tbl-wrap"><table><thead><tr><th>From</th><th>To</th><th>Assets</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">Nothing recorded as sent.</div>'}`;
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
        <button onclick="addParticipantDialog('${pr.id}')">+ Participant</button>
        <button class="primary" onclick="completeProject('${pr.id}')">✅ Complete project</button>`}
      <button class="danger" onclick="deleteProject('${pr.id}')">Delete</button></div>
    <div class="card" style="margin:12px 0"><dl class="kv">
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
    ${demandHtml(pr, ro)}
    <h2>Participants and equipment (${pr.participants.length})</h2>
    <p class="muted" style="font-size:12px;margin-top:-4px">Inventory items (with Asset ID): Computer, Monitor, 2nd Monitor, other assets – reserved until completion.
      Checklist (no Asset ID, never inventory): ${CHECKLIST.map(([, l]) => l).join(', ')}.</p>
    ${pr.participants.length ? `<div class="tbl-wrap"><table class="ptable"><thead><tr><th>Service</th><th>Planned pickup date</th><th>Name of the Agent</th>
      <th>Computer</th><th>Monitor Serialnumber</th><th>2nd Monitor</th>${CHECKLIST.map(([, l]) => `<th class="cb">${l}</th>`).join('')}<th>Other assets</th>${ro ? '' : '<th></th>'}</tr></thead>
      <tbody>${rows}</tbody></table></div>` : `<div class="empty">No participants yet. ${ro ? '' : `<button class="sm" onclick="addParticipantDialog('${pr.id}')">+ Participant</button>`}</div>`}
    ${replacementHtml(pr)}
    ${shipmentHtml(pr, ro)}
    ${docs.length ? `<h2>📄 Project protocols</h2>${docTable(docs, true)}` : ''}
    <h2>Project log</h2>
    ${logTable(logs, {noSubject:true})}`;
}
function bindProject(id){
  const pr = project(id);
  if (!pr) return;
  const view = $('#view');
  const on = (sel, ev, fn) => view.querySelectorAll(sel).forEach(el => el.addEventListener(ev, () => fn(el)));
  // shipments stay editable after completion: a parcel can still be on its way
  on('[data-ship]', 'change', el => { const s = pr.shipments.find(x => x.id === el.dataset.ship); plog(pr.id, `Shipment status: ${s.status} → ${el.value}`); s.status = el.value; save(); render(); });
  on('[data-ship-rm]', 'click', el => { if (confirm('Remove this shipment record?')){ pr.shipments = pr.shipments.filter(x => x.id !== el.dataset.shipRm); plog(pr.id, 'Shipment record removed'); save(); render(); } });
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
  const newOpts = sortHu(db.assets.filter(a => a.status === 'ok' && a.holder.kind === 'storage' && !reservedBy(a.id)), a => a.tag);
  openDialog(`<h3>🔁 Replacement</h3>
    <label class="f">Recipient</label><select name="personId" id="repP">${selOpts(people, null, p => p.name)}</select>
    <label class="f">Old assets</label><div class="checklist" id="repOld"></div>
    <label class="f">Replacement asset (optional, reserved until completion)</label>
    ${picker('newId', `<option value="">– none –</option>` + newOpts.map(a => `<option value="${a.id}">${typeIcon(a.type)} ${esc(a.tag)} · ${esc(assetName(a))}</option>`).join(''), {size:5})}
    <label class="f">Return of the old asset</label><select name="ret"><option value="awaiting">Awaiting Return</option><option value="notRequired">Not Required</option></select>
    ${dlgActions('Add')}`,
    data => {
      const olds = heldBy(data.personId).filter(a => data['old_' + a.id]);
      if (!olds.length){ alert('Choose at least one old asset.'); return false; }
      olds.forEach((old, i) => {
        const rep = {id:uid(), personId:data.personId, oldId:old.id, newId:i === 0 ? data.newId || null : null, ts:Date.now()};
        pr.replacements.push(rep);
        const r = openReturn(old.id, data.personId, 'project', {projectId:pr.id});
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
function shipmentDialog(prId){
  const pr = project(prId), ids = [...new Set(projectAssetIds(pr))], list = ids.map(asset).filter(Boolean);
  if (!list.length){ alert('Select the project assets first.'); return; }
  openDialog(`<h3>📦 Shipment</h3>
    <label class="f">From (place or person)</label><input name="from" value="${esc(db.settings.handler)}">
    <label class="f">To</label><select name="to"><optgroup label="Person">${sortHu(db.people, p => p.name).map(p => `<option value="person:${p.id}">👤 ${esc(p.name)}</option>`).join('')}</optgroup>
      <optgroup label="Location">${sortHu(db.rooms, r => r.name).map(r => `<option value="room:${r.id}">🏢 ${esc(r.name)}</option>`).join('')}</optgroup></select>
    <label class="f">Assets</label><div class="checklist">${list.map(a => `<label><input type="checkbox" name="a_${a.id}"> <b class="tag">${esc(a.tag)}</b> ${esc(assetName(a))}</label>`).join('')}</div>
    <label class="f">Status</label><select name="status">${SHIP_STATUS.map(s => `<option>${s}</option>`).join('')}</select>
    ${dlgActions('Add')}`,
    data => {
      const assetIds = list.filter(a => data['a_' + a.id]).map(a => a.id);
      if (!assetIds.length){ alert('Choose at least one asset.'); return false; }
      const [k, tid] = data.to.split(':');
      pr.shipments.push({id:uid(), from:data.from.trim(), toPersonId:k === 'person' ? tid : null, toRoomId:k === 'room' ? tid : null, assetIds, status:data.status, ts:Date.now()});
      plog(pr.id, `Shipment recorded to ${k === 'person' ? (person(tid) || {}).name : (room(tid) || {}).name}: ${assetIds.map(i => asset(i).tag).join(', ')} (${data.status})`);
      save(); render();
    });
}
function deleteProject(id){
  const pr = project(id);
  if (!confirm(`Delete project “${pr.name}”?${isActive(pr) ? '\nReserved assets are released, nothing is checked out.' : '\nChecked-out assets and protocols stay.'}`)) return;
  plog(pr.id, 'Project deleted: ' + pr.name);
  db.projects = db.projects.filter(x => x.id !== id); save(); location.hash = '#/projects';
}
// everything that would stop a clean completion
function projectProblems(pr){
  const out = [], seen = new Map();
  const repNew = pr.replacements.filter(r => r.newId);
  if (!pr.participants.length && !repNew.length) out.push('No participants yet. Link the people before completing.');
  else if (!pr.participants.some(x => partAssetIds(x).length) && !repNew.length) out.push('No inventory item (computer / monitor / other asset) is selected for any participant.');
  for (const l of pr.demand) if (l.assetIds.length) out.push(`${l.assetIds.length} selected ${typeLabel(l.typeId)} asset(s) are not linked to a person yet.`);
  const check = (aid, pid, who) => {
    const a = asset(aid);
    if (!a){ out.push(`${who}: a selected asset no longer exists.`); return; }
    if (seen.has(aid)) out.push(`${a.tag} is selected for two people (${seen.get(aid)}, ${who}).`);
    seen.set(aid, who);
    if (a.status !== 'ok') out.push(`${a.tag} (${who}) status: ${STATUS[a.status].label}.`);
    if (a.holder.kind !== 'storage' && !(a.holder.kind === 'person' && a.holder.id === pid)) out.push(`${a.tag} (${who}) is no longer in stock: ${whereText(a)}.`);
    const r = reservedBy(aid);
    if (r && r.project.id !== pr.id) out.push(`${a.tag} (${who}) is also reserved for another project: ${r.project.name}.`);
  };
  for (const x of pr.participants){
    const p = person(x.personId), who = p ? p.name : 'deleted person';
    if (!p){ out.push('A participant no longer exists.'); continue; }
    if (p.status === 'Leaver' && partAssetIds(x).length) out.push(`${p.name} is a Leaver and cannot receive assets.`);
    for (const aid of partAssetIds(x)) check(aid, x.personId, who);
  }
  for (const r of repNew) check(r.newId, r.personId, (person(r.personId) || {}).name || 'deleted person');
  return out;
}
function completeProject(id){
  const pr = project(id);
  if (!confirm('Are you sure you want to complete the project and finalize the asset checkouts?')) return;
  const problems = projectProblems(pr);
  if (problems.length){
    plog(pr.id, `Completion stopped – ${problems.length} problem(s): ${problems.join(' ')}`); save(); render();
    alert('The project cannot be completed:\n\n• ' + problems.join('\n• ') + '\n\nFix these and try again.');
    return;
  }
  const byPerson = new Map();
  for (const x of pr.participants) if (partAssetIds(x).length) byPerson.set(x.personId, {ids:partAssetIds(x), x});
  for (const r of pr.replacements) if (r.newId){ const e = byPerson.get(r.personId) || {ids:[], x:null}; e.ids.push(r.newId); byPerson.set(r.personId, e); }
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
  pr.status = 'completed'; pr.completedAt = Date.now();
  plog(pr.id, `Project completed: ${pr.name} – ${issued} asset(s) checked out, ${docs.length} handover protocol(s) (${docs.map(d => d.no).join(', ')})`);
  save(); render();
  toast(`✅ Project completed: ${issued} asset(s) checked out, ${docs.length} protocol(s) – print them below.`);
}
