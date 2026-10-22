/* storage.js — Serialization v7, GitHub + Local mode, merge */
'use strict';

const DATA_FILE_NAME = 'data-v7.json';
const PENDING_KEY = 'wh_pending_state_v7';
const GH_CONFIG_KEY = 'wh_github_config_v7';
const STORAGE_MODE_KEY = 'wh_storage_mode_v7';
const LOCAL_DATA_KEY = 'wh_local_data_v7';

const DEFAULT_UNITS = [{v:'kg',l:'کیلوگرم',factor:1}];
const DEFAULT_PRODUCTS = [{name:'شکر',unit:'kg',subtypes:[]}];

// ⚠️ برای جلوگیری از نمایش صفحه راه‌اندازی بعد از پاک کردن کش، توکن را اینجا بگذارید
// مثال: const DEFAULT_GH_TOKEN = 'github_pat_123456789...';
const DEFAULT_GH_OWNER = 'ghandsenobar';
const DEFAULT_GH_REPO = 'Warehouse';
const DEFAULT_GH_TOKEN = ''; 

let ghConfig = {owner: DEFAULT_GH_OWNER, repo: DEFAULT_GH_REPO, token: DEFAULT_GH_TOKEN};
let ghFileSha = null;
let ghFileSize = 0;
let ghCanWrite = null;

/* ─── Storage mode ─── */
function getStorageMode(){ return localStorage.getItem(STORAGE_MODE_KEY) || 'github'; }
function setStorageMode(mode){ localStorage.setItem(STORAGE_MODE_KEY, mode); }
function isLocalMode(){ return getStorageMode() === 'local'; }

function loadGhConfig(){
  try{
    const saved = JSON.parse(localStorage.getItem(GH_CONFIG_KEY)||'{}');
    ghConfig.owner = saved.owner || DEFAULT_GH_OWNER;
    ghConfig.repo = saved.repo || DEFAULT_GH_REPO;
    ghConfig.token = saved.token || DEFAULT_GH_TOKEN;
  }catch(e){
    ghConfig.owner = DEFAULT_GH_OWNER;
    ghConfig.repo = DEFAULT_GH_REPO;
    ghConfig.token = DEFAULT_GH_TOKEN;
  }
}
function saveGhConfig(){
  try{ localStorage.setItem(GH_CONFIG_KEY, JSON.stringify(ghConfig)); }catch(e){}
}
function hasGhConfig(){
  if(isLocalMode()) return true;
  return !!(ghConfig.token && ghConfig.owner && ghConfig.repo);
}

/* Base64 UTF-8 helpers */
function utf8ToBase64(str){
  const utf8 = new TextEncoder().encode(str);
  let bin = ''; const chunk = 0x8000;
  for(let i=0;i<utf8.length;i+=chunk){
    bin += String.fromCharCode.apply(null, utf8.subarray(i, Math.min(i+chunk, utf8.length)));
  }
  return btoa(bin);
}
function base64ToUtf8(b64){
  const clean = b64.replace(/\s/g,'');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

/* === Serialize v7 === */
function serializeState(state){
  const allUnits = new Map();
  (state.unitsList||[]).forEach(u=>allUnits.set(u.v,{label:u.l,factor:u.factor}));
  (state.products||[]).forEach(p=>{if(p.unit&&!allUnits.has(p.unit))allUnits.set(p.unit,{label:p.unit,factor:null});});
  (state.records||[]).forEach(r=>{if(r.unit&&!allUnits.has(r.unit))allUnits.set(r.unit,{label:r.unit,factor:null});});
  const units=[], unitId=new Map(); let uId=0;
  allUnits.forEach((v,code)=>{ uId++; unitId.set(code,uId);
    const o={i:uId,c:code,n:v.label};
    if(v.factor!==null&&v.factor!==undefined) o.f=v.factor;
    units.push(o);
  });
  const allProducts = new Map();
  (state.products||[]).forEach(p=>allProducts.set(p.name,{unit:p.unit||'',subtypes:(p.subtypes||[]).slice(),updatedAt:p.updatedAt||0}));
  (state.records||[]).forEach(r=>{if(r.product&&!allProducts.has(r.product))allProducts.set(r.product,{unit:r.unit||'',subtypes:[],updatedAt:0});});
  const products=[], prodId=new Map(); let pId=0;
  allProducts.forEach((v,name)=>{ pId++; prodId.set(name,pId);
    const o={i:pId,n:name,m:v.updatedAt||0};
    const uid2=unitId.get(v.unit); if(uid2) o.u=uid2;
    if(v.subtypes&&v.subtypes.length) o.s=v.subtypes.slice();
    products.push(o);
  });
  const allSellers=new Set(state.sellers||[]);
  const allBuyers=new Set(state.buyers||[]);
  const allDrivers=new Set(state.drivers||[]);
  (state.records||[]).forEach(r=>{
    if(r.party&&r.type==='in') allSellers.add(r.party);
    if(r.party&&r.type==='out') allBuyers.add(r.party);
    if(r.driver) allDrivers.add(r.driver);
  });
  const sellers=[], sellerId=new Map(); let sId=0;
  allSellers.forEach(n=>{ sId++; sellerId.set(n,sId); sellers.push({i:sId,n}); });
  const buyers=[], buyerId=new Map(); let bId=0;
  allBuyers.forEach(n=>{ bId++; buyerId.set(n,bId); buyers.push({i:bId,n}); });
  const drivers=[], driverId=new Map(); let dId=0;
  allDrivers.forEach(n=>{ dId++; driverId.set(n,dId); drivers.push({i:dId,n}); });
  const outRecords=(state.records||[]).map(r=>{
    const o={
      i:r.id, t:r.type==='in'?0:1,
      d:r.date||'', h:r.time||'',
      q:String(r.quantity||''), m:r.updatedAt||r.id
    };
    if(r.product){const x=prodId.get(r.product); if(x) o.p=x;}
    if(r.subtype) o.st=r.subtype;
    if(r.unit){const x=unitId.get(r.unit); if(x) o.u=x;}
    if(r.totalWeight!==undefined&&r.totalWeight!==null&&String(r.totalWeight).trim()!=='') o.w=String(r.totalWeight);
    if(r.party){
      if(r.type==='in'){const x=sellerId.get(r.party); if(x) o.a=x;}
      else{const x=buyerId.get(r.party); if(x) o.a=x;}
    }
    if(r.driver){const x=driverId.get(r.driver); if(x) o.v=x;}
    if(r.invoiceNumber) o.n=r.invoiceNumber;
    if(r.basilNumber) o.b=r.basilNumber;
    if(r.waybillNumber) o.y=r.waybillNumber;
    if(r.notes) o.c=r.notes;
    if(r.deleted) o.x=1;
    if(r.createdBy) o.cb=r.createdBy;
    if(r.createdByName) o.cbn=r.createdByName;
    if(r.createdAt) o.ct=r.createdAt;
    if(r.updatedBy) o.ub=r.updatedBy;
    if(r.updatedByName) o.ubn=r.updatedByName;
    return o;
  });
  const users=(state.users||[]).map(u=>({
    i:u.id, n:u.username, ph:u.passwordHash, s:u.salt,
    dn:u.displayName||u.username, r:u.role||'operator',
    a:u.active?1:0, c:u.createdAt||0, cb:u.createdBy||'',
    ll:u.lastLogin||0
  }));
  const audit=(state.auditLog||[]).slice(-800).map(a=>({
    t:a.t, a:a.action, by:a.userId, byn:a.userName,
    d:a.detail||'', r:a.recordId||null
  }));
  return {
    v:7,
    epoch: state.dataEpoch||1,
    ts: new Date().toISOString(),
    by: state.currentUser?.username || '',
    units, products, sellers, buyers, drivers,
    records: outRecords,
    users,
    audit,
    del: state.permanentlyDeletedIds||[],
    tomb:{
      p:state.deletedProducts||[], s:state.deletedSellers||[],
      b:state.deletedBuyers||[], d:state.deletedDrivers||[],
      u:state.deletedUnits||[]
    }
  };
}

function deserializeState(raw){
  const empty = {
    records:[], products:[], sellers:[], buyers:[], drivers:[],
    unitsList:[...DEFAULT_UNITS], users:[], auditLog:[],
    permanentlyDeletedIds:[], deletedProducts:[], deletedSellers:[],
    deletedBuyers:[], deletedDrivers:[], deletedUnits:[], dataEpoch:1
  };
  if(!raw||typeof raw!=='object') return empty;

  if(!raw.v || raw.v<7){
    const rawUnits = raw.units||[];
    const unitsList = rawUnits.length
      ? rawUnits.map(u=>({v:u.c,l:u.n||u.c,factor:u.f!==undefined?u.f:null}))
      : [...DEFAULT_UNITS];
    const unitIdToCode = new Map(); rawUnits.forEach(u=>unitIdToCode.set(u.i,u.c));
    const rawProducts = raw.products||[];
    const products = rawProducts.map(p=>({
      name:p.n, unit:p.u?(unitIdToCode.get(p.u)||''):'',
      subtypes:Array.isArray(p.s)?p.s.slice():[], updatedAt:p.m||0
    }));
    const productIdToName = new Map(); rawProducts.forEach(p=>productIdToName.set(p.i,p.n));
    const rawSellers=raw.sellers||[],rawBuyers=raw.buyers||[],rawDrivers=raw.drivers||[];
    const sellers=rawSellers.map(s=>s.n).filter(Boolean);
    const buyers=rawBuyers.map(s=>s.n).filter(Boolean);
    const drivers=rawDrivers.map(s=>s.n).filter(Boolean);
    const sellerIdToName=new Map(rawSellers.map(s=>[s.i,s.n]));
    const buyerIdToName=new Map(rawBuyers.map(s=>[s.i,s.n]));
    const driverIdToName=new Map(rawDrivers.map(s=>[s.i,s.n]));
    const records=(raw.records||[]).map(r=>{
      const isIn=r.t===0;
      const rec={
        id:r.i, type:isIn?'in':'out',
        date:r.d||'', time:r.h||'',
        product:r.p?(productIdToName.get(r.p)||''):'',
        subtype:r.st!==undefined?String(r.st):'',
        quantity:r.q!==undefined?String(r.q):'',
        unit:r.u?(unitIdToCode.get(r.u)||''):'',
        totalWeight:r.w!==undefined?String(r.w):'',
        party:'', driver:r.v?(driverIdToName.get(r.v)||''):'',
        invoiceNumber:r.n||'', basilNumber:r.b||'', waybillNumber:r.y||'',
        notes:r.c||'', updatedAt:r.m||r.i, deleted:r.x===1,
        createdBy:'', createdByName:'سیستم (قدیمی)', createdAt:r.m||r.i,
        updatedBy:'', updatedByName:'سیستم (قدیمی)'
      };
      if(r.a) rec.party = isIn ? (sellerIdToName.get(r.a)||'') : (buyerIdToName.get(r.a)||'');
      return rec;
    });
    return {
      ...empty,
      records, products, sellers, buyers, drivers, unitsList,
      permanentlyDeletedIds: Array.isArray(raw.del)?raw.del.slice():[],
      deletedProducts: Array.isArray(raw.tomb?.p)?raw.tomb.p.slice():[],
      deletedSellers: Array.isArray(raw.tomb?.s)?raw.tomb.s.slice():[],
      deletedBuyers: Array.isArray(raw.tomb?.b)?raw.tomb.b.slice():[],
      deletedDrivers: Array.isArray(raw.tomb?.d)?raw.tomb.d.slice():[],
      deletedUnits: Array.isArray(raw.tomb?.u)?raw.tomb.u.slice():[],
      dataEpoch: typeof raw.epoch==='number'?raw.epoch:1
    };
  }

  const rawUnits=raw.units||[];
  const unitsList=rawUnits.length
    ? rawUnits.map(u=>({v:u.c,l:u.n||u.c,factor:u.f!==undefined?u.f:null}))
    : [...DEFAULT_UNITS];
  const unitIdToCode=new Map(); rawUnits.forEach(u=>unitIdToCode.set(u.i,u.c));
  const rawProducts=raw.products||[];
  const products=rawProducts.map(p=>({
    name:p.n, unit:p.u?(unitIdToCode.get(p.u)||''):'',
    subtypes:Array.isArray(p.s)?p.s.slice():[], updatedAt:p.m||0
  }));
  const productIdToName=new Map(); rawProducts.forEach(p=>productIdToName.set(p.i,p.n));
  const rawSellers=raw.sellers||[],rawBuyers=raw.buyers||[],rawDrivers=raw.drivers||[];
  const sellers=rawSellers.map(s=>s.n).filter(Boolean);
  const buyers=rawBuyers.map(s=>s.n).filter(Boolean);
  const drivers=rawDrivers.map(s=>s.n).filter(Boolean);
  const sellerIdToName=new Map(rawSellers.map(s=>[s.i,s.n]));
  const buyerIdToName=new Map(rawBuyers.map(s=>[s.i,s.n]));
  const driverIdToName=new Map(rawDrivers.map(s=>[s.i,s.n]));
  const records=(raw.records||[]).map(r=>{
    const isIn=r.t===0;
    const rec={
      id:r.i, type:isIn?'in':'out',
      date:r.d||'', time:r.h||'',
      product:r.p?(productIdToName.get(r.p)||''):'',
      subtype:r.st!==undefined?String(r.st):'',
      quantity:r.q!==undefined?String(r.q):'',
      unit:r.u?(unitIdToCode.get(r.u)||''):'',
      totalWeight:r.w!==undefined?String(r.w):'',
      party:'', driver:r.v?(driverIdToName.get(r.v)||''):'',
      invoiceNumber:r.n||'', basilNumber:r.b||'', waybillNumber:r.y||'',
      notes:r.c||'', updatedAt:r.m||r.i, deleted:r.x===1,
      createdBy:r.cb||'', createdByName:r.cbn||'',
      createdAt:r.ct||r.m||r.i,
      updatedBy:r.ub||'', updatedByName:r.ubn||''
    };
    if(r.a) rec.party = isIn ? (sellerIdToName.get(r.a)||'') : (buyerIdToName.get(r.a)||'');
    return rec;
  });
  const users=(raw.users||[]).map(u=>({
    id:u.i, username:u.n, passwordHash:u.ph, salt:u.s,
    displayName:u.dn||u.n, role:u.r||'operator',
    active:u.a===1, createdAt:u.c||0, createdBy:u.cb||'',
    lastLogin:u.ll||0
  }));
  const auditLog=(raw.audit||[]).map(a=>({
    t:a.t, action:a.a, userId:a.by, userName:a.byn,
    detail:a.d||'', recordId:a.r||null
  }));
  return {
    records, products, sellers, buyers, drivers, unitsList,
    users, auditLog,
    permanentlyDeletedIds:Array.isArray(raw.del)?raw.del.slice():[],
    deletedProducts:Array.isArray(raw.tomb?.p)?raw.tomb.p.slice():[],
    deletedSellers:Array.isArray(raw.tomb?.s)?raw.tomb.s.slice():[],
    deletedBuyers:Array.isArray(raw.tomb?.b)?raw.tomb.b.slice():[],
    deletedDrivers:Array.isArray(raw.tomb?.d)?raw.tomb.d.slice():[],
    deletedUnits:Array.isArray(raw.tomb?.u)?raw.tomb.u.slice():[],
    dataEpoch: typeof raw.epoch==='number'?raw.epoch:1
  };
}

/* === Data API — GitHub or Local === */
async function ghGet(){
  if(isLocalMode()){
    try {
      const raw = localStorage.getItem(LOCAL_DATA_KEY);
      if(!raw){ ghFileSha=null; ghFileSize=0; return null; }
      ghFileSha = 'local';
      ghFileSize = new Blob([raw]).size;
      return JSON.parse(raw);
    } catch(e){ return null; }
  }
  if(!ghConfig.token) throw new Error('no token');
  const url = `https://api.github.com/repos/${ghConfig.owner}/${ghConfig.repo}/contents/${DATA_FILE_NAME}?_=${Date.now()}`;
  let r;
  try{
    r = await fetch(url,{headers:{'Authorization':'Bearer '+ghConfig.token,'Accept':'application/vnd.github+json'}});
  }catch(e){
    const err=new Error('اتصال به شبکه برقرار نشد'); err.isNetwork=true; throw err;
  }
  if(r.status===404){ ghFileSha=null; ghFileSize=0; return null; }
  if(!r.ok){ const err=new Error('HTTP '+r.status); err.status=r.status; throw err; }
  const data = await r.json();
  ghFileSha = data.sha; ghFileSize = data.size||0;
  if(!data.content) throw new Error('محتوای فایل خالی است');
  return JSON.parse(base64ToUtf8(data.content));
}

async function ghPut(payload){
  if(isLocalMode()){
    try {
      const str = JSON.stringify(payload);
      localStorage.setItem(LOCAL_DATA_KEY, str);
      ghFileSha = 'local';
      ghFileSize = new Blob([str]).size;
      return;
    } catch(e){
      throw new Error('حافظه مرورگر پر شده است — از پشتیبان استفاده کنید و رکوردهای قدیمی را حذف کنید');
    }
  }
  if(!ghConfig.token) throw new Error('no token');
  const url = `https://api.github.com/repos/${ghConfig.owner}/${ghConfig.repo}/contents/${DATA_FILE_NAME}`;
  const jsonStr = JSON.stringify(payload);
  const content = utf8ToBase64(jsonStr);
  const body = {
    message: 'Update warehouse v7 — ' + new Date().toISOString(),
    content
  };
  if(ghFileSha) body.sha = ghFileSha;
  let r;
  try{
    r = await fetch(url,{
      method:'PUT',
      headers:{'Authorization':'Bearer '+ghConfig.token,'Accept':'application/vnd.github+json','Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
  }catch(e){
    const err=new Error('اتصال به شبکه برقرار نشد'); err.isNetwork=true; throw err;
  }
  if(!r.ok){
    let t=''; try{ t=await r.text(); }catch(e){}
    const err=new Error('HTTP '+r.status); err.status=r.status; err.body=t; throw err;
  }
  const res = await r.json();
  ghFileSha = res.content.sha; ghFileSize = res.content.size||0;
}

async function checkTokenPermissions(){
  if(isLocalMode()) return { canWrite: true, source: 'local' };
  if(!ghConfig.token) return null;
  try{
    const url=`https://api.github.com/repos/${ghConfig.owner}/${ghConfig.repo}`;
    const r = await fetch(url,{headers:{'Authorization':'Bearer '+ghConfig.token,'Accept':'application/vnd.github+json'}});
    if(!r.ok) return {canWrite:null, status:r.status};
    const data = await r.json();
    const perms = data.permissions||{};
    if(typeof perms.push==='boolean') return {canWrite:perms.push};
    return {canWrite:null};
  }catch(e){ return null; }
}

/* === Merge helpers === */
function mergeRecordsById(local, remote, tombstones){
  const stones = new Set(tombstones||[]);
  const map = new Map();
  (remote||[]).forEach(r=>{
    if(!r||r.id==null||stones.has(r.id)) return;
    map.set(r.id, {...r});
  });
  (local||[]).forEach(r=>{
    if(!r||r.id==null||stones.has(r.id)) return;
    const ex = map.get(r.id);
    if(!ex){ map.set(r.id, {...r}); return; }
    const lt = r.updatedAt||0, rt = ex.updatedAt||0;
    if(lt>=rt) map.set(r.id, {...r});
  });
  return Array.from(map.values());
}
function mergeUnique(a,b){ return Array.from(new Set([...(a||[]),...(b||[])])); }
function mergeProductsList(a,b){
  const map=new Map();
  const mergeOne=p=>{
    if(!p||!p.name)return;
    const ex=map.get(p.name);
    if(!ex){map.set(p.name,{...p,subtypes:[...(p.subtypes||[])]});return;}
    if(!ex.unit&&p.unit)ex.unit=p.unit;
    ex.subtypes=Array.from(new Set([...(ex.subtypes||[]),...(p.subtypes||[])]));
  };
  [...(a||[])].forEach(mergeOne);
  [...(b||[])].forEach(mergeOne);
  return Array.from(map.values());
}
function mergeWithTombstones(a,b,tombstones){
  const stones=new Set((tombstones||[]).map(x=>String(x||'').trim()).filter(Boolean));
  const set=new Set();
  [...(a||[]),...(b||[])].forEach(x=>{
    const v=String(x||'').trim();
    if(v&&!stones.has(v))set.add(v);
  });
  return Array.from(set);
}
function mergeProductsRespectingTombstones(localProds, remoteProds, tombstones){
  const stones=new Set((tombstones||[]).map(x=>String(x||'').trim()).filter(Boolean));
  const map=new Map();
  (remoteProds||[]).forEach(p=>{
    if(!p||!p.name||stones.has(p.name))return;
    map.set(p.name,{...p,subtypes:[...(p.subtypes||[])]});
  });
  (localProds||[]).forEach(p=>{
    if(!p||!p.name||stones.has(p.name))return;
    const ex=map.get(p.name);
    if(!ex){map.set(p.name,{...p,subtypes:[...(p.subtypes||[])]});}
    else{
      const lt=p.updatedAt||0, rt=ex.updatedAt||0;
      if(lt>=rt) map.set(p.name,{...p,subtypes:[...(p.subtypes||[])]});
    }
  });
  return Array.from(map.values());
}
function mergeUnitsRespectingTombstones(localUnits, remoteUnits, tombstones){
  const stones=new Set((tombstones||[]).map(x=>String(x||'').trim()).filter(Boolean));
  const map=new Map();
  (remoteUnits||[]).forEach(u=>{ if(!u||!u.v||stones.has(u.v))return; map.set(u.v,{...u}); });
  (localUnits||[]).forEach(u=>{ if(!u||!u.v||stones.has(u.v))return; map.set(u.v,{...u}); });
  return Array.from(map.values());
}

/* === Pending state === */
function savePendingState(state){
  try{
    const payload = serializeState(state);
    payload.ts = Date.now();
    localStorage.setItem(PENDING_KEY, JSON.stringify(payload));
  }catch(e){}
}
function loadPendingState(){
  try{
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch(e){ return null; }
}
function clearPendingState(){ try{ localStorage.removeItem(PENDING_KEY); }catch(e){} }