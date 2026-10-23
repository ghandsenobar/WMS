/* admin.js — admin panel logic v4.2.0 */
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
let letterheadCompany = '', letterheadCompanyAt = 0;
let letterheadFactory = '', letterheadFactoryAt = 0;
let visibleFields = {}, visibleFieldsAt = 0;

window.addEventListener('DOMContentLoaded', () => {
  initUIBindings();
  loadGhConfig();
  applyDarkMode();
  const sess = loadSession();
  if (sess) {
    adminTryRestore(sess);
  }
  setTimeout(checkRemoteVersion, 2000);
  setInterval(checkRemoteVersion, 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkRemoteVersion();
  });
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
  letterheadCompany = data.letterheadCompany || '';
  letterheadCompanyAt = data.letterheadCompanyAt || 0;
  letterheadFactory = data.letterheadFactory || '';
  letterheadFactoryAt = data.letterheadFactoryAt || 0;
  visibleFields = data.visibleFields || {};
  visibleFieldsAt = data.visibleFieldsAt || 0;
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
  renderMasterData();
  renderAudit();
  renderDBInfo();
  renderSystemInfo();
  updateAdminSyncStatus();
}

function showPanel(name) {
  document.querySelectorAll('.admin-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.panel === name));
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
}

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

function renderRecordsPanel() {
  const vis = records.filter(r => !r.deleted);
  document.getElementById('recordsStats').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;font-size:12.5px;">
      <div>📥 ورود: <b>${toFa(vis.filter(r => r.type === 'in').length)}</b></div>
      <div>📤 خروج: <b>${toFa(vis.filter(r => r.type === 'out').length)}</b></div>
      <div>🗑️ حذف‌شده: <b>${toFa(records.length - vis.length)}</b></div>
    </div>`;
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

function renderSystemInfo() {
  document.getElementById('systemInfo').innerHTML = `
    <div style="font-size:12.5px;line-height:2;">
      <div>🔧 <b>نام اپلیکیشن:</b> WMS — انبار کارخانه قند صنوبر</div>
      <div>📅 <b>نسخه:</b> ۴.۲.۰ (چندکاربره)</div>
      <div>💾 <b>فرمت داده:</b> v7 (با پشتیبانی از کاربران و Audit Log)</div>
      <div>🔐 <b>رمزنگاری رمز:</b> PBKDF2 + SHA-256 (۱۰۰٫۰۰۰ دور)</div>
      <div>📊 <b>حداکثر Audit Log:</b> ۸۰۰ رخداد آخر</div>
      <div>🔄 <b>به‌روزرسانی خودکار:</b> فعال (هر ۳۰ دقیقه + بازگشت به تب)</div>
    </div>`;
}

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

function adminBackup() {
  const payload = serializeState({
    records, products, sellers, buyers, drivers, unitsList, users, auditLog,
    permanentlyDeletedIds, deletedProducts, deletedSellers, deletedBuyers, deletedDrivers, deletedUnits,
    dataEpoch, currentUser,
    letterheadCompany, letterheadCompanyAt,
    letterheadFactory, letterheadFactoryAt,
    visibleFields, visibleFieldsAt
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
    renderDashboard(); renderUsers(); renderRecordsPanel(); renderMasterData(); renderAudit(); renderDBInfo();
    updateAdminSyncStatus();
    showToast('ادغام شد', 'success');
  } catch (e) {
    showToast('خطا در بازیابی: ' + e.message, 'error');
  }
}

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
    letterheadCompany = data.letterheadCompany || '';
    letterheadCompanyAt = data.letterheadCompanyAt || 0;
    letterheadFactory = data.letterheadFactory || '';
    letterheadFactoryAt = data.letterheadFactoryAt || 0;
    visibleFields = data.visibleFields || {};
    visibleFieldsAt = data.visibleFieldsAt || 0;
    dirty = false; lastSyncAt = Date.now();
    renderDashboard(); renderUsers(); renderRecordsPanel(); renderMasterData(); renderAudit(); renderDBInfo();
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
      letterheadCompany = remote.letterheadCompany || '';
      letterheadCompanyAt = remote.letterheadCompanyAt || 0;
      letterheadFactory = remote.letterheadFactory || '';
      letterheadFactoryAt = remote.letterheadFactoryAt || 0;
      visibleFields = remote.visibleFields || {};
      visibleFieldsAt = remote.visibleFieldsAt || 0;
    }
    const payload = serializeState({
      records, products, sellers, buyers, drivers, unitsList, users, auditLog,
      permanentlyDeletedIds, deletedProducts, deletedSellers, deletedBuyers, deletedDrivers, deletedUnits,
      dataEpoch, currentUser,
      letterheadCompany, letterheadCompanyAt,
      letterheadFactory, letterheadFactoryAt,
      visibleFields, visibleFieldsAt
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

/* ═══════════════════════════════════════════════
   Master Data Management (Units / Products / Parties)
   ═══════════════════════════════════════════════ */

function unitUsageCount(code) {
  const recCount = records.filter(r => r.unit === code).length;
  const prodCount = products.filter(p => p.unit === code).length;
  return { recCount, prodCount, total: recCount + prodCount };
}
function productUsageCount(name) {
  return records.filter(r => r.product === name).length;
}
function partyUsageCount(kind, name) {
  if (kind === 'seller') return records.filter(r => r.type === 'in' && r.party === name).length;
  if (kind === 'buyer')  return records.filter(r => r.type === 'out' && r.party === name).length;
  if (kind === 'driver') return records.filter(r => r.driver === name).length;
  return 0;
}

function renderMasterData() {
  renderMDUnits();
  renderMDProducts();
  renderMDPartyList('mdSellersBody', sellers, 'seller');
  renderMDPartyList('mdBuyersBody', buyers, 'buyer');
  renderMDPartyList('mdDriversBody', drivers, 'driver');
}

function renderMDUnits() {
  const body = document.getElementById('mdUnitsBody');
  if (!body) return;
  if (!unitsList.length) {
    body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px;">واحدی وجود ندارد</td></tr>';
    return;
  }
  body.innerHTML = unitsList.map((u, i) => {
    const usage = unitUsageCount(u.v);
    const usageStr = usage.total
      ? `${toFa(usage.recCount)} رکورد${usage.prodCount ? ` + ${toFa(usage.prodCount)} کالا` : ''}`
      : '—';
    return `<tr>
      <td><code style="font-size:11.5px;background:var(--subtle-bg);padding:2px 6px;border-radius:4px;">${esc(u.v)}</code></td>
      <td>${esc(u.l)}</td>
      <td>${(u.factor !== null && u.factor !== undefined) ? toFa(u.factor) : '<span style="color:var(--muted);">—</span>'}</td>
      <td style="font-size:11px;color:var(--muted);">${usageStr}</td>
      <td>
        <div style="display:flex;gap:4px;justify-content:flex-end;">
          <button class="btn btn-sm btn-warning" onclick="adminEditUnit(${i})" title="ویرایش">✏️</button>
          <button class="btn btn-sm btn-danger" onclick="adminDeleteUnit(${i})" title="حذف">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function renderMDProducts() {
  const body = document.getElementById('mdProductsBody');
  if (!body) return;
  if (!products.length) {
    body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px;">کالایی وجود ندارد</td></tr>';
    return;
  }
  body.innerHTML = products.map((p, i) => {
    const usage = productUsageCount(p.name);
    const subs = (p.subtypes || []).filter(s => s && s.trim());
    const subsStr = subs.length
      ? subs.map(s => `<span style="font-size:10.5px;background:var(--subtle-bg);padding:1px 6px;border-radius:8px;margin-left:2px;display:inline-block;margin-bottom:2px;">${esc(s)}</span>`).join('')
      : '<span style="color:var(--muted);">—</span>';
    return `<tr>
      <td><b>${esc(p.name)}</b></td>
      <td>${esc(unitLabel(p.unit))}</td>
      <td style="font-size:11px;max-width:180px;white-space:normal;">${subsStr}</td>
      <td style="font-size:11px;color:var(--muted);">${usage ? toFa(usage) + ' رکورد' : '—'}</td>
      <td>
        <div style="display:flex;gap:4px;justify-content:flex-end;">
          <button class="btn btn-sm btn-warning" onclick="adminEditProduct(${i})" title="ویرایش">✏️</button>
          <button class="btn btn-sm btn-danger" onclick="adminDeleteProduct(${i})" title="حذف">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function renderMDPartyList(bodyId, list, kind) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:20px;">موردی وجود ندارد</td></tr>';
    return;
  }
  body.innerHTML = list.map((name, i) => {
    const usage = partyUsageCount(kind, name);
    return `<tr>
      <td style="color:var(--muted);">${toFa(i + 1)}</td>
      <td>${esc(name)}</td>
      <td style="font-size:11px;color:var(--muted);">${usage ? toFa(usage) + ' رکورد' : '—'}</td>
      <td>
        <div style="display:flex;gap:4px;justify-content:flex-end;">
          <button class="btn btn-sm btn-warning" onclick="adminEditParty('${kind}', ${i})" title="تغییر نام">✏️</button>
          <button class="btn btn-sm btn-danger" onclick="adminDeleteParty('${kind}', ${i})" title="حذف">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

let _replaceResolve = null;
function showReplacePicker(desc, options, warning) {
  return new Promise(resolve => {
    _replaceResolve = resolve;
    document.getElementById('replaceModalDesc').textContent = desc;
    const sel = document.getElementById('replaceModalSelect');
    sel.innerHTML = '<option value="">— انتخاب کنید —</option>' +
      options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
    const warnEl = document.getElementById('replaceModalWarning');
    if (warning) { warnEl.style.display = 'block'; warnEl.textContent = warning; }
    else warnEl.style.display = 'none';
    document.getElementById('replaceModalOverlay').classList.add('show');
  });
}
function closeReplaceModal() {
  document.getElementById('replaceModalOverlay').classList.remove('show');
  const r = _replaceResolve; _replaceResolve = null;
  if (r) r(null);
}
function confirmReplaceModal() {
  const val = document.getElementById('replaceModalSelect').value;
  if (!val) { showToast('یک گزینه انتخاب کنید', 'warning'); return; }
  const r = _replaceResolve; _replaceResolve = null;
  document.getElementById('replaceModalOverlay').classList.remove('show');
  if (r) r(val);
}

async function adminAddUnit() {
  const code = await customPrompt('کد واحد (مثلاً kg, pcs, ton):', '');
  if (!code) return;
  const v = code.trim();
  if (!v) return;
  if (unitsList.some(x => x.v === v)) { showToast('این کد قبلاً وجود دارد', 'warning'); return; }
  const label = await customPrompt('نام نمایشی واحد:', v);
  if (!label) return;
  const factorStr = await customPrompt('ضریب تبدیل به کیلوگرم (0 = بدون ضریب):', '1');
  if (factorStr === null) return;
  const n = parseFloat(toLatinDigits(factorStr));
  const factor = (isNaN(n) || n === 0) ? null : n;
  deletedUnits = deletedUnits.filter(x => x !== v);
  unitsList.push({ v, l: label.trim() || v, factor, updatedAt: Date.now() });
  dirty = true;
  auditLog.push({ t: Date.now(), action: 'update', userId: currentUser.id,
    userName: currentUser.displayName || currentUser.username,
    detail: `افزودن واحد ${v} (${label.trim()})`, recordId: null });
  renderMasterData();
  updateAdminSyncStatus();
  showToast('واحد اضافه شد', 'success');
}

async function adminEditUnit(index) {
  const u = unitsList[index]; if (!u) return;
  const label = await customPrompt(`نام نمایشی واحد «${u.v}»:`, u.l);
  if (!label || !label.trim()) return;
  const curFactor = (u.factor !== null && u.factor !== undefined) ? String(u.factor) : '0';
  const factorStr = await customPrompt(
    'ضریب تبدیل به کیلوگرم (0 = بدون ضریب):\n\n⚠️ رکوردهای گذشته دست‌نخورده می‌مانند، اما محاسبات رکوردهای جدید با ضریب جدید انجام می‌شود.',
    curFactor
  );
  if (factorStr === null) return;
  const n = parseFloat(toLatinDigits(factorStr));
  const factor = (isNaN(n) || n === 0) ? null : n;
  unitsList[index] = { ...u, l: label.trim() || u.v, factor, updatedAt: Date.now() };
  dirty = true;
  auditLog.push({ t: Date.now(), action: 'update', userId: currentUser.id,
    userName: currentUser.displayName || currentUser.username,
    detail: `ویرایش واحد ${u.v}`, recordId: null });
  renderMasterData();
  updateAdminSyncStatus();
  showToast('واحد ویرایش شد', 'success');
}

async function adminDeleteUnit(index) {
  const u = unitsList[index]; if (!u) return;
  if (unitsList.length <= 1) {
    showToast('حداقل یک واحد باید باقی بماند. ابتدا یک واحد دیگر بسازید.', 'warning');
    return;
  }
  const usage = unitUsageCount(u.v);
  if (usage.total === 0) {
    const ok = await customConfirm(`واحد «${u.l}» (${u.v}) حذف شود؟`, { okText: 'حذف', danger: true });
    if (!ok) return;
    unitsList.splice(index, 1);
    if (!deletedUnits.includes(u.v)) deletedUnits.push(u.v);
    dirty = true;
    auditLog.push({ t: Date.now(), action: 'update', userId: currentUser.id,
      userName: currentUser.displayName || currentUser.username,
      detail: `حذف واحد ${u.v} (بدون استفاده)`, recordId: null });
    renderMasterData();
    updateAdminSyncStatus();
    showToast('واحد حذف شد', 'success');
    return;
  }
  const otherUnits = unitsList.filter((_, i) => i !== index);
  if (!otherUnits.length) {
    showToast('واحد دیگری برای جایگزینی وجود ندارد', 'warning');
    return;
  }
  const replacement = await showReplacePicker(
    `واحد «${u.l}» در ${toFa(usage.recCount)} رکورد و ${toFa(usage.prodCount)} کالا استفاده شده است. برای حذف ایمن، یک واحد جایگزین انتخاب کنید:`,
    otherUnits.map(x => ({ value: x.v, label: `${x.l} (${x.v})` })),
    '⚠️ مقدار عددی رکوردها ثابت می‌ماند اما وزن ذخیره‌شده بر اساس ضریب واحد جدید بازمحاسبه می‌شود.'
  );
  if (!replacement) return;
  const newUnit = unitsList.find(x => x.v === replacement);
  if (!newUnit) { showToast('واحد جایگزین یافت نشد', 'error'); return; }
  const newFactor = (newUnit.factor !== null && newUnit.factor !== undefined) ? newUnit.factor : 1;
  let recCount = 0, prodCount = 0;
  records.forEach(r => {
    if (r.unit === u.v) {
      const qty = parseFloat(toLatinDigits(String(r.quantity || ''))) || 0;
      r.unit = replacement;
      r.totalWeight = String(qty * newFactor);
      r.updatedAt = Date.now();
      r.updatedBy = currentUser.id;
      r.updatedByName = currentUser.displayName || currentUser.username;
      recCount++;
    }
  });
  products.forEach(p => {
    if (p.unit === u.v) { p.unit = replacement; p.updatedAt = Date.now(); prodCount++; }
  });
  unitsList.splice(index, 1);
  if (!deletedUnits.includes(u.v)) deletedUnits.push(u.v);
  dirty = true;
  auditLog.push({ t: Date.now(), action: 'update', userId: currentUser.id,
    userName: currentUser.displayName || currentUser.username,
    detail: `حذف واحد ${u.v} با جایگزینی ${replacement} (${recCount} رکورد، ${prodCount} کالا)`, recordId: null });
  renderMasterData();
  renderRecordsPanel();
  renderDashboard();
  updateAdminSyncStatus();
  showToast(`${toFa(recCount)} رکورد و ${toFa(prodCount)} کالا به‌روزرسانی شد`, 'success');
}

async function adminAddProduct() {
  if (!unitsList.length) { showToast('ابتدا یک واحد بسازید', 'warning'); return; }
  const name = await customPrompt('نام کالای جدید:', '');
  if (!name || !name.trim()) return;
  const n = name.trim();
  if (products.some(p => p.name === n)) { showToast('این نام قبلاً وجود دارد', 'warning'); return; }
  const unitListStr = unitsList.map((u, i) => `${i + 1}. ${u.l} (${u.v})`).join('\n');
  const idxStr = await customPrompt('شماره واحد پیش‌فرض:\n' + unitListStr, '1');
  if (idxStr === null) return;
  const idx = parseInt(toLatinDigits(idxStr)) - 1;
  if (idx < 0 || idx >= unitsList.length) { showToast('شماره نامعتبر', 'warning'); return; }
  const subsStr = await customPrompt('زیرمجموعه‌ها (با کاما جدا کنید، خالی = بدون زیرمجموعه):', '');
  if (subsStr === null) return;
  const subtypes = subsStr ? subsStr.split(',').map(s => s.trim()).filter(Boolean) : [];
  deletedProducts = deletedProducts.filter(x => x !== n);
  products.push({ name: n, unit: unitsList[idx].v, subtypes, updatedAt: Date.now() });
  dirty = true;
  auditLog.push({ t: Date.now(), action: 'update', userId: currentUser.id,
    userName: currentUser.displayName || currentUser.username,
    detail: `افزودن کالای ${n}`, recordId: null });
  renderMasterData();
  updateAdminSyncStatus();
  showToast('کالا اضافه شد', 'success');
}

async function adminEditProduct(index) {
  const p = products[index]; if (!p) return;
  const oldName = p.name;
  const newName = await customPrompt('نام کالا:', p.name);
  if (!newName || !newName.trim()) return;
  const n = newName.trim();
  if (n !== oldName && products.some(x => x.name === n)) { showToast('نام تکراری', 'warning'); return; }
  const unitListStr = unitsList.map((u, i) => `${i + 1}. ${u.l} (${u.v})`).join('\n');
  const curIdx = unitsList.findIndex(u => u.v === p.unit) + 1;
  const idxStr = await customPrompt('شماره واحد پیش‌فرض:\n' + unitListStr, String(curIdx || 1));
  if (idxStr === null) return;
  const idx = parseInt(toLatinDigits(idxStr)) - 1;
  const newUnit = (idx >= 0 && idx < unitsList.length) ? unitsList[idx].v : p.unit;
  const subsStr = await customPrompt('زیرمجموعه‌ها (با کاما):', (p.subtypes || []).join(', '));
  if (subsStr === null) return;
  const newSubs = subsStr ? subsStr.split(',').map(s => s.trim()).filter(Boolean) : [];
  products[index] = { name: n, unit: newUnit, subtypes: newSubs, updatedAt: Date.now() };
  deletedProducts = deletedProducts.filter(x => x !== n);
  let renamed = 0;
  if (oldName !== n) {
    records.forEach(r => {
      if (r.product === oldName) {
        r.product = n;
        r.updatedAt = Date.now();
        r.updatedBy = currentUser.id;
        r.updatedByName = currentUser.displayName || currentUser.username;
        renamed++;
      }
    });
  }
  dirty = true;
  auditLog.push({ t: Date.now(), action: 'update', userId: currentUser.id,
    userName: currentUser.displayName || currentUser.username,
    detail: `ویرایش کالای ${oldName}${renamed ? ` → ${n} (${renamed} رکورد)` : ''}`, recordId: null });
  renderMasterData();
  renderRecordsPanel();
  updateAdminSyncStatus();
  showToast(renamed ? `کالا ویرایش شد (${toFa(renamed)} رکورد به‌روزرسانی شد)` : 'کالا ویرایش شد', 'success');
}

async function adminDeleteProduct(index) {
  const p = products[index]; if (!p) return;
  const usage = productUsageCount(p.name);
  if (usage === 0) {
    const ok = await customConfirm(`کالای «${p.name}» حذف شود؟`, { okText: 'حذف', danger: true });
    if (!ok) return;
    products.splice(index, 1);
    if (!deletedProducts.includes(p.name)) deletedProducts.push(p.name);
    dirty = true;
    auditLog.push({ t: Date.now(), action: 'update', userId: currentUser.id,
      userName: currentUser.displayName || currentUser.username,
      detail: `حذف کالای ${p.name} (بدون استفاده)`, recordId: null });
    renderMasterData();
    updateAdminSyncStatus();
    showToast('کالا حذف شد', 'success');
    return;
  }
  const others = products.filter((_, i) => i !== index);
  if (!others.length) {
    showToast('کالای دیگری برای جایگزینی وجود ندارد. ابتدا یک کالای جدید بسازید.', 'warning');
    return;
  }
  const replacement = await showReplacePicker(
    `کالای «${p.name}» در ${toFa(usage)} رکورد استفاده شده است. برای حذف ایمن، یک کالای جایگزین انتخاب کنید:`,
    others.map(x => ({ value: x.name, label: x.name })),
    '⚠️ تمام رکوردهای مرتبط با کالای جدید به‌روزرسانی می‌شوند.'
  );
  if (!replacement) return;
  let count = 0;
  records.forEach(r => {
    if (r.product === p.name) {
      r.product = replacement;
      r.updatedAt = Date.now();
      r.updatedBy = currentUser.id;
      r.updatedByName = currentUser.displayName || currentUser.username;
      count++;
    }
  });
  products.splice(index, 1);
  if (!deletedProducts.includes(p.name)) deletedProducts.push(p.name);
  dirty = true;
  auditLog.push({ t: Date.now(), action: 'update', userId: currentUser.id,
    userName: currentUser.displayName || currentUser.username,
    detail: `حذف کالای ${p.name} با جایگزینی ${replacement} (${count} رکورد)`, recordId: null });
  renderMasterData();
  renderRecordsPanel();
  updateAdminSyncStatus();
  showToast(`${toFa(count)} رکورد به‌روزرسانی شد`, 'success');
}

const _PARTY_LABELS = { seller: 'فروشنده', buyer: 'خریدار', driver: 'راننده' };
function _getPartyList(kind) {
  return kind === 'seller' ? sellers : kind === 'buyer' ? buyers : drivers;
}

async function adminAddParty(kind) {
  const list = _getPartyList(kind);
  const label = _PARTY_LABELS[kind];
  const name = await customPrompt(`نام ${label} جدید:`, '');
  if (!name || !name.trim()) return;
  const n = name.trim();
  if (list.includes(n)) { showToast('قبلاً وجود دارد', 'warning'); return; }
  if (kind === 'seller') deletedSellers = deletedSellers.filter(x => x !== n);
  if (kind === 'buyer')  deletedBuyers  = deletedBuyers.filter(x => x !== n);
  if (kind === 'driver') deletedDrivers = deletedDrivers.filter(x => x !== n);
  list.push(n);
  dirty = true;
  auditLog.push({ t: Date.now(), action: 'update', userId: currentUser.id,
    userName: currentUser.displayName || currentUser.username,
    detail: `افزودن ${label} ${n}`, recordId: null });
  renderMasterData();
  updateAdminSyncStatus();
  showToast(`${label} اضافه شد`, 'success');
}

async function adminEditParty(kind, index) {
  const list = _getPartyList(kind);
  const label = _PARTY_LABELS[kind];
  const oldName = list[index]; if (!oldName) return;
  const newName = await customPrompt(`نام ${label}:`, oldName);
  if (!newName || !newName.trim()) return;
  const n = newName.trim();
  if (n === oldName) return;
  if (list.includes(n)) { showToast('نام تکراری', 'warning'); return; }
  list[index] = n;
  let count = 0;
  records.forEach(r => {
    let matched = false;
    if (kind === 'seller' && r.type === 'in'  && r.party === oldName) { r.party = n; matched = true; }
    if (kind === 'buyer'  && r.type === 'out' && r.party === oldName) { r.party = n; matched = true; }
    if (kind === 'driver' && r.driver === oldName) { r.driver = n; matched = true; }
    if (matched) {
      r.updatedAt = Date.now();
      r.updatedBy = currentUser.id;
      r.updatedByName = currentUser.displayName || currentUser.username;
      count++;
    }
  });
  dirty = true;
  auditLog.push({ t: Date.now(), action: 'update', userId: currentUser.id,
    userName: currentUser.displayName || currentUser.username,
    detail: `تغییر نام ${label} ${oldName} → ${n} (${count} رکورد)`, recordId: null });
  renderMasterData();
  renderRecordsPanel();
  updateAdminSyncStatus();
  showToast(`نام در ${toFa(count)} رکورد به‌روزرسانی شد`, 'success');
}

async function adminDeleteParty(kind, index) {
  const list = _getPartyList(kind);
  const label = _PARTY_LABELS[kind];
  const name = list[index]; if (!name) return;
  const usage = partyUsageCount(kind, name);
  if (usage === 0) {
    const ok = await customConfirm(`${label} «${name}» حذف شود؟`, { okText: 'حذف', danger: true });
    if (!ok) return;
    list.splice(index, 1);
    if (kind === 'seller' && !deletedSellers.includes(name)) deletedSellers.push(name);
    if (kind === 'buyer'  && !deletedBuyers.includes(name))  deletedBuyers.push(name);
    if (kind === 'driver' && !deletedDrivers.includes(name)) deletedDrivers.push(name);
    dirty = true;
    auditLog.push({ t: Date.now(), action: 'update', userId: currentUser.id,
      userName: currentUser.displayName || currentUser.username,
      detail: `حذف ${label} ${name} (بدون استفاده)`, recordId: null });
    renderMasterData();
    updateAdminSyncStatus();
    showToast('حذف شد', 'success');
    return;
  }
  const others = list.filter((_, i) => i !== index);
  if (!others.length) {
    showToast(`هیچ ${label} دیگری برای جایگزینی وجود ندارد`, 'warning');
    return;
  }
  const replacement = await showReplacePicker(
    `${label} «${name}» در ${toFa(usage)} رکورد استفاده شده است. برای حذف ایمن، یک ${label} جایگزین انتخاب کنید:`,
    others.map(x => ({ value: x, label: x })),
    ''
  );
  if (!replacement) return;
  let count = 0;
  records.forEach(r => {
    let matched = false;
    if (kind === 'seller' && r.type === 'in'  && r.party === name) { r.party = replacement; matched = true; }
    if (kind === 'buyer'  && r.type === 'out' && r.party === name) { r.party = replacement; matched = true; }
    if (kind === 'driver' && r.driver === name) { r.driver = replacement; matched = true; }
    if (matched) {
      r.updatedAt = Date.now();
      r.updatedBy = currentUser.id;
      r.updatedByName = currentUser.displayName || currentUser.username;
      count++;
    }
  });
  list.splice(index, 1);
  if (kind === 'seller' && !deletedSellers.includes(name)) deletedSellers.push(name);
  if (kind === 'buyer'  && !deletedBuyers.includes(name))  deletedBuyers.push(name);
  if (kind === 'driver' && !deletedDrivers.includes(name)) deletedDrivers.push(name);
  dirty = true;
  auditLog.push({ t: Date.now(), action: 'update', userId: currentUser.id,
    userName: currentUser.displayName || currentUser.username,
    detail: `حذف ${label} ${name} با جایگزینی ${replacement} (${count} رکورد)`, recordId: null });
  renderMasterData();
  renderRecordsPanel();
  updateAdminSyncStatus();
  showToast(`${toFa(count)} رکورد به‌روزرسانی شد`, 'success');
}

/* ═══════════════════════════════════════════════
   Version Check & Update — Admin
   ═══════════════════════════════════════════════ */
async function checkRemoteVersion() {
  try {
    if (!ghConfig || !ghConfig.owner || !ghConfig.repo) return;
    const url = `https://api.github.com/repos/${ghConfig.owner}/${ghConfig.repo}/commits?per_page=1&_=${Date.now()}`;
    const headers = { 'Accept': 'application/vnd.github+json' };
    if (ghConfig.token) headers['Authorization'] = 'Bearer ' + ghConfig.token;
    const res = await fetch(url, { headers, cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data) || !data[0] || !data[0].sha) return;
    const remoteSha = data[0].sha;
    const stored = localStorage.getItem('wh_remote_sha');
    if (stored && stored !== remoteSha) {
      showUpdateBanner();
    } else if (!stored) {
      localStorage.setItem('wh_remote_sha', remoteSha);
    }
  } catch(e) { console.warn('Version check failed:', e); }
}

function showUpdateBanner() {
  const b = document.getElementById('updateBanner');
  if (b) b.hidden = false;
}

function dismissUpdateBanner() {
  const b = document.getElementById('updateBanner');
  if (b) b.hidden = true;
}

async function checkForUpdate() {
  showToast('⏳ در حال بررسی نسخه جدید...', 'info', 1500);
  try {
    if (!ghConfig || !ghConfig.owner || !ghConfig.repo) {
      await customAlert('❌ ابتدا تنظیمات اتصال به GitHub را انجام دهید.');
      return;
    }
    const url = `https://api.github.com/repos/${ghConfig.owner}/${ghConfig.repo}/commits?per_page=1&_=${Date.now()}`;
    const headers = { 'Accept': 'application/vnd.github+json' };
    if (ghConfig.token) headers['Authorization'] = 'Bearer ' + ghConfig.token;
    const res = await fetch(url, { headers, cache: 'no-store' });
    if (!res.ok) {
      await customAlert('❌ خطا در ارتباط با GitHub: ' + res.status);
      return;
    }
    const data = await res.json();
    if (!Array.isArray(data) || !data[0] || !data[0].sha) {
      await customAlert('❌ اطلاعات commit دریافت نشد.');
      return;
    }
    const remoteSha = data[0].sha;
    const stored = localStorage.getItem('wh_remote_sha');
    if (!stored) {
      localStorage.setItem('wh_remote_sha', remoteSha);
      await customAlert('✅ شما از آخرین نسخه استفاده می‌کنید.');
      return;
    }
    if (stored === remoteSha) {
      await customAlert('✅ شما از آخرین نسخه استفاده می‌کنید.');
      dismissUpdateBanner();
    } else {
      const ok = await customConfirm(
        '🔔 نسخه جدید برنامه در دسترس است.\n\nآیا همین حالا به‌روزرسانی شود؟\n\n(برنامه یک‌بار بسته و باز می‌شود — داده‌های شما حفظ می‌شوند)',
        { okText: '🔄 به‌روزرسانی', cancelText: 'بعداً' }
      );
      if (ok) applyUpdate();
    }
  } catch(e) {
    await customAlert('❌ خطا: ' + (e.message || 'نامشخص'));
  }
}

async function applyUpdate() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        try { await reg.update(); } catch(e) {}
      }
    }
    localStorage.removeItem('wh_remote_sha');
  } catch(e) {}
  showToast('🔄 در حال به‌روزرسانی...', 'success', 900);
  setTimeout(() => location.reload(true), 600);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch(e) { console.warn('SW registration failed', e); }
  });
}