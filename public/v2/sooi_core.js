/**
 * Sổ ơi - Lớp dữ liệu lõi (không đụng DOM, chạy được trong WebView lẫn node để test).
 *
 * Mọi thao tác tiền bạc đều đi qua đây để đảm bảo:
 *  - Ghi nợ KHÔNG bao giờ cộng vào tiền mặt đã thu.
 *  - Mỗi giao dịch có clientTxId -> bấm xác nhận 2 lần không tạo đơn trùng.
 *  - Sửa / xoá đơn: hoàn lại kho, thu chi, công nợ của bản cũ rồi áp bản mới (không cộng/trừ lặp).
 *  - Có nhật ký trước/sau (db.orderAudit) để khôi phục.
 *
 * db = { products, customers, cashFlows, orders, debtLedger, orderAudit, processedTx, settings }
 */
(function (root) {
  'use strict';

  var round = function (n) { return Math.round(Number(n) || 0); };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function localDate(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function localTime(d) { d = d || new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  var seq = 0;
  function newId(prefix) { seq++; return prefix + '_' + Date.now().toString(36) + '_' + seq + Math.floor(Math.random() * 1296).toString(36); }

  function fold(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /* ---------------------------------------------------------------- */
  /* Khởi tạo + migration (không xoá dữ liệu cũ)                        */
  /* ---------------------------------------------------------------- */
  function ensureDb(db) {
    db.products = db.products || [];
    db.customers = db.customers || [];
    db.cashFlows = db.cashFlows || [];
    db.orders = db.orders || [];
    db.debtLedger = db.debtLedger || [];
    db.orderAudit = db.orderAudit || [];
    db.processedTx = db.processedTx || [];
    db.settings = db.settings || {};
    // Khách đang có nợ nhưng chưa có sổ chi tiết -> tạo 1 dòng "nợ cũ" để tổng không đổi
    db.customers.forEach(function (c) {
      var has = db.debtLedger.some(function (l) { return l.customerId === c.id; });
      if (!has && (c.debt || 0) > 0) {
        db.debtLedger.push({
          id: newId('dl'), customerId: c.id, type: 'opening', amount: round(c.debt),
          date: localDate(), time: localTime(), note: 'Nợ cũ trước khi dùng sổ chi tiết', items: []
        });
      }
    });
    // Tổng nợ trên hồ sơ khách (có thể do đồng bộ đám mây / bản cũ) lệch sổ chi tiết -> thêm dòng điều chỉnh, KHÔNG xoá gì
    db.customers.forEach(function (c) {
      var sum = ledgerSum(db, c.id);
      var debt = Math.round(Number(c.debt) || 0);
      if (sum !== debt && db.debtLedger.some(function (l) { return l.customerId === c.id; })) {
        db.debtLedger.push({ id: newId('dl'), customerId: c.id, type: 'adjust', amount: debt - sum,
          date: localDate(), time: localTime(), note: 'Đối chiếu số nợ (đồng bộ/dữ liệu cũ)', items: [] });
      }
    });
    return db;
  }

  function ledgerSum(db, customerId) {
    return db.debtLedger.reduce(function (s, l) {
      if (l.customerId !== customerId) return s;
      return s + (l.type === 'payment' ? -l.amount : l.amount);
    }, 0);
  }
  function syncDebt(db, customerId) {
    var c = db.customers.find(function (x) { return x.id === customerId; });
    if (c) c.debt = ledgerSum(db, customerId);
  }

  /* ---------------------------------------------------------------- */
  /* Khách hàng (có mã định danh, không gộp khách trùng tên)             */
  /* ---------------------------------------------------------------- */
  function findCustomersByName(db, name) {
    var key = fold(String(name || '').split('(')[0]);
    if (!key) return [];
    return db.customers.filter(function (c) {
      return fold(c.name) === fold(name) || fold(String(c.name).split('(')[0]) === key ||
        fold(c.nickname || '') === key;
    });
  }
  function addCustomer(db, info) {
    var c = { id: newId('c'), name: String(info.name || '').trim(), nickname: info.nickname || '', phone: info.phone || '', debt: 0, memo: info.memo || '' };
    if (!c.name) return null;
    db.customers.push(c);
    return c;
  }
  /** Trả về {customer} | {ambiguous:[...]} | {none:true} */
  function resolveCustomer(db, ref) {
    if (ref && ref.customerId) {
      var byId = db.customers.find(function (c) { return c.id === ref.customerId; });
      return byId ? { customer: byId } : { none: true };
    }
    var name = ref && ref.customerName;
    if (!name) return { none: true };
    var m = findCustomersByName(db, name);
    if (m.length === 1) return { customer: m[0] };
    if (m.length > 1) return { ambiguous: m };
    return { none: true };
  }

  /* ---------------------------------------------------------------- */
  /* Chuẩn hoá dòng hàng                                                */
  /* ---------------------------------------------------------------- */
  function normItems(db, items) {
    var out = [];
    for (var i = 0; i < (items || []).length; i++) {
      var it = items[i];
      var qty = Number(it.qty != null ? it.qty : it.quantity);
      if (!(qty > 0)) return { error: 'Số lượng dòng ' + (i + 1) + ' không hợp lệ' };
      var p = it.productId ? db.products.find(function (x) { return x.id === it.productId; }) : null;
      if (it.productId && !p) return { error: 'Không tìm thấy món ở dòng ' + (i + 1) };
      var listPrice = it.gift ? 0 : (it.listPrice != null ? Number(it.listPrice) : (p ? Number(p.price) : (it.price != null ? Number(it.price) : null)));
      var price = it.gift ? 0 : (it.price != null ? Number(it.price) : listPrice);
      if (price == null || isNaN(price) || price < 0) return { error: 'Thiếu giá ở dòng ' + (i + 1) };
      if (!isFinite(listPrice) || listPrice == null) listPrice = price;
      out.push({
        id: p ? p.id : (it.gift ? 'gift' : 'adhoc'),
        productId: p ? p.id : null,
        name: it.name || (p ? p.name : 'Món'),
        unit: it.unit || null,
        quantity: Math.round(qty * 100) / 100,
        price: round(price),
        listPrice: round(listPrice),
        cost: p ? Number(p.cost || 0) : Number(it.cost || 0),
        gift: !!it.gift,
        adHoc: !p && !it.gift,
        note: it.note || (price !== listPrice && !it.gift ? 'Giá riêng' : ''),
        promoId: it.promoId || null
      });
    }
    return { items: out };
  }

  /* ---------------------------------------------------------------- */
  /* Ghi / hoàn tác hiệu ứng của 1 đơn                                  */
  /* ---------------------------------------------------------------- */
  function applyStock(db, items, sign) {
    items.forEach(function (it) {
      if (!it.productId) return;
      var p = db.products.find(function (x) { return x.id === it.productId; });
      if (!p) return;
      p.stock = Math.round(((Number(p.stock) || 0) + sign * it.quantity) * 100) / 100;
      if (sign < 0 && p.stock < 0) p.stock = 0;
    });
  }

  function stockProblem(db, items, ignoreOrder) {
    if (!db.settings.blockNegativeStock) return null;
    var need = {};
    items.forEach(function (it) { if (it.productId) need[it.productId] = (need[it.productId] || 0) + it.quantity; });
    if (ignoreOrder) ignoreOrder.items.forEach(function (it) { if (it.productId) need[it.productId] = (need[it.productId] || 0) - it.quantity; });
    for (var id in need) {
      var p = db.products.find(function (x) { return x.id === id; });
      if (p && need[id] > (Number(p.stock) || 0) + 1e-9 && need[id] > 0) {
        // need đã trừ phần đơn cũ; so với tồn hiện tại (đã trừ phần đơn cũ rồi)
        return 'Món ' + p.name + ' chỉ còn ' + p.stock + ', không đủ để bán';
      }
    }
    return null;
  }

  function removeOrderEffects(db, order) {
    applyStock(db, order.items || [], +1);
    db.cashFlows = db.cashFlows.filter(function (cf) {
      if (cf.orderId === order.id) return false;
      return !(cf.legacyOrderNum && cf.legacyOrderNum === order.orderNumber && !cf.orderId);
    });
    var cid = order.customerId;
    db.debtLedger = db.debtLedger.filter(function (l) { return !(l.orderId === order.id); });
    if (cid) syncDebt(db, cid);
  }

  /**
   * Tạo đơn mới.
   * payload: { clientTxId, items:[{productId?,name,qty,unit,price,listPrice,gift}], customerId?, customerName?,
   *            payment:'cash'|'transfer'|'debt'|'partial', paid?, source?, heard?, note?, keep:{id,orderNumber,date,time} }
   * Trả về { ok, order, duplicate?, error?, code? }
   */
  function commitOrder(db, payload) {
    ensureDb(db);
    var txId = payload.clientTxId;
    if (txId && db.processedTx.indexOf(txId) >= 0) {
      var prev = db.orders.find(function (o) { return o.txId === txId; });
      return { ok: true, duplicate: true, order: prev || null };
    }
    var n = normItems(db, payload.items);
    if (n.error) return { ok: false, code: 'bad_items', error: n.error };
    if (!n.items.length) return { ok: false, code: 'empty', error: 'Đơn trống' };

    var payment = payload.payment || 'cash';
    var total = 0, cost = 0, listTotal = 0;
    n.items.forEach(function (it) {
      total += round(it.price * it.quantity);
      listTotal += round(it.listPrice * it.quantity);
      cost += it.cost * it.quantity;
    });
    total = round(total); cost = round(cost);

    var sp = stockProblem(db, n.items, null); // khi sửa đơn, kho đã được hoàn lại trước đó
    if (sp) return { ok: false, code: 'stock', error: sp };

    var customer = null, customerName = 'Khách vãng lai';
    var needCustomer = payment === 'debt' || payment === 'partial';
    var ref = { customerId: payload.customerId, customerName: payload.customerName };
    var r = resolveCustomer(db, ref);
    if (r.customer) { customer = r.customer; customerName = r.customer.name; }
    else if (r.ambiguous) { return { ok: false, code: 'ambiguous_customer', error: 'Có nhiều khách trùng tên', candidates: r.ambiguous }; }
    else if (payload.customerName && fold(payload.customerName) !== fold('Khách vãng lai')) {
      customerName = String(payload.customerName).trim();
      if (needCustomer || payload.createCustomer) { customer = addCustomer(db, { name: customerName }); }
    }
    if (needCustomer && !customer) return { ok: false, code: 'need_customer', error: 'Ghi nợ cần biết tên khách' };

    var paid, owed;
    if (payment === 'debt') { paid = 0; owed = total; }
    else if (payment === 'partial') {
      paid = Math.max(0, Math.min(total, round(payload.paid)));
      owed = total - paid;
      if (owed === 0) payment = 'cash';
    } else { paid = total; owed = 0; }

    var keep = payload.keep || null;
    var maxNum = db.orders.reduce(function (m, o) { return Math.max(m, o.orderNumber || 0); }, 0);
    var num = keep ? keep.orderNumber : maxNum + 1;
    var id = keep ? keep.id : 'ORD-' + String(num).padStart(4, '0');
    var date = keep ? keep.date : localDate();
    var time = keep ? keep.time : localTime();

    var transferPending = payment === 'transfer' && !payload.transferConfirmed;
    var order = {
      id: id, orderNumber: num, date: date, time: time,
      items: n.items, total: total, totalPrice: total, listTotal: listTotal, discount: Math.max(0, listTotal - total),
      cost: cost, totalCost: cost,
      customer: customerName, customerName: customerName, customerId: customer ? customer.id : null,
      paymentMethod: payment, paid: transferPending ? 0 : paid, owed: owed,
      status: owed > 0 ? (paid > 0 ? 'Còn nợ một phần' : 'Chưa thanh toán') : (transferPending ? 'Chờ chuyển khoản' : 'Đã thanh toán'),
      transferConfirmed: payment === 'transfer' ? !!payload.transferConfirmed : undefined,
      txId: txId || null, source: payload.source || 'manual', heard: payload.heard || '',
      note: payload.note || '', revision: keep ? (keep.revision || 0) + 1 : 0,
      createdAt: keep ? keep.createdAt : new Date().toISOString(), editedAt: keep ? new Date().toISOString() : null
    };

    // ---- áp hiệu ứng ----
    applyStock(db, n.items, -1);
    db.orders.unshift(order);

    if (owed > 0 && customer) {
      db.debtLedger.push({
        id: newId('dl'), customerId: customer.id, type: 'debt', amount: owed, orderId: id,
        date: date, time: time, note: 'Mua thiếu đơn ' + id,
        items: n.items.filter(function (i) { return !i.gift; }).map(function (i) { return { name: i.name, qty: i.quantity, unit: i.unit, price: i.price }; })
      });
      syncDebt(db, customer.id);
    }
    if (paid > 0 && payment !== 'transfer') {
      db.cashFlows.unshift({
        id: newId('cf'), type: 'thu', amount: paid, orderId: id, legacyOrderNum: num,
        memo: 'Bán hàng đơn #' + num + (customer ? ' (' + customerName + ')' : '') + (owed > 0 ? ' - trả trước' : ''),
        category: 'Doanh thu bán hàng', date: date, time: time, method: 'Tiền mặt'
      });
    }
    if (payment === 'transfer' && payload.transferConfirmed) {
      db.cashFlows.unshift({
        id: newId('cf'), type: 'thu', amount: paid, orderId: id, legacyOrderNum: num,
        memo: 'Bán hàng đơn #' + num + ' (chuyển khoản)', category: 'Doanh thu bán hàng', date: date, time: time, method: 'Chuyển khoản'
      });
    }
    if (txId) { db.processedTx.push(txId); if (db.processedTx.length > 300) db.processedTx.shift(); }
    return { ok: true, order: order };
  }

  /** Người bán xác nhận ĐÃ NHẬN tiền chuyển khoản (chỉ khi đó mới ghi vào thu chi). */
  function confirmTransfer(db, orderId) {
    var o = db.orders.find(function (x) { return x.id === orderId; });
    if (!o) return { ok: false, error: 'Không thấy đơn' };
    if (o.paymentMethod !== 'transfer') return { ok: false, error: 'Đơn này không phải chuyển khoản' };
    if (o.transferConfirmed) return { ok: true, duplicate: true, order: o };
    o.transferConfirmed = true; o.paid = o.total; o.status = 'Đã thanh toán';
    db.cashFlows.unshift({
      id: newId('cf'), type: 'thu', amount: o.total, orderId: o.id, legacyOrderNum: o.orderNumber,
      memo: 'Bán hàng đơn #' + o.orderNumber + ' (chuyển khoản)', category: 'Doanh thu bán hàng',
      date: localDate(), time: localTime(), method: 'Chuyển khoản'
    });
    return { ok: true, order: o };
  }

  /** Dựng payload từ đơn đã lưu (để sửa). */
  function orderToPayload(order) {
    return {
      items: order.items.map(function (i) {
        return { productId: i.productId || (i.id && i.id !== 'adhoc' && i.id !== 'gift' ? i.id : null), name: i.name, qty: i.quantity, unit: i.unit,
          price: i.price, listPrice: i.listPrice, gift: !!i.gift, note: i.note, cost: i.cost, promoId: i.promoId };
      }),
      customerId: order.customerId, customerName: order.customerName,
      payment: order.paymentMethod, paid: order.paid, transferConfirmed: order.transferConfirmed,
      source: order.source, heard: order.heard, note: order.note
    };
  }

  function snapshot(db) {
    return clone({ products: db.products, customers: db.customers, cashFlows: db.cashFlows, orders: db.orders, debtLedger: db.debtLedger });
  }
  function restoreSnapshot(db, s) {
    db.products = s.products; db.customers = s.customers; db.cashFlows = s.cashFlows; db.orders = s.orders; db.debtLedger = s.debtLedger;
  }

  /**
   * Sửa đơn đã lưu. patch có thể chứa: items, customerId/customerName, payment, paid, note.
   * Hoàn lại hiệu ứng bản cũ rồi áp bản mới; lỗi -> khôi phục nguyên trạng.
   */
  function editOrder(db, orderId, patch, reason) {
    ensureDb(db);
    var old = db.orders.find(function (o) { return o.id === orderId; });
    if (!old) return { ok: false, error: 'Không thấy đơn ' + orderId };
    var snap = snapshot(db);
    var before = clone(old);
    var payload = Object.assign(orderToPayload(old), patch || {});
    payload.keep = { id: old.id, orderNumber: old.orderNumber, date: old.date, time: old.time, revision: old.revision, createdAt: old.createdAt };
    payload.clientTxId = null;
    removeOrderEffects(db, old);
    db.orders = db.orders.filter(function (o) { return o.id !== orderId; });
    // giữ vị trí cũ trong danh sách
    var res = commitOrder(db, payload);
    if (!res.ok) { restoreSnapshot(db, snap); return res; }
    res.order.txId = old.txId;
    var idx = snap.orders.findIndex(function (o) { return o.id === orderId; });
    if (idx > 0) { db.orders = db.orders.filter(function (o) { return o.id !== orderId; }); db.orders.splice(idx, 0, res.order); }
    db.auditSeq = (db.auditSeq || 0);
    var audit = { id: newId('au'), orderId: orderId, action: 'edit', at: new Date().toISOString(), reason: reason || '', before: before, after: clone(res.order) };
    db.orderAudit.unshift(audit);
    if (db.orderAudit.length > 200) db.orderAudit.length = 200;
    res.auditId = audit.id;
    return res;
  }

  function deleteOrder(db, orderId, reason) {
    var old = db.orders.find(function (o) { return o.id === orderId; });
    if (!old) return { ok: false, error: 'Không thấy đơn' };
    var before = clone(old);
    removeOrderEffects(db, old);
    db.orders = db.orders.filter(function (o) { return o.id !== orderId; });
    var audit = { id: newId('au'), orderId: orderId, action: 'delete', at: new Date().toISOString(), reason: reason || '', before: before, after: null };
    db.orderAudit.unshift(audit);
    return { ok: true, auditId: audit.id };
  }

  /** Khôi phục theo nhật ký: đơn đã sửa -> về bản trước; đơn đã xoá -> tạo lại nguyên số đơn. */
  function restoreFromAudit(db, auditId) {
    var a = db.orderAudit.find(function (x) { return x.id === auditId; });
    if (!a) return { ok: false, error: 'Không thấy nhật ký' };
    var b = a.before;
    var exists = db.orders.find(function (o) { return o.id === a.orderId; });
    if (exists) {
      return editOrder(db, a.orderId, orderToPayload(b), 'Khôi phục bản trước (' + a.id + ')');
    }
    var payload = orderToPayload(b);
    payload.keep = { id: b.id, orderNumber: b.orderNumber, date: b.date, time: b.time, revision: b.revision, createdAt: b.createdAt };
    var res = commitOrder(db, payload);
    if (res.ok) db.orderAudit.unshift({ id: newId('au'), orderId: b.id, action: 'restore', at: new Date().toISOString(), reason: 'Khôi phục đơn đã xoá', before: null, after: clone(res.order) });
    return res;
  }

  /* ---------------------------------------------------------------- */
  /* Công nợ                                                            */
  /* ---------------------------------------------------------------- */
  /** Khách trả nợ -> THU NỢ (không phải tạo nợ mới). */
  function recordDebtPayment(db, p) {
    ensureDb(db);
    if (p.clientTxId && db.processedTx.indexOf(p.clientTxId) >= 0) return { ok: true, duplicate: true };
    var r = resolveCustomer(db, p);
    if (r.ambiguous) return { ok: false, code: 'ambiguous_customer', error: 'Có nhiều khách trùng tên', candidates: r.ambiguous };
    if (!r.customer) return { ok: false, code: 'no_customer', error: 'Không tìm thấy khách' };
    var c = r.customer;
    var amount = round(p.amount);
    if (!(amount > 0)) return { ok: false, code: 'bad_amount', error: 'Số tiền không hợp lệ' };
    var debt = ledgerSum(db, c.id);
    if (debt <= 0) return { ok: false, code: 'no_debt', error: c.name + ' hiện không còn nợ' };
    if (amount > debt) return { ok: false, code: 'exceeds_debt', error: 'Số tiền trả lớn hơn nợ còn lại', debt: debt };
    var d = localDate(), t = localTime();
    var entry = { id: newId('dl'), customerId: c.id, type: 'payment', amount: amount, date: d, time: t, note: p.note || 'Khách trả nợ', method: p.method || 'Tiền mặt', items: [] };
    db.debtLedger.push(entry);
    db.cashFlows.unshift({
      id: newId('cf'), type: 'thu', amount: amount, customerId: c.id, ledgerId: entry.id,
      memo: 'Khách trả nợ (' + c.name + ')', category: 'Thu hồi nợ', date: d, time: t, method: p.method || 'Tiền mặt'
    });
    syncDebt(db, c.id);
    if (p.clientTxId) { db.processedTx.push(p.clientTxId); if (db.processedTx.length > 300) db.processedTx.shift(); }
    return { ok: true, customer: c, amount: amount, remaining: c.debt, entry: entry };
  }

  /** Ghi nợ thủ công (không kèm đơn hàng). KHÔNG tạo tiền mặt. */
  function addDebt(db, p) {
    ensureDb(db);
    var amount = round(p.amount);
    if (!(amount > 0)) return { ok: false, code: 'bad_amount', error: 'Số tiền nợ không hợp lệ' };
    if (p.clientTxId && db.processedTx.indexOf(p.clientTxId) >= 0) return { ok: true, duplicate: true };
    var r = resolveCustomer(db, p);
    var c;
    if (r.ambiguous) return { ok: false, code: 'ambiguous_customer', error: 'Có nhiều khách trùng tên', candidates: r.ambiguous };
    if (r.customer) c = r.customer;
    else { c = addCustomer(db, { name: p.customerName }); if (!c) return { ok: false, code: 'need_customer', error: 'Thiếu tên khách' }; }
    db.debtLedger.push({ id: newId('dl'), customerId: c.id, type: 'debt', amount: amount, date: localDate(), time: localTime(), note: p.note || 'Ghi nợ', items: [] });
    syncDebt(db, c.id);
    if (p.clientTxId) db.processedTx.push(p.clientTxId);
    return { ok: true, customer: c, amount: amount, remaining: c.debt };
  }

  /** Điều chỉnh khoản nợ (có ghi lịch sử). delta > 0 tăng nợ, < 0 giảm nợ. KHÔNG đụng tiền mặt. */
  function adjustDebt(db, p) {
    ensureDb(db);
    var r = resolveCustomer(db, p);
    if (!r.customer) return { ok: false, error: 'Không tìm thấy khách' };
    var delta = round(p.delta);
    if (!delta) return { ok: false, error: 'Không có thay đổi' };
    db.debtLedger.push({ id: newId('dl'), customerId: r.customer.id, type: 'adjust', amount: delta, date: localDate(), time: localTime(), note: p.note || 'Điều chỉnh nợ', items: [] });
    syncDebt(db, r.customer.id);
    return { ok: true, customer: r.customer };
  }

  function debtors(db) {
    var rows = db.customers.map(function (c) {
      var sum = ledgerSum(db, c.id);
      var last = db.debtLedger.filter(function (l) { return l.customerId === c.id && l.type !== 'payment'; }).slice(-1)[0];
      return { id: c.id, name: c.name, nickname: c.nickname || '', phone: c.phone || '', debt: sum, lastDate: last ? last.date : null };
    }).filter(function (r) { return r.debt > 0; });
    rows.sort(function (a, b) { return b.debt - a.debt; });
    return { rows: rows, total: rows.reduce(function (s, r) { return s + r.debt; }, 0) };
  }

  function customerLedger(db, customerId) {
    var rows = db.debtLedger.filter(function (l) { return l.customerId === customerId; });
    var debtTotal = 0, paidTotal = 0;
    rows.forEach(function (l) { if (l.type === 'payment') paidTotal += l.amount; else debtTotal += l.amount; });
    return { rows: rows.slice().reverse(), debtTotal: debtTotal, paidTotal: paidTotal, remaining: debtTotal - paidTotal };
  }

  /* ---------------------------------------------------------------- */
  /* Báo cáo nhanh (dùng cho câu hỏi tra cứu)                           */
  /* ---------------------------------------------------------------- */
  function todaySummary(db, dateStr) {
    dateStr = dateStr || localDate();
    var os = db.orders.filter(function (o) { return o.date === dateStr; });
    var revenue = os.reduce(function (s, o) { return s + (o.total || 0); }, 0);
    var cashIn = db.cashFlows.filter(function (c) { return c.date === dateStr && c.type === 'thu'; }).reduce(function (s, c) { return s + c.amount; }, 0);
    var owed = os.reduce(function (s, o) { return s + (o.owed || 0); }, 0);
    var cost = os.reduce(function (s, o) { return s + (o.cost || 0); }, 0);
    return { orders: os.length, revenue: revenue, cashIn: cashIn, newDebt: owed, profit: revenue - cost };
  }

  var api = {
    ensureDb: ensureDb, commitOrder: commitOrder, editOrder: editOrder, deleteOrder: deleteOrder, restoreFromAudit: restoreFromAudit,
    confirmTransfer: confirmTransfer, recordDebtPayment: recordDebtPayment, adjustDebt: adjustDebt, addDebt: addDebt,
    debtors: debtors, customerLedger: customerLedger, todaySummary: todaySummary,
    findCustomersByName: findCustomersByName, resolveCustomer: resolveCustomer, addCustomer: addCustomer,
    orderToPayload: orderToPayload, ledgerSum: ledgerSum, newId: newId, localDate: localDate, localTime: localTime, fold: fold
  };
  root.SooiCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
