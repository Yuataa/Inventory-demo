'use strict';
/* Áttekintés, eszközlista, eszköz adatlap és űrlap, tömeges műveletek, csere, eszköz-import */

// ---------- dashboard ----------
function viewDashboard(){
  const cnt = k => db.assets.filter(a => a.holder.kind === k).length;
  const expiring = sortHu(db.assets.filter(a => { const w = warranty(a); return w.days !== null && w.days <= 60 && a.status !== 'retired'; }), a => a.warrantyUntil);
  const byType = sortHu(db.types.map(t => [t, db.assets.filter(a => a.type === t.id).length]).filter(x => x[1]), x => x[0].name);
  const byModel = db.models.map(m => [m, db.assets.filter(a => a.modelId === m.id).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const active = db.projects.filter(p => p.status !== 'completed' && p.status !== 'cancelled');
  const remote = sortHu(db.people.filter(p => p.mode !== 'Onsite'), p => p.name);
  return `
    <h1>Áttekintés</h1><div class="sub">Céges IT eszközök nyilvántartása – irodában és otthon. A számokra kattintva a megfelelő lista nyílik meg.</div>
    <div class="grid">
      <a class="card stat" href="#/assets"><div class="n">${db.assets.length}</div><div class="l">Eszköz összesen</div></a>
      <a class="card stat" href="#/assets?loc=desk"><div class="n">${cnt('desk')}</div><div class="l">🪑 Asztalon / rackben</div></a>
      <a class="card stat" href="#/assets?loc=office"><div class="n">${cnt('office')}</div><div class="l">🏢 Irodai eszközhalmazban</div></a>
      <a class="card stat" href="#/assets?loc=person"><div class="n">${cnt('person')}</div><div class="l">👤 Személyhez kiadva</div></a>
      <a class="card stat" href="#/assets?loc=storage"><div class="n">${cnt('storage')}</div><div class="l">📦 Raktárban</div></a>
      <a class="card stat" href="#/projects"><div class="n">${active.length}</div><div class="l">📋 Aktív projekt</div></a>
      <a class="card stat" href="#/docs?f=wait"><div class="n">${db.docs.filter(d => !d.fileId).length}</div><div class="l">📄 Jegyzőkönyv aláírásra vár</div></a>
      <a class="card stat" href="#/docs"><div class="n">${db.people.reduce((n, p) => n + uncovered(p.id).length, 0)}</div><div class="l">⚠️ Kiadott eszköz jegyzőkönyv nélkül</div></a>
    </div>
    <h2>Típusonként</h2>
    <div class="grid" id="dashTypes">${byType.map(([t, n]) => `<a class="card stat" href="#/assets?type=${encodeURIComponent(t.id)}"><div class="n">${n}</div><div class="l">${t.icon} ${esc(t.name)}</div></a>`).join('') || '<div class="empty">Még nincs eszköz.</div>'}</div>
    <h2>Leggyakoribb modellek</h2>
    ${byModel.length ? `<div class="tbl-wrap"><table><thead><tr><th>Modell</th><th>Típus</th><th>Darab</th></tr></thead><tbody>${byModel.map(([m, n]) =>
      `<tr><td><a href="#/assets?model=${m.id}">${esc(m.name)}</a></td><td><a href="#/assets?type=${encodeURIComponent(m.typeId)}">${typeIcon(m.typeId)} ${esc(typeLabel(m.typeId))}</a></td><td><a href="#/assets?model=${m.id}"><b>${n}</b></a></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">–</div>'}
    ${expiring.length ? `<h2>⚠️ Lejárt vagy 60 napon belül lejáró garancia (${expiring.length})</h2>${assetRows(expiring)}` : ''}
    <h2>Service-enként</h2>
    <div class="grid">${sortHu(db.services, s => s.name).map(s => { const ppl = db.people.filter(p => p.serviceId === s.id);
      return `<a class="card stat" href="#/people?service=${s.id}"><div class="n">${ppl.length}</div><div class="l">🧩 ${esc(s.name)} · ${MODES.map(m => `${MODE_ICON[m]}${ppl.filter(p => p.mode === m).length}`).join(' ')}</div></a>`; }).join('') || '<div class="empty">Még nincs Service – a Settings menüben hozható létre.</div>'}</div>
    <h2>WFH / Hybrid munkatársak</h2>
    ${remote.length ? `<div class="tbl-wrap"><table><thead><tr><th>Név</th><th>Service</th><th>Mód</th><th>Eszközök nála</th></tr></thead><tbody>${remote.map(p => {
      const pa = personAssets(p.id);
      return `<tr><td>${personLink(p.id)}</td><td>${esc(serviceName(p.serviceId))}</td><td>${modePill(p.mode)}</td><td>${pa.direct.map(a => `<a class="chip" href="#/asset/${a.id}">${typeIcon(a.type)} ${esc(a.tag)}</a>`).join(' ') || '<span class="muted">–</span>'}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="empty">Nincs ilyen munkatárs.</div>'}
    <h2>Legutóbbi események</h2>
    ${logTable(db.log.slice(0, 8))}`;
}

// ---------- asset list ----------
const LOC_LABEL = {desk:'🪑 Asztalon / rackben', office:'🏢 Irodai eszközhalmazban', person:'👤 Személyhez kiadva', storage:'📦 Raktárban'};
function viewAssets(params){
  const f = k => params.get(k) || '';
  const [q, type, mdl, loc, warr, status, svc] = ['q', 'type', 'model', 'loc', 'warr', 'status', 'service'].map(f);
  let list = db.assets;
  if (type) list = list.filter(a => a.type === type);
  if (mdl) list = list.filter(a => a.modelId === mdl);
  if (loc) list = list.filter(a => a.holder.kind === loc);
  if (status) list = list.filter(a => a.status === status);
  if (svc) list = list.filter(a => a.serviceId === svc || (a.holder.kind === 'person' && (person(a.holder.id) || {}).serviceId === svc));
  if (warr) list = list.filter(a => { const w = warranty(a); return warr === 'none' ? w.days === null : warr === 'bad' ? w.days !== null && w.days < 0 : w.days !== null && w.days >= 0 && w.days <= 60; });
  if (q){ const n = norm(q); list = list.filter(a => norm([a.tag, a.legacyTag, modelName(a), a.serial, a.note, a.supplier, a.orderNo, whereText(a), Object.values(a.custom || {}).join(' ')].join(' ')).includes(n)); }
  list = sortHu(list, a => a.tag);
  const models = sortHu(db.models.filter(m => !type || m.typeId === type), m => m.name);
  const title = mdl && model(mdl) ? model(mdl).name : type ? typeLabel(type) : 'Eszközök';
  return `
    <div class="row"><h1>${type ? typeIcon(type) + ' ' : ''}${esc(title)}</h1><span class="spacer"></span>
      <button onclick="exportCSV()">⬇ CSV</button>
      <a class="btn" href="#/import">⬆ Importálás (Excel / Snipe-IT)</a>
      <button class="primary" onclick="assetForm(null, null, '${esc(type)}')">+ Új eszköz</button></div>
    <div class="sub">${list.length} / ${db.assets.length} eszköz${type || mdl || loc || q || warr || status || svc ? ' · <a href="#/assets">szűrés törlése</a>' : ''}</div>
    <div class="row" style="margin-bottom:12px">
      <input id="fq" placeholder="Szűrés: Asset ID, S/N, modell…" value="${esc(q)}" style="min-width:220px">
      <select id="ftype" title="Típus"><option value="">Minden típus</option>${sortHu(db.types, t => t.name).map(t => `<option value="${esc(t.id)}"${t.id === type ? ' selected' : ''}>${t.icon} ${esc(t.name)}</option>`).join('')}</select>
      <select id="fmodel" title="Modell"><option value="">Minden modell</option>${models.map(m => `<option value="${m.id}"${m.id === mdl ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
      <select id="floc" title="Hely"><option value="">Bárhol</option>${Object.entries(LOC_LABEL).map(([k, v]) => `<option value="${k}"${k === loc ? ' selected' : ''}>${v}</option>`).join('')}</select>
      <select id="fsvc" title="Service"><option value="">Minden Service</option>${sortHu(db.services, s => s.name).map(s => `<option value="${s.id}"${s.id === svc ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <select id="fstatus" title="Állapot"><option value="">Minden állapot</option>${Object.entries(STATUS).map(([k, s]) => `<option value="${k}"${k === status ? ' selected' : ''}>${s.label}</option>`).join('')}</select>
      <select id="fwarr" title="Garancia"><option value="">Garancia: mind</option>
        <option value="soon"${warr === 'soon' ? ' selected' : ''}>60 napon belül lejár</option><option value="bad"${warr === 'bad' ? ' selected' : ''}>Lejárt</option><option value="none"${warr === 'none' ? ' selected' : ''}>Nincs megadva</option></select>
    </div>
    <div class="bulkbar" id="bulkbar" hidden>
      <b>✔ <span class="bulkCount">0</span> kijelölve</b>
      <div class="picker" style="flex-direction:row;align-items:center"><input type="search" class="pick-q" placeholder="Kinek / hova? (keresés)" style="width:170px">
        <select id="bulkHolder" style="max-width:280px"><option value="">– Kinek / hova? –</option>${holderOptions('')}</select></div>
      <button class="primary" onclick="bulkMove($('#bulkHolder').value)">Hozzárendelés</button>
      <button onclick="bulkMove('storage')">📦 Vissza raktárba</button>
      <select id="bulkStatus"><option value="">Állapot…</option>${Object.entries(STATUS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('')}</select>
      <button onclick="bulkStatus()">Beállít</button>
      <span class="spacer"></span><button class="sm" onclick="selected.clear(); render()">✕ Kijelölés törlése</button>
    </div>
    ${assetRows(list, {select:true})}`;
}
function bindAssetFilters(){
  const upd = () => {
    const p = new URLSearchParams();
    const set = (k, sel) => { if ($(sel).value) p.set(k, $(sel).value); };
    set('q', '#fq'); set('type', '#ftype'); set('model', '#fmodel'); set('loc', '#floc'); set('service', '#fsvc'); set('status', '#fstatus'); set('warr', '#fwarr');
    // a model that does not belong to the newly chosen type is dropped
    if (p.get('model') && p.get('type') && (model(p.get('model')) || {}).typeId !== p.get('type')) p.delete('model');
    history.replaceState(null, '', '#/assets' + (p.toString() ? '?' + p : ''));
    const pos = $('#fq').selectionStart; render(); $('#fq').focus(); $('#fq').setSelectionRange(pos, pos);
  };
  $('#fq').addEventListener('input', upd);
  for (const s of ['#ftype', '#fmodel', '#floc', '#fsvc', '#fstatus', '#fwarr']) $(s).addEventListener('change', upd);
}

// ---------- moving assets ----------
function bulkMove(hs){
  if (!hs){ alert('Válaszd ki, hova vagy kinek kerüljenek az eszközök.'); return; }
  const list = [...selected].map(asset).filter(Boolean);
  if (!list.length) return;
  const h = parseHolder(hs);
  const returning = list.filter(a => a.holder.kind === 'person' && !(h.kind === 'person' && h.id === a.holder.id));
  if (returning.length && h.kind !== 'person' && !confirm(`Biztosan visszaveszed ezt a(z) ${returning.length} eszközt?\n\n` +
    returning.map(a => `${a.tag} – ${(person(a.holder.id) || {}).name}`).join('\n') + `\n\nÚj hely: ${holderText(h)}`)) return;
  const from = new Map();
  for (const a of returning) from.set(a.holder.id, [...(from.get(a.holder.id) || []), a.id]);
  for (const a of list) setHolder(a, h);
  selected.clear(); save(); render();
  if (h.kind === 'person'){
    if (confirm(`${list.length} eszköz kiadva: ${person(h.id).name}.\n\nKészítsek átadás-átvételi jegyzőkönyvet ezekről?`)) docDialog(h.id, 'out', list.map(a => a.id));
  } else if (from.size === 1){
    const [pid, ids] = [...from][0];
    if (confirm(`${ids.length} eszköz visszavéve tőle: ${person(pid).name}.\n\nKészítsek visszavételi jegyzőkönyvet?`)) docDialog(pid, 'in', ids);
  }
}
function bulkStatus(){
  const s = $('#bulkStatus').value;
  if (!s){ alert('Válassz állapotot.'); return; }
  for (const a of [...selected].map(asset).filter(Boolean)) if (a.status !== s){ log(a.id, `Állapot: ${STATUS[a.status].label} → ${STATUS[s].label}`, 'updated'); a.status = s; }
  selected.clear(); save(); render();
}
function returnAll(pid){
  const ids = personAssets(pid).direct.map(a => a.id);
  if (!ids.length) return;
  selected.clear(); ids.forEach(id => selected.add(id));
  bulkMove('storage');
}
// a return from a person always asks first
function toStorage(id){
  const a = asset(id);
  const who = a.holder.kind === 'person' ? (person(a.holder.id) || {}).name : null;
  if (!confirm(who ? `Biztosan visszaveszed raktárba?\n\n${a.tag} · ${modelName(a)}\nJelenleg: ${who}` : `Biztosan raktárba teszed?\n\n${a.tag} · ${modelName(a)}\nJelenleg: ${whereText(a)}`)) return;
  setHolder(a, {kind:'storage'}); save(); render();
}
function quickMove(id){
  const a = asset(id), hs = $('#moveSel').value;
  if (!hs){ alert('Válassz célhelyet a listából.'); return; }
  const h = parseHolder(hs);
  if (holderKey(h) === holderKey(a.holder)){ toast('Az eszköz már itt van.'); return; }
  if (a.holder.kind === 'person' && !(h.kind === 'person') && !confirm(`Biztosan visszaveszed?\n\n${a.tag} – ${(person(a.holder.id) || {}).name}\nÚj hely: ${holderText(h)}`)) return;
  setHolder(a, h); save(); render();
}
function deleteAsset(id){
  const a = asset(id);
  if (!confirm(`Biztosan törlöd: ${a.tag}?\nAz Asset ID nem lesz újra kiosztva. (Selejtezéshez inkább állítsd az állapotot „Selejtezett”-re.)`)) return;
  for (const pr of db.projects) for (const x of pr.participants){
    if (x.computerId === id) x.computerId = null; if (x.monitorId === id) x.monitorId = null; if (x.monitor2Id === id) x.monitor2Id = null;
    x.otherIds = x.otherIds.filter(o => o !== id);
  }
  log(id, `Törölve: ${a.tag} (${modelName(a)})`, 'updated');
  db.assets = db.assets.filter(x => x.id !== id); save(); location.hash = '#/assets';
}

// ---------- asset page ----------
function viewAsset(id){
  const a = asset(id);
  if (!a) return `<div class="empty">Az eszköz nem található.</div>`;
  const hist = db.log.filter(l => l.assetId === id);
  const docs = db.docs.filter(d => d.items.some(i => i.assetId === id));
  const swaps = db.swaps.filter(s => s.oldId === id || s.newId === id);
  const img = assetImg(a), res = reservedBy(id);
  const fields = fieldsForType(a.type);
  return `
    <div class="row"><a href="#/assets">← Eszközök</a></div>
    <div class="row" style="margin-top:8px"><h1>${typeIcon(a.type)} <span class="aid">${esc(a.tag)}</span>${copyBtn(a.tag)}</h1><span class="spacer"></span>
      ${a.holder.kind !== 'storage' ? `<button onclick="swapDialog('${a.id}')">🔁 Csere</button>` : ''}
      <button onclick="assetForm(asset('${a.id}'))">✎ Szerkesztés</button>
      <button class="danger" onclick="deleteAsset('${a.id}')">Törlés</button></div>
    <div class="sub">${typeLink(a)} · ${modelLink(a)}${a.serial ? ` · S/N <span class="tag">${esc(a.serial)}</span>${copyBtn(a.serial)}` : ''}${a.legacyTag ? ` · régi azonosító: ${esc(a.legacyTag)}` : ''}</div>
    <div class="loc-box">Jelenleg: <b>${holderLink(a.holder)}</b>${a.placement ? `<br><span style="font-size:14px">${esc(placementText(a))} – <a href="#/room/${(desk(a.placement.deskId) || {}).roomId}/${a.placement.deskId}">megnyitás a floorplanon</a></span>` : ''}
      ${res ? `<br><span style="font-size:14px">📋 Projekthez foglalva: <a href="#/project/${res.project.id}">${esc(res.project.name)}</a> – ${esc((person(res.part.personId) || {}).name || '?')}${res.prep ? ` · <b>${esc(res.prep)}</b>` : ''} (még nincs kiadva)</span>` : ''}</div>
    <div class="row" style="margin-bottom:16px;align-items:flex-start">
      <span class="muted" style="padding-top:8px">Gyors áthelyezés:</span>
      <div style="min-width:320px;flex:0 1 420px">${picker('move', holderOptions(holderKey(a.holder)), {id:'moveSel', size:6})}</div>
      <button class="primary" onclick="quickMove('${a.id}')">Áthelyezés</button>
    </div>
    <div class="asset-head">
      ${img ? `<img class="photo" src="${img}" alt="${esc(modelName(a))}">` : `<div class="photo none" title="Nincs kép – a Szerkesztésnél tölthetsz fel">${typeIcon(a.type)}</div>`}
      <div class="card"><dl class="kv">
        <dt>Asset ID</dt><dd class="aid">${esc(a.tag)}</dd>
        <dt>Típus</dt><dd>${typeLink(a)}</dd>
        <dt>Modell</dt><dd>${modelLink(a)}</dd>
        <dt>Sorozatszám</dt><dd>${esc(a.serial) || '–'}</dd>
        <dt>Állapot</dt><dd>${statusPill(a.status)}</dd>
        <dt>Service</dt><dd>${a.serviceId ? `<a href="#/assets?service=${a.serviceId}">${esc(serviceName(a.serviceId))}</a>` : '–'}</dd>
        <dt>Megjegyzés</dt><dd style="white-space:pre-wrap">${esc(a.note) || '–'}</dd>
      </dl></div>
      <div class="card"><dl class="kv">
        <dt>Rendelés érkezett</dt><dd>${fmtDate(a.arrived)}</dd>
        <dt>Garancia vége</dt><dd>${a.warrantyUntil ? fmtDate(a.warrantyUntil) + ' ' + warrantyPill(a) : '–'}</dd>
        <dt>Beszállító</dt><dd>${esc(a.supplier) || '–'}</dd>
        <dt>Rendelés / számla</dt><dd>${esc(a.orderNo) || '–'}</dd>
        <dt>Felvéve</dt><dd>${a.created ? fmtTime(a.created) : '–'}</dd>
      </dl></div>
    </div>
    ${fields.length ? `<h2>Egyedi mezők <span class="muted" style="font-weight:400">(${esc([...new Set(fields.map(f => f.setName))].join(', '))})</span></h2>
      <div class="card"><dl class="kv">${fields.map(f => `<dt>${esc(f.name)}${f.required ? ' *' : ''}</dt><dd>${esc(fieldValueText(f, a.custom[f.id]))}</dd>`).join('')}</dl></div>` : ''}
    ${swaps.length ? `<h2>🔁 Cserék</h2>${swapTable(swaps)}` : ''}
    ${docs.length ? `<h2>📄 Jegyzőkönyvek, amelyeken szerepel</h2>${docTable(docs, true)}` : ''}
    <h2>Előzmények</h2>
    ${logTable(hist, {noSubject:true})}`;
}

// ---------- asset form ----------
function customInputs(typeId, values){
  const fields = fieldsForType(typeId);
  if (!fields.length) return '<p class="muted" style="font-size:12px">Ehhez a típushoz nincs mezőcsoport rendelve (Settings → Custom Field Sets).</p>';
  let set = '';
  return fields.map(f => {
    const v = values[f.id], name = 'cf_' + f.id, req = f.required && f.kind !== 'bool' ? ' required' : '';
    const head = f.setName !== set ? `<div class="muted" style="font-size:11px;margin-top:10px;text-transform:uppercase;letter-spacing:.05em">${esc(set = f.setName)}</div>` : '';
    let inp;
    if (f.kind === 'bool') inp = `<label class="cb" style="margin:6px 0"><input type="checkbox" name="${name}"${v ? ' checked' : ''}> ${esc(f.name)}</label>`;
    else if (f.kind === 'select') inp = `<label class="f">${esc(f.name)}${f.required ? ' *' : ''}</label><select name="${name}"${req}><option value="">–</option>${f.options.map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else inp = `<label class="f">${esc(f.name)}${f.required ? ' *' : ''}</label><input name="${name}" type="${f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : 'text'}"${f.kind === 'number' ? ' step="any"' : ''} value="${esc(v ?? '')}"${req}>`;
    return head + inp;
  }).join('');
}
function readCustom(typeId, form, prev){
  const out = {...prev};
  for (const f of fieldsForType(typeId)){
    const el = form.elements['cf_' + f.id];
    if (!el) continue;
    out[f.id] = f.kind === 'bool' ? el.checked : f.kind === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value.trim();
  }
  return out;
}
function modelOptions(typeId, cur){
  return sortHu(db.models.filter(m => m.typeId === typeId), m => m.name).map(m => `<option value="${m.id}"${m.id === cur ? ' selected' : ''}>${esc(m.name)}</option>`).join('') +
    '<option value="__new">＋ Új modell…</option>';
}
function assetForm(a, presetHolder, presetType){
  const isNew = !a;
  const t0 = presetType && db.types.some(t => t.id === presetType) ? presetType : 'monitor';
  a = a || {type:t0, modelId:'', serial:'', status:'ok', holder:presetHolder || {kind:'storage'}, serviceId:null, custom:{}, note:'',
    arrived:todayIso(), warrantyUntil:'', supplier:'', orderNo:'', legacyTag:''};
  const preview = fmtAssetId(Math.max(db.seq.asset || 0, ...db.assets.map(x => assetNum(x.tag)), 0) + 1);
  const curImg = assetImg(a);
  let pendingImg = null, custom = {...a.custom};
  openDialog(`
    <h3>${isNew ? 'Új eszköz' : 'Eszköz szerkesztése'}</h3>
    <div class="two">
      <div><label class="f">Asset ID</label><input value="${isNew ? preview + ' (automatikus)' : esc(a.tag)}" disabled class="aid"></div>
      <div><label class="f">Régi azonosító / matrica (opcionális)</label><input name="legacyTag" value="${esc(a.legacyTag || '')}"></div>
      <div><label class="f">Típus</label><select name="type" id="fType">${sortHu(db.types, t => t.name).map(t => `<option value="${esc(t.id)}"${t.id === a.type ? ' selected' : ''}>${t.icon} ${esc(t.name)}</option>`).join('')}</select></div>
      <div><label class="f">Modell</label><select name="modelId" id="fModel">${modelOptions(a.type, a.modelId)}</select>
        <input name="newModel" id="fNewModel" placeholder="Új modell neve, pl. Dell P2422H" style="display:none;margin-top:4px"></div>
      <div><label class="f">Sorozatszám</label><input name="serial" value="${esc(a.serial)}"></div>
      <div><label class="f">Állapot</label><select name="status">${Object.entries(STATUS).map(([k, s]) => `<option value="${k}"${k === a.status ? ' selected' : ''}>${s.label}</option>`).join('')}</select></div>
      <div><label class="f">Service (opcionális)</label><select name="serviceId">${selOpts(sortHu(db.services, s => s.name), a.serviceId, s => s.name, '–')}</select></div>
    </div>
    <label class="f">Hol van / kinél van?</label>
    ${picker('holder', holderOptions(holderKey(a.holder)), {size:5})}
    <h3 style="margin-top:18px;font-size:14px">Egyedi mezők</h3>
    <div id="fCustom">${customInputs(a.type, custom)}</div>
    <h3 style="margin-top:18px;font-size:14px">Beszerzés & garancia</h3>
    <div class="two">
      <div><label class="f">Rendelés érkezése</label><input name="arrived" id="fArrived" type="date" value="${esc(a.arrived || '')}"></div>
      <div><label class="f">Garancia vége</label><input name="warrantyUntil" id="fWarr" type="date" value="${esc(a.warrantyUntil || '')}"></div>
      <div><label class="f">Beszállító</label><input name="supplier" value="${esc(a.supplier || '')}"></div>
      <div><label class="f">Rendelés / számla száma</label><input name="orderNo" value="${esc(a.orderNo || '')}"></div>
    </div>
    <div class="row" style="margin-top:6px"><span class="muted" style="font-size:12px">Garancia az érkezéstől:</span>
      ${[1, 2, 3, 5].map(y => `<button type="button" class="sm" data-wy="${y}">${y} év</button>`).join('')}</div>
    <h3 style="margin-top:18px;font-size:14px">Kép (a modellhez tartozik)</h3>
    <div class="row"><img id="fImgPrev" class="thumb" style="width:64px;height:64px;${curImg ? '' : 'display:none'}" src="${curImg || ''}" alt="">
      <input type="file" id="fImg" accept="image/*" style="flex:1;min-width:200px"></div>
    <p class="muted" style="font-size:12px;margin:4px 0 0">A kép a kiválasztott modell minden eszközénél megjelenik.</p>
    <label class="f">Megjegyzés</label><textarea name="note" style="width:100%">${esc(a.note)}</textarea>
    ${dlgActions(isNew ? 'Létrehozás' : 'Mentés')}`,
    (data, form) => {
      let modelId = data.modelId;
      if (modelId === '__new'){
        const nm = (data.newModel || '').trim();
        if (!nm){ alert('Add meg az új modell nevét.'); return false; }
        const ex = db.models.find(m => m.typeId === data.type && norm(m.name) === norm(nm));
        modelId = ex ? ex.id : (db.models.push({id:uid(), typeId:data.type, name:nm, imageId:null}), db.models[db.models.length - 1].id);
      }
      if (!modelId){ alert('Válassz vagy hozz létre modellt.'); return false; }
      const newCustom = readCustom(data.type, form, custom);
      const fields = {type:data.type, modelId, serial:data.serial.trim(), status:data.status, serviceId:data.serviceId || null, note:data.note,
        arrived:data.arrived, warrantyUntil:data.warrantyUntil, supplier:data.supplier.trim(), orderNo:data.orderNo.trim(), legacyTag:data.legacyTag.trim(), custom:newCustom};
      if (fields.serial && db.assets.some(x => x.id !== a.id && x.serial && norm(x.serial) === norm(fields.serial)) &&
        !confirm(`Már van eszköz ezzel a sorozatszámmal: ${fields.serial}. Mégis mented?`)) return false;
      let target = a;
      if (isNew){
        target = {id:uid(), tag:nextAssetId(), ...fields, holder:parseHolder(data.holder), placement:null, created:Date.now(), assignedAt:null};
        db.assets.push(target);
        log(target.id, `Létrehozva: ${target.tag} · ${typeLabel(target.type)} · ${modelName(target)}`, 'created');
        const h = target.holder; target.holder = {kind:'storage'};
        if (h.kind !== 'storage') setHolder(target, h);
      } else {
        const changes = [];
        const lbl = {type:'Típus', modelId:'Modell', serial:'Sorozatszám', serviceId:'Service', supplier:'Beszállító', orderNo:'Rendelés', arrived:'Érkezés', warrantyUntil:'Garancia', legacyTag:'Régi azonosító', note:'Megjegyzés'};
        const show = (k, v) => k === 'type' ? typeLabel(v) : k === 'modelId' ? (model(v) || {}).name : k === 'serviceId' ? serviceName(v) : v;
        for (const k of Object.keys(lbl)) if ((a[k] || '') !== (fields[k] || '')) changes.push(`${lbl[k]}: ${show(k, a[k]) || '–'} → ${show(k, fields[k]) || '–'}`);
        const fl = fieldsForType(fields.type).filter(f => String(a.custom[f.id] ?? '') !== String(newCustom[f.id] ?? ''));
        if (fl.length) changes.push('Egyedi mezők: ' + fl.map(f => f.name).join(', '));
        if (a.status !== data.status) log(a.id, `Állapot: ${STATUS[a.status].label} → ${STATUS[data.status].label}`, 'updated');
        Object.assign(a, fields);
        if (changes.length) log(a.id, 'Módosítva – ' + changes.join('; '), 'updated');
        setHolder(a, parseHolder(data.holder));
      }
      if (pendingImg){ const iid = uid(); db.images[iid] = pendingImg; model(target.modelId).imageId = iid; }
      save(); render();
    });
  const syncModel = () => { $('#fNewModel').style.display = $('#fModel').value === '__new' ? '' : 'none'; };
  $('#fModel').addEventListener('change', syncModel);
  $('#fType').addEventListener('change', e => {
    custom = readCustom(a.type, $('#dlgForm'), custom); a = {...a, type:e.target.value};
    $('#fModel').innerHTML = modelOptions(e.target.value, '');
    if ($('#fModel').options.length === 1) $('#fModel').value = '__new';
    syncModel();
    $('#fCustom').innerHTML = customInputs(e.target.value, custom);
  });
  if (!a.modelId && $('#fModel').options.length === 1) $('#fModel').value = '__new';
  syncModel();
  $('#fImg').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    $('#dlgOk').disabled = true;
    try { pendingImg = await resizeImage(f); $('#fImgPrev').src = pendingImg; $('#fImgPrev').style.display = ''; }
    catch(err){ alert(err.message); e.target.value = ''; }
    $('#dlgOk').disabled = false;
  });
  document.querySelectorAll('[data-wy]').forEach(b => b.addEventListener('click', () => {
    const base = $('#fArrived').value; if (!base){ alert('Előbb add meg az érkezés dátumát.'); return; }
    const d = new Date(base); d.setFullYear(d.getFullYear() + +b.dataset.wy); $('#fWarr').value = d.toISOString().slice(0, 10);
  }));
}

// pick an existing asset and move it to holder h (person page "issue existing asset")
function assignAssetDialog(h, title){
  const key = holderKey(h);
  const cands = sortHu(db.assets.filter(a => holderKey(a.holder) !== key && a.status !== 'retired'), a => (a.holder.kind === 'storage' ? '0' : '1') + a.tag);
  if (!cands.length){ alert('Nincs áthelyezhető eszköz. Hozz létre egy újat!'); return; }
  openDialog(`<h3>${esc(title)}</h3><p class="muted" style="margin:0 0 6px">Célhely: <b>${esc(holderText(h))}</b></p>
    <label class="f">Eszköz</label>${picker('asset', cands.map(a => `<option value="${a.id}">${typeIcon(a.type)} ${esc(a.tag)} · ${esc(modelName(a))} · ${esc(a.serial)} — ${esc(whereText(a))}</option>`).join(''), {size:10, required:true})}
    ${dlgActions('Kiadás / áthelyezés')}`,
    data => {
      const a = asset(data.asset); if (!a){ alert('Válassz eszközt!'); return false; }
      setHolder(a, h); save(); render();
    });
}

// ---------- swap ----------
function swapDialog(oldId){
  const old = asset(oldId);
  if (old.holder.kind === 'storage'){ alert('Raktárban lévő eszközt nem kell cserélni – csere csak kiadott eszköznél van.'); return; }
  const cands = sortHu(db.assets.filter(a => a.holder.kind === 'storage' && a.status === 'ok' && !reservedBy(a.id)), a => (a.type === old.type ? '0' : '1') + a.tag);
  if (!cands.length){ alert('Nincs szabad, működő eszköz a raktárban. Előbb vegyél fel egy új eszközt a raktárba, utána végezd el a cserét.'); return; }
  const owner = holderPerson(old.holder), hasSame = cands.some(a => a.type === old.type);
  openDialog(`
    <h3>🔁 Eszközcsere</h3>
    <div class="loc-box" style="font-size:14px;margin-top:4px">Lecserélendő: ${assetIcon(old)} <b class="aid">${esc(old.tag)}</b> · ${esc(typeLabel(old.type))} · ${esc(modelName(old))}<br>
      <small class="muted">${esc(whereText(old))}</small></div>
    <div class="two">
      <div><label class="f">Csere oka</label><select name="reason" id="swReason">${Object.entries(SWAP_REASONS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div><label class="f">A lecserélt eszköz új állapota</label><select name="oldStatus" id="swStatus">${Object.entries(STATUS).map(([k, s]) => `<option value="${k}"${k === 'repair' ? ' selected' : ''}>${s.label}</option>`).join('')}</select></div>
    </div>
    <label class="f">Hiba leírása / megjegyzés</label><textarea name="note" style="width:100%" placeholder="pl. nem kapcsol be, csíkos a kép"></textarea>
    <label class="f">Csereeszköz (működő, raktáron lévő)</label>
    <label class="cb" style="margin:4px 0"><input type="checkbox" id="swSame"${hasSame ? ' checked' : ''}> Csak azonos típus (${esc(typeLabel(old.type))})</label>
    <select name="newId" id="swSel" size="7" required style="width:100%">${cands.map(a =>
      `<option value="${a.id}" data-type="${esc(a.type)}">${typeIcon(a.type)} ${esc(a.tag)} · ${esc(modelName(a))} · ${esc(a.serial)}</option>`).join('')}</select>
    <div class="two">
      <div><label class="f">Dátum</label><input type="date" name="date" required value="${todayIso()}"></div>
      <div><label class="f">Átadó (IT) neve</label><input name="handler" value="${esc(db.settings.handler)}"></div>
    </div>
    ${owner ? `<label class="cb"><input type="checkbox" name="mkdoc" checked> Csere jegyzőkönyv készítése – ${esc(person(owner).name)}</label>` : '<p class="muted" style="font-size:12px">Közös / gazdátlan helyen lévő eszköz – jegyzőkönyv nem készül, a csere a nyilvántartásban rögzül.</p>'}
    ${dlgActions('Csere végrehajtása')}`,
    data => {
      const nw = asset(data.newId);
      if (!nw){ alert('Válaszd ki a csereeszközt.'); return false; }
      const where = whereText(old), h = old.holder, place = old.placement, reason = SWAP_REASONS[data.reason];
      setHolder(nw, h);
      if (place) nw.placement = {...place};
      setHolder(old, {kind:'storage'});
      if (old.status !== data.oldStatus){ log(old.id, `Állapot: ${STATUS[old.status].label} → ${STATUS[data.oldStatus].label}`, 'updated'); old.status = data.oldStatus; }
      log(old.id, `🔁 Lecserélve erre: ${nw.tag} – ${reason}${data.note.trim() ? ': ' + data.note.trim() : ''}`, 'returned');
      log(nw.id, `🔁 Csereeszközként kiadva ${old.tag} helyett (${where})`, 'checkout');
      const sw = {id:uid(), ts:Date.now(), date:data.date, oldId:old.id, newId:nw.id, oldTag:old.tag, newTag:nw.tag,
        reason, note:data.note.trim(), oldStatus:data.oldStatus, where, personId:owner, docId:null};
      db.swaps.unshift(sw);
      let doc = null;
      if (owner && data.mkdoc){
        doc = createDoc(owner, 'swap', [], {date:data.date, handler:data.handler.trim(), note:data.note.trim(), reason,
          items:[{...snapAsset(nw), role:'out'}, {...snapAsset(old), role:'in'}], swapId:sw.id});
        sw.docId = doc.id;
      }
      save(); render();
      if (doc) printDoc(doc.id);
    });
  const filt = () => {
    const same = $('#swSame').checked, sel = $('#swSel');
    for (const o of sel.options) o.hidden = same && o.dataset.type !== old.type;
    if (!sel.selectedOptions[0] || sel.selectedOptions[0].hidden){ const first = [...sel.options].find(o => !o.hidden); if (first) sel.value = first.value; }
  };
  $('#swSame').addEventListener('change', filt); filt();
  $('#swReason').addEventListener('change', e => { $('#swStatus').value = {lost:'lost', upgrade:'ok'}[e.target.value] || 'repair'; });
}
function swapTable(list, opts = {}){
  if (!list.length) return '<div class="empty">Még nem volt csere.</div>';
  const tagLink = (id, tag) => asset(id) ? `<a class="tag" href="#/asset/${id}">${esc(asset(id).tag)}</a>` : `<span class="tag">${esc(tag)}</span>`;
  return `<div class="tbl-wrap"><table><thead><tr><th>Dátum</th>${opts.noWhere ? '' : '<th>Kinél / hol</th>'}<th>Lecserélt eszköz</th><th></th><th>Csereeszköz</th><th>Ok</th><th>Lecserélt most</th><th>Jegyzőkönyv</th></tr></thead><tbody>${list.map(s => {
    const o = asset(s.oldId), d = s.docId && byId(db.docs, s.docId);
    return `<tr><td style="white-space:nowrap">${fmtDate(s.date)}</td>
      ${opts.noWhere ? '' : `<td>${s.personId && person(s.personId) ? personLink(s.personId) : esc(s.where)}</td>`}
      <td>${tagLink(s.oldId, s.oldTag)}</td><td>➜</td><td>${tagLink(s.newId, s.newTag)}</td>
      <td>${esc(s.reason)}${s.note ? `<br><small class="muted">${esc(s.note)}</small>` : ''}</td>
      <td>${o ? statusPill(o.status) + `<br><small class="muted">${esc(whereText(o))}</small>` : '<span class="muted">törölve</span>'}</td>
      <td>${d ? `<span class="tag">${esc(d.no)}</span> ${d.fileId ? '<span class="pill ok">✔</span>' : '<span class="pill warn">aláírásra vár</span>'}` : '<span class="muted">–</span>'}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

// ---------- CSV export ----------
function exportCSV(){
  const fsFields = db.fieldSets.flatMap(s => s.fields.filter(f => f.active).map(f => ({...f, setName:s.name})));
  const rows = [['Asset ID', 'Régi azonosító', 'Típus', 'Modell', 'Sorozatszám', 'Állapot', 'Hely típusa', 'Hol van', 'Asztalon (Hybrid)', 'Személy', 'Service',
    'Érkezett', 'Garancia vége', 'Beszállító', 'Rendelés/számla', 'Megjegyzés', ...fsFields.map(f => `${f.setName}: ${f.name}`)]];
  for (const a of sortHu(db.assets, a => a.tag)){
    const who = holderPerson(a.holder);
    rows.push([a.tag, a.legacyTag, typeLabel(a.type), modelName(a), a.serial, STATUS[a.status].label, LOC_LABEL[a.holder.kind].replace(/^\S+\s/, ''),
      holderText(a.holder).replace(/^\S+\s/, ''), placementText(a).replace(/^\S+\s/, ''), who ? (person(who) || {}).name : '', serviceName(a.serviceId),
      a.arrived, a.warrantyUntil, a.supplier, a.orderNo, a.note, ...fsFields.map(f => fsFields && fieldsForType(a.type).some(x => x.id === f.id) ? fieldValueText(f, a.custom[f.id]).replace(/^–$/, '') : '')]);
  }
  download(`it-eszkozok-${stamp()}.csv`, '﻿' + rows.map(csvLine).join('\r\n'), 'text/csv');
}

// ---------- import helpers (shared with the people import) ----------
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
let xlsxP;
const loadXLSX = () => xlsxP ||= new Promise((res, rej) => {
  if (window.XLSX) return res(window.XLSX);
  const s = document.createElement('script'); s.src = XLSX_URL;
  s.onload = () => res(window.XLSX);
  s.onerror = () => { xlsxP = null; s.remove(); rej(new Error('Az Excel-kezelő nem tölthető be (nincs internetkapcsolat?). CSV fájl ettől függetlenül importálható.')); };
  document.head.appendChild(s);
});
const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function toISO(v){
  if (v instanceof Date && !isNaN(v)) return isoLocal(v);
  if (typeof v === 'number' && v > 20000 && v < 80000) return isoLocal(new Date(Math.round((v - 25569) * 864e5)));
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})[.\-/ ]+(\d{1,2})[.\-/ ]+(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  if (m){ const [x, y] = +m[1] > 12 ? [m[2], m[1]] : [m[1], m[2]]; return `${m[3]}-${x.padStart(2, '0')}-${y.padStart(2, '0')}`; }
  return '';
}
function parseCSV(text){
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0];
  const delim = [';', '\t', ','].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i];
    if (q){ if (c === '"'){ if (text[i + 1] === '"'){ cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim){ row.push(cur); cur = ''; }
    else if (c === '\n'){ row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur || row.length){ row.push(cur); rows.push(row); }
  return rows;
}
// Excel or CSV → {headers, rows}
async function readTable(file, preferSheet){
  const buf = await file.arrayBuffer();
  let rows;
  if (/\.(csv|txt)$/i.test(file.name)){
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('windows-1250').decode(buf); // Excel's Hungarian CSV
    rows = parseCSV(text);
  } else {
    const X = await loadXLSX();
    const wb = X.read(buf, {type:'array', cellDates:true});
    const name = wb.SheetNames.find(n => norm(n) === norm(preferSheet || '')) || wb.SheetNames.find(n => !/útmutató/i.test(n)) || wb.SheetNames[0];
    rows = X.utils.sheet_to_json(wb.Sheets[name], {header:1, raw:true, defval:''});
  }
  rows = rows.filter(r => r.some(c => String(c ?? '').trim()));
  const hi = rows.findIndex(r => r.filter(c => String(c ?? '').trim()).length >= 2);
  if (hi < 0 || rows.length <= hi + 1) throw new Error('Nem találtam fejlécet és adatsorokat a fájlban.');
  return {headers: rows[hi].map(h => String(h ?? '').trim()), rows: rows.slice(hi + 1)};
}
// guess which column holds which field: exact header name first, then a partial match; aliases are in priority order
function guessColumns(headers, fields){
  const map = {}, used = new Set(), clean = h => norm(h).replace(/\*/g, '').trim();
  for (const exact of [true, false]) for (const f of fields){
    if (map[f.key] >= 0) continue;
    let i = -1;
    for (const a of f.aliases){
      i = headers.findIndex((h, j) => !used.has(j) && (exact ? clean(h) === norm(a) : a.length > 4 && clean(h).includes(norm(a))));
      if (i >= 0) break;
    }
    map[f.key] = i; if (i >= 0) used.add(i);
  }
  return map;
}
const mapSelect = (f, headers, map, attr = 'data-map') => `<select ${attr}="${f.key}" style="width:100%"><option value="-1">– nincs –</option>${headers.map((h, i) =>
  `<option value="${i}"${map[f.key] === i ? ' selected' : ''}>${esc(h || '(oszlop ' + (i + 1) + ')')}</option>`).join('')}</select>`;

// ---------- asset import (Excel / CSV / Snipe-IT export) ----------
const IMPORT_FIELDS = [
  {key:'legacy',         label:'Régi ID / matrica',   aliases:['régi id / matrica', 'régi id', 'eszköz id', 'asset tag', 'asset_tag', 'leltári szám', 'tag']},
  {key:'type',           label:'Típus',               aliases:['típus', 'category', 'kategória', 'type', 'asset category']},
  {key:'manufacturer',   label:'Gyártó',              aliases:['gyártó', 'manufacturer']},
  {key:'model',          label:'Modell',              aliases:['modell', 'gyártó / modell', 'model', 'model name', 'asset model']},
  {key:'serial',         label:'Sorozatszám',         aliases:['sorozatszám', 'serial', 'serial number', 's/n']},
  {key:'status',         label:'Állapot',             aliases:['állapot', 'status', 'status label']},
  {key:'holder',         label:'Kinél / hol van',     aliases:['kinél / hol', 'kinél', 'checked out to', 'assigned to', 'assigned_to', 'kiadva']},
  {key:'email',          label:'Személy e-mail',      aliases:['személy e-mail', 'e-mail', 'email', 'user email']},
  {key:'service',        label:'Service',             aliases:['service', 'szolgáltatás', 'team', 'csapat', 'department']},
  {key:'location',       label:'Hely (location)',     aliases:['location', 'hely', 'helyszín', 'default location']},
  {key:'arrived',        label:'Rendelés érkezése',   aliases:['rendelés érkezése', 'érkezés', 'purchase date', 'beszerzés dátuma']},
  {key:'warrantyUntil',  label:'Garancia vége',       aliases:['garancia vége', 'warranty expires', 'warranty expiration', 'warranty_expires']},
  {key:'warrantyMonths', label:'Garancia (hónap)',    aliases:['garancia (hónap)', 'warranty', 'warranty months']},
  {key:'supplier',       label:'Beszállító',          aliases:['beszállító', 'supplier']},
  {key:'orderNo',        label:'Rendelés / számla',   aliases:['rendelés / számla száma', 'order number', 'invoice', 'számla']},
  {key:'note',           label:'Megjegyzés',          aliases:['megjegyzés', 'notes', 'note', 'asset name', 'name']},
];
const TYPE_WORDS = [
  ['monitor', ['monitor', 'display', 'kijelző', 'képernyő']], ['headset', ['headset', 'headphone', 'fejhallgató', 'fülhallgató']],
  ['dock', ['dock', 'dokkoló']], ['keyboard', ['keyboard', 'mouse', 'billentyű', 'egér']], ['phone', ['phone', 'mobile', 'telefon', 'iphone']],
  ['printer', ['printer', 'nyomtató']], ['switch', ['switch']], ['router', ['router', 'firewall', 'tűzfal', 'fortigate']],
  ['server', ['server', 'szerver']], ['ups', ['ups', 'szünetmentes']],
  ['pc', ['laptop', 'notebook', 'desktop', 'computer', 'számítógép', 'pc', 'workstation', 'thinkpad', 'latitude', 'elitebook', 'macbook']],
];
// known type id, or {newType: name} when the file names a type we do not have yet
function resolveType(v, mdl){
  const n = norm(v);
  for (const t of db.types) if (n && (n === norm(t.id) || n === norm(t.name))) return {id:t.id};
  const hay = norm(v + ' ' + mdl);
  for (const [k, ws] of TYPE_WORDS) if (db.types.some(t => t.id === k) && ws.some(w => hay.includes(norm(w)))) return {id:k};
  return n ? {newType:String(v).trim()} : {id:'other'};
}
function parseStatus(v){
  const n = norm(v);
  if (!n) return '';
  if (/javit|repair|broken|hibas/.test(n)) return 'repair';
  if (/lost|stolen|elvesz|lopott/.test(n)) return 'lost';
  if (/archiv|retire|selejt|dispos/.test(n)) return 'retired';
  return 'ok';
}
let imp = null;
async function readImportFile(file){
  try {
    const t = await readTable(file, 'Eszközök');
    imp = {fileName:file.name, headers:t.headers, rows:t.rows, map:guessColumns(t.headers, IMPORT_FIELDS), createPeople:true};
    render();
  } catch(e){ alert('Nem sikerült beolvasni: ' + e.message); }
}
function findDeskByText(t){
  const [a, b] = t.split(/\s*[/›>]\s*/);
  if (!b) return null;
  const r = db.rooms.find(r => norm(r.name).startsWith(norm(a))) || db.rooms.find(r => norm(r.name).includes(norm(a)));
  return r && db.desks.find(k => k.roomId === r.id && norm(k.label) === norm(b)) || null;
}
function findRoomByText(t){
  const n = norm(t.replace(/^iroda\s*:\s*/i, ''));
  return n ? db.rooms.find(r => norm(r.name) === n || norm(r.name).startsWith(n + ' ')) || null : null;
}
function resolveHolder(text, email, loc){
  const byMail = email && db.people.find(p => p.email && norm(p.email) === norm(email));
  if (byMail) return {h:{kind:'person', id:byMail.id}};
  if (!text || /^(raktar|storage|-)$/.test(norm(text))){
    const k = loc && findDeskByText(loc), r = loc && findRoomByText(loc);
    return k ? {h:{kind:'desk', id:k.id}, usedLoc:true} : r ? {h:{kind:'office', id:r.id}, usedLoc:true} : {h:{kind:'storage'}};
  }
  const p = db.people.find(p => norm(p.name) === norm(text) || (p.email && norm(p.email) === norm(text)));
  if (p) return {h:{kind:'person', id:p.id}};
  const k = findDeskByText(text); if (k) return {h:{kind:'desk', id:k.id}};
  const r = findRoomByText(text); if (r) return {h:{kind:'office', id:r.id}};
  if (imp.createPeople) return {newPerson:{name:text, email:email || ''}};
  return {h:{kind:'storage'}, unknown:text};
}
function planImport(){
  return imp.rows.map(r => {
    const s = k => { const i = imp.map[k]; return i >= 0 ? String(r[i] ?? '').trim() : ''; };
    const raw = k => { const i = imp.map[k]; return i >= 0 ? r[i] : ''; };
    let mdl = s('model');
    const man = s('manufacturer');
    if (man && !norm(mdl).startsWith(norm(man))) mdl = (man + ' ' + mdl).trim();
    const type = resolveType(s('type'), mdl), arrived = toISO(raw('arrived'));
    let warrantyUntil = toISO(raw('warrantyUntil'));
    const months = parseInt(s('warrantyMonths'), 10);
    if (!warrantyUntil && months && arrived){ const d = new Date(arrived); d.setMonth(d.getMonth() + months); warrantyUntil = isoLocal(d); }
    const loc = s('location'), holder = resolveHolder(s('holder'), s('email'), loc);
    const svc = s('service') && db.services.find(x => norm(x.name) === norm(s('service')));
    const note = [s('note'), loc && !holder.usedLoc ? 'Hely (import): ' + loc : '', holder.unknown ? 'Kinél (import): ' + holder.unknown : '',
      s('service') && !svc ? 'Service (import, ismeretlen): ' + s('service') : ''].filter(Boolean).join('\n');
    const dupSerial = s('serial') && db.assets.find(a => a.serial && norm(a.serial) === norm(s('serial')));
    let action = 'new';
    if (!mdl && !s('serial') && !s('legacy')) action = 'empty';
    else if (dupSerial) action = 'dup';
    return {legacy:s('legacy'), type, model:mdl || 'Ismeretlen modell', serial:s('serial'), status:parseStatus(s('status')) || 'ok', holder, serviceId:svc ? svc.id : null,
      arrived, warrantyUntil, supplier:s('supplier'), orderNo:s('orderNo'), note, action, dupSerial};
  });
}
const planWhere = p => p.holder.newPerson ? `👤 ${p.holder.newPerson.name} (új személy)` : holderText(p.holder.h) + (p.holder.unknown ? ` (ismeretlen: ${p.holder.unknown})` : '');
const PLAN_LABEL = {new:'<span class="pill ok">Új</span>', dup:'<span class="pill warn">Kihagy – S/N már létezik</span>', empty:'<span class="pill">Üres sor</span>'};
function runImport(){
  const plan = planImport(), people = new Map(), types = new Map();
  let created = 0, skipped = 0;
  for (const p of plan){
    if (p.action !== 'new'){ skipped++; continue; }
    let h = p.holder.h;
    if (p.holder.newPerson){
      const k = norm(p.holder.newPerson.name);
      let np = people.get(k);
      if (!np){ np = {id:uid(), name:p.holder.newPerson.name, email:p.holder.newPerson.email, serviceId:p.serviceId, roleId:null, mode:'Onsite', note:'Importálva: ' + imp.fileName}; db.people.push(np); people.set(k, np); }
      h = {kind:'person', id:np.id};
    }
    let typeId = p.type.id;
    if (!typeId){
      const k = norm(p.type.newType);
      if (!types.has(k)){ const t = {id:uid(), name:p.type.newType, icon:'📦'}; db.types.push(t); types.set(k, t.id); }
      typeId = types.get(k);
    }
    let m = db.models.find(x => x.typeId === typeId && norm(x.name) === norm(p.model));
    if (!m){ m = {id:uid(), typeId, name:p.model, imageId:null}; db.models.push(m); }
    const a = {id:uid(), tag:nextAssetId(), legacyTag:p.legacy, type:typeId, modelId:m.id, serial:p.serial, status:p.status, holder:{kind:'storage'}, placement:null,
      serviceId:p.serviceId, custom:{}, arrived:p.arrived, warrantyUntil:p.warrantyUntil, supplier:p.supplier, orderNo:p.orderNo, note:p.note, created:Date.now(), assignedAt:null};
    db.assets.push(a); log(a.id, `Importálva (${imp.fileName}): ${a.tag} · ${modelName(a)}`, 'created'); created++;
    if (h.kind !== 'storage') setHolder(a, h);
  }
  save();
  alert(`Import kész.\n\nÚj eszköz: ${created} (Asset ID-k automatikusan kiosztva)\nKihagyva: ${skipped}\nÚj személy: ${people.size}\nÚj típus: ${types.size}`);
  imp = null; location.hash = '#/assets';
}
function viewImport(){
  let body = '';
  if (imp){
    const plan = planImport(), cnt = k => plan.filter(p => p.action === k).length;
    const newPeople = new Set(plan.filter(p => p.action === 'new' && p.holder.newPerson).map(p => norm(p.holder.newPerson.name))).size;
    const newTypes = [...new Set(plan.filter(p => p.action === 'new' && p.type.newType).map(p => p.type.newType))];
    body = `
      <h2>2. Oszlopok párosítása – ${esc(imp.fileName)} (${imp.rows.length} sor)</h2>
      <div class="card"><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:4px 16px">
        ${IMPORT_FIELDS.map(f => `<div><label class="f">${f.label}</label>${mapSelect(f, imp.headers, imp.map)}</div>`).join('')}</div>
        <label class="cb"><input type="checkbox" id="impPeople"${imp.createPeople ? ' checked' : ''}> Ismeretlen nevekhez új személy létrehozása (különben raktárba kerül, a név a megjegyzésbe)</label>
        <p class="muted" style="font-size:12px;margin:0">Az Asset ID-t (HU……) a program osztja ki; a fájlban lévő régi azonosító a „Régi azonosító” mezőbe kerül.</p>
      </div>
      <h2>3. Előnézet</h2>
      <p>${PLAN_LABEL.new} ${cnt('new')} &nbsp; Kihagy: ${cnt('dup') + cnt('empty')} &nbsp; · Új személy: ${newPeople}${newTypes.length ? ` · Új típus: ${newTypes.map(esc).join(', ')}` : ''}</p>
      <div class="tbl-wrap"><table><thead><tr><th>Művelet</th><th>Régi ID</th><th>Típus</th><th>Modell</th><th>Sorozatszám</th><th>Állapot</th><th>Hova kerül</th><th>Érkezett</th><th>Garancia</th></tr></thead><tbody>
        ${plan.slice(0, 50).map(p => `<tr><td>${PLAN_LABEL[p.action]}</td><td class="tag">${esc(p.legacy) || '<span class="muted">–</span>'}</td>
          <td>${p.type.id ? typeIcon(p.type.id) + ' ' + esc(typeLabel(p.type.id)) : '📦 ' + esc(p.type.newType) + ' <span class="pill warn">új típus</span>'}</td>
          <td>${esc(p.model)}</td><td class="muted">${esc(p.serial)}</td><td>${statusPill(p.status)}</td><td>${esc(planWhere(p))}</td><td>${fmtDate(p.arrived)}</td><td>${fmtDate(p.warrantyUntil)}</td></tr>`).join('')}
      </tbody></table></div>
      ${plan.length > 50 ? `<p class="muted">… és még ${plan.length - 50} sor.</p>` : ''}
      <div class="row" style="margin-top:14px"><button class="primary" id="impRun" onclick="runImport()"${cnt('new') ? '' : ' disabled'}>⬆ Importálás (${cnt('new')} eszköz)</button>
        <button onclick="imp=null;render()">Mégse</button></div>`;
  }
  return `
    <div class="row"><a href="#/assets">← Eszközök</a></div>
    <h1 style="margin-top:8px">Eszközök importálása Excelből / CSV-ből</h1>
    <div class="sub">Nagyobb rendelés felvitele, vagy átköltözés Snipe-IT-ból. (Személyek importja: Emberek → ⬆ Importálás.)</div>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">
      <div class="card"><b>📄 Saját Excel sablon</b>
        <p class="muted">Töltsd le a sablont, írd bele a rendelés tételeit (soronként egy eszköz), majd töltsd be lent. Az Asset ID-t a program osztja ki.</p>
        <div class="row"><button class="primary" onclick="downloadTemplate()">⬇ Excel sablon (.xlsx)</button><button onclick="downloadCSVTemplate()">⬇ CSV sablon</button></div></div>
      <div class="card"><b>🔄 Átköltözés Snipe-IT-ból</b>
        <ol class="muted" style="padding-left:18px;margin:8px 0 0">
          <li>Snipe-IT: <b>Assets → All</b>, oszlopok: Asset Tag, Model, Manufacturer, Category, Serial, Status, Checked Out To, Location, Purchase Date, Warranty, Supplier, Order Number, Notes.</li>
          <li><b>Export</b> CSV-be vagy Excelbe.</li>
          <li>Töltsd be itt – a Snipe-IT oszlopneveket a program felismeri.</li>
        </ol></div>
    </div>
    <h2>1. Fájl kiválasztása</h2>
    <div class="card row"><input type="file" id="impFile" accept=".xlsx,.xls,.csv,.txt"><span class="muted">Excel (.xlsx, .xls) vagy CSV (vesszővel vagy pontosvesszővel tagolt)</span></div>
    ${body}`;
}
function bindImport(){
  $('#impFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) readImportFile(f); });
  if (!imp) return;
  document.querySelectorAll('[data-map]').forEach(s => s.addEventListener('change', () => { imp.map[s.dataset.map] = +s.value; render(); }));
  $('#impPeople').addEventListener('change', e => { imp.createPeople = e.target.checked; render(); });
}
const TEMPLATE_HEADERS = ['Régi ID / matrica', 'Típus*', 'Modell', 'Sorozatszám', 'Állapot', 'Kinél / hol', 'Service', 'Rendelés érkezése', 'Garancia vége', 'Garancia (hónap)', 'Beszállító', 'Rendelés / számla száma', 'Megjegyzés'];
const TEMPLATE_EXAMPLES = [
  ['', 'Monitor', 'Dell P2422H', 'CN0ABC123', 'Működik', '', '', '2026-10-20', '', 36, 'Példa Beszállító Kft.', 'RND-2026-118', 'Raktárba kerül (Kinél / hol üres)'],
  ['', 'Számítógép', 'Lenovo ThinkPad T14 Gen 5', 'PF5ABC01', 'Működik', 'Kiss Péter', 'Development', '2026-10-20', '2029-10-20', '', 'Példa Beszállító Kft.', 'RND-2026-118', 'Személyhez kiadva'],
  ['', 'Fejhallgató', 'Jabra Evolve2 40', 'JB40-9001', 'Működik', '2.12 / A3', '', '2026-10-20', '', 24, 'Példa Beszállító Kft.', 'RND-2026-118', 'Asztalra: Helyiség / Asztal'],
  ['', 'Dokkoló', 'Lenovo USB-C Dock Gen2', 'DK-10001', 'Működik', 'Iroda: 1.04 – Ügyfélszolgálat', '', '2026-10-20', '', 36, '', '', 'Irodai eszközhalmazba'],
];
function buildTemplate(X){
  const wb = X.utils.book_new();
  const ws = X.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...TEMPLATE_EXAMPLES]);
  ws['!cols'] = [14, 14, 28, 16, 14, 26, 18, 16, 14, 14, 22, 22, 36].map(wch => ({wch}));
  X.utils.book_append_sheet(wb, ws, 'Eszközök');
  const g = X.utils.aoa_to_sheet([
    ['Oszlop', 'Mit írj bele'],
    ['Régi ID / matrica', 'Opcionális. Az Asset ID-t (HU000001…) a program osztja ki automatikusan.'],
    ['Típus*', 'Kötelező. Jelenlegi típusok: ' + db.types.map(t => t.name).join(', ') + '. Ismeretlen típusnév esetén új típus jön létre.'],
    ['Modell', 'pl. Dell P2422H – ha még nincs ilyen modell, létrejön.'],
    ['Állapot', 'Működik / Javítás alatt / Elveszett / Selejtezett. Üresen: Működik.'],
    ['Kinél / hol', 'Üres = Raktár. Személy neve vagy e-mail címe. Asztal: „Helyiség / Asztal”, pl. 2.12 / A1. Irodai halmaz: „Iroda: <helyiség neve>”.'],
    ['Service', 'Opcionális, egy meglévő Service neve.'],
    ['Garancia vége / (hónap)', 'Ha a vége üres, de a hónap ki van töltve, a program kiszámolja az érkezés dátumából.'],
    [], ['Tipp', 'A példasorokat töröld ki, mielőtt importálsz. Az első sor (fejléc) maradjon.'],
  ]);
  g['!cols'] = [{wch:24}, {wch:110}];
  X.utils.book_append_sheet(wb, g, 'Útmutató');
  return wb;
}
async function downloadTemplate(){
  try { const X = await loadXLSX(); X.writeFile(buildTemplate(X), 'it-raktar-eszkoz-import-sablon.xlsx'); }
  catch(e){ alert(e.message + '\nHelyette a CSV sablont töltöm le.'); downloadCSVTemplate(); }
}
function downloadCSVTemplate(){ download('it-raktar-eszkoz-import-sablon.csv', '﻿' + [TEMPLATE_HEADERS, ...TEMPLATE_EXAMPLES].map(csvLine).join('\r\n'), 'text/csv'); }
