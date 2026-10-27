/**
 * Sổ ơi - Giao diện sổ nợ chi tiết, lịch sử đơn (xem/sửa/xoá/khôi phục), cài đặt giọng nói + cỡ chữ.
 * Mọi thay đổi dữ liệu đi qua SooiCore.
 */
(function () {
  'use strict';

  function esc(s) { return escHtml(s); }
  function vnd(n) { return formatVND(Math.round(n || 0)); }
  function S() { db.settings = db.settings || {}; return db.settings; }
  function $(id) { return document.getElementById(id); }
  function cust(id) { return db.customers.find(function (c) { return c.id === id; }) || null; }
  function afterChange() { saveDB(); refreshAllScreens(); }
  var PAY = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', debt: 'Ghi nợ', partial: 'Trả một phần' };

  /* ---------------- hộp nhập liệu / xác nhận trong app (không dùng prompt() native) ---------------- */
  function overlay(html) {
    var el = $('sooi-dialog');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sooi-dialog';
      el.className = 'fixed inset-0 z-[90] flex items-center justify-center bg-black/55 hidden';
      document.body.appendChild(el);
    }
    el.innerHTML = '<div class="w-[90%] max-w-[380px] bg-white rounded-3xl p-5 shadow-2xl">' + html + '</div>';
    el.classList.remove('hidden');
    return el;
  }
  function closeDialog() { var el = $('sooi-dialog'); if (el) el.classList.add('hidden'); }
  window.sooiPrompt = function (title, label, def, cb, numeric) {
    overlay('<div class="text-[18px] font-extrabold text-slate-900">' + esc(title) + '</div><div class="text-[14px] text-slate-500 mt-1">' + esc(label) + '</div>' +
      '<input id="sooi-dialog-input" type="text" ' + (numeric ? 'inputmode="numeric"' : '') + ' value="' + esc(def == null ? '' : def) + '" class="mt-3 w-full px-3 py-3 border border-slate-300 rounded-xl text-[18px] font-bold" />' +
      '<div class="grid grid-cols-2 gap-2 mt-4"><button id="sooi-dialog-no" class="py-3 rounded-xl bg-slate-100 text-slate-700 font-bold text-[16px]">Hủy</button><button id="sooi-dialog-yes" class="py-3 rounded-xl bg-[#0B7A60] text-white font-bold text-[16px]">OK</button></div>');
    $('sooi-dialog-no').onclick = closeDialog;
    $('sooi-dialog-yes').onclick = function () { var v = $('sooi-dialog-input').value; closeDialog(); cb(v); };
    setTimeout(function () { var i = $('sooi-dialog-input'); if (i) i.focus(); }, 50);
  };
  window.sooiConfirm = function (title, msg, okLabel, cb, danger) {
    overlay('<div class="text-[18px] font-extrabold text-slate-900">' + esc(title) + '</div><div class="text-[15px] text-slate-600 mt-2 leading-relaxed">' + esc(msg) + '</div>' +
      '<div class="grid grid-cols-2 gap-2 mt-4"><button id="sooi-dialog-no" class="py-3 rounded-xl bg-slate-100 text-slate-700 font-bold text-[16px]">Không</button><button id="sooi-dialog-yes" class="py-3 rounded-xl ' + (danger ? 'bg-red-600' : 'bg-[#0B7A60]') + ' text-white font-bold text-[16px]">' + esc(okLabel) + '</button></div>');
    $('sooi-dialog-no').onclick = closeDialog;
    $('sooi-dialog-yes').onclick = function () { closeDialog(); cb(); };
  };
  function num(v) { var n = parseInt(String(v).replace(/[^\d]/g, '') || '0', 10); return n; }

  /* ---------------- khung sheet dùng lại ---------------- */
  function ensureSheets() {
    if ($('ledger-sheet-backdrop')) return;
    sooiEnsureModals();
    var names = [['ledger-sheet', 'Sổ nợ khách'], ['order-sheet', 'Chi tiết giao dịch'], ['orders-sheet', 'Lịch sử đơn hàng']];
    var wrap = document.createElement('div');
    wrap.innerHTML = names.map(function (n) {
      return '<div id="' + n[0] + '-backdrop" class="fixed inset-0 bg-black/50 z-[60] opacity-0 pointer-events-none transition-opacity duration-300 flex items-end justify-center">' +
        '<div id="' + n[0] + '-panel" class="w-full max-w-[430px] bg-white rounded-t-[28px] max-h-[92vh] flex flex-col translate-y-full transition-transform duration-300 p-5 shadow-2xl">' +
        '<div class="flex items-center justify-between pb-3 border-b border-slate-100"><h3 id="' + n[0] + '-title" class="text-[19px] font-extrabold text-slate-900">' + n[1] + '</h3>' +
        '<button onclick="sooiCloseSheet(\'' + n[0] + '\')" class="w-9 h-9 rounded-full bg-slate-100 text-slate-500 font-bold text-[18px]">×</button></div>' +
        '<div id="' + n[0] + '-body" class="pt-3 overflow-y-auto flex-1"></div></div></div>';
    }).join('');
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
  }

  /* ---------------- Sổ nợ chi tiết của 1 khách ---------------- */
  window.openDebtLedger = function (id) {
    ensureSheets();
    var c = cust(id); if (!c) return;
    var L = SooiCore.customerLedger(db, id);
    var html = '<div class="p-3 rounded-2xl bg-slate-50 border border-slate-200"><div class="text-[19px] font-extrabold">' + esc(c.name) + '</div>' +
      '<div class="text-[13px] text-slate-500">' + esc(c.phone || 'Chưa lưu SĐT') + (c.nickname ? ' · Biệt danh: ' + esc(c.nickname) : '') + ' · mã ' + esc(String(c.id).slice(-6)) + '</div>' +
      '<div class="grid grid-cols-3 gap-2 mt-2 text-center"><div><div class="text-[12px] text-slate-500">Tổng nợ phát sinh</div><div class="text-[15px] font-black">' + vnd(L.debtTotal) + '</div></div>' +
      '<div><div class="text-[12px] text-slate-500">Đã trả</div><div class="text-[15px] font-black text-[#0B7A60]">' + vnd(L.paidTotal) + '</div></div>' +
      '<div><div class="text-[12px] text-slate-500">Còn thiếu</div><div class="text-[17px] font-black text-red-600">' + vnd(L.remaining) + '</div></div></div>' +
      '<div class="grid grid-cols-3 gap-1.5 mt-3"><button onclick="sooiCloseSheet(\'ledger-sheet\');debtCollectFor(\'' + id + '\')" class="py-2.5 rounded-xl bg-[#0B7A60] text-white font-bold text-[14px]">Thu nợ</button>' +
      '<button onclick="promptAdjustDebt(\'' + id + '\')" class="py-2.5 rounded-xl bg-amber-100 text-amber-800 font-bold text-[14px]">Sửa nợ</button>' +
      '<button onclick="editCustomerInfo(\'' + id + '\')" class="py-2.5 rounded-xl bg-slate-100 text-slate-700 font-bold text-[14px]">Sửa thông tin</button></div></div>';
    html += '<div class="text-[15px] font-extrabold mt-3 mb-1">Lịch sử</div>';
    if (!L.rows.length) html += '<div class="text-[14px] text-slate-400">Chưa có giao dịch nào.</div>';
    html += L.rows.map(function (l) {
      var isPay = l.type === 'payment';
      var label = l.type === 'payment' ? 'Khách trả nợ' : (l.type === 'adjust' ? 'Điều chỉnh' : (l.type === 'opening' ? 'Nợ cũ' : 'Mua thiếu'));
      var items = (l.items || []).map(function (i) { return esc(i.name) + ' ×' + i.qty + ' (' + vnd(i.price) + ')'; }).join(', ');
      return '<div class="p-2.5 rounded-xl border border-slate-200 mb-1.5"><div class="flex justify-between gap-2"><div><div class="text-[14px] font-bold ' + (isPay ? 'text-[#0B7A60]' : 'text-slate-900') + '">' + label + '</div><div class="text-[12px] text-slate-400">' + esc(l.date) + ' ' + esc(l.time || '') + '</div></div>' +
        '<div class="text-[16px] font-black ' + (isPay ? 'text-[#0B7A60]' : (l.amount < 0 ? 'text-[#0B7A60]' : 'text-red-600')) + '">' + (isPay ? '−' : (l.amount < 0 ? '' : '+')) + vnd(Math.abs(l.amount)) + '</div></div>' +
        (items ? '<div class="text-[13px] text-slate-600 mt-1">' + items + '</div>' : '') + (l.note ? '<div class="text-[12px] text-slate-400">' + esc(l.note) + '</div>' : '') +
        (l.orderId ? '<button onclick="openOrderDetail(\'' + esc(l.orderId) + '\')" class="mt-1 text-[13px] font-bold text-[#0B7A60] underline">Xem đơn ' + esc(l.orderId) + '</button>' : '') + '</div>';
    }).join('');
    $('ledger-sheet-body').innerHTML = html;
    sooiOpenSheet('ledger-sheet');
  };

  window.promptAdjustDebt = function (id) {
    var c = cust(id); if (!c) return;
    var cur = Math.max(0, SooiCore.ledgerSum(db, id));
    sooiPrompt('Sửa số nợ của ' + c.name, 'Số nợ hiện tại là ' + vnd(cur) + '. Nhập số nợ ĐÚNG (Sổ ghi lại lịch sử, không đụng tiền mặt):', cur, function (v) {
      var n = num(v);
      var target = n > 0 && n < 1000 ? n * 1000 : n;
      var delta = target - SooiCore.ledgerSum(db, id);
      if (!delta) return;
      var r = SooiCore.adjustDebt(db, { customerId: id, delta: delta, note: 'Sửa số nợ: ' + vnd(cur) + ' → ' + vnd(target) });
      if (!r.ok) { notifyAndroid(r.error || 'Không sửa được'); return; }
      afterChange(); notifyAndroid('Đã sửa số nợ của ' + c.name);
      if ($('ledger-sheet-panel').classList.contains('translate-y-0')) openDebtLedger(id);
      if ($('debt-sheet-panel') && $('debt-sheet-panel').classList.contains('translate-y-0')) showDebtSheet(null);
    }, true);
  };

  window.editCustomerInfo = function (id) {
    var c = cust(id); if (!c) return;
    sooiPrompt('Số điện thoại', 'SĐT của ' + c.name, c.phone || '', function (ph) {
      c.phone = String(ph || '').trim();
      sooiPrompt('Biệt danh', 'Các cách gọi khác, cách nhau dấu ; (vd: Dì Sáu bán rau; Sáu rau)', c.nickname || '', function (nk) {
        c.nickname = String(nk || '').trim(); afterChange(); openDebtLedger(id);
      });
    });
  };

  /* ---------------- Danh sách / chi tiết đơn ---------------- */
  window.openOrdersList = function (filter) {
    ensureSheets();
    var q = SooiCore.fold(filter || '');
    var rows = db.orders.filter(function (o) { return !q || SooiCore.fold(o.id + ' ' + o.customerName + ' ' + o.items.map(function (i) { return i.name; }).join(' ')).indexOf(q) >= 0; }).slice(0, 80);
    var html = '<input type="text" value="' + esc(filter || '') + '" placeholder="Tìm theo tên khách, món, mã đơn" onchange="openOrdersList(this.value)" class="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-[15px] mb-2" />';
    if (!rows.length) html += '<div class="py-8 text-center text-slate-400 text-[15px]">Chưa có đơn nào.</div>';
    html += rows.map(function (o) {
      return '<button onclick="openOrderDetail(\'' + esc(o.id) + '\')" class="w-full text-left p-3 rounded-2xl border border-slate-200 bg-white mb-2 active:bg-slate-50">' +
        '<div class="flex justify-between"><b class="text-[15px]">' + esc(o.id) + '</b><b class="text-[16px] text-[#0B7A60]">' + vnd(o.total) + '</b></div>' +
        '<div class="text-[13px] text-slate-500">' + esc(o.date) + ' ' + esc(o.time || '') + ' · ' + esc(o.customerName) + ' · ' + esc(PAY[o.paymentMethod] || o.paymentMethod) + (o.owed > 0 ? ' · còn nợ ' + vnd(o.owed) : '') + '</div>' +
        '<div class="text-[13px] text-slate-700 mt-0.5 truncate">' + o.items.map(function (i) { return esc(i.name) + ' ×' + i.quantity; }).join(', ') + '</div></button>';
    }).join('');
    var del = (db.orderAudit || []).filter(function (a) { return a.action === 'delete' && !db.orders.some(function (o) { return o.id === a.orderId; }); }).slice(0, 10);
    if (del.length) {
      html += '<div class="text-[15px] font-extrabold mt-3 mb-1">Đơn đã xoá (có thể khôi phục)</div>' + del.map(function (a) {
        return '<div class="p-2.5 rounded-xl border border-red-200 bg-red-50 mb-1.5 flex items-center justify-between"><div class="text-[13px]"><b>' + esc(a.orderId) + '</b> · ' + vnd(a.before.total) + '<div class="text-slate-500">' + esc(a.at.slice(0, 16).replace('T', ' ')) + '</div></div>' +
          '<button onclick="restoreAudit(\'' + a.id + '\')" class="px-3 py-2 rounded-lg bg-white text-[#0B7A60] font-bold text-[13px] border border-[#0B7A60]">Khôi phục</button></div>';
      }).join('');
    }
    $('orders-sheet-body').innerHTML = html;
    sooiOpenSheet('orders-sheet');
  };

  window.restoreAudit = function (auditId) {
    var r = SooiCore.restoreFromAudit(db, auditId);
    if (!r.ok) { notifyAndroid(r.error || 'Không khôi phục được'); return; }
    afterChange(); notifyAndroid('Đã khôi phục đơn');
    if (r.order) openOrderDetail(r.order.id);
  };

  var oe = null;   // trạng thái sửa đơn

  window.openOrderDetail = function (orderId) {
    ensureSheets();
    var o = db.orders.find(function (x) { return x.id === orderId; });
    if (!o) {
      // dòng thu chi cũ chưa gắn mã đơn: thử tìm theo "đơn #N"
      var m = /#(\d+)/.exec(orderId || ''); if (m) o = db.orders.find(function (x) { return String(x.orderNumber) === m[1]; });
      if (!o) { notifyAndroid('Không tìm thấy đơn này'); return; }
    }
    oe = null;
    var html = '<div class="p-3 rounded-2xl bg-slate-50 border border-slate-200"><div class="flex justify-between"><b class="text-[17px]">' + esc(o.id) + '</b><span class="text-[13px] text-slate-500">' + esc(o.date) + ' ' + esc(o.time || '') + '</span></div>' +
      '<div class="text-[15px] mt-1">Khách: <b>' + esc(o.customerName) + '</b></div>' +
      '<div class="text-[14px] mt-0.5">Thanh toán: <b>' + esc(PAY[o.paymentMethod] || o.paymentMethod) + '</b> · <span class="font-bold ' + (o.owed > 0 || o.status === 'Chờ chuyển khoản' ? 'text-red-600' : 'text-[#0B7A60]') + '">' + esc(o.status) + '</span></div>' +
      (o.heard ? '<div class="text-[12px] text-slate-400 mt-1">Sổ nghe: “' + esc(o.heard) + '”</div>' : '') +
      (o.editedAt ? '<div class="text-[12px] text-amber-700 mt-0.5">Đã sửa lần ' + o.revision + ' (' + esc(String(o.editedAt).slice(0, 16).replace('T', ' ')) + ')</div>' : '') + '</div>';
    html += '<div class="mt-3 space-y-1.5">' + o.items.map(function (i) {
      var disc = !i.gift && i.listPrice && i.price !== i.listPrice;
      return '<div class="p-2.5 rounded-xl border ' + (i.gift ? 'border-amber-200 bg-amber-50' : 'border-slate-200') + '"><div class="flex justify-between gap-2"><div class="text-[15px] font-bold">' + esc(i.name) + (i.adHoc ? ' <span class="text-[11px] px-1.5 rounded bg-slate-200">bán 1 lần</span>' : '') + '</div><div class="text-[15px] font-black">' + vnd(i.price * i.quantity) + '</div></div>' +
        '<div class="text-[13px] text-slate-600">' + i.quantity + (i.unit ? ' ' + esc(i.unit) : '') + ' × ' + vnd(i.price) + (disc ? ' <s class="text-slate-400">' + vnd(i.listPrice) + '</s> <b class="text-amber-700">giảm ' + vnd(i.listPrice - i.price) + '/cái</b>' : '') +
        (i.gift ? ' · <b class="text-amber-700">QUÀ TẶNG 0đ</b>' : '') + (i.note && !i.gift ? ' · ' + esc(i.note) : '') + '</div></div>';
    }).join('') + '</div>';
    html += '<div class="mt-3 p-3 rounded-2xl bg-[#ECFBF2] border border-[#B9E9D7] text-[15px] space-y-1">' +
      (o.discount > 0 ? '<div class="flex justify-between"><span>Giá niêm yết</span><b>' + vnd(o.listTotal) + '</b></div><div class="flex justify-between text-amber-800"><span>Tổng giảm</span><b>−' + vnd(o.discount) + '</b></div>' : '') +
      '<div class="flex justify-between text-[18px]"><span class="font-bold">Tổng tiền</span><b class="text-[#0B7A60]">' + vnd(o.total) + '</b></div>' +
      '<div class="flex justify-between"><span>Tiền đã thu</span><b>' + vnd(o.paid) + '</b></div>' +
      '<div class="flex justify-between"><span>Còn nợ</span><b class="' + (o.owed > 0 ? 'text-red-600' : '') + '">' + vnd(o.owed) + '</b></div>' +
      '<div class="flex justify-between text-[13px] text-slate-500"><span>Giá vốn</span><span>' + vnd(o.cost) + '</span></div></div>';
    html += '<div class="grid grid-cols-2 gap-2 mt-3">' +
      '<button onclick="orderStartEdit(\'' + esc(o.id) + '\')" class="py-3 rounded-xl bg-amber-100 text-amber-900 font-bold text-[15px]">Sửa giao dịch</button>' +
      '<button onclick="orderDelete(\'' + esc(o.id) + '\')" class="py-3 rounded-xl bg-red-50 text-red-600 font-bold text-[15px]">Xoá đơn</button>' +
      (o.paymentMethod === 'transfer' && !o.transferConfirmed ? '<button onclick="orderConfirmTransfer(\'' + esc(o.id) + '\')" class="col-span-2 py-3 rounded-xl bg-[#0B7A60] text-white font-bold text-[15px]">Đã nhận chuyển khoản</button>' : '') + '</div>';
    var au = (db.orderAudit || []).filter(function (a) { return a.orderId === o.id && a.action === 'edit'; }).slice(0, 5);
    if (au.length) {
      html += '<div class="text-[14px] font-extrabold mt-3 mb-1">Nhật ký chỉnh sửa</div>' + au.map(function (a) {
        return '<div class="p-2 rounded-xl border border-slate-200 mb-1.5 text-[13px]"><div class="text-slate-500">' + esc(a.at.slice(0, 16).replace('T', ' ')) + '</div>' +
          '<div>Trước: <b>' + vnd(a.before.total) + '</b> (' + esc(PAY[a.before.paymentMethod] || '') + ', nợ ' + vnd(a.before.owed) + ') → Sau: <b>' + vnd(a.after.total) + '</b> (' + esc(PAY[a.after.paymentMethod] || '') + ', nợ ' + vnd(a.after.owed) + ')</div>' +
          '<button onclick="restoreAudit(\'' + a.id + '\')" class="mt-1 text-[#0B7A60] font-bold underline">Khôi phục bản trước khi sửa</button></div>';
      }).join('');
    }
    $('order-sheet-body').innerHTML = html;
    sooiOpenSheet('order-sheet');
  };

  window.orderConfirmTransfer = function (id) {
    var r = SooiCore.confirmTransfer(db, id);
    if (!r.ok) { notifyAndroid(r.error); return; }
    afterChange();
    if (!r.duplicate) { showTxResult({ kind: 'transfer', title: 'ĐÃ NHẬN CHUYỂN KHOẢN', amount: r.order.total, sub: 'Đơn ' + id }); sooiAnnounce('Đã nhận chuyển khoản ' + (typeof formatMoneyToSpeech === 'function' ? formatMoneyToSpeech(r.order.total) : r.order.total) + ' đồng.'); }
    openOrderDetail(id);
  };

  window.orderDelete = function (id) {
    sooiConfirm('Xoá đơn ' + id + '?', 'Sổ sẽ hoàn lại tồn kho, thu chi và công nợ của đơn này. Bạn vẫn khôi phục được trong Lịch sử đơn hàng.', 'Xoá đơn', function () {
      var r = SooiCore.deleteOrder(db, id, 'Người dùng xoá');
      if (!r.ok) { notifyAndroid(r.error); return; }
      afterChange(); sooiCloseSheet('order-sheet'); notifyAndroid('Đã xoá đơn ' + id + ' (có thể khôi phục)');
    }, true);
  };

  /* ---------------- Sửa đơn đã lưu ---------------- */
  window.orderStartEdit = function (id) {
    var o = db.orders.find(function (x) { return x.id === id; }); if (!o) return;
    oe = { id: id, items: o.items.map(function (i) { return { productId: i.productId, name: i.name, qty: i.quantity, unit: i.unit, price: i.price, listPrice: i.listPrice, gift: i.gift, cost: i.cost }; }),
      payment: o.paymentMethod, paid: o.paid, customerId: o.customerId, customerName: o.customerName };
    renderOrderEdit();
  };
  function renderOrderEdit() {
    var html = '<div class="text-[16px] font-extrabold mb-2">Sửa ' + esc(oe.id) + '</div>';
    html += oe.items.map(function (i, k) {
      return '<div class="p-2.5 rounded-xl border border-slate-200 mb-1.5"><div class="flex justify-between"><b class="text-[14px]">' + esc(i.name) + (i.gift ? ' 🎁' : '') + '</b><button onclick="oeRemove(' + k + ')" class="w-8 h-8 rounded-full bg-red-50 text-red-500 font-bold">×</button></div>' +
        '<div class="grid grid-cols-2 gap-2 mt-1"><div><div class="text-[11px] text-slate-500">Số lượng</div><input type="number" step="any" value="' + i.qty + '" onchange="oeSet(' + k + ',\'qty\',this.value)" class="w-full px-2 py-2 border border-slate-300 rounded-lg text-[16px] font-bold" /></div>' +
        '<div><div class="text-[11px] text-slate-500">Đơn giá</div><input type="text" inputmode="numeric" value="' + Math.round(i.price).toLocaleString('vi-VN') + '" ' + (i.gift ? 'disabled' : '') + ' onchange="oeSet(' + k + ',\'price\',this.value)" class="w-full px-2 py-2 border border-slate-300 rounded-lg text-[16px] font-bold" /></div></div></div>';
    }).join('');
    html += '<div class="text-[12px] font-bold text-slate-500 mt-2 mb-1">Hình thức thanh toán</div><div class="grid grid-cols-2 gap-1.5">' + ['cash', 'transfer', 'debt', 'partial'].map(function (m) {
      return '<button onclick="oeSetPay(\'' + m + '\')" class="py-2.5 rounded-xl text-[14px] font-bold border ' + (oe.payment === m ? 'bg-[#0B7A60] text-white border-[#0B7A60]' : 'bg-white text-slate-700 border-slate-300') + '">' + PAY[m] + '</button>';
    }).join('') + '</div>';
    if (oe.payment === 'partial') html += '<input type="text" inputmode="numeric" value="' + (oe.paid ? Number(oe.paid).toLocaleString('vi-VN') : '') + '" onchange="oeSetPaid(this.value)" placeholder="Khách trả trước" class="mt-1.5 w-full px-2 py-2 border border-slate-300 rounded-lg text-[16px] font-bold" />';
    html += '<div class="text-[12px] font-bold text-slate-500 mt-2 mb-1">Khách</div><select onchange="oeSetCust(this.value)" class="w-full px-2 py-2.5 border border-slate-300 rounded-xl text-[15px]"><option value="">Khách vãng lai</option>' +
      db.customers.map(function (c) { return '<option value="' + c.id + '"' + (c.id === oe.customerId ? ' selected' : '') + '>' + esc(c.name + (c.phone ? ' · ' + c.phone : '')) + '</option>'; }).join('') + '</select>';
    html += '<div class="grid grid-cols-2 gap-2 mt-4"><button onclick="openOrderDetail(\'' + esc(oe.id) + '\')" class="py-3 rounded-xl bg-slate-100 text-slate-700 font-bold text-[15px]">Hủy sửa</button><button onclick="orderSaveEdit()" class="py-3 rounded-xl bg-[#0B7A60] text-white font-bold text-[15px]">Lưu thay đổi</button></div>';
    $('order-sheet-body').innerHTML = html;
  }
  window.oeSet = function (k, f, v) { var i = oe.items[k]; if (f === 'qty') { var n = parseFloat(String(v).replace(',', '.')); i.qty = n > 0 ? n : i.qty; } else { var p = num(v); if (p > 0 && p < 1000) p *= 1000; i.price = p; } renderOrderEdit(); };
  window.oeRemove = function (k) { oe.items.splice(k, 1); renderOrderEdit(); };
  window.oeSetPay = function (m) { oe.payment = m; if (m !== 'partial') oe.paid = null; renderOrderEdit(); };
  window.oeSetPaid = function (v) { var p = num(v); if (p > 0 && p < 1000) p *= 1000; oe.paid = p; renderOrderEdit(); };
  window.oeSetCust = function (v) { var c = cust(v); oe.customerId = v || null; oe.customerName = c ? c.name : 'Khách vãng lai'; renderOrderEdit(); };
  window.orderSaveEdit = function () {
    if (!oe) return;
    if (!oe.items.length) { notifyAndroid('Đơn không còn món nào. Nếu muốn bỏ đơn, hãy bấm Xoá đơn.'); return; }
    var patch = { items: oe.items, payment: oe.payment, paid: oe.paid, customerId: oe.customerId, customerName: oe.customerName };
    var r = SooiCore.editOrder(db, oe.id, patch, 'Người dùng sửa');
    if (!r.ok) { notifyAndroid(r.error || 'Không lưu được thay đổi (dữ liệu giữ nguyên)'); return; }
    var id = oe.id; oe = null;
    afterChange(); notifyAndroid('Đã sửa đơn ' + id); openOrderDetail(id);
  };

  /* ---------------- Mã QR: xác nhận đã nhận tiền ---------------- */
  window.installTransferConfirm = function (orderId) { window.currentQrOrderRef = orderId; };

  /* ---------------- Cài đặt: Giọng nói + Hiển thị ---------------- */
  var FONT = { normal: 100, large: 120, xlarge: 140 };
  window.applyFontSize = function () {
    var level = S().fontSize || 'normal';
    var pct = FONT[level] || 100;
    document.documentElement.setAttribute('data-font', level);
    try {
      if (window.AndroidBridge && typeof AndroidBridge.setTextZoom === 'function') AndroidBridge.setTextZoom(pct);
      else document.documentElement.style.fontSize = (pct / 100 * 16) + 'px';
    } catch (e) { /* bỏ qua */ }
  };

  function radioRow(group, value, label, current, handler) {
    var on = String(current) === String(value);
    return '<button type="button" onclick="' + handler + '" class="w-full text-left px-3 py-3 rounded-xl border ' + (on ? 'border-[#0B7A60] bg-[#ECFBF2]' : 'border-slate-200 bg-white') + ' flex items-center gap-2">' +
      '<span class="w-5 h-5 rounded-full border-2 ' + (on ? 'border-[#0B7A60] bg-[#0B7A60]' : 'border-slate-300') + ' shrink-0"></span><span class="text-[14px] font-bold text-slate-800">' + label + '</span></button>';
  }

  window.installSettingsExtras = function () {
    var anchor = document.querySelector('button[onclick="saveShopSettings()"]');
    if (!anchor) return;
    var box = $('settings-extras');
    if (!box) {
      box = document.createElement('div');
      box.id = 'settings-extras';
      box.className = 'space-y-3 pt-3 border-t border-slate-100';
      anchor.parentNode.insertBefore(box, anchor);
    }
    var s = S();
    var mode = s.confirmMode || 'manual';
    var secs = s.autoSeconds || 5;
    var vol = s.ttsVolume != null ? s.ttsVolume : 1;
    var font = s.fontSize || 'normal';
    box.innerHTML =
      '<div><div class="text-[14px] font-extrabold text-slate-900 mb-1.5">Giọng nói — Chế độ xác nhận</div><div class="space-y-1.5">' +
      radioRow('cm', 'voice', '1. Nói “đúng rồi” để xác nhận (Sổ đọc đơn rồi nghe bạn trả lời)', mode, "setConfirmMode('voice')") +
      radioRow('cm', 'manual', '2. Sổ đọc đơn, bạn bấm Xác nhận / Sửa / Hủy', mode, "setConfirmMode('manual')") +
      radioRow('cm', 'auto', '3. Tự động lưu sau vài giây (có thể bấm Sửa/Hủy)', mode, "setConfirmMode('auto')") + '</div>' +
      (mode === 'auto' ? '<div class="mt-1.5 flex items-center gap-2"><span class="text-[13px] text-slate-600">Đếm ngược</span>' + [3, 5, 8].map(function (n) { return '<button type="button" onclick="setAutoSeconds(' + n + ')" class="px-3 py-2 rounded-lg border text-[14px] font-bold ' + (Number(secs) === n ? 'bg-[#0B7A60] text-white border-[#0B7A60]' : 'bg-white border-slate-300') + '">' + n + ' giây</button>'; }).join('') + '</div>' : '') +
      '<div class="mt-2"><div class="text-[12.5px] font-bold text-slate-600 mb-1">Âm lượng giọng đọc: ' + Math.round(vol * 100) + '%</div><input type="range" min="0" max="100" value="' + Math.round(vol * 100) + '" onchange="setTtsVolume(this.value)" class="w-full" /></div></div>' +
      '<div><div class="text-[14px] font-extrabold text-slate-900 mb-1.5">Hiển thị — Cỡ chữ</div><div class="grid grid-cols-3 gap-1.5">' +
      [['normal', 'Bình thường'], ['large', 'Chữ lớn'], ['xlarge', 'Chữ rất lớn']].map(function (f) { return '<button type="button" onclick="setFontSize(\'' + f[0] + '\')" class="py-3 rounded-xl border text-[13px] font-bold ' + (font === f[0] ? 'bg-[#0B7A60] text-white border-[#0B7A60]' : 'bg-white text-slate-700 border-slate-300') + '">' + f[1] + '</button>'; }).join('') + '</div></div>' +
      '<div class="grid grid-cols-1 gap-1.5"><button type="button" onclick="openVoiceLearned()" class="py-2.5 rounded-xl bg-slate-100 text-slate-800 font-bold text-[13.5px]">Từ Sổ đã học (xem / sửa / xoá)</button>' +
      '<button type="button" onclick="openOrdersList()" class="py-2.5 rounded-xl bg-slate-100 text-slate-800 font-bold text-[13.5px]">Lịch sử đơn hàng (xem / sửa / khôi phục)</button></div>';
  };
  window.setConfirmMode = function (m) { S().confirmMode = m; saveDB(); installSettingsExtras(); };
  window.setAutoSeconds = function (n) { S().autoSeconds = n; saveDB(); installSettingsExtras(); };
  window.setTtsVolume = function (v) { S().ttsVolume = Math.max(0, Math.min(1, Number(v) / 100)); saveDB(); installSettingsExtras(); };
  window.setFontSize = function (f) { S().fontSize = f; saveDB(); applyFontSize(); installSettingsExtras(); };

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () { installSettingsExtras(); applyFontSize(); }, 0);
  });
})();
