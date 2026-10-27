/**
 * Sổ ơi - Phân loại ý định câu nói (thuần JS, không đụng DOM, test được bằng node).
 *
 *   classify(text, ctx)       -> { kind, payment, amount, customer, cleaned }
 *       kind: 'query_debt' | 'query_sales' | 'query_stock' | 'query_other'
 *             'debt_payment' (khách trả nợ) | 'cash_cmd' (chi/thu thường) | 'sale' | 'unknown'
 *   parseConfirmation(text)   -> { intent: 'yes'|'no'|'edit'|'cancel'|'unclear', qty? }
 *   detectPayment(text)       -> { mode: 'cash'|'transfer'|'debt'|'partial'|null, paid?, cleaned }
 *   extractMoney(text|tokens) -> số đồng | null
 *
 * Đây là bộ luật + so khớp (rule-based), KHÔNG phải mô hình học máy được huấn luyện.
 */
(function (root) {
  'use strict';
  var VO = (typeof require === 'function' && typeof module !== 'undefined') ? require('./voice_parser.js') : root.VoiceOrder;

  function fold(s) { return VO.fold(s); }
  function ftoks(text) { return fold(text).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean); }
  function has(re, s) { return re.test(s); }

  /* ------------------------------------------------------------------ */
  /* Tiền                                                                 */
  /* ------------------------------------------------------------------ */
  var K = ['ngàn', 'nghìn', 'nghin', 'ngan', 'nghàn', 'ngìn', 'k', 'ka', 'kê', 'cành'];
  var M = ['triệu', 'tr', 'củ'];
  var D1 = ['đồng', 'đ', 'd', 'vnd', 'vnđ'];
  var XI = ['xị', 'xí'];

  /** Lấy số tiền (đồng) từ danh sách token đã gộp số. Bối cảnh tiền: số trần < 1000 hiểu là ngàn. */
  function moneyFromTokens(toks) {
    for (var i = 0; i < toks.length; i++) {
      var n = toks[i];
      if (typeof n !== 'number') continue;
      var nx = toks[i + 1];
      var after = toks[i + 2];
      if (typeof nx === 'string' && M.indexOf(nx) >= 0) {
        var v = n * 1e6;
        if (typeof after === 'number') {
          if (after < 10) v += after * 1e5; else if (after < 100) v += after * 1e4; else if (after < 1000) v += after * 1e3;
        }
        return Math.round(v);
      }
      if (typeof nx === 'string' && K.indexOf(nx) >= 0) {
        var w = n * 1000;
        if (typeof after === 'number' && after < 10 && Number.isInteger(n)) w += after * 100;
        return Math.round(w);
      }
      if (typeof nx === 'string' && XI.indexOf(nx) >= 0) return Math.round(n * 1e5);
      if (typeof nx === 'string' && D1.indexOf(nx) >= 0) return Math.round(n);
      if (n >= 1000) return Math.round(n);
      if (n > 0) return Math.round(n * 1000);
    }
    return null;
  }
  function extractMoney(x) {
    return moneyFromTokens(Array.isArray(x) ? x : VO.tokenize(x));
  }

  /* ------------------------------------------------------------------ */
  /* Hình thức thanh toán                                                 */
  /* ------------------------------------------------------------------ */
  var DEBT_RE = /(ghi\s*n[ợo]|ghi\s*s[ổo]|ghi\s*v[ôo]\s*s[ổo]|ghi\s*v[àa]o\s*s[ổo]|cho\s*thi[ếe]u|để\s*thi[ếe]u|thi[ếe]u\s*l[ạa]i|để\s*n[ợo]|cho\s*n[ợo]|n[ợo]\s*l[ạa]i|bữa\s*sau\s*tr[ảa]|bữa\s*khác\s*tr[ảa]|mai\s*tr[ảa]|mốt\s*tr[ảa]|mua\s*ch[ịi]u|cho\s*ch[ịi]u|ch[ịi]u\s*nha|ch[ịi]u\s*nghen|\bch[ịi]u\b|\bthi[ếe]u\b)/gi;
  var TRANSFER_RE = /(chuyển\s*khoản|chuyển\s*ngân\s*hàng|quét\s*mã|quét\s*qr|\bqr\b|\bck\b)/gi;
  var CASH_RE = /(tiền\s*mặt)/gi;

  function detectPayment(text) {
    var s = String(text || '').normalize('NFC').toLowerCase();
    var res = { mode: null, paid: null, cleaned: s };
    // trả trước / trả một phần, còn lại ghi nợ
    var partial = /(tr[ảa]\s*tr[ưu][ớo]c|đưa\s*tr[ưu][ớo]c|đặt\s*c[ọo]c|tr[ảa]\s*(bớt|một\s*phần)|đưa\s*(bớt|một\s*phần))/.test(s) ||
      (/còn\s*l[ạa]i/.test(s) && /(ghi|n[ợo]|thi[ếe]u|ch[ịi]u|s[ổo])/.test(s));
    var hasDebt = DEBT_RE.test(s); DEBT_RE.lastIndex = 0;
    var hasTrans = TRANSFER_RE.test(s); TRANSFER_RE.lastIndex = 0;
    var hasCash = CASH_RE.test(s); CASH_RE.lastIndex = 0;
    if (partial && (hasDebt || /còn\s*l[ạa]i/.test(s) || /tr[ảa]\s*tr[ưu][ớo]c|đưa\s*tr[ưu][ớo]c|đặt\s*c[ọo]c/.test(s))) {
      // số tiền đã trả = số tiền đứng ngay sau cụm "trả/đưa ..."
      var m = s.match(/(?:tr[ảa]|đưa)\s*(?:tr[ưu][ớo]c|bớt|một\s*phần)?\s*(.{0,24}?)(?=,|\.|\s+c[òo]n\s|\s+ph[ầa]n\s|$)/);
      var paid = m ? extractMoney(m[1]) : null;
      res.mode = 'partial'; res.paid = paid;
    } else if (hasDebt) res.mode = 'debt';
    else if (hasTrans) res.mode = 'transfer';
    else if (hasCash) res.mode = 'cash';
    // bỏ cụm tín hiệu thanh toán để bộ phân tích món không nhầm thành tên món
    s = s.replace(DEBT_RE, ' ').replace(TRANSFER_RE, ' ').replace(CASH_RE, ' ');
    s = s.replace(/(tr[ảa]\s*tr[ưu][ớo]c|đưa\s*tr[ưu][ớo]c|còn\s*l[ạa]i)/g, ' ');
    res.cleaned = s.replace(/\s+/g, ' ').trim();
    return res;
  }

  /* ------------------------------------------------------------------ */
  /* Xác nhận / phủ định                                                  */
  /* ------------------------------------------------------------------ */
  var AFFIRM_STRONG = ['dung', 'chinh', 'xac', 'duoc', 'ok', 'okay', 'oke', 'chot', 'xacnhan', 'dongy', 'dong', 'y', 'chuan', 'phai', 'u', 'uh', 'um', 'vang', 'da', 'roi', 'vay', 'dc', 'yes', 'dungroi'];
  var AFFIRM_FILLER = ['nghen', 'nhen', 'nhe', 'nha', 'nhe', 'di', 'don', 'luon', 'a', 'o', 'ne', 'do', 'chu', 'ban', 'luu', 'ghi', 'tinh', 'xong', 'thoi', 'cho', 'so', 'oi', 'minh', 'nhu', 'tren', 'cung', 'nay', 'hen', 'vay'];
  var NEG_TOKENS = ['khong', 'hong', 'ko', 'chua', 'sai', 'nham', 'khoan', 'sua', 'doi', 'thieu', 'du', 'them', 'bot', 'lon', 'nho', 'khac', 'lai'];
  var CANCEL_RE = /(huy|bo qua|thoi khong ban|khong ban nua|dung ban|thoi dung|bo di|xoa don)/;

  function parseConfirmation(text) {
    var f = fold(text).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!f) return { intent: 'unclear' };
    var toks = f.split(' ');
    var out = { intent: 'unclear' };

    if (CANCEL_RE.test(f) && !/khong\s+huy/.test(f)) return { intent: 'cancel' };

    var hasNeg = toks.some(function (t) { return NEG_TOKENS.indexOf(t) >= 0; });
    var hasSua = /(sua|doi|them|bot)/.test(f);
    // Sửa thành N ...
    var mQty = null;
    if (hasSua || hasNeg) {
      var nums = VO.tokenize(text).filter(function (t) { return typeof t === 'number' && t > 0 && t < 1000; });
      if (nums.length) mQty = nums[nums.length - 1];
    }
    if (hasNeg) {
      // "không phải/ chưa đúng/ sai rồi/ khoan" -> cần sửa. Câu phủ định LUÔN ưu tiên hơn từ đồng ý ("Ừ nhưng sai số lượng").
      if (/(khong\s+sao|khong\s+co\s+gi)/.test(f)) { /* "không sao" không phải phủ định đơn hàng */ }
      else {
        out.intent = (hasSua || /sai|nham|khong dung|khong phai|chua dung|chua phai|khoan|thieu|du/.test(f)) ? 'edit' : 'no';
        if (mQty != null && hasSua) out.qty = mQty;
        return out;
      }
    }
    if (hasSua) { out.intent = 'edit'; if (mQty != null) out.qty = mQty; return out; }

    // Đồng ý: toàn bộ câu chỉ gồm từ đồng ý + từ đệm, có ít nhất 1 từ đồng ý mạnh
    var strong = 0, unknown = 0;
    toks.forEach(function (t) {
      if (AFFIRM_STRONG.indexOf(t) >= 0) strong++;
      else if (AFFIRM_FILLER.indexOf(t) < 0) unknown++;
    });
    if (strong > 0 && unknown === 0 && toks.length <= 7) return { intent: 'yes' };
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Phân loại ý định                                                     */
  /* ------------------------------------------------------------------ */
  function findKnownCustomer(text, customers) {
    var toks = VO.tokenize(text);
    var c = VO.extractCustomer(toks, customers || []);
    return { customer: c, rest: toks };
  }

  function classify(text, ctx) {
    ctx = ctx || {};
    var raw = String(text || '').normalize('NFC');
    var f = fold(raw);
    var res = { kind: 'unknown', payment: null, amount: null, customer: null, cleaned: raw.toLowerCase(), question: false };
    if (!f.trim()) return res;

    var pay = detectPayment(raw);
    res.payment = pay;

    var kc = findKnownCustomer(raw, ctx.customers);
    res.customer = kc.customer;
    var hasQMark = /\?/.test(raw);
    // Dùng chữ CÓ DẤU để không nhầm "nhiều đá" với "nhiêu", "máy" với "mấy"
    var lowRaw = raw.toLowerCase();
    var isInterrog = /(\bai\b|khách nào|\bnào\b|bao nhiêu|bao nhieu|\bmấy\b|nhiêu|còn ai|có ai)/.test(lowRaw);

    // ---- Câu hỏi về nợ ----
    var debtWord = /(\bno\b|thieu|chiu|chua tra|cong no|so no|tien no|con thieu)/.test(f);
    var payNoWord = /(tra no|tra tien no|thu no|dong no|gui lai no|tra bot no|tra het no|tat toan)/.test(f);
    if (!payNoWord && debtWord && (isInterrog || hasQMark || /(con no|co ai no|ai con|khong\s*\??$|hong\s*\??$)/.test(f)) ) {
      res.kind = 'query_debt'; res.question = true; return res;
    }
    if (!payNoWord && /^(cong no|so no|xem no|coi no|danh sach no|no khach)/.test(f)) { res.kind = 'query_debt'; res.question = true; return res; }

    // ---- Câu hỏi doanh thu / kho ----
    if (/(ban duoc|doanh thu|thu duoc|thu bao nhieu|ban bao nhieu|ban nhieu|loi bao nhieu|lai bao nhieu|kiem duoc|dat khach|tong ket|ban may don|hom nay thu|bua nay thu)/.test(f) && (isInterrog || hasQMark || /(doanh thu|tong ket|dat khach)/.test(f))) {
      res.kind = 'query_sales'; res.question = true; return res;
    }
    if (/(con may|con bao nhieu|ton kho|sap het|het hang|mon nao het|con hang|kiem kho|trong kho)/.test(f) && !/^(ban|lay|cho)\b/.test(f)) {
      res.kind = 'query_stock'; res.question = true; return res;
    }
    // Câu hỏi nhưng không biết chủ đề -> KHÔNG tạo đơn, hỏi lại
    if (isInterrog || hasQMark) {
      // ngoại lệ: câu lệnh bán có kèm "nhiêu"? (hiếm) -> vẫn coi là hỏi để an toàn
      res.kind = 'query_other'; res.question = true; return res;
    }

    // ---- Khách trả nợ ----
    var amountTokens = kc.rest.slice();
    if (payNoWord || (/(^|\s)trả(\s|$)/.test(lowRaw) && res.customer && !res.customer.isNew && ctx.debtOf && ctx.debtOf(res.customer) > 0 && !(ctx.hasProduct && ctx.hasProduct(raw)))) {
      res.kind = 'debt_payment';
      res.amount = moneyFromTokens(amountTokens);
      res.payAll = /(het|tat ca|nguyen|tron)/.test(f) && res.amount == null;
      return res;
    }

    // ---- Chi / thu thường ----
    if (/^(chi|xai|thu|nhan|lum|bo ra|ton|tra tien)\b/.test(f.replace(/^(so oi|oi)\s+/, ''))) {
      res.kind = 'cash_cmd'; return res;
    }

    res.kind = 'sale';
    return res;
  }

  var api = {
    classify: classify, parseConfirmation: parseConfirmation, detectPayment: detectPayment,
    extractMoney: extractMoney, moneyFromTokens: moneyFromTokens
  };
  root.VoiceIntent = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
