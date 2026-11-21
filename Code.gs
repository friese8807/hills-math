/**
 * 힐스초등수학 — Google Apps Script + 구글 시트 버전 (서버)
 * 데이터는 이 스크립트가 붙어 있는 구글 시트의 탭들에 저장됩니다.
 * 처음 한 번: 편집기에서 setup 함수를 선택하고 [실행].
 */

// ---------------- 시트 구조 (탭 이름, [키, 머리글]) ----------------
const SCHEMA = {
  students: ['학생', [['id', 'ID'], ['name', '이름'], ['grade', '학년'], ['school', '학교'], ['class_id', '반ID'],
    ['status', '상태'], ['phone', '학생연락처'], ['parent_name', '학부모'], ['parent_relation', '관계'],
    ['parent_phone', '학부모연락처'], ['billing', '수강료방식'], ['cycle_size', '회차묶음'], ['cycle_offset', '이전회차'],
    ['fee', '수강료'], ['start_date', '등록일'], ['memo', '특이사항'], ['gender', '성별']]],
  classes: ['반', [['id', 'ID'], ['name', '반이름'], ['days', '요일'], ['start', '시작'], ['end', '끝'], ['active', '사용']]],
  attendance: ['출결', [['id', 'ID'], ['date', '날짜'], ['student_id', '학생ID'], ['class_id', '반ID'], ['status', '출결'],
    ['hw', '숙제'], ['memo', '메모']]],
  lessons: ['수업', [['date', '날짜'], ['class_id', '반ID'], ['progress', '진도'], ['homework', '다음숙제'], ['memo', '수업메모']]],
  makeups: ['보강', [['id', 'ID'], ['student_id', '학생ID'], ['class_id', '반ID'], ['absent_date', '결석일'], ['reason', '사유'],
    ['status', '상태'], ['plan_date', '보강예정일'], ['plan_time', '보강시간'], ['done_date', '보강완료일'],
    ['done_class_id', '보강반ID'], ['memo', '메모']]],
  tuition: ['수강료', [['id', 'ID'], ['student_id', '학생ID'], ['month', '청구월'], ['cycle', '회차'], ['amount', '금액'],
    ['paid_date', '납부일'], ['method', '방법'], ['memo', '메모'], ['receipt', '현금영수증']]],
  expenses: ['지출', [['id', 'ID'], ['date', '날짜'], ['category', '항목'], ['amount', '금액'], ['memo', '내용']]],
  scores: ['성적', [['id', 'ID'], ['student_id', '학생ID'], ['date', '날짜'], ['kind', '구분'], ['title', '시험'],
    ['score', '점수'], ['memo', '메모']]],
  consults: ['상담', [['id', 'ID'], ['student_id', '학생ID'], ['date', '날짜'], ['content', '내용']]],
  settings: ['설정', [['key', '키'], ['value', '값']]],
  log: ['기록', [['time', '시각'], ['user', '사용자'], ['action', '작업']]],
};
const NUMS = new Set(['id', 'class_id', 'student_id', 'cycle_size', 'cycle_offset', 'fee', 'cycle', 'amount', 'active',
  'done_class_id']);
const ATT = ['출석', '지각', '조퇴', '결석', '보강'];
const COUNTED = ['출석', '지각', '조퇴', '보강'];
const HW = ['', '완료', '일부', '안함'];
const STATUS = ['재원', '휴원', '퇴원'];
const BILLING = ['회차제', '월정액'];
const METHODS = ['계좌이체', '카드', '현금', '지역화폐', '기타'];
const EXP_CATS = ['임대료', '교재', '간식·소모품', '관리비·공과금', '광고', '기타'];
const MK_STATUS = ['대기', '예정', '완료', '취소'];
const TZ = 'Asia/Seoul';

// ---------------- 홈 화면 앱(GitHub 페이지)용 API ----------------
// 휴대폰 홈 화면 아이콘(github.io)이 이 주소로 POST 해서 데이터를 주고받는다.
// 배포: '나'로 실행 + '모든 사용자'. 대신 아래 비밀번호(해시로만 저장)를 통과해야 하고,
// 정해진 함수만 부를 수 있으며, 비밀번호를 여러 번 틀리면 잠시 잠긴다.
let API_USER_ = '';
const API_FNS = ['boot', 'getAll', 'saveCheck', 'makeupNew', 'makeupAction', 'saveStudent', 'setNote', 'saveFeeSheet',
  'setFeeAll', 'deleteStudent', 'addScore', 'addConsult', 'deleteRow', 'tuitionAction', 'generateMonthly', 'addBill',
  'addExpense', 'saveClass', 'deleteClass', 'saveSettings'];
const API_MAX_FAIL = 8, API_LOCK_SEC = 900;

function doPost(e) {
  let out;
  try {
    const body = String((e && e.postData && e.postData.contents) || '');
    if (body.length > 200000) throw new Error('요청이 너무 큽니다.');
    const req = JSON.parse(body || '{}');
    apiCheck_(String(req.token || ''));
    API_USER_ = str_(req.device, 20) || '홈 화면 앱';
    const fn = String(req.fn || '');
    if (API_FNS.indexOf(fn) < 0) throw new Error('허용되지 않은 요청입니다.');
    const args = Array.isArray(req.args) ? req.args.slice(0, 5) : [];
    const res = fn === 'boot' ? apiBoot_() : globalThis[fn].apply(null, args);
    out = { ok: true, res: res };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  } finally {
    API_USER_ = '';
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function apiBoot_() {
  return { style: include_('style'), app: include_('app'), data: snapshot_(new Db_()) };
}

function apiHash_(salt, pw) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + pw,
    Utilities.Charset.UTF_8));
}

function apiCheck_(token) {
  const props = PropertiesService.getScriptProperties();
  const hash = props.getProperty('API_HASH'), salt = props.getProperty('API_SALT');
  if (!hash || !salt) throw new Error('비밀번호가 아직 만들어지지 않았습니다. 편집기에서 makePassword 를 실행하세요.');
  const cache = CacheService.getScriptCache();
  const fails = parseInt(cache.get('api_fail') || '0', 10);
  if (fails >= API_MAX_FAIL) throw new Error('비밀번호를 여러 번 틀려 15분 동안 잠겼습니다. 잠시 후 다시 해 주세요.');
  const got = apiHash_(salt, token.trim());
  let diff = got.length ^ hash.length;
  for (let i = 0; i < Math.min(got.length, hash.length); i++) diff |= got.charCodeAt(i) ^ hash.charCodeAt(i);
  if (!token || diff) {
    cache.put('api_fail', String(fails + 1), API_LOCK_SEC);
    throw new Error('비밀번호가 맞지 않습니다.');
  }
}

// 편집기에서 한 번 실행: 새 비밀번호를 만들어 '실행 로그'에 보여 준다. 다시 실행하면 비밀번호가 바뀌고
// 모든 휴대폰에서 새 비밀번호를 한 번 다시 넣어야 한다.
function makePassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid());
  let pw = '';
  for (let i = 0; i < 12; i++) pw += abc[(bytes[i] + 256) % abc.length] + (i === 3 || i === 7 ? '-' : '');
  const salt = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperties({ API_SALT: salt, API_HASH: apiHash_(salt, pw) });
  CacheService.getScriptCache().remove('api_fail');
  Logger.log('홈 화면 앱 비밀번호: %s  (이 비밀번호는 다시 볼 수 없으니 적어 두세요)', pw);
}

// ---------------- 웹앱 ----------------
function doGet() {
  auth_();
  const t = HtmlService.createTemplateFromFile('index');
  return t.evaluate()
    .setTitle('힐스초등수학')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// 첫 화면에 데이터를 같이 실어 보내 왕복 1회를 줄인다. '<' 를 이스케이프해 스크립트 태그가 중간에 끊기는 주입을 막는다.
function bootJson_() {
  return JSON.stringify(snapshot_(new Db_())).replace(/</g, '\\u003c');
}

// ---------------- 접근 제어 ----------------
// 이 앱을 쓸 두 사람의 구글 계정. 배우자 계정을 실제 주소로 바꾸세요.
// (setup 을 실행한 계정은 자동으로 추가됩니다)
const USERS = [];  // 공개 저장소라 주소를 적지 않는다. 주인 계정은 setup 때 스크립트 속성 ALLOWED_EMAILS 에 들어간다

function allowedEmails_() {
  const extra = PropertiesService.getScriptProperties().getProperty('ALLOWED_EMAILS') || '';
  return USERS.concat(extra.split(',')).map(s => String(s).trim().toLowerCase()).filter(s => s && s !== 'spouse@gmail.com');
}

// 배포는 '웹 앱에 액세스하는 사용자로 실행'이라 각자 자기 계정으로 들어오고, 시트 공유가 1차 잠금이다.
// 여기서 목록에 없는 계정을 한 번 더 막는다.
function auth_() {
  if (API_USER_) return; // 홈 화면 앱(API)으로 들어와 비밀번호 확인을 이미 통과함
  const me = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!me || allowedEmails_().indexOf(me) < 0) throw new Error('접근 권한이 없습니다. (' + (me || '로그인 정보 없음') + ')');
}

// ---------------- 시트 읽기/쓰기 ----------------
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }

function sheet_(key) {
  const [title, cols] = SCHEMA[key];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(title);
  if (!sh) {
    sh = ss.insertSheet(title);
    sh.getRange(1, 1, 1, cols.length).setValues([cols.map(c => c[1])]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');  // 날짜·번호가 자동 변환되지 않게 모두 텍스트
  } else if (sh.getLastColumn() < cols.length) {
    // 새 버전에서 열이 늘었으면(예: 성별) 머리글을 붙인다. 기존 데이터는 그대로.
    sh.getRange(1, 1, 1, cols.length).setValues([cols.map(c => c[1])]).setFontWeight('bold');
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
  }
  return sh;
}

// 수식으로 해석될 수 있는 값(=, +, -, @ 로 시작)은 글자로 저장한다 (시트 수식 주입 방지).
function cell_(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function Db_() { this.cache = {}; this.dirty = {}; }
Db_.prototype.all = function (key) {
  if (!this.cache[key]) {
    const cols = SCHEMA[key][1];
    const sh = sheet_(key);
    const n = sh.getLastRow() - 1;
    const vals = n > 0 ? sh.getRange(2, 1, n, cols.length).getValues() : [];
    this.cache[key] = vals.filter(r => r.some(v => v !== '' && v !== null)).map(r => {
      const o = {};
      cols.forEach((c, i) => {
        let v = r[i];
        if (v instanceof Date) v = Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
        o[c[0]] = NUMS.has(c[0]) ? (Number(v) || 0) : String(v === null || v === undefined ? '' : v);
      });
      return o;
    });
  }
  return this.cache[key];
};
Db_.prototype.touch = function (key) { this.dirty[key] = true; };
Db_.prototype.set = function (key, rows) { this.cache[key] = rows; this.dirty[key] = true; };
Db_.prototype.insert = function (key, obj) {
  const rows = this.all(key);
  if ('id' in obj || SCHEMA[key][1][0][0] === 'id') obj.id = rows.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
  rows.push(obj);
  this.touch(key);
  return obj;
};
Db_.prototype.get = function (key, id) {
  const r = this.all(key).find(x => x.id === Number(id));
  if (!r) throw new Error('항목을 찾을 수 없습니다. 화면을 새로고침해 주세요.');
  return r;
};
// shortcut: 바뀐 탭을 통째로 다시 쓴다. 학생 수십 명·몇 년치는 충분히 빠르다. 수만 행이 되면 행 단위 쓰기로 바꿀 것.
Db_.prototype.commit = function () {
  Object.keys(this.dirty).forEach(key => {
    const cols = SCHEMA[key][1];
    const sh = sheet_(key);
    const rows = this.cache[key];
    const last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, cols.length).clearContent();
    if (rows.length) {
      if (sh.getMaxRows() < rows.length + 1) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 1 - sh.getMaxRows());
      const rng = sh.getRange(2, 1, rows.length, cols.length);
      rng.setNumberFormat('@');
      rng.setValues(rows.map(o => cols.map(c => cell_(o[c[0]]))));
    }
  });
  this.dirty = {};
};

function snapshot_(db) {
  const st = {};
  db.all('settings').forEach(r => { st[r.key] = r.value; });
  return {
    today: today_(),
    students: db.all('students'), classes: db.all('classes'), attendance: db.all('attendance'),
    lessons: db.all('lessons'), makeups: db.all('makeups'), tuition: db.all('tuition'),
    expenses: db.all('expenses'), scores: db.all('scores'), consults: db.all('consults'),
    settings: { academy: st.academy || '힐스초등수학', account: st.account || '', closing: st.closing || '' },
    consts: { ATT, HW, STATUS, BILLING, METHODS, EXP_CATS },
    me: API_USER_ || String(Session.getActiveUser().getEmail() || ''), users: API_USER_ ? [] : allowedEmails_(),
  };
}

// 모든 저장 작업은 이 함수를 거친다: 권한 확인 → 잠금 → 작업 → 시트 기록 → 새 데이터 반환
function run_(label, fn) {
  auth_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const db = new Db_();
    const out = fn(db) || {};
    db.insert('log', { time: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'),
      user: API_USER_ || Session.getActiveUser().getEmail() || '', action: label });
    const logs = db.all('log');
    if (logs.length > 2000) db.set('log', logs.slice(-1500));
    db.commit();
    return { data: snapshot_(db), msg: out.msg || '저장했어요', id: out.id || null };
  } finally {
    lock.releaseLock();
  }
}

function getAll() { auth_(); return snapshot_(new Db_()); }

// ---------------- 입력 검사 ----------------
function str_(v, max) { return String(v === null || v === undefined ? '' : v).trim().slice(0, max || 200); }
function int_(v, lo, hi, def) {
  const n = parseInt(String(v === null || v === undefined ? '' : v).replace(/,/g, ''), 10);
  if (isNaN(n)) return def === undefined ? 0 : def;
  return Math.min(hi === undefined ? 100000000 : hi, Math.max(lo || 0, n));
}
function date_(v, def) {
  const s = String(v || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00').getTime())) return s;
  if (def !== undefined) return def;
  throw new Error('날짜를 확인해 주세요.');
}
function month_(v) { const s = String(v || ''); if (/^\d{4}-\d{2}$/.test(s)) return s; throw new Error('월을 확인해 주세요.'); }
function time_(v) { const s = String(v || ''); return /^\d{2}:\d{2}$/.test(s) ? s : ''; }
const GENDER = ['남', '여'];
function choice_(v, list, def) { return list.indexOf(v) >= 0 ? v : (def === undefined ? list[0] : def); }

// ---------------- 업무 규칙 ----------------
// 회차제: 새 묶음의 첫 수업이 기록되면 그 묶음 수강료 청구를 만든다.
function ensureBills_(db, sid) {
  const st = db.all('students').find(s => s.id === sid);
  if (!st || st.billing !== '회차제' || st.fee <= 0) return;
  const size = Math.max(1, st.cycle_size || 8), off = Math.max(0, st.cycle_offset || 0);
  const dates = db.all('attendance').filter(a => a.student_id === sid && COUNTED.indexOf(a.status) >= 0)
    .map(a => a.date).sort();
  const bills = db.all('tuition');
  dates.forEach((day, i) => {
    const cyc = Math.floor((off + i) / size) + 1;
    if (!bills.some(b => b.student_id === sid && b.cycle === cyc)) {
      db.insert('tuition', { student_id: sid, month: day.slice(0, 7), cycle: cyc, amount: st.fee, paid_date: '', method: '', receipt: '', memo: '' });
    }
  });
}

// 출결이 바뀔 때 보강 기록을 맞춘다.
function syncMakeup_(db, sid, cid, day, oldStatus, status, memo) {
  if (oldStatus === status) return;
  const mks = db.all('makeups');
  if (oldStatus === '결석') {  // 결석을 취소했으면, 아직 보강 전인 기록은 지운다
    db.set('makeups', mks.filter(m => !(m.student_id === sid && m.class_id === cid && m.absent_date === day &&
      (m.status === '대기' || m.status === '예정'))));
  }
  if (oldStatus === '보강') {  // 보강 출결을 지웠으면 그 보강을 다시 '해야 할 보강'으로
    db.all('makeups').filter(m => m.student_id === sid && m.status === '완료' && m.done_date === day &&
      m.done_class_id === cid).forEach(m => { m.status = m.plan_date ? '예정' : '대기'; m.done_date = ''; m.done_class_id = 0; });
    db.touch('makeups');
  }
  if (status === '결석') {
    if (!db.all('makeups').some(m => m.student_id === sid && m.class_id === cid && m.absent_date === day)) {
      db.insert('makeups', { student_id: sid, class_id: cid, absent_date: day, reason: memo || '', status: '대기',
        plan_date: '', plan_time: '', done_date: '', done_class_id: 0, memo: '' });
    }
  }
  if (status === '보강') {  // 남은 보강 중 그날로 잡힌 것 → 가장 오래된 것 순서로 하나 완료
    const open = db.all('makeups').filter(m => m.student_id === sid && (m.status === '대기' || m.status === '예정'))
      .sort((a, b) => ((b.plan_date === day) - (a.plan_date === day)) || (a.absent_date < b.absent_date ? -1 : 1));
    if (open.length) { open[0].status = '완료'; open[0].done_date = day; open[0].done_class_id = cid; db.touch('makeups'); }
  }
}

function setAttendance_(db, sid, cid, day, status, hw, memo) {
  const att = db.all('attendance');
  const cur = att.find(a => a.student_id === sid && a.class_id === cid && a.date === day);
  const old = cur ? cur.status : '';
  if (!status) {
    if (cur) db.set('attendance', att.filter(a => a !== cur));
  } else if (cur) {
    cur.status = status;
    if (hw !== null) cur.hw = hw;
    db.touch('attendance');
  } else {
    db.insert('attendance', { date: day, student_id: sid, class_id: cid, status, hw: hw || '', memo: memo || '' });
  }
  syncMakeup_(db, sid, cid, day, old, status, memo);
  ensureBills_(db, sid);
}

function setFee_(db, st, fee) {
  if (st.fee === fee) return;
  db.all('tuition').forEach(b => { if (b.student_id === st.id && !b.paid_date && b.amount === st.fee) b.amount = fee; });
  db.touch('tuition');
  st.fee = fee;
  db.touch('students');
  ensureBills_(db, st.id);
}

// ---------------- 출석체크 ----------------
function saveCheck(p) {
  return run_('출석체크 저장', db => {
    const day = date_(p.date);
    const cid = db.get('classes', p.class_id).id;
    const members = new Set(db.all('students').filter(s => s.class_id === cid && s.status === '재원').map(s => s.id));
    db.all('attendance').forEach(a => { if (a.class_id === cid && a.date === day) members.add(a.student_id); });
    (p.rows || []).forEach(r => {
      const sid = Number(r.sid);
      if (!members.has(sid)) return;
      let status = r.status ? choice_(r.status, ATT) : '';
      const hw = r.hw === undefined || r.hw === null ? null : choice_(r.hw, HW, '');
      if (!status && (p.rest || hw)) status = '출석';  // '체크 안 한 학생 모두 출석', 숙제만 누른 학생은 출석
      setAttendance_(db, sid, cid, day, status, hw, '');
    });
    if (p.lesson) {
      const L = { progress: str_(p.lesson.progress, 500), homework: str_(p.lesson.homework, 500), memo: str_(p.lesson.memo, 1000) };
      const rows = db.all('lessons');
      const cur = rows.find(l => l.class_id === cid && l.date === day);
      if (cur) { Object.assign(cur, L); db.touch('lessons'); }
      else if (L.progress || L.homework || L.memo) db.insert('lessons', Object.assign({ date: day, class_id: cid }, L));
    }
    return { msg: '출석을 저장했어요' };
  });
}

// ---------------- 보강 ----------------
function makeupNew(p) {
  return run_('결석 등록', db => {
    const sid = db.get('students', p.student_id).id;
    const day = date_(p.absent_date);
    const reason = str_(p.reason, 200);
    if (p.class_id) {
      const cid = db.get('classes', p.class_id).id;
      setAttendance_(db, sid, cid, day, '결석', null, reason);
    } else {
      db.insert('makeups', { student_id: sid, class_id: 0, absent_date: day, reason, status: '대기',
        plan_date: '', plan_time: '', done_date: '', done_class_id: 0, memo: '' });
    }
    return { msg: '결석을 등록했어요. 보강 날짜를 정해 주세요' };
  });
}

function makeupAction(id, action, p) {
  p = p || {};
  return run_('보강 ' + action, db => {
    const mk = db.get('makeups', id);
    db.touch('makeups');
    if (action === 'plan') {
      mk.plan_date = date_(p.plan_date);
      mk.plan_time = time_(p.plan_time);
      if (mk.status !== '완료') mk.status = '예정';
      return { msg: '보강 날짜를 저장했어요' };
    }
    if (action === 'done') {
      const day = date_(p.done_date, today_());
      let cid = mk.class_id || (db.all('students').find(s => s.id === mk.student_id) || {}).class_id || 0;
      // 같은 날 그 반 출결이 이미 있으면(정규 수업 뒤 이어서 보강 등) 반 밖(0) 보강으로 따로 남긴다
      if (db.all('attendance').some(a => a.student_id === mk.student_id && a.class_id === cid && a.date === day)) cid = 0;
      mk.status = '완료'; mk.done_date = day; mk.done_class_id = cid;
      if (p.memo !== undefined) mk.memo = str_(p.memo, 200);
      // 보강도 수업 횟수(회차)에 들어가므로 출결에 '보강'으로 남긴다
      if (!db.all('attendance').some(a => a.student_id === mk.student_id && a.class_id === cid && a.date === day)) {
        db.insert('attendance', { date: day, student_id: mk.student_id, class_id: cid, status: '보강', hw: '', memo: '' });
        ensureBills_(db, mk.student_id);
      }
      return { msg: '보강 완료로 표시했어요' };
    }
    if (action === 'cancel') { mk.status = '취소'; mk.memo = str_(p.memo, 200) || mk.memo; return { msg: '보강 안 함으로 표시했어요' }; }
    if (action === 'reopen') {
      if (mk.status === '완료') {
        db.set('attendance', db.all('attendance').filter(a => !(a.student_id === mk.student_id && a.class_id === mk.done_class_id &&
          a.date === mk.done_date && a.status === '보강')));
      }
      mk.status = mk.plan_date ? '예정' : '대기'; mk.done_date = ''; mk.done_class_id = 0;
      return { msg: '다시 해야 할 보강으로 돌렸어요' };
    }
    if (action === 'reason') { mk.reason = str_(p.reason, 200); mk.memo = str_(p.memo, 200); return {}; }
    if (action === 'delete') { db.set('makeups', db.all('makeups').filter(m => m !== mk)); return { msg: '삭제했어요' }; }
    throw new Error('알 수 없는 작업입니다.');
  });
}

// ---------------- 학생 ----------------
function saveStudent(p) {
  return run_('학생 저장', db => {
    const name = str_(p.name, 30);
    if (!name) throw new Error('이름을 입력하세요.');
    const cid = int_(p.class_id);
    if (cid) db.get('classes', cid);
    const v = {
      name, grade: str_(p.grade, 10), school: str_(p.school, 50), class_id: cid, status: choice_(p.status, STATUS),
      phone: str_(p.phone, 30), parent_name: str_(p.parent_name, 30), parent_relation: str_(p.parent_relation, 10),
      parent_phone: str_(p.parent_phone, 30), billing: choice_(p.billing, BILLING), cycle_size: int_(p.cycle_size, 1, 50, 8),
      cycle_offset: int_(p.cycle_offset, 0, 1000), start_date: date_(p.start_date, today_()), memo: str_(p.memo, 2000),
      gender: choice_(p.gender, GENDER, ''),
    };
    const fee = int_(p.fee);
    let st;
    if (p.id) {
      st = db.get('students', p.id);
      Object.assign(st, v);
      db.touch('students');
      setFee_(db, st, fee);
      ensureBills_(db, st.id);
    } else {
      st = db.insert('students', Object.assign(v, { fee }));
    }
    return { id: st.id, msg: '학생 정보를 저장했어요' };
  });
}

function setNote(id, memo) {
  return run_('특이사항', db => { db.get('students', id).memo = str_(memo, 2000); db.touch('students'); return { msg: '특이사항을 저장했어요' }; });
}

function saveFeeSheet(list) {
  return run_('수강료·특이사항 일괄', db => {
    (list || []).slice(0, 300).forEach(r => {
      const st = db.all('students').find(s => s.id === Number(r.id));
      if (!st) return;
      if (r.memo !== undefined) { st.memo = str_(r.memo, 2000); db.touch('students'); }
      if (r.fee !== undefined) setFee_(db, st, int_(r.fee));
      if (r.gender !== undefined) { st.gender = choice_(r.gender, GENDER, ''); db.touch('students'); }
    });
    return { msg: '성별·수강료·특이사항을 저장했어요' };
  });
}

function setFeeAll(amount) {
  return run_('수강료 일괄 지정', db => {
    const fee = int_(amount);
    if (fee <= 0) throw new Error('금액을 입력하세요.');
    db.all('students').filter(s => s.status === '재원' && s.fee <= 0).forEach(s => setFee_(db, s, fee));
    return { msg: '수강료 금액을 정했어요' };
  });
}

function deleteStudent(id) {
  return run_('학생 삭제', db => {
    const sid = db.get('students', id).id;
    ['attendance', 'makeups', 'tuition', 'scores', 'consults'].forEach(k => db.set(k, db.all(k).filter(r => r.student_id !== sid)));
    db.set('students', db.all('students').filter(s => s.id !== sid));
    return { msg: '학생 정보를 모두 삭제했어요' };
  });
}

function addScore(p) {
  return run_('성적 입력', db => {
    const sid = db.get('students', p.student_id).id;
    db.insert('scores', { student_id: sid, date: date_(p.date, today_()), kind: str_(p.kind, 20), title: str_(p.title, 50),
      score: str_(p.score, 20), memo: str_(p.memo, 200) });
    return { msg: '성적을 저장했어요' };
  });
}
function addConsult(p) {
  return run_('상담 기록', db => {
    const sid = db.get('students', p.student_id).id;
    const content = str_(p.content, 2000);
    if (!content) throw new Error('내용을 입력하세요.');
    db.insert('consults', { student_id: sid, date: date_(p.date, today_()), content });
    return { msg: '상담 기록을 저장했어요' };
  });
}
function deleteRow(kind, id) {
  if (['scores', 'consults', 'expenses'].indexOf(kind) < 0) throw new Error('삭제할 수 없는 항목입니다.');
  return run_('삭제 ' + kind, db => { const r = db.get(kind, id); db.set(kind, db.all(kind).filter(x => x !== r)); return { msg: '삭제했어요' }; });
}

// ---------------- 수강료 ----------------
function tuitionAction(id, action, p) {
  p = p || {};
  return run_('수강료 ' + action, db => {
    const b = db.get('tuition', id);
    db.touch('tuition');
    if (action === 'pay') { b.paid_date = date_(p.paid_date, today_()); b.method = choice_(p.method, METHODS); return { msg: b.method + (b.method === '현금' ? '으로' : '로') + ' 납부 완료 표시했어요' }; }
    if (action === 'unpay') { b.paid_date = ''; b.method = ''; b.receipt = ''; return { msg: '납부 표시를 취소했어요' }; }
    if (action === 'receipt') {
      if (!b.paid_date || ['계좌이체', '현금'].indexOf(b.method) < 0) throw new Error('계좌이체·현금으로 낸 수강료만 현금영수증 발급 표시를 할 수 있어요.');
      b.receipt = today_(); return { msg: '현금영수증 발급함으로 표시했어요' };
    }
    if (action === 'method') {
      if (!b.paid_date) throw new Error('아직 안 낸 수강료예요.');
      b.method = choice_(p.method, METHODS); return { msg: '납부 방법을 ' + b.method + (b.method === '현금' ? '으로' : '로') + ' 바꿨어요' };
    }
    if (action === 'unreceipt') { b.receipt = ''; return { msg: '발급 표시를 취소했어요' }; }
    if (action === 'amount') { b.amount = int_(p.amount); b.memo = str_(p.memo, 200); return {}; }
    if (action === 'delete') { db.set('tuition', db.all('tuition').filter(x => x !== b)); return { msg: '청구를 삭제했어요' }; }
    throw new Error('알 수 없는 작업입니다.');
  });
}

function generateMonthly(month) {
  return run_('월정액 청구', db => {
    const m = month_(month);
    let n = 0;
    db.all('students').filter(s => s.status === '재원' && s.billing === '월정액' && s.fee > 0).forEach(s => {
      if (!db.all('tuition').some(b => b.student_id === s.id && b.month === m && b.cycle === 0)) {
        db.insert('tuition', { student_id: s.id, month: m, cycle: 0, amount: s.fee, paid_date: '', method: '', receipt: '', memo: '' }); n++;
      }
    });
    return { msg: `월정액 청구 ${n}건을 만들었어요` };
  });
}

function addBill(p) {
  return run_('개별 청구', db => {
    const sid = db.get('students', p.student_id).id;
    const amount = int_(p.amount);
    if (amount <= 0) throw new Error('금액을 입력하세요.');
    db.insert('tuition', { student_id: sid, month: month_(p.month), cycle: 0, amount, paid_date: '', method: '', receipt: '', memo: str_(p.memo, 200) });
    return { msg: '청구를 추가했어요' };
  });
}

// ---------------- 지출 ----------------
function addExpense(p) {
  return run_('지출 추가', db => {
    const amount = int_(p.amount);
    if (amount <= 0) throw new Error('금액을 입력하세요.');
    db.insert('expenses', { date: date_(p.date, today_()), category: choice_(p.category, EXP_CATS, '기타'), amount, memo: str_(p.memo, 200) });
    return { msg: '지출을 추가했어요' };
  });
}

// ---------------- 반 · 설정 ----------------
function saveClass(p) {
  return run_('반 저장', db => {
    const name = str_(p.name, 30);
    if (!name) throw new Error('반 이름을 입력하세요.');
    const days = (p.days || []).filter(d => '월화수목금토일'.indexOf(d) >= 0 && d.length === 1);
    const v = { name, days: '월화수목금토일'.split('').filter(d => days.indexOf(d) >= 0).join(','), start: time_(p.start), end: time_(p.end), active: 1 };
    if (p.id) { Object.assign(db.get('classes', p.id), v); db.touch('classes'); } else db.insert('classes', v);
    return { msg: '반을 저장했어요' };
  });
}
function deleteClass(id) {
  return run_('반 삭제', db => {
    const c = db.get('classes', id);
    db.all('students').forEach(s => { if (s.class_id === c.id) s.class_id = 0; });
    db.touch('students');
    c.active = 0;  // 지난 출결 기록에 반 이름이 남도록 지우지 않고 숨긴다
    db.touch('classes');
    return { msg: '반을 숨겼어요' };
  });
}
function saveSettings(p) {
  return run_('설정 저장', db => {
    const v = { academy: str_(p.academy, 50) || '힐스초등수학', account: str_(p.account, 100), closing: str_(p.closing, 100) };
    db.set('settings', Object.keys(v).map(k => ({ key: k, value: v[k] })));
    return { msg: '설정을 저장했어요' };
  });
}

// ---------------- 처음 설정 (편집기에서 한 번 실행) ----------------
function setup() {
  Object.keys(SCHEMA).forEach(sheet_);
  const props = PropertiesService.getScriptProperties();
  const owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  const cur = (props.getProperty('ALLOWED_EMAILS') || '').split(',').filter(Boolean);
  if (owner && cur.indexOf(owner) < 0) props.setProperty('ALLOWED_EMAILS', cur.concat(owner).join(','));
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const blank = ss.getSheetByName('시트1') || ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
  const db = new Db_();
  if (!db.all('students').length) seedRoster_(db);
  if (!db.all('settings').length) db.set('settings', [{ key: 'academy', value: '힐스초등수학' }]);
  db.commit();
  Logger.log('준비 완료: 학생 %s명, 반 %s개 / 사용 가능한 계정: %s', db.all('students').length, db.all('classes').length, allowedEmails_().join(', '));
}

// 종이 출석부 기준 원생 명단. 처음 setup 때 한 번만 들어가고, 이후에는 앱에서 고치세요.
function seedRoster_(db) {
  const roster = [
    ['월수반', '월,수', [['초6', '조수빈'], ['초5', '허소정', '출석부 표기 (구)'], ['초5', '김민성'], ['초4', '이준서'],
      ['초4', '이충율', '이름 글자 확인 필요'], ['초5', '한제인', '출석부 표기 (구)'], ['초6', '김나연'], ['초6', '류현우'], ['초5', '이성아']]],
    ['화목반', '화,목', [['초3', '김민강'], ['초4', '박시현'], ['초6', '하현준'], ['초6', '권오현'], ['초4', '박이안'], ['초5', '우서윤'],
      ['초5', '이동윤', '출석부 표기 (구)'], ['', '이정우', '학년 확인 필요'], ['초5', '박소연'], ['초5', '김규리'], ['초6', '고선우'],
      ['초5', '이윤재'], ['', '문찬우', '출석부 아래 추가 기재, 반·학년 확인 필요']]],
  ];
  roster.forEach(([cname, days, kids]) => {
    const c = db.insert('classes', { name: cname, days, start: '16:00', end: '17:30', active: 1 });
    kids.forEach(([grade, name, memo]) => db.insert('students', {
      name, grade, school: '', class_id: c.id, status: '재원', phone: '', parent_name: '', parent_relation: '', parent_phone: '',
      billing: '회차제', cycle_size: 8, cycle_offset: 0, fee: 0, start_date: today_(), memo: memo || '', gender: '' }));
  });
}
