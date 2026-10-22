/* admin.js — admin panel logic */
'use strict';

let records = [], products = [], sellers = [], buyers = [], drivers = [], unitsList = [];
let users = [], auditLog = [];
let permanentlyDeletedIds = [];
let deletedProducts = [], deletedSellers = [], deletedBuyers = [], deletedDrivers = [], deletedUnits = [];
let dataEpoch = 1;
let currentUser = null;
let dirty = false;
let lastSyncAt = null;
let _editingCreatorRecordId = null;

window.addEventListener('DOMContentLoaded', () => {
  initUIBindings();
  loadGhConfig();
  applyDarkMode();
  const sess = loadSession();
  if (sess) {
    adminTryRestore(sess);
  }
});

async function adminTryRestore(sess) {
  try {
    if (!hasGhConfig()) { document.getElementById('loginError').hidden = false; document.getElementById('loginError').textContent = 'تنظیمات دیتابیس یافت نشد'; return; }
    const raw = await ghGet();
    if (!raw) { document.getElementById('loginError').hidden = false; document.getElementById('loginError').textContent = 'داده‌ای روی سرور نیست'; return; }
    const data = deserializeState(raw);
    const user = data.users.find(u => u.id === sess.userId);
    if (!user || user.role !== 'admin' || !user.active) { clearSession(); document.getElementById('loginError').hidden = false; document.getElementById('loginError').textContent = 'دسترسی مدیریت لازم است'; return; }
    enterAdmin(user, data);
  } catch (e) {
    document.getElementById('loginError').hidden = false;
    document.getElementById('loginError').textContent = 'خطا: ' + (e.message || '');
  }
}

async function adminLogin() {
  const errEl = document.getElementById('loginError');
  errEl.hidden = true;
  const u = document.getElementById('loginUsername').value.trim();
  const p = document.getElementById('loginPassword').value;
  if (!u || !p) { errEl.hidden = false; errEl.textContent = 'نام کاربری و رمز را وارد کنید'; return; }
  try {
    if (!hasGhConfig()) { errEl.hidden = false; errEl.textContent = 'تنظیمات دیتابیس یافت نشد'; return; }
    const raw = await ghGet();
    if (!raw) { errEl.hidden = false; errEl.textContent = 'داده‌ای روی سرور نیست'; return; }
    const data = deserializeState(raw);
    const result = await verifyLogin(u, p, data.users);
    if (!result.ok) { errEl.hidden = false; errEl.textContent = result.reason; return; }
    if (result.user.role !== 'admin') { errEl.hidden = false; errEl.textContent = 'فقط مدیران دسترسی دارند'; return; }
    
    saveSession(result.user.id, result.user.username, result.user.role);
    result.user.lastLogin = Date.now();
    enterAdmin(result.user, data);
  } catch (err) {
    errEl.hidden = false; errEl.textContent = 'خطا: ' + (err.message || '');
  }
}

function enterAdmin(user, data) {
  currentUser = user;
  records = data.records || [];
  products = data.products || [];
  sellers = data.sellers || [];
  buyers = data.buyers || [];
  drivers = data.drivers || [];
  unitsList = data.unitsList || [];
  users = data.users || [];
  auditLog = data.auditLog || [];
  permanentlyDeletedIds = data.permanentlyDeletedIds || [];
  deletedProducts = data.deletedProducts || [];
  deletedSellers = data.deletedSellers || [];
  deletedBuyers = data.deletedBuyers || [];
  deletedDrivers = data.deletedDrivers || [];
  deletedUnits = data.deletedUnits || [];
  dataEpoch = data.dataEpoch || 1;
  dirty = false; lastSyncAt = Date.now();

  document.getElementById('loginScreen').hidden = true;
  document.getElementById('adminApp').hidden = false;

  const pill = document.getElementById('adminUserPill');
  pill.innerHTML = `<span>👤 ${esc(user.displayName || user.username)}</span><span class="role-badge" style="background:var(--danger);color:#fff;padding:2px 8px;border-radius:10px;font-size:10px;">مدیر</span>`;

  document.getElementById('ghOwner').value = ghConfig.owner || '';
  document.getElementById('ghRepo').value = ghConfig.repo || '';
  document.getElementById('ghToken').value = ghConfig.token || '';

  renderDashboard();
  renderUsers();
  renderRecordsPanel();
  renderAudit();
  renderDBInfo();
  renderSystemInfo();
  updateAdminSyncStatus();
}

function showPanel(name) {
  document.querySelectorAll('.admin-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
}

/* ─── Dashboard ─── */
function renderDashboard() {
  const grid = document.getElementById('statGrid');
  const vis = records.filter(r => !r.deleted);
  const userCount = users.filter(u => u.active).length;
  const recIn = vis.filter(r => r.type === 'in').length;
  const recOut = vis.filter(r => r.type === 'out').length;
  grid.innerHTML = `
    <div class="stat-card"><div class="stat-label">👥 کاربران فعال</div><div class="stat-value">${toFa(userCount)}</div></div>
    <div class="stat-card"><div class="stat-label">📥 رکورد ورود</div><div class="stat-value">${toFa(recIn)}</div></div>
    <div class="stat-card"><div class="stat-label">📤 رکورد خروج</div><div class="stat-value">${toFa(recOut)}</div></div>
    <div class="stat-card"><div class="stat-label">🗑️ حذف‌شده</div><div class="stat-value">${toFa(records.length - vis.length)}</div></div>
    <div class="stat-card"><div class="stat-label">📜 کل رخدادها</div><div class="stat-value">${toFa(auditLog.length)}</div></div>
    <div class="stat-card"><div class="stat-label">🔄 نسل (Epoch)</div><div class="stat-value">${toFa(dataEpoch)}</div></div>
  `;
}

/* ─── Users ─── */
function renderUsers() {
  const body = document.getElementById('usersBody');
  body.innerHTML = users.map((u, i) => {
    const activeCls = u.active ? 'active' : 'inactive';
    const activeLabel = u.active ? 'فعال' : 'غیرفعال';
    return `<tr>
      <td>${toFa(i + 1)}</td>
      <td><b>${esc(u.username)}</b></td>
      <td>${esc(u.displayName || '-')}</td>
      <td><span class="role-chip ${u.role}">${roleLabel(u.role)}</span></td>
      <td><span class="status-chip ${activeCls}">${activeLabel}</span></td>
      <td>${u.lastLogin ? formatTime(u.lastLogin) : '—'}</td>
      <td>${u.createdAt ? formatTime(u.createdAt) : '—'}</td>
      <td>
        <button class="btn btn-sm btn-warning" onclick="editUser('${u.id}')" title="ویرایش">✏️</button>
        ${u.id !== currentUser.id ? `<button class="btn btn-sm btn-danger" onclick="deleteUser('${u.id}')" title="حذف">🗑️</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function showUserModal(user) {
  document.getElementById('userModalTitle').textContent = user ? 'ویرایش کاربر' : 'کاربر جدید';
  document.getElementById('userEditId').value = user ? user.id : '';
  document.getElementById('umUsername').value = user ? user.username : '';
  document.getElementById('umUsername').disabled = !!user;
  document.getElementById('umDisplay').value = user ? (user.displayName || '') : '';
  document.getElementById('umPassword').value = '';
  document.getElementById('umPassword').placeholder = user ? 'برای تغییر، پر کنید' : 'حداقل ۴ کاراکتر';
  document.getElementById('umRole').value = user ? user.role : 'operator';
  document.getElementById('umActive').checked = user ? user.active !== false : true;
  document.getElementById('userModalOverlay').classList.add('show');
}

function closeUserModal() {
  document.getElementById('userModalOverlay').classList.remove('show');
}

async function saveUser() {
  const editId = document.getElementById('userEditId').value;
  const username = document.getElementById('umUsername').value.trim();
  const displayName = document.getElementById('umDisplay').value.trim();
  const password = document.getElementById('umPassword').value;
  const role = document.getElementById('umRole').value;
  const active = document.getElementById('umActive').checked;

  if (!username) { showToast('نام کاربری الزامی', 'warning'); return; }
  if (!editId && (!password || password.length < 4)) { showToast('رمز حداقل ۴ کاراکتر', 'warning'); return; }

  if (editId) {
    const user = users.find(u => u.id === editId);
    if (!user) return;
    if (users.some(u => u.id !== editId && u.username === username)) { showToast('نام کاربری تکراری', 'warning'); return; }
    user.username = username;
    user.displayName = displayName || username;
    user.role = role;
    user.active = active;
    if (password) {
      if (password.length < 4) { showToast('رمز کوتاه', 'warning'); return; }
      user.salt = generateSalt();
      user.passwordHash = await hashPassword(password, user.salt);
    }
    auditLog.push({ t: Date.now(), action: 'user', userId: currentUser.id, userName: currentUser.displayName || currentUser.username, detail: `ویرایش کاربر ${username}`, recordId: null });
    showToast('کاربر ویرایش شد', 'success');
  } else {
    if (users.some(u => u.username === username)) { showToast('نام کاربری تکراری', 'warning'); return; }
    const userObj = await createUserObject({ username, password, displayName, role, currentUserId: currentUser.id });
    userObj.active = active;
    users.push(userObj);
    auditLog.push({ t: Date.now(), action: 'user', userId: currentUser.id, userName: currentUser.displayName || currentUser.username, detail: `ایجاد کاربر ${username} (${roleLabel(role)})`, recordId: null });
    showToast('کاربر ایجاد شد', 'success');
  }
  dirty = true;
  closeUserModal();
  renderUsers();
  renderDashboard();
  updateAdminSyncStatus();
}

async function editUser(id) {
  const user = users.find(u => u.id === id);
  if (!user) return;
  showUserModal(user);
}

async function deleteUser(id) {
  if (id === currentUser.id) { showToast('نمی‌توانید خودتان را حذف کنید', 'warning'); return; }
  const user = users.find(u => u.id === id);
  if (!user) return;
  const ok = await customConfirm(`کاربر «${user.username}» حذف شود؟`, { okText: 'حذف', danger: true });
  if (!ok) return;
  users = users.filter(u => u.id !== id);
  auditLog.push({ t: Date.now(), action: 'user', userId: currentUser.id, userName: currentUser.displayName || currentUser.username, detail: `حذف کاربر ${user.username}`, recordId: null });
  dirty = true;
  renderUsers();
  renderDashboard();
  updateAdminSyncStatus();
  showToast('حذف شد', 'success');
}

/* ─── Records panel (Bulk Edit & Individual Edit) ─── */
function renderRecordsPanel() {
  const vis = records.filter(r => !r.deleted);
  document.getElementById('recordsStats').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;font-size:12.5px;">
      <div>📥 ورود: <b>${toFa(vis.filter(r => r.type === 'in').length)}</b></div>
      <div>📤 خروج: <b>${toFa(vis.filter(r => r.type === 'out').length)}</b></div>
      <div>🗑️ حذف‌شده: <b>${toFa(records.length - vis.length)}</b></div>
    </div>`;
  
  // Populate Bulk Change Selects
  const uniqueCreators = [...new Set(records.map(r => r.createdByName).filter(Boolean))].sort();
  const oldSel = document.getElementById('bulkOldCreator');
  const newSel = document.getElementById('bulkNewCreator');
  
  const curOld = oldSel.value;
  const curNew = newSel.value;

  oldSel.innerHTML = '<option value="">همه رکوردها</option>' + uniqueCreators.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if (uniqueCreators.includes(curOld)) oldSel.value = curOld;

  newSel.innerHTML = '<option value="">انتخاب کنید...</option>' + users.map(u => {
      const name = u.displayName || u.username;
      return `<option value="${esc(name)}">${esc(name)}</option>`;
  }).join('');
  if (users.some(u => (u.displayName || u.username) === curNew)) newSel.value = curNew;

  const recent = [...records].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 15);
  const body = document.getElementById('recentRecordsBody');
  body.innerHTML = recent.map((r, i) => `
    <tr>
      <td>${toFa(i + 1)}</td>
      <td>${r.type === 'in' ? '📥' : '📤'}</td>
      <td>${esc(toFa(r.date) || '')}</td>
      <td>${esc(r.product || '-')}</td>
      <td>${fmtQty(r.quantity)}</td>
      <td>${esc(toFa(r.createdByName) || '-')}</td>
      <td>${esc(r.updatedByName || '-')} <br><span style="font-size:10.5px;color:var(--muted);">${formatTime(r.updatedAt)}</span></td>
      <td><button class="btn btn-sm btn-warning" onclick="openCreatorModal('${r.id}')" title="ویرایش ثبت‌کننده">✏️</button></td>
    </tr>
  `).join('');
}

function openCreatorModal(id) {
  const r = records.find(x => x.id === id);
  if (!r) return;
  _editingCreatorRecordId = id;
  
  const sel = document.getElementById('editCreatorSelect');
  const currentName = r.createdByName || '';
  
  sel.innerHTML = users.map(u => {
    const name = u.displayName || u.username;
    return `<option value="${esc(name)}" ${name === currentName ? 'selected' : ''}>${esc(name)}</option>`;
  }).join('');
  
  document.getElementById('creatorModalOverlay').classList.add('show');
}

function closeCreatorModal() {
  document.getElementById('creatorModalOverlay').classList.remove('show');
  _editingCreatorRecordId = null;
}

function saveCreatorChange() {
  if (!_editingCreatorRecordId) return;
  const newName = document.getElementById('editCreatorSelect').value;
  const r = records.find(x => x.id === _editingCreatorRecordId);
  
  if (r && newName) {
    r.createdByName = newName;
    r.updatedByName = currentUser.displayName || currentUser.username;
    r.updatedAt = Date.now();
    
    // Also update the createdBy ID if the user exists in the users list
    const targetUser = users.find(u => (u.displayName || u.username) === newName);
    if (targetUser) r.createdBy = targetUser.id;

    dirty = true;
    auditLog.push({ t: Date.now(), action: 'update', userId: currentUser.id, userName: currentUser.displayName || currentUser.username, detail: `تغییر ثبت‌کننده رکورد ${r.id} به ${newName}`, recordId: r.id });
    
    renderRecordsPanel();
    updateAdminSyncStatus();
    showToast('نام ثبت‌کننده تغییر کرد', 'success');
  }
  closeCreatorModal();
}

async function bulkChangeCreator() {
  const oldName = document.getElementById('bulkOldCreator').value;
  const newName = document.getElementById('bulkNewCreator').value;
  
  if (!newName) { showToast('نام جدید الزامی است', 'warning'); return; }
  
  const targetUser = users.find(u => (u.displayName || u.username) === newName);
  if (!targetUser) { showToast('کاربر انتخاب شده معتبر نیست', 'warning'); return; }

  const count = records.filter(r => !oldName || r.createdByName === oldName).length;
  if (count === 0) { showToast('رکوردی با این نام یافت نشد', 'info'); return; }
  
  const ok = await customConfirm(`نام ثبت‌کننده ${toFa(count)} رکورد تغییر کند؟`, { okText: 'بله، تغییر بده' });
  if (!ok) return;

  records.forEach(r => {
    if (!oldName || r.createdByName === oldName) {
      r.createdByName = newName;
      r.createdBy = targetUser.id;
      r.updatedByName = currentUser.displayName || currentUser.username;
      r.updatedAt = Date.now();
    }
  });
  
  dirty = true;
  auditLog.push({ t: Date.now(), action: 'update', userId: currentUser.id, userName: currentUser.displayName || currentUser.username, detail: `تغییر گروهی ثبت‌کننده به ${newName}`, recordId: null });
  renderRecordsPanel();
  updateAdminSyncStatus();
  showToast(`ثبت‌کننده ${toFa(count)} رکورد تغییر کرد`, 'success');
}

/* ─── Audit ─── */
function renderAudit() {
  const filter = document.getElementById('auditFilter').value;
  const list = document.getElementById('auditList');
  let items = [...auditLog].sort((a, b) => b.t - a.t);
  if (filter) items = items.filter(a => a.action === filter);
  if (!items.length) { list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);">موردی نیست</div>'; return; }
  list.innerHTML = items.map(a => `
    <div class="audit-row">
      <div class="audit-time">${formatTime(a.t)}</div>
      <div class="audit-action ${a.action}">${auditActionLabel(a.action)}</div>
      <div class="audit-detail"><span class="audit-user">${esc(a.userName || '-')}</span> — ${esc(a.detail || '')}</div>
    </div>
  `).join('');
}

function auditActionLabel(a) {
  return { create: 'ثبت', update: 'ویرایش', delete: 'حذف', login: 'ورود', user: 'کاربر' }[a] || a;
}

/* ─── DB info ─── */
function renderDBInfo() {
  const size = ghFileSize || 0;
  document.getElementById('dbInfo').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;font-size:12.5px;">
      <div>📦 حجم فایل: <b>${formatBytes(size)}</b></div>
      <div>📋 رکوردها: <b>${toFa(records.length)}</b></div>
      <div>👥 کاربران: <b>${toFa(users.length)}</b></div>
      <div>📜 رخدادها: <b>${toFa(auditLog.length)}</b></div>
      <div>🔄 نسل: <b>${toFa(dataEpoch)}</b></div>
    </div>`;
}

/* ─── System info ─── */
function renderSystemInfo() {
  document.getElementById('systemInfo').innerHTML = `
    <div style="font-size:12.5px;line-height:2;">
      <div>🔧 <b>نام اپلیکیشن:</b> WMS — انبار کارخانه قند صنوبر</div>
      <div>📅 <b>نسخه:</b> ۴.۰.۰ (چندکاربره)</div>
      <div>💾 <b>فرمت داده:</b> v7 (با پشتیبانی از کاربران و Audit Log)</div>
      <div>🔐 <b>رمزنگاری رمز:</b> PBKDF2 + SHA-256 (۱۰۰٫۰۰۰ دور)</div>
      <div>📊 <b>حداکثر Audit Log:</b> ۸۰۰ رخداد آخر</div>
    </div>`;
}

/* ─── GitHub config ─── */
async function saveGh() {
  ghConfig.owner = document.getElementById('ghOwner').value.trim();
  ghConfig.repo = document.getElementById('ghRepo').value.trim();
  ghConfig.token = document.getElementById('ghToken').value.trim();
  if (!ghConfig.owner || !ghConfig.repo || !ghConfig.token) {
    document.getElementById('ghTestInfo').textContent = '❌ همه فیلدها الزامی است'; return;
  }
  saveGhConfig();
  ghFileSha = null; ghCanWrite = null;
  try {
    const raw = await ghGet();
    document.getElementById('ghTestInfo').textContent = raw ? '✅ اتصال برقرار شد — داده موجود است' : '⚠️ اتصال برقرار شد اما فایل داده نیست';
    const perm = await checkTokenPermissions();
    if (perm) ghCanWrite = perm.canWrite;
    renderDBInfo();
  } catch (e) {
    document.getElementById('ghTestInfo').textContent = '❌ خطا: ' + (e.message || '');
  }
}

/* ─── Backup/Restore ─── */
function adminBackup() {
  const payload = serializeState({
    records, products, sellers, buyers, drivers, unitsList, users, auditLog,
    permanentlyDeletedIds, deletedProducts, deletedSellers, deletedBuyers, deletedDrivers, deletedUnits,
    dataEpoch, currentUser
  });
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `admin-backup-${Date.now()}.json`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
}

async function adminRestore(ev) {
  const file = ev.target.files?.[0]; ev.target.value = '';
  if (!file) return;
  
  try {
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      return showToast('❌ فایل JSON معتبر نیست', 'error');
    }
    
    if (!data || (!data.records && !data.products && !data.users)) {
      return showToast('⚠️ ساختار فایل پشتیبان نامعتبر است', 'warning');
    }

    const ok = await customConfirm('⚠️ داده‌های فعلی با فایل ادغام شوند؟', { okText: 'ادغام' });
    if (!ok) return;

    const parsed = deserializeState(data);
    records = mergeRecordsById(records, parsed.records, permanentlyDeletedIds);
    products = mergeProductsList(products, parsed.products);
    users = parsed.users && parsed.users.length ? parsed.users : users;
    auditLog = [...auditLog, ...parsed.auditLog].slice(-800);
    
    const unitMap = new Map();
    [...unitsList, ...(parsed.unitsList || [])].forEach(u => {
      if (u && u.v && !unitMap.has(u.v)) unitMap.set(u.v, u);
    });
    unitsList = Array.from(unitMap.values());
    sellers = mergeUnique(sellers, parsed.sellers || []);
    buyers = mergeUnique(buyers, parsed.buyers || []);
    drivers = mergeUnique(drivers, parsed.drivers || []);

    dirty = true;
    renderDashboard(); renderUsers(); renderRecordsPanel(); renderAudit(); renderDBInfo();
    updateAdminSyncStatus();
    showToast('ادغام شد', 'success');
  } catch (e) {
    showToast('خطا در بازیابی: ' + e.message, 'error');
  }
}

/* ─── Danger zone ─── */
async function resetEpoch() {
  const ok = await customConfirm('⚠️ نسل (Epoch) یک عدد افزایش می‌یابد.\n\nهمه دستگاه‌ها باید دوباره دریافت کنند.', { okText: 'ادامه', danger: true });
  if (!ok) return;
  dataEpoch++;
  dirty = true;
  renderDashboard(); renderDBInfo();
  showToast(`نسل جدید: ${toFa(dataEpoch)}`, 'info');
}

async function clearAllRecords() {
  const ok = await customConfirm('⚠️ همه رکوردها برای همیشه حذف شوند؟\n\n⚠️ این عمل بازگشت‌پذیر نیست!', { okText: 'حذف همه', danger: true });
  if (!ok) return;
  const ok2 = await customConfirm('⚠️ آخرین تأیید — مطمئنید؟', { okText: 'بله، حذف کن', danger: true });
  if (!ok2) return;
  records.forEach(r => permanentlyDeletedIds.push(r.id));
  records = [];
  dirty = true;
  renderDashboard(); renderRecordsPanel(); renderDBInfo();
  showToast('همه رکوردها حذف شدند', 'warning');
}

/* ─── Sync ─── */
async function adminPull() {
  if (!hasGhConfig()) { showToast('تنظیمات پیکربندی نشده', 'warning'); return; }
  if (dirty) {
    const c = await customConfirm('⚠️ تغییرات ذخیره‌نشده دارید. ادامه؟', { danger: true });
    if (!c) return;
    dirty = false;
  }
  try {
    const raw = await ghGet();
    if (!raw) { showToast('فایل یافت نشد', 'warning'); return; }
    const data = deserializeState(raw);
    records = data.records; products = data.products;
    sellers = data.sellers; buyers = data.buyers; drivers = data.drivers;
    unitsList = data.unitsList;
    users = data.users; auditLog = data.auditLog;
    permanentlyDeletedIds = data.permanentlyDeletedIds;
    deletedProducts = data.deletedProducts; deletedSellers = data.deletedSellers;
    deletedBuyers = data.deletedBuyers; deletedDrivers = data.deletedDrivers;
    deletedUnits = data.deletedUnits; dataEpoch = data.dataEpoch;
    dirty = false; lastSyncAt = Date.now();
    renderDashboard(); renderUsers(); renderRecordsPanel(); renderAudit(); renderDBInfo();
    updateAdminSyncStatus();
    showToast('دریافت شد', 'success');
  } catch (e) {
    showToast('خطا: ' + (e.message || ''), 'error');
  }
}

async function adminPush() {
  if (!hasGhConfig()) { showToast('تنظیمات پیکربندی نشده', 'warning'); return; }
  try {
    const rawRemote = await ghGet();
    const remote = rawRemote ? deserializeState(rawRemote) : null;
    if (remote) {
      records = mergeRecordsById(records, remote.records, permanentlyDeletedIds);
    }
    const payload = serializeState({
      records, products, sellers, buyers, drivers, unitsList, users, auditLog,
      permanentlyDeletedIds, deletedProducts, deletedSellers, deletedBuyers, deletedDrivers, deletedUnits,
      dataEpoch, currentUser
    });
    await ghPut(payload);
    dirty = false; lastSyncAt = Date.now();
    updateAdminSyncStatus();
    renderDBInfo();
    showToast('ذخیره شد', 'success');
  } catch (e) {
    showToast('خطا: ' + (e.message || ''), 'error');
  }
}

function updateAdminSyncStatus() {
  const el = document.getElementById('syncStatus');
  const pushBtn = document.getElementById('adminPushBtn');
  if (dirty) {
    el.className = 'sync-bar-status dirty';
    el.textContent = '🟠 تغییرات ذخیره‌نشده';
  } else {
    el.className = 'sync-bar-status synced';
    el.textContent = '🟢 همه چیز ذخیره شده';
  }
  if (hasGhConfig()) pushBtn.disabled = false; else pushBtn.disabled = true;
}