/*************************************************************
 * АГРОМАШТЕХ — Баримт бүртгэл (PWA)
 * app.js — камер, QR, offline дараалал (IndexedDB), автомат sync
 *************************************************************/

/* ============ ⚙️ ТОХИРГОО — ЭНД БӨГЛӨНӨ ============ */
var CONFIG = {
  API_URL:   'ЭНД_EXEC_URL_ТАВЬ',        // ⚠️ Apps Script deploy-ийн /exec URL
  API_TOKEN: 'AGRO-2026-CHANGE-ME',      // ⚠️ backend-ийн API_TOKEN-тэй ЯГ ижил
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
  // Гадаад томилолт бол валют/ханш талбар нээх
  document.getElementById('foreign-fields').style.display =
    (t === 'Гадаад томилолт') ? 'block' : 'none';
  document.getElementById('f-currency').value = (t === 'Гадаад томилолт') ? 'USD' : 'MNT';
  show('screen-capture');
}

/* ==================== КАМЕР — ЗУРАГ ==================== */
function onPhotoPicked(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  compressImage(file, function (dataUrl) {
    state.image = dataUrl;
    state.imageMime = 'image/jpeg';
    var prev = document.getElementById('preview');
    prev.src = dataUrl;
    prev.style.display = 'block';
    document.getElementById('no-image').style.display = 'none';
  });
}
function compressImage(file, cb) {
  var reader = new FileReader();
  reader.onload = function (e) {
    var img = new Image();
    img.onload = function () {
      var max = 1400;
      var w = img.width, h = img.height;
      if (w > max || h > max) {
        if (w > h) { h = Math.round(h * max / w); w = max; }
        else { w = Math.round(w * max / h); h = max; }
      }
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(c.toDataURL('image/jpeg', 0.7));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

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
  if (d.amount) document.getElementById('f-amount').value = d.amount;
  if (d.merchantTin) document.getElementById('f-mtin').value = d.merchantTin;
  if (d.customerTin) document.getElementById('f-ctin').value = d.customerTin;
  if (d.date) document.getElementById('f-date').value = d.date;
  document.getElementById('f-source').value = 'ПОС';
  checkB2B();
  toast('QR уншигдлаа. Талбаруудыг шалгана уу.');
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

/* ==================== B2B ШУУРХАЙ ШАЛГАЛТ ==================== */
function checkB2B() {
  if (state.type === 'Гадаад томилолт') { warn(''); return; }
  var ctin = document.getElementById('f-ctin').value.trim();
  if (!ctin) { warn('⚠ Худалдан авагчийн ТТД алга — "байгууллагад очих" баримт эсэхийг шалга'); return; }
  if (ctin === CONFIG.ORG_TIN) { warn(''); }
  else { warn('⚠ ТТД (' + ctin + ') Агромаштех биш байна — тайланд хүчингүй байж болзошгүй'); }
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
        '</div>';
    }).join('');
    updateStatus();
  });
}
function updateStatus() {
  dbAll().then(function (list) {
    var pend = list.filter(function (r) { return r.status !== 'synced'; }).length;
    var badge = document.getElementById('pending-badge');
    badge.textContent = pend;
    badge.style.display = pend ? 'inline-block' : 'none';
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
  document.getElementById('preview').style.display = 'none';
  document.getElementById('no-image').style.display = 'flex';
  warn('');
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
