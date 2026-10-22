/* ui.js — reusable components: modal, toast, searchable select, calendar, time picker */
'use strict';

/* ─── Modal ─── */
let _modalState = { resolve:null, type:null };
function openModal(type, msg, opts={}){
  return new Promise(resolve=>{
    _modalState.resolve = resolve; _modalState.type = type;
    const overlay = document.getElementById('modalOverlay');
    const msgEl = document.getElementById('modalMsg');
    const input = document.getElementById('modalInput');
    const ok = document.getElementById('modalOk');
    const cancel = document.getElementById('modalCancel');
    const third = document.getElementById('modalThird');
    msgEl.textContent = msg;
    if(type==='prompt'){
      input.hidden = false; input.value = opts.inputDefault||'';
      input.placeholder = opts.placeholder||'';
      input.type = opts.inputType||'text';
    } else { input.hidden = true; }
    ok.textContent = opts.okText||'تأیید';
    ok.classList.toggle('danger', !!opts.okDanger || !!opts.danger);
    if(opts.thirdText){
      third.hidden = false; third.textContent = opts.thirdText;
      third.classList.toggle('danger', !!opts.thirdDanger);
    } else third.hidden = true;
    if(type==='alert'){ cancel.hidden = true; ok.style.flex = '0 1 60%'; }
    else { cancel.hidden = false; cancel.textContent = opts.cancelText||'لغو'; ok.style.flex = '1'; }
    overlay.classList.add('show');
    setTimeout(()=>{ (type==='prompt'?input:ok).focus(); }, 60);
  });
}
function closeModal(result){
  document.getElementById('modalOverlay').classList.remove('show');
  const r = _modalState.resolve;
  _modalState.resolve = null; _modalState.type = null;
  if(r) r(result);
}
function customAlert(msg, opts={}){ return openModal('alert', msg, {okText:opts.okText||'باشه', ...opts}); }
function customConfirm(msg, opts={}){ return openModal('confirm', msg, {okText:opts.okText||'تأیید', cancelText:opts.cancelText||'لغو', danger:!!opts.danger, ...opts}); }
function customPrompt(msg, def='', opts={}){ return openModal('prompt', msg, {okText:opts.okText||'تأیید', cancelText:opts.cancelText||'لغو', inputDefault:def, placeholder:opts.placeholder||'', inputType:opts.inputType||'text'}); }
function customTriple(msg, opts={}){ return openModal('triple', msg, {okText:opts.okText||'تأیید', cancelText:opts.cancelText||'لغو', thirdText:opts.thirdText||'', thirdDanger:!!opts.thirdDanger, okDanger:!!opts.okDanger}); }

function initModalBindings(){
  document.getElementById('modalOk').addEventListener('click', ()=>{
    if(_modalState.type==='prompt'){
      const v = document.getElementById('modalInput').value.trim();
      closeModal(v||null);
    } else closeModal(true);
  });
  document.getElementById('modalThird').addEventListener('click', ()=>closeModal('third'));
  document.getElementById('modalCancel').addEventListener('click', ()=>{
    closeModal(_modalState.type==='prompt'?null:false);
  });
  document.getElementById('modalInput').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('modalOk').click(); }
  });
  document.getElementById('modalOverlay').addEventListener('click', e=>{
    if(e.target===document.getElementById('modalOverlay')){
      closeModal(_modalState.type==='prompt'?null:false);
    }
  });
}

/* ─── Toast ─── */
const TOAST_MAX = 3;
const TOAST_DURATION = {success:3500,error:4500,warning:4000,info:2800};
function showToast(msg, type='success', duration){
  const container = document.getElementById('toastContainer');
  if(!container) return;
  const icons = {success:'✅', error:'❌', warning:'⚠️', info:'ℹ️'};
  const dur = duration || TOAST_DURATION[type] || 3000;
  while(container.children.length >= TOAST_MAX){
    try{ container.firstChild.remove(); }catch(e){ break; }
  }
  const toast = document.createElement('div');
  toast.className = 'toast '+type;
  toast.innerHTML = `<span class="toast-icon">${icons[type]||''}</span><span class="toast-text">${esc(msg)}</span>`;
  container.appendChild(toast);
  let removed = false;
  const remove = ()=>{ if(removed) return; removed = true; toast.classList.add('hiding'); setTimeout(()=>toast.remove(), 300); };
  toast.addEventListener('click', remove);
  setTimeout(remove, dur);
}

/* ─── SearchableSelect ─── */
class SearchableSelect{
  constructor(el, opts={}){
    this.el = el;
    this.input = el.querySelector('.ss-input');
    this.hidden = el.querySelector('.ss-value');
    this.dropdown = el.querySelector('.ss-dropdown');
    this.list = el.querySelector('.ss-list');
    this.options = [];
    this.filtered = [];
    this.selectedIndex = -1;
    this.allowAdd = opts.allowAdd !== false;
    this.onAdd = opts.onAdd || null;
    this.onChange = opts.onChange || null;
    this._bind();
  }
  setOptions(opts){
    this.options = (opts||[]).map(o => typeof o === 'string' ? {value:o, label:o} : o);
    this._filter();
  }
  getValue(){ return this.hidden.value; }
  setValue(v){
    this.hidden.value = v||'';
    const found = this.options.find(o => o.value === v);
    this.input.value = found ? found.label : (v||'');
  }
  clear(){ this.hidden.value=''; this.input.value=''; }
  _bind(){
    this.input.addEventListener('focus', () => this._open());
    this.input.addEventListener('input', () => { this._filter(); this._open(); });
    document.addEventListener('click', e => { if(!this.el.contains(e.target)) this._close(); });
    this.input.addEventListener('keydown', e => this._onKey(e));
  }
  _filter(){
    const q = (this.input.value||'').trim().toLowerCase();
    this.filtered = this.options.filter(o =>
      !q || o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
    );
    this._render();
  }
  _open(){
    this._filter();
    this.dropdown.hidden = false;
    this.selectedIndex = this.filtered.findIndex(o => o.value === this.hidden.value);
  }
  _close(){ this.dropdown.hidden = true; this.selectedIndex = -1; }
  _render(){
    const q = (this.input.value||'').trim();
    const canCreate = this.allowAdd && q && !this.options.some(o => o.value === q);
    let html = '';
    if(this.filtered.length){
      html = this.filtered.map((o,i) =>
        `<div class="ss-item${i===this.selectedIndex?' active':''}" data-value="${esc(o.value)}" data-idx="${i}">${esc(o.label)}</div>`
      ).join('');
    } else if(!canCreate){
      html = '<div class="ss-empty">موردی یافت نشد</div>';
    }
    if(canCreate){
      html += `<div class="ss-item create" data-create="1">+ افزودن «${esc(q)}»</div>`;
    }
    this.list.innerHTML = html;
    this.list.querySelectorAll('.ss-item').forEach(item => {
      item.addEventListener('click', () => {
        if(item.dataset.create){
          const v = this.input.value.trim();
          if(!v) return;
          if(this.onAdd) this.onAdd(v);
          this.setValue(v);
          this._close();
          if(this.onChange) this.onChange(v);
        } else {
          const val = item.dataset.value;
          this.setValue(val);
          this._close();
          if(this.onChange) this.onChange(val);
        }
      });
    });
  }
  _onKey(e){
    if(this.dropdown.hidden){
      if(e.key==='ArrowDown'){ this._open(); e.preventDefault(); }
      return;
    }
    const canCreate = this.allowAdd && this.input.value.trim() && !this.options.some(o=>o.value===this.input.value.trim());
    const total = this.filtered.length + (canCreate?1:0);
    if(e.key==='ArrowDown'){
      this.selectedIndex = Math.min(this.selectedIndex+1, total-1);
      this._render(); e.preventDefault();
    } else if(e.key==='ArrowUp'){
      this.selectedIndex = Math.max(this.selectedIndex-1, 0);
      this._render(); e.preventDefault();
    } else if(e.key==='Enter'){
      if(this.selectedIndex>=0 && this.filtered[this.selectedIndex]){
        const v = this.filtered[this.selectedIndex].value;
        this.setValue(v); this._close();
        if(this.onChange) this.onChange(v);
        e.preventDefault();
      } else if(canCreate && this.selectedIndex===this.filtered.length){
        const v = this.input.value.trim();
        if(this.onAdd) this.onAdd(v);
        this.setValue(v); this._close();
        if(this.onChange) this.onChange(v);
        e.preventDefault();
      }
    } else if(e.key==='Escape'){
      this._close();
    }
  }
}

/* ─── Calendar ─── */
let _calTarget = null, _calYear, _calMonth;
function openCalendarFor(input){
  _calTarget = input;
  const raw = toLatinDigits(input.value||'').trim();
  if(raw){
    const p = raw.split(/[\/\-\.]/).map(Number);
    if(p.length===3 && p[0] && p[1]){ _calYear=p[0]; _calMonth=p[1]; }
  }
  if(!_calYear||!_calMonth){
    const d = new Date();
    const j = d2j(g2d(d.getFullYear(), d.getMonth()+1, d.getDate()));
    _calYear=j.jy; _calMonth=j.jm;
  }
  renderCalendar();
  const popup = document.getElementById('calPopup');
  popup.style.display = 'block';
  popup.style.top = '0px'; popup.style.left = '0px';
  const rect = input.getBoundingClientRect();
  const h = popup.offsetHeight, w = popup.offsetWidth;
  let top = rect.bottom+6, left = rect.left;
  if(top+h > window.innerHeight-8) top = rect.top-h-6;
  if(left+w > window.innerWidth-8) left = window.innerWidth-w-8;
  if(left<8) left=8; if(top<8) top=8;
  popup.style.top = top+'px'; popup.style.left = left+'px';
}
function closeCalendar(){
  document.getElementById('calPopup').style.display = 'none';
  _calTarget = null;
}
function calNav(dir){
  _calMonth += dir;
  if(_calMonth>12){ _calMonth=1; _calYear++; }
  if(_calMonth<1){ _calMonth=12; _calYear--; }
  renderCalendar();
}
function calToday(){
  const d = new Date();
  const j = d2j(g2d(d.getFullYear(), d.getMonth()+1, d.getDate()));
  _calYear=j.jy; _calMonth=j.jm; selectCalendarDay(j.jd);
}
function selectCalendarDay(d){
  if(!_calTarget) return;
  const str = `${_calYear}/${String(_calMonth).padStart(2,'0')}/${String(d).padStart(2,'0')}`;
  const id = _calTarget.id;
  _calTarget.value = toFa(str);
  closeCalendar();
  if(id==='records_from'||id==='records_to'){
    ensureValidRange(id);
    if(typeof renderRecords === 'function') renderRecords();
  }
}
function ensureValidRange(changedId){
  const f = normalizeDate(document.getElementById('records_from').value);
  const t = normalizeDate(document.getElementById('records_to').value);
  if(f && t && f>t){
    if(changedId==='records_from') document.getElementById('records_to').value = document.getElementById('records_from').value;
    else document.getElementById('records_from').value = document.getElementById('records_to').value;
  }
}
function renderCalendar(){
  const popup = document.getElementById('calPopup');
  const firstJdn = j2d(_calYear, _calMonth, 1);
  const g = d2g(firstJdn);
  const firstDate = new Date(g.gy, g.gm-1, g.gd);
  const startDow = (firstDate.getDay()+1)%7;
  const daysInMonth = _calMonth<=6 ? 31 : (_calMonth<=11 ? 30 : (isLeapYear(_calYear)?30:29));
  const td = new Date();
  const tj = d2j(g2d(td.getFullYear(), td.getMonth()+1, td.getDate()));
  let selDay = null;
  if(_calTarget){
    const p = toLatinDigits(_calTarget.value||'').split(/[\/\-\.]/).map(Number);
    if(p.length===3 && p[0]===_calYear && p[1]===_calMonth) selDay=p[2];
  }
  let html = '<div class="cal-header">';
  html += '<button type="button" onclick="calNav(-1)">‹</button>';
  html += `<div class="cal-title">${MONTHS[_calMonth-1]} ${toFa(_calYear)}</div>`;
  html += '<button type="button" onclick="calNav(1)">›</button></div>';
  html += '<div class="cal-weekdays">'; WDAYS.forEach(w=>html+=`<div>${w}</div>`); html+='</div>';
  html += '<div class="cal-days">';
  for(let i=0;i<startDow;i++) html += '<div class="cal-day empty"></div>';
  for(let d=1;d<=daysInMonth;d++){
    let cls = 'cal-day';
    if(tj.jy===_calYear && tj.jm===_calMonth && tj.jd===d) cls+=' today';
    if(selDay===d) cls+=' selected';
    html += `<div class="${cls}" onclick="selectCalendarDay(${d})">${toFa(d)}</div>`;
  }
  html += '</div><div class="cal-footer">';
  html += '<button type="button" onclick="calToday()">امروز</button>';
  html += '<button type="button" onclick="closeCalendar()">بستن</button></div>';
  popup.innerHTML = html;
}

/* ─── Time Picker ─── */
let _timeTarget=null, _tempH=0, _tempM=0;
function openTimeFor(input){
  closeCalendar();
  _timeTarget = input;
  const raw = toLatinDigits(input.value||'').trim();
  if(raw && /^\d{1,2}:\d{1,2}$/.test(raw)){
    const [h,m] = raw.split(':').map(Number);
    _tempH=h; _tempM=m;
  } else {
    const d = new Date(); _tempH=d.getHours(); _tempM=d.getMinutes();
  }
  buildTimeCols(); updateTimeDisplay();
  const popup = document.getElementById('timePopup');
  popup.style.display = 'block';
  popup.style.top = '0px'; popup.style.left = '0px';
  const rect = input.getBoundingClientRect();
  const h = popup.offsetHeight, w = popup.offsetWidth;
  let top = rect.bottom+6, left = rect.left;
  if(top+h > window.innerHeight-8) top = rect.top-h-6;
  if(left+w > window.innerWidth-8) left = window.innerWidth-w-8;
  if(left<8) left=8; if(top<8) top=8;
  popup.style.top = top+'px'; popup.style.left = left+'px';
  setTimeout(()=>{ scrollToTimeSelected('hourCol',_tempH); scrollToTimeSelected('minCol',_tempM); }, 50);
}
function closeTimePicker(){
  document.getElementById('timePopup').style.display = 'none';
  _timeTarget = null;
}
function buildTimeCols(){
  const hc = document.getElementById('hourCol');
  const mc = document.getElementById('minCol');
  hc.innerHTML = ''; mc.innerHTML = '';
  for(let hh=0; hh<24; hh++){
    const el = document.createElement('div');
    el.className = 'time-col-item'+(hh===_tempH?' selected':'');
    el.textContent = toFa(String(hh).padStart(2,'0'));
    el.onclick = ()=>{ _tempH=hh; hc.querySelectorAll('.time-col-item').forEach((x,i)=>x.classList.toggle('selected',i===_tempH)); updateTimeDisplay(); };
    hc.appendChild(el);
  }
  for(let mm=0; mm<60; mm++){
    const el = document.createElement('div');
    el.className = 'time-col-item'+(mm===_tempM?' selected':'');
    el.textContent = toFa(String(mm).padStart(2,'0'));
    el.onclick = ()=>{ _tempM=mm; mc.querySelectorAll('.time-col-item').forEach((x,i)=>x.classList.toggle('selected',i===_tempM)); updateTimeDisplay(); };
    mc.appendChild(el);
  }
}
function scrollToTimeSelected(colId,val){
  const col = document.getElementById(colId);
  const items = col.querySelectorAll('.time-col-item');
  if(items[val]) col.scrollTop = items[val].offsetTop - col.clientHeight/2 + items[val].offsetHeight/2;
}
function updateTimeDisplay(){
  document.getElementById('timeDisplay').textContent = toFa(`${String(_tempH).padStart(2,'0')}:${String(_tempM).padStart(2,'0')}`);
}
function timeSetPreset(hh,mm){
  _tempH=hh; _tempM=mm; buildTimeCols(); updateTimeDisplay();
  setTimeout(()=>{ scrollToTimeSelected('hourCol',_tempH); scrollToTimeSelected('minCol',_tempM); }, 30);
}
function timeNowClick(){
  const d = new Date(); _tempH=d.getHours(); _tempM=d.getMinutes();
  buildTimeCols(); updateTimeDisplay();
  setTimeout(()=>{ scrollToTimeSelected('hourCol',_tempH); scrollToTimeSelected('minCol',_tempM); }, 30);
}
function timeConfirm(){
  if(_timeTarget) _timeTarget.value = toFa(`${String(_tempH).padStart(2,'0')}:${String(_tempM).padStart(2,'0')}`);
  closeTimePicker();
}

function initUIBindings(){
  initModalBindings();
  document.addEventListener('click', e=>{
    const cal = document.getElementById('calPopup');
    if(cal && cal.style.display==='block'){
      if(!e.target.closest('#calPopup') && !e.target.classList.contains('date-input')) closeCalendar();
    }
    const tp = document.getElementById('timePopup');
    if(tp && tp.style.display==='block'){
      if(!e.target.closest('#timePopup') && !e.target.classList.contains('time-input')) closeTimePicker();
    }
  });
  document.addEventListener('keydown', e=>{
    if(e.key!=='Escape') return;
    const overlay = document.getElementById('modalOverlay');
    if(overlay.classList.contains('show')){
      closeModal(_modalState.type==='prompt'?null:false);
      return;
    }
    const preview = document.getElementById('receiptPreviewOverlay');
    if(preview && preview.classList.contains('show')){
      if(typeof closeReceiptPreview==='function') closeReceiptPreview();
    }
  });
}