'use strict';
/* Settings: Services, munkaköri szerepek, eszköztípusok és modellek, Custom Field Sets, jegyzőkönyv, adatok, napló-felhasználó */

const SETTINGS_TABS = [['services', '🧩 Services'], ['roles', '👔 Szerepkörök'], ['types', '🏷️ Típusok & modellek'], ['fields', '🧾 Custom Field Sets'],
  ['docs', '📄 Jegyzőkönyv'], ['data', '💾 Adatok'], ['user', '👤 Felhasználó']];
function viewSettings(tab, sub){
  tab = SETTINGS_TABS.some(t => t[0] === tab) ? tab : 'services';
  const body = {services:setServices, roles:setRoles, types:setTypes, fields:() => sub ? setFieldSet(sub) : setFields(), docs:setDocs, data:setData, user:setUser}[tab]();
  return `<h1>Settings</h1><div class="tabs">${SETTINGS_TABS.map(([k, l]) => `<a href="#/settings/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div>${body}`;
}

// ---------- services ----------
function setServices(){
  return `<div class="row"><div class="sub" style="margin:0">A szervezeti egység egyetlen fogalma. Emberek és eszközök is rendelhetők hozzá; az irodákhoz külön kapcsolható (Floorplan).</div>
    <span class="spacer"></span><button class="primary" onclick="serviceForm()">+ Új Service</button></div>
    ${db.services.length ? `<div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Service</th><th>Emberek</th><th>Eszközök (Service-hez rendelve)</th><th>Irodák</th><th>Megjegyzés</th><th></th></tr></thead><tbody>${sortHu(db.services, s => s.name).map(s => {
      const ppl = db.people.filter(p => p.serviceId === s.id), rooms = db.rooms.filter(r => r.serviceIds.includes(s.id));
      return `<tr><td><b>${esc(s.name)}</b></td><td><a href="#/people?service=${s.id}">${ppl.length}</a> <small class="muted">${MODES.map(m => MODE_ICON[m] + ppl.filter(p => p.mode === m).length).join(' ')}</small></td>
        <td><a href="#/assets?service=${s.id}">${db.assets.filter(a => a.serviceId === s.id).length}</a></td>
        <td>${rooms.map(r => `<a href="#/room/${r.id}">${esc(r.name)}</a>`).join(', ') || '<span class="muted">–</span>'}</td><td class="muted">${esc(s.note)}</td>
        <td style="text-align:right;white-space:nowrap"><button class="sm" onclick="serviceForm(service('${s.id}'))">✎</button> <button class="sm danger" onclick="deleteService('${s.id}')">🗑</button></td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="empty">Még nincs Service.</div>'}`;
}
function serviceForm(s){
  const isNew = !s; s = s || {name:'', note:''};
  openDialog(`<h3>${isNew ? 'Új Service' : 'Service szerkesztése'}</h3>
    <label class="f">Név</label><input name="name" required value="${esc(s.name)}" placeholder="pl. Customer Support">
    <label class="f">Megjegyzés</label><input name="note" value="${esc(s.note)}">${dlgActions(isNew ? 'Létrehozás' : 'Mentés')}`,
    data => {
      const name = data.name.trim();
      if (db.services.some(x => x !== s && norm(x.name) === norm(name))){ alert('Már van ilyen nevű Service.'); return false; }
      if (isNew) db.services.push({id:uid(), name, note:data.note.trim()}); else Object.assign(s, {name, note:data.note.trim()});
      save(); render();
    });
}
function deleteService(id){
  const s = service(id), n = db.people.filter(p => p.serviceId === id).length + db.assets.filter(a => a.serviceId === id).length;
  if (!confirm(`Törlöd a(z) „${s.name}” Service-t?` + (n ? `\n${n} személy / eszköz Service nélkül marad.` : ''))) return;
  for (const p of db.people) if (p.serviceId === id) p.serviceId = null;
  for (const a of db.assets) if (a.serviceId === id) a.serviceId = null;
  for (const r of db.rooms) r.serviceIds = r.serviceIds.filter(x => x !== id);
  db.services = db.services.filter(x => x.id !== id); save(); render();
}

// ---------- roles ----------
function setRoles(){
  return `<div class="row"><div class="sub" style="margin:0">Munkaköri szerepek (pl. Agent, TeamLeader). A munkavégzési módtól (Onsite / Hybrid / WFH) független.</div>
    <span class="spacer"></span><button class="primary" onclick="roleForm()">+ Új szerepkör</button></div>
    ${db.roles.length ? `<div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Szerepkör</th><th>Emberek</th><th></th></tr></thead><tbody>${sortHu(db.roles, r => r.name).map(r =>
      `<tr><td><b>${esc(r.name)}</b></td><td>${db.people.filter(p => p.roleId === r.id).map(p => personLink(p.id)).join(', ') || '<span class="muted">–</span>'}</td>
       <td style="text-align:right;white-space:nowrap"><button class="sm" onclick="roleForm(role('${r.id}'))">✎</button> <button class="sm danger" onclick="deleteRole('${r.id}')">🗑</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Még nincs szerepkör.</div>'}`;
}
function roleForm(r){
  const isNew = !r; r = r || {name:''};
  openDialog(`<h3>${isNew ? 'Új szerepkör' : 'Szerepkör szerkesztése'}</h3><label class="f">Név</label><input name="name" required value="${esc(r.name)}" placeholder="pl. TeamLeader">${dlgActions(isNew ? 'Létrehozás' : 'Mentés')}`,
    data => {
      const name = data.name.trim();
      if (db.roles.some(x => x !== r && norm(x.name) === norm(name))){ alert('Már van ilyen nevű szerepkör.'); return false; }
      if (isNew) db.roles.push({id:uid(), name}); else r.name = name;
      save(); render();
    });
}
function deleteRole(id){
  const r = role(id), n = db.people.filter(p => p.roleId === id).length;
  if (!confirm(`Törlöd a(z) „${r.name}” szerepkört?` + (n ? `\n${n} személy szerepkör nélkül marad.` : ''))) return;
  for (const p of db.people) if (p.roleId === id) p.roleId = null;
  db.roles = db.roles.filter(x => x.id !== id); save(); render();
}

// ---------- types & models ----------
function setTypes(){
  return `<div class="row"><h2 style="margin:0">Eszköztípusok</h2><span class="spacer"></span><button class="primary" onclick="typeForm()">+ Új típus</button></div>
    <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th></th><th>Típus</th><th>Mezőcsoportok</th><th>Modellek</th><th>Eszközök</th><th></th></tr></thead><tbody>${sortHu(db.types, t => t.name).map(t => {
      const sets = db.fieldSets.filter(s => s.typeIds.includes(t.id)), n = db.assets.filter(a => a.type === t.id).length;
      return `<tr><td style="font-size:20px">${t.icon}</td><td><b>${esc(t.name)}</b>${t.system ? ' <span class="pill" title="A Projects használja, nem törölhető">rendszer</span>' : ''}</td>
        <td>${sets.map(s => `<a href="#/settings/fields/${s.id}">${esc(s.name)}</a>`).join(', ') || '<span class="muted">–</span>'}</td>
        <td>${db.models.filter(m => m.typeId === t.id).length}</td><td><a href="#/assets?type=${encodeURIComponent(t.id)}">${n}</a></td>
        <td style="text-align:right;white-space:nowrap"><button class="sm" onclick="typeForm(typeOf('${t.id}'))">✎</button> ${t.system || n ? '' : `<button class="sm danger" onclick="deleteType('${t.id}')">🗑</button>`}</td></tr>`;
    }).join('')}</tbody></table></div>
    <div class="row" style="margin-top:24px"><h2 style="margin:0">Modellek</h2><span class="spacer"></span><button class="primary" onclick="modelForm()">+ Új modell</button></div>
    <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th></th><th>Modell</th><th>Típus</th><th>Eszközök</th><th></th></tr></thead><tbody>${sortHu(db.models, m => typeLabel(m.typeId) + m.name).map(m => {
      const n = db.assets.filter(a => a.modelId === m.id).length, img = m.imageId && db.images[m.imageId];
      return `<tr><td style="width:40px">${img ? `<img class="thumb" src="${img}" alt="">` : `<span class="ico">${typeIcon(m.typeId)}</span>`}</td><td><b>${esc(m.name)}</b></td>
        <td><a href="#/assets?type=${encodeURIComponent(m.typeId)}">${typeIcon(m.typeId)} ${esc(typeLabel(m.typeId))}</a></td><td><a href="#/assets?model=${m.id}">${n}</a></td>
        <td style="text-align:right;white-space:nowrap"><button class="sm" onclick="modelForm(model('${m.id}'))">✎</button> ${n ? '' : `<button class="sm danger" onclick="deleteModel('${m.id}')">🗑</button>`}</td></tr>`;
    }).join('') || '<tr><td colspan="5" class="empty">Még nincs modell.</td></tr>'}</tbody></table></div>`;
}
function typeForm(t){
  const isNew = !t; t = t || {name:'', icon:'📦'};
  openDialog(`<h3>${isNew ? 'Új eszköztípus' : 'Típus szerkesztése'}</h3>
    <div class="two"><div><label class="f">Név</label><input name="name" required value="${esc(t.name)}" placeholder="pl. Monitor"></div>
      <div><label class="f">Ikon (emoji)</label><input name="icon" value="${esc(t.icon)}" maxlength="4"></div></div>
    <p class="muted" style="font-size:12px">Mezőcsoportot a Custom Field Sets fülön lehet a típushoz rendelni.</p>${dlgActions(isNew ? 'Létrehozás' : 'Mentés')}`,
    data => {
      const name = data.name.trim();
      if (db.types.some(x => x !== t && norm(x.name) === norm(name))){ alert('Már van ilyen nevű típus.'); return false; }
      if (isNew) db.types.push({id:uid(), name, icon:data.icon.trim() || '📦'}); else Object.assign(t, {name, icon:data.icon.trim() || '📦'});
      save(); render();
    });
}
function deleteType(id){
  if (!confirm(`Törlöd a(z) „${typeLabel(id)}” típust és a hozzá tartozó (üres) modelleket?`)) return;
  db.models = db.models.filter(m => m.typeId !== id);
  for (const s of db.fieldSets) s.typeIds = s.typeIds.filter(x => x !== id);
  db.types = db.types.filter(x => x.id !== id); save(); render();
}
function modelForm(m){
  const isNew = !m; m = m || {name:'', typeId:'monitor', imageId:null};
  let pendingImg = null;
  const img = m.imageId && db.images[m.imageId];
  openDialog(`<h3>${isNew ? 'Új modell' : 'Modell szerkesztése'}</h3>
    <div class="two"><div><label class="f">Típus</label><select name="typeId"${!isNew && db.assets.some(a => a.modelId === m.id) ? ' disabled title="Van már ilyen eszköz"' : ''}>${sortHu(db.types, t => t.name).map(t => `<option value="${esc(t.id)}"${t.id === m.typeId ? ' selected' : ''}>${t.icon} ${esc(t.name)}</option>`).join('')}</select></div>
      <div><label class="f">Modell neve</label><input name="name" required value="${esc(m.name)}" placeholder="pl. Dell P2422H"></div></div>
    <label class="f">Kép (ikonként jelenik meg minden ilyen eszköznél)</label>
    <div class="row"><img id="mImgPrev" class="thumb" style="width:64px;height:64px;${img ? '' : 'display:none'}" src="${img || ''}" alt=""><input type="file" id="mImg" accept="image/*"></div>
    ${dlgActions(isNew ? 'Létrehozás' : 'Mentés')}`,
    data => {
      const typeId = data.typeId || m.typeId, name = data.name.trim();
      if (db.models.some(x => x !== m && x.typeId === typeId && norm(x.name) === norm(name))){ alert('Ennél a típusnál már van ilyen modell.'); return false; }
      if (isNew){ m = {id:uid(), typeId, name, imageId:null}; db.models.push(m); } else Object.assign(m, {typeId, name});
      if (pendingImg){ const iid = uid(); db.images[iid] = pendingImg; m.imageId = iid; }
      save(); render();
    });
  $('#mImg').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { pendingImg = await resizeImage(f); $('#mImgPrev').src = pendingImg; $('#mImgPrev').style.display = ''; } catch(err){ alert(err.message); }
  });
}
function deleteModel(id){ if (confirm(`Törlöd a(z) „${model(id).name}” modellt?`)){ db.models = db.models.filter(m => m.id !== id); save(); render(); } }

// ---------- custom field sets ----------
function setFields(){
  return `<div class="row"><div class="sub" style="margin:0">Először hozz létre egy mezőcsoportot (pl. <b>Monitor_Fields</b>), add hozzá a mezőket, majd rendeld eszköztípus(ok)hoz.
    Ettől kezdve az adott típusú eszközök adatlapján és űrlapján automatikusan megjelennek.</div><span class="spacer"></span><button class="primary" onclick="fieldSetForm()">+ Új mezőcsoport</button></div>
    ${db.fieldSets.length ? `<div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Mezőcsoport</th><th>Mezők</th><th>Eszköztípusok</th><th></th></tr></thead><tbody>${sortHu(db.fieldSets, s => s.name).map(s =>
      `<tr><td><a href="#/settings/fields/${s.id}"><b>${esc(s.name)}</b></a></td>
        <td>${s.fields.map(f => `<span class="pill"${f.active ? '' : ' style="opacity:.5" title="inaktív"'}>${esc(f.name)}${f.required ? ' *' : ''}</span>`).join(' ') || '<span class="muted">nincs mező</span>'}</td>
        <td>${s.typeIds.map(t => `${typeIcon(t)} ${esc(typeLabel(t))}`).join(', ') || '<span class="muted">nincs hozzárendelve</span>'}</td>
        <td style="text-align:right"><a class="btn sm" href="#/settings/fields/${s.id}">✎ Szerkesztés</a></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Még nincs mezőcsoport.</div>'}`;
}
function fieldSetForm(s){
  const isNew = !s; s = s || {name:''};
  openDialog(`<h3>${isNew ? 'Új mezőcsoport' : 'Mezőcsoport átnevezése'}</h3><label class="f">Név</label><input name="name" required value="${esc(s.name)}" placeholder="pl. Monitor_Fields">${dlgActions(isNew ? 'Létrehozás' : 'Mentés')}`,
    data => {
      const name = data.name.trim();
      if (db.fieldSets.some(x => x !== s && norm(x.name) === norm(name))){ alert('Már van ilyen nevű mezőcsoport.'); return false; }
      if (isNew){ const n = {id:uid(), name, typeIds:[], fields:[]}; db.fieldSets.push(n); save(); location.hash = '#/settings/fields/' + n.id; }
      else { s.name = name; save(); render(); }
    });
}
function setFieldSet(id){
  const s = byId(db.fieldSets, id);
  if (!s) return '<div class="empty">A mezőcsoport nem található.</div>';
  const n = db.assets.filter(a => s.typeIds.includes(a.type)).length;
  return `<div class="row"><a href="#/settings/fields">← Custom Field Sets</a></div>
    <div class="row" style="margin-top:8px"><h2 style="margin:0">🧾 ${esc(s.name)}</h2><span class="spacer"></span>
      <button onclick="fieldSetForm(byId(db.fieldSets,'${s.id}'))">✎ Átnevezés</button><button class="danger" onclick="deleteFieldSet('${s.id}')">Törlés</button></div>
    <h2>Mezők</h2>
    ${s.fields.length ? `<div class="tbl-wrap"><table class="fields"><thead><tr><th>Sorrend</th><th>Mező neve</th><th>Típus</th><th>Kötelező</th><th>Válaszlehetőségek</th><th>Állapot</th><th></th></tr></thead><tbody>${s.fields.map((f, i) =>
      `<tr class="${f.active ? '' : 'inactive'}"><td style="white-space:nowrap"><button class="sm" onclick="moveField('${s.id}','${f.id}',-1)"${i ? '' : ' disabled'} title="Fel">▲</button> <button class="sm" onclick="moveField('${s.id}','${f.id}',1)"${i < s.fields.length - 1 ? '' : ' disabled'} title="Le">▼</button></td>
       <td><b>${esc(f.name)}</b></td><td>${FIELD_KINDS[f.kind]}</td><td>${f.required ? '✔' : ''}</td><td class="muted">${f.kind === 'select' ? f.options.map(esc).join(', ') : ''}</td>
       <td>${f.active ? '<span class="pill ok">aktív</span>' : '<span class="pill">inaktív</span>'}</td>
       <td style="text-align:right;white-space:nowrap"><button class="sm" onclick="fieldForm('${s.id}','${f.id}')">✎</button> <button class="sm" onclick="toggleField('${s.id}','${f.id}')">${f.active ? 'Deaktiválás' : 'Aktiválás'}</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Még nincs mező.</div>'}
    <div class="row" style="margin-top:10px"><button class="primary" onclick="fieldForm('${s.id}')">+ Új mező</button>
      <span class="muted" style="font-size:12px">A deaktivált mező nem jelenik meg, de a már rögzített értékek megmaradnak.</span></div>
    <h2>Eszköztípusok, amelyekhez a csoport tartozik</h2>
    <div class="card"><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px">${sortHu(db.types, t => t.name).map(t =>
      `<label class="cb" style="margin:4px 0"><input type="checkbox" data-fst="${esc(t.id)}"${s.typeIds.includes(t.id) ? ' checked' : ''}> ${t.icon} ${esc(t.name)}</label>`).join('')}</div>
      <p class="muted" style="font-size:12px;margin:6px 0 0">${n} eszköz adatlapján jelennek meg most ezek a mezők. A hozzárendelés módosítása nem töröl adatot.</p></div>`;
}
function bindFieldSet(id){
  const s = byId(db.fieldSets, id); if (!s) return;
  document.querySelectorAll('[data-fst]').forEach(c => c.addEventListener('change', () => {
    s.typeIds = c.checked ? [...new Set([...s.typeIds, c.dataset.fst])] : s.typeIds.filter(t => t !== c.dataset.fst);
    save(); render(); toast(`${s.name} ${c.checked ? 'hozzárendelve' : 'levéve'}: ${typeLabel(c.dataset.fst)}`);
  }));
}
function fieldForm(setId, fieldId){
  const s = byId(db.fieldSets, setId), f = fieldId ? s.fields.find(x => x.id === fieldId) : null, isNew = !f;
  const v = f || {name:'', kind:'text', required:false, options:[]};
  openDialog(`<h3>${isNew ? 'Új mező' : 'Mező szerkesztése'} – ${esc(s.name)}</h3>
    <div class="two"><div><label class="f">Mező neve</label><input name="name" required value="${esc(v.name)}" placeholder="pl. Képátló"></div>
      <div><label class="f">Mezőtípus</label><select name="kind" id="ffKind">${Object.entries(FIELD_KINDS).map(([k, l]) => `<option value="${k}"${k === v.kind ? ' selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div id="ffOpts"${v.kind === 'select' ? '' : ' style="display:none"'}><label class="f">Válaszlehetőségek (soronként egy)</label><textarea name="options" style="width:100%" rows="4">${esc(v.options.join('\n'))}</textarea></div>
    <label class="cb"><input type="checkbox" name="required"${v.required ? ' checked' : ''}> Kötelező mező</label>
    ${!isNew && v.kind !== 'text' ? '<p class="muted" style="font-size:12px">A mezőtípus módosításakor a meglévő értékek megmaradnak, de előfordulhat, hogy újra kell őket ellenőrizni.</p>' : ''}
    ${dlgActions(isNew ? 'Hozzáadás' : 'Mentés')}`,
    data => {
      const opts = (data.options || '').split('\n').map(x => x.trim()).filter(Boolean);
      if (data.kind === 'select' && !opts.length){ alert('Legördülő listához adj meg legalább egy válaszlehetőséget.'); return false; }
      const nv = {name:data.name.trim(), kind:data.kind, required:!!data.required, options:data.kind === 'select' ? opts : []};
      if (isNew) s.fields.push({id:uid(), ...nv, active:true}); else Object.assign(f, nv);
      save(); render();
    });
  $('#ffKind').addEventListener('change', e => { $('#ffOpts').style.display = e.target.value === 'select' ? '' : 'none'; });
}
function moveField(setId, fieldId, dir){
  const s = byId(db.fieldSets, setId), i = s.fields.findIndex(f => f.id === fieldId), j = i + dir;
  if (j < 0 || j >= s.fields.length) return;
  [s.fields[i], s.fields[j]] = [s.fields[j], s.fields[i]]; save(); render();
}
function toggleField(setId, fieldId){ const f = byId(db.fieldSets, setId).fields.find(x => x.id === fieldId); f.active = !f.active; save(); render(); }
function deleteFieldSet(id){
  const s = byId(db.fieldSets, id);
  if (!confirm(`Törlöd a(z) „${s.name}” mezőcsoportot?\nA mezők eltűnnek az adatlapokról, de az eszközöknél rögzített értékek a háttérben megmaradnak (egy új, azonos mezővel nem jönnek vissza).`)) return;
  db.fieldSets = db.fieldSets.filter(x => x.id !== id); save(); location.hash = '#/settings/fields';
}

// ---------- protocol texts ----------
function setDocs(){
  const s = db.settings;
  return `<div class="card">
    <div class="two">
      <div><label class="f">Cégnév (fejléc)</label><input id="sCompany" value="${esc(s.company)}"></div>
      <div><label class="f">Cím (fejléc)</label><input id="sAddress" value="${esc(s.address)}"></div>
      <div><label class="f">Átadó / visszavevő (IT) alapértelmezett neve</label><input id="sHandler" value="${esc(s.handler)}"></div>
    </div>
    <label class="f">Átadás-átvételi nyilatkozat szövege</label><textarea id="sOut" rows="6" style="width:100%">${esc(s.outText)}</textarea>
    <label class="f">Visszavételi nyilatkozat szövege</label><textarea id="sIn" rows="4" style="width:100%">${esc(s.inText)}</textarea>
    <label class="f">Eszközcsere nyilatkozat szövege</label><textarea id="sSwap" rows="4" style="width:100%">${esc(s.swapText)}</textarea>
    <div class="row" style="margin-top:12px"><button class="primary" onclick="saveDocSettings()">Mentés</button>
      <button onclick="if(confirm('Visszaállítod a nyilatkozatok alapszövegét?')){Object.assign(db.settings,{outText:DEFAULT_SETTINGS.outText,inText:DEFAULT_SETTINGS.inText,swapText:DEFAULT_SETTINGS.swapText});save();render();}">Alapszöveg visszaállítása</button>
      <span class="muted" style="font-size:12px">A minta nyilatkozatszöveget érdemes HR-rel / jogásszal egyeztetni.</span></div></div>`;
}
function saveDocSettings(){
  Object.assign(db.settings, {company:$('#sCompany').value.trim(), address:$('#sAddress').value.trim(), handler:$('#sHandler').value.trim(),
    outText:$('#sOut').value.trim(), inText:$('#sIn').value.trim(), swapText:$('#sSwap').value.trim()});
  save(); toast('Beállítások mentve.'); render();
}

// ---------- data ----------
function setData(){
  const kb = Math.round(JSON.stringify(db).length / 1024), imgKb = Math.round(JSON.stringify(db.images).length / 1024);
  return `<div class="sub">Az adatok ebben a böngészőben tárolódnak (localStorage, az aláírt PDF-ek IndexedDB-ben). Backend és adatbázis nincs. Rendszeresen készíts mentést!</div>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
      <div class="card"><b>Mentés (export)</b><p class="muted">Minden adat (képekkel és az aláírt jegyzőkönyvekkel együtt) egy JSON fájlba. Így adható át kollégának is.</p><button class="primary" onclick="exportJSON()">⬇ JSON mentés</button></div>
      <div class="card"><b>Visszatöltés (import)</b><p class="muted">Korábbi JSON mentés betöltése – felülírja a jelenlegi adatokat. A régi (v1) mentés is betölthető.</p><button onclick="$('#importFile').click()">⬆ JSON betöltése</button></div>
      <div class="card"><b>Eszközök importálása</b><p class="muted">Excel sablonból (nagyobb rendelés) vagy Snipe-IT exportból.</p><a class="btn" href="#/import">⬆ Eszköz-import</a></div>
      <div class="card"><b>Személyek importálása</b><p class="muted">Excelből: teljes név, Service, munkavégzési mód.</p><a class="btn" href="#/people/import">⬆ Személy-import</a></div>
      <div class="card"><b>Eszközlista Excelhez</b><p class="muted">CSV export minden eszközről, az egyedi mezőkkel együtt.</p><button onclick="exportCSV()">⬇ CSV</button></div>
      <div class="card"><b>Demo adatok</b><p class="muted">Mintaadatok visszaállítása (a jelenlegi adatok elvesznek).</p><button onclick="resetDemo()">Demo betöltése</button></div>
      <div class="card"><b>Üres kezdés</b><p class="muted">Minden adat törlése, hogy a saját eszközeiddel kezdhesd.</p><button class="danger" onclick="wipe()">Minden törlése</button></div>
    </div>
    <h2>Statisztika</h2>
    <p>${db.assets.length} eszköz (utolsó kiosztott Asset ID: ${db.seq.asset ? fmtAssetId(db.seq.asset) : '–'}) · ${db.people.length} személy · ${db.services.length} Service · ${db.rooms.length} helyiség · ${db.projects.length} projekt ·
      ${db.docs.length} jegyzőkönyv (${db.docs.filter(d => d.fileId).length} aláírt) · ${db.log.length} naplóbejegyzés</p>
    <p class="muted">Foglalt tárhely: kb. ${kb} KB (ebből képek: ${imgKb} KB) a böngésző kb. 5000 KB-os keretéből.</p>`;
}
async function exportJSON(){
  const files = {};
  for (const d of db.docs) if (d.fileId){
    const rec = await idb.get(d.fileId).catch(() => null);
    if (rec) files[d.fileId] = {name:rec.name, type:rec.type, data:await blobToDataURL(rec.blob)};
  }
  download(`it-raktar-mentes-${stamp()}.json`, JSON.stringify({...db, files}, null, 2), 'application/json');
}
async function importJSONFile(f){
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.assets) || !Array.isArray(d.people) || !Array.isArray(d.rooms)) throw new Error('Nem IT Raktár mentés.');
    if (!confirm(`Betöltöd? ${d.assets.length} eszköz, ${d.people.length} személy. A jelenlegi adatok felülíródnak.`)) return;
    const files = d.files || {}; delete d.files;
    await idb.clear();
    for (const [id, x] of Object.entries(files)) await idb.put(id, {name:x.name, type:x.type, blob:await (await fetch(x.data)).blob()});
    db = migrate(d); save(); location.hash = '#/'; render();
  } catch(err){ alert('Hibás fájl: ' + err.message); }
}
function resetDemo(){ if (confirm('Biztosan visszaállítod a demo adatokat? A jelenlegi adatok (és a feltöltött aláírt dokumentumok) elvesznek.')){ idb.clear().catch(() => {}); db = demo(); save(); location.hash = '#/'; render(); } }
function wipe(){ if (confirm('MINDEN adat törlődik, a feltöltött aláírt dokumentumokkal együtt. Biztos? (Előtte érdemes JSON mentést készíteni.)')){ idb.clear().catch(() => {}); db = migrate({version:2}); save(); location.hash = '#/'; render(); } }

// ---------- log user ----------
function setUser(){
  return `<div class="card" style="max-width:520px"><b>Ki dolgozik most ebben a böngészőben?</b>
    <p class="muted">A prototípusban nincs bejelentkezés. Az itt megadott név kerül a naplóbejegyzések „Ki” oszlopába (csak ebben a böngészőben tárolódik).</p>
    <label class="f">Név</label><input id="uName" value="${esc(currentUser())}" list="uList" placeholder="pl. Molnár Tamás"><datalist id="uList">${sortHu(db.people, p => p.name).map(p => `<option value="${esc(p.name)}">`).join('')}</datalist>
    <div class="row" style="margin-top:12px"><button class="primary" onclick="saveUser()">Mentés</button></div></div>`;
}
function saveUser(){ try { localStorage.setItem(USER_KEY, $('#uName').value.trim()); } catch(e) {} toast('Mentve – a naplóban ez a név jelenik meg.'); renderUserChip(); }
