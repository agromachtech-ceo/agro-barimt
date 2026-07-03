/*************************************************************
 * АГРОМАШТЕХ — Баримт бүртгэл (PWA)
 * app.js — камер, QR, offline дараалал (IndexedDB), автомат sync
 *************************************************************/

/* ============ ⚙️ ТОХИРГОО — ЭНД БӨГЛӨНӨ ============ */
var APP_VERSION = 'v5';
var CONFIG = {
  API_URL:   'https://script.google.com/macros/s/AKfycbxzX6fuege8lQP0nMJlNqTdYwGXEFqG_VaM3J85t9O6fMN-t7RNo6PNacSPCLI-m48A/exec',        // ⚠️ Apps Script deploy-ийн /exec URL
  API_TOKEN: 'Batzaya0506',      // ⚠️ backend-ийн API_TOKEN-тэй ЯГ ижил
  ORG_TIN:   '5203449'                   // ⚠️ Агромаштех ТТД (шуурхай B2B анхааруулгад)
};
/* =================================================== */

var TYPES = ['Дараа тооцоо', 'Дотоод томилолт', 'Гадаад томилолт'];
var CATEGORIES = ['Хоол', 'Уулзалт', 'Тээвэр', 'Байр', 'Бичиг хэрэг', 'Бусад'];
var CURRENCIES = ['MNT', 'USD', 'CNY', 'RUB', 'EUR'];

var state = { type: null, image: null, imageMime: 'image/jpeg', qrRaw: '' };
var scanner = null;

/* ==================== IndexedDB ==================== */
var DB;
function dbOpen() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open('agro_baramt', 1);
    req.onupgradeneeded = function (e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains('queue')) {
        db.createObjectStore('queue', { keyPath: 'localId' });
      }
    };
    req.onsuccess = function () { DB = req.result; resolve(DB); };
    req.onerror = function () { reject(req.error); };
  });
}
function dbTx(mode) { return DB.transaction('queue', mode).objectStore('queue'); }
function dbAdd(rec) {
  return new Promise(function (res, rej) {
    var r = dbTx('readwrite').add(rec); r.onsuccess = res; r.onerror = function () { rej(r.error); };
  });
}
function dbAll() {
  return new Promise(function (res, rej) {
    var r = dbTx('readonly').getAll(); r.onsuccess = function () { res(r.result || []); };
    r.onerror = function () { rej(r.error); };
  });
}
function dbPut(rec) {
  return new Promise(function (res, rej) {
    var r = dbTx('readwrite').put(rec); r.onsuccess = res; r.onerror = function () { rej(r.error); };
  });
}
function dbDel(id) {
  return new Promise(function (res, rej) {
    var r = dbTx('readwrite').delete(id); r.onsuccess = res; r.onerror = function () { rej(r.error); };
  });
}

/* ==================== ДЭЛГЭЦ ШИЛЖИЛТ ==================== */
function show(id) {
  ['screen-home', 'screen-type', 'screen-capture'].forEach(function (s) {
    document.getElementById(s).style.display = (s === id) ? 'block' : 'none';
  });
  if (id !== 'screen-capture') stopScanner();
}

/* ==================== ТӨРӨЛ СОНГОХ ==================== */
function chooseType(t) {
  state.type = t;
  resetCapture();
  document.getElementById('cap-type-label').textContent = t;
  var isForeign = (t === 'Гадаад томилолт');
  // Гадаад томилолт бол валют/ханш талбар нээх
  document.getElementById('foreign-fields').style.display = isForeign ? 'block' : 'none';
  document.getElementById('f-currency').value = isForeign ? 'USD' : 'MNT';
  // Гадаад бол ибаримт байхгүй тул B2B тэмдэглэгээг нуух
  document.getElementById('b2b-row').style.display = isForeign ? 'none' : 'block';
  checkB2B();
  show('screen-capture');
}

/* ==================== КАМЕР — ЗУРАГ + ХАЙЧЛАЛТ ==================== */
function onPhotoPicked(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function (e) { openCrop(e.target.result); };
  reader.readAsDataURL(file);
  input.value = ''; // ижил зургийг дахин сонгож болохоор
}

var cropImg = null;      // эх зураг (Image)
var cropState = {};      // { dispW, dispH, natW, natH, box }
var cropDrag = null;

function openCrop(dataUrl) {
  cropImg = new Image();
  cropImg.onload = function () {
    var modal = document.getElementById('crop-modal');
    var el = document.getElementById('crop-img');
    el.src = dataUrl;
    modal.classList.remove('hide');
    setTimeout(function () {
      cropState.natW = cropImg.naturalWidth;
      cropState.natH = cropImg.naturalHeight;
      cropState.dispW = el.clientWidth;
      cropState.dispH = el.clientHeight;
      cropAuto();
    }, 60);
  };
  cropImg.src = dataUrl;
}

// Авто таамаглал: гэрэл ихтэй (баримт) хэсгийн хүрээг олох
function cropAuto() {
  var aw = Math.min(360, cropState.natW);
  var sc = aw / cropState.natW;
  var ah = Math.max(1, Math.round(cropState.natH * sc));
  var c = document.createElement('canvas'); c.width = aw; c.height = ah;
  var ctx = c.getContext('2d'); ctx.drawImage(cropImg, 0, 0, aw, ah);
  var d = ctx.getImageData(0, 0, aw, ah).data;
  var n = aw * ah, sum = 0, lum = new Float32Array(n);
  for (var i = 0; i < n; i++) {
    var L = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    lum[i] = L; sum += L;
  }
  var mean = sum / n, thr = Math.max(130, mean + 25);
  var rows = new Array(ah).fill(0), cols = new Array(aw).fill(0);
  for (var y = 0; y < ah; y++) {
    for (var x = 0; x < aw; x++) {
      if (lum[y * aw + x] > thr) { rows[y]++; cols[x]++; }
    }
  }
  var y0 = firstAbove_(rows, aw * 0.10), y1 = lastAbove_(rows, aw * 0.10);
  var x0 = firstAbove_(cols, ah * 0.10), x1 = lastAbove_(cols, ah * 0.10);
  if (x0 < 0 || y0 < 0 || x1 <= x0 || y1 <= y0) {
    x0 = aw * 0.1; x1 = aw * 0.9; y0 = ah * 0.1; y1 = ah * 0.9; // fallback: төв 80%
  }
  var px = (x1 - x0) * 0.03, py = (y1 - y0) * 0.03;
  x0 = Math.max(0, x0 - px); x1 = Math.min(aw, x1 + px);
  y0 = Math.max(0, y0 - py); y1 = Math.min(ah, y1 + py);
  var kx = cropState.dispW / aw, ky = cropState.dispH / ah;
  cropState.box = { x: x0 * kx, y: y0 * ky, w: (x1 - x0) * kx, h: (y1 - y0) * ky };
  renderBox();
}
function firstAbove_(arr, t) { for (var i = 0; i < arr.length; i++) if (arr[i] > t) return i; return -1; }
function lastAbove_(arr, t) { for (var i = arr.length - 1; i >= 0; i--) if (arr[i] > t) return i; return -1; }

function renderBox() {
  var b = cropState.box, box = document.getElementById('crop-box');
  box.style.left = b.x + 'px'; box.style.top = b.y + 'px';
  box.style.width = b.w + 'px'; box.style.height = b.h + 'px';
}
function clamp_(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function boxDown(e, mode) {
  e.preventDefault();
  var pt = e.touches ? e.touches[0] : e;
  cropDrag = { mode: mode, sx: pt.clientX, sy: pt.clientY, box: {
    x: cropState.box.x, y: cropState.box.y, w: cropState.box.w, h: cropState.box.h } };
  document.addEventListener('pointermove', boxMove);
  document.addEventListener('pointerup', boxUp);
}
function boxMove(e) {
  if (!cropDrag) return;
  var dx = e.clientX - cropDrag.sx, dy = e.clientY - cropDrag.sy;
  var b = { x: cropDrag.box.x, y: cropDrag.box.y, w: cropDrag.box.w, h: cropDrag.box.h };
  var W = cropState.dispW, H = cropState.dispH, m = cropDrag.mode, MIN = 40;
  if (m === 'move') {
    b.x = clamp_(b.x + dx, 0, W - b.w); b.y = clamp_(b.y + dy, 0, H - b.h);
  } else {
    if (m.indexOf('l') >= 0) { var nx = clamp_(b.x + dx, 0, b.x + b.w - MIN); b.w += (b.x - nx); b.x = nx; }
    if (m.indexOf('r') >= 0) { b.w = clamp_(b.w + dx, MIN, W - b.x); }
    if (m.indexOf('t') >= 0) { var ny = clamp_(b.y + dy, 0, b.y + b.h - MIN); b.h += (b.y - ny); b.y = ny; }
    if (m.indexOf('b') >= 0) { b.h = clamp_(b.h + dy, MIN, H - b.y); }
  }
  cropState.box = b; renderBox();
}
function boxUp() {
  cropDrag = null;
  document.removeEventListener('pointermove', boxMove);
  document.removeEventListener('pointerup', boxUp);
}

function cropConfirm() {
  var b = cropState.box;
  var kx = cropState.natW / cropState.dispW, ky = cropState.natH / cropState.dispH;
  var sx = b.x * kx, sy = b.y * ky, sw = b.w * kx, sh = b.h * ky;
  var maxD = 1500, scale = Math.min(1, maxD / Math.max(sw, sh));
  var ow = Math.max(1, Math.round(sw * scale)), oh = Math.max(1, Math.round(sh * scale));
  var c = document.createElement('canvas'); c.width = ow; c.height = oh;
  c.getContext('2d').drawImage(cropImg, sx, sy, sw, sh, 0, 0, ow, oh);
  var dataUrl = c.toDataURL('image/jpeg', 0.75);
  state.image = dataUrl; state.imageMime = 'image/jpeg';
  var prev = document.getElementById('preview');
  prev.src = dataUrl; prev.style.display = 'block';
  document.getElementById('no-image').style.display = 'none';
  closeCrop();
}
function closeCrop() { document.getElementById('crop-modal').classList.add('hide'); }
function cropRetake() { closeCrop(); document.getElementById('photo').click(); }

/* ==================== QR УНШИЛТ ==================== */
function startScanner() {
  var box = document.getElementById('qr-reader');
  box.style.display = 'block';
  document.getElementById('btn-scan').style.display = 'none';
  scanner = new Html5Qrcode('qr-reader');
  scanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 240, height: 240 } },
    function (text) { onQr(text); },
    function () {}
  ).catch(function (err) {
    toast('Камер нээгдсэнгүй: ' + err);
    stopScanner();
  });
}
function stopScanner() {
  var box = document.getElementById('qr-reader');
  if (scanner) {
    scanner.stop().then(function () { scanner.clear(); }).catch(function () {});
    scanner = null;
  }
  if (box) box.style.display = 'none';
  var b = document.getElementById('btn-scan');
  if (b) b.style.display = '';
}
function onQr(text) {
  state.qrRaw = text;
  stopScanner();
  var d = parseEbarimtQr(text);
  if (d.ddtd) document.getElementById('f-ddtd').value = d.ddtd;
  if (d.date) document.getElementById('f-date').value = d.date;
  document.getElementById('f-source').value = 'ПОС';
  // eBarimt QR-т дүн/ТТД байдаггүй — зөвхөн ДДТД. Бусдыг гараас.
  toast('ДДТД уншигдлаа ✓ Дүн, компанийг гараас оруулна уу.');
}
/* eBarimt QR — олон форматыг оролдоно (бодит баримтаар нарийсгана) */
function parseEbarimtQr(text) {
  var out = { ddtd: '', amount: '', merchantTin: '', customerTin: '', date: '' };
  if (!text) return out;
  // 1) URL хэлбэр бол параметр задлах
  try {
    if (text.indexOf('http') === 0) {
      var u = new URL(text);
      out.ddtd = u.searchParams.get('rno') || u.searchParams.get('ddtd') || out.ddtd;
      out.amount = u.searchParams.get('amount') || u.searchParams.get('amt') || out.amount;
    }
  } catch (e) {}
  // 2) ДДТД — урт тоон дараалал (30–50 орон)
  var m = text.match(/\d{30,50}/);
  if (m && !out.ddtd) out.ddtd = m[0];
  // 3) Огноо YYYY-MM-DD
  var dm = text.match(/(20\d{2})[-/.](\d{2})[-/.](\d{2})/);
  if (dm) out.date = dm[1] + '-' + dm[2] + '-' + dm[3];
  return out;
}

/* ==================== B2B ШАЛГАЛТ (тэмдэглэгээгээр) ==================== */
function checkB2B() {
  if (state.type === 'Гадаад томилолт') { warn(''); return; }
  var box = document.getElementById('f-b2b');
  if (box && !box.checked) {
    warn('⚠ Иргэнд очих баримт дараа тооцоо / дотоод томилолтод хүчингүй байж болзошгүй');
  } else {
    warn('');
  }
}
function warn(msg) {
  var el = document.getElementById('b2b-warn');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

/* ==================== ХАДГАЛАХ (дараалалд) ==================== */
function saveReceipt() {
  var purpose = document.getElementById('f-purpose').value.trim();
  if (!purpose) { toast('Зорилгыг бичнэ үү (жишээ: РСМ зочдын өдрийн хоол)'); return; }
  if (!state.image && !state.qrRaw) { toast('Зураг дарах эсвэл QR уншуулна уу'); return; }

  var rec = {
    localId: 'L' + Date.now() + Math.floor(Math.random() * 999),
    status: 'pending',
    createdAt: new Date().toISOString(),
    payload: {
      action: 'saveReceipt',
      token: CONFIG.API_TOKEN,
      type: state.type,
      purpose: purpose,
      category: document.getElementById('f-category').value,
      receiptDate: document.getElementById('f-date').value,
      company: document.getElementById('f-company').value.trim(),
      merchantTin: document.getElementById('f-mtin').value.trim(),
      ddtd: document.getElementById('f-ddtd').value.trim(),
      amount: document.getElementById('f-amount').value.trim(),
      vat: document.getElementById('f-vat').value.trim(),
      customerTin: document.getElementById('f-ctin').value.trim(),
      isB2B: (state.type !== 'Гадаад томилолт') && document.getElementById('f-b2b').checked,
      source: document.getElementById('f-source').value,
      currency: document.getElementById('f-currency').value,
      rate: document.getElementById('f-rate').value.trim(),
      note: (state.qrRaw ? ('QR: ' + state.qrRaw + ' | ') : '') +
            document.getElementById('f-note').value.trim(),
      imageBase64: state.image || '',
      imageMime: state.imageMime
    }
  };

  dbAdd(rec).then(function () {
    toast('✓ Хадгалагдлаа. ' + (navigator.onLine ? 'Илгээж байна…' : 'Сүлжээ ортол хадгалагдана.'));
    show('screen-home');
    renderQueue();
    syncAll();
  });
}

/* ==================== SYNC ХӨДӨЛГҮҮР ==================== */
var syncing = false;
function syncAll() {
  if (syncing || !navigator.onLine) return;
  syncing = true;
  dbAll().then(function (list) {
    var pend = list.filter(function (r) { return r.status !== 'synced'; });
    return pend.reduce(function (chain, rec) {
      return chain.then(function () { return sendOne(rec); });
    }, Promise.resolve());
  }).then(function () {
    syncing = false; renderQueue(); updateStatus();
  }).catch(function () { syncing = false; renderQueue(); });
}
function sendOne(rec) {
  return fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // CORS preflight-гүй
    body: JSON.stringify(rec.payload),
    redirect: 'follow'
  }).then(function (res) { return res.text(); })
    .then(function (txt) {
      var j = {};
      try { j = JSON.parse(txt); } catch (e) {}
      if (j.ok) { rec.status = 'synced'; rec.serverId = j.id; return dbPut(rec); }
      rec.status = 'error'; rec.error = j.error || 'тодорхойгүй'; return dbPut(rec);
    })
    .catch(function () { /* сүлжээ тасарсан — pending хэвээр */ });
}

/* ==================== ДАРААЛАЛ ХАРУУЛАХ ==================== */
function renderQueue() {
  dbAll().then(function (list) {
    list.sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
    var box = document.getElementById('queue');
    if (!list.length) {
      box.innerHTML = '<div class="empty">Одоогоор баримт алга.<br>Доод товчоор эхний баримтаа нэмээрэй.</div>';
      updateStatus(); return;
    }
    box.innerHTML = list.map(function (r) {
      var p = r.payload;
      var badge = r.status === 'synced'
        ? '<span class="b ok">Илгээгдсэн</span>'
        : (r.status === 'error'
            ? '<span class="b err">Алдаа</span>'
            : '<span class="b wait">Хүлээгдэж буй</span>');
      var amt = p.amount ? Number(p.amount).toLocaleString() + '₮' : '';
      return '<div class="card">' +
        '<div class="row"><span class="tag">' + esc(p.type) + '</span>' + badge + '</div>' +
        '<div class="purpose">' + esc(p.purpose) + '</div>' +
        '<div class="meta">' + esc(p.company || '—') + ' · ' + amt +
        (p.receiptDate ? ' · ' + esc(p.receiptDate) : '') + '</div>' +
        (r.status === 'error' ? '<div class="errmsg">' + esc(r.error) + '</div>' : '') +
        '<div class="acts">' +
          (r.status === 'error' ? '<button class="act retry" onclick="retryRec(\'' + r.localId + '\')">↻ Дахин илгээх</button>' : '') +
          '<button class="act del" onclick="deleteRec(\'' + r.localId + '\')">Устгах</button>' +
        '</div>' +
        '</div>';
    }).join('');
    updateStatus();
  });
}
function deleteRec(id) {
  if (!confirm('Энэ баримтыг устгах уу?')) return;
  dbDel(id).then(function () { toast('Устгагдлаа'); renderQueue(); });
}
function retryRec(id) {
  dbAll().then(function (list) {
    var r = list.filter(function (x) { return x.localId === id; })[0];
    if (!r) return;
    r.status = 'pending'; r.error = '';
    dbPut(r).then(function () { renderQueue(); syncAll(); });
  });
}
function clearErrors() {
  if (!confirm('Бүх алдаатай баримтыг устгах уу?')) return;
  dbAll().then(function (list) {
    var errs = list.filter(function (x) { return x.status === 'error'; });
    return errs.reduce(function (ch, r) {
      return ch.then(function () { return dbDel(r.localId); });
    }, Promise.resolve());
  }).then(function () { toast('Алдаатай баримтууд устгагдлаа'); renderQueue(); });
}
function updateStatus() {
  dbAll().then(function (list) {
    var pend = list.filter(function (r) { return r.status !== 'synced'; }).length;
    var errs = list.filter(function (r) { return r.status === 'error'; }).length;
    var badge = document.getElementById('pending-badge');
    badge.textContent = pend;
    badge.style.display = pend ? 'inline-block' : 'none';
    var clr = document.getElementById('clear-errors');
    if (clr) clr.style.display = errs ? 'inline-block' : 'none';
    var net = document.getElementById('net');
    if (navigator.onLine) { net.textContent = '● Сүлжээнд холбогдсон'; net.className = 'net on'; }
    else { net.textContent = '● Сүлжээгүй — хадгалж байна'; net.className = 'net off'; }
  });
}

/* ==================== ТУСЛАХ ==================== */
function resetCapture() {
  state.image = null; state.qrRaw = '';
  ['f-purpose', 'f-company', 'f-mtin', 'f-ddtd', 'f-amount', 'f-vat', 'f-ctin', 'f-date', 'f-note', 'f-rate']
    .forEach(function (id) { document.getElementById(id).value = ''; });
  document.getElementById('f-category').value = CATEGORIES[0];
  document.getElementById('f-source').value = 'Зураг';
  document.getElementById('f-rate').value = '';
  document.getElementById('f-b2b').checked = true;
  // Огноог өнөөдрөөр автоматаар бөглөх (баримтыг ихэвчлэн тэр өдөр авдаг)
  document.getElementById('f-date').value = todayStr();
  document.getElementById('preview').style.display = 'none';
  document.getElementById('no-image').style.display = 'flex';
  warn('');
}
function todayStr() {
  var d = new Date();
  var m = ('0' + (d.getMonth() + 1)).slice(-2);
  var day = ('0' + d.getDate()).slice(-2);
  return d.getFullYear() + '-' + m + '-' + day;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
var toastTimer;
function toast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.style.display = 'none'; }, 3200);
}

/* ==================== ЭХЛҮҮЛЭХ ==================== */
window.addEventListener('online', function () { updateStatus(); syncAll(); });
window.addEventListener('offline', updateStatus);

document.addEventListener('DOMContentLoaded', function () {
  var verEl = document.getElementById('ver');
  if (verEl) verEl.textContent = APP_VERSION;
  // Type cards
  var tc = document.getElementById('type-cards');
  tc.innerHTML = TYPES.map(function (t, i) {
    return '<button class="typecard t' + i + '" onclick="chooseType(\'' + t + '\')">' +
      '<span class="tc-name">' + t + '</span></button>';
  }).join('');
  // Categories
  var cat = document.getElementById('f-category');
  cat.innerHTML = CATEGORIES.map(function (c) { return '<option>' + c + '</option>'; }).join('');
  // Currencies
  var cur = document.getElementById('f-currency');
  cur.innerHTML = CURRENCIES.map(function (c) { return '<option>' + c + '</option>'; }).join('');
  document.getElementById('f-ctin').addEventListener('input', checkB2B);

  dbOpen().then(function () { renderQueue(); updateStatus(); syncAll(); });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  }
});
