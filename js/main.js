/* main.js — main app logic (multi-user) */
'use strict';

let records = [];
let products = [];
let sellers = [];
let buyers = [];
let drivers = [];
let unitsList = [...DEFAULT_UNITS];
let users = [];
let auditLog = [];
let permanentlyDeletedIds = [];
let deletedProducts = [], deletedSellers = [], deletedBuyers = [], deletedDrivers = [], deletedUnits = [];
let dataEpoch = 1;

let currentUser = null;
let currentType = null, editingId = null;
let dirty = false, lastSyncAt = null;
let printFontScale = 100;
let dataMode = 'weighted';
let summaryMode = 'grouped';
let advFilter = { product:'', subtype:'', party:'', driver:'' };
let _searchTimer = null;
let currentPreviewRecordId = null;
let ssProduct = null, ssParty = null, ssDriver = null, ssUnit = null, ssSubtype = null;
let ssAdvProduct = null, ssAdvSubtype = null, ssAdvParty = null, ssAdvDriver = null;

let letterheadCompany = '';
let letterheadCompanyAt = 0;
let letterheadFactory = '';
let letterheadFactoryAt = 0;
let visibleFields = {};
let visibleFieldsAt = 0;
let _isFormListenersAttached = false;

function unitLabel(v){ const u = unitsList.find(x=>x.v===v); return u ? u.l : v || '—'; }
function unitFactor(v){ const u = unitsList.find(x=>x.v===v); return u ? u.factor : null; }
function calcKg(qty, unit){
  const f = unitFactor(unit);
  if(f===null||f===undefined) return 0;
  const q = parseFloat(toLatinDigits(String(qty||'')));
  if(isNaN(q)) return 0;
  return q * f;
}
function getRecordKg(r){
  if(r.totalWeight!==undefined && r.totalWeight!==null && String(r.totalWeight).trim()!==''){
    const w = parseFloat(toLatinDigits(String(r.totalWeight)));
    if(!isNaN(w)) return w;
  }
  return calcKg(r.quantity, r.unit);
}
function productFullName(r){
  if(!r) return '-';
  return r.subtype ? `${r.product||''} ${r.subtype}` : (r.product||'-');
}
function currentRole(){ return currentUser?.role || 'viewer'; }

function isWeightedRecord(r) {
  const f = unitFactor(r.unit);
  return f !== null && f !== undefined;
}
function matchesDataMode(r) {
  const isW = isWeightedRecord(r);
  if (dataMode === 'weighted') return isW;
  if (dataMode === 'numeric') return !isW;
  return true;
}

const ALL_FIELDS = [
  { key: 'date',    label: 'تاریخ',        mandatory: true  },
  { key: 'time',    label: 'ساعت',         mandatory: false },
  { key: 'type',    label: 'نوع',          mandatory: false },
  { key: 'product', label: 'کالا',          mandatory: true  },
  { key: 'subtype', label: 'زیرمجموعه',      mandatory: false },
  { key: 'quantity',label: 'تعداد',         mandatory: false },
  { key: 'unit',    label: 'واحد',          mandatory: false },
  { key: 'weight',  label: 'وزن',           mandatory: false },
  { key: 'party',   label: 'طرف حساب',      mandatory: false },
  { key: 'driver',  label: 'راننده',        mandatory: false },
  { key: 'invoice', label: 'شماره فاکتور',   mandatory: false },
  { key: 'basil',   label: 'شماره باسکول',   mandatory: false },
  { key: 'waybill', label: 'شماره بارنامه',  mandatory: false },
  { key: 'notes',   label: 'توضیحات',       mandatory: false },
  { key: 'creator', label: 'ثبت‌کننده',      mandatory: false }
];

function initVisibleFieldsDefault(){const o={};ALL_FIELDS.forEach(f=>o[f.key]=true);return o;}
function loadDisplaySettings(){
  const s = parseInt(localStorage.getItem('wh_print_font_scale')||'100', 10);
  printFontScale = [75,100,150,200].includes(s) ? s : 100;
  const m = localStorage.getItem('wh_data_mode')||'weighted';
  dataMode = ['numeric','weighted'].includes(m) ? m : 'weighted';
  summaryMode = localStorage.getItem('wh_summary_mode') || 'grouped';
  
  letterheadCompany = localStorage.getItem('wh_letterhead_company') || '';
  letterheadCompanyAt = parseInt(localStorage.getItem('wh_letterhead_company_at') || '0', 10);
  letterheadFactory = localStorage.getItem('wh_letterhead_factory') || '';
  letterheadFactoryAt = parseInt(localStorage.getItem('wh_letterhead_factory_at') || '0', 10);
  
  try{
    const raw = localStorage.getItem('wh_visible_fields');
    if(raw){
      const parsed = JSON.parse(raw);
      const def = initVisibleFieldsDefault();
      ALL_FIELDS.forEach(f=>{
        if(f.mandatory){def[f.key]=true;}
        else if(parsed && typeof parsed[f.key]==='boolean'){def[f.key]=parsed[f.key];}
      });
      visibleFields=def;
    }else{visibleFields=initVisibleFieldsDefault();}
    visibleFieldsAt = parseInt(localStorage.getItem('wh_visible_fields_at') || '0', 10);
  }catch(e){visibleFields=initVisibleFieldsDefault(); visibleFieldsAt = 0;}

  applyPrintFontScale();
  const fs = document.getElementById('fontScaleSelect'); if(fs) fs.value = String(printFontScale);
  const dm = document.getElementById('dataModeSelect'); if(dm) dm.value = dataMode;
  
  renderFieldsList();
  applyFieldVisibility();
  updateHeaderUI();
}

function updateHeaderUI() {
  const c = document.getElementById('appHeaderCompany');
  const f = document.getElementById('appHeaderFactory');
  const ci = document.getElementById('letterheadCompanyInput');
  const fi = document.getElementById('letterheadFactoryInput');
  
  if(c) c.textContent = letterheadCompany || 'نام شرکت (برای ویرایش کلیک کنید)';
  if(f) f.textContent = letterheadFactory || 'نام کارخانه (برای ویرایش کلیک کنید)';
  if(ci) ci.value = letterheadCompany || '';
  if(fi) fi.value = letterheadFactory || '';
}

async function editLetterhead(type) {
  const current = type === 'company' ? letterheadCompany : letterheadFactory;
  const title = type === 'company' ? 'نام شرکت (سربرگ)' : 'نام کارخانه (سربرگ)';
  const val = await customPrompt(title, current, {placeholder: 'نام را وارد کنید'});
  if (val !== null) {
    updateLetterhead(type, val);
  }
}

function updateLetterhead(type, val) {
  const now = Date.now();
  if (type === 'company') {
    letterheadCompany = val.trim();
    letterheadCompanyAt = now;
    localStorage.setItem('wh_letterhead_company', letterheadCompany);
    localStorage.setItem('wh_letterhead_company_at', String(now));
  } else {
    letterheadFactory = val.trim();
    letterheadFactoryAt = now;
    localStorage.setItem('wh_letterhead_factory', letterheadFactory);
    localStorage.setItem('wh_letterhead_factory_at', String(now));
  }
  updateHeaderUI();
  markDirty();
}

function applyPrintFontScale(){ document.documentElement.style.setProperty('--pf', String(printFontScale/100)); }
function setPrintFontScale(scale){ printFontScale = scale; localStorage.setItem('wh_print_font_scale', String(scale)); applyPrintFontScale(); }
function setDataMode(mode){ dataMode = mode; localStorage.setItem('wh_data_mode', mode); renderRecords(); }
function applyDarkMode(){ document.body.classList.toggle('dark', localStorage.getItem('lab_darkmode')==='1'); }
function toggleDarkMode(on){ localStorage.setItem('lab_darkmode', on?'1':'0'); applyDarkMode(); }

function isFieldVisible(key){
  if(key === 'weight' && dataMode === 'numeric') return false;
  const f = ALL_FIELDS.find(x=>x.key===key);
  if(f && f.mandatory) return true;
  return !!visibleFields[key];
}
function toggleFieldVisibility(key, checked){
  const f = ALL_FIELDS.find(x=>x.key===key);
  if(f && f.mandatory) return;
  visibleFields[key] = !!checked;
  visibleFieldsAt = Date.now();
  localStorage.setItem('wh_visible_fields',JSON.stringify(visibleFields));
  localStorage.setItem('wh_visible_fields_at', String(visibleFieldsAt));
  applyFieldVisibility();
  renderRecords();
  markDirty();
}
function renderFieldsList(){
  const container = document.getElementById('fieldsList');
  if(!container) return;
  container.innerHTML = ALL_FIELDS.map(f=>{
    const isMandatory = f.mandatory;
    const disabled = isMandatory;
    let checked;
    if(isMandatory) checked = true;
    else checked = !!visibleFields[f.key];
    let note = '';
    if(isMandatory) note = '<span class="field-note mandatory" style="color:var(--primary);">(الزامی)</span>';
    return `<label class="field-checkbox${disabled?' disabled':''}">
      <input type="checkbox" ${checked?'checked':''} ${disabled?'disabled':''} onchange="toggleFieldVisibility('${f.key}', this.checked)">
      <span class="field-label">${esc(f.label)}</span>${note}
    </label>`;
  }).join('');
}
function applyFieldVisibility(){
  document.querySelectorAll('.records-table-scroll').forEach(container=>{
    ALL_FIELDS.forEach(f=>{
      container.classList.toggle('hide-field-'+f.key, !isFieldVisible(f.key));
    });
  });
}

/* ─── Bootstrap ─── */
window.addEventListener('DOMContentLoaded', async ()=>{
  (function(){
    const splash = document.getElementById('splashScreen');
    if(!splash) return;
    const img = document.getElementById('splashLogoImg');
    if(img){ img.classList.add('loaded'); }
    let done = false;
    const hide = ()=>{ if(done) return; done=true; splash.classList.add('hide'); setTimeout(()=>{ try{splash.remove();}catch(e){} }, 800); };
    splash.addEventListener('click', hide);
    setTimeout(hide, 2200);
  })();

  initUIBindings();
  loadGhConfig();
  loadDisplaySettings();
  applyDarkMode();

  document.querySelectorAll('.date-input').forEach(inp=>{
    inp.readOnly = true;
    inp.addEventListener('click', e=>{ e.stopPropagation(); openCalendarFor(inp); });
  });
  document.querySelectorAll('.time-input').forEach(inp=>{
    inp.readOnly = true;
    inp.addEventListener('click', e=>{ e.stopPropagation(); openTimeFor(inp); });
  });

  ssProduct = new SearchableSelect(document.getElementById('ss_product'), { allowAdd: false, onChange: onProductChange });
  ssSubtype = new SearchableSelect(document.getElementById('ss_subtype'), { allowAdd: false, onChange: ()=>{} });
  ssUnit = new SearchableSelect(document.getElementById('ss_unit'), { allowAdd: false, onChange: ()=>updateAutoKg() });
  
  ssParty = new SearchableSelect(document.getElementById('ss_party'), {
    allowAdd: true,
    onAdd: async (name)=>{
      const isIn = currentType==='in';
      const list = isIn ? sellers : buyers;
      if(!list.includes(name)){
        list.push(name);
        if(isIn) deletedSellers = deletedSellers.filter(x=>x!==name);
        else deletedBuyers = deletedBuyers.filter(x=>x!==name);
        markDirty(); refreshPartyOptions();
      }
    },
    onChange: ()=>updateAutoKg()
  });
  ssDriver = new SearchableSelect(document.getElementById('ss_driver'), {
    allowAdd: true,
    onAdd: (name)=>{
      if(!drivers.includes(name)){
        drivers.push(name);
        deletedDrivers = deletedDrivers.filter(x=>x!==name);
        markDirty(); refreshDriverOptions();
      }
    }
  });

  ssAdvProduct = new SearchableSelect(document.getElementById('ss_adv_product'), { allowAdd: false, onChange: onAdvProductChange });
  ssAdvSubtype = new SearchableSelect(document.getElementById('ss_adv_subtype'), { allowAdd: false, onChange: applyAdvFilterChange });
  ssAdvParty = new SearchableSelect(document.getElementById('ss_adv_party'), { allowAdd: false, onChange: applyAdvFilterChange });
  ssAdvDriver = new SearchableSelect(document.getElementById('ss_adv_driver'), { allowAdd: false, onChange: applyAdvFilterChange });

  const searchInput = document.getElementById('search');
  const searchClear = document.getElementById('searchClear');
  searchInput.addEventListener('input', ()=>{
    if(searchInput.value.length > 0) searchClear.classList.add('show');
    else searchClear.classList.remove('show');
    onSearchInput();
  });

  const sess = loadSession();
  if(sess){
    document.getElementById('autoLoginStatus').style.display = 'block';
    document.getElementById('loginBtn').style.opacity = '0.5';
    document.getElementById('loginBtn').style.pointerEvents = 'none';
    
    await tryRestoreSession(sess);
    
    if(!document.getElementById('loginScreen').hidden) {
      document.getElementById('autoLoginStatus').style.display = 'none';
      document.getElementById('loginBtn').style.opacity = '1';
      document.getElementById('loginBtn').style.pointerEvents = 'auto';
    }
  } else {
    document.getElementById('loginScreen').hidden = false;
    if(!hasGhConfig()){
      document.getElementById('loginNoConfigWarning').style.display = 'block';
      document.getElementById('loginBtn').style.opacity = '0.5';
      document.getElementById('loginBtn').style.pointerEvents = 'none';
    }
  }
});

function openSetupScreen(){
  document.getElementById('loginScreen').hidden = true;
  document.getElementById('setupScreen').hidden = false;
  document.getElementById('setupAdminFields').hidden = true;
  document.getElementById('setupGhFields').style.opacity = '1';
  document.getElementById('setupGhFields').style.pointerEvents = 'auto';
  document.getElementById('ghStatusMsg').textContent = '';
}
function closeSetupScreen(){
  document.getElementById('setupScreen').hidden = true;
  document.getElementById('loginScreen').hidden = false;
  if(!hasGhConfig()){
    document.getElementById('loginNoConfigWarning').style.display = 'block';
  } else {
    document.getElementById('loginNoConfigWarning').style.display = 'none';
    document.getElementById('loginBtn').style.opacity = '1';
    document.getElementById('loginBtn').style.pointerEvents = 'auto';
  }
}

async function testDbConnection(){
  const owner = document.getElementById('setupOwner').value.trim();
  const repo = document.getElementById('setupRepo').value.trim();
  const token = document.getElementById('setupToken').value.trim();
  if(!owner || !repo || !token){
    showToast('اطلاعات اتصال (Username, Repo, Token) الزامی است', 'warning');
    return;
  }

  ghConfig = { owner, repo, token };
  saveGhConfig();
  ghFileSha = null;

  const msg = document.getElementById('ghStatusMsg');
  msg.textContent = '⏳ در حال بررسی اتصال...';
  msg.style.color = 'var(--primary)';

  try {
    const raw = await ghGet();
    if(raw && raw.users && raw.users.length > 0){
      msg.textContent = '✅ اتصال برقرار شد. دیتابیس یافت شد.';
      msg.style.color = 'var(--success)';
      showToast('دیتابیس موجود است. به صفحه ورود منتقل می‌شوید.', 'success');
      setTimeout(() => closeSetupScreen(), 1500);
    } else {
      msg.textContent = '✅ اتصال برقرار شد. دیتابیس خالی است.';
      msg.style.color = 'var(--success)';
      document.getElementById('setupAdminFields').hidden = false;
      document.getElementById('setupGhFields').style.opacity = '0.5';
      document.getElementById('setupGhFields').style.pointerEvents = 'none';
      showToast('لطفاً اولین کاربر (مدیر) را بسازید.', 'info');
    }
  } catch(err) {
    msg.textContent = '❌ خطا در اتصال: ' + (err.message || '');
    msg.style.color = 'var(--danger)';
    document.getElementById('setupAdminFields').hidden = true;
  }
}

function clearSearch(){
  const inp = document.getElementById('search');
  inp.value = '';
  document.getElementById('searchClear').classList.remove('show');
  updateFilterBadges();
  renderRecords();
}

async function doLogin(){
  const errEl = document.getElementById('loginError');
  errEl.hidden = true;
  
  if(!hasGhConfig()){
    errEl.hidden = false;
    errEl.textContent = 'تنظیمات اتصال به دیتابیس انجام نشده است. از لینک زیر صفحه ورود استفاده کنید.';
    return;
  }

  const u = document.getElementById('loginUsername').value.trim();
  const p = document.getElementById('loginPassword').value;
  if(!u || !p){ errEl.hidden=false; errEl.textContent='نام کاربری و رمز عبور را وارد کنید'; return; }

  const btn = document.getElementById('loginBtn');
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ در حال ورود...';

  try {
    const raw = await ghGet();
    if(!raw){ errEl.hidden=false; errEl.textContent='داده‌ای روی سرور یافت نشد'; return; }
    const data = deserializeState(raw);
    const result = await verifyLogin(u, p, data.users);
    if(!result.ok){ errEl.hidden=false; errEl.textContent = result.reason; return; }
    
    saveSession(result.user.id, result.user.username, result.user.role);
    result.user.lastLogin = Date.now();
    await enterApp(result.user, data);
  } catch(err){
    errEl.hidden=false;
    errEl.textContent = 'خطا در ورود: ' + (err.message||'نامشخص');
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

async function doFirstSetup(){
  const user = document.getElementById('setupUser').value.trim();
  const display = document.getElementById('setupDisplay').value.trim();
  const pass = document.getElementById('setupPass').value;
  
  if(!user||!pass||pass.length<4){
    showToast('نام کاربری و رمز عبور (حداقل ۴ کاراکتر) الزامی است', 'warning');
    return;
  }

  try {
    const userObj = await createUserObject({
      username:user, password:pass, displayName:display || user, role:'admin', currentUserId:''
    });
    const newState = {
      records:[], products:[{name:'شکر',unit:'kg',subtypes:[],updatedAt:Date.now()}],
      sellers:[], buyers:[], drivers:[],
      unitsList:[...DEFAULT_UNITS], users:[userObj], auditLog:[],
      permanentlyDeletedIds:[], deletedProducts:[], deletedSellers:[],
      deletedBuyers:[], deletedDrivers:[], deletedUnits:[],
      dataEpoch:1, currentUser:userObj,
      letterheadCompany:"", letterheadCompanyAt:0,
      letterheadFactory:"", letterheadFactoryAt:0,
      visibleFields:{}, visibleFieldsAt:0
    };
    const payload = serializeState(newState);
    await ghPut(payload);
    saveSession(userObj.id, userObj.username, userObj.role);
    await enterApp(userObj, deserializeState(payload));
  } catch(err){
    showToast('خطا در ساخت ادمین: ' + (err.message||'نامشخص'), 'error');
  }
}

async function tryRestoreSession(sess){
  let raw = null;
  try {
    if(!hasGhConfig()){ return; }
    raw = await ghGet();
  } catch(err) {
    console.warn('Session restore failed:', err);
    return; 
  }

  if(!raw){ return; }

  const data = deserializeState(raw);
  const user = data.users.find(u=>u.id===sess.userId);
  
  if(!user || !user.active || user.role!==sess.role){ 
    clearSession(); 
    return; 
  }

  try {
    await enterApp(user, data);
  } catch(err) {
    console.error('App loading error:', err);
    showToast('خطا در بارگذاری داده ها. لطفاً رفرش کنید.', 'error');
  }
}

async function enterApp(user, data){
  currentUser = user;
  records = data.records || [];
  products = data.products || [];
  sellers = data.sellers || [];
  buyers = data.buyers || [];
  drivers = data.drivers || [];
  unitsList = data.unitsList || [...DEFAULT_UNITS];
  users = data.users || [];
  auditLog = data.auditLog || [];
  permanentlyDeletedIds = data.permanentlyDeletedIds || [];
  deletedProducts = data.deletedProducts || [];
  deletedSellers = data.deletedSellers || [];
  deletedBuyers = data.deletedBuyers || [];
  deletedDrivers = data.deletedDrivers || [];
  deletedUnits = data.deletedUnits || [];
  dataEpoch = data.dataEpoch || 1;
  
  // --- Merge letterhead (server vs local) ---
  const mc = mergeLetterheadValue(letterheadCompany, letterheadCompanyAt, data.letterheadCompany || '', data.letterheadCompanyAt || 0);
  letterheadCompany = mc.val; letterheadCompanyAt = mc.at;
  const mf = mergeLetterheadValue(letterheadFactory, letterheadFactoryAt, data.letterheadFactory || '', data.letterheadFactoryAt || 0);
  letterheadFactory = mf.val; letterheadFactoryAt = mf.at;
  
  localStorage.setItem('wh_letterhead_company', letterheadCompany);
  localStorage.setItem('wh_letterhead_company_at', String(letterheadCompanyAt));
  localStorage.setItem('wh_letterhead_factory', letterheadFactory);
  localStorage.setItem('wh_letterhead_factory_at', String(letterheadFactoryAt));
  
  // --- Merge visibleFields ---
  const mvf = mergeVisibleFieldsValue(visibleFields, visibleFieldsAt, data.visibleFields || {}, data.visibleFieldsAt || 0);
  const mergedFields = mvf.fields;
  const def = initVisibleFieldsDefault();
  ALL_FIELDS.forEach(f=>{
    if(f.mandatory){ def[f.key] = true; }
    else if(mergedFields && typeof mergedFields[f.key] === 'boolean'){ def[f.key] = mergedFields[f.key]; }
  });
  visibleFields = def;
  visibleFieldsAt = mvf.at;
  localStorage.setItem('wh_visible_fields', JSON.stringify(visibleFields));
  localStorage.setItem('wh_visible_fields_at', String(visibleFieldsAt));
  
  updateHeaderUI();
  renderFieldsList();
  applyFieldVisibility();
  
  dirty = false; lastSyncAt = Date.now();

  document.getElementById('loginScreen').hidden = true;
  document.getElementById('setupScreen').hidden = true;
  document.getElementById('mainApp').hidden = false;
  document.getElementById('userPill').hidden = false;

  const pill = document.getElementById('userPill');
  pill.innerHTML = `<span>👤 ${esc(user.displayName||user.username)}</span>
    <span class="role-badge">${roleLabel(user.role)}</span>`;

  const t = todayJalali();
  document.getElementById('records_from').value = t;
  document.getElementById('records_to').value = t;

  applyTypeUI();
  fillFormProducts(); fillUnits(); refreshPartyOptions(); refreshDriverOptions();
  renderRecords();
  renderManageLists(); renderManageProducts();
  setSummaryMode(summaryMode);
  updateSyncBar();
  updateGhUI();

  if(!canCreateRecord(user.role)){
    document.getElementById('btnIn').style.display = 'none';
    document.getElementById('btnOut').style.display = 'none';
    document.getElementById('syncPushBtn').disabled = true;
  }

  if (!_isFormListenersAttached) {
    _isFormListenersAttached = true;
    document.getElementById('f_quantity').addEventListener('input', updateAutoKg);
    document.getElementById('formCard').addEventListener('keydown', e => {
      if(e.key !== 'Enter') return;
      const tag = e.target?.tagName;
      if(tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      e.preventDefault(); saveRecord();
    });
    window.onbeforeunload = e => {
      if(dirty){ e.preventDefault(); e.returnValue=''; return ''; }
    };
  }
}

function logout(){
  clearSession();
  currentUser = null;
  document.getElementById('mainApp').hidden = true;
  document.getElementById('userPill').hidden = true;
  document.getElementById('loginScreen').hidden = false;
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
  if(!hasGhConfig()){
    document.getElementById('loginNoConfigWarning').style.display = 'block';
    document.getElementById('loginBtn').style.opacity = '0.5';
    document.getElementById('loginBtn').style.pointerEvents = 'none';
  } else {
    document.getElementById('loginNoConfigWarning').style.display = 'none';
    document.getElementById('loginBtn').style.opacity = '1';
    document.getElementById('loginBtn').style.pointerEvents = 'auto';
  }
}

function openDrawer(){
  document.getElementById('drawer').classList.add('show');
  document.getElementById('drawerOverlay').classList.add('show');
  document.body.style.overflow = 'hidden';
  document.getElementById('ghOwner').value = ghConfig.owner||'';
  document.getElementById('ghRepo').value = ghConfig.repo||'';
  document.getElementById('ghToken').value = ghConfig.token||'';
  renderManageLists(); renderManageProducts();
  updateGhUI();
  updateHeaderUI(); 
}
function closeDrawer(){
  document.getElementById('drawer').classList.remove('show');
  document.getElementById('drawerOverlay').classList.remove('show');
  document.body.style.overflow = '';
}

function toggleAccordion(sectionId, headerEl){
  const body = document.getElementById(sectionId);
  if(!body) return;
  const isCollapsed = body.classList.contains('collapsed');
  const parentContainer = headerEl.closest('.drawer-body') || headerEl.closest('.card');
  
  if(parentContainer){
    parentContainer.querySelectorAll('.collapsible-body, .drawer-section-body').forEach(el => {
      if(el.id !== sectionId) {
        el.classList.add('collapsed');
        const h = el.previousElementSibling;
        if(h) {
           const btn = h.querySelector('.collapsible-toggle, .toggle-btn');
           if(btn) btn.textContent = '+';
        }
      }
    });
  }

  if(isCollapsed){
    body.classList.remove('collapsed');
    const btn = headerEl.querySelector('.collapsible-toggle, .toggle-btn');
    if(btn) btn.textContent = '−';
    
    if(sectionId === 'advFilterSection') buildAdvFilterOptions();
    if(sectionId === 'deletedRecordsSection') renderDeletedRecords();
  } else {
    body.classList.add('collapsed');
    const btn = headerEl.querySelector('.collapsible-toggle, .toggle-btn');
    if(btn) btn.textContent = '+';
  }
}

function updateGhUI(){
  const box = document.getElementById('ghCompactBox');
  const fields = document.getElementById('ghFullFields');
  const status = document.getElementById('ghCompactStatus');
  const hasConfig = !!(ghConfig.owner && ghConfig.repo && ghConfig.token);

  if(hasConfig){
    box.hidden = false;
    fields.hidden = true;
    const sizeStr = ghFileSize ? formatBytes(ghFileSize) : '—';
    status.innerHTML = `✅ متصل به ${esc(ghConfig.owner)}/${esc(ghConfig.repo)}<span class="gh-size">📦 حجم فایل روی سرور: ${sizeStr}</span>`;
  } else {
    box.hidden = true;
    fields.hidden = false;
  }
}
function toggleGhEdit(){
  const box = document.getElementById('ghCompactBox');
  const fields = document.getElementById('ghFullFields');
  if(fields.hidden){
    fields.hidden = false;
    box.hidden = true;
    document.getElementById('ghOwner').value = ghConfig.owner||'';
    document.getElementById('ghRepo').value = ghConfig.repo||'';
    document.getElementById('ghToken').value = ghConfig.token||'';
  } else {
    updateGhUI();
  }
}

function setNow(){
  document.getElementById('f_date').value = todayJalali();
  document.getElementById('f_time').value = nowTime();
}
async function switchType(t){
  if(!canCreateRecord(currentRole())){ showToast('شما دسترسی ثبت رکورد ندارید','warning'); return; }
  if(editingId!==null){
    const ok = await customConfirm('در حال ویرایش هستید. تغییر نوع، ویرایش را لغو می‌کند. ادامه؟', {danger:true});
    if(!ok) return;
    editingId = null;
  }
  currentType = (currentType===t) ? null : t;
  if(currentType){
    ['f_quantity','f_notes','f_invoice','f_basil','f_waybill'].forEach(id=>{
      const el = document.getElementById(id); if(el) el.value='';
    });
    ssProduct.clear(); ssParty.clear(); ssDriver.clear(); ssUnit.clear(); ssSubtype.clear();
    document.getElementById('subtypeField').hidden = true;
    if(unitsList.length) ssUnit.setValue(unitsList[0].v);
    setNow(); updateAutoKg();
  }
  applyTypeUI();
}
async function closeForm(){
  if(editingId!==null){
    const ok = await customConfirm('در حال ویرایش هستید. فرم بسته شود؟', {danger:true});
    if(!ok) return;
  }
  currentType = null; editingId = null; applyTypeUI();
}
function cancelEdit(){ editingId=null; currentType=null; applyTypeUI(); }

function applyTypeUI(){
  const btnIn = document.getElementById('btnIn');
  const btnOut = document.getElementById('btnOut');
  const formCard = document.getElementById('formCard');
  const isEditing = editingId!==null;
  const isIn = currentType==='in';
  btnIn.classList.toggle('active', currentType==='in');
  btnOut.classList.toggle('active', currentType==='out');
  if(currentType===null){ formCard.hidden = true; return; }
  formCard.hidden = false;
  document.getElementById('editBanner').hidden = !isEditing;
  document.getElementById('cancelEditBtn').hidden = !isEditing;
  document.getElementById('saveBtn').textContent = isEditing ? '💾 ذخیره تغییرات' : '💾 ثبت اطلاعات';
  document.getElementById('formTitle').textContent = (isEditing?'✏️ ویرایش ':'ثبت ') + (isIn?'ورود کالا 📥':'خروج کالا 📤');
  document.getElementById('f_party_label').textContent = isIn ? 'فروشنده' : 'خریدار';
  fillFormProducts(); fillUnits(); refreshPartyOptions(); refreshDriverOptions();
  updateSubtypesForProduct(true);
  if(!isEditing) setNow();
  updateAutoKg();
}

function fillFormProducts(){
  if(ssProduct) ssProduct.setOptions(products.map(p=>({value:p.name, label:p.name})));
}
function fillUnits(){
  if(ssUnit) ssUnit.setOptions(unitsList.map(u=>({value:u.v, label:u.l})));
}
function refreshPartyOptions(){
  const list = currentType==='in' ? sellers : (currentType==='out' ? buyers : []);
  if(ssParty) ssParty.setOptions(list.map(n=>({value:n, label:n})));
  if(ssParty && ssParty.getValue() && !list.includes(ssParty.getValue())){
    ssParty.clear();
  }
}
function refreshDriverOptions(){
  if(ssDriver) ssDriver.setOptions(drivers.map(n=>({value:n, label:n})));
}

function updateSubtypesForProduct(preserve){
  const prodName = ssProduct.getValue();
  const field = document.getElementById('subtypeField');
  const prod = products.find(p=>p.name===prodName);
  const subs = (prod && prod.subtypes) ? prod.subtypes.filter(s=>s && s.trim()) : [];
  if(subs.length===0){ field.hidden = true; if(ssSubtype) ssSubtype.clear(); return; }
  field.hidden = false;
  if(ssSubtype) {
    ssSubtype.setOptions(subs.map(s=>({value:s, label:s})));
    const cur = preserve ? ssSubtype.getValue() : '';
    if (cur && subs.includes(cur)) ssSubtype.setValue(cur);
    else ssSubtype.clear();
  }
}

function onProductChange(){
  updateSubtypesForProduct(false);
  const productName = ssProduct.getValue();
  const product = products.find(p=>p.name===productName);
  if(product && product.unit){
    ssUnit.setValue(product.unit);
  }
  updateAutoKg();
}

function updateAutoKg(){
  const box = document.getElementById('autoKgBox');
  const valEl = document.getElementById('autoKgValue');
  const formulaEl = document.getElementById('autoKgFormula');
  const qtyStr = document.getElementById('f_quantity').value.trim();
  const unit = ssUnit.getValue();
  const f = unitFactor(unit);
  if(f===null||f===undefined){
    box.classList.add('no-factor');
    valEl.textContent = '۰';
    formulaEl.textContent = 'واحد بدون ضریب تبدیل';
    return;
  }
  box.classList.remove('no-factor');
  const qty = parseFloat(toLatinDigits(qtyStr));
  if(!qtyStr || isNaN(qty)){ valEl.textContent='۰'; formulaEl.textContent=`ضریب: ${toFa(f)}`; return; }
  const kg = qty * f;
  valEl.textContent = fmtKg(kg);
  formulaEl.textContent = `${fmtQty(qty)} × ${toFa(f)} = ${fmtKg(kg)}`;
}

async function addParty(){
  if(!currentType){ showToast('اول ورود/خروج را انتخاب کنید','warning'); return; }
  await menuAddParty();
  refreshPartyOptions();
}
async function addDriver(){
  if(!currentType){ showToast('اول ورود/خروج را انتخاب کنید','warning'); return; }
  await menuAddDriver();
  refreshDriverOptions();
}

async function menuAddParty(){
  const isIn=currentType==='in';
  const label=isIn?'فروشنده':'خریدار';
  const n=await customPrompt(`نام ${label} جدید:`,'');
  if(!n)return;const v=n.trim();if(!v)return;
  const list=isIn?sellers:buyers;
  if(list.includes(v)){showToast('قبلاً وجود دارد','warning');return;}
  if(isIn) deletedSellers = deletedSellers.filter(x=>x!==v);
  else     deletedBuyers  = deletedBuyers.filter(x=>x!==v);
  list.push(v);markDirty();refreshPartyOptions();renderManageLists();
}
async function menuAddDriver(){
  const n=await customPrompt('نام راننده جدید:','',{placeholder:'مثلاً: آقای احمدی'});
  if(!n)return;const v=n.trim();if(!v)return;
  if(drivers.includes(v)){showToast('قبلاً وجود دارد','warning');return;}
  deletedDrivers = deletedDrivers.filter(x=>x!==v);
  drivers.push(v);markDirty();refreshDriverOptions();renderManageLists();
}

async function saveRecord(){
  if(!canCreateRecord(currentRole())){ showToast('دسترسی ثبت ندارید','warning'); return; }
  if(!currentType){ showToast('اول ورود/خروج را انتخاب کنید','warning'); return; }
  const date = document.getElementById('f_date').value.trim();
  const time = document.getElementById('f_time').value.trim();
  const notes = document.getElementById('f_notes').value.trim();
  const invoiceNumber = document.getElementById('f_invoice').value.trim();
  const basilNumber = document.getElementById('f_basil').value.trim();
  const waybillNumber = document.getElementById('f_waybill').value.trim();
  const product = ssProduct.getValue();
  const subtype = ssSubtype.getValue();
  const qty = document.getElementById('f_quantity').value.trim();
  const unit = ssUnit.getValue();
  const party = ssParty.getValue();
  const driver = ssDriver.getValue();

  if(!date){ showToast('تاریخ را انتخاب کنید','warning'); return; }
  if(!time){ showToast('ساعت را انتخاب کنید','warning'); return; }
  if(!product){ showToast('کالا را انتخاب کنید','warning'); return; }
  if(!qty){ showToast('تعداد را وارد کنید','warning'); return; }
  const q = parseFloat(toLatinDigits(qty));
  if(isNaN(q) || q<=0){ showToast('تعداد باید بزرگتر از صفر باشد','warning'); return; }
  if(!unit){ showToast('واحد را انتخاب کنید','warning'); return; }

  const saveBtn = document.getElementById('saveBtn');
  if(saveBtn.disabled) return;
  saveBtn.disabled = true;
  try {
    const kg = calcKg(qty, unit);
    const baseData = {
      type: currentType, date, time, notes, invoiceNumber, basilNumber, waybillNumber,
      product, subtype, quantity: qty, unit, totalWeight: String(kg), party, driver
    };
    const now = Date.now();
    const wasEditing = editingId!==null;

    if(wasEditing){
      const idx = records.findIndex(r=>r.id===editingId);
      if(idx===-1){ showToast('رکورد پیدا نشد','error'); editingId=null; applyTypeUI(); return; }
      records[idx] = {
        ...records[idx], ...baseData,
        updatedAt: now,
        updatedBy: currentUser.id,
        updatedByName: currentUser.displayName || currentUser.username
      };
      logAudit('update', `ویرایش ${currentType==='in'?'ورود':'خروج'} — ${product}`, editingId);
      editingId=null; markDirty(); clearForm(); applyTypeUI(); renderRecords();
      showToast('تغییرات ذخیره شد','success');
      return;
    }

    const rec = {
      id: generateId(),
      ...baseData,
      createdAt: now,
      createdBy: currentUser.id,
      createdByName: currentUser.displayName || currentUser.username,
      updatedAt: now,
      updatedBy: currentUser.id,
      updatedByName: currentUser.displayName || currentUser.username,
      deleted: false
    };
    records.unshift(rec);
    logAudit('create', `ثبت ${currentType==='in'?'ورود':'خروج'} — ${product} (${qty} ${unitLabel(unit)})`, rec.id);
    markDirty(); clearForm();
    const f = normalizeDate(document.getElementById('records_from').value);
    const t = normalizeDate(document.getElementById('records_to').value);
    const nd = normalizeDate(date);
    if((f && nd<f) || (t && nd>t)){
      document.getElementById('records_from').value = date;
      document.getElementById('records_to').value = date;
    }
    renderRecords();
    showToast('رکورد ثبت شد','success');
  } finally {
    setTimeout(()=>{ saveBtn.disabled = false; }, 800);
  }
}

function logAudit(action, detail, recordId){
  auditLog.push({
    t: Date.now(), action,
    userId: currentUser.id,
    userName: currentUser.displayName || currentUser.username,
    detail: detail || '', recordId: recordId || null
  });
  if(auditLog.length > 800) auditLog = auditLog.slice(-800);
}

function clearForm(){
  ['f_quantity','f_notes','f_invoice','f_basil','f_waybill'].forEach(id=>{
    const el = document.getElementById(id); if(el) el.value='';
  });
  ssProduct.clear(); ssParty.clear(); ssDriver.clear(); ssUnit.clear(); ssSubtype.clear();
  document.getElementById('subtypeField').hidden = true;
  if(unitsList.length) ssUnit.setValue(unitsList[0].v);
  updateAutoKg();
  if(editingId===null) setNow();
}

function editRecord(id){
  if(!canEditRecord(currentRole())){ showToast('دسترسی ویرایش ندارید','warning'); return; }
  const r = records.find(x=>x.id===id);
  if(!r){ showToast('رکورد پیدا نشد','error'); return; }
  currentType = r.type; editingId = id; applyTypeUI();
  document.getElementById('f_date').value = r.date||'';
  document.getElementById('f_time').value = r.time||'';
  document.getElementById('f_notes').value = r.notes||'';
  document.getElementById('f_invoice').value = r.invoiceNumber||'';
  document.getElementById('f_basil').value = r.basilNumber||'';
  document.getElementById('f_waybill').value = r.waybillNumber||'';
  
  if(r.product) {
    if(!products.some(p=>p.name===r.product)) {
      products.push({name:r.product, unit:r.unit, subtypes:[], updatedAt:Date.now()});
      fillFormProducts();
    }
    ssProduct.setValue(r.product);
  } else {
    ssProduct.clear();
  }

  document.getElementById('f_quantity').value = r.quantity||'';
  
  if(r.unit){
    ssUnit.setValue(r.unit);
  } else {
    ssUnit.clear();
  }
  
  updateSubtypesForProduct(false);
  if(r.subtype && ssSubtype){
    ssSubtype.setValue(r.subtype);
    document.getElementById('subtypeField').hidden = false;
  }
  
  if(r.party) ssParty.setValue(r.party);
  if(r.driver) ssDriver.setValue(r.driver);
  updateAutoKg();
  document.getElementById('formCard').scrollIntoView({behavior:'smooth',block:'start'});
  renderRecords();
}

async function delRecord(id){
  if(!canDeleteRecord(currentRole())){ showToast('دسترسی حذف ندارید','warning'); return; }
  const r = records.find(x=>x.id===id);
  if(!r) return;
  const ok = await customConfirm('این رکورد حذف شود؟', {okText:'حذف', danger:true});
  if(!ok) return;
  const idx = records.findIndex(x=>x.id===id);
  if(idx!==-1){
    records[idx] = { ...records[idx], deleted:true, updatedAt:Date.now(), updatedBy:currentUser.id, updatedByName:currentUser.displayName||currentUser.username };
    logAudit('delete', `حذف رکورد ${r.product||''}`, id);
    markDirty();
  }
  renderRecords();
}

function getVisibleRecords(){ return records.filter(r=>!r.deleted); }

function matchFilter(r){
  const q = (document.getElementById('search')?.value||'').trim();
  const from = normalizeDate(document.getElementById('records_from')?.value||'');
  const to = normalizeDate(document.getElementById('records_to')?.value||'');
  const d = normalizeDate(r.date);
  if(from && d<from) return false;
  if(to && d>to) return false;
  if(advFilter.product && r.product!==advFilter.product) return false;
  if(advFilter.subtype && r.subtype!==advFilter.subtype) return false;
  if(advFilter.party && r.party!==advFilter.party) return false;
  if(advFilter.driver && r.driver!==advFilter.driver) return false;
  if(!matchesDataMode(r)) return false;
  if(q){
    const tokens = q.split(/\s+/).filter(Boolean);
    const fields = [r.product, r.subtype, r.party, r.driver, r.invoiceNumber, r.basilNumber, r.waybillNumber, r.notes, r.date, r.time, r.createdByName].filter(Boolean).map(String);
    if(!tokens.every(tk=>{
      const tkL = toLatinDigits(tk).toLowerCase();
      return fields.some(f=>f.toLowerCase().includes(tk.toLowerCase()) || toLatinDigits(f).toLowerCase().includes(tkL));
    })) return false;
  }
  return true;
}

function sortFn(a,b){
  return (normalizeDate(b.date)+' '+toLatinDigits(b.time||'')).localeCompare(normalizeDate(a.date)+' '+toLatinDigits(a.time||''));
}

function renderRecords(){
  const inList = getVisibleRecords().filter(r=>r.type==='in').filter(matchFilter).sort(sortFn);
  const outList = getVisibleRecords().filter(r=>r.type==='out').filter(matchFilter).sort(sortFn);
  document.getElementById('inBadge').textContent = toFa(inList.length);
  document.getElementById('outBadge').textContent = toFa(outList.length);

  const buildRow = (r)=>{
    const p = products.find(x=>x.name===r.product);
    const u = r.unit ? unitLabel(r.unit) : (p ? unitLabel(p.unit) : '—');
    const kg = getRecordKg(r);
    const isUnsaved = (r.updatedAt||0) > (lastSyncAt||0);
    const rowCls = (editingId===r.id?'editing ':'') + (isUnsaved?'unsaved-row':'');
    const auditTitle = `ثبت‌کننده: ${r.createdByName||'-'}\nتاریخ ثبت: ${formatTime(r.createdAt)}` +
      (r.updatedBy && r.updatedBy!==r.createdBy ? `\nآخرین ویرایش: ${r.updatedByName||'-'} — ${formatTime(r.updatedAt)}` : '');
    const btns = canEditRecord(currentRole()) ? `
      <button class="btn btn-info btn-sm" onclick="viewRecord(${r.id})" title="مشاهده/چاپ">👁️</button>
      <button class="btn btn-warning btn-sm" onclick="editRecord(${r.id})" title="ویرایش">✏️</button>
      <button class="btn btn-danger btn-sm" onclick="delRecord(${r.id})" title="حذف">🗑️</button>
    ` : `<button class="btn btn-info btn-sm" onclick="viewRecord(${r.id})" title="مشاهده/چاپ">👁️</button>`;
    return `<tr class="${rowCls}" ${isUnsaved?'title="ذخیره‌نشده"':''}>
      <td data-field="date">${esc(toFa(r.date))}</td>
      <td data-field="time">${esc(toFa(r.time))}</td>
      <td data-field="product"><b>${esc(r.product||'-')}</b></td>
      <td data-field="subtype">${esc(r.subtype||'-')}</td>
      <td data-field="quantity">${fmtQty(r.quantity)}</td>
      <td data-field="unit">${esc(u)}</td>
      <td data-field="weight" style="color:var(--primary);font-weight:bold;">${fmtKg(kg)}</td>
      <td data-field="party">${esc(toFa(r.party||'-'))}</td>
      <td data-field="driver">${esc(toFa(r.driver||'-'))}</td>
      <td data-field="invoice">${esc(toFa(r.invoiceNumber||'-'))}</td>
      <td data-field="basil">${esc(toFa(r.basilNumber||'-'))}</td>
      <td data-field="waybill">${esc(toFa(r.waybillNumber||'-'))}</td>
      <td data-field="notes">${esc(toFa(r.notes||''))}</td>
      <td data-field="creator"><span class="audit-info" title="${esc(auditTitle)}">👤 ${esc(toFa(r.createdByName||'-'))}</span></td>
      <td><div style="display:flex;gap:4px;justify-content:flex-end;">${btns}</div></td>
    </tr>`;
  };

  const inBody = document.getElementById('inBody');
  if(inList.length){
    inBody.innerHTML = inList.map(buildRow).join('');
    document.getElementById('inEmpty').style.display = 'none';
  } else {
    inBody.innerHTML = '';
    document.getElementById('inEmpty').textContent = 'موردی یافت نشد';
    document.getElementById('inEmpty').style.display = 'block';
  }
  const outBody = document.getElementById('outBody');
  if(outList.length){
    outBody.innerHTML = outList.map(buildRow).join('');
    document.getElementById('outEmpty').style.display = 'none';
  } else {
    outBody.innerHTML = '';
    document.getElementById('outEmpty').textContent = 'موردی یافت نشد';
    document.getElementById('outEmpty').style.display = 'block';
  }

  updateFilterBadges();
  renderSummary();
  buildAdvFilterOptions();
  renderDeletedRecords();
  updateDeletedUI();
  updateSyncBar();
  applyFieldVisibility();
}

function updateFilterBadges(){
  const q = (document.getElementById('search')?.value||'').trim();
  const searchBadge = document.getElementById('searchBadge');
  if(searchBadge){
    searchBadge.hidden = !q;
    if(q) searchBadge.textContent = 'فیلتر فعال';
  }
  const advActive = Object.values(advFilter).filter(v=>v && v.trim()).length;
  const advFilterBadge = document.getElementById('advFilterBadge');
  if(advFilterBadge){
    advFilterBadge.hidden = advActive === 0;
    if(advActive > 0) advFilterBadge.textContent = toFa(advActive);
  }
}

function onSearchInput(){
  updateFilterBadges();
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(renderRecords, 200);
}
function onAdvProductChange(){
  advFilter.product = ssAdvProduct.getValue();
  advFilter.subtype = '';
  buildAdvFilterOptions();
  renderRecords();
}
function applyAdvFilterChange(){
  advFilter.product = ssAdvProduct.getValue();
  advFilter.subtype = ssAdvSubtype.getValue();
  advFilter.party = ssAdvParty.getValue();
  advFilter.driver = ssAdvDriver.getValue();
  updateAdvFilterChips();
  renderRecords();
}
function buildAdvFilterOptions(){
  const visible = getVisibleRecords();
  const productsSet = new Set(), partiesSet = new Set(), driversSet = new Set();
  const subtypesByProduct = new Map();
  visible.forEach(r=>{
    if(r.product){
      productsSet.add(r.product);
      if(r.subtype){
        if(!subtypesByProduct.has(r.product)) subtypesByProduct.set(r.product, new Set());
        subtypesByProduct.get(r.product).add(r.subtype);
      }
    }
    if(r.party) partiesSet.add(r.party);
    if(r.driver) driversSet.add(r.driver);
  });
  
  const pArr = Array.from(productsSet).sort((a,b)=>a.localeCompare(b,'fa'));
  ssAdvProduct.setOptions([{value:'',label:'همه'}, ...pArr.map(p=>({value:p, label:p}))]);
  if(productsSet.has(advFilter.product)) ssAdvProduct.setValue(advFilter.product); else { advFilter.product = ''; ssAdvProduct.clear(); }

  const sArr = [];
  if(advFilter.product && subtypesByProduct.has(advFilter.product)){
    Array.from(subtypesByProduct.get(advFilter.product)).sort((a,b)=>a.localeCompare(b,'fa')).forEach(s => sArr.push(s));
  }
  ssAdvSubtype.setOptions([{value:'',label:'همه'}, ...sArr.map(s=>({value:s, label:s}))]);
  if(sArr.includes(advFilter.subtype)) ssAdvSubtype.setValue(advFilter.subtype); else { advFilter.subtype = ''; ssAdvSubtype.clear(); }

  const ptArr = Array.from(partiesSet).sort((a,b)=>a.localeCompare(b,'fa'));
  ssAdvParty.setOptions([{value:'',label:'همه'}, ...ptArr.map(p=>({value:p, label:p}))]);
  if(partiesSet.has(advFilter.party)) ssAdvParty.setValue(advFilter.party); else { advFilter.party = ''; ssAdvParty.clear(); }

  const dArr = Array.from(driversSet).sort((a,b)=>a.localeCompare(b,'fa'));
  ssAdvDriver.setOptions([{value:'',label:'همه'}, ...dArr.map(p=>({value:p, label:p}))]);
  if(driversSet.has(advFilter.driver)) ssAdvDriver.setValue(advFilter.driver); else { advFilter.driver = ''; ssAdvDriver.clear(); }

  updateAdvFilterChips(); 
}
function removeAdvFilter(key){ 
  advFilter[key]=''; 
  if(key==='product') ssAdvProduct.clear();
  if(key==='subtype') ssAdvSubtype.clear();
  if(key==='party') ssAdvParty.clear();
  if(key==='driver') ssAdvDriver.clear();
  buildAdvFilterOptions(); 
  renderRecords(); 
}
function updateAdvFilterChips(){
  const c = document.getElementById('advFilterChips');
  if(!c) return;
  const labels = { product:'کالا', subtype:'زیرمجموعه', party:'طرف', driver:'راننده' };
  c.innerHTML = Object.keys(advFilter).map(k=>{
    const v = advFilter[k];
    if(!v || !v.trim()) return '';
    return `<span class="adv-chip"><span>${labels[k]}:</span><span>${esc(v)}</span><button class="chip-remove" onclick="removeAdvFilter('${k}')">✕</button></span>`;
  }).join('');
}

function recordsToday(){ const t = todayJalali(); document.getElementById('records_from').value=t; document.getElementById('records_to').value=t; renderRecords(); }
function recordsThisWeek(){
  const d = new Date(); const ds = (d.getDay()+1)%7;
  const sat = new Date(d.getFullYear(), d.getMonth(), d.getDate()-ds);
  document.getElementById('records_from').value = gregToJalaliStr(sat.getFullYear(), sat.getMonth()+1, sat.getDate());
  document.getElementById('records_to').value = todayJalali();
  renderRecords();
}
function recordsThisMonth(){
  const d = new Date(); const j = d2j(g2d(d.getFullYear(), d.getMonth()+1, d.getDate()));
  document.getElementById('records_from').value = toFa(`${j.jy}/${String(j.jm).padStart(2,'0')}/01`);
  document.getElementById('records_to').value = todayJalali();
  renderRecords();
}
function recordsAllDays(){ document.getElementById('records_from').value=''; document.getElementById('records_to').value=''; renderRecords(); }
function recordsPrevDay(){ const c = document.getElementById('records_from').value; const t = addDaysToJalali(c, -1); document.getElementById('records_from').value=t; document.getElementById('records_to').value=t; renderRecords(); }
function recordsNextDay(){ const c = document.getElementById('records_from').value; const t = addDaysToJalali(c, 1); document.getElementById('records_from').value=t; document.getElementById('records_to').value=t; renderRecords(); }

function updateDeletedUI(){
  const b = document.getElementById('deletedRecordsBadge');
  const cnt = records.filter(r=>r.deleted).length;
  if(b){ b.hidden = cnt===0; if(cnt>0) b.textContent = toFa(cnt); }
}
function renderDeletedRecords(){
  const tbody = document.getElementById('deletedBody');
  const empty = document.getElementById('deletedEmpty');
  if(!tbody || !empty) return;
  const deleted = records.filter(r=>r.deleted).filter(matchFilter).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  if(!deleted.length){
    tbody.innerHTML = '';
    empty.style.display = 'block';
    empty.textContent = records.some(r=>r.deleted) ? 'موردی با این فیلتر' : 'رکوردی وجود ندارد';
    return;
  }
  empty.style.display = 'none';
  tbody.innerHTML = deleted.map(r=>{
    const p = products.find(x=>x.name===r.product);
    const u = r.unit ? unitLabel(r.unit) : (p ? unitLabel(p.unit) : '—');
    const kg = getRecordKg(r);
    const typeLabel = r.type==='in' ? '📥 ورود' : '📤 خروج';
    const delStr = r.updatedAt ? formatTime(r.updatedAt) : '—';
    return `<tr style="opacity:.7;text-decoration:line-through;">
      <td data-field="date">${esc(toFa(r.date))}</td>
      <td data-field="time">${esc(toFa(r.time))}</td>
      <td data-field="type">${typeLabel}</td>
      <td data-field="product"><b>${esc(r.product||'-')}</b></td>
      <td data-field="subtype">${esc(r.subtype||'-')}</td>
      <td data-field="quantity">${fmtQty(r.quantity)}</td>
      <td data-field="unit">${esc(u)}</td>
      <td data-field="weight" style="color:var(--primary);font-weight:bold;">${fmtKg(kg)}</td>
      <td data-field="party">${esc(toFa(r.party||'-'))}</td>
      <td data-field="driver">${esc(toFa(r.driver||'-'))}</td>
      <td data-field="notes">${esc(toFa(r.notes||''))}</td>
      <td data-field="creator">${esc(toFa(r.createdByName||'-'))}</td>
      <td style="font-size:11px;">${delStr}</td>
      <td><button class="btn btn-add btn-sm" onclick="restoreRecord(${r.id})">🔄</button></td>
    </tr>`;
  }).join('');
}
async function restoreRecord(id){
  if(!canDeleteRecord(currentRole())){ showToast('دسترسی ندارید','warning'); return; }
  const ok = await customConfirm('این رکورد بازگردانی شود؟');
  if(!ok) return;
  const idx = records.findIndex(x=>x.id===id);
  if(idx!==-1){
    records[idx] = { ...records[idx], deleted:false, updatedAt:Date.now(), updatedBy:currentUser.id, updatedByName:currentUser.displayName||currentUser.username };
    logAudit('update', 'بازگردانی رکورد', id);
    markDirty();
  }
  renderRecords();
}

function markDirty(){
  dirty = true;
  const statePayload = {
    records, products, sellers, buyers, drivers, unitsList, users, auditLog,
    permanentlyDeletedIds, deletedProducts, deletedSellers, deletedBuyers, deletedDrivers, deletedUnits,
    dataEpoch, currentUser,
    letterheadCompany, letterheadCompanyAt,
    letterheadFactory, letterheadFactoryAt,
    visibleFields, visibleFieldsAt
  };

  if (typeof isLocalMode === 'function' && isLocalMode()) {
    const payload = serializeState(statePayload);
    if (typeof ghPut === 'function') {
      ghPut(payload).catch(e => {
        showToast('خطا در ذخیره‌سازی محلی: ' + e.message, 'error', 6000);
      });
    }
  } else {
    if (typeof savePendingState === 'function') savePendingState(statePayload);
  }
  
  updateSyncBar();
}

function updateSyncBar(state, msg){
  const st = document.getElementById('syncBarStatus');
  const pullBtn = document.getElementById('syncPullBtn');
  const pushBtn = document.getElementById('syncPushBtn');
  const badge = document.getElementById('unsavedTitleBadge');
  if(!st) return;
  
  const unsavedCount = records.filter(r=>(r.updatedAt||0) > (lastSyncAt||0)).length;
  if(badge){
    badge.style.display = unsavedCount>0 ? 'inline-block' : 'none';
    if(unsavedCount>0) badge.textContent = toFa(unsavedCount);
  }
  
  if (typeof isLocalMode === 'function' && isLocalMode()) {
    st.className = 'sync-bar-status synced';
    st.textContent = `💾 حالت محلی — ${toFa(records.filter(r=>!r.deleted).length)} رکورد ذخیره شده`;
    if(pullBtn) pullBtn.disabled = true;
    if(pushBtn) pushBtn.disabled = true;
    return;
  }

  const hasPushAccess = canPush(currentRole());
  if(pushBtn) pushBtn.disabled = !hasPushAccess;
  if(state==='loading'){ st.className='sync-bar-status loading'; st.textContent='🔄 '+(msg||'...'); if(pullBtn) pullBtn.disabled=true; return; }
  if(state==='saving'){ st.className='sync-bar-status loading'; st.textContent='🔄 '+(msg||'در حال ذخیره...'); if(pullBtn) pullBtn.disabled=true; if(pushBtn) pushBtn.disabled=true; return; }
  if(state==='error'){ st.className='sync-bar-status error'; st.textContent='❌ '+(msg||'خطا'); if(pullBtn) pullBtn.disabled=false; return; }
  if(!hasGhConfig()){ st.className='sync-bar-status noconfig'; st.textContent='⚪ تنظیمات دیتابیس پیکربندی نشده'; if(pullBtn) pullBtn.disabled=true; return; }
  if(dirty || unsavedCount>0){
    st.className = 'sync-bar-status dirty';
    st.textContent = unsavedCount>0 ? `🟠 ${toFa(unsavedCount)} رکورد ذخیره‌نشده` : `🟠 تغییرات ذخیره‌نشده`;
    if(pullBtn) pullBtn.disabled = false;
    return;
  }
  st.className = 'sync-bar-status synced';
  const t = lastSyncAt ? toFa(new Date(lastSyncAt).toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'})) : '';
  st.textContent = '🟢 همه چیز ذخیره شده' + (t ? ` — ${t}` : '');
  if(pullBtn) pullBtn.disabled = false;
}

async function syncPull(){
  if(!hasGhConfig()){ showToast('تنظیمات پیکربندی نشده','warning'); return; }
  if(dirty){
    const choice = await customTriple(
      '⚠️ تغییرات ذخیره‌نشده دارید.\n\nاگر فقط دریافت کنید، تغییرات از بین می‌روند.',
      {okText:'⬆️ اول ذخیره', thirdText:'🗑️ دور انداختن', cancelText:'لغو', thirdDanger:true}
    );
    if(choice===true){ await syncPush(); return; }
    if(choice==='third'){ clearPendingState(); dirty=false; }
    else return;
  }
  updateSyncBar('loading', 'در حال دریافت...');
  try {
    const raw = await ghGet();
    if(!raw){ updateSyncBar('synced'); await customAlert('فایل داده روی سرور نیست'); return; }
    const data = deserializeState(raw);
    records = data.records; products = data.products;
    sellers = data.sellers; buyers = data.buyers; drivers = data.drivers;
    unitsList = data.unitsList;
    users = data.users; auditLog = data.auditLog;
    permanentlyDeletedIds = data.permanentlyDeletedIds;
    deletedProducts = data.deletedProducts; deletedSellers = data.deletedSellers;
    deletedBuyers = data.deletedBuyers; deletedDrivers = data.deletedDrivers;
    deletedUnits = data.deletedUnits; dataEpoch = data.dataEpoch;
    letterheadCompany = data.letterheadCompany || '';
    letterheadCompanyAt = data.letterheadCompanyAt || 0;
    letterheadFactory = data.letterheadFactory || '';
    letterheadFactoryAt = data.letterheadFactoryAt || 0;
    
    localStorage.setItem('wh_letterhead_company', letterheadCompany);
    localStorage.setItem('wh_letterhead_company_at', String(letterheadCompanyAt));
    localStorage.setItem('wh_letterhead_factory', letterheadFactory);
    localStorage.setItem('wh_letterhead_factory_at', String(letterheadFactoryAt));
    
    const def = initVisibleFieldsDefault();
    const vfFromServer = data.visibleFields || {};
    ALL_FIELDS.forEach(f=>{
      if(f.mandatory){ def[f.key] = true; }
      else if(vfFromServer && typeof vfFromServer[f.key] === 'boolean'){ def[f.key] = vfFromServer[f.key]; }
    });
    visibleFields = def;
    visibleFieldsAt = data.visibleFieldsAt || 0;
    localStorage.setItem('wh_visible_fields', JSON.stringify(visibleFields));
    localStorage.setItem('wh_visible_fields_at', String(visibleFieldsAt));
    
    updateHeaderUI();
    renderFieldsList();
    applyFieldVisibility();
    
    dirty = false; lastSyncAt = Date.now();
    editingId = null; currentType = null;
    applyTypeUI(); fillFormProducts(); fillUnits(); refreshPartyOptions(); refreshDriverOptions();
    renderRecords(); renderManageLists(); renderManageProducts(); updateGhUI();
    updateSyncBar('synced');
    showToast(`${toFa(records.filter(r=>!r.deleted).length)} رکورد دریافت شد`,'success');
  } catch(e){
    updateSyncBar('error', 'خطا در دریافت');
    await customAlert('خطا در دریافت: ' + (e.message||'نامشخص'));
  }
}

async function syncPush(){
  if(!hasGhConfig()){ showToast('تنظیمات پیکربندی نشده','warning'); return; }
  if(!canPush(currentRole())){ showToast('دسترسی ذخیره ندارید','warning'); return; }
  if(ghCanWrite===false){ await customAlert('🔒 توکن فقط خواندنی است'); return; }
  updateSyncBar('saving','در حال ذخیره...');
  let rawRemote = null;
  try { rawRemote = await ghGet(); }
  catch(e){
    if(e.isNetwork){ updateSyncBar('error','عدم دسترسی'); await customAlert('عدم دسترسی به سرور — ذخیره متوقف شد.'); return; }
    updateSyncBar('error','خطا'); await customAlert('خطا: '+(e.message||'')); return;
  }
  const remote = rawRemote ? deserializeState(rawRemote) : null;
  if(remote && (remote.dataEpoch||1) > dataEpoch){
    const c = await customConfirm('⚠️ دیتابیس روی سرور بازنشانی شده. ابتدا دریافت کنید.', {okText:'دریافت', danger:true});
    if(c){ await syncPull(); }
    return;
  }
  const remoteTomb = remote ? remote.permanentlyDeletedIds : [];
  permanentlyDeletedIds = Array.from(new Set([...permanentlyDeletedIds, ...remoteTomb]));
  if(remote){
    deletedProducts = Array.from(new Set([...deletedProducts, ...remote.deletedProducts]));
    deletedSellers = Array.from(new Set([...deletedSellers, ...remote.deletedSellers]));
    deletedBuyers = Array.from(new Set([...deletedBuyers, ...remote.deletedBuyers]));
    deletedDrivers = Array.from(new Set([...deletedDrivers, ...remote.deletedDrivers]));
    deletedUnits = Array.from(new Set([...deletedUnits, ...remote.deletedUnits]));
  }
  
  // Merge all data
  records = mergeRecordsById(records, remote?remote.records:[], permanentlyDeletedIds);
  products = mergeProductsRespectingTombstones(products, remote?remote.products:[], deletedProducts);
  sellers = mergeWithTombstones(sellers, remote?remote.sellers:[], deletedSellers);
  buyers = mergeWithTombstones(buyers, remote?remote.buyers:[], deletedBuyers);
  drivers = mergeWithTombstones(drivers, remote?remote.drivers:[], deletedDrivers);
  unitsList = mergeUnitsRespectingTombstones(unitsList, remote?remote.unitsList:[], deletedUnits);
  
  // Merge users (remote is authoritative for existing IDs)
  if(remote && remote.users && remote.users.length) {
    users = mergeUsers(users, remote.users);
  }
  
  // Merge letterhead with timestamps
  if (remote) {
    const mc = mergeLetterheadValue(letterheadCompany, letterheadCompanyAt, remote.letterheadCompany || '', remote.letterheadCompanyAt || 0);
    letterheadCompany = mc.val; letterheadCompanyAt = mc.at;
    const mf = mergeLetterheadValue(letterheadFactory, letterheadFactoryAt, remote.letterheadFactory || '', remote.letterheadFactoryAt || 0);
    letterheadFactory = mf.val; letterheadFactoryAt = mf.at;
    
    localStorage.setItem('wh_letterhead_company', letterheadCompany);
    localStorage.setItem('wh_letterhead_company_at', String(letterheadCompanyAt));
    localStorage.setItem('wh_letterhead_factory', letterheadFactory);
    localStorage.setItem('wh_letterhead_factory_at', String(letterheadFactoryAt));
    updateHeaderUI();
    
    const mvf = mergeVisibleFieldsValue(visibleFields, visibleFieldsAt, remote.visibleFields || {}, remote.visibleFieldsAt || 0);
    const mergedFields = mvf.fields;
    const def = initVisibleFieldsDefault();
    ALL_FIELDS.forEach(f=>{
      if(f.mandatory){ def[f.key] = true; }
      else if(mergedFields && typeof mergedFields[f.key] === 'boolean'){ def[f.key] = mergedFields[f.key]; }
    });
    visibleFields = def;
    visibleFieldsAt = mvf.at;
    localStorage.setItem('wh_visible_fields', JSON.stringify(visibleFields));
    localStorage.setItem('wh_visible_fields_at', String(visibleFieldsAt));
    renderFieldsList();
    applyFieldVisibility();
  }
  
  // Merge auditLog
  if(remote && remote.auditLog){
    const key = a=>a.t+'|'+a.action+'|'+a.userId+'|'+(a.detail||'');
    const seen = new Set(auditLog.map(key));
    remote.auditLog.forEach(a=>{ if(!seen.has(key(a))){ auditLog.push(a); seen.add(key(a)); } });
    auditLog = auditLog.slice(-800);
  }

  const payload = serializeState({
    records, products, sellers, buyers, drivers, unitsList, users, auditLog,
    permanentlyDeletedIds, deletedProducts, deletedSellers, deletedBuyers, deletedDrivers, deletedUnits,
    dataEpoch, currentUser,
    letterheadCompany, letterheadCompanyAt,
    letterheadFactory, letterheadFactoryAt,
    visibleFields, visibleFieldsAt
  });
  try {
    await ghPut(payload);
    dirty = false; lastSyncAt = Date.now(); ghCanWrite = true;
    clearPendingState();
    renderRecords(); renderManageLists(); renderManageProducts(); updateGhUI();
    updateSyncBar('synced');
    showToast('تغییرات روی سرور ذخیره شد','success');
  } catch(e){
    if(e.status===409){ await customAlert('تضاد نسخه — دوباره تلاش می‌کنم'); return syncPush(); }
    if(e.status===403||e.status===404){ ghCanWrite=false; updateSyncBar('synced'); await customAlert('🔒 دسترسی نوشتن ندارد'); return; }
    updateSyncBar('error','خطا در ذخیره');
    await customAlert('خطا در ذخیره: '+(e.message||''));
  }
}

async function saveGhConfigFromUI(){
  ghConfig.owner = document.getElementById('ghOwner').value.trim();
  ghConfig.repo = document.getElementById('ghRepo').value.trim();
  ghConfig.token = document.getElementById('ghToken').value.trim();
  if(!ghConfig.owner||!ghConfig.repo||!ghConfig.token){
    document.getElementById('ghInfo').textContent = '❌ همه فیلدها را پر کنید'; return;
  }
  saveGhConfig();
  ghFileSha = null; ghCanWrite = null;
  try {
    const raw = await ghGet();
    document.getElementById('ghInfo').textContent = raw ? '✅ اتصال برقرار شد' : '⚠️ فایل یافت نشد';
    const perm = await checkTokenPermissions();
    if(perm) ghCanWrite = perm.canWrite;
    
    const ghHeader = document.getElementById('ghSection').previousElementSibling;
    if(!document.getElementById('ghSection').classList.contains('collapsed')){
       toggleAccordion('ghSection', ghHeader);
    }
    updateGhUI();
  } catch(err){
    document.getElementById('ghInfo').textContent = '❌ خطا: '+(err.message||'');
  }
  updateSyncBar();
}

/* ─── Receipt / preview ─── */
function viewRecord(id){
  const r = records.find(x=>x.id===id);
  if(!r || r.deleted){ showToast('یافت نشد','error'); return; }
  currentPreviewRecordId = id;
  document.getElementById('receiptPreviewPaper').innerHTML = buildReceipt(r, true);
  document.getElementById('receiptPreviewOverlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function closeReceiptPreview(){
  document.getElementById('receiptPreviewOverlay').style.display = 'none';
  document.body.style.overflow = '';
  currentPreviewRecordId = null;
}
function printReceiptFromPreview(){
  if(currentPreviewRecordId===null) return;
  const r = records.find(x=>x.id===currentPreviewRecordId);
  if(!r) return;
  const html = buildReceipt(r, true);
  closeReceiptPreview();
  runPrint(html, '@page{size:A5 portrait;margin:6mm;}');
}

function buildReceipt(r, showLetterhead){
  const isIn = r.type==='in';
  const partyLabel = isIn ? 'فروشنده' : 'خریدار';
  const title = isIn ? 'رسید ورود کالا به انبار' : 'رسید خروج کالا از انبار';
  const productLabel = isIn ? 'کالای دریافتی' : 'کالای تحویلی';
  const p = products.find(x=>x.name===r.product);
  const unit = r.unit ? unitLabel(r.unit) : (p ? unitLabel(p.unit) : '—');
  const kg = getRecordKg(r);
  const receiptNo = String(r.id||'').slice(-8);
  const fullProduct = productFullName(r);
  let head = '';
  if(showLetterhead){
    head = `<div class="p-receipt-company">${esc(letterheadCompany)}</div>
            <div class="p-receipt-factory">${esc(letterheadFactory)} — واحد انبار</div>`;
  }
  
  const qtyRow = (r.quantity && String(r.quantity).trim()) ? 
    `<tr><td class="p-receipt-lbl">تعداد</td><td class="p-receipt-val" style="text-align:left;">${fmtQty(r.quantity)} ${esc(unit)}</td></tr>` : '';
  const kgRow = kg>0 ? `<tr><td class="p-receipt-lbl">مجموع وزنی</td><td class="p-receipt-val" style="text-align:left;">${fmtKg(kg)}</td></tr>` : '';
  
  const partyRow = r.party ? `<tr><td class="p-receipt-lbl">${partyLabel}</td><td class="p-receipt-val" style="text-align:left;">${esc(toFa(r.party))}</td></tr>` : '';
  const driverRow = r.driver ? `<tr><td class="p-receipt-lbl">راننده</td><td class="p-receipt-val" style="text-align:left;">${esc(toFa(r.driver))}</td></tr>` : '';
  const invoiceRow = r.invoiceNumber ? `<tr><td class="p-receipt-lbl">شماره فاکتور</td><td class="p-receipt-val" style="text-align:left;">${esc(toFa(r.invoiceNumber))}</td></tr>` : '';
  const basilRow = r.basilNumber ? `<tr><td class="p-receipt-lbl">شماره باسکول</td><td class="p-receipt-val" style="text-align:left;">${esc(toFa(r.basilNumber))}</td></tr>` : '';
  const waybillRow = r.waybillNumber ? `<tr><td class="p-receipt-lbl">شماره بارنامه</td><td class="p-receipt-val" style="text-align:left;">${esc(toFa(r.waybillNumber))}</td></tr>` : '';
  
  const notesBlock = r.notes ? `<div class="p-receipt-notes-block" style="padding:10px 0;"><div style="font-weight:bold;font-size:0.9rem;color:#555;margin-bottom:3px;">توضیحات</div><div style="white-space:pre-wrap;font-size:0.9rem;line-height:1.6;">${esc(toFa(r.notes))}</div></div>` : '';
  
  let sig = '';
  if(showLetterhead){
    sig = `<div class="p-receipt-signatures">
      <div class="p-receipt-sig"><div class="p-receipt-sig-title">انباردار</div><div class="p-receipt-sig-line">(امضاء و تاریخ)</div></div>
      <div class="p-receipt-sig"><div class="p-receipt-sig-title">${partyLabel}</div><div class="p-receipt-sig-line">(امضاء و تاریخ)</div></div>
    </div>
    <div class="p-receipt-footer">توجه: مقادیر وزنی بر حسب کیلوگرم — تاریخ صدور: ${todayJalali()} — ساعت ${nowTime()}</div>`;
  } else {
    sig = `<div class="p-receipt-footer" style="border-top:1px solid #000;">توجه: مقادیر وزنی بر حسب کیلوگرم — بدون سربرگ</div>`;
  }

  return `<div class="p-receipt">
    ${head}
    ${head?'<hr class="p-receipt-hr">':''}
    <div class="p-receipt-title">${title}</div>
    <div class="p-receipt-no">شماره رسید: ${toFa(receiptNo)}</div>
    <hr class="p-receipt-hr">
    <div class="p-receipt-meta"><span>${esc(toFa(r.date)||'-')}</span><span>${esc(toFa(r.time)||'-')}</span></div>
    <hr class="p-receipt-hr-dash">
    
    <div style="text-align:center; margin-bottom:10px;">
      <div style="font-size:0.85rem;color:#666;">${productLabel}</div>
      <div style="font-size:1.3rem; font-weight:900;">${esc(fullProduct)||'-'}</div>
    </div>

    <table class="p-receipt-table">
      ${qtyRow}
      ${kgRow}
    </table>
    
    <hr class="p-receipt-hr-dash">
    
    <table class="p-receipt-table">
      ${partyRow}
      ${driverRow}
      ${invoiceRow}
      ${basilRow}
      ${waybillRow}
    </table>
    
    ${notesBlock}
    ${sig}
  </div>`;
}

/* ─── Print ─── */
function setPrintPageRule(rule){
  const old = document.getElementById('__dyn_page_style__');
  if(old) old.remove();
  if(!rule) return;
  const s = document.createElement('style');
  s.id = '__dyn_page_style__'; s.textContent = rule;
  document.head.appendChild(s);
  void document.body.offsetHeight;
}
function runPrint(html, rule){
  if(rule) setPrintPageRule(rule);
  document.getElementById('printArea').innerHTML = html;
  void document.body.offsetHeight;
  setTimeout(()=>{
    const cleanup = ()=>{ document.getElementById('printArea').innerHTML=''; window.removeEventListener('afterprint', cleanup); };
    window.addEventListener('afterprint', cleanup, {once:true});
    window.print();
    setTimeout(cleanup, 3000);
  }, 200);
}
function buildPrintHeader(){ return `<div class="p-letterhead"><div class="p-company">${esc(letterheadCompany)}</div><div class="p-factory">${esc(letterheadFactory)}</div></div>`; }
function buildSignature(){
  return `<div class="p-signature">
    <div class="p-sig-box"><div class="p-sig-label">نام و امضاء انباردار</div><div class="p-sig-space"></div><div class="p-sig-hint">(امضاء)</div></div>
    <div class="p-sig-box"><div class="p-sig-label">تاریخ</div><div class="p-sig-space"></div><div class="p-sig-hint">روز/ماه/سال</div></div>
  </div>
  <div class="p-footer-note">توجه: تمامی مقادیر وزنی بر حسب کیلوگرم — این گزارش به‌صورت خودکار تهیه شده است.</div>`;
}
function buildMovementTable(list, partyLabel){
  if(!list.length) return '<div class="p-empty-msg">موردی یافت نشد</div>';
  let totalKg = 0;
  const rows = list.map((r,i)=>{
    const p = products.find(x=>x.name===r.product);
    const u = r.unit ? unitLabel(r.unit) : (p ? unitLabel(p.unit) : '');
    const kg = getRecordKg(r); totalKg += kg;
    return `<tr>
      <td>${toFa(i+1)}</td>
      <td>${esc(toFa(r.date)||'')}</td>
      <td>${esc(toFa(r.time)||'')}</td>
      <td>${esc((r.product||'-') + (r.subtype?' '+r.subtype:''))}</td>
      <td>${fmtQty(r.quantity)||'-'}</td>
      <td>${esc(u)}</td>
      <td><b>${fmtKg(kg)}</b></td>
      <td>${esc(toFa(r.party||'-'))}</td>
      <td>${esc(toFa(r.driver||'-'))}</td>
      <td>${esc(toFa(r.invoiceNumber||'-'))}</td>
      <td>${esc(toFa(r.basilNumber||'-'))}</td>
      <td>${esc(toFa(r.waybillNumber||'-'))}</td>
      <td>${esc(toFa(r.notes||'-'))}</td>
    </tr>`;
  }).join('');
  return `<table class="p-table">
    <colgroup>
      <col style="width:3%"><col style="width:7%"><col style="width:4%"><col style="width:16%">
      <col style="width:5%"><col style="width:5%"><col style="width:6%"><col style="width:8%">
      <col style="width:8%"><col style="width:7%"><col style="width:6%"><col style="width:6%"><col style="width:19%">
    </colgroup>
    <thead><tr>
      <th>#</th><th>تاریخ</th><th>ساعت</th><th>کالا</th><th>تعداد</th><th>واحد</th><th>وزن</th>
      <th>${partyLabel}</th><th>راننده</th><th>فاکتور</th><th>باسکول</th><th>بارنامه</th><th>توضیحات</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tbody><tr class="footer-row"><td colspan="6" style="text-align:left;font-weight:900;">جمع وزن:</td><td style="font-weight:900;">${fmtKg(totalKg)}</td><td colspan="6"></td></tr></tbody>
  </table>`;
}
function buildSummaryPrintBlock(){
  const list = buildSummaryData();
  if(!list.length) return '';
  let totalIn = 0, totalOut = 0;
  const rows = list.map((item,i)=>{
    let inShown, outShown;
    if(item.mode==='qty'){
      inShown = item.totalInQty>0 ? `${fmtQty(item.totalInQty)} ${esc(item.unitLabel)}` : '—';
      outShown = item.totalOutQty>0 ? `${fmtQty(item.totalOutQty)} ${esc(item.unitLabel)}` : '—';
    } else if(item.mode==='qty-multi'){
      inShown = item.totalInQty>0 ? fmtQty(item.totalInQty) : '—';
      outShown = item.totalOutQty>0 ? fmtQty(item.totalOutQty) : '—';
    } else {
      totalIn += item.totalIn; totalOut += item.totalOut;
      inShown = item.totalIn>0 ? fmtKg(item.totalIn) : '—';
      outShown = item.totalOut>0 ? fmtKg(item.totalOut) : '—';
    }
    return `<tr><td>${toFa(i+1)}</td><td style="text-align:right;">${esc(item.name)}</td><td>${inShown}</td><td>${outShown}</td></tr>`;
  }).join('');
  return `<div class="p-summary-block">
    <div class="p-summary-title">خلاصه ورود و خروج کالا</div>
    <table class="p-summary-table"><thead><tr><th>#</th><th>کالا</th><th>مجموع ورود</th><th>مجموع خروج</th></tr></thead>
    <tbody>${rows}</tbody>
    <tbody><tr><td colspan="2" style="text-align:right;font-weight:900;">جمع کل</td><td>${fmtKg(totalIn)}</td><td>${fmtKg(totalOut)}</td></tr></tbody></table>
  </div>`;
}
async function askForLetterhead(){
  return await customTriple('🖨️ تنظیمات چاپ\n\nسربرگ درج شود؟', {okText:'✅ با سربرگ', thirdText:'❌ بدون سربرگ', cancelText:'لغو'});
}
async function printInReport(){
  const list = getVisibleRecords().filter(r=>r.type==='in').filter(matchFilter).sort(sortFn);
  if(!list.length){ showToast('موردی برای چاپ نیست','info'); return; }
  const choice = await askForLetterhead();
  if(choice===false) return;
  const h = choice===true ? buildPrintHeader() : '';
  const s = choice===true ? buildSignature() : '';
  runPrint(h + `<div class="p-section-title">گزارش ورود کالا (${toFa(list.length)})</div>` + buildMovementTable(list,'فروشنده') + buildSummaryPrintBlock() + s, '@page{size:A4 portrait;margin:6mm;}');
}
async function printOutReport(){
  const list = getVisibleRecords().filter(r=>r.type==='out').filter(matchFilter).sort(sortFn);
  if(!list.length){ showToast('موردی برای چاپ نیست','info'); return; }
  const choice = await askForLetterhead();
  if(choice===false) return;
  const h = choice===true ? buildPrintHeader() : '';
  const s = choice===true ? buildSignature() : '';
  runPrint(h + `<div class="p-section-title">گزارش خروج کالا (${toFa(list.length)})</div>` + buildMovementTable(list,'خریدار') + buildSummaryPrintBlock() + s, '@page{size:A4 portrait;margin:6mm;}');
}
async function printFullReport(){
  const inL = getVisibleRecords().filter(r=>r.type==='in').filter(matchFilter).sort(sortFn);
  const outL = getVisibleRecords().filter(r=>r.type==='out').filter(matchFilter).sort(sortFn);
  if(!inL.length && !outL.length){ showToast('موردی برای چاپ نیست','info'); return; }
  const choice = await askForLetterhead();
  if(choice===false) return;
  const h = choice===true ? buildPrintHeader() : '';
  const s = choice===true ? buildSignature() : '';
  let body = `<div class="p-section-title">گزارش جامع انبار</div>`;
  if(inL.length){ body += `<div class="p-section-title">بخش ورود (${toFa(inL.length)})</div>` + buildMovementTable(inL,'فروشنده'); }
  if(inL.length && outL.length) body += '<div class="p-section-gap"></div>';
  if(outL.length){ body += `<div class="p-section-title">بخش خروج (${toFa(outL.length)})</div>` + buildMovementTable(outL,'خریدار'); }
  runPrint(h + body + buildSummaryPrintBlock() + s, '@page{size:A4 portrait;margin:6mm;}');
}
async function printSummaryReport(){
  const list = buildSummaryData();
  if(!list.length){ showToast('موردی نیست','info'); return; }
  const choice = await askForLetterhead();
  if(choice===false) return;
  const h = choice===true ? buildPrintHeader() : '';
  const s = choice===true ? buildSignature() : '';
  runPrint(h + buildSummaryPrintBlock() + s, '@page{size:A4 portrait;margin:6mm;}');
}
async function printDailySummaryReport(){
  const data = buildDailySummaryData();
  if(!data.dates.length){ showToast('موردی نیست','info'); return; }
  const choice = await askForLetterhead();
  if(choice===false) return;
  const h = choice===true ? buildPrintHeader() : '';
  const s = choice===true ? buildSignature() : '';
  runPrint(h + buildDailySummaryPrintBlock(data) + s, '@page{size:A4 portrait;margin:6mm;}');
}

function buildSummaryData(){
  const visible = getVisibleRecords().filter(matchFilter);
  const map = new Map();
  visible.forEach(r=>{
    const p = r.product || '(بدون نام)';
    const sub = r.subtype || '';
    const name = (summaryMode==='detailed' && sub) ? `${p} ${sub}`.trim() : p;
    if(!map.has(name)) map.set(name, { name, product:p, subtype:sub, totalIn:0, totalOut:0, totalInQty:0, totalOutQty:0, units:new Set(), hasWeighted:false, hasNonWeighted:false });
    const item = map.get(name);
    const kg = getRecordKg(r);
    const qty = parseFloat(toLatinDigits(String(r.quantity||''))) || 0;
    const u = r.unit||''; const f = unitFactor(u);
    const isW = (f!==null && f!==undefined);
    if(isW) item.hasWeighted = true; else item.hasNonWeighted = true;
    if(u) item.units.add(u);
    if(r.type==='in'){ item.totalIn+=kg; item.totalInQty+=qty; }
    else if(r.type==='out'){ item.totalOut+=kg; item.totalOutQty+=qty; }
  });
  const list = Array.from(map.values());
  list.forEach(item=>{
    item.unitsArr = Array.from(item.units);
    if(!item.hasWeighted && item.hasNonWeighted){
      if(item.unitsArr.length===1){ item.mode='qty'; item.unitLabel=unitLabel(item.unitsArr[0]); }
      else item.mode = 'qty-multi';
    } else item.mode = 'kg';
  });
  list.sort((a,b)=>a.name.localeCompare(b.name,'fa'));
  return list;
}
function renderSummary(){
  const list = buildSummaryData();
  const body = document.getElementById('summaryBody');
  const foot = document.getElementById('summaryFoot');
  if(!body || !foot) return;
  if(!list.length){ body.innerHTML=''; foot.innerHTML=''; return; }
  let totalIn = 0, totalOut = 0;
  body.innerHTML = list.map((item,i)=>{
    let inS, outS;
    if(item.mode==='qty' || item.mode==='qty-multi'){
      inS = item.totalInQty>0 ? `${fmtQty(item.totalInQty)}${item.mode==='qty'?' '+esc(item.unitLabel):''}` : '—';
      outS = item.totalOutQty>0 ? `${fmtQty(item.totalOutQty)}${item.mode==='qty'?' '+esc(item.unitLabel):''}` : '—';
    } else {
      totalIn += item.totalIn; totalOut += item.totalOut;
      inS = item.totalIn>0 ? fmtKg(item.totalIn) : '—';
      outS = item.totalOut>0 ? fmtKg(item.totalOut) : '—';
    }
    const pc = item.subtype ? `<span style="display:block;">${esc(item.product)}</span><span style="display:block;font-size:.85em;color:var(--muted);font-weight:normal;">${esc(item.subtype)}</span>` : esc(item.product);
    return `<tr><td class="num-cell">${toFa(i+1)}</td><td class="product-cell">${pc}</td><td class="in-cell">${inS}</td><td class="out-cell">${outS}</td></tr>`;
  }).join('');
  foot.innerHTML = `<tr><td colspan="2" class="foot-label" style="text-align:right;font-weight:900;">جمع کل (${toFa(list.length)})</td><td class="foot-in">${fmtKg(totalIn)}</td><td class="foot-out">${fmtKg(totalOut)}</td></tr>`;
}
function setSummaryMode(mode){
  summaryMode = mode;
  localStorage.setItem('wh_summary_mode', mode);
  document.getElementById('sumModeGrouped')?.classList.toggle('active', mode==='grouped');
  document.getElementById('sumModeDetailed')?.classList.toggle('active', mode==='detailed');
  renderSummary();
}

function buildDailySummaryData(){
  const visible = getVisibleRecords().filter(matchFilter);
  const dateSet = new Set(), weightedSet = new Set(), nonWeightedSet = new Set();
  const keyInfo = new Map();
  const keyFn = r => {
    const k = summaryMode==='detailed' ? (r.subtype ? `${r.product||''} ${r.subtype}`.trim() : (r.product||'')) : (r.product||'');
    if(k && !keyInfo.has(k)) keyInfo.set(k,{product:r.product||'',subtype:r.subtype||''});
    return k;
  };
  const isW = r => { const f = unitFactor(r.unit); return f!==null && f!==undefined; };
  visible.forEach(r=>{
    if(r.date) dateSet.add(normalizeDate(r.date));
    const k = keyFn(r); if(!k) return;
    (isW(r)?weightedSet:nonWeightedSet).add(k);
  });
  const dates = Array.from(dateSet).sort();
  const wIn = new Set(), wOut = new Set(), nIn = new Set(), nOut = new Set();
  const wMatrix = {}, nMatrix = {};
  dates.forEach(d=>{ wMatrix[d]={}; nMatrix[d]={}; });
  visible.forEach(r=>{
    const d = normalizeDate(r.date), k = keyFn(r); if(!d||!k) return;
    const w = isW(r);
    const m = w ? wMatrix : nMatrix;
    if(!m[d]) m[d]={};
    if(!m[d][k]) m[d][k] = {in:0, out:0};
    if(w){
      const kg = getRecordKg(r);
      if(r.type==='in') m[d][k].in+=kg; else if(r.type==='out') m[d][k].out+=kg;
    } else {
      const qty = parseFloat(toLatinDigits(String(r.quantity||'')))||0;
      if(r.type==='in') m[d][k].in+=qty; else if(r.type==='out') m[d][k].out+=qty;
    }
    if(r.type==='in') (w?wIn:nIn).add(k); else if(r.type==='out') (w?wOut:nOut).add(k);
  });
  return {
    dates,
    weightedIn: Array.from(wIn).sort((a,b)=>a.localeCompare(b,'fa')),
    weightedOut: Array.from(wOut).sort((a,b)=>a.localeCompare(b,'fa')),
    nonWeightedIn: Array.from(nIn).sort((a,b)=>a.localeCompare(b,'fa')),
    nonWeightedOut: Array.from(nOut).sort((a,b)=>a.localeCompare(b,'fa')),
    weightedMatrix: wMatrix, nonWeightedMatrix: nMatrix,
    keyInfo
  };
}
function buildDailySummaryPrintBlock(data){
  const {dates, weightedIn, weightedOut, nonWeightedIn, nonWeightedOut, weightedMatrix, nonWeightedMatrix, keyInfo} = data;
  if(!dates.length) return '';
  const hasW = weightedIn.length+weightedOut.length>0;
  const hasN = nonWeightedIn.length+nonWeightedOut.length>0;
  const wIn=weightedIn.length, wOut=weightedOut.length, nIn=nonWeightedIn.length, nOut=nonWeightedOut.length;
  
  const header1 = `<tr><th rowspan="3" style="border:2px solid #000; width:10%;">تاریخ</th>
    ${hasW?`<th colspan="${wIn+wOut}" style="border:2px solid #000;background:#e5e5e5!important;">کالاهای وزنی</th>`:''}
    ${hasN?`<th colspan="${nIn+nOut}" style="border:2px solid #000;background:#e5e5e5!important;">کالاهای شمارشی</th>`:''}
    <th colspan="2" style="border:2px solid #000;background:#e5e5e5!important;">جمع روز</th></tr>`;
  const header2 = `<tr>
    ${wIn?`<th colspan="${wIn}" style="background:#f0f0f0!important;">ورودی</th>`:''}
    ${wOut?`<th colspan="${wOut}" style="background:#f0f0f0!important;">خروجی</th>`:''}
    ${nIn?`<th colspan="${nIn}" style="background:#f0f0f0!important;">ورودی</th>`:''}
    ${nOut?`<th colspan="${nOut}" style="background:#f0f0f0!important;">خروجی</th>`:''}
    <th rowspan="2" style="background:#f0f0f0!important;">ورود</th>
    <th rowspan="2" style="background:#f0f0f0!important;">خروج</th>
  </tr>`;
  const header3 = '<tr>' +
    weightedIn.map(k=>`<th style="background:#f9f9f9!important;font-size:8pt;">${esc(keyInfo.get(k)?.product||k)}${keyInfo.get(k)?.subtype?'<br><span style="font-size:7pt;font-weight:normal;">'+esc(keyInfo.get(k).subtype)+'</span>':''}</th>`).join('') +
    weightedOut.map(k=>`<th style="background:#f9f9f9!important;font-size:8pt;">${esc(keyInfo.get(k)?.product||k)}${keyInfo.get(k)?.subtype?'<br><span style="font-size:7pt;font-weight:normal;">'+esc(keyInfo.get(k).subtype)+'</span>':''}</th>`).join('') +
    nonWeightedIn.map(k=>`<th style="background:#f9f9f9!important;font-size:8pt;">${esc(keyInfo.get(k)?.product||k)}</th>`).join('') +
    nonWeightedOut.map(k=>`<th style="background:#f9f9f9!important;font-size:8pt;">${esc(keyInfo.get(k)?.product||k)}</th>`).join('') +
    '</tr>';
  let body = '';
  const totals = { wIn:{}, wOut:{}, nIn:{}, nOut:{}, in:0, out:0 };
  weightedIn.forEach(k=>totals.wIn[k]=0);
  weightedOut.forEach(k=>totals.wOut[k]=0);
  nonWeightedIn.forEach(k=>totals.nIn[k]=0);
  nonWeightedOut.forEach(k=>totals.nOut[k]=0);
  dates.forEach(d=>{
    let rowInTotal = 0, rowOutTotal = 0;
    let row = `<tr><td style="border:1px solid #666;background:#f0f0f0!important;font-weight:900;">${esc(toFa(d))}</td>`;
    
    weightedIn.forEach(k=>{ const v = weightedMatrix[d]?.[k]?.in||0; totals.wIn[k]+=v; rowInTotal+=v; row += `<td style="border:1px solid #666;">${v>0?fmtKg(v):'—'}</td>`; });
    weightedOut.forEach(k=>{ const v = weightedMatrix[d]?.[k]?.out||0; totals.wOut[k]+=v; rowOutTotal+=v; row += `<td style="border:1px solid #666;">${v>0?fmtKg(v):'—'}</td>`; });
    nonWeightedIn.forEach(k=>{ const v = nonWeightedMatrix[d]?.[k]?.in||0; totals.nIn[k]+=v; rowInTotal+=v; row += `<td style="border:1px solid #666;">${v>0?fmtQty(v):'—'}</td>`; });
    nonWeightedOut.forEach(k=>{ const v = nonWeightedMatrix[d]?.[k]?.out||0; totals.nOut[k]+=v; rowOutTotal+=v; row += `<td style="border:1px solid #666;">${v>0?fmtQty(v):'—'}</td>`; });
    
    totals.in += rowInTotal;
    totals.out += rowOutTotal;
    row += `<td style="border:1px solid #666;font-weight:900;background:#f0f0f0!important;">${rowInTotal>0?fmtKg(rowInTotal):'—'}</td>`;
    row += `<td style="border:1px solid #666;font-weight:900;background:#f0f0f0!important;">${rowOutTotal>0?fmtKg(rowOutTotal):'—'}</td>`;
    
    row += '</tr>';
    body += row;
  });
  const foot = '<tr style="background:#d4d4d4!important;font-weight:900;">' +
    '<td style="border:1px solid #666;">جمع</td>' +
    weightedIn.map(k=>`<td style="border:1px solid #666;">${totals.wIn[k]>0?fmtKg(totals.wIn[k]):'—'}</td>`).join('') +
    weightedOut.map(k=>`<td style="border:1px solid #666;">${totals.wOut[k]>0?fmtKg(totals.wOut[k]):'—'}</td>`).join('') +
    nonWeightedIn.map(k=>`<td style="border:1px solid #666;">${totals.nIn[k]>0?fmtQty(totals.nIn[k]):'—'}</td>`).join('') +
    nonWeightedOut.map(k=>`<td style="border:1px solid #666;">${totals.nOut[k]>0?fmtQty(totals.nOut[k]):'—'}</td>`).join('') +
    `<td style="border:1px solid #666;">${totals.in>0?fmtKg(totals.in):'—'}</td>` +
    `<td style="border:1px solid #666;">${totals.out>0?fmtKg(totals.out):'—'}</td>` +
    '</tr>';
  return `<div class="p-daily-block">
    <div class="p-summary-title">روند روزانه ورود و خروج کالا</div>
    <table class="p-daily-table">
      <thead>${header1}${header2}${header3}</thead>
      <tbody>${body}</tbody>
      <tbody>${foot}</tbody>
    </table>
  </div>`;
}

function exportCSV(type){
  const list = getVisibleRecords().filter(r=>r.type===type).filter(matchFilter).sort(sortFn);
  if(!list.length){ showToast('داده‌ای نیست','info'); return; }
  const party = type==='in' ? 'فروشنده' : 'خریدار';
  const rows = [['#','تاریخ','ساعت','کالا','زیرمجموعه','تعداد','واحد','وزن',party,'راننده','فاکتور','باسکول','بارنامه','توضیحات','ثبت‌کننده']];
  list.forEach((r,i)=>{
    const p = products.find(x=>x.name===r.product);
    const u = r.unit ? unitLabel(r.unit) : (p ? unitLabel(p.unit) : '');
    rows.push([i+1, toLatinDigits(r.date||''), toLatinDigits(r.time||''), r.product||'', r.subtype||'', toLatinDigits(r.quantity||''), u, getRecordKg(r), r.party||'', r.driver||'', r.invoiceNumber||'', r.basilNumber||'', r.waybillNumber||'', r.notes||'', r.createdByName||'']);
  });
  const csv = rows.map(r=>r.map(c=>{ const s = String(c==null?'':c); return /[",\n\r]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; }).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `warehouse-${type}-${Date.now()}.csv`;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
}

async function menuAddProductFull(){
  if(!canEditRecord(currentRole())) return;
  const n = await customPrompt('نام کالای جدید:','');
  if(!n) return;
  const name = n.trim();
  if(!name || products.some(p=>p.name===name)){ showToast('نام تکراری یا خالی','warning'); return; }
  const unitListStr = unitsList.map((u,i)=>`${i+1}. ${u.v} (${u.l})`).join('\n');
  const idxStr = await customPrompt('شماره واحد پیش‌فرض:\n'+unitListStr, '1');
  if(!idxStr) return;
  const idx = parseInt(toLatinDigits(idxStr)) - 1;
  const unit = unitsList[idx]?.v || unitsList[0]?.v || 'kg';
  const subsStr = await customPrompt('زیرمجموعه‌ها (با کاما):', '');
  const subtypes = subsStr ? subsStr.split(',').map(s=>s.trim()).filter(Boolean) : [];
  deletedProducts = deletedProducts.filter(x=>x!==name);
  products.push({ name, unit, subtypes, updatedAt: Date.now() });
  markDirty(); fillFormProducts(); renderManageProducts(); updateSubtypesForProduct();
}

async function editProductInSettings(index){
  if(!canEditRecord(currentRole())) return;
  const p = products[index]; if(!p) return;
  const oldName = p.name;
  
  const n = await customPrompt('نام کالا:', p.name);
  if(!n || !n.trim()) return;
  const newName = n.trim();
  
  if(newName !== oldName && products.some(x=>x.name === newName)) {
    showToast('نام کالای دیگریست', 'warning'); return;
  }

  const unitListStr = unitsList.map((u,i)=>`${i+1}. ${u.v} (${u.l})`).join('\n');
  const currentUnitIdx = unitsList.findIndex(u=>u.v===p.unit) + 1;
  const idxStr = await customPrompt('شماره واحد پیش‌فرض:\n'+unitListStr, String(currentUnitIdx||1));
  if(!idxStr) return;
  const idx2 = parseInt(toLatinDigits(idxStr)) - 1;
  const newUnit = unitsList[idx2]?.v || unitsList[0]?.v || 'kg';

  const currentSubsStr = (p.subtypes || []).join(', ');
  const subsStr = await customPrompt('زیرمجموعه‌ها (با کاما):', currentSubsStr);
  const newSubs = subsStr ? subsStr.split(',').map(s=>s.trim()).filter(Boolean) : [];

  products[index] = { name: newName, unit: newUnit, subtypes: newSubs, updatedAt: Date.now() };
  deletedProducts = deletedProducts.filter(x => x !== newName);

  if(oldName !== newName) {
    records.forEach(r => { if(r.product === oldName) r.product = newName; });
  }

  markDirty();
  fillFormProducts();
  renderManageProducts();
  renderRecords();
}

async function deleteProductFromSettings(index){
  const p = products[index]; if(!p) return;
  const ok = await customConfirm(`کالای «${p.name}» حذف شود؟`, {okText:'حذف', danger:true});
  if(!ok) return;
  products.splice(index,1);
  if(!deletedProducts.includes(p.name)) deletedProducts.push(p.name);
  markDirty(); fillFormProducts(); renderManageProducts();
}
function renderManageProducts(){
  const el = document.getElementById('manageProducts'); if(!el) return;
  if(!products.length){ el.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:12px;padding:12px;">خالی</div>'; return; }
  
  const q = (document.getElementById('searchProductList')?.value || '').trim().toLowerCase();
  const filtered = products.map((p, i) => ({p, originalIndex: i})).filter(item => 
    !q || item.p.name.toLowerCase().includes(q)
  );

  if(!filtered.length){ el.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:12px;padding:12px;">یافت نشد</div>'; return; }

  el.innerHTML = filtered.map(({p, originalIndex}) => {
    const subs = (p.subtypes||[]).filter(s=>s&&s.trim());
    const subHtml = subs.length ? `<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px;">${subs.map(s=>`<span style="font-size:10.5px;background:var(--card);color:var(--primary-dark);padding:2px 8px;border-radius:10px;border:1px solid var(--border);font-weight:bold;">${esc(s)}</span>`).join('')}</div>` : '';
    return `<div style="display:flex;justify-content:space-between;gap:8px;padding:8px;border-radius:8px;background:var(--subtle-bg);border:1px solid var(--border);margin-bottom:6px;">
      <div style="flex:1;min-width:0;"><div style="font-size:12.5px;font-weight:bold;">📦 ${esc(p.name)} <span style="font-size:10px;color:var(--muted);font-weight:normal;">${esc(unitLabel(p.unit))}</span></div>${subHtml}</div>
      <div style="display:flex;gap:4px;">
        <button class="btn btn-sm btn-warning" onclick="editProductInSettings(${originalIndex})">✏️</button>
        <button class="btn btn-sm btn-danger" onclick="deleteProductFromSettings(${originalIndex})">🗑️</button>
      </div>
    </div>`;
  }).join('');
}
async function menuAddUnit(){
  if(!canEditRecord(currentRole())) return;
  const v = await customPrompt('کد واحد (مثلاً kg, pcs, m):','');
  if(!v || !v.trim()) return;
  const code = v.trim();
  if(unitsList.some(u=>u.v===code)){ showToast('تکراری','warning'); return; }
  const l = await customPrompt('نام نمایشی:', code);
  if(!l) return;
  const fStr = await customPrompt('ضریب تبدیل به کیلوگرم (خالی = بدون ضریب):','');
  let factor = null;
  if(fStr && String(fStr).trim()){
    const n = parseFloat(toLatinDigits(String(fStr)));
    if(!isNaN(n)) factor = n;
  }
  deletedUnits = deletedUnits.filter(x=>x!==code);
  unitsList.push({ v:code, l:l.trim()||code, factor, updatedAt: Date.now() });
  markDirty(); renderManageLists(); fillUnits(); updateAutoKg();
}

function renderManageLists(){
  renderUnitsList();
  
  const qS = (document.getElementById('searchSellerList')?.value || '').trim().toLowerCase();
  const qB = (document.getElementById('searchBuyerList')?.value || '').trim().toLowerCase();
  const qD = (document.getElementById('searchDriverList')?.value || '').trim().toLowerCase();

  renderPartyList('manageSellers', sellers, 'seller', qS);
  renderPartyList('manageBuyers', buyers, 'buyer', qB);
  renderPartyList('manageDrivers', drivers, 'driver', qD);
}
function renderUnitsList(){
  const uc = document.getElementById('manageUnits'); if(!uc) return;
  if(!unitsList.length){ uc.innerHTML = '<div style="text-align:center;color:var(--muted);padding:8px;">خالی</div>'; return; }
  uc.innerHTML = unitsList.map((u,i)=>{
    const f = (u.factor===null||u.factor===undefined)?'':u.factor;
    return `<div style="display:grid;grid-template-columns:60px 1fr 80px;gap:4px;margin-bottom:4px;align-items:center;">
      <input type="text" value="${esc(u.v)}" style="padding:6px;font-size:11px;text-align:center;font-family:monospace;" readonly>
      <input type="text" value="${esc(u.l)}" style="padding:6px;font-size:11px;" readonly>
      <input type="number" value="${f}" placeholder="—" style="padding:6px;font-size:11px;text-align:center;" readonly>
    </div>`;
  }).join('') + '<div style="font-size:10.5px;color:var(--muted);margin-top:6px;text-align:center;">برای ویرایش واحدها به پنل مدیریت بروید</div>';
}
function renderPartyList(id, list, kind, query){
  const el = document.getElementById(id); if(!el) return;
  if(!list.length){ el.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:12px;padding:8px;">خالی</div>'; return; }
  
  const filtered = list.map((name, i) => ({name, originalIndex: i})).filter(item => 
    !query || item.name.toLowerCase().includes(query)
  );
  
  if(!filtered.length){ el.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:12px;padding:8px;">یافت نشد</div>'; return; }

  el.innerHTML = filtered.map(({name, originalIndex})=>`
    <div style="display:grid;grid-template-columns:1fr auto;gap:4px;margin-bottom:4px;">
      <input type="text" value="${esc(name)}" style="padding:6px;font-size:11.5px;" readonly>
      <button class="btn btn-sm btn-danger" onclick="removePartyGlobal('${kind}',${originalIndex})">🗑️</button>
    </div>
  `).join('');
}
async function removePartyGlobal(kind, index){
  if(!canEditRecord(currentRole())) return;
  const list = kind==='seller' ? sellers : kind==='buyer' ? buyers : drivers;
  const name = list[index]; if(!name) return;
  const ok = await customConfirm(`«${name}» حذف شود؟`, {okText:'حذف', danger:true});
  if(!ok) return;
  list.splice(index,1);
  if(kind==='seller') deletedSellers.push(name);
  if(kind==='buyer') deletedBuyers.push(name);
  if(kind==='driver') deletedDrivers.push(name);
  markDirty(); renderManageLists(); refreshPartyOptions(); refreshDriverOptions();
}
async function menuAddSellerFromSettings(){
  if(!canEditRecord(currentRole())) return;
  const n = await customPrompt('نام فروشنده:','');
  if(!n || !n.trim()) return;
  const v = n.trim();
  if(!sellers.includes(v)){ sellers.push(v); markDirty(); renderManageLists(); refreshPartyOptions(); }
}
async function menuAddBuyerFromSettings(){
  if(!canEditRecord(currentRole())) return;
  const n = await customPrompt('نام خریدار:','');
  if(!n || !n.trim()) return;
  const v = n.trim();
  if(!buyers.includes(v)){ buyers.push(v); markDirty(); renderManageLists(); refreshPartyOptions(); }
}
async function menuAddDriverFromSettings(){
  if(!canEditRecord(currentRole())) return;
  const n = await customPrompt('نام راننده:','');
  if(!n || !n.trim()) return;
  const v = n.trim();
  if(!drivers.includes(v)){ drivers.push(v); markDirty(); renderManageLists(); refreshDriverOptions(); }
}

function backupDownload(){
  const payload = serializeState({
    records, products, sellers, buyers, drivers, unitsList, users, auditLog,
    permanentlyDeletedIds, deletedProducts, deletedSellers, deletedBuyers, deletedDrivers, deletedUnits,
    dataEpoch, currentUser,
    letterheadCompany, letterheadCompanyAt,
    letterheadFactory, letterheadFactoryAt,
    visibleFields, visibleFieldsAt
  });
  payload.exportedAt = new Date().toISOString();
  const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=`warehouse-backup-${Date.now()}.json`;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  document.getElementById('backupInfo').textContent = '✅ دانلود شد';
}

async function restoreFromFile(ev){
  const file = ev.target.files?.[0]; 
  ev.target.value='';
  if(!file) return;

  try {
    const text = await file.text();
    let data;
    
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      await customAlert('❌ فایل انتخاب شده یک فایل متنی JSON معتبر نیست.\n\nمطمئن شو فایلی که دانلود کردی پسوند .json داره.');
      return;
    }

    if(!data || (!data.records && !data.products && !data.units && !data.unitsList)) {
      await customAlert('⚠️ این فایل ساختار یک فایل پشتیبان انبار را ندارد.\n\n(احتمالاً فایل اشتباهی رو انتخاب کردی)');
      return;
    }

    const ok = await customConfirm('⚠️ آیا از ادغام این فایل با داده‌های فعلی مطمئن هستی؟', {okText:'بله، ادغام کن'});
    if(!ok) return;

    const parsed = deserializeState(data);
    
    records = mergeRecordsById(records, parsed.records, permanentlyDeletedIds);
    products = mergeProductsList(products, parsed.products);
    sellers = mergeUnique(sellers, parsed.sellers || []);
    buyers = mergeUnique(buyers, parsed.buyers || []);
    drivers = mergeUnique(drivers, parsed.drivers || []);
    
    const unitMap = new Map();
    [...unitsList, ...(parsed.unitsList || [])].forEach(u => {
      if(u && u.v && !unitMap.has(u.v)) unitMap.set(u.v, u);
    });
    unitsList = Array.from(unitMap.values());

    markDirty();
    renderRecords(); 
    renderManageLists(); 
    renderManageProducts();
    refreshPartyOptions(); 
    refreshDriverOptions();
    
    showToast('✅ فایل با موفقیت ادغام شد', 'success');
    
  } catch(err) {
    console.error('Restore Error:', err);
    await customAlert('❌ خطا در بازیابی فایل:\n\n' + (err.message || 'نامشخص'));
  }
}

(function initSplash(){
  const splash = document.getElementById('splashScreen');
  if(!splash) return;
  const img = document.getElementById('splashLogoImg');
  if(img){
    img.addEventListener('load', ()=>{ if(img.naturalWidth>0) img.classList.add('loaded'); });
    img.addEventListener('error', ()=>{ try{ img.src='./icon-192.png'; }catch(e){} });
    if(img.complete && img.naturalWidth>0) img.classList.add('loaded');
  }
})();

if('serviceWorker' in navigator){
  window.addEventListener('load', async ()=>{
    try {
      const head = await fetch('./sw.js',{method:'HEAD'}).catch(()=>null);
      if(!head || !head.ok) return;
      await navigator.serviceWorker.register('./sw.js');
    } catch(e){ console.warn('SW registration failed', e); }
  });
}