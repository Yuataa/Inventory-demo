'use strict';
/* Projects: munkatársak előkészítése. Az eszközök csak foglalva vannak a projekthez (nem kiadva);
   a kiadás és a jegyzőkönyv a projekt lezárásakor, a meglévő kiadási folyamattal történik. A kábelek csak checklist-elemek. */

const SLOTS = [['computerId', 'computer', 'Computer'], ['monitorId', 'monitor', 'Monitor'], ['monitor2Id', 'monitor2', '2nd Monitor']];
const isActive = pr => pr.status !== 'completed' && pr.status !== 'cancelled';
const projectStatusPill = s => `<span class="pill ${{completed:'ok', cancelled:'bad', ready:'acc', progress:'warn'}[s] || ''}">${PROJECT_STATUS[s] || s}</span>`;
const partAssetIds = x => [x.computerId, x.monitorId, x.monitor2Id, ...(x.otherIds || [])].filter(Boolean);
// which active project/participant has reserved this asset
function reservedBy(assetId){
  for (const pr of db.projects) if (isActive(pr)) for (const part of pr.participants){
    const slot = SLOTS.find(([f]) => part[f] === assetId);
    if (slot) return {project:pr, part, slot:slot[1], prep:part.prep[slot[1]] || ''};
    if (part.otherIds.includes(assetId)) return {project:pr, part, slot:'other', prep:part.prep[assetId] || ''};
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
  return total ? Math.round(done / total * 100) : 0;
}

function viewProjects(params){
  const q = params.get('q') || '', st = params.get('status') || '';
  let list = db.projects;
  if (st === 'active') list = list.filter(isActive); else if (st) list = list.filter(p => p.status === st);
  if (q){ const n = norm(q); list = list.filter(pr => norm([pr.name, pr.ticket, pr.owner, pr.note, ...pr.participants.map(x => (person(x.personId) || {}).name)].join(' ')).includes(n)); }
  list = sortHu(list, pr => (isActive(pr) ? '0' : '1') + (pr.pickupDate || '9999'));
  return `
    <div class="row"><h1>Projects</h1><span class="spacer"></span><button class="primary" onclick="projectForm()">+ Új projekt</button></div>
    <div class="sub">Új munkatársak előkészítése és eszközcsomagjai. Az eszközök a projekt lezárásáig csak foglalva vannak, nincsenek kiadva.</div>
    <div class="row" style="margin-bottom:12px">
      <input id="prq" placeholder="Keresés: név, ticket, felelős, résztvevő…" value="${esc(q)}" style="min-width:280px">
      <select id="prst"><option value="">Minden állapot</option><option value="active"${st === 'active' ? ' selected' : ''}>Aktív (nem lezárt)</option>
        ${Object.entries(PROJECT_STATUS).map(([k, v]) => `<option value="${k}"${k === st ? ' selected' : ''}>${v}</option>`).join('')}</select>
    </div>
    ${list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Projekt neve</th><th>Résztvevők</th><th>Tervezett átvétel</th><th>Projektfelelős</th><th>Ticket</th><th>Állapot</th><th>Előkészítés</th><th>Megjegyzés</th></tr></thead><tbody>${list.map(pr => {
      const pct = projectProgress(pr);
      return `<tr><td><a href="#/project/${pr.id}"><b>${esc(pr.name)}</b></a></td>
        <td>${pr.participants.map(x => esc((person(x.personId) || {}).name || '?')).join(', ') || '<span class="muted">–</span>'}</td>
        <td style="white-space:nowrap">${fmtDate(pr.pickupDate)}</td><td>${esc(pr.owner) || '<span class="muted">–</span>'}</td>
        <td class="tag">${esc(pr.ticket) || '<span class="muted">–</span>'}</td><td>${projectStatusPill(pr.status)}</td>
        <td><div class="progress" title="${pct}%"><i style="width:${pct}%"></i></div><small class="muted">${pct}%</small></td>
        <td class="muted">${esc(pr.note)}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="empty">Nincs a szűrésnek megfelelő projekt.</div>'}`;
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
  pr = pr || {name:'', owner:currentUser(), pickupDate:'', ticket:'', note:'', status:'planning'};
  openDialog(`
    <h3>${isNew ? 'Új projekt' : 'Projekt adatai'}</h3>
    <label class="f">Projekt neve</label><input name="name" required value="${esc(pr.name)}" placeholder="pl. Customer Support – decemberi belépők">
    <div class="two">
      <div><label class="f">Projektfelelős</label><input name="owner" list="ownerList" value="${esc(pr.owner)}"><datalist id="ownerList">${sortHu(db.people, p => p.name).map(p => `<option value="${esc(p.name)}">`).join('')}</datalist></div>
      <div><label class="f">Tervezett átvételi dátum</label><input type="date" name="pickupDate" value="${esc(pr.pickupDate)}"></div>
      <div><label class="f">Ticketazonosító</label><input name="ticket" value="${esc(pr.ticket)}" placeholder="pl. INC-20417"></div>
      <div><label class="f">Projektállapot</label><select name="status">${Object.entries(PROJECT_STATUS).filter(([k]) => k !== 'completed').map(([k, v]) => `<option value="${k}"${k === pr.status ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
    </div>
    <label class="f">Megjegyzés</label><textarea name="note" style="width:100%">${esc(pr.note)}</textarea>
    ${dlgActions(isNew ? 'Létrehozás' : 'Mentés')}`,
    data => {
      const v = {name:data.name.trim(), owner:data.owner.trim(), pickupDate:data.pickupDate, ticket:data.ticket.trim(), note:data.note.trim(), status:data.status};
      if (isNew){
        const n = {id:uid(), ...v, created:Date.now(), completedAt:null, participants:[]};
        db.projects.push(n); plog(n.id, 'Projekt létrehozva: ' + n.name); save(); location.hash = '#/project/' + n.id; return;
      }
      const lbl = {name:'Név', owner:'Projektfelelős', pickupDate:'Tervezett átvétel', ticket:'Ticket', note:'Megjegyzés', status:'Állapot'};
      const show = (k, x) => k === 'status' ? PROJECT_STATUS[x] : k === 'pickupDate' ? fmtDate(x) : x;
      const ch = Object.keys(lbl).filter(k => (pr[k] || '') !== (v[k] || '')).map(k => `${lbl[k]}: ${show(k, pr[k]) || '–'} → ${show(k, v[k]) || '–'}`);
      // a new project-level date is passed on to participants that still had the old one
      if (pr.pickupDate !== v.pickupDate) for (const x of pr.participants) if (!x.pickupDate || x.pickupDate === pr.pickupDate) x.pickupDate = v.pickupDate;
      Object.assign(pr, v);
      if (ch.length) plog(pr.id, 'Projekt módosítva – ' + ch.join('; '));
      save(); render();
    });
}

function slotCell(pr, x, f, slot, ro){
  const a = x[f] && asset(x[f]);
  if (ro) return a ? `${aidLink(a)}<div class="sn">${esc(a.serial)}</div>` : '<span class="muted">–</span>';
  const kind = slot === 'computer' ? 'pc' : 'monitor';
  const opts = slotCandidates(kind, x[f]).map(c => `<option value="${c.id}"${c.id === x[f] ? ' selected' : ''}>${esc(c.tag)} · ${esc(modelName(c))}</option>`).join('');
  return `<select data-pp="${x.id}" data-pf="${f}"><option value="">– nincs –</option>${opts}</select>
    ${a ? `<div class="sn">S/N ${esc(a.serial) || '–'}${a.holder.kind !== 'storage' && !(a.holder.kind === 'person' && a.holder.id === x.personId) ? ' <span style="color:var(--danger)">⚠ már nincs raktáron</span>' : ''}</div>` : ''}
    ${slot !== 'computer' && !a ? `<input type="text" data-pp="${x.id}" data-pf="serial_${slot}" value="${esc((x.manualSerial || {})[slot] || '')}" placeholder="S/N kézzel" style="margin-top:3px">` : ''}
    ${a ? `<div class="prep"><select data-pp="${x.id}" data-pf="prep_${slot}" title="Előkészítési állapot">${PREP_STATUS.map(s => `<option value="${esc(s)}"${(x.prep[slot] || '') === s ? ' selected' : ''}>${s || 'Előkészítés: –'}</option>`).join('')}</select></div>` : ''}`;
}
function viewProject(id){
  const pr = project(id);
  if (!pr) return `<div class="empty">A projekt nem található.</div>`;
  const ro = !isActive(pr), docs = db.docs.filter(d => d.projectId === id), logs = db.log.filter(l => l.projectId === id);
  const rows = pr.participants.map(x => {
    const p = person(x.personId);
    const others = (x.otherIds || []).map(asset).filter(Boolean);
    return `<tr>
      <td>${p ? esc(serviceName(p.serviceId)) || '<span class="muted">–</span>' : '–'}</td>
      <td>${ro ? fmtDate(x.pickupDate) : `<input type="date" data-pp="${x.id}" data-pf="pickupDate" value="${esc(x.pickupDate || '')}">`}</td>
      <td>${p ? `<a href="#/person/${p.id}"><b>${esc(p.name)}</b></a><br>${modePill(p.mode)}` : '<span class="muted">törölt személy</span>'}</td>
      <td>${slotCell(pr, x, 'computerId', 'computer', ro)}</td>
      <td>${slotCell(pr, x, 'monitorId', 'monitor', ro)}</td>
      <td>${slotCell(pr, x, 'monitor2Id', 'monitor2', ro)}</td>
      ${CHECKLIST.map(([k, l]) => `<td class="cb"><input type="checkbox" data-pp="${x.id}" data-pf="ck_${k}"${x.checklist[k] ? ' checked' : ''}${ro ? ' disabled' : ''} title="${l}"></td>`).join('')}
      <td>${others.map(a => `<div style="white-space:nowrap">${aidLink(a)} <small class="muted">${esc(typeLabel(a.type))}</small>${ro ? '' : ` <button class="sm" data-rm-other="${x.id}|${a.id}" title="Eltávolítás">✕</button>`}</div>`).join('')}
        ${ro ? (others.length ? '' : '<span class="muted">–</span>') : `<select data-pp="${x.id}" data-pf="addOther"><option value="">+ eszköz…</option>${slotCandidates('other').map(c => `<option value="${c.id}">${typeIcon(c.type)} ${esc(c.tag)} · ${esc(modelName(c))}</option>`).join('')}</select>`}</td>
      ${ro ? '' : `<td><button class="sm danger" data-rm-part="${x.id}" title="Résztvevő eltávolítása">✕</button></td>`}
    </tr>`;
  }).join('');
  const pct = projectProgress(pr);
  return `
    <div class="row"><a href="#/projects">← Projects</a></div>
    <div class="row" style="margin-top:8px"><h1>📋 ${esc(pr.name)}</h1> ${projectStatusPill(pr.status)}<span class="spacer"></span>
      ${ro ? '' : `<button onclick="projectForm(project('${pr.id}'))">✎ Projekt adatai</button>
        <button onclick="addParticipantDialog('${pr.id}')">+ Résztvevő</button>
        <button class="primary" onclick="completeProject('${pr.id}')">✅ Projekt befejezése</button>`}
      <button class="danger" onclick="deleteProject('${pr.id}')">Törlés</button></div>
    <div class="card" style="margin:12px 0"><dl class="kv">
      <dt>Projektfelelős</dt><dd>${esc(pr.owner) || '–'}</dd>
      <dt>Tervezett átvétel</dt><dd>${fmtDate(pr.pickupDate)}</dd>
      <dt>Ticketazonosító</dt><dd>${pr.ticket ? `<span class="tag">${esc(pr.ticket)}</span>${copyBtn(pr.ticket)}` : '–'}</dd>
      <dt>Állapot</dt><dd>${ro ? projectStatusPill(pr.status) : `<select id="prStatus">${Object.entries(PROJECT_STATUS).filter(([k]) => k !== 'completed').map(([k, v]) => `<option value="${k}"${k === pr.status ? ' selected' : ''}>${v}</option>`).join('')}</select>`}</dd>
      <dt>Előkészítés</dt><dd><div class="progress" style="width:200px;display:inline-block;vertical-align:middle"><i style="width:${pct}%"></i></div> ${pct}%</dd>
      <dt>Megjegyzés</dt><dd style="white-space:pre-wrap">${esc(pr.note) || '–'}</dd>
      ${pr.completedAt ? `<dt>Lezárva</dt><dd>${fmtTime(pr.completedAt)}</dd>` : ''}
    </dl></div>
    <h2>Résztvevők és felszerelés (${pr.participants.length})</h2>
    <p class="muted" style="font-size:12px;margin-top:-4px">Készletelem (Asset ID-val): Computer, Monitor, 2nd Monitor, egyéb eszköz – lezárásig csak foglalva.
      Checklist (nincs Asset ID, nem kerül a készletbe): ${CHECKLIST.map(([, l]) => l).join(', ')}.</p>
    ${pr.participants.length ? `<div class="tbl-wrap"><table class="ptable"><thead><tr><th>Service</th><th>Planned pickup date</th><th>Name of the Agent</th>
      <th>Computer</th><th>Monitor Serialnumber</th><th>2nd Monitor</th>${CHECKLIST.map(([, l]) => `<th class="cb">${l}</th>`).join('')}<th>Egyéb eszköz</th>${ro ? '' : '<th></th>'}</tr></thead>
      <tbody>${rows}</tbody></table></div>` : `<div class="empty">Még nincs résztvevő. ${ro ? '' : `<button class="sm" onclick="addParticipantDialog('${pr.id}')">+ Résztvevő</button>`}</div>`}
    ${docs.length ? `<h2>📄 A projekt jegyzőkönyvei</h2>${docTable(docs, true)}` : ''}
    <h2>Projektnapló</h2>
    ${logTable(logs, {noSubject:true})}`;
}
function bindProject(id){
  const pr = project(id);
  if (!pr || !isActive(pr)) return;
  const st = $('#prStatus');
  if (st) st.addEventListener('change', () => { plog(pr.id, `Projektállapot: ${PROJECT_STATUS[pr.status]} → ${PROJECT_STATUS[st.value]}`); pr.status = st.value; save(); render(); });
  const view = $('#view');
  view.querySelectorAll('[data-pp]').forEach(el => el.addEventListener('change', () => {
    const x = pr.participants.find(p => p.id === el.dataset.pp), f = el.dataset.pf, who = (person(x.personId) || {}).name || '?';
    if (f === 'pickupDate'){ plog(pr.id, `${who}: tervezett átvétel ${fmtDate(x.pickupDate)} → ${fmtDate(el.value)}`); x.pickupDate = el.value; }
    else if (f.startsWith('ck_')){
      const k = f.slice(3), lbl = CHECKLIST.find(c => c[0] === k)[1];
      x.checklist[k] = el.checked; plog(pr.id, `Checklist – ${who}: ${lbl} ${el.checked ? '✔ kész' : '✗ visszavonva'}`);
    }
    else if (f.startsWith('prep_')){
      const slot = f.slice(5), a = asset(x[SLOTS.find(s => s[1] === slot)[0]]);
      plog(pr.id, `Előkészítés – ${who}: ${a ? a.tag : slot} → ${el.value || 'nincs megadva'}`); x.prep[slot] = el.value;
    }
    else if (f.startsWith('serial_')){ const slot = f.slice(7); x.manualSerial[slot] = el.value.trim(); plog(pr.id, `${who}: ${slot === 'monitor' ? 'Monitor' : '2nd Monitor'} S/N kézzel: ${el.value.trim() || '–'}`); }
    else if (f === 'addOther'){
      const a = asset(el.value); if (!a) return;
      x.otherIds.push(a.id); plog(pr.id, `Eszköz projekthez rendelve – ${who}: ${a.tag} · ${typeLabel(a.type)} · ${modelName(a)}`);
    }
    else {
      const slot = SLOTS.find(s => s[0] === f), old = x[f] && asset(x[f]), a = el.value && asset(el.value);
      x[f] = el.value || null; delete x.prep[slot[1]];
      if (old) plog(pr.id, `Eszköz eltávolítva a projektből – ${who}: ${slot[2]} ${old.tag}`);
      if (a) plog(pr.id, `Eszköz projekthez rendelve – ${who}: ${slot[2]} ${a.tag} (S/N ${a.serial || '–'})`);
    }
    save(); render();
  }));
  view.querySelectorAll('[data-rm-other]').forEach(b => b.addEventListener('click', () => {
    const [pid, aid] = b.dataset.rmOther.split('|'), x = pr.participants.find(p => p.id === pid), a = asset(aid);
    x.otherIds = x.otherIds.filter(o => o !== aid); delete x.prep[aid];
    plog(pr.id, `Eszköz eltávolítva a projektből – ${(person(x.personId) || {}).name}: ${a ? a.tag : aid}`); save(); render();
  }));
  view.querySelectorAll('[data-rm-part]').forEach(b => b.addEventListener('click', () => {
    const x = pr.participants.find(p => p.id === b.dataset.rmPart), who = (person(x.personId) || {}).name || '?';
    if (!confirm(`Eltávolítod a projektből: ${who}?\nA hozzá foglalt eszközök felszabadulnak.`)) return;
    pr.participants = pr.participants.filter(p => p !== x); plog(pr.id, 'Résztvevő eltávolítva: ' + who); save(); render();
  }));
}
function addParticipantDialog(prId){
  const pr = project(prId), inProj = new Set(pr.participants.map(x => x.personId));
  const cands = sortHu(db.people.filter(p => !inProj.has(p.id)), p => p.name);
  openDialog(`<h3>+ Résztvevő – ${esc(pr.name)}</h3>
    <label class="f">Személy</label>
    ${cands.length ? picker('personId', cands.map(p => `<option value="${p.id}">👤 ${esc(p.name)} – ${esc(serviceName(p.serviceId) || 'nincs Service')} · ${p.mode}</option>`).join(''), {size:9}) : '<p class="muted">Minden személy már résztvevő.</p>'}
    <p style="margin-top:10px"><button type="button" class="sm" id="newPartBtn">＋ Új személy felvétele és hozzáadása</button></p>
    ${dlgActions('Hozzáadás')}`,
    data => {
      if (!data.personId){ alert('Válassz személyt.'); return false; }
      addParticipant(prId, data.personId);
    });
  $('#newPartBtn').addEventListener('click', () => { $('#dlg').close(); personForm(null, n => { addParticipant(prId, n.id); location.hash = '#/project/' + prId; render(); }); });
}
function addParticipant(prId, personId){
  const pr = project(prId);
  pr.participants.push({id:uid(), personId, pickupDate:pr.pickupDate || '', computerId:null, monitorId:null, monitor2Id:null, otherIds:[], prep:{}, manualSerial:{}, checklist:{}});
  plog(pr.id, 'Résztvevő hozzáadva: ' + ((person(personId) || {}).name || '?'));
  save(); render();
}
function deleteProject(id){
  const pr = project(id);
  if (!confirm(`Törlöd a(z) „${pr.name}” projektet?${isActive(pr) ? '\nA foglalt eszközök felszabadulnak, kiadás nem történik.' : '\nA kiadott eszközök és jegyzőkönyvek megmaradnak.'}`)) return;
  plog(pr.id, 'Projekt törölve: ' + pr.name);
  db.projects = db.projects.filter(x => x.id !== id); save(); location.hash = '#/projects';
}
// everything that would stop a clean completion
function projectProblems(pr){
  const out = [], seen = new Map();
  if (!pr.participants.length) out.push('Nincs résztvevő.');
  if (!pr.participants.some(x => partAssetIds(x).length)) out.push('Egyik résztvevőhöz sincs kiválasztva készletelem (számítógép / monitor / egyéb eszköz).');
  for (const x of pr.participants){
    const p = person(x.personId), who = p ? p.name : 'törölt személy';
    if (!p){ out.push(`Egy résztvevő személye már nem létezik.`); continue; }
    for (const aid of partAssetIds(x)){
      const a = asset(aid);
      if (!a){ out.push(`${who}: egy kiválasztott eszköz már nem létezik.`); continue; }
      if (seen.has(aid)) out.push(`${a.tag} két résztvevőnél is ki van választva (${seen.get(aid)}, ${who}).`);
      seen.set(aid, who);
      if (a.status !== 'ok') out.push(`${a.tag} (${who}) állapota: ${STATUS[a.status].label}.`);
      if (a.holder.kind !== 'storage' && !(a.holder.kind === 'person' && a.holder.id === x.personId)) out.push(`${a.tag} (${who}) már nincs raktáron: ${whereText(a)}.`);
      const r = reservedBy(aid);
      if (r && r.project.id !== pr.id) out.push(`${a.tag} (${who}) egy másik projekthez is foglalva: ${r.project.name}.`);
    }
  }
  return out;
}
function completeProject(id){
  const pr = project(id);
  if (!confirm('Biztosan be szeretnéd fejezni a projektet és véglegesíteni az eszközkiadásokat?')) return;
  const problems = projectProblems(pr);
  if (problems.length){
    plog(pr.id, `Lezárás megszakítva – ${problems.length} hiba: ${problems.join(' ')}`); save(); render();
    alert('A projekt nem zárható le, mert:\n\n• ' + problems.join('\n• ') + '\n\nJavítsd a hibákat, majd próbáld újra.');
    return;
  }
  let issued = 0;
  const docs = [];
  for (const x of pr.participants){
    const ids = partAssetIds(x);
    if (!ids.length) continue;
    // the regular checkout path, so logs and assignment dates are the same as for a manual checkout
    for (const aid of ids){ const a = asset(aid); if (!(a.holder.kind === 'person' && a.holder.id === x.personId)){ setHolder(a, {kind:'person', id:x.personId}, {projectId:pr.id}); issued++; } }
    const acc = CHECKLIST.filter(([k]) => x.checklist[k]).map(([, l]) => l);
    docs.push(createDoc(x.personId, 'out', ids, {date:todayIso(), handler:db.settings.handler, projectId:pr.id,
      note:`Projekt: ${pr.name}${pr.ticket ? ' (' + pr.ticket + ')' : ''}` + (acc.length ? `\nÁtadott kiegészítők (nem készletezett): ${acc.join(', ')}` : '')}));
  }
  pr.status = 'completed'; pr.completedAt = Date.now();
  plog(pr.id, `Projekt véglegesítve: ${pr.name} – ${issued} eszköz kiadva, ${docs.length} átadás-átvételi jegyzőkönyv (${docs.map(d => d.no).join(', ')})`);
  save(); render();
  toast(`✅ Projekt lezárva: ${issued} eszköz kiadva, ${docs.length} jegyzőkönyv – lent nyomtatható.`);
}
