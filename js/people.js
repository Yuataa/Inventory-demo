'use strict';
/* Emberek: lista (Service / munkavégzési mód szűrés), adatlap, űrlap, Excel-import (név, Service, munkavégzési mód) */

function viewPeople(params){
  const q = params.get('q') || '', svc = params.get('service') || '', mode = params.get('mode') || '';
  let list = db.people;
  if (svc) list = list.filter(p => svc === '__none' ? !p.serviceId : p.serviceId === svc);
  if (mode) list = list.filter(p => p.mode === mode);
  if (q){ const n = norm(q); list = list.filter(p => norm([p.name, p.email, serviceName(p.serviceId), roleName(p.roleId)].join(' ')).includes(n)); }
  list = sortHu(list, p => p.name);
  return `
    <div class="row"><h1>Emberek</h1><span class="spacer"></span>
      <a class="btn" href="#/people/import">⬆ Importálás Excelből</a>
      <button class="primary" onclick="personForm()">+ Új személy</button></div>
    <div class="sub">${list.length} / ${db.people.length} munkatárs${q || svc || mode ? ' · <a href="#/people">szűrés törlése</a>' : ''}</div>
    <div class="row" style="margin-bottom:12px">
      <input id="pq" placeholder="Szűrés névre, e-mailre…" value="${esc(q)}" style="min-width:220px">
      <select id="psvc"><option value="">Minden Service</option>${sortHu(db.services, s => s.name).map(s => `<option value="${s.id}"${s.id === svc ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}
        <option value="__none"${svc === '__none' ? ' selected' : ''}>– nincs Service –</option></select>
      <select id="pmode"><option value="">Minden munkavégzési mód</option>${MODES.map(m => `<option value="${m}"${m === mode ? ' selected' : ''}>${MODE_ICON[m]} ${m}</option>`).join('')}</select>
    </div>
    ${list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Név</th><th>Service</th><th>Szerepkör</th><th>Munkavégzés</th><th>Asztal</th><th>Eszközök</th><th>Jegyzőkönyv</th></tr></thead><tbody>${list.map(p => {
      const pa = personAssets(p.id), all = [...pa.direct, ...pa.onDesk];
      return `<tr><td><a href="#/person/${p.id}">${esc(p.name)}</a><br><small class="muted">${esc(p.email)}</small></td>
        <td>${p.serviceId ? `<a href="#/people?service=${p.serviceId}">${esc(serviceName(p.serviceId))}</a>` : '<span class="muted">–</span>'}</td>
        <td>${esc(roleName(p.roleId)) || '<span class="muted">–</span>'}</td><td>${modePill(p.mode)}</td>
        <td>${pa.desks.map(k => `<a href="#/room/${k.roomId}/${k.id}">${esc((room(k.roomId) || {}).name || '?')} › ${esc(k.label)}</a>`).join('<br>') || '<span class="muted">–</span>'}</td>
        <td>${all.map(a => `<a class="chip" href="#/asset/${a.id}">${typeIcon(a.type)} ${esc(a.tag)}</a>`).join(' ') || '<span class="muted">–</span>'}</td>
        <td>${docBadges(p.id)}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="empty">Nincs a szűrésnek megfelelő személy.</div>'}`;
}
function bindPeopleFilters(){
  const upd = () => {
    const p = new URLSearchParams();
    if ($('#pq').value) p.set('q', $('#pq').value); if ($('#psvc').value) p.set('service', $('#psvc').value); if ($('#pmode').value) p.set('mode', $('#pmode').value);
    history.replaceState(null, '', '#/people' + (p.toString() ? '?' + p : ''));
    const pos = $('#pq').selectionStart; render(); $('#pq').focus(); $('#pq').setSelectionRange(pos, pos);
  };
  $('#pq').addEventListener('input', upd); $('#psvc').addEventListener('change', upd); $('#pmode').addEventListener('change', upd);
}

function viewPerson(id){
  const p = person(id);
  if (!p) return `<div class="empty">A személy nem található.</div>`;
  const pa = personAssets(id), unc = uncovered(id), docs = db.docs.filter(d => d.personId === id), swaps = db.swaps.filter(s => s.personId === id);
  const projects = db.projects.filter(pr => pr.participants.some(x => x.personId === id));
  const swapBtn = a => `<button class="sm" onclick="swapDialog('${a.id}')" title="Hibás / lecserélendő eszköz cseréje">🔁 Csere</button>`;
  const back = a => swapBtn(a) + ` <button class="sm" onclick="toStorage('${a.id}')">↩ Raktárba</button>`;
  return `
    <div class="row"><a href="#/people">← Emberek</a></div>
    <div class="row" style="margin-top:8px"><h1>👤 ${esc(p.name)}</h1><span class="spacer"></span>
      <button onclick="personForm(person('${p.id}'))">✎ Szerkesztés</button>
      <button class="danger" onclick="deletePerson('${p.id}')">Törlés</button></div>
    <div class="sub row" style="gap:10px">
      <span>🧩 Service: ${p.serviceId ? `<a href="#/people?service=${p.serviceId}">${esc(serviceName(p.serviceId))}</a>` : '<span class="muted">nincs</span>'}</span>
      <span>Szerepkör: <b>${esc(roleName(p.roleId)) || '–'}</b></span>
      <span>Munkavégzés: ${modePill(p.mode)}</span>
      ${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ''}</div>
    ${p.note ? `<div class="card" style="white-space:pre-wrap;margin-bottom:8px">${esc(p.note)}</div>` : ''}
    <div class="loc-box">Összesen <b>${pa.direct.length + pa.onDesk.length}</b> eszköz tartozik hozzá:
      <b>${pa.direct.length}</b> kiadva neki, <b>${pa.onDesk.length}</b> a saját irodai asztalán.</div>
    ${unc.length ? `<div class="warnbox" style="font-size:14px">⚠️ ${unc.length} kiadott eszközről még nem készült átadás-átvételi jegyzőkönyv:
      ${unc.map(a => `<b class="tag">${esc(a.tag)}</b>`).join(', ')}
      <button class="sm" onclick="docDialog('${p.id}','out',[${unc.map(a => `'${a.id}'`).join(',')}])">📄 Jegyzőkönyv készítése</button></div>` : ''}
    <div class="row"><h2>👤 Kiadott eszközök</h2><span class="spacer"></span>
      <button class="sm" onclick="assignAssetDialog({kind:'person',id:'${p.id}'}, 'Eszköz kiadása: ${esc(p.name).replace(/'/g, '')}')">+ Meglévő eszköz kiadása</button>
      <button class="sm" onclick="assetForm(null,{kind:'person',id:'${p.id}'})">+ Új eszköz</button>
      ${pa.direct.length ? `<button class="sm" onclick="returnAll('${p.id}')">↩ Minden vissza raktárba</button>` : ''}</div>
    <div class="bulkbar" id="bulkbar" hidden>
      <b>✔ <span class="bulkCount">0</span> kijelölve</b>
      <button onclick="bulkMove('storage')">↩ Kijelöltek vissza raktárba</button>
      <button onclick="docDialog('${p.id}','out',[...selected])">📄 Átadási jegyzőkönyv a kijelöltekről</button>
      <button onclick="docDialog('${p.id}','in',[...selected])">📄 Visszavételi jegyzőkönyv</button>
      <span class="spacer"></span><button class="sm" onclick="selected.clear(); render()">✕</button>
    </div>
    ${assetRows(pa.direct, {actions:back, select:true})}
    ${projects.length ? `<h2>📋 Projektek</h2><div class="tbl-wrap"><table><thead><tr><th>Projekt</th><th>Állapot</th><th>Tervezett átvétel</th></tr></thead><tbody>${projects.map(pr =>
      `<tr><td><a href="#/project/${pr.id}">${esc(pr.name)}</a></td><td>${projectStatusPill(pr.status)}</td><td>${fmtDate((pr.participants.find(x => x.personId === id) || {}).pickupDate || pr.pickupDate)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="row"><h2>📄 Dokumentumok (${docs.length})</h2><span class="spacer"></span>
      <button class="sm" onclick="docDialog('${p.id}','out')">+ Átadás-átvételi jegyzőkönyv</button>
      <button class="sm" onclick="docDialog('${p.id}','in')">+ Visszavételi jegyzőkönyv</button></div>
    ${docTable(docs)}
    ${swaps.length ? `<h2>🔁 Eszközcserék (${swaps.length})</h2>${swapTable(swaps, {noWhere:true})}` : ''}
    <h2>🪑 Saját irodai asztal</h2>
    ${pa.desks.length ? pa.desks.map(k => `
      <p><a href="#/room/${k.roomId}/${k.id}">${esc((room(k.roomId) || {}).name || '?')} › ${esc(k.label)}</a>${k.port ? ` · 🔌 port <span class="tag">${esc(k.port)}</span>` : ''} – megnyitás a floorplanon</p>
      ${assetRows(deskAssets(k.id), {noLoc:true, actions:swapBtn})}`).join('') : '<div class="empty">Nincs saját irodai asztala. (Az asztalt a floorplan szerkesztésében lehet személyhez rendelni.)</div>'}`;
}
function personForm(p, onCreated){
  const isNew = !p;
  p = p || {name:'', email:'', serviceId:'', roleId:'', mode:'Onsite', note:''};
  openDialog(`
    <h3>${isNew ? 'Új személy' : 'Személy szerkesztése'}</h3>
    <label class="f">Teljes név</label><input name="name" required value="${esc(p.name)}">
    <label class="f">E-mail</label><input name="email" type="email" value="${esc(p.email)}">
    <div class="two">
      <div><label class="f">Service</label><select name="serviceId">${selOpts(sortHu(db.services, s => s.name), p.serviceId, s => s.name, '– nincs –')}</select></div>
      <div><label class="f">Munkaköri szerep</label><select name="roleId">${selOpts(sortHu(db.roles, r => r.name), p.roleId, r => r.name, '– nincs –')}</select></div>
    </div>
    <label class="f">Munkavégzési mód</label>
    <select name="mode">${MODES.map(m => `<option value="${m}"${m === p.mode ? ' selected' : ''}>${MODE_ICON[m]} ${m}</option>`).join('')}</select>
    <p class="muted" style="font-size:12px;margin:6px 0 0">Új Service-t és szerepkört a Settings menüben lehet létrehozni.</p>
    <label class="f">Megjegyzés (pl. otthoni cím, telefon)</label><textarea name="note">${esc(p.note)}</textarea>
    ${dlgActions(isNew ? 'Létrehozás' : 'Mentés')}`,
    data => {
      const v = {name:data.name.trim(), email:data.email.trim(), serviceId:data.serviceId || null, roleId:data.roleId || null, mode:data.mode, note:data.note};
      if (isNew){
        const n = {id:uid(), ...v}; db.people.push(n); save();
        if (onCreated) onCreated(n); else location.hash = '#/person/' + n.id;
      } else { Object.assign(p, v); save(); render(); }
    });
}
function deletePerson(id){
  const p = person(id), pa = personAssets(id);
  if (db.projects.some(pr => pr.status !== 'completed' && pr.status !== 'cancelled' && pr.participants.some(x => x.personId === id))){
    alert('Ez a személy egy aktív projekt résztvevője. Előbb vedd ki a projektből.'); return;
  }
  if (!confirm(`Biztosan törlöd: ${p.name}?\nA nála lévő ${pa.direct.length} eszköz a raktárba kerül, az asztala gazdátlan lesz.\nA jegyzőkönyvei megmaradnak a Dokumentumok között.`)) return;
  for (const a of pa.direct) setHolder(a, {kind:'storage'});
  for (const k of pa.desks) k.personId = null;
  db.people = db.people.filter(x => x.id !== id); save(); location.hash = '#/people';
}

// ---------- people import: exactly three columns – full name, Service, work mode ----------
const PEOPLE_FIELDS = [
  {key:'name',    label:'Teljes név',          aliases:['teljes név', 'név', 'name', 'full name', 'dolgozó', 'agent', 'name of the agent', 'munkatárs']},
  {key:'service', label:'Service',             aliases:['service', 'szolgáltatás', 'team', 'csapat', 'osztály', 'department']},
  {key:'mode',    label:'Munkavégzési mód',    aliases:['munkavégzési mód', 'munkavégzés', 'work mode', 'mode', 'mód', 'onsite / hybrid / wfh', 'working mode']},
];
// accepts the common spellings, returns Onsite / Hybrid / WFH or null
function parseMode(v){
  const n = norm(v).replace(/[\s_-]+/g, '');
  if (!n) return null;
  if (['onsite', 'iroda', 'irodai', 'office', 'irodaban', 'helyszini', 'site'].includes(n)) return 'Onsite';
  if (['hybrid', 'hibrid', 'vegyes'].includes(n)) return 'Hybrid';
  if (['wfh', 'home', 'homeoffice', 'otthon', 'otthonrol', 'remote', 'tavmunka', 'workfromhome'].includes(n)) return 'WFH';
  return null;
}
let pimp = null;
async function readPeopleFile(file){
  try {
    const t = await readTable(file, 'Emberek');
    pimp = {fileName:file.name, headers:t.headers, rows:t.rows, map:guessColumns(t.headers, PEOPLE_FIELDS), svcMap:{}, allowDup:false};
    render();
  } catch(e){ alert('Nem sikerült beolvasni: ' + e.message); }
}
// one plan row per data row: what will happen and what is wrong with it
function planPeople(){
  const seen = new Set();
  return pimp.rows.map((r, i) => {
    const s = k => { const j = pimp.map[k]; return j >= 0 ? String(r[j] ?? '').trim() : ''; };
    const name = s('name'), svcText = s('service'), modeText = s('mode'), mode = parseMode(modeText);
    const errors = [];
    if (pimp.map.name < 0 || pimp.map.service < 0 || pimp.map.mode < 0) errors.push('hiányzó oszlop-párosítás');
    if (!name) errors.push('hiányzó név');
    if (!svcText) errors.push('hiányzó Service');
    if (!modeText) errors.push('hiányzó munkavégzési mód');
    else if (!mode) errors.push(`érvénytelen mód: „${modeText}” (Onsite / Hybrid / WFH)`);
    let svc = svcText ? db.services.find(x => norm(x.name) === norm(svcText)) : null, unknownSvc = null;
    if (svcText && !svc){
      unknownSvc = svcText;
      const choice = pimp.svcMap[norm(svcText)] || '';
      if (!choice) errors.push(`ismeretlen Service: „${svcText}” – válassz alább`);
      else if (choice === '__skip') errors.push('sor kihagyva (ismeretlen Service)');
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
const PPLAN = {new:'<span class="pill ok">Új</span>', error:'<span class="pill bad">Hiba</span>', exists:'<span class="pill warn">Már létezik – kihagy</span>', dupfile:'<span class="pill warn">Dupla a fájlban – kihagy</span>'};
function runPeopleImport(){
  const plan = planPeople(), ok = plan.filter(p => p.action === 'new');
  if (!ok.length) return;
  if (!confirm(`${ok.length} személy jön létre a(z) ${pimp.fileName} fájlból.\n${plan.length - ok.length} sor kimarad.\n\nFolytatod?`)) return;
  const created = new Map();
  for (const p of ok){
    let svcId = p.svc ? p.svc.id : null;
    if (!svcId && p.unknownSvc){
      const k = norm(p.unknownSvc);
      if (!created.has(k)){ const s = {id:uid(), name:p.unknownSvc, note:'Létrehozva importkor'}; db.services.push(s); created.set(k, s.id); }
      svcId = created.get(k);
    }
    db.people.push({id:uid(), name:p.name, email:'', serviceId:svcId, roleId:null, mode:p.mode, note:''});
  }
  log(null, `${ok.length} személy importálva (${pimp.fileName})${created.size ? ` · új Service: ${[...created.keys()].length}` : ''}`, 'created');
  save();
  alert(`Import kész.\n\nLétrehozott személy: ${ok.length}\nÚj Service: ${created.size}\nKihagyott sor: ${plan.length - ok.length}`);
  pimp = null; location.hash = '#/people';
}
function viewPeopleImport(){
  let body = '';
  if (pimp){
    const plan = planPeople(), cnt = k => plan.filter(p => p.action === k).length;
    const unknown = [...new Map(plan.filter(p => p.unknownSvc).map(p => [norm(p.unknownSvc), p.unknownSvc])).entries()];
    body = `
      <h2>2. Oszlopok – ${esc(pimp.fileName)} (${pimp.rows.length} sor)</h2>
      <div class="card"><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:4px 16px">
        ${PEOPLE_FIELDS.map(f => `<div><label class="f">${f.label} *</label>${mapSelect(f, pimp.headers, pimp.map, 'data-pmap')}</div>`).join('')}</div>
        <p class="muted" style="font-size:12px;margin:8px 0 0">Csak ez a három adat kell. E-mailt, szerepkört és egyebeket később, az alkalmazásban lehet megadni.</p></div>
      ${unknown.length ? `<h2>⚠️ Ismeretlen Service (${unknown.length})</h2><div class="warnbox" style="font-size:14px">A fájlban olyan Service szerepel, ami még nincs a rendszerben. Válaszd ki, mi legyen vele:</div>
        <div class="tbl-wrap"><table><thead><tr><th>Service a fájlban</th><th>Sorok</th><th>Teendő</th></tr></thead><tbody>${unknown.map(([k, name]) =>
          `<tr><td><b>${esc(name)}</b></td><td>${plan.filter(p => p.unknownSvc && norm(p.unknownSvc) === k).length}</td><td><select data-svc="${esc(k)}">
            <option value="">– válassz –</option><option value="__new"${pimp.svcMap[k] === '__new' ? ' selected' : ''}>＋ Létrehozás új Service-ként</option>
            <optgroup label="Hozzárendelés meglévőhöz">${sortHu(db.services, s => s.name).map(s => `<option value="${s.id}"${pimp.svcMap[k] === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</optgroup>
            <option value="__skip"${pimp.svcMap[k] === '__skip' ? ' selected' : ''}>Ezek a sorok kimaradnak</option></select></td></tr>`).join('')}</tbody></table></div>` : ''}
      <h2>3. Előnézet</h2>
      <p>${PPLAN.new} ${cnt('new')} &nbsp; ${PPLAN.error} ${cnt('error')} &nbsp; Kihagy: ${cnt('exists') + cnt('dupfile')}
        <label class="cb" style="display:inline-flex;margin:0 0 0 12px"><input type="checkbox" id="pAllowDup"${pimp.allowDup ? ' checked' : ''}> Már létező nevű személyeket is hozzon létre</label></p>
      <div class="tbl-wrap"><table><thead><tr><th>Sor</th><th>Művelet</th><th>Teljes név</th><th>Service</th><th>Munkavégzési mód</th><th>Megjegyzés</th></tr></thead><tbody>
        ${plan.slice(0, 200).map(p => `<tr><td class="muted">${p.row}</td><td>${PPLAN[p.action]}</td><td>${esc(p.name) || '<span class="muted">–</span>'}${p.exists ? ` <a href="#/person/${p.exists.id}" class="muted">(meglévő)</a>` : ''}</td>
          <td>${p.svc ? esc(p.svc.name) : p.unknownSvc ? esc(p.unknownSvc) + (pimp.svcMap[norm(p.unknownSvc)] === '__new' ? ' <span class="pill acc">új</span>' : '') : '<span class="muted">–</span>'}</td>
          <td>${p.mode ? modePill(p.mode) : esc(p.modeText) || '<span class="muted">–</span>'}</td>
          <td>${p.errors.length ? `<span style="color:var(--danger)">${esc(p.errors.join('; '))}</span>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
      ${plan.length > 200 ? `<p class="muted">… és még ${plan.length - 200} sor.</p>` : ''}
      <div class="row" style="margin-top:14px"><button class="primary" id="pRun" onclick="runPeopleImport()"${cnt('new') ? '' : ' disabled'}>⬆ Importálás (${cnt('new')} személy)</button>
        <button onclick="pimp=null;render()">Mégse</button></div>`;
  }
  return `
    <div class="row"><a href="#/people">← Emberek</a></div>
    <h1 style="margin-top:8px">Személyek importálása Excelből</h1>
    <div class="sub">Pontosan három adat kell: <b>teljes név</b>, <b>Service</b> és <b>munkavégzési mód</b> (Onsite / Hybrid / WFH).</div>
    <div class="card"><b>📄 Sablon</b>
      <p class="muted">Oszlopok: Teljes név · Service · Munkavégzési mód. A módnál az „iroda”, „hibrid”, „otthon”, „home office” írásmódot is felismeri.</p>
      <div class="row"><button class="primary" onclick="downloadPeopleTemplate()">⬇ Excel sablon (.xlsx)</button><button onclick="downloadPeopleCSV()">⬇ CSV sablon</button></div></div>
    <h2>1. Fájl kiválasztása</h2>
    <div class="card row"><input type="file" id="pimpFile" accept=".xlsx,.xls,.csv,.txt"><span class="muted">Excel (.xlsx, .xls) vagy CSV</span></div>
    ${body}`;
}
function bindPeopleImport(){
  $('#pimpFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) readPeopleFile(f); });
  if (!pimp) return;
  document.querySelectorAll('[data-pmap]').forEach(s => s.addEventListener('change', () => { pimp.map[s.dataset.pmap] = +s.value; render(); }));
  document.querySelectorAll('[data-svc]').forEach(s => s.addEventListener('change', () => { pimp.svcMap[s.dataset.svc] = s.value; render(); }));
  $('#pAllowDup').addEventListener('change', e => { pimp.allowDup = e.target.checked; render(); });
}
const PEOPLE_TEMPLATE = [['Teljes név', 'Service', 'Munkavégzési mód'], ['Minta Márta', 'Customer Support', 'Onsite'], ['Példa Péter', 'IT Support', 'Hybrid'], ['Teszt Tímea', 'Finance', 'WFH']];
async function downloadPeopleTemplate(){
  try {
    const X = await loadXLSX(), wb = X.utils.book_new(), ws = X.utils.aoa_to_sheet(PEOPLE_TEMPLATE);
    ws['!cols'] = [{wch:28}, {wch:24}, {wch:20}];
    X.utils.book_append_sheet(wb, ws, 'Emberek');
    const g = X.utils.aoa_to_sheet([['Oszlop', 'Mit írj bele'], ['Teljes név', 'Kötelező.'], ['Service', 'Kötelező. Ha még nincs ilyen Service, importáláskor létrehozható vagy meglévőhöz rendelhető.'],
      ['Munkavégzési mód', 'Kötelező: Onsite, Hybrid vagy WFH.'], [], ['Tipp', 'A példasorokat töröld ki importálás előtt.']]);
    g['!cols'] = [{wch:20}, {wch:100}];
    X.utils.book_append_sheet(wb, g, 'Útmutató');
    X.writeFile(wb, 'it-raktar-szemely-import-sablon.xlsx');
  } catch(e){ alert(e.message + '\nHelyette a CSV sablont töltöm le.'); downloadPeopleCSV(); }
}
function downloadPeopleCSV(){ download('it-raktar-szemely-import-sablon.csv', '﻿' + PEOPLE_TEMPLATE.map(csvLine).join('\r\n'), 'text/csv'); }
