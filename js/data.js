'use strict';
/* TC IT Asset Management – data layer: constants, storage (localStorage + IndexedDB), migration, demo data, locations and logging.
   Runs without a server: all data stays in the browser. */

const KEY = 'itraktar_v2';
const KEY_V1 = 'itraktar_v1';
const TOUR_BACKUP = KEY + '_tour_backup';
const USER_KEY = 'itraktar_user';

const THEME_KEY = 'itraktar_theme';

// work modes are configurable (db.modes); behavior drives the floorplan rules, so a renamed mode keeps working
const DEFAULT_MODES = [
  {id:'Onsite', name:'Onsite', icon:'🏢', behavior:'onsite'},
  {id:'Hybrid', name:'Hybrid', icon:'🔀', behavior:'hybrid'},
  {id:'WFH',    name:'WFH',    icon:'🏠', behavior:'wfh'},
];
const USER_STATUS = {Active:{cls:'ok'}, Suspended:{cls:'warn'}, Leaver:{cls:'bad'}};
const RETURN_STATE = {notRequired:'Not Required', awaiting:'Awaiting Return', returned:'Returned', cancelled:'Cancelled'};
const SHIP_STATUS = ['Preparing', 'Sent', 'Received'];
const ACTIVITIES = {shipment:'Shipment', preparation:'Equipment Preparation', assignment:'Asset Assignment', replacement:'Replacement'};
const ACCOUNT_KEY = 'itraktar_account';
const OFFICE_KEY = 'itraktar_office';
const ROLES = ['Superadmin', 'Admin', 'Visitor'];
// every main module with its real actions; menu and view exist for each module that has a menu item
const MODULES = [
  {id:'overview',  name:'Overview',       ops:{}},
  {id:'assets',    name:'Assets',         ops:{create:'Create', edit:'Edit', delete:'Delete', import:'Import', export:'Export', assign:'Assign', move:'Move / Return'}},
  {id:'people',    name:'People',         ops:{create:'Create', edit:'Edit', delete:'Delete', import:'Import', status:'Manage User Status & tickets'}},
  {id:'floorplan', name:'Floorplan',      ops:{office:'Manage offices', createRoom:'Create room', edit:'Edit floorplan', details:'Edit room details', delete:'Delete room'}},
  {id:'projects',  name:'Projects',       ops:{create:'Create', edit:'Edit', delete:'Delete', complete:'Complete', ship:'Manage shipments'}},
  {id:'documents', name:'Documents',      ops:{create:'Create', upload:'Upload signed copy', delete:'Delete', templates:'Edit templates'}},
  {id:'labels',    name:'Label Printing', noMenu:true, ops:{print:'Print', presets:'Manage presets'}},
  {id:'logs',      name:'Logs',           ops:{}},
  {id:'settings',  name:'Settings',       ops:{services:'Manage Services', roles:'Manage Job Roles', modes:'Manage Work Modes', types:'Manage Types & Models', fields:'Manage Custom Field Sets', dashboard:'Manage Dashboard', data:'Backup and data'}},
  {id:'admin',     name:'Admin Panel',    ops:{accounts:'Manage accounts', permissions:'Manage permissions', branding:'Manage Branding'}},
];
const permKeys = m => [...(m.noMenu ? [] : [`${m.id}.menu`, `${m.id}.view`]), ...Object.keys(m.ops).map(o => `${m.id}.${o}`)];
function defaultPerms(role){
  const out = {};
  for (const m of MODULES) for (const k of permKeys(m)){
    const basic = k.endsWith('.menu') || k.endsWith('.view');
    out[k] = m.id === 'admin' ? false : role === 'Admin' ? true : basic && m.id !== 'settings';
  }
  return out;
}
const DEFAULT_BRANDING = {logoId:null, primary:'', secondary:'', corners:'rounded', prev:null};
const DEFAULT_PRESET = {id:'default', name:'Default', fields:{qr:true, serial:true, name:true, model:true, tag:false, type:false}, logo:false, logoPos:'right'};
const ESIGN_PROVIDERS = {signnow:'SignNow', acrobat:'Adobe Acrobat Sign'};
const STATUS = {
  ok:      {label:'Working',   cls:'ok'},
  faulty:  {label:'Faulty',    cls:'bad'},
  repair:  {label:'In Repair', cls:'warn'},
  lost:    {label:'Lost',      cls:'bad'},
  retired: {label:'Retired',   cls:'bad'},
};
const ROOM_KINDS = {office:'🏢 Office', server:'🗄️ Server room', storage:'📦 Storage room', meeting:'👥 Meeting room'};
const OBJ = {
  desk: {label:'Desk', w:160, h:90},
  rack: {label:'Rack',   w:90,  h:150},
  door: {label:'Door',  w:70,  h:12},
};
const FIELD_KINDS = {text:'Text', number:'Number', date:'Date', bool:'Yes/no', select:'Dropdown list'};
const LOG_CATS = {created:'Created', updated:'Updated', moved:'Moved', checkout:'Checkout', returned:'Returned', project:'Project activity', status:'User status', config:'Settings'};
const PROJECT_STATUS = {planning:'Planned', progress:'In Progress', ready:'Ready', completed:'Completed', cancelled:'Cancelled'};
const PREP_STATUS = ['', 'Waiting for Erase', 'Erase done', 'Imaging', 'Ready'];
// accessories tracked only as a checklist – never inventory, never an Asset ID
const CHECKLIST = [['keyboard', 'Keyboard'], ['mouse', 'Mouse'], ['lan', 'LAN cable'], ['power', 'Power cable'], ['hdmi', 'HDMI'], ['display', 'Display cable'], ['usbb', 'USB-B']];
// built-in types; 'pc' and 'monitor' are used by Projects, so they cannot be deleted
const DEFAULT_TYPES = [
  {id:'monitor', name:'Monitor', icon:'🖥️', system:true},
  {id:'pc', name:'Computer', icon:'💻', system:true, nameRule:'custom', nameUnique:true},
  {id:'headset', name:'Headset', icon:'🎧'},
  {id:'dock', name:'Dock', icon:'🔌'},
  {id:'keyboard', name:'Keyboard/mouse', icon:'⌨️'},
  {id:'phone', name:'Phone', icon:'📱'},
  {id:'printer', name:'Printer', icon:'🖨️'},
  {id:'switch', name:'Switch', icon:'🔀'},
  {id:'router', name:'Router / firewall', icon:'🛡️'},
  {id:'server', name:'Server', icon:'🗄️'},
  {id:'ups', name:'UPS', icon:'🔋'},
  {id:'other', name:'Other', icon:'📦'},
];
// default types that were stored with their old Hungarian name; renamed types are left alone
const OLD_TYPE_NAMES = {'Számítógép':'Computer', 'Fejhallgató':'Headset', 'Dokkoló':'Dock', 'Billentyűzet/egér':'Keyboard/mouse', 'Telefon':'Phone', 'Nyomtató':'Printer',
  'Router / tűzfal':'Router / firewall', 'Szerver':'Server', 'Szünetmentes (UPS)':'UPS', 'Egyéb':'Other'};
// dashboard items: the tiles first, then the larger sections
const DASH_ITEMS = {
  total:'Total Assets', office:'Office / Onsite Assets', assigned:'Assigned Assets', storage:'Storage / Spare Assets', health:'Faulty / Aged Assets',
  returns:'Assets Awaiting Return', transit:'Assets In Transit', projects:'Active Projects', unsigned:'Documents to Sign', nodoc:'Assets Without Document',
  warranty:'Warranty Expiring', models:'Top Models', services:'Services', remote:'WFH / Hybrid People', recent:'Recent Events',
};
const DASH_SECTIONS = ['warranty', 'models', 'services', 'remote', 'recent'];
const DASH_BREAKDOWN = ['total', 'office', 'assigned', 'storage', 'health'];
function defaultDashboard(){
  return {items:Object.keys(DASH_ITEMS).map(id => ({id, visible:!['models', 'services', 'remote'].includes(id), size:id === 'total' ? 'wide' : 'normal', breakdown:DASH_BREAKDOWN.includes(id)})),
    defaults:{officeRoom:'', assignedMode:'', assignedService:'', storageType:'', healthCat:''}};
}
// label sheet geometry in mm; the size and the 5 × 16 grid follow from the product data, the margins can be calibrated in the print dialog
const LABEL_DEFAULT = {top:13.3, left:11, pitchX:38.1, pitchY:16.9};
const DOC_KINDS = {
  out: {label:'Handover', title:'Asset Handover Document', prefix:'HO'},
  in:  {label:'Return',   title:'Asset Return Document',   prefix:'RT'},
  swap:{label:'Swap',     title:'Asset Swap Document',     prefix:'SW'},
};
const SWAP_REASONS = {broken:'Failure', damaged:'Damage', lost:'Lost / stolen', upgrade:'Upgrade', other:'Other'};
const DEFAULT_SETTINGS = {
  company:'', address:'', handler:'',
  docTitles:{out:'Asset Handover Document', in:'Asset Return Document', swap:'Asset Swap Document'},
  docFooter:'Generated by TC IT Asset Management',
  docShow:{service:true, email:true, mode:true, logo:true, note:true},
  esignProvider:'',
  outText:'By signing below, I confirm that I have received the assets listed above complete and in working order. ' +
    'I agree to use them as intended for work, to take care of them, and to report any failure, ' +
    'loss or theft to IT without delay. I acknowledge that when my employment ends, or at the request of the employer, ' +
    'I will return the assets complete, and that I am liable for damage I cause under the applicable employment rules.',
  inText:'The undersigned confirm that the assets listed above were returned today. Remarks on the condition of the assets at ' +
    'return are recorded in the table. The employee is no longer responsible for the returned assets.',
  swapText:'The undersigned confirm that the replaced asset above was returned and the replacement asset was handed over today. ' +
    'The employee is responsible for the replacement asset in the same way as agreed in the original handover document; ' +
    'their responsibility for the replaced asset ends with its return.',
};

// shared UI state that the storage layer has to know about
const fp = {editing:false, roomId:null, dirty:false};          // floorplan edit mode: changes are kept in memory until Save
const tour = {on:false, i:0, paused:false, stopped:false, skip:false};

// ---------- storage ----------
const uid = () => Math.random().toString(36).slice(2, 10);
let db; // loaded at the end of this file, once every helper exists

// the tour runs on demo data; put the real data back (also after a tour that was cut short by closing the tab)
function restoreTourBackup(){
  try {
    const b = localStorage.getItem(TOUR_BACKUP);
    if (b === null) return;
    if (b === '__none__') localStorage.removeItem(KEY); else localStorage.setItem(KEY, b);
    localStorage.removeItem(TOUR_BACKUP);
  } catch(e) {}
}
function load(){
  try { const s = localStorage.getItem(KEY); if (s) return migrate(JSON.parse(s)); } catch(e) {}
  // first start of v2: take over the data of the earlier single-file version
  try { const s = localStorage.getItem(KEY_V1); if (s){ const d = migrate(JSON.parse(s)); persist(d); return d; } } catch(e) {}
  const d = demo(); persist(d); return d;
}
function persist(d){
  if (fp.editing){ fp.dirty = true; return true; }
  try { localStorage.setItem(KEY, JSON.stringify(d)); return true; }
  catch(e){ alert('Could not save in the browser (storage is probably full – too many or too large images?): ' + e.message); return false; }
}
function gcImages(){
  const used = new Set([...db.models.map(m => m.imageId), ...db.assets.map(a => a.imageId), db.settings.branding.logoId, (db.settings.branding.prev || {}).logoId, ...db.docs.map(d => (d.tpl || {}).logoId)].filter(Boolean));
  for (const k of Object.keys(db.images)) if (!used.has(k)) delete db.images[k];
}
function save(){ gcImages(); persist(db); }

// v1 (single html) and v2 data are both brought to the current shape
function migrate(d){
  for (const k of ['people', 'rooms', 'desks', 'assets', 'log', 'items', 'docs', 'swaps', 'services', 'roles', 'models', 'fieldSets', 'projects', 'returns', 'offices', 'accounts']) d[k] ||= [];
  d.images ||= {}; d.seq ||= {asset:0};
  d.settings = {...DEFAULT_SETTINGS, ...(d.settings || {})};
  d.settings.agedYears ||= 5;
  d.settings.branding = {...DEFAULT_BRANDING, ...(d.settings.branding || {})};
  d.settings.docTitles = {...DEFAULT_SETTINGS.docTitles, ...d.settings.docTitles};
  d.settings.docShow = {...DEFAULT_SETTINGS.docShow, ...d.settings.docShow};
  if (!d.settings.labelPresets) d.settings.labelPresets = [{...DEFAULT_PRESET, fields:{...DEFAULT_PRESET.fields}, ...(d.settings.label || LABEL_DEFAULT)}];
  d.settings.labelPresetId ||= d.settings.labelPresets[0].id;
  // accounts are separate from people; a first Superadmin always exists so nobody is locked out
  if (!d.accounts.length){ let u = ''; try { u = localStorage.getItem(USER_KEY) || ''; } catch(e) {} d.accounts.push({id:uid(), username:'superadmin', displayName:u || 'Superadmin', role:'Superadmin', enabled:true, personId:null}); }
  d.permissions ||= {};
  for (const r of ['Admin', 'Visitor']) d.permissions[r] = {...defaultPerms(r), ...(d.permissions[r] || {})};
  if (!d.offices.length) d.offices.push({id:uid(), name:'Main Office', code:'MAIN'});
  d.settings.label = {...LABEL_DEFAULT, ...(d.settings.label || {})};
  const dash = defaultDashboard(), saved = d.settings.dashboard || {};
  d.settings.dashboard = {items:[...(saved.items || []).filter(i => DASH_ITEMS[i.id]), ...dash.items.filter(i => !(saved.items || []).some(x => x.id === i.id))],
    defaults:{...dash.defaults, ...(saved.defaults || {})}};
  if (!d.modes || !d.modes.length) d.modes = DEFAULT_MODES.map(m => ({...m}));
  if (!d.types || !d.types.length) d.types = DEFAULT_TYPES.map(t => ({...t}));
  for (const t of DEFAULT_TYPES) if (t.system && !d.types.some(x => x.id === t.id)) d.types.unshift({...t});
  for (const t of d.types){
    if (OLD_TYPE_NAMES[t.name]) t.name = OLD_TYPE_NAMES[t.name];
    const def = DEFAULT_TYPES.find(x => x.id === t.id) || {};
    t.nameRule ||= def.nameRule || 'model';
    if (t.nameUnique === undefined) t.nameUnique = !!def.nameUnique;
  }
  if ((d.version || 1) < 2) migrateV1(d);
  for (const r of d.rooms){ r.kind ||= 'office'; r.serviceIds ||= []; if (!d.offices.some(o => o.id === r.officeId)) r.officeId = d.offices[0].id; }
  for (const k of d.desks){ k.kind ||= 'desk'; if (k.shared === undefined) k.shared = false; if (k.port === undefined) k.port = ''; }
  for (const a of d.assets){ a.custom ||= {}; if (a.placement === undefined) a.placement = null; if (a.serviceId === undefined) a.serviceId = null; if (a.name === undefined) a.name = ''; }
  for (const p of d.people){ if (!d.modes.some(m => m.id === p.mode)) p.mode = d.modes[0].id; p.status ||= 'Active'; p.tickets ||= []; p.isd = !!p.isd; if (p.suspension === undefined) p.suspension = null; if (p.endDate === undefined) p.endDate = ''; }
  for (const s of d.fieldSets){ s.typeIds ||= []; s.fields ||= []; }
  for (const pr of d.projects){
    pr.participants ||= []; pr.demand ||= []; pr.shipments ||= []; pr.replacements ||= [];
    pr.targetServiceId ||= null; pr.targetRoomId ||= null; pr.accessories ||= '';
    // older projects get the activities their data already uses, so no section disappears
    if (!Array.isArray(pr.activities)){
      const a = [pr.shipments.length && 'shipment', pr.demand.length && 'preparation', pr.participants.length && 'assignment', pr.replacements.length && 'replacement'].filter(Boolean);
      pr.activities = a.length ? a : ['preparation', 'assignment'];
    }
    for (const x of pr.participants){ x.checklist ||= {}; x.prep ||= {}; x.otherIds ||= []; x.manualSerial ||= {}; }
    for (const s of pr.shipments){ if (s.status === 'Delivered') s.status = 'Received'; s.fromOfficeId ||= null; s.toOfficeId ||= null; s.sendPersonId ||= null; s.recvPersonId ||= s.toPersonId || null; s.origin ||= {}; }
  }
  // a finished document keeps the template it was made with, so later template edits do not change it
  for (const x of d.docs) x.tpl ||= tplSnapshot(x.kind, d.settings);
  for (const l of d.log){ l.id ||= uid(); l.cat ||= 'updated'; }
  d.seq.asset = Math.max(d.seq.asset || 0, ...d.assets.map(a => assetNum(a.tag)), 0);
  d.version = 2;
  return d;
}
function migrateV1(d){
  // work modes and the old "department" text become Onsite/Hybrid/WFH and Service records
  const modeMap = {iroda:'Onsite', otthon:'WFH', hibrid:'Hybrid'};
  const svcByName = new Map();
  for (const p of d.people){
    p.mode = modeMap[p.mode] || p.mode || 'Onsite';
    const n = (p.dept || '').trim();
    if (n && !svcByName.has(n.toLowerCase())){ const s = {id:uid(), name:n, note:''}; d.services.push(s); svcByName.set(n.toLowerCase(), s); }
    p.serviceId = n ? svcByName.get(n.toLowerCase()).id : null;
    p.roleId ||= null;
    delete p.dept;
  }
  // the network module is gone: keep only the nearest floor socket label as the desk's port id
  const ports = d.items.filter(i => i.kind === 'port');
  for (const k of d.desks.filter(k => (k.kind || 'desk') === 'desk')){
    let best = null, bd = 160;
    for (const p of ports.filter(p => p.roomId === k.roomId)){
      const dist = Math.hypot(p.x + p.w / 2 - (k.x + k.w / 2), p.y + p.h / 2 - (k.y + k.h / 2));
      if (dist < bd){ bd = dist; best = p; }
    }
    k.port = best ? best.label : '';
  }
  d.items = d.items.filter(i => i.kind !== 'port' && i.kind !== 'floorbox');
  // free-text model names become model records; old IDs are kept as legacy IDs and every asset gets a HU…… Asset ID
  const models = new Map();
  let n = 0;
  for (const a of d.assets.slice().sort((x, y) => String(x.tag).localeCompare(String(y.tag), 'hu', {numeric:true}))){
    if (!d.types.some(t => t.id === a.type)) a.type = 'other';
    const name = (a.model || '').trim() || 'Unknown model', key = a.type + '|' + name.toLowerCase();
    if (!models.has(key)){ const m = {id:uid(), typeId:a.type, name, imageId:a.imageId || null}; d.models.push(m); models.set(key, m); }
    const m = models.get(key);
    if (!m.imageId && a.imageId) m.imageId = a.imageId;
    a.modelId = m.id; delete a.model; delete a.ports; delete a.imageId;
    a.legacyTag = a.tag; a.tag = fmtAssetId(++n);
  }
  d.seq.asset = n;
  for (const l of d.log){
    const t = l.text || '';
    l.cat = /^Létrehozva|^Importálva/.test(t) ? 'created' : /→ 👤/.test(t) ? 'checkout' : /^Áthelyezve: 👤.*→ 📦/.test(t) ? 'returned' : /^Áthelyezve/.test(t) ? 'moved' : 'updated';
  }
}

// ---------- Asset ID ----------
const fmtAssetId = n => 'HU' + String(n).padStart(6, '0');
function assetNum(tag){ const m = /^HU(\d{6})$/.exec(tag || ''); return m ? parseInt(m[1], 10) : 0; }
// the counter only ever grows, so deleted IDs are never handed out again
function nextAssetId(){
  db.seq.asset = Math.max(db.seq.asset || 0, ...db.assets.map(a => assetNum(a.tag)), 0) + 1;
  return fmtAssetId(db.seq.asset);
}

// ---------- demo data ----------
function demo(){
  const d = {version:2, seq:{asset:0}, offices:[], accounts:[], services:[], roles:[], people:[], rooms:[], desks:[], items:[], types:DEFAULT_TYPES.map(t => ({...t})), modes:DEFAULT_MODES.map(m => ({...m})), returns:[],
    models:[], fieldSets:[], assets:[], docs:[], swaps:[], projects:[], log:[], images:{},
    settings:{...DEFAULT_SETTINGS, company:'Example Ltd.', address:'1 Main Street, Example City', handler:'IT Support'}};
  const now = Date.now(), day = 864e5, iso = t => new Date(t).toISOString().slice(0, 10);
  const S = name => { const s = {id:uid(), name, note:''}; d.services.push(s); return s; };
  const cs = S('Customer Support'), its = S('IT Support'), fin = S('Finance'), dev = S('Development');
  const Ro = name => { const r = {id:uid(), name}; d.roles.push(r); return r; };
  const agent = Ro('Agent'), tl = Ro('TeamLeader'), devr = Ro('Developer'), itr = Ro('IT Specialist');
  const P = (name, email, svc, role, mode) => { const p = {id:uid(), name, email, serviceId:svc.id, roleId:role.id, mode, status:'Active', tickets:[], note:''}; d.people.push(p); return p; };
  const kiss = P('Kiss Péter', 'kiss.peter@example.com', dev, devr, 'Onsite');
  const nagy = P('Nagy Anna', 'nagy.anna@example.com', dev, devr, 'Hybrid');
  const toth = P('Tóth Gábor', 'toth.gabor@example.com', fin, agent, 'WFH');
  const szabo = P('Szabó Eszter', 'szabo.eszter@example.com', cs, tl, 'Onsite');
  const horvath = P('Horváth Dávid', 'horvath.david@example.com', cs, agent, 'WFH');
  const varga = P('Varga Júlia', 'varga.julia@example.com', cs, agent, 'Hybrid');
  const molnar = P('Molnár Tamás', 'molnar.tamas@example.com', its, itr, 'Onsite');
  const kovacs = P('Kovács Bence', '', cs, agent, 'Onsite');
  const farkas = P('Farkas Lili', '', cs, agent, 'Hybrid');
  const R = (name, floor, kind, w, h, svcs) => { const r = {id:uid(), name, floor, kind, w, h, serviceIds:svcs.map(s => s.id)}; d.rooms.push(r); return r; };
  const r1 = R('2.12 – Development Office', '2nd floor', 'office', 900, 500, [dev, its]);
  const r2 = R('1.04 – Customer Support', '1st floor', 'office', 760, 440, [cs]);
  const srv = R('0.01 – Server Room', 'Ground floor', 'server', 520, 340, [its]);
  const D = (room, kind, label, x, y, extra = {}) => { const k = {id:uid(), roomId:room.id, kind, label, x, y, w:OBJ[kind].w, h:OBJ[kind].h, personId:null, shared:false, port:'', ...extra}; d.desks.push(k); return k; };
  const I = (room, kind, label, x, y, extra = {}) => { const it = {id:uid(), roomId:room.id, kind, label, x, y, w:OBJ[kind].w, h:OBJ[kind].h, ...extra}; d.items.push(it); return it; };
  const a1 = D(r1, 'desk', 'A1', 40, 60, {personId:kiss.id, port:'R4-5-15'}), a2 = D(r1, 'desk', 'A2', 220, 60, {personId:nagy.id, port:'R4-5-16'});
  const a3 = D(r1, 'desk', 'A3', 400, 60, {port:'R4-5-17'});
  D(r1, 'desk', 'B1', 40, 240, {port:'R4-5-21'}); const b2 = D(r1, 'desk', 'B2', 220, 240, {personId:molnar.id, port:'R4-5-22'});
  I(r1, 'door', 'Entrance', 780, 0);
  const shift = 'Customer Support – 2 shifts';
  const u = [1, 2, 3, 4, 5].map(i => D(r2, 'desk', 'S' + i, 40 + (i - 1) % 3 * 200, i <= 3 ? 60 : 240, {shared:true, sharedNote:shift, port:'R1-4-0' + i}));
  I(r2, 'door', 'Entrance', 0, 340, {w:12, h:70});
  const rk1 = D(srv, 'rack', 'Rack 1', 60, 80), rk2 = D(srv, 'rack', 'Rack 2', 180, 80);
  I(srv, 'door', 'Entrance (access control)', 400, 328);
  const deb = {id:uid(), name:'Debrecen Office', code:'DEB'}, bud = {id:uid(), name:'Budapest Office', code:'BUD'};
  d.offices.push(deb, bud);
  for (const r of d.rooms) r.officeId = deb.id;
  const bm = R('Meeting Room', '3rd floor', 'meeting', 600, 360, []), bi = R('IT Room', '3rd floor', 'server', 520, 340, [its]), bo = R('Office 1', '3rd floor', 'office', 760, 440, [fin]);
  for (const r of [bm, bi, bo]) r.officeId = bud.id;
  D(bo, 'desk', 'D1', 40, 60, {port:'B3-1-01'}); D(bo, 'desk', 'D2', 240, 60, {port:'B3-1-02'}); D(bi, 'rack', 'Rack B1', 60, 80); I(bo, 'door', 'Entrance', 0, 340, {w:12, h:70});
  d.accounts.push({id:uid(), username:'superadmin', displayName:'Superadmin', role:'Superadmin', enabled:true, personId:null},
    {id:uid(), username:'it.admin', displayName:'IT Admin', role:'Admin', enabled:true, personId:null}, {id:uid(), username:'visitor', displayName:'Visitor', role:'Visitor', enabled:true, personId:null});
  const models = new Map();
  const M = (typeId, name) => { const k = typeId + '|' + name; if (!models.has(k)){ const m = {id:uid(), typeId, name, imageId:null}; d.models.push(m); models.set(k, m); } return models.get(k).id; };
  let n = 0;
  const A = (type, model, serial, holder, extra = {}) => {
    const arrivedT = now - (60 + Math.floor(Math.random() * 900)) * day;
    const a = {id:uid(), tag:fmtAssetId(++n), name:type === 'pc' ? 'TC-PC-' + String(n).padStart(3, '0') : '', type, modelId:M(type, model), serial, status:'ok', holder, placement:null, serviceId:null, custom:{}, note:'',
      arrived:iso(arrivedT), warrantyUntil:iso(arrivedT + 3 * 365 * day), supplier:'Demo Ltd.', orderNo:'', created:now,
      assignedAt:holder.kind === 'storage' ? null : arrivedT + 7 * day, ...extra};
    d.assets.push(a);
    d.log.push({id:uid(), ts:now, cat:'created', assetId:a.id, text:'Created', by:''});
    return a;
  };
  const desk = k => ({kind:'desk', id:k.id}), per = p => ({kind:'person', id:p.id}), office = r => ({kind:'office', id:r.id}), store = {kind:'storage'};
  // custom field sets: groups first, then the fields inside them
  const F = (name, kind, opts = {}) => ({id:uid(), name, kind, required:!!opts.required, options:opts.options || [], active:true});
  const monFs = {id:uid(), name:'Monitor_Fields', typeIds:['monitor'], fields:[F('Manufacturer', 'text'), F('Screen Size (in)', 'number'),
    F('Resolution', 'select', {options:['1920×1080', '2560×1440', '3840×2160']}), F('HDMI', 'bool'), F('DisplayPort', 'bool')]};
  const pcFs = {id:uid(), name:'Computer_Fields', typeIds:['pc'], fields:[F('Processor', 'text'), F('RAM (GB)', 'number'), F('Storage (GB)', 'number'),
    F('Operating System', 'select', {options:['Windows 11 Pro', 'Windows 10 Pro', 'macOS', 'Linux']}), F('Last Reinstall', 'date')]};
  const phFs = {id:uid(), name:'Phone_Fields', typeIds:['phone'], fields:[F('IMEI', 'text', {required:true}), F('Phone Number', 'text')]};
  d.fieldSets.push(monFs, pcFs, phFs);
  const [fMan, fDiag, fRes, fHdmi, fDp] = monFs.fields.map(f => f.id), [fCpu, fRam, fSsd, fOs] = pcFs.fields.map(f => f.id);
  const dell = {[fMan]:'Dell', [fDiag]:24, [fRes]:'1920×1080', [fHdmi]:true, [fDp]:true};
  const sams = {[fMan]:'Samsung', [fDiag]:24, [fRes]:'1920×1080', [fHdmi]:true, [fDp]:false};
  const tp = {[fCpu]:'Intel Core i5-1345U', [fRam]:16, [fSsd]:512, [fOs]:'Windows 11 Pro'};
  A('monitor', 'Dell P2422H', 'CN0D1X2Y', desk(a1), {custom:dell}); A('monitor', 'Dell P2422H', 'CN0D1X3Z', desk(a1), {custom:dell});
  A('pc', 'Lenovo ThinkCentre M70q', 'MJ0ABC12', desk(a1)); A('headset', 'Jabra Evolve2 65', 'JB65-1182', desk(a1));
  A('dock', 'Lenovo USB-C Dock Gen2', 'DK-99012', desk(a2));
  A('pc', 'Lenovo ThinkPad T14', 'PF3XYZ01', per(nagy), {custom:tp}); A('headset', 'Jabra Evolve2 40', 'JB40-2231', per(nagy));
  A('monitor', 'LG 27UL500', 'LG27-55821', per(nagy), {placement:{deskId:a2.id}});
  A('monitor', 'Dell P2422H', 'CN0D1X4A', desk(a3), {custom:dell}); A('pc', 'Lenovo ThinkCentre M70q', 'MJ0ABC13', desk(a3), {warrantyUntil:iso(now + 25 * day)});
  A('pc', 'Dell Latitude 5440', 'DL5440-770', desk(b2)); A('monitor', 'Dell P2422H', 'CN0D1X9Q', desk(b2), {custom:dell});
  A('monitor', 'Dell P2422H', 'CN0D1X6C', office(r1), {custom:dell}); A('dock', 'Lenovo USB-C Dock Gen2', 'DK-99013', office(r1));
  A('pc', 'Dell Latitude 5440', 'DL5440-771', per(toth)); A('monitor', 'Dell P2422H', 'CN0D1X5B', per(toth), {custom:dell});
  A('headset', 'Logitech Zone Vibe', 'LZV-0042', per(toth), {warrantyUntil:iso(now - 40 * day)});
  A('pc', 'Dell Latitude 5440', 'DL5440-772', per(horvath)); A('headset', 'Jabra Evolve2 40', 'JB40-2232', per(horvath));
  A('pc', 'Lenovo ThinkPad T14', 'PF3XYZ05', per(varga), {custom:tp}); A('headset', 'Jabra Evolve2 40', 'JB40-2235', per(varga));
  A('phone', 'Samsung Galaxy A55', 'R58X10022', per(szabo), {custom:{[phFs.fields[0].id]:'356789104455667', [phFs.fields[1].id]:'+36 30 123 4567'}});
  u.forEach((k, i) => { A('monitor', 'Samsung S24C', 'SS24-009' + i, desk(k), {custom:sams}); A('pc', 'HP EliteDesk 800', 'HP800-33' + i, desk(k)); });
  A('headset', 'Jabra Evolve2 40', 'JB40-2240', office(r2)); A('headset', 'Jabra Evolve2 40', 'JB40-2241', office(r2));
  const sMon1 = A('monitor', 'Samsung S24C', 'SS24-0099', store, {custom:sams}), sMon2 = A('monitor', 'Samsung S24C', 'SS24-0100', store, {custom:sams});
  A('monitor', 'Samsung S24C', 'SS24-0101', store, {custom:sams});
  const sPc1 = A('pc', 'Lenovo ThinkPad T14', 'PF3XYZ02', store, {custom:tp}), sPc2 = A('pc', 'Lenovo ThinkPad T14', 'PF3XYZ03', store, {custom:tp});
  A('pc', 'Lenovo ThinkPad T14', 'PF3XYZ04', store, {custom:tp});
  A('headset', 'Jabra Evolve2 40', 'JB40-2234', store); A('dock', 'Lenovo USB-C Dock Gen2', 'DK-99014', store);
  A('router', 'Fortinet FortiGate 60F', 'FGT60F-001', desk(rk1)); A('switch', 'Cisco CBS350-24P', 'CBS24-7781', desk(rk1));
  A('switch', 'Cisco CBS350-48P', 'CBS48-1102', desk(rk1));
  A('server', 'Dell PowerEdge R650', 'R650-XK12', desk(rk2)); A('ups', 'APC Smart-UPS 1500', 'APC-AS1500', desk(rk2));
  d.seq.asset = n;
  // a running preparation project for two new Customer Support colleagues
  const pick = iso(now + 7 * day);
  const pr = {id:uid(), name:'Customer Support – November joiners', owner:'Molnár Tamás', pickupDate:pick, ticket:'INC-20417', activities:['preparation', 'assignment'],
    note:'2 new agents for the S desks.', status:'progress', created:now, completedAt:null, participants:[
      {id:uid(), personId:kovacs.id, pickupDate:pick, computerId:sPc1.id, monitorId:sMon1.id, monitor2Id:null, otherIds:[],
        prep:{computer:'Waiting for Erase', monitor:'Ready'}, manualSerial:{}, checklist:{keyboard:true, mouse:true, power:true}},
      {id:uid(), personId:farkas.id, pickupDate:pick, computerId:sPc2.id, monitorId:sMon2.id, monitor2Id:null, otherIds:[],
        prep:{computer:'Imaging'}, manualSerial:{}, checklist:{}},
    ]};
  d.projects.push(pr);
  d.log.push({id:uid(), ts:now, cat:'project', projectId:pr.id, text:'Project created: ' + pr.name, by:''});
  // a project without named people yet: only the demand is known
  const pr2 = {id:uid(), name:'Five new joiners – preparation', owner:'Molnár Tamás', pickupDate:iso(now + 30 * day), ticket:'REQ-20533', activities:['preparation'], note:'Names are not known yet.', status:'planning',
    created:now, completedAt:null, participants:[], demand:[{id:uid(), typeId:'pc', qty:5, assetIds:[]}, {id:uid(), typeId:'monitor', qty:5, assetIds:[]}, {id:uid(), typeId:'headset', qty:5, assetIds:[]}],
    shipments:[], replacements:[], targetServiceId:cs.id, targetRoomId:r2.id, accessories:'Dock, keyboard and mouse for each desk'};
  d.projects.push(pr2);
  d.log.push({id:uid(), ts:now, cat:'project', projectId:pr2.id, text:'Project created: ' + pr2.name, by:''});
  // a project whose only task is a shipment
  const shipIds = d.assets.filter(a => ['PF3XYZ04', 'SS24-0101'].includes(a.serial)).map(a => a.id);
  const pr3 = {id:uid(), name:'Debrecen to Budapest – spare equipment', owner:'Molnár Tamás', pickupDate:'', ticket:'REQ-20610', activities:['shipment'], note:'', status:'planning', created:now, completedAt:null,
    participants:[], demand:[], replacements:[], shipments:[{id:uid(), from:'', fromOfficeId:deb.id, toOfficeId:bud.id, sendPersonId:molnar.id, recvPersonId:null, toPersonId:null, toRoomId:null, assetIds:shipIds, status:'Preparing', required:true, origin:{}, ts:now}]};
  d.projects.push(pr3);
  d.log.push({id:uid(), ts:now, cat:'project', projectId:pr3.id, text:'Project created: ' + pr3.name, by:''});
  // examples for the Faulty / Aged view: one of each kind and one that is both
  const old = t => iso(t - 6 * 365 * day);
  const byS = s => d.assets.find(a => a.serial === s);
  byS('HP800-330').status = 'faulty';
  byS('CN0D1X6C').arrived = old(now);
  Object.assign(byS('DK-99014'), {arrived:old(now), status:'faulty'});
  d.log.reverse();
  return migrate(d);
}

// ---------- lookups ----------
const byId = (arr, id) => arr.find(x => x.id === id);
const person = id => byId(db.people, id);
const room = id => byId(db.rooms, id);
const desk = id => byId(db.desks, id);
const item = id => byId(db.items, id);
const asset = id => byId(db.assets, id);
const service = id => byId(db.services, id);
const role = id => byId(db.roles, id);
const model = id => byId(db.models, id);
const project = id => byId(db.projects, id);
const findObj = id => desk(id) || item(id);
const typeOf = id => byId(db.types, id) || {id, name:'Unknown type', icon:'📦'};
const typeIcon = id => typeOf(id).icon || '📦';
const typeLabel = id => typeOf(id).name;
const modelName = a => (model(a.modelId) || {}).name || '';
// an empty stored name means "use the model name", so existing assets are not rewritten and follow later model renames
const assetName = a => a.name || modelName(a);
const modeOf = id => byId(db.modes, id) || {id, name:id || '', icon:'', behavior:'onsite'};
const modeName = id => modeOf(id).name;
const modeIcon = id => modeOf(id).icon;
const modeBehavior = id => modeOf(id).behavior;
const assetPerson = a => a.holder.kind === 'person' ? person(a.holder.id) : null;
const assetServiceIs = (a, id) => a.serviceId === id || (assetPerson(a) || {}).serviceId === id;
const isOut = a => a.status === 'lost' || a.status === 'retired';
const isFaulty = a => a.status === 'faulty' || a.status === 'repair';
const ageYears = a => a.arrived ? (Date.now() - new Date(a.arrived).getTime()) / (365.25 * 864e5) : null;
const isAged = a => { const y = ageYears(a); return y !== null && y >= db.settings.agedYears; };
// the dashboard groups; each comes from the asset's real state, never from a separate list
const ASSET_VIEWS = {
  office:  {title:'Office / Onsite Assets', test:a => ['office', 'desk', 'site'].includes(a.holder.kind)},
  assigned:{title:'Assigned Assets',        test:a => a.holder.kind === 'person'},
  storage: {title:'Storage / Spare Assets', test:a => a.holder.kind === 'storage' && !isOut(a)},
  health:  {title:'Faulty / Aged Assets',   test:a => !isOut(a) && (isFaulty(a) || isAged(a))},
  awaiting:{title:'Assets Awaiting Return', test:a => !!openReturnOf(a.id)},
  transit: {title:'Assets In Transit',      test:a => a.holder.kind === 'transit'},
};
const serviceName = id => (service(id) || {}).name || '';
const roleName = id => (role(id) || {}).name || '';
const roomObjs = rid => [...db.desks.filter(k => k.roomId === rid), ...db.items.filter(i => i.roomId === rid)];
const office = id => byId(db.offices, id);
const account = id => byId(db.accounts, id);
const officeRooms = oid => db.rooms.filter(r => r.officeId === oid);
function currentAccount(){
  let id = ''; try { id = localStorage.getItem(ACCOUNT_KEY) || ''; } catch(e) {}
  const a = account(id);
  return a && a.enabled ? a : db.accounts.find(x => x.enabled && x.role === 'Superadmin') || db.accounts[0];
}
const currentUser = () => (currentAccount() || {}).displayName || '';
// the template values frozen into a document when it is created
function tplSnapshot(kind, s){
  return {title:s.docTitles[kind], text:s[{out:'outText', in:'inText', swap:'swapText'}[kind]], footer:s.docFooter, show:{...s.docShow}, company:s.company, address:s.address, logoId:s.branding.logoId};
}

// ---------- where an asset is ----------
// holder: storage | person (checked out) | office (room pool, not on a desk) | desk (placed on a desk / in a rack)
// | site (at an office, no room yet) | transit (on its way in a shipment: at neither office)
// placement: a Hybrid person's asset may additionally sit on a desk without leaving the person
function holderKey(h){ return h.kind === 'storage' ? 'storage' : h.kind + ':' + h.id; }
function parseHolder(s){ if (!s || s === 'storage') return {kind:'storage'}; const [kind, id] = s.split(':'); return {kind, id}; }
const furnIcon = k => k.kind === 'rack' ? '🗄️' : '🪑';
function deskOwnerText(k){
  if (k.kind === 'rack') return '';
  const p = k.personId ? person(k.personId) : null;
  if (p) return p.name + "'s desk";
  return k.shared ? k.sharedNote || 'shared / shift' : '';
}
function holderText(h){
  if (!h || h.kind === 'storage') return '📦 In Stock';
  if (h.kind === 'person'){ const p = person(h.id); return p ? `👤 ${p.name} (${p.mode})` : '❓ Unknown person'; }
  if (h.kind === 'site'){ const o = office(h.id); return o ? `🏢 ${o.name} – not placed yet` : '❓ Unknown office'; }
  if (h.kind === 'transit'){ const s = findShipment(h.id); return s ? `🚚 In transit: ${(office(s.fromOfficeId) || {}).name || '?'} → ${(office(s.toOfficeId) || {}).name || '?'}` : '🚚 In transit'; }
  if (h.kind === 'office'){ const r = room(h.id); return r ? `🏢 ${roomPath(r)} – room pool` : '❓ Unknown room'; }
  if (h.kind === 'desk'){
    const k = desk(h.id); if (!k) return '❓ Unknown location';
    const r = room(k.roomId), o = deskOwnerText(k);
    return `${furnIcon(k)} ${r ? roomPath(r) : '?'} › ${k.label}` + (o ? ` – ${o}` : '');
  }
  return '?';
}
const roomPath = r => `${(office(r.officeId) || {}).name || '?'} › ${r.name}`;
const findShipment = id => { for (const pr of db.projects){ const s = pr.shipments.find(x => x.id === id); if (s) return s; } return null; };
const shipmentProject = id => db.projects.find(pr => pr.shipments.some(x => x.id === id));
function placementText(a){
  const k = a.placement && desk(a.placement.deskId);
  return k ? `🪑 on desk: ${(room(k.roomId) || {}).name || '?'} › ${k.label}` : '';
}
const whereText = a => holderText(a.holder) + (placementText(a) ? ' · ' + placementText(a) : '');
function holderHref(h){
  if (!h || h.kind === 'storage') return '#/assets?view=storage';
  if (h.kind === 'person') return '#/person/' + h.id;
  if (h.kind === 'office') return '#/room/' + h.id;
  if (h.kind === 'site') return '#/rooms?office=' + h.id;
  if (h.kind === 'transit') return '#/assets?view=transit';
  if (h.kind === 'desk'){ const k = desk(h.id); return k ? `#/room/${k.roomId}/${k.id}` : '#/rooms'; }
  return '#/';
}
function holderPerson(h){
  if (h.kind === 'person') return h.id;
  if (h.kind === 'desk'){ const k = desk(h.id); return k && k.personId || null; }
  return null;
}
const assetRoomId = a => a.holder.kind === 'office' ? a.holder.id : a.holder.kind === 'desk' ? (desk(a.holder.id) || {}).roomId
  : a.placement ? (desk(a.placement.deskId) || {}).roomId : null;
const assetOfficeId = a => a.holder.kind === 'site' ? a.holder.id : (room(assetRoomId(a)) || {}).officeId || null;
const sitePool = oid => db.assets.filter(a => a.holder.kind === 'site' && a.holder.id === oid);

// every holder change goes through here so the log category is always right
function setHolder(a, h, extra = {}){
  const before = holderText(a.holder), wasPerson = a.holder.kind === 'person' ? a.holder.id : null;
  const nowPerson = h.kind === 'person' ? h.id : null;
  a.holder = h;
  if (nowPerson !== wasPerson || !nowPerson) a.placement = null;
  const after = holderText(h);
  if (before === after) return;
  a.assignedAt = ['storage', 'office', 'site', 'transit'].includes(h.kind) ? null : Date.now();
  const cat = nowPerson ? 'checkout' : wasPerson ? 'returned' : 'moved';
  log(a.id, `${{checkout:'Checked out', returned:'Returned', moved:'Moved'}[cat]}: ${before} → ${after}`, cat, {...extra, personId:nowPerson || wasPerson});
  if (wasPerson && wasPerson !== nowPerson) closeReturns(a.id, wasPerson);
  const np = nowPerson && person(nowPerson);
  if (np && np.status !== 'Active') openReturn(a.id, np.id, 'status');
}

// ---------- expected returns: one record type for user status and project replacements ----------
const openReturnOf = assetId => db.returns.find(r => r.assetId === assetId && r.state === 'awaiting');
const personReturns = pid => db.returns.filter(r => r.personId === pid && r.state !== 'cancelled');
const openReturns = pid => personReturns(pid).filter(r => r.state === 'awaiting');
// the deadline comes from a date that already exists; without one the record says so instead of inventing a date
function returnDue(r){
  if (r.due) return r.due;
  const p = person(r.personId);
  if (!p || !r.sources.includes('status')) return '';
  return p.status === 'Leaver' ? p.endDate : p.status === 'Suspended' ? (p.suspension || {}).start || '' : '';
}
const returnOverdue = r => { const d = returnDue(r); return r.state === 'awaiting' && !!d && d < new Date().toISOString().slice(0, 10); };
function returnBadge(r){
  if (r.state !== 'awaiting') return '';
  const d = returnDue(r);
  return !d ? ' <small class="muted">No deadline set</small>' : ` <small style="color:var(--${returnOverdue(r) ? 'danger' : 'warn'})">due ${d}${returnOverdue(r) ? ' – overdue' : ''}</small>`;
}
const returnCls = r => r.state === 'returned' ? 'ok' : r.state !== 'awaiting' ? '' : returnOverdue(r) ? 'bad' : returnDue(r) ? 'warn' : '';
const currentReturn = assetId => db.returns.find(r => r.assetId === assetId && (r.state === 'awaiting' || r.state === 'notRequired'));
function openReturn(assetId, personId, source, extra = {}){
  let r = db.returns.find(x => x.assetId === assetId && x.personId === personId && (x.state === 'awaiting' || x.state === 'notRequired'));
  if (r){
    if (!r.sources.includes(source)) r.sources.push(source);
    if (extra.projectId) r.projectId = extra.projectId;
    if (extra.ticket) r.ticket = extra.ticket;
    if (extra.due) r.due = extra.due;
    if (extra.keepState !== true) r.state = 'awaiting';
    return r;
  }
  r = {id:uid(), assetId, personId, state:'awaiting', sources:[source], projectId:extra.projectId || null, ticket:extra.ticket || '', due:extra.due || '', openedAt:Date.now(), closedAt:null};
  db.returns.push(r);
  log(assetId, `Return expected from ${(person(personId) || {}).name || '?'} (${source === 'status' ? 'user status' : 'replacement'})`, 'updated', {personId, projectId:r.projectId});
  return r;
}
// the actual return: only setHolder gets here, so "Returned" always means the asset really came back
function closeReturns(assetId, personId){
  for (const r of db.returns) if (r.assetId === assetId && r.personId === personId && (r.state === 'awaiting' || r.state === 'notRequired')){
    r.state = 'returned'; r.closedAt = Date.now();
    log(assetId, `Return completed from ${(person(personId) || {}).name || '?'}`, 'returned', {personId, projectId:r.projectId});
  }
}
function setReturnState(r, state){
  if (r.state === state || (state !== 'awaiting' && state !== 'notRequired')) return;
  r.state = state;
  log(r.assetId, `Return state: ${RETURN_STATE[state]}`, 'updated', {personId:r.personId, projectId:r.projectId});
}
// changing the status never moves an asset: it only opens or cancels the expectation
function setUserStatus(p, status, ticket, note){
  const old = p.status;
  if (old === status) return;
  p.status = status;
  log(null, `User status of ${p.name}: ${old} → ${status}${ticket ? ` (ticket ${ticket})` : ''}${note ? ` – ${note}` : ''}`, 'status', {personId:p.id});
  if (status !== 'Active') for (const a of personAssets(p.id).direct) openReturn(a.id, p.id, 'status', {ticket});
  else for (const r of db.returns.filter(x => x.personId === p.id && x.state !== 'returned' && x.state !== 'cancelled' && x.sources.includes('status'))){
    r.sources = r.sources.filter(s => s !== 'status');
    if (!r.sources.length){ r.state = 'cancelled'; r.closedAt = Date.now(); log(r.assetId, 'Return expectation cancelled: user is Active again', 'updated', {personId:p.id}); }
  }
}
function setPlacement(a, deskId){
  const k = deskId && desk(deskId), old = placementText(a);
  a.placement = k ? {deskId:k.id} : null;
  const p = person(a.holder.id);
  log(a.id, k ? `Placed on desk: ${(room(k.roomId) || {}).name} › ${k.label} (stays with ${p ? p.name : '?'})` : `Removed from desk (${old}) – stays with ${p ? p.name : '?'}`, 'moved');
}

function personAssets(pid){
  const deskIds = db.desks.filter(k => k.personId === pid).map(k => k.id);
  return {
    direct: db.assets.filter(a => a.holder.kind === 'person' && a.holder.id === pid),
    onDesk: db.assets.filter(a => a.holder.kind === 'desk' && deskIds.includes(a.holder.id)),
    desks: db.desks.filter(k => k.personId === pid),
  };
}
// everything that physically sits on a desk: its own assets + Hybrid assets placed there
const deskAssets = did => db.assets.filter(a => (a.holder.kind === 'desk' && a.holder.id === did) || (a.placement && a.placement.deskId === did));
const officePool = rid => db.assets.filter(a => a.holder.kind === 'office' && a.holder.id === rid);
// assets of people working in the given mode, belonging to a service linked to the office
function modePool(rid, mode){
  const r = room(rid); if (!r) return [];
  return db.assets.filter(a => {
    if (a.holder.kind !== 'person') return false;
    const p = person(a.holder.id);
    return p && modeBehavior(p.mode) === mode && (r.serviceIds.includes(p.serviceId) || r.serviceIds.includes(a.serviceId));
  });
}

// ---------- log ----------
function log(assetId, text, cat = 'updated', extra = {}){
  db.log.unshift({id:uid(), ts:Date.now(), cat, assetId:assetId || null, projectId:extra.projectId || null, personId:extra.personId || null, text, by:currentUser()});
  if (db.log.length > 8000) db.log.length = 8000;
}
const plog = (projectId, text) => log(null, text, 'project', {projectId});
const clog = text => log(null, text, 'config');

// ---------- warranty ----------
const fmtDate = s => s || '–';
function warranty(a){
  if (!a.warrantyUntil) return {cls:'', text:'–', days:null};
  const days = Math.ceil((new Date(a.warrantyUntil + 'T23:59:59') - Date.now()) / 864e5);
  if (days < 0) return {cls:'bad', text:'Expired (' + fmtDate(a.warrantyUntil) + ')', days};
  if (days <= 60) return {cls:'warn', text:`expires in ${days} days`, days};
  return {cls:'ok', text:'until ' + fmtDate(a.warrantyUntil), days};
}

// ---------- custom fields ----------
// active fields of every field set assigned to the type, in the set's own order
function fieldsForType(typeId){
  const out = [];
  for (const s of db.fieldSets) if (s.typeIds.includes(typeId)) for (const f of s.fields) if (f.active) out.push({...f, setName:s.name});
  return out;
}
function fieldValueText(f, v){
  if (v === undefined || v === null || v === '') return '–';
  if (f.kind === 'bool') return v ? 'Yes' : 'No';
  if (f.kind === 'date') return fmtDate(v);
  return String(v);
}

// ---------- signed files (IndexedDB, because PDFs are too big for localStorage) ----------
const idb = (() => {
  let p;
  const open = () => p ||= new Promise((res, rej) => {
    const r = indexedDB.open('itraktar_files', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = async (mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction('files', mode), req = fn(t.objectStore('files'));
      t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error);
    });
  };
  return {
    get: k => tx('readonly', s => s.get(k)),
    put: (k, v) => tx('readwrite', s => s.put(v, k)),
    del: k => tx('readwrite', s => s.delete(k)),
    clear: () => tx('readwrite', s => s.clear()),
  };
})();
const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

restoreTourBackup();
db = load();
