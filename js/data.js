'use strict';
/* IT Raktár – adatréteg: konstansok, tárolás (localStorage + IndexedDB), v1 → v2 migráció, demo adatok, helyek és naplózás.
   Szerver nélkül fut: minden adat a böngészőben marad. */

const KEY = 'itraktar_v2';
const KEY_V1 = 'itraktar_v1';
const TOUR_BACKUP = KEY + '_tour_backup';
const USER_KEY = 'itraktar_user';

const MODES = ['Onsite', 'Hybrid', 'WFH'];
const MODE_ICON = {Onsite:'🏢', Hybrid:'🔀', WFH:'🏠'};
const STATUS = {
  ok:      {label:'Működik',       cls:'ok'},
  repair:  {label:'Javítás alatt', cls:'warn'},
  lost:    {label:'Elveszett',     cls:'bad'},
  retired: {label:'Selejtezett',   cls:'bad'},
};
const ROOM_KINDS = {office:'🏢 Iroda', server:'🗄️ Szerverszoba', storage:'📦 Raktárhelyiség', meeting:'👥 Tárgyaló'};
const OBJ = {
  desk: {label:'Asztal', w:160, h:90},
  rack: {label:'Rack',   w:90,  h:150},
  door: {label:'Ajtó',   w:70,  h:12},
};
const FIELD_KINDS = {text:'Szöveg', number:'Szám', date:'Dátum', bool:'Igen/nem', select:'Legördülő lista'};
const LOG_CATS = {created:'Created', updated:'Updated', moved:'Moved', checkout:'Checkout', returned:'Returned', project:'Project activity'};
const PROJECT_STATUS = {planning:'Tervezés', progress:'Előkészítés alatt', ready:'Átvételre kész', completed:'Befejezve', cancelled:'Megszakítva'};
const PREP_STATUS = ['', 'Waiting for Erase', 'Erase done', 'Imaging', 'Ready'];
// accessories tracked only as a checklist – never inventory, never an Asset ID
const CHECKLIST = [['keyboard', 'Keyboard'], ['mouse', 'Mouse'], ['lan', 'LAN cable'], ['power', 'Power cable'], ['hdmi', 'HDMI'], ['display', 'Display cable'], ['usbb', 'USB-B']];
// built-in types; 'pc' and 'monitor' are used by Projects, so they cannot be deleted
const DEFAULT_TYPES = [
  {id:'monitor', name:'Monitor', icon:'🖥️', system:true},
  {id:'pc', name:'Számítógép', icon:'💻', system:true},
  {id:'headset', name:'Fejhallgató', icon:'🎧'},
  {id:'dock', name:'Dokkoló', icon:'🔌'},
  {id:'keyboard', name:'Billentyűzet/egér', icon:'⌨️'},
  {id:'phone', name:'Telefon', icon:'📱'},
  {id:'printer', name:'Nyomtató', icon:'🖨️'},
  {id:'switch', name:'Switch', icon:'🔀'},
  {id:'router', name:'Router / tűzfal', icon:'🛡️'},
  {id:'server', name:'Szerver', icon:'🗄️'},
  {id:'ups', name:'Szünetmentes (UPS)', icon:'🔋'},
  {id:'other', name:'Egyéb', icon:'📦'},
];
const DOC_KINDS = {
  out: {label:'Átadás-átvételi', title:'Eszköz átadás-átvételi jegyzőkönyv', prefix:'ÁA'},
  in:  {label:'Visszavételi',    title:'Eszköz visszavételi jegyzőkönyv',    prefix:'VV'},
  swap:{label:'Eszközcsere',     title:'Eszközcsere jegyzőkönyv',            prefix:'CS'},
};
const SWAP_REASONS = {broken:'Meghibásodás', damaged:'Sérülés', lost:'Elvesztés / lopás', upgrade:'Fejlesztés (újabbra csere)', other:'Egyéb'};
const DEFAULT_SETTINGS = {
  company:'', address:'', handler:'',
  outText:'Alulírott átvevő aláírásommal igazolom, hogy a fent felsorolt eszközöket hiánytalanul, működőképes állapotban átvettem. ' +
    'Vállalom, hogy az eszközöket rendeltetésszerűen, munkavégzés céljára használom, megóvásukról gondoskodom, és az esetleges meghibásodást, ' +
    'elvesztést vagy eltulajdonítást haladéktalanul jelzem az IT részére. Tudomásul veszem, hogy munkaviszonyom megszűnésekor, illetve a munkáltató ' +
    'kérésére az eszközöket hiánytalanul visszaszolgáltatom, és az általam okozott kárért a munkajogi szabályok szerint felelősséggel tartozom.',
  inText:'Alulírottak igazolják, hogy a fent felsorolt eszközök visszaszolgáltatása a mai napon megtörtént. Az eszközök visszavételkori ' +
    'állapotára vonatkozó észrevételek a táblázatban kerültek rögzítésre. A visszaadott eszközökért a munkavállaló felelőssége megszűnik.',
  swapText:'Alulírottak igazolják, hogy a fenti lecserélt eszköz visszavétele, és helyette a csereeszköz átadása a mai napon megtörtént. ' +
    'A csereeszközre a munkavállaló az eredeti átadás-átvételi jegyzőkönyvben vállalt felelősséggel azonos módon felel; ' +
    'a lecserélt eszközért való felelőssége a visszavétellel megszűnik.',
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
  catch(e){ alert('Nem sikerült menteni a böngészőbe (valószínűleg megtelt a tárhely – túl sok/nagy kép?): ' + e.message); return false; }
}
function gcImages(){
  const used = new Set([...db.models.map(m => m.imageId), ...db.assets.map(a => a.imageId)].filter(Boolean));
  for (const k of Object.keys(db.images)) if (!used.has(k)) delete db.images[k];
}
function save(){ gcImages(); persist(db); }

// v1 (single html) and v2 data are both brought to the current shape
function migrate(d){
  for (const k of ['people', 'rooms', 'desks', 'assets', 'log', 'items', 'docs', 'swaps', 'services', 'roles', 'models', 'fieldSets', 'projects']) d[k] ||= [];
  d.images ||= {}; d.seq ||= {asset:0};
  d.settings = {...DEFAULT_SETTINGS, ...(d.settings || {})};
  if (!d.types || !d.types.length) d.types = DEFAULT_TYPES.map(t => ({...t}));
  for (const t of DEFAULT_TYPES) if (t.system && !d.types.some(x => x.id === t.id)) d.types.unshift({...t});
  if ((d.version || 1) < 2) migrateV1(d);
  for (const r of d.rooms){ r.kind ||= 'office'; r.serviceIds ||= []; }
  for (const k of d.desks){ k.kind ||= 'desk'; if (k.shared === undefined) k.shared = false; if (k.port === undefined) k.port = ''; }
  for (const a of d.assets){ a.custom ||= {}; if (a.placement === undefined) a.placement = null; if (a.serviceId === undefined) a.serviceId = null; }
  for (const p of d.people) if (!MODES.includes(p.mode)) p.mode = 'Onsite';
  for (const s of d.fieldSets){ s.typeIds ||= []; s.fields ||= []; }
  for (const pr of d.projects) for (const x of pr.participants || []){ x.checklist ||= {}; x.prep ||= {}; x.otherIds ||= []; x.manualSerial ||= {}; }
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
    const name = (a.model || '').trim() || 'Ismeretlen modell', key = a.type + '|' + name.toLowerCase();
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
  const d = {version:2, seq:{asset:0}, services:[], roles:[], people:[], rooms:[], desks:[], items:[], types:DEFAULT_TYPES.map(t => ({...t})),
    models:[], fieldSets:[], assets:[], docs:[], swaps:[], projects:[], log:[], images:{},
    settings:{...DEFAULT_SETTINGS, company:'Példa Kft.', address:'1234 Példaváros, Fő utca 1.', handler:'IT Support'}};
  const now = Date.now(), day = 864e5, iso = t => new Date(t).toISOString().slice(0, 10);
  const S = name => { const s = {id:uid(), name, note:''}; d.services.push(s); return s; };
  const cs = S('Customer Support'), its = S('IT Support'), fin = S('Finance'), dev = S('Development');
  const Ro = name => { const r = {id:uid(), name}; d.roles.push(r); return r; };
  const agent = Ro('Agent'), tl = Ro('TeamLeader'), devr = Ro('Developer'), itr = Ro('IT Specialist');
  const P = (name, email, svc, role, mode) => { const p = {id:uid(), name, email, serviceId:svc.id, roleId:role.id, mode, note:''}; d.people.push(p); return p; };
  const kiss = P('Kiss Péter', 'kiss.peter@ceg.hu', dev, devr, 'Onsite');
  const nagy = P('Nagy Anna', 'nagy.anna@ceg.hu', dev, devr, 'Hybrid');
  const toth = P('Tóth Gábor', 'toth.gabor@ceg.hu', fin, agent, 'WFH');
  const szabo = P('Szabó Eszter', 'szabo.eszter@ceg.hu', cs, tl, 'Onsite');
  const horvath = P('Horváth Dávid', 'horvath.david@ceg.hu', cs, agent, 'WFH');
  const varga = P('Varga Júlia', 'varga.julia@ceg.hu', cs, agent, 'Hybrid');
  const molnar = P('Molnár Tamás', 'molnar.tamas@ceg.hu', its, itr, 'Onsite');
  const kovacs = P('Kovács Bence', '', cs, agent, 'Onsite');
  const farkas = P('Farkas Lili', '', cs, agent, 'Hybrid');
  const R = (name, floor, kind, w, h, svcs) => { const r = {id:uid(), name, floor, kind, w, h, serviceIds:svcs.map(s => s.id)}; d.rooms.push(r); return r; };
  const r1 = R('2.12 – Fejlesztői iroda', '2. emelet', 'office', 900, 500, [dev, its]);
  const r2 = R('1.04 – Ügyfélszolgálat', '1. emelet', 'office', 760, 440, [cs]);
  const srv = R('0.01 – Szerverszoba', 'Földszint', 'server', 520, 340, [its]);
  const D = (room, kind, label, x, y, extra = {}) => { const k = {id:uid(), roomId:room.id, kind, label, x, y, w:OBJ[kind].w, h:OBJ[kind].h, personId:null, shared:false, port:'', ...extra}; d.desks.push(k); return k; };
  const I = (room, kind, label, x, y, extra = {}) => { const it = {id:uid(), roomId:room.id, kind, label, x, y, w:OBJ[kind].w, h:OBJ[kind].h, ...extra}; d.items.push(it); return it; };
  const a1 = D(r1, 'desk', 'A1', 40, 60, {personId:kiss.id, port:'R4-5-15'}), a2 = D(r1, 'desk', 'A2', 220, 60, {personId:nagy.id, port:'R4-5-16'});
  const a3 = D(r1, 'desk', 'A3', 400, 60, {port:'R4-5-17'});
  D(r1, 'desk', 'B1', 40, 240, {port:'R4-5-21'}); const b2 = D(r1, 'desk', 'B2', 220, 240, {personId:molnar.id, port:'R4-5-22'});
  I(r1, 'door', 'Bejárat', 780, 0);
  const shift = 'Customer Support – 2 műszak';
  const u = [1, 2, 3, 4, 5].map(i => D(r2, 'desk', 'Ü' + i, 40 + (i - 1) % 3 * 200, i <= 3 ? 60 : 240, {shared:true, sharedNote:shift, port:'R1-4-0' + i}));
  I(r2, 'door', 'Bejárat', 0, 340, {w:12, h:70});
  const rk1 = D(srv, 'rack', 'Rack 1', 60, 80), rk2 = D(srv, 'rack', 'Rack 2', 180, 80);
  I(srv, 'door', 'Bejárat (beléptetős)', 400, 328);
  const models = new Map();
  const M = (typeId, name) => { const k = typeId + '|' + name; if (!models.has(k)){ const m = {id:uid(), typeId, name, imageId:null}; d.models.push(m); models.set(k, m); } return models.get(k).id; };
  let n = 0;
  const A = (type, model, serial, holder, extra = {}) => {
    const arrivedT = now - (60 + Math.floor(Math.random() * 900)) * day;
    const a = {id:uid(), tag:fmtAssetId(++n), type, modelId:M(type, model), serial, status:'ok', holder, placement:null, serviceId:null, custom:{}, note:'',
      arrived:iso(arrivedT), warrantyUntil:iso(arrivedT + 3 * 365 * day), supplier:'Demo Kft.', orderNo:'', created:now,
      assignedAt:holder.kind === 'storage' ? null : arrivedT + 7 * day, ...extra};
    d.assets.push(a);
    d.log.push({id:uid(), ts:now, cat:'created', assetId:a.id, text:'Létrehozva', by:''});
    return a;
  };
  const desk = k => ({kind:'desk', id:k.id}), per = p => ({kind:'person', id:p.id}), office = r => ({kind:'office', id:r.id}), store = {kind:'storage'};
  // custom field sets: groups first, then the fields inside them
  const F = (name, kind, opts = {}) => ({id:uid(), name, kind, required:!!opts.required, options:opts.options || [], active:true});
  const monFs = {id:uid(), name:'Monitor_Fields', typeIds:['monitor'], fields:[F('Gyártó', 'text'), F('Képátló (col)', 'number'),
    F('Felbontás', 'select', {options:['1920×1080', '2560×1440', '3840×2160']}), F('HDMI', 'bool'), F('DisplayPort', 'bool')]};
  const pcFs = {id:uid(), name:'Computer_Fields', typeIds:['pc'], fields:[F('Processzor', 'text'), F('RAM (GB)', 'number'), F('Tárhely (GB)', 'number'),
    F('Operációs rendszer', 'select', {options:['Windows 11 Pro', 'Windows 10 Pro', 'macOS', 'Linux']}), F('Utolsó újratelepítés', 'date')]};
  const phFs = {id:uid(), name:'Phone_Fields', typeIds:['phone'], fields:[F('IMEI', 'text', {required:true}), F('Telefonszám', 'text')]};
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
  const pr = {id:uid(), name:'Customer Support – novemberi belépők', owner:'Molnár Tamás', pickupDate:pick, ticket:'INC-20417',
    note:'2 új agent, az Ü-asztalokhoz.', status:'progress', created:now, completedAt:null, participants:[
      {id:uid(), personId:kovacs.id, pickupDate:pick, computerId:sPc1.id, monitorId:sMon1.id, monitor2Id:null, otherIds:[],
        prep:{computer:'Waiting for Erase', monitor:'Ready'}, manualSerial:{}, checklist:{keyboard:true, mouse:true, power:true}},
      {id:uid(), personId:farkas.id, pickupDate:pick, computerId:sPc2.id, monitorId:sMon2.id, monitor2Id:null, otherIds:[],
        prep:{computer:'Imaging'}, manualSerial:{}, checklist:{}},
    ]};
  d.projects.push(pr);
  d.log.push({id:uid(), ts:now, cat:'project', projectId:pr.id, text:'Projekt létrehozva: ' + pr.name, by:''});
  d.log.reverse();
  return d;
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
const typeOf = id => byId(db.types, id) || {id, name:'Ismeretlen típus', icon:'📦'};
const typeIcon = id => typeOf(id).icon || '📦';
const typeLabel = id => typeOf(id).name;
const modelName = a => (model(a.modelId) || {}).name || '';
const serviceName = id => (service(id) || {}).name || '';
const roleName = id => (role(id) || {}).name || '';
const roomObjs = rid => [...db.desks.filter(k => k.roomId === rid), ...db.items.filter(i => i.roomId === rid)];
const currentUser = () => { try { return localStorage.getItem(USER_KEY) || ''; } catch(e) { return ''; } };

// ---------- where an asset is ----------
// holder: storage | person (checked out) | office (in the office pool, not on a desk) | desk (placed on a desk / in a rack)
// placement: a Hybrid person's asset may additionally sit on a desk without leaving the person
function holderKey(h){ return h.kind === 'storage' ? 'storage' : h.kind + ':' + h.id; }
function parseHolder(s){ if (!s || s === 'storage') return {kind:'storage'}; const [kind, id] = s.split(':'); return {kind, id}; }
const furnIcon = k => k.kind === 'rack' ? '🗄️' : '🪑';
function deskOwnerText(k){
  if (k.kind === 'rack') return '';
  const p = k.personId ? person(k.personId) : null;
  if (p) return p.name + ' asztala';
  return k.shared ? k.sharedNote || 'közös / műszakos' : '';
}
function holderText(h){
  if (!h || h.kind === 'storage') return '📦 Raktárban';
  if (h.kind === 'person'){ const p = person(h.id); return p ? `👤 ${p.name} (${p.mode})` : '❓ Ismeretlen személy'; }
  if (h.kind === 'office'){ const r = room(h.id); return r ? `🏢 ${r.name} – irodai eszközhalmaz` : '❓ Ismeretlen iroda'; }
  if (h.kind === 'desk'){
    const k = desk(h.id); if (!k) return '❓ Ismeretlen hely';
    const r = room(k.roomId), o = deskOwnerText(k);
    return `${furnIcon(k)} ${r ? r.name : '?'} › ${k.label}` + (o ? ` – ${o}` : '');
  }
  return '?';
}
function placementText(a){
  const k = a.placement && desk(a.placement.deskId);
  return k ? `🪑 asztalon: ${(room(k.roomId) || {}).name || '?'} › ${k.label}` : '';
}
const whereText = a => holderText(a.holder) + (placementText(a) ? ' · ' + placementText(a) : '');
function holderHref(h){
  if (!h || h.kind === 'storage') return '#/assets?loc=storage';
  if (h.kind === 'person') return '#/person/' + h.id;
  if (h.kind === 'office') return '#/room/' + h.id;
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

// every holder change goes through here so the log category is always right
function setHolder(a, h, extra = {}){
  const before = holderText(a.holder), wasPerson = a.holder.kind === 'person' ? a.holder.id : null;
  const nowPerson = h.kind === 'person' ? h.id : null;
  a.holder = h;
  if (nowPerson !== wasPerson || !nowPerson) a.placement = null;
  const after = holderText(h);
  if (before === after) return;
  a.assignedAt = h.kind === 'storage' || h.kind === 'office' ? null : Date.now();
  const cat = nowPerson ? 'checkout' : wasPerson ? 'returned' : 'moved';
  log(a.id, `${{checkout:'Kiadva', returned:'Visszavéve', moved:'Áthelyezve'}[cat]}: ${before} → ${after}`, cat, extra);
}
function setPlacement(a, deskId){
  const k = deskId && desk(deskId), old = placementText(a);
  a.placement = k ? {deskId:k.id} : null;
  const p = person(a.holder.id);
  log(a.id, k ? `Asztalra helyezve: ${(room(k.roomId) || {}).name} › ${k.label} (${p ? p.name : '?'}-nál marad)` : `Levéve az asztalról (${old}) – ${p ? p.name : '?'}-nál marad`, 'moved');
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
    return p && p.mode === mode && (r.serviceIds.includes(p.serviceId) || r.serviceIds.includes(a.serviceId));
  });
}

// ---------- log ----------
function log(assetId, text, cat = 'updated', extra = {}){
  db.log.unshift({id:uid(), ts:Date.now(), cat, assetId:assetId || null, projectId:extra.projectId || null, text, by:currentUser()});
  if (db.log.length > 8000) db.log.length = 8000;
}
const plog = (projectId, text) => log(null, text, 'project', {projectId});

// ---------- warranty ----------
const fmtDate = s => s ? s.replace(/-/g, '.') + '.' : '–';
function warranty(a){
  if (!a.warrantyUntil) return {cls:'', text:'–', days:null};
  const days = Math.ceil((new Date(a.warrantyUntil + 'T23:59:59') - Date.now()) / 864e5);
  if (days < 0) return {cls:'bad', text:'Lejárt (' + fmtDate(a.warrantyUntil) + ')', days};
  if (days <= 60) return {cls:'warn', text:`${days} nap múlva lejár`, days};
  return {cls:'ok', text:fmtDate(a.warrantyUntil) + '-ig', days};
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
  if (f.kind === 'bool') return v ? 'Igen' : 'Nem';
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
