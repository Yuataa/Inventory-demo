'use strict';
/* Floorplan: irodánkénti alaprajz. Nézet mód (csak megtekintés) és szerkesztő mód (Save / Mégse).
   Szerkesztés közben a változások csak a memóriában vannak (fp.editing), a Save gomb menti őket; a Mégse visszatölti a mentett állapotot.
   A floorplan nem hoz létre eszközt és nem ad ki eszközt: csak az irodához rendelt, illetve Hybrid eszközöket lehet asztalra húzni. */

function viewRooms(){
  return `
    <div class="row"><h1>Floorplan</h1><span class="spacer"></span><button class="primary" onclick="roomForm()">+ Új helyiség</button></div>
    <div class="sub">Irodák, szerverszobák, raktárak alaprajza. Kattints egy helyiségre a megnyitáshoz.</div>
    ${db.rooms.length ? `<div class="grid room-cards">${sortHu(db.rooms, r => r.name).map(r => {
      const os = roomObjs(r.id), ks = os.filter(o => o.kind === 'desk'), rk = os.filter(o => o.kind === 'rack');
      const n = db.assets.filter(a => assetRoomId(a) === r.id).length;
      return `<div class="card" onclick="location.hash='#/room/${r.id}'">
        <b>${esc(r.name)}</b><div class="muted">${ROOM_KINDS[r.kind] || ''} · ${esc(r.floor)}</div>
        <div class="muted">${[ks.length && ks.length + ' asztal', rk.length && rk.length + ' rack', n + ' eszköz', officePool(r.id).length && officePool(r.id).length + ' a halmazban'].filter(Boolean).join(' · ')}</div>
        <div class="muted" style="font-size:12px">🧩 ${r.serviceIds.map(serviceName).filter(Boolean).map(esc).join(', ') || 'nincs Service rendelve'}</div>
        <div class="mini-map">${os.map(k => `<div class="${k.kind}" style="left:${k.x / r.w * 100}%;top:${k.y / r.h * 100}%;width:${k.w / r.w * 100}%;height:${k.h / r.h * 100}%"></div>`).join('')}</div>
      </div>`;
    }).join('')}</div>` : '<div class="empty">Még nincs helyiség.</div>'}`;
}
function roomForm(r){
  const isNew = !r;
  r = r || {name:'', floor:'', kind:'office', w:900, h:500, serviceIds:[]};
  openDialog(`
    <h3>${isNew ? 'Új helyiség' : 'Helyiség adatai'}</h3>
    <label class="f">Név</label><input name="name" required value="${esc(r.name)}" placeholder="pl. 2.12 – Fejlesztői iroda">
    <div class="two">
      <div><label class="f">Típus</label><select name="kind">${Object.entries(ROOM_KINDS).map(([k, v]) => `<option value="${k}"${k === r.kind ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
      <div><label class="f">Emelet / épület</label><input name="floor" value="${esc(r.floor)}"></div>
      <div><label class="f">Alaprajz szélessége (px)</label><input name="w" type="number" min="300" max="4000" step="20" value="${r.w}"></div>
      <div><label class="f">Alaprajz magassága (px)</label><input name="h" type="number" min="200" max="4000" step="20" value="${r.h}"></div>
    </div>
    <label class="f">Az irodát használó Service-ek (a Hybrid / WFH eszközhalmazhoz)</label>
    <div class="checklist">${sortHu(db.services, s => s.name).map(s => `<label><input type="checkbox" name="svc_${s.id}"${r.serviceIds.includes(s.id) ? ' checked' : ''}> 🧩 ${esc(s.name)}</label>`).join('') || '<span class="muted">Még nincs Service (Settings → Services).</span>'}</div>
    ${dlgActions(isNew ? 'Létrehozás' : 'Mentés')}`,
    data => {
      const v = {name:data.name.trim(), kind:data.kind, floor:data.floor.trim(), w:+data.w || 900, h:+data.h || 500, serviceIds:db.services.filter(s => data['svc_' + s.id]).map(s => s.id)};
      if (isNew){ const n = {id:uid(), ...v}; db.rooms.push(n); save(); location.hash = '#/room/' + n.id; }
      else { Object.assign(r, v); for (const o of roomObjs(r.id)) clampObj(o); save(); render(); }
    });
}

let flashObj = null;
function viewRoom(id, selId){
  const r = room(id);
  if (!r) return `<div class="empty">A helyiség nem található.</div>`;
  const ed = fp.editing && fp.roomId === id;
  const os = roomObjs(id), sel = selId ? findObj(selId) : null;
  const ordered = [...os.filter(o => o.kind !== 'door'), ...os.filter(o => o.kind === 'door')];
  return `
    <div class="row"><a href="#/rooms">← Floorplan</a></div>
    <div class="row" style="margin-top:8px"><h1>${(ROOM_KINDS[r.kind] || '🏢').split(' ')[0]} ${esc(r.name)}</h1><span class="spacer"></span>
      ${ed ? '' : `<button class="primary" onclick="fpStart('${r.id}')">✎ Floorplan szerkesztése</button>
        <button onclick="roomForm(room('${r.id}'))">⚙ Helyiség adatai</button>
        <button class="danger" onclick="deleteRoom('${r.id}')">Törlés</button>`}</div>
    <div class="sub">${ROOM_KINDS[r.kind] || ''} · ${esc(r.floor)} · 🧩 ${r.serviceIds.map(serviceName).filter(Boolean).map(esc).join(', ') || 'nincs Service'}${r.savedAt ? ` · utoljára mentve: ${fmtTime(r.savedAt)}` : ''}</div>
    ${ed ? `<div class="editbar"><b>✎ Szerkesztő mód</b><span class="muted">${fp.dirty ? 'Nem mentett változások vannak.' : 'Asztalok húzhatók, eszközök a halmazból asztalra húzhatók.'}</span>
      <span class="spacer"></span>
      <button onclick="addObj('${r.id}','desk')">🪑 + Asztal</button><button onclick="addObj('${r.id}','rack')">🗄️ + Rack</button><button onclick="addObj('${r.id}','door')">🚪 + Ajtó</button>
      <button class="primary" onclick="fpSave()" id="fpSaveBtn">💾 Save</button><button onclick="fpCancel()">✕ Mégse</button></div>` : ''}
    <div class="room-layout${ed ? ' editing' : ''}">
      <div class="map-wrap"><div class="map" id="map" style="width:${r.w}px;height:${r.h}px">
        ${ordered.map(o => objHtml(o, sel && sel.id === o.id, ed)).join('')}
      </div></div>
      <div class="side">
        <div class="card">${sel && sel.roomId === id ? objPanel(sel, ed) : legend()}</div>
        ${r.kind === 'server' && !officePool(id).length ? '' : poolsHtml(r, ed)}
      </div>
    </div>`;
}
function legend(){
  return `<b>Jelmagyarázat</b>
    <p class="muted">Kattints egy asztalra a részletekért. Elhelyezéshez és átrendezéshez kapcsold be a szerkesztést.</p>
    <div class="legend">
      <i style="background:var(--desk-person);border-color:var(--desk-person-line)"></i><span>Asztal – saját gazdája van</span>
      <i style="background:var(--desk-shared);border-color:var(--desk-shared-line)"></i><span>Asztal – közös / műszakos</span>
      <i style="background:var(--desk);border-color:var(--desk-line)"></i><span>Asztal – szabad / hot-desk</span>
      <i style="background:var(--rack);border-color:var(--rack-line)"></i><span>Rack / szerverszekrény</span>
      <i style="background:repeating-linear-gradient(45deg,var(--door) 0 3px,transparent 3px 6px);border-color:var(--door)"></i><span>Ajtó / bejárat</span>
      <i style="border-color:var(--hybrid)"></i><span>Hybrid eszköz asztalon (a személynél marad)</span>
      <span class="tag" style="color:var(--accent)">🔌 R4-5-15</span><span>Az asztal földi hálózati portja</span>
    </div>`;
}
function objHtml(o, selected, ed){
  const cls = ['obj', o.kind];
  if (selected) cls.push('sel');
  if (flashObj === o.id) cls.push('flash');
  const st = `left:${o.x}px;top:${o.y}px;width:${o.w}px;${o.kind === 'door' ? 'height' : 'min-height'}:${o.h}px`;
  if (o.kind === 'door') return `<div class="${cls.join(' ')}" data-id="${o.id}" style="${st}" title="🚪 ${esc(o.label)}"><span>🚪</span></div>`;
  const p = o.personId ? person(o.personId) : null;
  if (o.kind === 'desk'){ if (p) cls.push('has-person'); else if (o.shared) cls.push('shared'); }
  const as = sortHu(deskAssets(o.id), a => a.type + a.tag);
  const owner = o.kind === 'rack' ? '' : `<div class="dp">${p ? '👤 ' + esc(p.name) : o.shared ? '🔁 ' + esc(o.sharedNote || 'Közös / műszakos') : '<i>szabad</i>'}</div>`;
  return `<div class="${cls.join(' ')}" data-id="${o.id}" style="${st}">
    <div class="dl">${o.kind === 'rack' ? '🗄️ ' : ''}${esc(o.label)}${o.port ? `<span class="dport" title="Földi hálózati port">🔌${esc(o.port)}</span>` : ''}</div>${owner}
    <div>${as.map(a => `<span class="chip${a.placement ? ' hy' : ''}" data-aid="${a.id}"${ed ? ' draggable="true"' : ''} title="${esc(typeLabel(a.type) + ' · ' + modelName(a) + (a.placement ? ' · Hybrid, ' + (person(a.holder.id) || {}).name + '-nál marad' : ''))}">${typeIcon(a.type)}${esc(a.tag)}</span>`).join(o.kind === 'rack' ? '<br>' : '')}</div>
  </div>`;
}
function poolsHtml(r, ed){
  const off = sortHu(officePool(r.id), a => a.type + a.tag), hy = sortHu(modePool(r.id, 'Hybrid'), a => a.tag), wfh = sortHu(modePool(r.id, 'WFH'), a => a.tag);
  const chip = (a, cls, drag) => {
    const k = a.placement && desk(a.placement.deskId), p = a.holder.kind === 'person' ? person(a.holder.id) : null;
    return `<span class="pchip ${cls}${k ? ' placed' : ''}" data-aid="${a.id}"${drag && ed ? ' draggable="true"' : ''}
      title="${esc(`${a.tag} · ${typeLabel(a.type)} · ${modelName(a)}${p ? ' · ' + p.name + ' (' + p.mode + ')' : ''}${cls === 'wfh' ? ' – WFH eszköz, asztalra nem helyezhető' : ''}`)}">
      ${typeIcon(a.type)} <a href="#/asset/${a.id}" draggable="false">${esc(a.tag)}</a>${p ? ` <small>${esc(p.name)}</small>` : ''}${k ? ` <small>→ ${esc(k.label)}</small>` : ''}</span>`;
  };
  return `<div class="card" style="margin-top:12px">
    <b>Eszközhalmazok</b> <span class="muted" style="font-size:12px">${ed ? '– húzd az eszközt egy asztalra' : '– elhelyezéshez kapcsold be a szerkesztést'}</span>
    <div class="pool office" id="poolOffice"><h4>🏢 Irodai eszközhalmaz <span class="muted">(${off.length})</span></h4>
      ${off.map(a => chip(a, '', true)).join('') || '<span class="muted" style="font-size:12px">Üres. Az irodához rendelt, asztalra még nem tett eszközök kerülnek ide; asztalról ide visszahúzhatók.</span>'}</div>
    <div class="pool hybrid"><h4>🔀 Hybrid eszközök <span class="muted">(${hy.length})</span></h4>
      ${hy.map(a => chip(a, 'hy', true)).join('') || '<span class="muted" style="font-size:12px">Nincs Hybrid munkatárs eszköze.</span>'}
      ${hy.length ? '<div class="muted" style="font-size:11px;margin-top:4px">Asztalra tehetők – a személyhez rendelés megmarad, nem új kiadás.</div>' : ''}</div>
    <div class="pool wfh"><h4>🏠 WFH eszközök <span class="muted">(${wfh.length}) – nem tehetők asztalra</span></h4>
      ${wfh.map(a => chip(a, 'wfh', false)).join('') || '<span class="muted" style="font-size:12px">Nincs WFH munkatárs eszköze.</span>'}</div>
    ${r.serviceIds.length ? '' : '<div class="warnbox">Ehhez az irodához nincs Service rendelve, ezért a Hybrid és WFH halmaz üres. (⚙ Helyiség adatai)</div>'}
  </div>`;
}
function objPanel(o, ed){
  const head = (icon, title) => `<div class="row"><b>${icon} ${title}</b><span class="spacer"></span><a href="#/room/${o.roomId}">✕ bezár</a></div>`;
  const sizeRow = (wl, hl) => ed ? `<div class="row" style="gap:8px;align-items:flex-end">
      <div style="flex:1"><label class="f">${wl}</label><input data-f="w" type="number" min="10" step="10" value="${o.w}" style="width:100%"></div>
      <div style="flex:1"><label class="f">${hl}</label><input data-f="h" type="number" min="10" step="10" value="${o.h}" style="width:100%"></div>
      <button onclick="rotateObj('${o.id}')" title="Elforgatás">⟲ 90°</button></div>` : '';
  const del = ed ? `<div style="margin-top:18px;text-align:right"><button class="danger sm" onclick="deleteObj('${o.id}')">${OBJ[o.kind].label} törlése</button></div>` : '';
  if (o.kind === 'door') return head('🚪', 'Ajtó') + (ed ? `<label class="f">Megnevezés</label><input data-f="label" value="${esc(o.label)}">${sizeRow('Szélesség', 'Vastagság')}
    <p class="muted" style="font-size:12px">Tipp: húzd a fal mellé; függőleges falhoz forgasd el 90°-kal.</p>` : `<p>${esc(o.label)}</p>`) + del;
  const as = sortHu(deskAssets(o.id), a => a.type + a.tag), isRack = o.kind === 'rack', p = o.personId ? person(o.personId) : null;
  const ownerVal = o.personId || (o.shared ? 'shared' : '');
  const list = as.length ? as.map(a => `<div class="item">${assetIcon(a)} <div style="flex:1"><a class="tag" href="#/asset/${a.id}">${esc(a.tag)}</a>
      <br><small class="muted">${esc(typeLabel(a.type))} · ${esc(modelName(a))}${a.placement ? ` · <span style="color:var(--hybrid)">Hybrid – ${esc((person(a.holder.id) || {}).name || '')}</span>` : ''}</small></div>
      ${ed ? `<button class="sm" onclick="dropToPool(asset('${a.id}'))" title="${a.placement ? 'Levétel az asztalról (a személynél marad)' : 'Vissza az irodai eszközhalmazba'}">↩ Halmazba</button>` : ''}</div>`).join('')
    : '<p class="muted">Nincs eszköz.</p>';
  return head(isRack ? '🗄️' : '🪑', isRack ? 'Rack / szekrény' : 'Asztal') + (ed ? `
    <label class="f">Jelölés</label><input data-f="label" value="${esc(o.label)}">
    ${isRack ? '' : `<label class="f">Kié az asztal?</label>
    <select data-f="owner">
      <option value=""${ownerVal === '' ? ' selected' : ''}>– szabad / hot-desk –</option>
      <option value="shared"${ownerVal === 'shared' ? ' selected' : ''}>🔁 Közös / műszakos (nem egy emberé)</option>
      <optgroup label="Személyhez rendelve">${sortHu(db.people, x => x.name).map(x => `<option value="${x.id}"${x.id === o.personId ? ' selected' : ''}>👤 ${esc(x.name)}</option>`).join('')}</optgroup>
    </select>
    ${o.shared ? `<label class="f">Kik használják? (pl. Service, műszakok)</label><input data-f="sharedNote" value="${esc(o.sharedNote || '')}" placeholder="pl. Customer Support – 2 műszak">` : ''}
    <label class="f">🔌 Földi hálózati port azonosító</label><input data-f="port" value="${esc(o.port || '')}" placeholder="pl. R4-5-15" class="tag">`}
    ${sizeRow('Szélesség', isRack ? 'Magasság' : 'Mélység')}` : `
    <dl class="kv" style="margin-top:8px"><dt>Jelölés</dt><dd><b>${esc(o.label)}</b></dd>
      ${isRack ? '' : `<dt>Gazdája</dt><dd>${p ? personLink(p.id) : o.shared ? '🔁 ' + esc(o.sharedNote || 'Közös / műszakos') : '<i>szabad</i>'}</dd>
      <dt>🔌 Port</dt><dd>${o.port ? `<span class="tag">${esc(o.port)}</span>${copyBtn(o.port)}` : '<span class="muted">nincs megadva</span>'}</dd>`}</dl>`) + `
    <h2 style="margin-top:18px">Eszközök ${isRack ? 'a rackben' : 'az asztalon'} (${as.length})</h2>${list}
    ${ed ? '' : '<p class="muted" style="font-size:12px;margin-top:10px">Módosításhoz: ✎ Floorplan szerkesztése.</p>'}${del}`;
}

// ---------- edit mode ----------
function fpStart(roomId){ Object.assign(fp, {editing:true, roomId, dirty:false}); render(); }
function fpSave(){
  const r = room(fp.roomId);
  if (r) r.savedAt = Date.now();
  if (r && fp.dirty) log(null, `Floorplan mentve: ${r.name}`, 'updated');
  Object.assign(fp, {editing:false, dirty:false});
  save(); toast('💾 Floorplan mentve'); render();
}
function fpCancel(){
  if (fp.dirty && !confirm('Elveted a floorplan nem mentett módosításait?')) return;
  Object.assign(fp, {editing:false, dirty:false});
  db = load(); toast('A módosítások elvetve – a mentett állapot látszik.'); render();
}
// leaving the room while editing: offer to save
function fpLeaveCheck(nextPath){
  if (!fp.editing || nextPath.startsWith('room/' + fp.roomId)) return;
  if (fp.dirty && confirm('A floorplan módosításai nincsenek mentve.\n\nOK = Mentés   ·   Mégse = Elvetés')){ fpSave(); return; }
  Object.assign(fp, {editing:false, dirty:false});
  db = load();
}
window.addEventListener('beforeunload', e => { if (fp.editing && fp.dirty){ e.preventDefault(); e.returnValue = ''; } });

// ---------- drag & drop placement ----------
// null = allowed, otherwise the reason why not
function dropRule(a, k){
  if (!k || k.kind === 'door') return 'Ide nem tehető eszköz.';
  if (a.holder.kind === 'person'){
    const p = person(a.holder.id);
    if (!p) return 'Ismeretlen személy.';
    if (p.mode === 'WFH') return 'WFH eszköz nem helyezhető irodai asztalra.';
    if (p.mode !== 'Hybrid') return 'Személyhez kiadott eszköz csak Hybrid munkatársnál tehető asztalra.';
    if (k.kind === 'rack') return 'Hybrid eszköz rackbe nem tehető.';
    return null;
  }
  if (a.holder.kind === 'office') return a.holder.id === k.roomId ? null : 'Ez az eszköz egy másik irodához tartozik.';
  if (a.holder.kind === 'desk') return (desk(a.holder.id) || {}).roomId === k.roomId ? null : 'Ez az eszköz egy másik irodához tartozik.';
  return 'Ez az eszköz nincs ehhez az irodához rendelve – a floorplan nem ad ki eszközt.';
}
function dropOnDesk(a, k){
  const err = dropRule(a, k);
  if (err){ toast('⛔ ' + err); return false; }
  if (a.holder.kind === 'person'){ if (!(a.placement && a.placement.deskId === k.id)) setPlacement(a, k.id); }
  else if (!(a.holder.kind === 'desk' && a.holder.id === k.id)) setHolder(a, {kind:'desk', id:k.id});
  save(); render(); return true;
}
function dropToPool(a){
  if (a.holder.kind === 'person'){ if (a.placement) setPlacement(a, null); }
  else if (a.holder.kind === 'desk') setHolder(a, {kind:'office', id:desk(a.holder.id).roomId});
  save(); render();
}
let dragAid = null;
function bindRoom(roomId, selId){
  const r = room(roomId), map = $('#map'), ed = fp.editing && fp.roomId === roomId;
  const snap = v => Math.round(v / 10) * 10;
  map.querySelectorAll('.obj').forEach(el => {
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('[draggable=true]')) return;
      const o = findObj(el.dataset.id), sx = e.clientX, sy = e.clientY, ox = o.x, oy = o.y;
      let moved = false;
      if (ed) el.setPointerCapture(e.pointerId);
      const mv = ev => {
        if (!ed) return;
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        moved = true; el.classList.add('dragging');
        o.x = Math.max(0, Math.min(r.w - o.w, snap(ox + dx))); o.y = Math.max(0, Math.min(r.h - o.h, snap(oy + dy)));
        el.style.left = o.x + 'px'; el.style.top = o.y + 'px';
      };
      const up = () => {
        el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up);
        el.classList.remove('dragging');
        if (moved) save();
        selectObj(o);
      };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
    });
  });
  if (ed){
    const clear = () => document.querySelectorAll('.drop-ok,.drop-no').forEach(x => x.classList.remove('drop-ok', 'drop-no'));
    document.querySelectorAll('[draggable=true][data-aid]').forEach(c => {
      c.addEventListener('dragstart', e => {
        dragAid = c.dataset.aid; e.dataTransfer.setData('text/plain', dragAid); e.dataTransfer.effectAllowed = 'move';
        const a = asset(dragAid);
        map.querySelectorAll('.obj.desk,.obj.rack').forEach(d => d.classList.add(dropRule(a, findObj(d.dataset.id)) ? 'drop-no' : 'drop-ok'));
        if (a.holder.kind === 'desk' || a.placement) $('#poolOffice').classList.add('drop-ok');
      });
      c.addEventListener('dragend', () => { dragAid = null; clear(); });
    });
    map.querySelectorAll('.obj.desk,.obj.rack').forEach(d => {
      d.addEventListener('dragover', e => { if (dragAid && !dropRule(asset(dragAid), findObj(d.dataset.id))){ e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
      d.addEventListener('drop', e => { e.preventDefault(); const id = dragAid || e.dataTransfer.getData('text/plain'); clear(); if (id) dropOnDesk(asset(id), findObj(d.dataset.id)); });
    });
    const pool = $('#poolOffice');
    if (pool){
      pool.addEventListener('dragover', e => { const a = dragAid && asset(dragAid); if (a && (a.holder.kind === 'desk' || a.placement)){ e.preventDefault(); } });
      pool.addEventListener('drop', e => { e.preventDefault(); const id = dragAid || e.dataTransfer.getData('text/plain'); clear(); if (id) dropToPool(asset(id)); });
    }
  }
  const o = selId && findObj(selId);
  if (!o || !ed) return;
  document.querySelectorAll('.side [data-f]').forEach(el => el.addEventListener('change', () => {
    const f = el.dataset.f, v = el.value;
    if (f === 'owner'){ o.shared = v === 'shared'; o.personId = v && v !== 'shared' ? v : null; }
    else if (f === 'w' || f === 'h'){ o[f] = Math.max(10, +v || o[f]); clampObj(o); }
    else if (f === 'label') o.label = String(v).trim() || o.label;
    else if (f === 'port') o.port = String(v).trim();
    else o[f] = v;
    save(); render();
  }));
}
function selectObj(o){
  const target = `#/room/${o.roomId}/${o.id}`;
  if (location.hash === target) render(); else location.hash = target;
}
function clampObj(o){ const r = room(o.roomId); o.w = Math.min(o.w, r.w); o.h = Math.min(o.h, r.h); o.x = Math.max(0, Math.min(r.w - o.w, o.x)); o.y = Math.max(0, Math.min(r.h - o.h, o.y)); }
// first free grid spot so new objects don't stack on top of each other
function findSpot(r, w, h){
  const os = roomObjs(r.id);
  for (let y = 20; y <= r.h - h; y += 20) for (let x = 20; x <= r.w - w; x += 20)
    if (!os.some(k => x < k.x + k.w + 10 && x + w + 10 > k.x && y < k.y + k.h + 10 && y + h + 10 > k.y)) return {x, y};
  return {x:0, y:0};
}
function addObj(roomId, kind){
  if (!fp.editing) return;
  const r = room(roomId), def = OBJ[kind], same = roomObjs(roomId).filter(o => o.kind === kind).length + 1;
  const {x, y} = kind === 'door' ? {x:Math.max(0, r.w - def.w - 40), y:0} : findSpot(r, def.w, def.h);
  const o = {id:uid(), roomId, kind, x, y, w:def.w, h:def.h};
  if (kind === 'desk') Object.assign(o, {label:'Asztal ' + same, personId:null, shared:false, sharedNote:'', port:''});
  if (kind === 'rack') Object.assign(o, {label:'Rack ' + same, personId:null, shared:false, port:''});
  if (kind === 'door') o.label = same === 1 ? 'Bejárat' : 'Ajtó ' + same;
  (kind === 'door' ? db.items : db.desks).push(o);
  clampObj(o); save(); selectObj(o);
}
function rotateObj(id){ const o = findObj(id); [o.w, o.h] = [o.h, o.w]; clampObj(o); save(); render(); }
// removing a desk never returns assets to storage: they go back to the office pool / stay with their person
function deleteObj(id){
  const o = findObj(id), name = `${OBJ[o.kind].label} „${o.label}”`;
  if (o.kind === 'desk' || o.kind === 'rack'){
    const as = deskAssets(id);
    if (!confirm(`Törlöd: ${name}?` + (as.length ? `\nA rajta lévő ${as.length} eszköz visszakerül az irodai eszközhalmazba (Hybrid eszköz a személynél marad).` : ''))) return;
    for (const a of as){ if (a.placement) setPlacement(a, null); else setHolder(a, {kind:'office', id:o.roomId}); }
    db.desks = db.desks.filter(x => x.id !== id);
  } else {
    if (!confirm(`Törlöd: ${name}?`)) return;
    db.items = db.items.filter(x => x.id !== id);
  }
  save(); location.hash = '#/room/' + o.roomId;
}
function deleteRoom(id){
  const r = room(id), ks = db.desks.filter(k => k.roomId === id);
  const as = db.assets.filter(a => (a.holder.kind === 'desk' && ks.some(k => k.id === a.holder.id)) || (a.holder.kind === 'office' && a.holder.id === id));
  const placed = db.assets.filter(a => a.placement && ks.some(k => k.id === a.placement.deskId));
  if (!confirm(`Törlöd a(z) „${r.name}” helyiséget minden asztallal, rackkel és ajtóval?` + (as.length ? `\nA helyiség ${as.length} eszköze a raktárba kerül.` : ''))) return;
  for (const a of as) setHolder(a, {kind:'storage'});
  for (const a of placed) setPlacement(a, null);
  db.desks = db.desks.filter(k => k.roomId !== id); db.items = db.items.filter(i => i.roomId !== id);
  db.rooms = db.rooms.filter(x => x.id !== id); save(); location.hash = '#/rooms';
}
