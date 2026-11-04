'use strict';
/* Routing (#/…), navigation and startup */

function currentTheme(){
  const t = document.documentElement.dataset.theme;
  return t || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function applyTheme(t){
  if (t) document.documentElement.dataset.theme = t;
  const b = $('#themeBtn'); if (b) b.textContent = currentTheme() === 'dark' ? '☀️ Light' : '🌙 Dark';
}
// the side menu: open, icons only or hidden; kept across pages and visits
function setNav(m, temporary){
  document.documentElement.dataset.nav = m;
  if (!temporary) try { localStorage.setItem(NAV_KEY, m); } catch(e) {}
  const b = $('#navToggle'); if (b) b.setAttribute('aria-expanded', String(m !== 'hidden'));
  setHdr();
}
const toggleNav = () => setNav(document.documentElement.dataset.nav === 'hidden' ? 'open' : 'hidden');
function toggleTheme(){
  const t = currentTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, t); } catch(e) {}
  applyTheme(t);
}

let lastRoute = '';
function render(){
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(qs || '');
  const r = parts[0] || '';
  const v = $('#view');
  closeCombo();
  fpLeaveCheck(path);
  // flash the object once when arriving from somewhere else (e.g. from an asset page)
  flashObj = r === 'room' && parts[2] && !lastRoute.startsWith('room/' + parts[1]) ? parts[2] : null;
  if (path !== lastRoute) selected.clear();
  lastRoute = path;
  const navOf = {asset:'assets', import:'assets', person:'people', room:'rooms', project:'projects', tour:''};
  document.querySelectorAll('#nav a').forEach(a => { const on = a.dataset.r === (navOf[r] ?? r); a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  // on a phone the menu covers the page, so it closes after a choice
  if (matchMedia('(max-width:760px)').matches && document.documentElement.dataset.nav !== 'hidden') setNav('hidden', true);
  ensureScope(); renderScope();
  const need = routePerm(r, parts[1]);
  if (need && !can(need)){ v.innerHTML = deniedHtml(); return; }
  const gate = tour.on ? null : routeGate(r, parts[1]);
  if (gate){ v.innerHTML = gate; return; }
  switch (r){
    case 'assets': v.innerHTML = viewAssets(params); bindAssetFilters(); break;
    case 'asset': v.innerHTML = viewAsset(parts[1]); break;
    case 'import': v.innerHTML = viewImport(); bindImport(); break;
    case 'people':
      if (parts[1] === 'import'){ v.innerHTML = viewPeopleImport(); bindPeopleImport(); }
      else { v.innerHTML = viewPeople(params); bindPeopleFilters(); }
      break;
    case 'person': v.innerHTML = viewPerson(parts[1]); break;
    case 'rooms': v.innerHTML = viewRooms(params); bindRooms(); break;
    case 'admin': v.innerHTML = viewAdmin(parts[1]); bindAdmin(); break;
    case 'room': v.innerHTML = viewRoom(parts[1], parts[2]); if (room(parts[1])) bindRoom(parts[1], parts[2]); break;
    case 'projects': v.innerHTML = viewProjects(params); bindProjects(); break;
    case 'project': v.innerHTML = viewProject(parts[1]); bindProject(parts[1]); break;
    case 'docs': v.innerHTML = viewDocs(params); bindDocs(); break;
    case 'log': v.innerHTML = viewLogs(params); bindLogs(); break;
    case 'settings': v.innerHTML = viewSettings(parts[1], parts[2], params);
      if (parts[1] === 'fields' && parts[2]) bindFieldSet(parts[2]);
      if (parts[1] === 'types') bindModelFilters();
      if (parts[1] === 'dashboard') bindDashSettings();
      if ($('#tplPrev')) bindDocSettings();
      if ($('#tdPage')) bindTplDesigner(params.get('tpl'));
      break;
    case 'tour': v.innerHTML = viewDashboard(); setTimeout(startTour, 300); break;
    default: v.innerHTML = viewDashboard(); bindDashboard();
  }
  renderScope();
  applySorts();
  applyPerms();
  updateBulk();
  if (flashObj){ const el = document.querySelector(`.obj[data-id="${flashObj}"]`); if (el) el.scrollIntoView({block:'center', inline:'center'}); }
}
function renderUserChip(){
  const u = currentUser(), el = $('#userChip');
  if (el) el.innerHTML = `👤 ${esc(u)} · ${esc(roleLabel(currentAccount().role))}`;
}

window.addEventListener('hashchange', render);
// keep tabs in sync if the app is open in several tabs
window.addEventListener('storage', e => { if (e.key === KEY && !fp.editing && !tour.on){ db = load(); render(); } });
$('#importFile').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importJSONFile(f); });
// sticky bars sit below the (wrapping) header
const setHdr = () => document.documentElement.style.setProperty('--hdr', document.querySelector('header').offsetHeight + 'px');
window.addEventListener('resize', setHdr);
try { applyTheme(localStorage.getItem(THEME_KEY)); } catch(e) { applyTheme(null); }
applyBranding();
applyNav();
bindSearch();
renderUserChip();
setNav(document.documentElement.dataset.nav || 'open');
render();
