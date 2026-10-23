/* utils.js — Persian date, formatting, hashing */
'use strict';

const FA = '۰۱۲۳۴۵۶۷۸۹';
const MONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
const WDAYS = ['ش','ی','د','س','چ','پ','ج'];

function toFa(s){return String(s).replace(/\d/g,d=>FA[+d]);}
function toLatinDigits(s){return String(s).replace(/[۰-۹]/g,d=>FA.indexOf(d)).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));}
function esc(s){if(s==null)return '';return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function div(a,b){return ~~(a/b);}
function mod(a,b){return a-~~(a/b)*b;}
function jalCal(jy){
  const breaks=[-61,9,38,199,426,686,756,818,1111,1181,1210,1635,2060,2097,2192,2262,2324,2394,2456,3178];
  const bl=breaks.length,gy=jy+621;let leapJ=-14,jp=breaks[0],jm,jump,leap,leapG,march,n;
  for(let i=1;i<bl;i++){jm=breaks[i];jump=jm-jp;if(jy<jm)break;leapJ+=div(jump,33)*8+div(mod(jump,33),4);jp=jm;}
  n=jy-jp;leapJ+=div(n,33)*8+div(mod(n,33)+3,4);
  if(mod(jump,33)===4&&jump-n===4)leapJ+=1;
  leapG=div(gy,4)-div((div(gy,100)+1)*3,4)-150;march=20+leapJ-leapG;
  if(jump-n<6)n=n-jump+div(jump+4,33)*33;
  leap=mod(mod(n+1,33)-1,4);if(leap===-1)leap=4;
  return{leap,gy,march};
}
function g2d(gy,gm,gd){let d=div((gy+div(gm-8,6)+100100)*1461,4)+div(153*mod(gm+9,12)+2,5)+gd-34840408;d=d-div(div(gy+100100+div(gm-8,6),100)*3,4)+752;return d;}
function d2g(jdn){let j=4*jdn+139361631;j=j+div(div(4*jdn+183187720,146097)*3,4)*4-3908;const i=div(mod(j,1461),4)*5+308;const gd=div(mod(i,153),5)+1;const gm=mod(div(i,153),12)+1;const gy=div(j,1461)-100100+div(8-gm,6);return{gy,gm,gd};}
function j2d(jy,jm,jd){const r=jalCal(jy);return g2d(r.gy,3,r.march)+(jm-1)*31-div(jm,7)*(jm-7)+jd-1;}
function d2j(jdn){const gy=d2g(jdn).gy;let jy=gy-621;const r=jalCal(jy);const jdn1f=g2d(gy,3,r.march);let k=jdn-jdn1f;if(k>=0){if(k<=185)return{jy,jm:1+div(k,31),jd:mod(k,31)+1};k-=186;}else{jy--;k+=179;if(r.leap===1)k++;}return{jy,jm:7+div(k,30),jd:mod(k,30)+1};}
function isLeapYear(jy){return jalCal(jy).leap===0;}
function gregToJalaliStr(y,m,d){const j=d2j(g2d(y,m,d));return toFa(`${j.jy}/${String(j.jm).padStart(2,'0')}/${String(j.jd).padStart(2,'0')}`);}
function todayJalali(){const d=new Date();return gregToJalaliStr(d.getFullYear(),d.getMonth()+1,d.getDate());}
function nowTime(){const d=new Date();return toFa(`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`);}
function normalizeDate(s){if(!s)return '';const p=toLatinDigits(s.trim()).split(/[\/\-\.]/);if(p.length!==3)return s.trim();return p.map(x=>x.padStart(2,'0')).join('/');}
function addDaysToJalali(jStr, delta){
  let jdn;
  if(!jStr){const d=new Date();jdn=g2d(d.getFullYear(),d.getMonth()+1,d.getDate());}
  else{const p=toLatinDigits(jStr).split('/').map(Number);if(p.length!==3||p.some(isNaN)){const d=new Date();jdn=g2d(d.getFullYear(),d.getMonth()+1,d.getDate());}else jdn=j2d(p[0],p[1],p[2]);}
  const j=d2j(jdn+delta);
  return toFa(`${j.jy}/${String(j.jm).padStart(2,'0')}/${String(j.jd).padStart(2,'0')}`);
}
function fmtQty(q){
  if(q==null||q==='')return '';
  const n=parseFloat(toLatinDigits(String(q)));
  if(isNaN(n))return '';
  if(Number.isInteger(n))return toFa(n);
  return toFa(n.toFixed(3).replace(/\.?0+$/,''));
}
function fmtKg(kg){
  if(kg==null||isNaN(kg))return '۰';
  const n=Number(kg);
  if(n===0)return '۰';
  if(Number.isInteger(n))return toFa(n);
  return toFa(n.toFixed(3).replace(/\.?0+$/,''));
}
function formatBytes(b){
  if(b<1024)return toFa(b)+' بایت';
  if(b<1024*1024)return toFa((b/1024).toFixed(1))+' کیلوبایت';
  return toFa((b/1024/1024).toFixed(2))+' مگابایت';
}
function formatTime(ts){
  if(!ts) return '—';
  const d = new Date(ts);
  return gregToJalaliStr(d.getFullYear(),d.getMonth()+1,d.getDate()) + ' ' +
         toFa(String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'));
}

let _lastIdCounter = 0;
function generateId(){
  const now = Date.now();
  if(now <= _lastIdCounter) _lastIdCounter += 1;
  else _lastIdCounter = now;
  return _lastIdCounter;
}
function generateUserId(){
  return 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
}

async function hashPassword(password, salt){
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name:'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash:'SHA-256' },
    keyMaterial, 256
  );
  return Array.from(new Uint8Array(bits)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function generateSalt(){
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join('');
}