'use strict';
/* Automatic guided tour on sample data; can be screen-recorded. Your own data comes back at the end. */

const tP = name => db.people.find(p => p.name === name);
const tA = tag => db.assets.find(a => a.tag === tag);
const tRoom = prefix => db.rooms.find(r => r.name.startsWith(prefix));
const tObj = (prefix, label) => { const r = tRoom(prefix); return roomObjs(r.id).find(o => o.label === label); };
const tObjHash = (prefix, label) => { const o = tObj(prefix, label); return `#/room/${o.roomId}/${o.id}`; };
const tPersonAsset = (name, type) => db.assets.find(a => a.holder.kind === 'person' && a.holder.id === tP(name).id && (!type || a.type === type));
const TOUR_PEOPLE_CSV = 'Full Name;Service;Work Mode\nNew Nora;Customer Support;Onsite\nSample Sam;Quality Assurance;Hybrid\nTest Tom;Finance;home office\nBroken Bob;IT Support;on the moon\n';
const TOUR = [
  {title:'TC IT Asset Management', text:'All IT assets in one place. The Overview shows the totals, the Office / Onsite, Assigned and Storage / Spare groups and the Faulty / Aged assets, with a breakdown by Asset Type.', go:'#/', hl:'.dash', ms:7500},
  {title:'Prefiltered lists', text:'Every number opens the regular asset list with the matching filter. Here: all Office / Onsite assets, narrowed down by office if needed.', go:'#/assets?view=office', hl:'.filters', ms:6500},
  {title:'Faulty / Aged', text:'Faulty and Aged are separate: an asset can be either, or both. The age comes from the arrival date and the threshold is set in Settings.', go:'#/assets?view=health', hl:'.tbl-wrap', ms:6500},
  {title:'Global search', text:'Name, Asset ID, Asset Name, serial, desk, port, ticket – the search finds them all.', go:'#/', act:() => typeInto($('#q'), 'Nagy'), hl:'#results', ms:3500},
  {title:'Asset page', text:'Every asset has a permanent Asset ID (HU000001…) and an Asset Name next to the Model Name. Custom fields come from the field sets of its Asset Type.', go:() => '#/asset/' + tA('HU000001').id, hl:'.asset-head', ms:7000},
  {title:'User Status and tickets', text:'Kept separately from the Work Mode. We set Tóth Gábor to Leaver under a ticket. The status change does not move any asset: it only lists them as awaited.',
    go:() => '#/person/' + tP('Tóth Gábor').id, act:() => { setUserStatus(tP('Tóth Gábor'), 'Leaver', 'INC-30112', ''); tP('Tóth Gábor').tickets.push({id:uid(), no:'INC-30112', note:'', ts:Date.now(), statusFrom:'Active', statusTo:'Leaver'}); save(); render(); }, hl:'.warnbox', ms:8000},
  {title:'Recording a return', text:'Each asset comes back one by one, through the regular return. The others stay awaited.',
    act:() => { setHolder(tPersonAsset('Tóth Gábor', 'headset'), {kind:'storage'}); save(); render(); }, hl:() => [...document.querySelectorAll('.tbl-wrap')][0], ms:6500},
  {title:'Floorplan', text:'Desks show their assets and floor port ID. Edit mode has a Save button; nothing is stored before that.', go:() => '#/room/' + tRoom('2.12').id, act:() => fpStart(tRoom('2.12').id), hl:() => document.querySelector('.side .card:last-child'), ms:7000},
  {title:'Drag & drop', text:'An office asset goes from the pool onto desk A3. This is a placement, not a checkout. WFH assets are refused.',
    act:() => { const a = officePool(tRoom('2.12').id).find(x => x.type === 'monitor'); if (a) dropOnDesk(a, tObj('2.12', 'A3')); fpSave(); }, hl:() => document.querySelector(`.obj[data-id="${tObj('2.12', 'A3').id}"]`), ms:6500},
  {title:'Projects without names', text:'Five new joiners are planned, names unknown yet. Planned quantities, selected assets and issued assets are counted separately.',
    go:() => '#/project/' + db.projects[1].id, hl:'.tbl-wrap', ms:7500},
  {title:'Equipment per person', text:'Named projects list the computer and monitors with Asset ID, reserved until completion. Cables are only a checklist and never become inventory.',
    go:() => '#/project/' + db.projects[0].id, hl:'.ptable', ms:7500},
  {title:'Complete project', text:'After confirmation the assets are validated, checked out through the regular flow, and handover protocols are created.',
    act:() => { completeProject(db.projects[0].id); const d = db.docs.find(x => x.projectId === db.projects[0].id); if (d) printDoc(d.id); }, ms:8000},
  {title:'Logs', text:'Filter by Created, Updated, Moved, Checkout, Returned, Project activity, User status and Settings.', go:'#/log?cat=project', hl:'.fchips', ms:6000},
  {title:'Dashboard settings', text:'Choose which tiles appear, their order and size, the default filters and the Aged threshold. No code change needed.', go:'#/settings/dashboard', hl:'#dashCfg', ms:7000},
  {title:'Types & Models', text:'Asset Types, their Asset Name rules and models are managed here. New entries appear in every form and filter.', go:'#/settings/types', hl:'.tbl-wrap', ms:6000},
  {title:'People import', text:'Three values are enough: Full Name, Service, Work Mode. The preview shows wrong rows and unknown Services.',
    go:'#/people/import', act:() => readPeopleFile(new File([TOUR_PEOPLE_CSV], 'new-people.csv', {type:'text/csv'})), hl:() => [...document.querySelectorAll('.tbl-wrap')].pop(), ms:8000},
  {title:'Thank you!', text:'TC IT Asset Management – assets, desks, people and projects in one place, without a server.', go:'#/', ms:5500},
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
    <div class="tc"><button data-t="pause">⏸ Pause</button><button data-t="next">⏭ Next</button><button data-t="stop">✕ Exit</button>
    <span style="margin-left:auto">Space: pause · →: next · Esc: exit</span></div>`;
  el.addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) tourCmd(b.dataset.t); });
  document.body.appendChild(el); tourTop();
}
function tourCmd(c){
  if (c === 'pause'){ tour.paused = !tour.paused; const b = document.querySelector('#tour [data-t=pause]'); if (b) b.textContent = tour.paused ? '▶ Resume' : '⏸ Pause'; }
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
  if (!confirm('The automatic tour (about 2 minutes) runs on sample data.\nYour own data is not lost – it comes back at the end.')){ if (location.hash === '#/tour') location.hash = '#/'; return; }
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
    try { if (s.act) await s.act(); } catch(e) { console.warn('Tour step error:', e); }
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
