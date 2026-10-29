'use strict';
/* Automatikus bemutató (mintaadatokon), képernyővideóként is felvehető. A végén a saját adatok visszaállnak. */

const tP = name => db.people.find(p => p.name === name);
const tA = tag => db.assets.find(a => a.tag === tag);
const tRoom = prefix => db.rooms.find(r => r.name.startsWith(prefix));
const tObj = (prefix, label) => { const r = tRoom(prefix); return roomObjs(r.id).find(o => o.label === label); };
const tObjHash = (prefix, label) => { const o = tObj(prefix, label); return `#/room/${o.roomId}/${o.id}`; };
const tPersonAsset = (name, type) => db.assets.find(a => a.holder.kind === 'person' && a.holder.id === tP(name).id && (!type || a.type === type));
const TOUR_PEOPLE_CSV = 'Teljes név;Service;Munkavégzési mód\nÚj Ubul;Customer Support;Onsite\nMinta Mira;Quality Assurance;Hybrid\nPróba Panna;Finance;otthon\nHibás Hugó;IT Support;irodában dolgozik\n';
const TOUR = [
  {title:'IT Raktár', text:'Céges IT eszközök nyilvántartása – irodában, Hybrid és WFH munkatársaknál. A dashboard számaira kattintva a megfelelő lista nyílik meg.', go:'#/', hl:'.grid', ms:7000},
  {title:'Kattintható darabszámok', text:'A típusonkénti szám (pl. monitor) a meglévő eszközlistát nyitja meg, előre kiválasztott típussal – a keresés és a szűrők ugyanúgy használhatók.', go:'#/assets?type=monitor', hl:'.tbl-wrap', ms:6500},
  {title:'Keresés emberre', text:'Név, Asset ID, sorozatszám, asztal vagy portazonosító – a globális kereső mindent megtalál.', go:'#/', act:() => typeInto($('#q'), 'Nagy'), hl:'#results', ms:3500},
  {title:'Személy: Service, szerepkör, munkavégzési mód', text:'Nagy Anna a Development Service-ben dolgozik, Hybrid módban. Itt látszik minden kiadott eszköze és a jegyzőkönyvei.', go:() => '#/person/' + tP('Nagy Anna').id, hl:'.sub', ms:6500},
  {title:'Egyedi Asset ID és mezőcsoport', text:'Minden eszköz automatikus, egyedi Asset ID-t kap (HU000001…), ami másolható és kereshető. A Monitor_Fields mezői a monitor adatlapján jelennek meg.', go:() => '#/asset/' + tA('HU000001').id, hl:'.asset-head', ms:7500},
  {title:'Floorplan – irodai alaprajz', text:'Az asztalokon látszik az eszközök Asset ID-ja és az asztal földi hálózati portja (pl. R4-5-15).', go:() => tObjHash('2.12', 'A1'), hl:'.obj.sel', ms:7000},
  {title:'Szerkesztő mód és eszközhalmazok', text:'Az irodai eszközhalmazban az irodához rendelt, asztalra még nem tett eszközök vannak. A Hybrid és a WFH eszközök külön halmazban látszanak.', go:() => '#/room/' + tRoom('2.12').id,
    act:() => fpStart(tRoom('2.12').id), hl:() => document.querySelector('.side .card:last-child'), ms:7500},
  {title:'Drag & Drop elhelyezés', text:'Az irodai halmazból egy monitort az A3-as asztalra húzunk. Ez nem kiadás – az eszköz az irodánál marad, csak a helye változik.',
    act:() => { const a = officePool(tRoom('2.12').id).find(x => x.type === 'monitor'); if (a) dropOnDesk(a, tObj('2.12', 'A3')); }, hl:() => document.querySelector(`.obj[data-id="${tObj('2.12', 'A3').id}"]`), ms:7000},
  {title:'Hybrid eszköz asztalra', text:'Nagy Anna fejhallgatója az asztalára kerül, de továbbra is hozzá van rendelve – nem történik újabb kiadás.',
    act:() => { const a = tPersonAsset('Nagy Anna', 'headset'); if (a) dropOnDesk(a, tObj('2.12', 'A2')); }, hl:() => document.querySelector(`.obj[data-id="${tObj('2.12', 'A2').id}"]`), ms:7000},
  {title:'WFH eszköz nem tehető asztalra', text:'Egy otthonról dolgozó kolléga eszközét a rendszer nem engedi irodai asztalra tenni – ezt jelzi is.',
    act:() => { const a = tPersonAsset('Tóth Gábor', 'pc'); if (a) dropOnDesk(a, tObj('2.12', 'B1')); }, ms:5500},
  {title:'Az asztal hálózati portja', text:'Minden asztalhoz megadható a földi hálózati port azonosítója. Ez az asztal adata, nem az eszközé.', go:() => tObjHash('2.12', 'A3'),
    act:async () => { const i = document.querySelector('.side [data-f=port]'); if (i){ await typeInto(i, 'R4-5-17'); i.dispatchEvent(new Event('change')); } }, hl:() => document.querySelector('.side [data-f=port]'), ms:6000},
  {title:'Save', text:'A floorplan változásai a Save gombbal mentődnek; a Mégse a legutóbb mentett állapotot tölti vissza.', act:() => fpSave(), hl:'.sub', ms:5500},
  {title:'Projects – előkészítési projektek', text:'Új munkatársak előkészítése: résztvevők, tervezett átvétel, felelős, ticket, állapot és haladás egy táblázatban.', go:'#/projects', hl:'.tbl-wrap', ms:6500},
  {title:'Személyenkénti felszerelési táblázat', text:'Számítógép és monitorok Asset ID-val (lezárásig csak foglalva, pl. „Waiting for Erase”), a kábelek pedig csak checklistként – ezek nem kerülnek a készletbe.',
    go:() => '#/project/' + db.projects[0].id, hl:'.ptable', ms:8000},
  {title:'Checklist', text:'Az előkészített kiegészítők pipálása – minden változás a projektnaplóba kerül.',
    act:() => { const c = document.querySelector('.ptable input[data-pf=ck_lan]'); if (c){ c.checked = true; c.dispatchEvent(new Event('change')); } }, hl:'.ptable', ms:5000},
  {title:'Projekt befejezése', text:'Megerősítés után a rendszer ellenőrzi az eszközöket, a meglévő kiadási folyamattal kiadja őket, és elkészíti az átadás-átvételi jegyzőkönyveket.',
    act:() => { completeProject(db.projects[0].id); const d = db.docs.find(x => x.projectId === db.projects[0].id); if (d) printDoc(d.id); }, ms:8500},
  {title:'Logs – Project activity', text:'A napló szűrhető: Created, Updated, Moved, Checkout, Returned és Project activity.', go:'#/log?cat=project', hl:'.fchips', ms:6500},
  {title:'Logs – Moved', text:'A Moved szűrő csak az áthelyezéseket mutatja – például az imént a floorplanon végzett elhelyezéseket.', go:'#/log?cat=moved', hl:'.tbl-wrap', ms:6000},
  {title:'Custom Field Sets', text:'A Settings menüben mezőcsoportot hozol létre (pl. Monitor_Fields), benne a mezőket, majd eszköztípushoz rendeled.',
    go:() => '#/settings/fields/' + db.fieldSets.find(s => s.name === 'Monitor_Fields').id, hl:'.fields', ms:7000},
  {title:'Személyek importja Excelből', text:'Csak három adat kell: teljes név, Service, munkavégzési mód. Az előnézet jelzi a hibás sorokat és az ismeretlen Service-t.',
    go:'#/people/import', act:() => readPeopleFile(new File([TOUR_PEOPLE_CSV], 'uj-kollegak.csv', {type:'text/csv'})), hl:() => [...document.querySelectorAll('.tbl-wrap')].pop(), ms:8500},
  {title:'Köszönöm a figyelmet!', text:'IT Raktár – minden eszköz, asztal és előkészítés egy helyen, szerver nélkül, GitHubról is bemutatható.', go:'#/', ms:6000},
];
async function tsleep(ms, plain){
  for (let t = 0; t < ms;){
    if (tour.stopped || tour.skip) return;
    await new Promise(r => setTimeout(r, 100));
    if (!tour.paused){ t += 100; if (!plain){ const i = $('#tour .tp i'); if (i) i.style.width = Math.min(100, t / ms * 100) + '%'; } }
  }
}
async function typeInto(el, text){
  if (!el) return;
  el.focus(); el.value = '';
  for (const ch of text){ el.value += ch; el.dispatchEvent(new Event('input', {bubbles:true})); await tsleep(110, true); }
}
function showTourDoc(html){
  hideTourDoc();
  const d = document.createElement('div'); d.id = 'tourDoc';
  const f = document.createElement('iframe'); f.srcdoc = html; d.appendChild(f);
  document.body.appendChild(d); tourTop();
}
function hideTourDoc(){ const d = $('#tourDoc'); if (d) d.remove(); }
// keep the caption above modal dialogs (both live in the browser's top layer)
function tourTop(){ const el = $('#tour'); if (!el) return; try { if (el.matches(':popover-open')) el.hidePopover(); el.showPopover(); } catch(e) {} }
function tourUI(){
  const el = document.createElement('div');
  el.id = 'tour'; el.setAttribute('popover', 'manual');
  el.innerHTML = `<div class="tn"></div><h4></h4><div class="tt"></div><div class="tp"><i></i></div>
    <div class="tc"><button data-t="pause">⏸ Szünet</button><button data-t="next">⏭ Következő</button><button data-t="stop">✕ Kilépés</button>
    <span style="margin-left:auto">Szóköz: szünet · →: tovább · Esc: kilépés</span></div>`;
  el.addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) tourCmd(b.dataset.t); });
  document.body.appendChild(el); tourTop();
}
function tourCmd(c){
  if (c === 'pause'){ tour.paused = !tour.paused; const b = document.querySelector('#tour [data-t=pause]'); if (b) b.textContent = tour.paused ? '▶ Folytatás' : '⏸ Szünet'; }
  if (c === 'next') tour.skip = true;
  if (c === 'stop') tour.stopped = true;
}
document.addEventListener('keydown', e => {
  if (!tour.on) return;
  if (e.key === ' ' && !['TEXTAREA', 'INPUT', 'SELECT'].includes(e.target.tagName)){ e.preventDefault(); tourCmd('pause'); }
  else if (e.key === 'ArrowRight') tourCmd('next');
  else if (e.key === 'Escape'){ e.preventDefault(); tourCmd('stop'); }
});
async function startTour(){
  if (tour.on) return;
  if (!confirm('Indul az automatikus bemutató (kb. 2,5 perc) mintaadatokkal.\nA saját adataid nem vesznek el – a bemutató végén visszaállnak.')){ if (location.hash === '#/tour') location.hash = '#/'; return; }
  if (fp.editing) fpLeaveCheck('');
  try { const cur = localStorage.getItem(KEY); localStorage.setItem(TOUR_BACKUP, cur === null ? '__none__' : cur); } catch(e) {}
  Object.assign(tour, {on:true, paused:false, stopped:false, skip:false, confirm:window.confirm, alert:window.alert});
  // the scripted steps answer the app's own prompts
  window.confirm = () => true; window.alert = () => {};
  if ($('#dlg').open) $('#dlg').close();
  db = demo(); save(); imp = null; pimp = null;
  tourUI();
  for (tour.i = 0; tour.i < TOUR.length && !tour.stopped; tour.i++){
    const s = TOUR[tour.i];
    tour.skip = false;
    hideTourDoc();
    document.querySelectorAll('.tour-hl').forEach(x => x.classList.remove('tour-hl'));
    $('#results').classList.remove('show'); $('#q').value = ''; $('#q').blur();
    if (s.go){
      if ($('#dlg').open) $('#dlg').close();
      const h = typeof s.go === 'function' ? s.go() : s.go;
      if (location.hash !== h) location.hash = h; else render();
      await new Promise(r => setTimeout(r, 350));
    }
    const box = $('#tour');
    box.querySelector('.tn').textContent = `${tour.i + 1} / ${TOUR.length}`;
    box.querySelector('h4').textContent = s.title;
    box.querySelector('.tt').textContent = s.text;
    box.querySelector('.tp i').style.width = '0';
    try { if (s.act) await s.act(); } catch(e) { console.warn('Bemutató lépés hiba:', e); }
    await new Promise(r => setTimeout(r, 200));
    const target = typeof s.hl === 'function' ? s.hl() : s.hl && document.querySelector(s.hl);
    if (target){ target.classList.add('tour-hl'); target.scrollIntoView({block:'center', inline:'nearest', behavior:'smooth'}); }
    tourTop();
    await tsleep(s.ms);
  }
  endTour();
}
function endTour(){
  window.confirm = tour.confirm; window.alert = tour.alert;
  hideTourDoc();
  document.querySelectorAll('.tour-hl').forEach(x => x.classList.remove('tour-hl'));
  if ($('#dlg').open) $('#dlg').close();
  const el = $('#tour'); if (el) el.remove();
  imp = null; pimp = null; selected.clear();
  Object.assign(fp, {editing:false, dirty:false});
  restoreTourBackup();
  db = load();
  tour.on = false;
  if (location.hash === '#/') render(); else location.hash = '#/';
}
