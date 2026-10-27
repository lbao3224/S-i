/**
 * Sổ ơi - Giao diện giọng nói (v3).
 *
 *  voiceRoute()            : phân loại ý định TRƯỚC khi làm bất cứ điều gì (câu hỏi KHÔNG bao giờ tạo đơn)
 *  openVoiceConfirm()      : màn hình xác nhận đơn (tiền mặt / chuyển khoản / ghi nợ / trả một phần)
 *  3 chế độ xác nhận       : voice (nói "đúng rồi") | manual (chạm nút) | auto (đếm ngược)
 *  Sản phẩm mới            : chỉ bán lần này / thêm vào danh mục
 *  Thu nợ, tra cứu công nợ : dùng sổ nợ chi tiết (SooiCore)
 *  Tạp âm + thông báo cuối ngày + quản lý từ đã học
 *
 * Mọi thao tác ghi dữ liệu đều gọi SooiCore (sooi_core.js) — một nơi duy nhất, có chống trùng.
 */
(function () {
  'use strict';

  var NOISE_LABEL = 'Quá nhiều tạp âm';
  var draft = null;
  var noiseState = null;
  var committing = false;
  var auto = { timer: null, left: 0, total: 0 };
  var listen = { active: false, tries: 0, timer: null };

  /* ------------------------------------------------------------------ */
  /* Tiện ích                                                             */
  /* ------------------------------------------------------------------ */
  function S() { db.settings = db.settings || {}; return db.settings; }
  function esc(s) { return escHtml(s); }
  function vnd(n) { return formatVND(Math.round(n || 0)); }
  function todayStr() { return SooiCore.localDate(); }
  function nowTime() { return SooiCore.localTime(); }
  function findProduct(id) { return db.products.find(function (p) { return p.id === id; }) || null; }
  function findCustomer(id) { return db.customers.find(function (c) { return c.id === id; }) || null; }
  function newTxId() { return 'tx_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36); }
  function debtOfCustomer(c) { return c && c.id ? Math.max(0, SooiCore.ledgerSum(db, c.id)) : 0; }
  function custLabel(c) {
    var same = db.customers.filter(function (x) { return SooiCore.fold(x.name) === SooiCore.fold(c.name); });
    if (same.length < 2) return c.name;
    return c.name + (c.phone ? ' · ' + c.phone : ' · mã ' + String(c.id).slice(-4));
  }

  var BUILTIN_ALIASES_RAW = {};
  var builtinCache = null;
  function builtinAliases() {
    if (builtinCache) return builtinCache;
    builtinCache = {};
    Object.keys(BUILTIN_ALIASES_RAW).forEach(function (id) {
      BUILTIN_ALIASES_RAW[id].forEach(function (al) { builtinCache[VoiceOrder.aliasKey(al)] = id; });
    });
    return builtinCache;
  }
  function aliasMap() {
    var out = {};
    var b = builtinAliases();
    Object.keys(b).forEach(function (k) { out[k] = b[k]; });
    var learned = (db && db.voiceAliases) || {};
    Object.keys(learned).forEach(function (k) { out[k] = learned[k]; });
    return out;
  }
  function ctx() { return { products: db.products, customers: db.customers, aliases: aliasMap() }; }

  /* ------------------------------------------------------------------ */
  /* Nhật ký giọng nói (báo cuối ngày)                                    */
  /* ------------------------------------------------------------------ */
  function logAdd(entry) {
    entry.id = 'vl_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    entry.date = todayStr();
    entry.time = nowTime();
    db.voiceLog = db.voiceLog || [];
    db.voiceLog.unshift(entry);
    if (db.voiceLog.length > 300) db.voiceLog.length = 300;
    saveDB();
    return entry.id;
  }
  function logUpdate(id, patch) {
    var e = (db.voiceLog || []).find(function (x) { return x.id === id; });
    if (!e) return;
    Object.keys(patch).forEach(function (k) { e[k] = patch[k]; });
    saveDB();
  }

  window.voiceSendHints = function () {
    try {
      if (!(window.AndroidBridge && typeof window.AndroidBridge.setVoiceHints === 'function')) return;
      var hints = [];
      db.products.forEach(function (p) {
        hints.push(p.name);
        (p.promos || []).forEach(function (x) { if (x.giftName) hints.push(x.giftName); });
      });
      Object.keys(db.voiceAliases || {}).slice(-40).forEach(function (k) { hints.push(k); });
      db.customers.forEach(function (c) { hints.push(String(c.name).split('(')[0].trim()); });
      window.AndroidBridge.setVoiceHints(JSON.stringify(hints.slice(0, 150)));
    } catch (e) { /* bỏ qua */ }
  };

  /* ------------------------------------------------------------------ */
  /* Phát giọng nói (TTS) có callback khi đọc xong                        */
  /* ------------------------------------------------------------------ */
  var ttsCbs = {};
  window.onTtsDone = function (id) {
    var cb = ttsCbs[id];
    if (cb) { delete ttsCbs[id]; try { cb(); } catch (e) { console.error(e); } }
  };
  function speakEnabled() { return S().voiceAnnouncement !== false; }
  function ttsVolume() { var v = parseFloat(S().ttsVolume); return isNaN(v) ? 1 : Math.max(0, Math.min(1, v)); }

  window.sooiSpeak = function (text, onDone) {
    var finished = false;
    function done() { if (finished) return; finished = true; if (onDone) onDone(); }
    if (!speakEnabled() || !text) { setTimeout(done, 0); return; }
    try {
      if (window.AndroidBridge && typeof window.AndroidBridge.speakThen === 'function') {
        var id = 'tts_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        ttsCbs[id] = done;
        window.AndroidBridge.speakThen(String(text), id, ttsVolume());
        setTimeout(function () { if (ttsCbs[id]) { delete ttsCbs[id]; done(); } }, 15000);   // phòng khi TTS không báo xong
        return;
      }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(String(text));
        u.lang = 'vi-VN'; u.volume = ttsVolume();
        u.onend = done; u.onerror = done;
        window.speechSynthesis.speak(u);
        setTimeout(done, 15000);
        return;
      }
    } catch (e) { console.error('TTS lỗi', e); }
    setTimeout(done, 0);
  };

  function moneySpeech(n) {
    try { if (typeof formatMoneyToSpeech === 'function') return formatMoneyToSpeech(n) + ' đồng'; } catch (e) { /* dùng bản dự phòng */ }
    return Math.round(n) + ' đồng';
  }

  /* ------------------------------------------------------------------ */
  /* Câu hỏi tra cứu (KHÔNG tạo đơn)                                       */
  /* ------------------------------------------------------------------ */
  function hasProductIn(text) {
    try { return VoiceOrder.findMentions(VoiceOrder.tokenize(text), db.products, aliasMap()).length > 0; } catch (e) { return false; }
  }

  /**
   * Phân loại và xử lý. Trả về { handled:true, reply:string|null } hoặc { handled:false }.
   */
  window.voiceRoute = function (text, opts) {
    opts = opts || {};
    var cls = VoiceIntent.classify(text, {
      customers: db.customers, debtOf: debtOfCustomer, hasProduct: hasProductIn
    });
    switch (cls.kind) {
      case 'query_debt': return { handled: true, reply: answerDebtQuery(cls) };
      case 'query_sales': return { handled: true, reply: answerSalesQuery() };
      case 'query_stock': return { handled: true, reply: answerStockQuery(text) };
      case 'query_other':
        return { handled: true, reply: 'Dạ Sổ nghe như bạn đang hỏi nhưng chưa rõ hỏi gì, nên Sổ KHÔNG tạo đơn. Bạn thử hỏi: "ai còn nợ?", "hôm nay bán được bao nhiêu?", "còn mấy chai nước?" nghen!' };
      case 'debt_payment': return { handled: true, reply: startDebtPayment(cls, text, opts) };
      case 'sale': {
        var r = trySale(text, cls, opts);
        return r === null ? { handled: false } : { handled: true, reply: r };
      }
      default: return { handled: false };
    }
  };

  // Giữ tên cũ để mã cũ gọi vẫn chạy
  window.voiceTrySale = function (text, opts) {
    var r = window.voiceRoute(text, opts);
    return r.handled ? (r.reply || '') : null;
  };

  function answerDebtQuery(cls) {
    var d = SooiCore.debtors(db);
    if (cls.customer && cls.customer.id) {
      var c = findCustomer(cls.customer.id);
      var owe = c ? Math.max(0, SooiCore.ledgerSum(db, c.id)) : 0;
      showDebtSheet(c ? c.id : null);
      return c ? (owe > 0 ? c.name + ' còn nợ ' + vnd(owe) + '.' : c.name + ' hiện không còn nợ.') : '';
    }
    showDebtSheet(null);
    return d.rows.length ? 'Có ' + d.rows.length + ' khách còn nợ, tổng ' + vnd(d.total) + '.' : 'Hiện không có khách nào còn nợ.';
  }

  function answerSalesQuery() {
    var t = SooiCore.todaySummary(db);
    return 'Hôm nay bán ' + t.orders + ' đơn. Doanh thu ' + vnd(t.revenue) + ', tiền mặt đã thu ' + vnd(t.cashIn) + (t.newDebt ? ', còn ghi nợ ' + vnd(t.newDebt) : '') + '. Lời ước tính ' + vnd(t.profit) + '.';
  }

  function answerStockQuery(text) {
    var spans = [];
    try { spans = VoiceOrder.findMentions(VoiceOrder.tokenize(text), db.products, aliasMap()); } catch (e) { /* bỏ qua */ }
    if (spans.length) {
      return spans.map(function (s) { return s.p.name + ' còn ' + (s.p.stock != null ? s.p.stock : 0); }).join('; ') + '.';
    }
    var low = db.products.filter(function (p) { return (p.stock || 0) <= 10; });
    return low.length ? 'Có ' + low.length + ' món sắp hết: ' + low.map(function (p) { return p.name + ' (còn ' + p.stock + ')'; }).join(', ') + '.' : 'Các món đều còn đủ hàng (trên 10).';
  }

  /* ------------------------------------------------------------------ */
  /* Bảng công nợ (trả lời "Ai còn nợ?")                                  */
  /* ------------------------------------------------------------------ */
  function showDebtSheet(onlyCustomerId) {
    ensureModals();
    var d = SooiCore.debtors(db);
    var rows = d.rows.filter(function (r) { return !onlyCustomerId || r.id === onlyCustomerId; });
    var total = rows.reduce(function (s, r) { return s + r.debt; }, 0);
    var html;
    if (!rows.length) {
      html = '<div class="py-8 text-center text-[17px] font-bold text-slate-600">Không có khách nào còn nợ 🎉</div>';
    } else {
      html = '<div class="space-y-2">' + rows.map(function (r) {
        return '<div class="p-3 rounded-2xl border border-slate-200 bg-white">' +
          '<div class="flex items-center justify-between gap-2"><div class="min-w-0"><div class="text-[16px] font-extrabold text-slate-900 truncate">' + esc(r.name) + '</div>' +
          (r.nickname ? '<div class="text-[12px] text-slate-500">' + esc(r.nickname) + '</div>' : '') +
          (r.lastDate ? '<div class="text-[12px] text-slate-400">Nợ gần nhất: ' + esc(r.lastDate) + '</div>' : '') + '</div>' +
          '<div class="text-[19px] font-black text-red-600 shrink-0">' + vnd(r.debt) + '</div></div>' +
          '<div class="grid grid-cols-3 gap-1.5 mt-2">' +
          '<button onclick="openDebtLedger(\'' + r.id + '\')" class="py-2 rounded-xl bg-slate-100 text-slate-800 font-bold text-[13px] active:scale-95">Xem chi tiết</button>' +
          '<button onclick="promptAdjustDebt(\'' + r.id + '\')" class="py-2 rounded-xl bg-amber-50 text-amber-800 font-bold text-[13px] active:scale-95">Sửa</button>' +
          '<button onclick="debtCollectFor(\'' + r.id + '\')" class="py-2 rounded-xl bg-[#ECFBF2] text-[#0B7A60] font-bold text-[13px] active:scale-95">Thu nợ</button>' +
          '</div></div>';
      }).join('') + '</div>';
    }
    document.getElementById('debt-sheet-body').innerHTML = html;
    document.getElementById('debt-sheet-total').textContent = vnd(total);
    openSheet('debt-sheet');
  }
  window.showDebtSheet = showDebtSheet;
  window.closeDebtSheet = function () { closeSheet('debt-sheet'); };

  window.debtCollectFor = function (customerId) {
    closeSheet('debt-sheet');
    var c = findCustomer(customerId);
    if (!c) return;
    openDebtPaymentDraft({ customerId: c.id, amount: null, heard: 'Thu nợ ' + c.name });
  };

  /* ------------------------------------------------------------------ */
  /* Bán hàng bằng giọng nói                                              */
  /* ------------------------------------------------------------------ */
  function sigOf(r) {
    return r.lines.map(function (l) { return (l.product ? l.product.id : '?') + 'x' + l.qty; }).join('|');
  }
  function alternativesDisagree(alts, bestConf) {
    if (!alts || alts.length < 2) return false;
    if (bestConf != null && bestConf >= 0.8) return false;
    var seen = {}, n = 0;
    alts.slice(0, 3).forEach(function (a) {
      var r = VoiceOrder.parse(a, ctx());
      if (!r.lines.length) return;
      var s = sigOf(r);
      if (!seen[s]) { seen[s] = 1; n++; }
    });
    return n > 1;
  }

  function trySale(text, cls, opts) {
    var payMode = cls.payment ? cls.payment.mode : null;
    var src = cls.payment && cls.payment.cleaned ? cls.payment.cleaned : text;
    var r = VoiceOrder.parse(src, ctx());
    var newItem = null;
    if (!r.lines.length) {
      // Món chưa có trong danh mục?
      newItem = VoiceOrder.parseNewItem(src, ctx());
      if (!newItem) return null;
      var mm = VoiceOrder.matchProduct(VoiceOrder.tokenize(newItem.name), db.products, aliasMap());
      r.lines = [{
        product: null, candidates: (mm.candidates || []).filter(function (c) { return mm.score >= 0.34; }).slice(0, 3), ambiguous: false,
        matchScore: 0, viaAlias: false, qty: newItem.qty, unit: newItem.unit, unitPrice: newItem.unitPrice,
        priceKind: newItem.unitPrice != null ? 'special' : null, phrase: newItem.name, newItem: newItem
      }];
      if (!r.customer && newItem.customer) r.customer = newItem.customer;
    }

    // Khớp một phần tên món + còn từ lạ -> coi là MÓN MỚI (gợi ý món gần giống), không tự chọn bừa
    r.lines = r.lines.map(function (l) {
      if (l.product && l.partialExtra && l.partialExtra.length && !l.viaAlias) {
        var ni2 = VoiceOrder.parseNewItem(src, ctx()) || {};
        var nm = ni2.name || String(l.phrase || '').trim();
        var pr2 = ni2.unitPrice != null ? ni2.unitPrice : l.unitPrice;
        return Object.assign({}, l, {
          product: null, candidates: [l.product], qty: ni2.qty || l.qty, unit: ni2.unit || l.unit,
          newItem: { name: nm, unitPrice: pr2, unit: ni2.unit || l.unit }, unitPrice: pr2, priceKind: pr2 != null ? 'special' : null
        });
      }
      return l;
    });

    var flagged = false;
    if (opts.fromVoice && !opts.fromNoise) {
      var lowConf = opts.bestConf != null && opts.bestConf > 0 && opts.bestConf < 0.5;
      if (lowConf || alternativesDisagree(opts.alts, opts.bestConf)) {
        showNoise(opts.alts && opts.alts.length ? opts.alts : [text]);
        return NOISE_LABEL + ' - bạn chạm vào cách hiểu đúng giùm Sổ nghen!';
      }
    }
    openVoiceConfirm(r, text, { logId: opts.logId || null, payMode: payMode, paid: cls.payment ? cls.payment.paid : null, flagged: flagged, fromVoice: !!opts.fromVoice });
    return 'Dạ Sổ nghe: "' + text + '". Bạn kiểm tra rồi xác nhận nghen!';
  }

  function previewOf(r) {
    if (!r.lines.length) return null;
    return r.lines.map(function (l) {
      var name = l.product ? l.product.name : '(chưa rõ món)';
      var price = l.unitPrice != null ? ' · ' + vnd(l.unitPrice) : '';
      return name + ' ×' + l.qty + price;
    }).join(' + ');
  }

  /* ------------------------------------------------------------------ */
  /* Hộp thoại tạp âm                                                     */
  /* ------------------------------------------------------------------ */
  window.voiceHandleUnknown = function (raw, opts) {
    var alts = (opts && opts.alts && opts.alts.length) ? opts.alts : [raw];
    showNoise(alts);
  };

  function showNoise(alts, note, existingLogId) {
    ensureModals();
    var seen = {};
    var items = [];
    (alts || []).forEach(function (a) {
      var k = String(a).trim().toLowerCase();
      if (!k || seen[k] || items.length >= 4) return;
      seen[k] = 1;
      var parsed = VoiceOrder.parse(a, ctx());
      items.push({ text: String(a).trim(), parsed: parsed, preview: previewOf(parsed) });
    });
    var logId = existingLogId || logAdd({ status: 'noisy', heard: items.map(function (x) { return x.text; }), chosen: null, summary: '' });
    noiseState = { logId: logId, items: items };

    var body = document.getElementById('voice-noise-body');
    var html = '<p class="text-[15px] text-slate-700 leading-relaxed mb-3">' + (note ? esc(note) + ' ' : '') +
      (items.length ? 'Sổ nghe được những cách sau. Bạn chọn cách <b>đúng</b>, hoặc nói lại / sửa bằng tay.'
        : 'Bạn thử nói lại gần micro hơn, hoặc gõ chữ vào ô lệnh nghen.') + '</p>';
    html += items.map(function (it, i) {
      return '<button onclick="voiceChooseNoisy(' + i + ')" class="w-full text-left p-3 rounded-xl border border-slate-200 bg-slate-50 active:bg-[#ECFBF2] active:border-[#0B7A60] mb-2">' +
        '<div class="text-[15px] font-bold text-slate-900">“' + esc(it.text) + '”</div>' +
        '<div class="text-[13px] mt-0.5 ' + (it.preview ? 'text-[#0B7A60] font-semibold' : 'text-slate-400') + '">' +
        (it.preview ? '→ ' + esc(it.preview) : 'Chưa hiểu thành món nào') + '</div></button>';
    }).join('');
    body.innerHTML = html;
    openSheet('voice-noise');
  }

  window.voiceChooseNoisy = function (i) {
    if (!noiseState) return;
    var it = noiseState.items[i];
    if (!it) return;
    var logId = noiseState.logId;
    logUpdate(logId, { status: 'chosen', chosen: it.text, summary: it.preview || it.text });
    closeSheet('voice-noise');
    var route = window.voiceRoute(it.text, { fromNoise: true, logId: logId });
    if (route.handled) { if (route.reply && typeof showAiResponse === 'function') showAiResponse(route.reply); return; }
    var inp = document.getElementById('ai-input');
    if (inp) inp.value = it.text;
    if (typeof executeAiCommand === 'function') executeAiCommand(it.text, { fromNoise: true });
  };
  window.voiceNoiseRetry = function () {
    if (noiseState) logUpdate(noiseState.logId, { status: 'dismissed' });
    closeSheet('voice-noise');
    setTimeout(function () { if (typeof toggleVoiceAssistant === 'function') toggleVoiceAssistant(); }, 250);
  };
  window.voiceNoiseDismiss = function () {
    if (noiseState) logUpdate(noiseState.logId, { status: 'dismissed' });
    closeSheet('voice-noise');
  };
  window.closeVoiceNoise = function () { closeSheet('voice-noise'); };

  window.onNativeSpeechNoise = function () {
    stopMicUi();
    if (listen.active) { handleConfirmReply(''); return; }
    showNoise([], 'Sổ chưa nghe được gì rõ ràng.');
  };
  function stopMicUi() {
    try { isListening = false; } catch (e) { /* biến toàn cục có thể chưa có */ }
    if (typeof setMicPulseUI === 'function') setMicPulseUI(false);
    var inp = document.getElementById('ai-input');
    if (inp) inp.placeholder = 'Ví dụ: lấy 2 ly đen đá, chi 5 chục mua đá, bữa nay bán được nhiêu...';
  }

  window.onNativeSpeechResultEx = function (payload) {
    stopMicUi();
    var alts = ((payload && payload.results) || []).filter(function (x) { return x && String(x).trim(); });
    var confs = (payload && payload.confidences) || [];
    if (!alts.length) { window.onNativeSpeechNoise(); return; }
    if (listen.active) { handleConfirmReply(alts[0]); return; }
    var best = VoiceOrder.pickBest(alts, confs, ctx());
    var text = best ? best.text : alts[0];
    var inp = document.getElementById('ai-input');
    if (inp) inp.value = text;
    executeAiCommand(text, { fromVoice: true, alts: alts, confs: confs, bestConf: best ? best.conf : null });
  };

  /* ------------------------------------------------------------------ */
  /* Bản nháp đơn                                                         */
  /* ------------------------------------------------------------------ */
  function bestPromoFor(p, qty, skipGift) {
    var best = null;
    eligiblePromos(p, qty).forEach(function (x) {
      if (skipGift && x.type === 'gift') return;
      if (!best || (x.minQty || 1) > (best.minQty || 1)) best = x;
    });
    return best;
  }

  function sameKeyCustomers(spokenName) {
    // các khách có cùng "khoá gọi tên" với tên nói (để hỏi khi trùng tên)
    var keyOf = function (c) { return VoiceOrder.customerKeys(c); };
    var spoken = VoiceOrder.customerKeys({ name: spokenName });
    return db.customers.filter(function (c) {
      var k = keyOf(c);
      return spoken.some(function (x) { return k.indexOf(x) >= 0; });
    });
  }

  function openVoiceConfirm(parsed, heard, meta) {
    meta = meta || {};
    ensureModals();
    stopAuto(); stopListen();
    committing = false;
    draft = {
      id: newTxId(), kind: 'sale', heard: heard, logId: meta.logId || null,
      customerId: null, customerName: null, customerCandidates: [], spokenCustomer: parsed.customer ? parsed.customer.name : null,
      payment: meta.payMode === 'debt' ? 'debt' : (meta.payMode === 'transfer' ? 'transfer' : (meta.payMode === 'partial' ? 'partial' : 'cash')),
      paid: meta.paid || null,
      discount: { type: 'none', value: 0 },
      lines: parsed.lines.map(function (l) {
        return {
          productId: l.product ? l.product.id : null,
          candidates: (l.candidates || []).map(function (c) { return c.id; }),
          qty: l.qty, unit: l.unit, unitPrice: l.unitPrice, priceKind: l.priceKind, priceGuess: !!l.priceGuess,
          promoId: null, phrase: l.phrase, viaAlias: l.viaAlias, changedProduct: false,
          newItem: l.newItem ? { name: l.newItem.name, unit: l.newItem.unit || '', price: l.newItem.unitPrice, cost: '', category: '', mode: 'once' } : null
        };
      }),
      gifts: parsed.gifts.map(function (g) { return { name: g.name, qty: g.qty, unit: g.unit, productId: g.productId }; }),
      flagged: !!meta.flagged, fromVoice: !!meta.fromVoice, promoAuto: false
    };
    // Khách
    if (parsed.customer) {
      if (parsed.customer.id) {
        var same = sameKeyCustomers(parsed.customer.name);
        if (same.length > 1) draft.customerCandidates = same.map(function (c) { return c.id; });
        else { draft.customerId = parsed.customer.id; draft.customerName = parsed.customer.name; }
      } else {
        var byName = SooiCore.findCustomersByName(db, parsed.customer.name);
        if (byName.length > 1) draft.customerCandidates = byName.map(function (c) { return c.id; });
        else if (byName.length === 1) { draft.customerId = byName[0].id; draft.customerName = byName[0].name; }
        else { draft.customerName = parsed.customer.name; draft.newCustomer = true; }
      }
    }
    if (parsed.promoCue) {
      var spokenGift = parsed.gifts.length > 0;
      draft.lines.forEach(function (ln) {
        var p = findProduct(ln.productId);
        if (!p) return;
        var pr = bestPromoFor(p, ln.qty, spokenGift);
        if (pr) { ln.promoId = pr.id; draft.promoAuto = true; }
      });
    }
    renderVoiceConfirm();
    openSheet('voice-confirm');
    startConfirmFlow();
  }

  /* ------------------------------------------------------------------ */
  /* Tính tiền bản nháp                                                   */
  /* ------------------------------------------------------------------ */
  function lineUnit(ln, p) {
    if (ln.newItem && !p) return Number(ln.newItem.price) || 0;
    if (!p) return 0;
    if (ln.unitPrice != null) return ln.unitPrice;
    var pr = ln.promoId ? promoById(p, ln.promoId) : null;
    if (pr && ln.qty >= (pr.minQty || 1)) {
      if (pr.type === 'price') return Math.max(0, p.price - (pr.value || 0));
      if (pr.type === 'percent') return Math.max(0, Math.round(p.price * (1 - (pr.value || 0) / 100)));
    }
    return p.price;
  }
  function lineList(ln, p) { return p ? p.price : (ln.newItem ? Number(ln.newItem.price) || 0 : 0); }

  function calcDraft() {
    var rows = draft.lines.map(function (ln) {
      var p = findProduct(ln.productId);
      var unit = lineUnit(ln, p);
      return { ln: ln, p: p, unit: unit, list: lineList(ln, p) };
    });
    var subtotal = rows.reduce(function (s, r) { return s + Math.round(r.unit * r.ln.qty); }, 0);
    var factor = 1;
    if (draft.discount.type === 'percent' && draft.discount.value > 0) factor = 1 - Math.min(100, draft.discount.value) / 100;
    else if (draft.discount.type === 'amount' && draft.discount.value > 0 && subtotal > 0) factor = Math.max(0, (subtotal - draft.discount.value) / subtotal);
    rows.forEach(function (r) { r.final = factor === 1 ? r.unit : Math.round(r.unit * factor); r.total = Math.round(r.final * r.ln.qty); });
    var total = rows.reduce(function (s, r) { return s + r.total; }, 0);
    var gifts = draft.gifts.slice();
    draft.lines.forEach(function (ln) {
      var p = findProduct(ln.productId);
      var pr = p && ln.promoId ? promoById(p, ln.promoId) : null;
      if (pr && pr.type === 'gift' && ln.qty >= (pr.minQty || 1) && ln.unitPrice == null) {
        gifts.push({ name: pr.giftName || 'Quà tặng', qty: pr.giftQty || 1, unit: null, productId: null, fromPromo: true });
      }
    });
    return { rows: rows, subtotal: subtotal, total: total, gifts: gifts };
  }

  /* ------------------------------------------------------------------ */
  /* Vẽ màn hình xác nhận                                                 */
  /* ------------------------------------------------------------------ */
  var PAY_LABELS = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', debt: 'Ghi nợ', partial: 'Trả một phần' };

  function renderVoiceConfirm() {
    if (!draft) return;
    if (draft.kind === 'debt_payment') { renderDebtPaymentDraft(); return; }
    var calc = calcDraft();
    var body = document.getElementById('voice-confirm-body');
    document.getElementById('voice-confirm-title').textContent = 'Xác nhận đơn hàng';
    var html = '<div class="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-[14px] text-slate-600 mb-3">Sổ nghe: <b class="text-slate-900">“' + esc(draft.heard) + '”</b></div>';
    html += '<div id="voice-confirm-hint"></div>';

    calc.rows.forEach(function (r, i) {
      var ln = r.ln, p = r.p;
      var productOptions = '<option value="">— Chọn món —</option>' + db.products.map(function (x) {
        return '<option value="' + x.id + '"' + (x.id === ln.productId ? ' selected' : '') + '>' + esc(x.name) + '</option>';
      }).join('') + '<option value="__new">➕ Món mới…</option>';
      var special = p && ln.unitPrice != null;
      var promoChips = '';
      if (p && (p.promos || []).length) {
        promoChips = '<div class="flex flex-wrap gap-1.5 mt-2">' + p.promos.map(function (x) {
          var ok = ln.qty >= (x.minQty || 1) && ln.unitPrice == null;
          var on = ln.promoId === x.id && ok;
          return '<button ' + (ok ? '' : 'disabled') + ' onclick="voiceTogglePromoDraft(' + i + ',\'' + x.id + '\')" class="px-2.5 py-1.5 rounded-full text-[13px] font-bold border ' +
            (on ? 'bg-[#0B7A60] text-white border-[#0B7A60]' : (ok ? 'bg-white text-[#0B7A60] border-[#0B7A60]' : 'bg-slate-100 text-slate-400 border-slate-200')) + '">🎁 ' + esc(promoLabel(x)) + (ok && !on ? ' · đủ điều kiện' : '') + '</button>';
        }).join('') + '</div>';
      }
      var newCard = '';
      if (!p && ln.newItem) {
        var ni = ln.newItem;
        var sugg = (ln.candidates || []).map(findProduct).filter(Boolean);
        newCard = '<div class="mt-2 p-3 rounded-xl bg-amber-50 border border-amber-300">' +
          '<div class="text-[15px] font-extrabold text-amber-900 mb-2">SẢN PHẨM MỚI — Kiểm tra giá và chọn cách lưu</div>' +
          (sugg.length ? '<div class="text-[13px] text-amber-800 mb-2">Giống món đã có? ' + sugg.map(function (sp) { return '<button onclick="voiceSetProduct(' + i + ',\'' + sp.id + '\')" class="underline font-bold mr-2">' + esc(sp.name) + '</button>'; }).join('') + '</div>' : '') +
          '<div class="grid grid-cols-2 gap-2">' +
          '<div class="col-span-2"><div class="text-[12px] font-bold text-slate-600 mb-1">Tên sản phẩm</div><input type="text" value="' + esc(ni.name) + '" onchange="voiceNewItemField(' + i + ',\'name\',this.value)" class="w-full px-2 py-2 bg-white border border-slate-300 rounded-lg text-[15px] font-bold" /></div>' +
          '<div><div class="text-[12px] font-bold text-slate-600 mb-1">Đơn vị tính</div><input type="text" value="' + esc(ni.unit) + '" onchange="voiceNewItemField(' + i + ',\'unit\',this.value)" class="w-full px-2 py-2 bg-white border border-slate-300 rounded-lg text-[15px]" placeholder="bịch, ly..." /></div>' +
          '<div><div class="text-[12px] font-bold text-slate-600 mb-1">Giá bán' + (ni.price ? '' : ' (bắt buộc)') + '</div><input type="text" inputmode="numeric" value="' + (ni.price ? Number(ni.price).toLocaleString('vi-VN') : '') + '" onchange="voiceNewItemField(' + i + ',\'price\',this.value)" class="w-full px-2 py-2 bg-white border ' + (ni.price ? 'border-slate-300' : 'border-red-400') + ' rounded-lg text-[15px] font-extrabold" placeholder="Nhập giá" /></div>' +
          '<div><div class="text-[12px] font-bold text-slate-600 mb-1">Giá vốn (nếu có)</div><input type="text" inputmode="numeric" value="' + esc(ni.cost) + '" onchange="voiceNewItemField(' + i + ',\'cost\',this.value)" class="w-full px-2 py-2 bg-white border border-slate-300 rounded-lg text-[15px]" /></div>' +
          '<div><div class="text-[12px] font-bold text-slate-600 mb-1">Danh mục</div><select onchange="voiceNewItemField(' + i + ',\'category\',this.value)" class="w-full px-2 py-2 bg-white border border-slate-300 rounded-lg text-[14px]">' + categoryOptions(ni.category) + '</select></div>' +
          '</div>' +
          '<div class="grid grid-cols-2 gap-2 mt-3">' +
          '<button onclick="voiceNewItemMode(' + i + ',\'once\')" class="py-2.5 rounded-xl text-[14px] font-extrabold border ' + (ni.mode === 'once' ? 'bg-[#0B7A60] text-white border-[#0B7A60]' : 'bg-white text-slate-700 border-slate-300') + '">A. Chỉ bán lần này</button>' +
          '<button onclick="voiceNewItemMode(' + i + ',\'menu\')" class="py-2.5 rounded-xl text-[14px] font-extrabold border ' + (ni.mode === 'menu' ? 'bg-[#0B7A60] text-white border-[#0B7A60]' : 'bg-white text-slate-700 border-slate-300') + '">B. Thêm vào menu</button></div>' +
          '<div class="text-[12px] text-slate-600 mt-1.5">' + (ni.mode === 'once' ? 'Chỉ lưu vào lịch sử đơn này, không thêm vào danh mục, không trừ kho.' : 'Lưu vào Bảng Giá & Tồn Kho để lần sau bán lại (tồn kho bắt đầu là 0, bạn nhập thêm sau).') + '</div></div>';
      }
      html += '<div class="p-3 rounded-2xl border ' + ((p || ln.newItem) ? 'border-slate-200' : 'border-amber-300 bg-amber-50') + ' mb-2.5">' +
        '<div class="flex items-center gap-2"><select onchange="voiceSetProduct(' + i + ',this.value)" class="flex-1 min-w-0 px-2 py-2 bg-white border border-slate-200 rounded-xl text-[16px] font-extrabold text-slate-900">' + productOptions + '</select>' +
        '<button onclick="voiceRemoveLine(' + i + ')" class="w-9 h-9 rounded-full bg-red-50 text-red-500 font-bold text-[18px] shrink-0">×</button></div>' +
        ((p || ln.newItem) ? '' : '<div class="text-[13px] text-amber-700 font-semibold mt-1">Sổ chưa chắc là món nào, bạn chọn giùm nghen.</div>') +
        newCard +
        '<div class="grid grid-cols-2 gap-2 mt-2">' +
        '<div><div class="text-[12px] font-bold text-slate-500 mb-1">Số lượng' + (ln.unit ? ' (' + esc(ln.unit) + ')' : '') + '</div><div class="flex items-center gap-1.5">' +
        '<button onclick="voiceQty(' + i + ',-1)" class="w-9 h-9 rounded-lg bg-white border border-slate-300 font-bold text-[18px]">-</button>' +
        '<input type="number" step="any" min="0" value="' + ln.qty + '" onchange="voiceQtyInput(' + i + ',this.value)" class="w-full min-w-0 px-1 py-1.5 text-center bg-white border border-slate-200 rounded-lg text-[17px] font-extrabold" />' +
        '<button onclick="voiceQty(' + i + ',1)" class="w-9 h-9 rounded-lg bg-[#0B7A60] text-white font-bold text-[18px]">+</button></div></div>' +
        '<div><div class="text-[12px] font-bold text-slate-500 mb-1">Đơn giá</div><input type="text" inputmode="numeric" value="' + (r.unit ? Math.round(r.unit).toLocaleString('vi-VN') : '') + '" ' + ((!p && ln.newItem) ? 'disabled' : '') + ' onchange="voicePriceInput(' + i + ',this.value)" class="w-full px-2 py-1.5 bg-white border ' + (special ? 'border-amber-400 text-amber-700' : 'border-slate-200 text-[#0B7A60]') + ' rounded-lg text-[17px] font-extrabold" /></div></div>' +
        (special ? '<div class="mt-1.5 text-[14px] text-amber-800 font-extrabold"><span class="px-2 py-0.5 rounded-full bg-amber-200">GIÁ RIÊNG</span> giá niêm yết ' + vnd(p.price) + ' <button onclick="voiceResetPrice(' + i + ')" class="underline ml-1 font-bold">Quay lại giá gốc</button></div>' : '') +
        (ln.priceGuess ? '<div class="mt-1 text-[13px] text-amber-700">Sổ hiểu giá là ' + vnd(r.unit) + ' — bạn kiểm tra lại nghen.</div>' : '') +
        promoChips +
        '<div class="flex justify-between items-center mt-2 pt-2 border-t border-slate-100"><span class="text-[14px] text-slate-500">Thành tiền</span><span class="text-[19px] font-black text-[#0B7A60]">' + vnd(r.total) + '</span></div></div>';
    });

    calc.gifts.forEach(function (g, j) {
      html += '<div class="flex items-center justify-between p-2.5 rounded-xl bg-amber-50 border border-amber-200 mb-2.5"><span class="text-[14px] font-bold text-amber-800">🎁 Tặng: ' + g.qty + ' ' + esc(g.unit || '') + ' ' + esc(g.name) + ' <span class="font-extrabold">0đ</span></span>' +
        (g.fromPromo ? '' : '<button onclick="voiceRemoveGift(' + j + ')" class="w-8 h-8 rounded-full bg-white text-red-500 font-bold">×</button>') + '</div>';
    });

    // Giảm giá cả đơn
    html += '<div class="mt-1 p-2.5 rounded-xl bg-slate-50 border border-slate-200"><div class="text-[12px] font-bold text-slate-500 mb-1">Giảm giá cả đơn</div><div class="flex gap-1.5">' +
      ['none', 'amount', 'percent'].map(function (t) {
        var lab = t === 'none' ? 'Không' : (t === 'amount' ? 'Giảm đ' : 'Giảm %');
        return '<button onclick="voiceSetDiscountType(\'' + t + '\')" class="flex-1 py-2 rounded-lg text-[14px] font-bold border ' + (draft.discount.type === t ? 'bg-[#0B7A60] text-white border-[#0B7A60]' : 'bg-white text-slate-700 border-slate-300') + '">' + lab + '</button>';
      }).join('') + '</div>' +
      (draft.discount.type !== 'none' ? '<input type="text" inputmode="numeric" value="' + (draft.discount.value || '') + '" onchange="voiceSetDiscountValue(this.value)" placeholder="' + (draft.discount.type === 'percent' ? 'Giảm bao nhiêu %' : 'Giảm bao nhiêu đồng') + '" class="mt-1.5 w-full px-2 py-2 bg-white border border-slate-300 rounded-lg text-[16px] font-bold" />' : '') + '</div>';

    // Hình thức thanh toán
    html += '<div class="mt-3"><div class="text-[12px] font-bold text-slate-500 mb-1">Hình thức thanh toán</div><div class="grid grid-cols-2 gap-1.5">' +
      ['cash', 'transfer', 'debt', 'partial'].map(function (m) {
        var on = draft.payment === m;
        var col = m === 'debt' ? (on ? 'bg-red-600 text-white border-red-600' : 'bg-white text-red-600 border-red-300') : (on ? 'bg-[#0B7A60] text-white border-[#0B7A60]' : 'bg-white text-slate-700 border-slate-300');
        return '<button onclick="voiceSetPayment(\'' + m + '\')" class="py-2.5 rounded-xl text-[15px] font-extrabold border ' + col + '">' + PAY_LABELS[m] + '</button>';
      }).join('') + '</div>' +
      (draft.payment === 'partial' ? '<div class="mt-1.5"><div class="text-[12px] font-bold text-slate-500 mb-1">Khách trả trước (phần còn lại ghi nợ)</div><input type="text" inputmode="numeric" value="' + (draft.paid ? Number(draft.paid).toLocaleString('vi-VN') : '') + '" onchange="voiceSetPaid(this.value)" class="w-full px-2 py-2 bg-white border border-slate-300 rounded-lg text-[16px] font-extrabold" /></div>' : '') + '</div>';

    // Khách
    var needCust = draft.payment === 'debt' || draft.payment === 'partial';
    var opts = '<option value="">' + (needCust ? '— Chọn khách (bắt buộc) —' : 'Khách vãng lai') + '</option>';
    db.customers.forEach(function (c) { opts += '<option value="' + c.id + '"' + (c.id === draft.customerId ? ' selected' : '') + '>' + esc(custLabel(c)) + '</option>'; });
    if (draft.newCustomer && draft.customerName) opts += '<option value="__new" selected>➕ Khách mới: ' + esc(draft.customerName) + '</option>';
    html += '<div class="mt-3"><div class="text-[12px] font-bold text-slate-500 mb-1">Khách' + (draft.customerCandidates.length > 1 ? ' <span class="text-red-600">— có ' + draft.customerCandidates.length + ' khách trùng tên, chọn đúng người</span>' : '') + '</div>' +
      '<select onchange="voiceSetCustomer(this.value)" class="w-full px-2 py-2.5 bg-white border ' + ((needCust && !draft.customerId && !draft.newCustomer) || draft.customerCandidates.length > 1 ? 'border-red-400' : 'border-slate-200') + ' rounded-xl text-[16px] font-semibold text-slate-800">' + opts + '</select>' +
      (draft.payment !== 'cash' && draft.payment !== 'transfer' ? '' : '') + '</div>';

    if (draft.payment === 'debt' || draft.payment === 'partial') {
      html += '<div class="mt-2 p-2.5 rounded-xl bg-red-50 border border-red-200 text-[14px] text-red-800 font-bold">Đơn này ghi vào SỔ NỢ' + (draft.customerName ? ' của ' + esc(draft.customerName) : '') + ', không tính là tiền mặt đã thu.' +
        (draft.payment === 'partial' ? ' Còn nợ: ' + vnd(Math.max(0, calc.total - (Number(draft.paid) || 0))) : '') + '</div>';
    }
    body.innerHTML = html;
    document.getElementById('voice-confirm-total').textContent = vnd(calc.total);
    var cartBtn = document.getElementById('voice-confirm-cart');
    if (cartBtn) cartBtn.classList.remove('hidden');
    updateModeBar();
  }

  function categoryOptions(sel) {
    var cats = {};
    db.products.forEach(function (p) { if (p.category) cats[p.category] = 1; });
    var el = document.getElementById('prod-input-category');
    if (el) for (var i = 0; i < el.options.length; i++) cats[el.options[i].value] = 1;
    var list = Object.keys(cats);
    return '<option value="">— Chọn —</option>' + list.map(function (c) { return '<option value="' + esc(c) + '"' + (c === sel ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
  }

  /* ------------------------------------------------------------------ */
  /* Chỉnh sửa trên bản nháp (mọi thao tác đều dừng đếm ngược tự động)     */
  /* ------------------------------------------------------------------ */
  function touched() { stopAuto(true); stopListen(); }
  function rerender() { renderVoiceConfirm(); }

  window.voiceSetProduct = function (i, id) {
    touched();
    var ln = draft.lines[i];
    if (id === '__new') {
      ln.productId = null;
      ln.newItem = ln.newItem || { name: ln.phrase || '', unit: ln.unit || '', price: ln.unitPrice, cost: '', category: '', mode: 'once' };
    } else {
      ln.productId = id || null; ln.changedProduct = !!id;
      if (id) ln.newItem = null;
    }
    ln.unitPrice = null; ln.promoId = null; ln.priceKind = null; ln.priceGuess = false;
    rerender();
  };
  window.voiceNewItemField = function (i, f, v) {
    touched();
    var ni = draft.lines[i].newItem; if (!ni) return;
    if (f === 'price' || f === 'cost') {
      var n = parseInt(String(v).replace(/[^\d]/g, '') || '0', 10);
      if (f === 'price' && n > 0 && n < 1000) n *= 1000;
      ni[f] = n > 0 ? n : (f === 'cost' ? '' : null);
    } else ni[f] = v;
    rerender();
  };
  window.voiceNewItemMode = function (i, m) { touched(); draft.lines[i].newItem.mode = m; rerender(); };
  window.voiceQty = function (i, d) { touched(); var ln = draft.lines[i]; ln.qty = Math.max(0.5, Math.round((ln.qty + d) * 100) / 100); rerender(); };
  window.voiceQtyInput = function (i, v) { touched(); var n = parseFloat(String(v).replace(',', '.')); draft.lines[i].qty = n > 0 ? Math.round(n * 100) / 100 : 1; rerender(); };
  window.voicePriceInput = function (i, v) {
    touched();
    var ln = draft.lines[i]; var p = findProduct(ln.productId);
    var n = parseInt(String(v).replace(/[^\d]/g, '') || '0', 10);
    if (n > 0 && n < 1000) n *= 1000;
    ln.unitPrice = (p && (n <= 0 || n === p.price)) ? null : (n > 0 ? n : null);
    ln.priceKind = ln.unitPrice != null ? 'special' : null;
    ln.priceGuess = false;
    if (ln.unitPrice != null) ln.promoId = null;
    rerender();
  };
  window.voiceResetPrice = function (i) { touched(); var ln = draft.lines[i]; ln.unitPrice = null; ln.priceKind = null; ln.priceGuess = false; rerender(); };
  window.voiceTogglePromoDraft = function (i, pid) { touched(); var ln = draft.lines[i]; ln.promoId = ln.promoId === pid ? null : pid; draft.promoAuto = false; rerender(); };
  window.voiceRemoveLine = function (i) { touched(); draft.lines.splice(i, 1); if (!draft.lines.length) { voiceCancelDraft(); return; } rerender(); };
  window.voiceRemoveGift = function (j) { touched(); draft.gifts.splice(j, 1); rerender(); };
  window.voiceSetPayment = function (m) { touched(); draft.payment = m; if (m !== 'partial') draft.paid = null; rerender(); };
  window.voiceSetPaid = function (v) { touched(); var n = parseInt(String(v).replace(/[^\d]/g, '') || '0', 10); if (n > 0 && n < 1000) n *= 1000; draft.paid = n || null; rerender(); };
  window.voiceSetDiscountType = function (t) { touched(); draft.discount = { type: t, value: 0 }; rerender(); };
  window.voiceSetDiscountValue = function (v) {
    touched();
    var n = parseFloat(String(v).replace(/[^\d.]/g, '')) || 0;
    if (draft.discount.type === 'amount' && n > 0 && n < 1000) n *= 1000;
    if (draft.discount.type === 'percent') n = Math.min(100, n);
    draft.discount.value = n; rerender();
  };
  window.voiceSetCustomer = function (v) {
    touched();
    if (!v) { draft.customerId = null; draft.customerName = null; draft.newCustomer = false; }
    else if (v === '__new') { draft.newCustomer = true; }
    else { var c = findCustomer(v); draft.customerId = v; draft.customerName = c ? c.name : null; draft.newCustomer = false; draft.customerCandidates = []; }
    rerender();
  };

  window.voiceCancelDraft = function () {
    stopAuto(); stopListen();
    closeSheet('voice-confirm');
    if (draft && draft.logId) logUpdate(draft.logId, { status: 'dismissed' });
    draft = null;
    committing = false;
  };
  window.closeVoiceConfirm = function () { closeSheet('voice-confirm'); };

  /* ------------------------------------------------------------------ */
  /* Học cách gọi (chỉ học từ kết quả NGƯỜI DÙNG ĐÃ XÁC NHẬN)              */
  /* ------------------------------------------------------------------ */
  function aliasSafe(key, productId) {
    var toks = key.split(' ');
    return !db.products.some(function (p) {
      if (p.id === productId) return false;
      var pt = VoiceOrder.tokenize(p.name).map(function (t) { return typeof t === 'number' ? String(t) : VoiceOrder.fold(t); });
      return toks.every(function (t) { return pt.indexOf(t) >= 0; });
    });
  }
  function learnAlias(ln, productId) {
    if (!ln.phrase || !productId) return;
    var p = findProduct(productId);
    if (!p) return;
    var key = VoiceOrder.aliasKey(ln.phrase);
    if (!key || key.length < 4 || /^[\d\s.]+$/.test(key) || key.split(' ').length > 4) return;
    if (key === VoiceOrder.aliasKey(p.name)) return;
    if (aliasMap()[key] === p.id) return;
    var plain = VoiceOrder.matchProduct(VoiceOrder.tokenize(ln.phrase), db.products, null);
    if (!ln.changedProduct && plain.product && plain.product.id === p.id) return;
    if (!aliasSafe(key, p.id)) return;
    db.voiceAliases = db.voiceAliases || {};
    db.voiceAliases[key] = p.id;
    var keys = Object.keys(db.voiceAliases);
    if (keys.length > 300) delete db.voiceAliases[keys[0]];
  }
  function learnCustomerAlias(customerId) {
    if (!draft || !draft.spokenCustomer || !customerId) return;
    var c = findCustomer(customerId);
    if (!c) return;
    var spoken = String(draft.spokenCustomer).trim();
    if (!spoken || VoiceOrder.customerKeys(c).indexOf(VoiceOrder.customerKeys({ name: spoken })[0]) >= 0) return;
    var nicks = String(c.nickname || '').split(';').map(function (x) { return x.trim(); }).filter(Boolean);
    if (nicks.indexOf(spoken) < 0) { nicks.push(spoken); c.nickname = nicks.join('; '); }
  }

  /* ------------------------------------------------------------------ */
  /* Xác nhận & lưu (một cửa duy nhất, chống bấm 2 lần)                    */
  /* ------------------------------------------------------------------ */
  function buildPayload() {
    var calc = calcDraft();
    var items = [];
    calc.rows.forEach(function (r) {
      var ln = r.ln, p = r.p;
      var base = { qty: ln.qty, unit: ln.unit, price: r.final, listPrice: r.list, promoId: ln.promoId };
      if (p) items.push(Object.assign({ productId: p.id, name: p.name }, base));
      else items.push(Object.assign({ productId: null, name: ln.newItem.name, cost: Number(ln.newItem.cost) || 0 }, base));
    });
    calc.gifts.forEach(function (g) { items.push({ productId: g.productId || null, name: '🎁 ' + g.name, qty: g.qty, unit: g.unit, gift: true }); });
    return { calc: calc, items: items };
  }

  function validateDraft() {
    if (!draft.lines.length) return 'Đơn đang trống';
    for (var i = 0; i < draft.lines.length; i++) {
      var ln = draft.lines[i];
      if (!ln.productId && !ln.newItem) return 'Bạn chọn món cho dòng ' + (i + 1) + ' giùm Sổ nghen!';
      if (!(ln.qty > 0)) return 'Số lượng dòng ' + (i + 1) + ' chưa đúng';
      if (!ln.productId && ln.newItem && !(Number(ln.newItem.price) > 0)) return 'Món mới "' + ln.newItem.name + '" chưa có giá — bạn cho Sổ biết giá nghen!';
      if (!ln.productId && ln.newItem && !String(ln.newItem.name).trim()) return 'Món mới chưa có tên';
    }
    if (draft.customerCandidates.length > 1 && !draft.customerId) return 'Có nhiều khách trùng tên, bạn chọn đúng người giùm Sổ';
    if ((draft.payment === 'debt' || draft.payment === 'partial') && !draft.customerId && !(draft.newCustomer && draft.customerName)) return 'Ghi nợ thì cần chọn khách nghen!';
    if (draft.payment === 'partial' && !(Number(draft.paid) > 0)) return 'Bạn nhập số tiền khách trả trước giùm Sổ';
    return null;
  }

  window.confirmVoiceDraft = function () {
    if (!draft || committing) return;
    if (draft.kind === 'debt_payment') { commitDebtPayment(); return; }
    var err = validateDraft();
    if (err) { stopAuto(true); notifyAndroid(err); return; }
    committing = true;
    stopAuto(); stopListen();

    // Món mới -> "Thêm vào menu"
    draft.lines.forEach(function (ln) {
      if (!ln.productId && ln.newItem && ln.newItem.mode === 'menu') {
        var ni = ln.newItem;
        var exist = db.products.find(function (p) { return SooiCore.fold(p.name) === SooiCore.fold(ni.name); });
        if (exist) { ln.productId = exist.id; ln.newItem = null; return; }
        var np = {
          id: 'p_' + Date.now() + '_' + Math.floor(Math.random() * 1000), name: String(ni.name).trim(), price: Number(ni.price), cost: Number(ni.cost) || 0,
          stock: 0, category: ni.category || '', desc: ni.category || '', unit: ni.unit || '', promos: [], img: ''
        };
        db.products.unshift(np);
        ln.productId = np.id; ln.newItem = null; ln.unitPrice = null;
      }
    });

    var pl = buildPayload();
    var res = SooiCore.commitOrder(db, {
      clientTxId: draft.id, items: pl.items, customerId: draft.customerId, customerName: draft.customerName,
      createCustomer: !!draft.newCustomer, payment: draft.payment, paid: draft.paid, source: 'voice', heard: draft.heard
    });
    if (!res.ok) {
      committing = false;
      notifyAndroid(res.error || 'Không lưu được đơn');          // KHÔNG phát giọng "thành công"
      renderVoiceConfirm();
      return;
    }
    var order = res.order;
    draft.lines.forEach(function (ln) { if (ln.productId) learnAlias(ln, ln.productId); });
    learnCustomerAlias(order && order.customerId);
    if (draft.logId) logUpdate(draft.logId, { status: 'confirmed', summary: order ? order.items.map(function (i) { return i.name + ' ×' + i.quantity; }).join(', ') : '' });
    saveDB();
    var d = draft;
    closeSheet('voice-confirm');
    draft = null; committing = false;
    refreshAllScreens();
    if (res.duplicate) { notifyAndroid('Đơn này đã được lưu rồi, Sổ không lưu thêm.'); return; }
    announceOrderSaved(order);
  };

  window.voiceToCart = function () {
    if (!draft || draft.kind !== 'sale') return;
    var err = validateDraft(); if (err) { notifyAndroid(err); return; }
    stopAuto(); stopListen();
    draft.lines.forEach(function (ln) {
      var p = findProduct(ln.productId);
      if (!p) return;
      currentCart[p.id] = Math.round(((currentCart[p.id] || 0) + ln.qty) * 100) / 100;
      if (ln.unitPrice != null) cartExtras.price[p.id] = ln.unitPrice;
      if (ln.promoId) cartExtras.promo[p.id] = ln.promoId;
    });
    draft.gifts.forEach(function (g) { cartExtras.gifts.push({ name: g.name, qty: g.qty, unit: g.unit, productId: g.productId || null }); });
    if (draft.customerName) cartExtras.customer = draft.customerName;
    closeSheet('voice-confirm'); draft = null;
    switchTab('pos'); renderPosProducts(); updatePosCartBadges(); openCartDrawer();
  };

  function announceOrderSaved(order) {
    var amount = order.paymentMethod === 'debt' ? order.owed : order.total;
    if (order.paymentMethod === 'debt') {
      showTxResult({ kind: 'debt', title: 'ĐÃ GHI NỢ', amount: order.owed, sub: order.customerName + ' · đơn ' + order.id });
      sooiAnnounce('Đã ghi nợ cho ' + order.customerName + ' ' + moneySpeech(order.owed) + '.');
    } else if (order.paymentMethod === 'partial') {
      showTxResult({ kind: 'partial', title: 'ĐÃ NHẬN ' + vnd(order.paid).toUpperCase() + ' — CÒN NỢ', amount: order.owed, sub: order.customerName + ' · đơn ' + order.id });
      sooiAnnounce('Đã nhận ' + moneySpeech(order.paid) + ' tiền mặt. Còn nợ ' + moneySpeech(order.owed) + ' của ' + order.customerName + '.');
    } else if (order.paymentMethod === 'transfer') {
      // Chưa có xác nhận ngân hàng -> chỉ hiện mã QR, KHÔNG đọc "đã nhận chuyển khoản"
      showTxResult({ kind: 'pending', title: 'CHỜ CHUYỂN KHOẢN', amount: order.total, sub: 'Bấm "Đã nhận tiền" khi thấy tiền về tài khoản' });
      if (typeof openQrModal === 'function') openQrModal(order.total, order.customerName, order.id);
      if (typeof installTransferConfirm === 'function') installTransferConfirm(order.id);
    } else {
      showTxResult({ kind: 'cash', title: 'ĐÃ NHẬN TIỀN MẶT', amount: order.total, sub: 'Đơn ' + order.id });
      sooiAnnounce('Đã nhận ' + moneySpeech(order.total) + '.');
    }
  }
  window.announceOrderSaved = announceOrderSaved;

  function sooiAnnounce(text) {
    if (typeof playChimeSound === 'function' && speakEnabled()) { try { playChimeSound(); } catch (e) { /* bỏ qua */ } }
    window.sooiSpeak(text);
  }
  window.sooiAnnounce = sooiAnnounce;

  /* ------------------------------------------------------------------ */
  /* Thu nợ ("Dì Sáu trả nợ hai chục")                                     */
  /* ------------------------------------------------------------------ */
  function startDebtPayment(cls, text, opts) {
    var c = cls.customer;
    if (!c || !c.id) {
      showDebtSheet(null);
      return 'Sổ chưa thấy khách "' + (c ? c.name : '?') + '" trong sổ nợ. Bạn chọn đúng khách ở bảng bên dưới nghen.';
    }
    openDebtPaymentDraft({ customerId: c.id, customerName: c.name, amount: cls.amount, payAll: cls.payAll, heard: text });
    return 'Dạ Sổ hiểu là ' + c.name + ' TRẢ NỢ (không phải bán hàng). Bạn kiểm tra rồi xác nhận nghen!';
  }

  function openDebtPaymentDraft(info) {
    ensureModals();
    stopAuto(); stopListen(); committing = false;
    var c = findCustomer(info.customerId);
    var cands = [];
    if (c) {
      var same = SooiCore.findCustomersByName(db, c.name);
      if (same.length > 1) cands = same.map(function (x) { return x.id; });
    }
    var debt = c ? Math.max(0, SooiCore.ledgerSum(db, c.id)) : 0;
    draft = { id: newTxId(), kind: 'debt_payment', heard: info.heard || '', logId: null, customerId: cands.length > 1 ? null : (c ? c.id : null),
      customerCandidates: cands, amount: info.payAll ? debt : (info.amount || null), flagged: false, discount: { type: 'none', value: 0 }, lines: [], gifts: [] };
    renderVoiceConfirm();
    openSheet('voice-confirm');
    startConfirmFlow();
  }

  function renderDebtPaymentDraft() {
    var body = document.getElementById('voice-confirm-body');
    document.getElementById('voice-confirm-title').textContent = 'Xác nhận THU NỢ';
    var c = findCustomer(draft.customerId);
    var debt = c ? Math.max(0, SooiCore.ledgerSum(db, c.id)) : 0;
    var amount = Number(draft.amount) || 0;
    var rest = debt - amount;
    var opts = '<option value="">— Chọn khách —</option>' + db.customers.filter(function (x) { return SooiCore.ledgerSum(db, x.id) > 0; }).map(function (x) {
      return '<option value="' + x.id + '"' + (x.id === draft.customerId ? ' selected' : '') + '>' + esc(custLabel(x)) + ' — nợ ' + vnd(SooiCore.ledgerSum(db, x.id)) + '</option>';
    }).join('');
    var html = '<div class="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-[14px] text-slate-600 mb-3">Sổ nghe: <b class="text-slate-900">“' + esc(draft.heard) + '”</b></div><div id="voice-confirm-hint"></div>' +
      '<div class="p-3 rounded-2xl border border-[#B9E9D7] bg-[#ECFBF2]"><div class="text-[13px] font-bold text-[#0B7A60] mb-1">KHÁCH TRẢ NỢ — không tạo nợ mới</div>' +
      '<select onchange="debtPaySetCustomer(this.value)" class="w-full px-2 py-2.5 bg-white border ' + (draft.customerId ? 'border-slate-200' : 'border-red-400') + ' rounded-xl text-[16px] font-bold">' + opts + '</select>' +
      '<div class="flex justify-between mt-2 text-[15px]"><span class="text-slate-600">Đang nợ</span><b class="text-red-600">' + vnd(debt) + '</b></div>' +
      '<div class="mt-2"><div class="text-[12px] font-bold text-slate-500 mb-1">Số tiền khách trả</div><input type="text" inputmode="numeric" value="' + (amount ? amount.toLocaleString('vi-VN') : '') + '" onchange="debtPaySetAmount(this.value)" class="w-full px-2 py-2.5 bg-white border border-slate-300 rounded-lg text-[20px] font-black text-[#0B7A60]" /></div>' +
      (amount > debt && debt > 0 ? '<div class="mt-2 text-[14px] font-bold text-red-600">Số tiền trả lớn hơn số nợ (' + vnd(debt) + '). Bạn kiểm tra lại nghen.</div>' : '') +
      (amount > 0 && amount <= debt ? '<div class="flex justify-between mt-2 text-[15px]"><span class="text-slate-600">Còn nợ sau khi trả</span><b>' + vnd(rest) + '</b></div>' : '') +
      '</div>';
    body.innerHTML = html;
    document.getElementById('voice-confirm-total').textContent = vnd(amount);
    var cartBtn = document.getElementById('voice-confirm-cart'); if (cartBtn) cartBtn.classList.add('hidden');
    updateModeBar();
  }
  window.debtPaySetCustomer = function (v) { touched(); draft.customerId = v || null; draft.customerCandidates = []; rerender(); };
  window.debtPaySetAmount = function (v) {
    touched();
    var n = parseInt(String(v).replace(/[^\d]/g, '') || '0', 10);
    if (n > 0 && n < 1000) n *= 1000;
    draft.amount = n || null; rerender();
  };

  function commitDebtPayment() {
    var c = findCustomer(draft.customerId);
    if (!c) { notifyAndroid('Bạn chọn khách trả nợ giùm Sổ nghen!'); return; }
    if (!(Number(draft.amount) > 0)) { notifyAndroid('Bạn nhập số tiền khách trả giùm Sổ nghen!'); return; }
    committing = true; stopAuto(); stopListen();
    var res = SooiCore.recordDebtPayment(db, { clientTxId: draft.id, customerId: draft.customerId, amount: draft.amount });
    if (!res.ok) { committing = false; notifyAndroid(res.error || 'Không ghi được khoản thu nợ'); renderVoiceConfirm(); return; }
    saveDB();
    closeSheet('voice-confirm');
    draft = null; committing = false;
    refreshAllScreens();
    if (res.duplicate) { notifyAndroid('Khoản trả nợ này đã được ghi rồi.'); return; }
    showTxResult({ kind: 'settle', title: 'ĐÃ THU NỢ', amount: res.amount, sub: res.customer.name + ' · còn nợ ' + vnd(res.remaining) });
    sooiAnnounce('Đã nhận ' + moneySpeech(res.amount) + ' tiền trả nợ của ' + res.customer.name + '.');
  }

  /* ------------------------------------------------------------------ */
  /* Ba chế độ xác nhận                                                   */
  /* ------------------------------------------------------------------ */
  function readbackText() {
    if (!draft) return '';
    if (draft.kind === 'debt_payment') {
      var c = findCustomer(draft.customerId);
      return (c ? c.name : 'Khách') + ' trả nợ ' + moneySpeech(Number(draft.amount) || 0) + '. Đúng không?';
    }
    var calc = calcDraft();
    var parts = calc.rows.map(function (r) {
      var nm = r.p ? r.p.name : (r.ln.newItem ? r.ln.newItem.name : 'món chưa rõ');
      return r.ln.qty + ' ' + (r.ln.unit ? r.ln.unit + ' ' : '') + nm;
    });
    var pay = draft.payment === 'debt' ? ' Ghi nợ' + (draft.customerName ? ' cho ' + draft.customerName : '') + '.' :
      (draft.payment === 'transfer' ? ' Thanh toán chuyển khoản.' : (draft.payment === 'partial' ? ' Trả trước ' + moneySpeech(Number(draft.paid) || 0) + ', còn lại ghi nợ.' : ''));
    return parts.join(', ') + '. Tổng cộng ' + moneySpeech(calc.total) + '.' + pay + ' Đúng không?';
  }

  function autoReasons() {
    var r = [];
    if (!draft) return ['Không có đơn'];
    if (draft.kind === 'debt_payment') {
      var c = findCustomer(draft.customerId);
      if (!c) r.push('Chưa rõ khách trả nợ');
      else {
        var debt = SooiCore.ledgerSum(db, c.id);
        if (!(Number(draft.amount) > 0)) r.push('Chưa rõ số tiền');
        else if (draft.amount > debt) r.push('Số tiền trả lớn hơn số nợ');
      }
      if (draft.customerCandidates.length > 1) r.push('Có nhiều khách trùng tên');
      return r;
    }
    draft.lines.forEach(function (ln) {
      if (!ln.productId && !ln.newItem) r.push('Chưa rõ món');
      if (!ln.productId && ln.newItem) r.push('Món mới cần bạn quyết định');
      if (!(ln.qty > 0)) r.push('Chưa rõ số lượng');
      if (ln.priceGuess) r.push('Giá Sổ đoán, cần kiểm tra');
      if ((ln.candidates || []).length > 1 && !ln.viaAlias && !ln.productId) r.push('Món nghe mơ hồ');
    });
    var calc = calcDraft();
    if (draft.lines.some(function (ln) { return ln.productId && lineUnit(ln, findProduct(ln.productId)) <= 0 && ln.unitPrice == null; })) r.push('Thiếu giá');
    if (draft.payment === 'debt' || draft.payment === 'partial') {
      if (!draft.customerId) r.push(draft.newCustomer ? 'Khách nợ mới chưa xác định' : 'Chưa chọn khách ghi nợ');
    }
    if (draft.customerCandidates.length > 1 && !draft.customerId) r.push('Có nhiều khách trùng tên');
    if (draft.flagged) r.push('Nhận dạng chưa chắc chắn');
    if (draft.promoAuto || calc.gifts.length || draft.lines.some(function (ln) { return ln.promoId; })) r.push('Có khuyến mãi/quà tặng chưa xác nhận');
    if (draft.discount.type !== 'none' && draft.discount.value > 0) r.push('Có giảm giá chưa xác nhận');
    if (draft.payment === 'partial' && !(Number(draft.paid) > 0)) r.push('Chưa rõ tiền trả trước');
    return r;
  }

  function confirmMode() {
    var m = S().confirmMode;
    return (m === 'voice' || m === 'auto') ? m : 'manual';
  }

  function startConfirmFlow() {
    if (!draft) return;
    var mode = confirmMode();
    var reasons = autoReasons();
    var text = readbackText();
    if (mode === 'auto') {
      if (!reasons.length) { startAuto(); window.sooiSpeak(text.replace(/ Đúng không\?$/, '')); }
      else { setHint('Cần bạn kiểm tra trước khi lưu: ' + reasons[0] + ' (không tự động lưu).', 'warn'); window.sooiSpeak(text); }
    } else if (mode === 'voice') {
      var myDraft = draft;
      window.sooiSpeak(text, function () { if (draft === myDraft && !reasons.length) startListen(); else if (draft === myDraft) setHint('Cần bạn kiểm tra: ' + reasons[0], 'warn'); });
    } else {
      window.sooiSpeak(text);
    }
    updateModeBar();
  }

  function setHint(msg, kind) {
    var el = document.getElementById('voice-confirm-hint');
    if (!el) return;
    el.innerHTML = msg ? '<div class="mb-2 p-2.5 rounded-xl text-[14px] font-bold ' + (kind === 'warn' ? 'bg-amber-50 border border-amber-300 text-amber-900' : 'bg-[#ECFBF2] border border-[#B9E9D7] text-[#0B7A60]') + '">' + esc(msg) + '</div>' : '';
  }

  function updateModeBar() {
    var bar = document.getElementById('voice-confirm-modebar');
    if (!bar) return;
    var mode = confirmMode();
    var txt = '';
    if (auto.timer) txt = '⏱ Tự lưu sau ' + auto.left + ' giây — chạm Sửa/Hủy để dừng';
    else if (listen.active) txt = '🎤 Đang nghe: nói “đúng rồi” để chốt, “sửa lại” để sửa';
    else if (mode === 'voice') txt = 'Chế độ nói: nói “đúng rồi” / “sửa lại” hoặc chạm nút';
    else if (mode === 'auto') txt = 'Chế độ tự động đã dừng — bấm Xác nhận để lưu';
    bar.textContent = txt;
    bar.classList.toggle('hidden', !txt);
    var okBtn = document.getElementById('voice-confirm-ok');
    if (okBtn) okBtn.textContent = auto.timer ? 'Xác nhận ngay (' + auto.left + ')' : (draft && draft.kind === 'debt_payment' ? 'Xác nhận thu nợ' : 'Xác nhận & lưu');
  }

  function startAuto() {
    stopAuto();
    var secs = parseInt(S().autoSeconds, 10); if (!(secs >= 2 && secs <= 15)) secs = 5;
    auto.left = secs; auto.total = secs;
    var myDraft = draft;
    auto.timer = setInterval(function () {
      if (draft !== myDraft || !draft) { stopAuto(); return; }
      auto.left--;
      if (auto.left <= 0) {
        var reasons = autoReasons();
        stopAuto();
        if (!reasons.length && !committing) window.confirmVoiceDraft();
        else { setHint('Không tự lưu vì: ' + reasons[0], 'warn'); updateModeBar(); }
        return;
      }
      updateModeBar();
    }, 1000);
    updateModeBar();
  }
  function stopAuto(userTouched) {
    if (auto.timer) {
      clearInterval(auto.timer); auto.timer = null;
      if (userTouched) setHint('Đã dừng tự xác nhận. Bạn sửa xong bấm Xác nhận nghen.', 'info');
    }
    updateModeBar();
  }
  window.voiceStopAuto = function () { stopAuto(true); };

  function startListen() {
    if (!draft) return;
    listen.active = true; listen.tries = 0;
    updateModeBar();
    try {
      if (typeof voiceSendHints === 'function') voiceSendHints();
      if (typeof setMicPulseUI === 'function') setMicPulseUI(true);
      isListening = true;
      if (typeof startNativeOrWebSpeechFallback === 'function') startNativeOrWebSpeechFallback();
    } catch (e) { listen.active = false; updateModeBar(); }
    clearTimeout(listen.timer);
    listen.timer = setTimeout(function () { if (listen.active) handleConfirmReply(''); }, 12000);   // không ai nói gì
  }
  function stopListen() {
    var was = listen.active;
    listen.active = false; clearTimeout(listen.timer);
    if (was) { try { if (window.AndroidBridge && AndroidBridge.stopVoiceRecognition) AndroidBridge.stopVoiceRecognition(); } catch (e) { /* bỏ qua */ } stopMicUi(); }
    updateModeBar();
  }

  /** Câu trả lời xác nhận bằng giọng nói. Ưu tiên phủ định/sửa; không hiểu thì hỏi lại. */
  function handleConfirmReply(text) {
    if (!draft) { stopListen(); return; }
    clearTimeout(listen.timer);
    listen.active = false; updateModeBar();
    var lowT = String(text || '').toLowerCase();
    var c = VoiceIntent.parseConfirmation(text);

    // khuyến mãi / giảm giá nói trong lúc xác nhận
    if (draft.kind === 'sale' && /(giảm|bớt)/.test(lowT) && c.intent !== 'cancel') {
      var pct = /(phần trăm|%)/.test(lowT);
      var amt = VoiceIntent.extractMoney(text);
      var num = VoiceOrder.tokenize(text).filter(function (t) { return typeof t === 'number'; })[0];
      if (pct && num) { draft.discount = { type: 'percent', value: Math.min(100, num) }; }
      else if (amt) { draft.discount = { type: 'amount', value: amt }; }
      rerender(); startConfirmFlow(); return;
    }
    if (draft.kind === 'sale' && /(áp dụng|lấy)\s*khuyến\s*mãi/.test(lowT)) {
      draft.lines.forEach(function (ln) { var p = findProduct(ln.productId); if (p) { var pr = bestPromoFor(p, ln.qty, false); if (pr && ln.unitPrice == null) ln.promoId = pr.id; } });
      draft.promoAuto = false; rerender(); startConfirmFlow(); return;
    }
    if (c.intent === 'yes') { window.confirmVoiceDraft(); return; }
    if (c.intent === 'cancel') { window.voiceCancelDraft(); return; }
    if (c.intent === 'edit' && c.qty != null && draft.kind === 'sale') {
      if (draft.lines.length === 1) { draft.lines[0].qty = c.qty; rerender(); startConfirmFlow(); return; }
      setHint('Có nhiều món, bạn chạm vào món cần sửa số lượng nghen.', 'warn');
      window.sooiSpeak('Có nhiều món, bạn chạm vào món cần sửa nghen.');
      return;
    }
    if (c.intent === 'edit' || c.intent === 'no') {
      setHint('Bạn sửa trực tiếp trên màn hình rồi bấm Xác nhận nghen.', 'info');
      window.sooiSpeak('Dạ bạn sửa lại giúp Sổ nghen.');
      return;
    }
    // không rõ -> hỏi lại (tối đa 2 lần)
    listen.tries++;
    if (listen.tries >= 2) { setHint('Sổ chưa nghe rõ. Bạn chạm nút Xác nhận hoặc Sửa nghen.', 'warn'); return; }
    var myDraft = draft;
    window.sooiSpeak('Sổ chưa rõ. Bạn nói đúng rồi để chốt, hoặc sửa lại nghen.', function () { if (draft === myDraft) { listen.active = true; startListen2(); } });
  }
  function startListen2() { var t = listen.tries; startListen(); listen.tries = t; }

  // Móc vào executeAiCommand: nếu đang chờ xác nhận bằng giọng nói thì câu nói là câu trả lời
  window.voiceConfirmHook = function (text) {
    if (!draft || !listen.active) return false;
    handleConfirmReply(text);
    return true;
  };

  /* ------------------------------------------------------------------ */
  /* Thông báo cuối ngày                                                  */
  /* ------------------------------------------------------------------ */
  function ensureDailyCard() {
    var card = document.getElementById('voice-daily-card');
    if (card) return card;
    var anchor = document.getElementById('insight-title');
    var section = anchor && anchor.closest('section');
    if (!section) return null;
    card = document.createElement('section');
    card.id = 'voice-daily-card';
    card.className = 'bg-white rounded-[22px] p-4 border border-amber-200/80 shadow-xs hidden';
    section.parentNode.insertBefore(card, section.nextSibling);
    return card;
  }

  window.renderVoiceDailyNotice = function () {
    var card = ensureDailyCard();
    if (!card) return;
    var today = todayStr();
    var rows = (db.voiceLog || []).filter(function (e) { return e.date === today && e.status !== 'dismissed'; });
    var pendingRows = rows.filter(function (e) { return e.status === 'noisy' || e.status === 'chosen'; });
    if (!rows.length) {
      card.classList.add('hidden');
      try { if (window.AndroidBridge && AndroidBridge.updateDailyReminder) AndroidBridge.updateDailyReminder(today, 0); } catch (_) {}
      return;
    }
    var pending = pendingRows.length;
    try { if (window.AndroidBridge && AndroidBridge.updateDailyReminder) AndroidBridge.updateDailyReminder(today, pending); } catch (_) {}
    card.innerHTML =
      '<div class="flex items-start gap-3"><div class="w-11 h-11 rounded-2xl bg-amber-50 flex items-center justify-center shrink-0 text-amber-600"><span class="material-symbols-outlined text-[24px]">graphic_eq</span></div>' +
      '<div class="flex-1"><h4 class="text-[16px] font-bold text-[#0F172A] leading-snug">Thông báo cuối ngày</h4>' +
      '<p class="text-[14px] text-[#64748B] mt-0.5">' + (pending ? 'Bạn có ' + pending + ' câu nói chưa được xác nhận.' : 'Các câu nói bị nhiễu hôm nay đã xác nhận hết.') + '</p></div></div>' +
      '<div class="mt-2.5 space-y-2">' + rows.slice(0, 6).map(function (e) {
        var mark = e.status === 'confirmed' ? '✅' : (e.status === 'chosen' ? '⏳' : '⚠️');
        var text = e.status === 'confirmed' ? 'Đã xác nhận: ' + esc(e.summary || e.chosen || '')
          : (e.status === 'chosen' ? 'Bạn chọn “' + esc(e.chosen || '') + '” nhưng chưa xác nhận đơn' : 'Nghe được: “' + esc((e.heard || [])[0] || '(không rõ)') + '” - chưa xác nhận');
        var btn = (e.status === 'noisy' || e.status === 'chosen') ?
          '<div class="flex gap-1.5 mt-1"><button onclick="voiceReview(\'' + e.id + '\')" class="px-3 py-1.5 rounded-lg bg-[#0B7A60] text-white text-[13px] font-bold">Xem lại & xác nhận</button><button onclick="voiceDiscardLog(\'' + e.id + '\')" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-[13px] font-bold">Bỏ qua</button></div>' : '';
        return '<div class="text-[14px] text-slate-700 leading-snug"><span class="text-slate-400">' + esc(e.time) + '</span> ' + mark + ' ' + text + btn + '</div>';
      }).join('') + '</div>';
    card.classList.remove('hidden');

    // Sau 20h: nhắc 1 lần/ngày bằng thông báo Android (cần quyền thông báo)
    try {
      var h = new Date().getHours();
      if (h >= 20 && pending > 0 && localStorage.getItem('sooi_voice_notice_day') !== today) {
        localStorage.setItem('sooi_voice_notice_day', today);
        var msg = 'Bạn có ' + pending + ' câu nói chưa được xác nhận. Mở Sổ ơi để xem lại nghen!';
        if (window.AndroidBridge && typeof AndroidBridge.showNotification === 'function') AndroidBridge.showNotification('Sổ ơi', msg);
        else notifyAndroid(msg);
      }
    } catch (e) { /* bỏ qua */ }
  };

  window.voiceReview = function (logId) {
    var e = (db.voiceLog || []).find(function (x) { return x.id === logId; });
    if (!e) return;
    if (e.status === 'chosen' && e.chosen) {
      var r = window.voiceRoute(e.chosen, { fromNoise: true, logId: logId });
      if (r.handled) return;
    }
    showNoise(e.heard || [], '', logId);
  };
  window.voiceDiscardLog = function (logId) { logUpdate(logId, { status: 'dismissed' }); renderVoiceDailyNotice(); };

  /* ------------------------------------------------------------------ */
  /* Quản lý "Từ Sổ đã học" (xem / sửa / xoá)                              */
  /* ------------------------------------------------------------------ */
  window.openVoiceLearned = function () {
    ensureModals();
    renderVoiceLearned();
    openSheet('voice-learned');
  };
  window.closeVoiceLearned = function () { closeSheet('voice-learned'); };
  function renderVoiceLearned() {
    var al = db.voiceAliases || {};
    var keys = Object.keys(al);
    var html = '<p class="text-[13px] text-slate-500 mb-2">Đây là những cách gọi Sổ đã ghi nhớ sau khi bạn <b>xác nhận</b> đơn. Đây là bộ nhớ so khớp cách gọi, không phải huấn luyện mô hình AI. Sai chỗ nào, bạn sửa hoặc xoá chỗ đó.</p>';
    html += '<div class="text-[14px] font-extrabold text-slate-800 mt-2 mb-1">Cách gọi món</div>';
    if (!keys.length) html += '<div class="text-[13px] text-slate-400 mb-2">Chưa học cách gọi nào.</div>';
    keys.forEach(function (k) {
      var p = findProduct(al[k]);
      var opts = db.products.map(function (x) { return '<option value="' + x.id + '"' + (x.id === al[k] ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('');
      html += '<div class="p-2 rounded-xl border border-slate-200 mb-1.5"><div class="text-[14px] font-bold text-slate-900">“' + esc(k) + '”</div>' +
        '<div class="flex gap-1.5 mt-1"><select onchange="voiceAliasRemap(\'' + esc(k).replace(/'/g, '\\\'') + '\',this.value)" class="flex-1 min-w-0 px-2 py-1.5 border border-slate-200 rounded-lg text-[13px]">' + opts + '</select>' +
        '<button onclick="voiceAliasDelete(\'' + esc(k).replace(/'/g, '\\\'') + '\')" class="px-3 rounded-lg bg-red-50 text-red-600 font-bold text-[13px]">Xoá</button></div>' +
        (p ? '' : '<div class="text-[12px] text-red-500">Món này đã bị xoá khỏi danh mục</div>') + '</div>';
    });
    html += '<div class="text-[14px] font-extrabold text-slate-800 mt-3 mb-1">Biệt danh khách</div>';
    var withNick = db.customers.filter(function (c) { return c.nickname; });
    if (!withNick.length) html += '<div class="text-[13px] text-slate-400">Chưa có biệt danh nào.</div>';
    withNick.forEach(function (c) {
      html += '<div class="p-2 rounded-xl border border-slate-200 mb-1.5"><div class="text-[14px] font-bold">' + esc(c.name) + '</div>' +
        '<input type="text" value="' + esc(c.nickname) + '" onchange="voiceNicknameSet(\'' + c.id + '\',this.value)" class="mt-1 w-full px-2 py-1.5 border border-slate-200 rounded-lg text-[13px]" placeholder="Các biệt danh, cách nhau dấu ;" /></div>';
    });
    if (keys.length) html += '<button onclick="voiceAliasClear()" class="mt-3 w-full py-2.5 rounded-xl bg-red-50 text-red-600 font-bold text-[14px]">Xoá tất cả cách gọi đã học</button>';
    document.getElementById('voice-learned-body').innerHTML = html;
  }
  window.voiceAliasDelete = function (k) { delete db.voiceAliases[k]; saveDB(); renderVoiceLearned(); };
  window.voiceAliasRemap = function (k, id) { db.voiceAliases[k] = id; saveDB(); renderVoiceLearned(); };
  window.voiceAliasClear = function () { if (confirm('Xoá hết các cách gọi Sổ đã học?')) { db.voiceAliases = {}; saveDB(); renderVoiceLearned(); } };
  window.voiceNicknameSet = function (id, v) { var c = findCustomer(id); if (c) { c.nickname = String(v || '').trim(); saveDB(); renderVoiceLearned(); } };

  /* ------------------------------------------------------------------ */
  /* Khung hộp thoại bottom sheet                                         */
  /* ------------------------------------------------------------------ */
  function openSheet(name) {
    var b = document.getElementById(name + '-backdrop');
    var p = document.getElementById(name + '-panel');
    if (!b || !p) return;
    b.classList.remove('opacity-0', 'pointer-events-none');
    b.classList.add('opacity-100');
    p.classList.remove('translate-y-full');
    p.classList.add('translate-y-0');
  }
  function closeSheet(name) {
    var b = document.getElementById(name + '-backdrop');
    var p = document.getElementById(name + '-panel');
    if (!b || !p) return;
    p.classList.remove('translate-y-0');
    p.classList.add('translate-y-full');
    b.classList.remove('opacity-100');
    b.classList.add('opacity-0', 'pointer-events-none');
  }
  window.sooiOpenSheet = openSheet;
  window.sooiCloseSheet = closeSheet;

  function sheetShell(name, titleHtml, bodyId, footerHtml, maxH) {
    return '<div id="' + name + '-backdrop" class="fixed inset-0 bg-black/50 z-[60] opacity-0 pointer-events-none transition-opacity duration-300 flex items-end justify-center">' +
      '<div id="' + name + '-panel" class="w-full max-w-[430px] bg-white rounded-t-[28px] ' + (maxH || 'max-h-[92vh]') + ' flex flex-col translate-y-full transition-transform duration-300 p-5 shadow-2xl">' +
      '<div class="flex items-center justify-between pb-3 border-b border-slate-100">' + titleHtml + '</div>' +
      '<div id="' + bodyId + '" class="pt-3 overflow-y-auto flex-1"></div>' + footerHtml + '</div></div>';
  }

  function ensureModals() {
    if (document.getElementById('voice-confirm-backdrop')) return;
    var wrap = document.createElement('div');
    wrap.innerHTML =
      sheetShell('voice-confirm',
        '<h3 id="voice-confirm-title" class="text-[20px] font-extrabold text-slate-900">Xác nhận đơn hàng</h3><button onclick="voiceCancelDraft()" class="w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center font-bold text-[18px]">×</button>',
        'voice-confirm-body',
        '<div class="pt-3 mt-1 border-t border-slate-100"><div id="voice-confirm-modebar" class="hidden mb-2 px-3 py-2 rounded-xl bg-[#ECFBF2] text-[#0B7A60] text-[14px] font-bold"></div>' +
        '<div class="flex items-center justify-between mb-2"><span class="text-[15px] font-bold text-slate-600">Tổng cộng</span><span id="voice-confirm-total" class="text-[26px] font-black text-[#0B7A60]">0đ</span></div>' +
        '<div class="grid grid-cols-3 gap-2"><button onclick="voiceCancelDraft()" class="py-3.5 rounded-xl bg-slate-100 text-slate-700 font-bold text-[16px] active:scale-95">Hủy</button>' +
        '<button onclick="voiceStopAuto()" class="py-3.5 rounded-xl bg-amber-100 text-amber-800 font-bold text-[16px] active:scale-95">Sửa</button>' +
        '<button id="voice-confirm-ok" onclick="confirmVoiceDraft()" class="py-3.5 rounded-xl bg-[#0B7A60] text-white font-bold text-[16px] active:scale-95 shadow-sm">Xác nhận & lưu</button></div>' +
        '<button id="voice-confirm-cart" onclick="voiceToCart()" class="w-full mt-2 py-2 text-[13px] font-bold text-slate-500 underline">Đưa vào giỏ hàng (chưa thanh toán)</button></div>') +

      sheetShell('voice-noise',
        '<span class="px-3 py-1.5 rounded-full bg-amber-100 text-amber-800 text-[15px] font-extrabold">🔊 ' + NOISE_LABEL + '</span>', 'voice-noise-body',
        '<div class="grid grid-cols-2 gap-2 pt-2"><button onclick="voiceNoiseDismiss()" class="py-3 rounded-xl bg-slate-100 text-slate-700 font-bold text-[15px] active:scale-95">Hủy</button>' +
        '<button onclick="voiceNoiseRetry()" class="py-3 rounded-xl bg-[#0B7A60] text-white font-bold text-[15px] active:scale-95">Nói lại</button></div>', 'max-h-[85vh]') +

      sheetShell('debt-sheet', '<h3 class="text-[20px] font-extrabold text-slate-900">Khách còn nợ</h3><button onclick="closeDebtSheet()" class="w-9 h-9 rounded-full bg-slate-100 text-slate-500 font-bold text-[18px]">×</button>', 'debt-sheet-body',
        '<div class="pt-3 mt-1 border-t border-slate-100"><div class="flex items-center justify-between mb-2"><span class="text-[15px] font-bold text-slate-600">Tổng công nợ</span><span id="debt-sheet-total" class="text-[24px] font-black text-red-600">0đ</span></div>' +
        '<button onclick="closeDebtSheet()" class="w-full py-3.5 rounded-xl bg-[#0B7A60] text-white font-bold text-[16px] active:scale-95">Đóng</button></div>') +

      sheetShell('voice-learned', '<h3 class="text-[18px] font-extrabold text-slate-900">Từ Sổ đã học</h3><button onclick="closeVoiceLearned()" class="w-9 h-9 rounded-full bg-slate-100 text-slate-500 font-bold text-[18px]">×</button>', 'voice-learned-body',
        '<button onclick="closeVoiceLearned()" class="mt-2 w-full py-3 rounded-xl bg-[#0B7A60] text-white font-bold text-[15px]">Đóng</button>', 'max-h-[88vh]');
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

    // Mọi thao tác trong phần nội dung đơn = người bán đang sửa -> dừng đếm ngược / dừng nghe
    var body = document.getElementById('voice-confirm-body');
    ['input', 'change', 'click', 'focusin'].forEach(function (ev) {
      body.addEventListener(ev, function () { if (auto.timer) stopAuto(true); if (listen.active) stopListen(); }, true);
    });
  }
  window.sooiEnsureModals = ensureModals;

  /* ------------------------------------------------------------------ */
  /* Thông báo hoàn tất to rõ                                              */
  /* ------------------------------------------------------------------ */
  var resultTimer = null;
  window.showTxResult = function (o) {
    var el = document.getElementById('tx-result-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tx-result-overlay';
      el.className = 'fixed inset-0 z-[80] flex items-center justify-center bg-black/55 hidden';
      el.onclick = function () { el.classList.add('hidden'); };
      document.body.appendChild(el);
    }
    var colors = { cash: '#0B7A60', transfer: '#0B7A60', settle: '#0B7A60', debt: '#DC2626', partial: '#D97706', pending: '#D97706' };
    var col = colors[o.kind] || '#0B7A60';
    el.innerHTML = '<div class="w-[88%] max-w-[380px] bg-white rounded-[28px] p-6 text-center shadow-2xl">' +
      '<div class="mx-auto w-16 h-16 rounded-full flex items-center justify-center text-white text-[34px]" style="background:' + col + '">' + (o.kind === 'debt' ? '✎' : (o.kind === 'pending' ? '…' : '✓')) + '</div>' +
      '<div class="mt-3 text-[18px] font-extrabold text-slate-700">' + esc(o.title) + '</div>' +
      '<div class="mt-1 text-[40px] leading-tight font-black" style="color:' + col + '">' + vnd(o.amount) + '</div>' +
      (o.sub ? '<div class="mt-1 text-[15px] text-slate-500">' + esc(o.sub) + '</div>' : '') +
      '<button class="mt-4 w-full py-3.5 rounded-xl text-white font-bold text-[17px]" style="background:' + col + '">Xong</button></div>';
    el.classList.remove('hidden');
    clearTimeout(resultTimer);
    if (o.kind !== 'pending') resultTimer = setTimeout(function () { el.classList.add('hidden'); }, 3500);
  };

  document.addEventListener('DOMContentLoaded', function () {
    ensureModals();
    setTimeout(function () { if (typeof renderVoiceDailyNotice === 'function') renderVoiceDailyNotice(); }, 0);
  });
})();
