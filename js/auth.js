/* auth.js — multi-user auth, session, permissions */
'use strict';

const SESSION_KEY = 'wh_session_v7';
const SESSION_HOURS = 8;

function loadSession(){
  try{
    const raw = localStorage.getItem(SESSION_KEY);
    if(!raw) return null;
    const s = JSON.parse(raw);
    if(!s || !s.userId || !s.expiresAt) return null;
    if(Date.now() > s.expiresAt){ localStorage.removeItem(SESSION_KEY); return null; }
    return s;
  }catch(e){ return null; }
}
function saveSession(userId, username, role){
  const s = {
    userId, username, role,
    expiresAt: Date.now() + SESSION_HOURS*3600*1000,
    loginAt: Date.now()
  };
  try{ localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }catch(e){}
  return s;
}
function clearSession(){ try{ localStorage.removeItem(SESSION_KEY); }catch(e){} }

/* Permission check based on role */
function canCreateRecord(role){ return role==='admin' || role==='operator'; }
function canEditRecord(role){ return role==='admin' || role==='operator'; }
function canDeleteRecord(role){ return role==='admin' || role==='operator'; }
function canManageUsers(role){ return role==='admin'; }
function canManageDB(role){ return role==='admin'; }
function canPush(role){ return role==='admin' || role==='operator'; }

/* Verify login against users list */
async function verifyLogin(username, password, users){
  const user = (users||[]).find(u => u.username === username);
  if(!user) return {ok:false, reason:'نام کاربری یافت نشد'};
  if(!user.active) return {ok:false, reason:'حساب کاربری غیرفعال است'};
  const hash = await hashPassword(password, user.salt);
  if(hash !== user.passwordHash) return {ok:false, reason:'رمز عبور اشتباه است'};
  return {ok:true, user};
}

/* Create a new user object (returns the user data with hashed password) */
async function createUserObject({username, password, displayName, role, currentUserId}){
  const salt = generateSalt();
  const hash = await hashPassword(password, salt);
  return {
    id: generateUserId(),
    username: username.trim(),
    passwordHash: hash,
    salt,
    displayName: (displayName||username).trim(),
    role: role||'operator',
    active: true,
    createdAt: Date.now(),
    createdBy: currentUserId||'',
    lastLogin: 0
  };
}

function roleLabel(role){
  return role==='admin' ? 'مدیر' : role==='operator' ? 'اپراتور' : 'بیننده';
}