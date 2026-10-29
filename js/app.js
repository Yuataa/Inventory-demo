'use strict';
/* Útválasztás (#/…), navigáció és indítás */

let lastRoute = '';
function render(){
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(qs || '');
  const r = parts[0] || '';
  const v = $('#view');
  fpLeaveCheck(path);
  // flash the object once when arriving from somewhere else (e.g. from an asset page)
  flashObj = r === 'room' && parts[2] && !lastRoute.startsWith('room/' + parts[1]) ? parts[2] : null;
  if (path !== lastRoute) selected.clear();
  lastRoute = path;
  const navOf = {asset:'assets', import:'assets', person:'people', room:'rooms', project:'projects'};
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === (navOf[r] || r)));
  switch (r){
    case 'assets': v.innerHTML = viewAssets(params); bindAssetFilters(); break;
    case 'asset': v.innerHTML = viewAsset(parts[1]); break;
    case 'import': v.innerHTML = viewImport(); bindImport(); break;
    case 'people':
      if (parts[1] === 'import'){ v.innerHTML = viewPeopleImport(); bindPeopleImport(); }
      else { v.innerHTML = viewPeople(params); bindPeopleFilters(); }
      break;
    case 'person': v.innerHTML = viewPerson(parts[1]); break;
    case 'rooms': v.innerHTML = viewRooms(); break;
    case 'room': v.innerHTML = viewRoom(parts[1], parts[2]); if (room(parts[1])) bindRoom(parts[1], parts[2]); break;
    case 'projects': v.innerHTML = viewProjects(params); bindProjects(); break;
    case 'project': v.innerHTML = viewProject(parts[1]); bindProject(parts[1]); break;
    case 'docs': v.innerHTML = viewDocs(params);
      $('#df').addEventListener('change', e => { location.hash = '#/docs' + (e.target.value ? '?f=' + e.target.value : ''); }); break;
    case 'log': v.innerHTML = viewLogs(params); bindLogs(params); break;
    case 'settings': v.innerHTML = viewSettings(parts[1], parts[2]); if (parts[1] === 'fields' && parts[2]) bindFieldSet(parts[2]); break;
    case 'tour': v.innerHTML = viewDashboard(); setTimeout(startTour, 300); break;
    default: v.innerHTML = viewDashboard();
  }
  updateBulk();
  if (flashObj){ const el = document.querySelector(`.obj[data-id="${flashObj}"]`); if (el) el.scrollIntoView({block:'center', inline:'center'}); }
}
function renderUserChip(){
  const u = currentUser(), el = $('#userChip');
  if (el) el.innerHTML = u ? `👤 ${esc(u)}` : '👤 Név megadása';
}

window.addEventListener('hashchange', render);
// keep tabs in sync if the app is open in several tabs
window.addEventListener('storage', e => { if (e.key === KEY && !fp.editing && !tour.on){ db = load(); render(); } });
$('#importFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importJSONFile(f); });
// sticky bars sit below the (wrapping) header
const setHdr = () => document.documentElement.style.setProperty('--hdr', document.querySelector('header').offsetHeight + 'px');
window.addEventListener('resize', setHdr);
bindSearch();
renderUserChip();
setHdr();
render();
