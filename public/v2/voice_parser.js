/**
 * Sổ ơi - Bộ phân tích câu nói bán hàng (không cần "từ khoá" cố định).
 *
 * Hiểu được các kiểu nói như:
 *   "2 trà đường" | "trà đường 2" | "bán trà đường cho dì 6 2 ly"
 *   "trà đường 10 ngàn"                       -> giá giảm tức thời 10.000đ
 *   "1kg đường 20 ngàn, tính anh 19 ngàn"     -> giá người quen 19.000đ
 *   "mua nhiều tặng anh thêm bịt bánh mì 0đ"  -> tặng kèm
 *
 * File này thuần JavaScript (không đụng DOM) để chạy được cả trong WebView lẫn node (test).
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Tiện ích chuỗi                                                      */
  /* ------------------------------------------------------------------ */
  function fold(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D')
      .toLowerCase();
  }

  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        const c = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
      }
      const t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }

  function tokEq(a, b) {
    if (a === b) return true;
    if (/^\d/.test(a) || /^\d/.test(b)) return false;
    const L = Math.min(a.length, b.length);
    if (L >= 7) return lev(a, b) <= 2;
    if (L >= 4) return lev(a, b) <= 1;
    return false;
  }

  const isNum = (t) => typeof t === 'number';
  const roundN = (n) => Math.round(n * 100) / 100;

  /* ------------------------------------------------------------------ */
  /* Từ điển                                                              */
  /* ------------------------------------------------------------------ */
  const D = {
    'một': 1, 'mốt': 1, 'hai': 2, 'ba': 3, 'bốn': 4, 'tư': 4, 'năm': 5, 'lăm': 5, 'nhăm': 5,
    'sáu': 6, 'bảy': 7, 'bẩy': 7, 'tám': 8, 'chín': 9
  };
  const ONLY_AFTER_TENS = { 'mốt': 1, 'lăm': 1, 'nhăm': 1 };

  const MONEY_K = ['ngàn', 'nghìn', 'nghin', 'ngan', 'nghàn', 'ngìn', 'k', 'ka', 'kê', 'cành'];
  const MONEY_M = ['triệu', 'tr', 'củ'];
  const MONEY_1 = ['đồng', 'đ', 'd', 'vnd', 'vnđ'];
  const MONEY_XI = ['xị', 'xí'];

  const UNITS = ['kg', 'ký', 'kí', 'lạng', 'cân', 'gam', 'g', 'lít', 'l', 'ml', 'ly', 'cốc', 'chai', 'lon', 'bịch', 'bịt',
    'bọc', 'túi', 'gói', 'hộp', 'thùng', 'cái', 'phần', 'suất', 'dĩa', 'đĩa', 'tô', 'chén', 'ổ', 'miếng', 'trái',
    'quả', 'bó', 'chục', 'tá', 'cặp', 'vỉ', 'lố', 'bao', 'can', 'bình', 'cây', 'con', 'tờ', 'cuốn', 'quyển'];

  const KIN = ['dì', 'cô', 'chú', 'bác', 'anh', 'chị', 'em', 'ông', 'bà', 'mợ', 'cậu', 'thím', 'dượng', 'út'];

  const STOP = new Set(['bán', 'cho', 'lấy', 'làm', 'kêu', 'ghi', 'gọi', 'thêm', 'bỏ', 'vô', 'vào', 'giùm', 'dùm', 'giúp',
    'nghen', 'nhen', 'nhe', 'nha', 'nhé', 'hén', 'dạ', 'ạ', 'á', 'ơi', 'sổ', 'với', 'và', 'rồi', 'của', 'mua', 'đi', 'nè',
    'coi', 'tính', 'giá', 'còn', 'chỉ', 'thôi', 'bớt', 'giảm', 'trừ', 'tổng', 'cả', 'thảy', 'hết', 'tất', 'trọn', 'nguyên',
    'cộng', 'khách', 'người', 'quen', 'nay', 'hôm', 'bữa', 'nhiều', 'tặng', 'biếu', 'kèm', 'pct', 'là', 'thì', 'mà',
    'cái', 'một', 'ít', 'chút', 'xíu', 'nhờ', 'ê', 'này', 'đó', 'nhá', 'luôn', 'đơn', 'order', 'khuyến', 'mãi', 'ưu', 'đãi',
    'cần', 'muốn', 'xin', 'đặt', 'tụi', 'tui', 'tôi', 'mình']);

  const SPECIAL_CUES = ['tính', 'còn', 'chỉ', 'giá', 'thôi'];
  const DISCOUNT_CUES = ['bớt', 'giảm', 'trừ'];
  const TOTAL_CUES = ['tổng', 'thảy', 'hết', 'trọn', 'nguyên', 'cộng'];
  const GIFT_CUES = ['tặng', 'biếu', 'kèm'];
  const CONNECTORS = ['và', 'với', 'rồi', 'cộng'];
  const PROMO_CUE_RE = /(mua nhiều|khuyến mãi|ưu đãi|giảm giá|số lượng nhiều|mua sỉ|lấy sỉ)/;

  /* ------------------------------------------------------------------ */
  /* Số chữ -> số                                                         */
  /* ------------------------------------------------------------------ */
  function parseRun(tk, i) {
    const isD = (w) => Object.prototype.hasOwnProperty.call(D, w);
    if (tk[i] === 'nửa') {
      if (tk[i + 1] === 'chục') return { v: 5, n: 2 };
      if (tk[i + 1] === 'tá') return { v: 6, n: 2 };
      return { v: 0.5, n: 1 };
    }
    let j = i, h = 0, t = null, u = null, any = false, hasH = false, lẻ = false;

    if (isD(tk[j]) && tk[j + 1] === 'trăm') { h = D[tk[j]]; hasH = true; any = true; j += 2; }
    else if (tk[j] === 'trăm') { h = 1; hasH = true; any = true; j += 1; }

    if (hasH && (tk[j] === 'lẻ' || tk[j] === 'linh')) { lẻ = true; t = 0; j += 1; }

    if (tk[j] === 'mười') { t = 1; any = true; j += 1; }
    else if (tk[j] === 'hăm') { t = 2; any = true; j += 1; }
    else if (isD(tk[j]) && (tk[j + 1] === 'mươi' || tk[j + 1] === 'chục')) { t = D[tk[j]]; any = true; j += 2; }
    else if (tk[j] === 'chục') { t = 1; any = true; j += 1; }

    if (isD(tk[j])) {
      const w = tk[j];
      const okStandalone = !ONLY_AFTER_TENS[w] || (t !== null && t > 0) || lẻ;
      if (okStandalone) { u = D[w]; any = true; j += 1; }
    }
    if (!any) return null;

    let v;
    if (hasH && t === null && u !== null && !lẻ) v = h * 100 + u * 10;   // "hai trăm năm" = 250 (nói tắt)
    else v = h * 100 + (t || 0) * 10 + (u || 0);
    return { v: v, n: j - i };
  }

  function mergeNumbers(words) {
    const out = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (/^\d+(\.\d+)?$/.test(w)) { out.push(parseFloat(w)); continue; }
      if (w === 'không') {
        if (words[i + 1] === 'đồng' || words[i + 1] === 'đ') out.push(0); else out.push(w);
        continue;
      }
      const r = parseRun(words, i);
      if (r) { out.push(r.v); i += r.n - 1; continue; }
      out.push(w);
    }
    // "rưỡi": 1 ký rưỡi / 2 ngàn rưỡi / hai rưỡi
    const res = [];
    for (let i = 0; i < out.length; i++) {
      if (out[i] === 'rưỡi' || out[i] === 'rưởi') {
        // gắn vào số đứng trước (bỏ qua 1 từ đơn vị ở giữa)
        let k = res.length - 1;
        if (k >= 0 && !isNum(res[k]) && k - 1 >= 0 && isNum(res[k - 1])) k -= 1;
        if (k >= 0 && isNum(res[k])) { res[k] = roundN(res[k] + 0.5); continue; }
      }
      res.push(out[i]);
    }
    return res;
  }

  function tokenize(text) {
    let s = String(text == null ? '' : text).normalize('NFC').toLowerCase();
    s = s.replace(/(\d)[.,](\d{3})(?!\d)/g, '$1$2').replace(/(\d)[.,](\d{3})(?!\d)/g, '$1$2');
    s = s.replace(/(\d),(\d)/g, '$1.$2');
    // Dấu phẩy / chấm phẩy là ranh giới: "hai chục, hai chai" KHÔNG được gộp thành 22
    const out = [];
    s.split(/[,;]/).forEach((part) => {
      let q = part.replace(/%/g, ' pct ').replace(/phần\s+trăm/g, ' pct ');
      q = q.replace(/(\d)([^\d\s.])/g, '$1 $2').replace(/([^\d\s.])(\d)/g, '$1 $2');
      q = q.replace(/[^\p{L}\p{N}.\s]/gu, ' ');
      q = q.replace(/(^|[^\d])\./g, '$1 ').replace(/\.(?!\d)/g, ' ');
      mergeNumbers(q.split(/\s+/).filter(Boolean)).forEach((t) => out.push(t));
    });
    return out;
  }

  const foldTok = (t) => (isNum(t) ? String(t) : fold(t));

  /* ------------------------------------------------------------------ */
  /* Khách hàng                                                           */
  /* ------------------------------------------------------------------ */
  function customerKeys(c) {
    const simple = String(c.name || '').split('(')[0];
    const tk = tokenize(simple).map(foldTok);
    const keys = [];
    const kinF = KIN.map(fold);
    for (let i = 0; i < tk.length - 1; i++) {
      if (kinF.indexOf(tk[i]) >= 0) { keys.push(tk[i] + ' ' + tk[i + 1]); break; }
    }
    if (!keys.length && tk.length) keys.push(tk.join(' '));
    // Biệt danh đã học / người bán đặt (ngăn cách bằng ;)
    String(c.nickname || '').split(';').forEach((nick) => {
      const nt = tokenize(nick).map(foldTok);
      if (nt.length) keys.push(nt.join(' '));
    });
    return keys;
  }

  /**
   * Tìm khách trong câu nói. Trả về {name, id, isNew} và xoá các token tên khách khỏi toks.
   */
  function extractCustomer(toks, customers) {
    const kinSet = new Set(KIN);
    const tf = toks.map(foldTok);
    const known = (customers || []).map((c) => ({ c: c, keys: customerKeys(c) }));
    const bareNumCount = toks.filter((t, i) => isNum(t) && !isMoneyUnit(toks[i + 1])).length;

    for (let i = 0; i < toks.length; i++) {
      if (!kinSet.has(toks[i])) continue;
      const nxt = toks[i + 1], nxt2 = toks[i + 2];
      if (nxt === undefined) continue;
      const key = tf[i] + ' ' + tf[i + 1];
      const hit = known.find((k) => k.keys.indexOf(key) >= 0);
      if (hit) {
        toks.splice(i, 2);
        return { name: hit.c.name, id: hit.c.id || null, isNew: false };
      }
      if (isNum(nxt) && Number.isInteger(nxt) && nxt >= 1 && nxt <= 12) {
        // "dì 6 2 ly" -> tên; "anh 19 ngàn" / "anh 2 ly" -> không phải tên
        if (isMoneyUnit(nxt2) || isCountUnit(nxt2)) continue;
        const otherBare = bareNumCount - 1 >= 1;
        if (isNum(nxt2) || otherBare) {
          const label = toks[i].charAt(0).toUpperCase() + toks[i].slice(1) + ' ' + nxt;
          toks.splice(i, 2);
          return { name: label, id: null, isNew: true };
        }
      }
    }
    // khách không có danh xưng (vd "Tuấn")
    for (const k of known) {
      for (const key of k.keys) {
        if (key.indexOf(' ') >= 0 && kinF.indexOf(key.split(' ')[0]) >= 0) continue;
        const kt = key.split(' ');
        if (kt.join('').length < 3) continue;
        for (let i = 0; i + kt.length <= tf.length; i++) {
          if (kt.every((x, o) => tf[i + o] === x)) {
            toks.splice(i, kt.length);
            return { name: k.c.name, id: k.c.id || null, isNew: false };
          }
        }
      }
    }
    return null;
  }
  const kinF = KIN.map(fold);

  function isMoneyUnit(w) {
    return typeof w === 'string' && (MONEY_K.indexOf(w) >= 0 || MONEY_M.indexOf(w) >= 0 || MONEY_1.indexOf(w) >= 0 || MONEY_XI.indexOf(w) >= 0 || w === 'pct');
  }
  function isCountUnit(w) { return typeof w === 'string' && UNITS.indexOf(w) >= 0; }

  /* ------------------------------------------------------------------ */
  /* Tìm sản phẩm                                                         */
  /* ------------------------------------------------------------------ */
  function productTokens(p) {
    return Array.from(new Set(tokenize(p.name || '').map(foldTok).filter((t) => t.length > 0)));
  }

  function matchProduct(toks, products, aliases) {
    const tf = toks.map(foldTok);
    const empty = { product: null, score: 0, idx: [], candidates: [], ambiguous: false, viaAlias: false };
    if (!products || !products.length) return empty;

    // 1) Alias đã học / alias dựng sẵn: khớp cụm dài nhất
    if (aliases) {
      let best = null;
      Object.keys(aliases).forEach((key) => {
        const kt = key.split(' ');
        for (let i = 0; i + kt.length <= tf.length; i++) {
          if (kt.every((x, o) => tf[i + o] === x)) {
            const p = products.find((pp) => pp.id === aliases[key]);
            if (p && (!best || kt.length > best.len)) {
              best = { product: p, len: kt.length, idx: kt.map((_, o) => i + o) };
            }
          }
        }
      });
      if (best) {
        return { product: best.product, score: 1, idx: best.idx, candidates: [best.product], ambiguous: false, viaAlias: true };
      }
    }

    // 2) So khớp theo từ (có trọng số IDF + sai lệch chính tả nhẹ)
    const ptoks = products.map(productTokens);
    const df = {};
    ptoks.forEach((ts) => ts.forEach((t) => { df[t] = (df[t] || 0) + 1; }));

    const scored = [];
    products.forEach((p, pi) => {
      const nt = ptoks[pi];
      if (!nt.length) return;
      const used = new Set();
      const idx = [];
      let wM = 0, wT = 0, uniq = false, nonNum = false;
      nt.forEach((t) => {
        const w = 1 / df[t];
        wT += w;
        for (let k = 0; k < tf.length; k++) {
          if (used.has(k)) continue;
          if (tokEq(t, tf[k])) {
            used.add(k); idx.push(k); wM += w;
            if (!/^\d/.test(t)) { nonNum = true; if (df[t] === 1 && t.length >= 3) uniq = true; }
            break;
          }
        }
      });
      if (!nonNum) return;
      scored.push({ p: p, score: wM / wT, idx: idx, uniq: uniq });
    });
    scored.sort((a, b) => b.score - a.score || b.idx.length - a.idx.length || a.p.name.length - b.p.name.length);
    if (!scored.length) return empty;

    const accepted = scored.filter((s) => s.score >= 0.5 || s.uniq);
    const candidates = scored.slice(0, 3).map((s) => s.p);
    if (!accepted.length) return { product: null, score: scored[0].score, idx: [], candidates: candidates, ambiguous: true, viaAlias: false };

    const top = accepted[0];
    const second = accepted[1];
    const ambiguous = !!(second && second.p !== top.p && top.score - second.score < 0.05 &&
      second.idx.length >= top.idx.length);
    return {
      product: ambiguous ? null : top.p,
      score: top.score,
      idx: top.idx,
      candidates: candidates,
      ambiguous: ambiguous,
      viaAlias: false
    };
  }


  /* ------------------------------------------------------------------ */
  /* Tách nhiều món trong một câu (không cần "và", dấu phẩy)             */
  /* ------------------------------------------------------------------ */
  function findMentions(toks, products, aliases) {
    const tf = toks.map(foldTok);
    const entries = [];
    const df = {};
    products.forEach((p) => {
      const pt = productTokens(p);
      pt.forEach((t) => { df[t] = (df[t] || 0) + 1; });
    });
    products.forEach((p) => {
      const pt = tokenize(p.name || '').map(foldTok).filter(Boolean);
      if (pt.length) entries.push({ p: p, pt: pt, alias: false });
    });
    if (aliases) Object.keys(aliases).forEach((key) => {
      const p = products.find((pp) => pp.id === aliases[key]);
      if (p) entries.push({ p: p, pt: key.split(' '), alias: true });
    });
    const found = [];
    for (let i = 0; i < tf.length; i++) {
      entries.forEach((e) => {
        for (let s = 0; s < e.pt.length; s++) {
          let r = 0;
          while (s + r < e.pt.length && i + r < tf.length && tokEq(e.pt[s + r], tf[i + r])) r++;
          if (!r) continue;
          const slice = e.pt.slice(s, s + r);
          const nonNum = slice.filter((t) => !/^\d/.test(t));
          if (!nonNum.length) continue;
          const full = r === e.pt.length;
          const uniq = nonNum.some((t) => df[t] === 1 && t.length >= 3);
          if (!(full || r >= 2 || uniq)) continue;
          // ưu tiên: khớp trọn tên > khớp dài > alias
          const weight = r * 10 + (full ? 5 : 0) + (e.alias ? 3 : 0) - (e.pt.length - r) * 0.1;
          found.push({ start: i, end: i + r, p: e.p, weight: weight, run: r, full: full });
        }
      });
    }
    found.sort((a, b) => b.weight - a.weight || a.start - b.start);
    const taken = new Array(tf.length).fill(false);
    const spans = [];
    found.forEach((f) => {
      for (let k = f.start; k < f.end; k++) if (taken[k]) return;
      for (let k = f.start; k < f.end; k++) taken[k] = true;
      spans.push(f);
    });
    spans.sort((a, b) => a.start - b.start);
    return spans;
  }

  function splitMentions(toks, products, aliases) {
    if (!products || !products.length) return null;
    const spans = findMentions(toks, products, aliases);
    // gộp các span liền kề của CÙNG một món (vd "cà phê" + "sữa" bị tách do chính tả)
    const merged = [];
    spans.forEach((sp) => {
      const last = merged[merged.length - 1];
      if (last && last.p === sp.p && sp.start - last.end <= 1) { last.end = sp.end; return; }
      merged.push(Object.assign({}, sp));
    });
    if (merged.length < 2) return null;

    const firstStart = merged[0].start;
    const numBefore = toks.slice(0, firstStart).some(isNum);
    const style = numBefore ? 'before' : 'after';
    const cutAt = [];
    for (let k = 0; k < merged.length - 1; k++) {
      const g0 = merged[k].end, g1 = merged[k + 1].start;
      if (style === 'after') { cutAt.push(g1); continue; }
      // style 'before': số lượng đứng trước tên món tiếp theo
      // nhóm số trong khoảng giữa: [số + đơn vị/tiền]...
      const groups = [];
      let i = g0;
      while (i < g1) {
        if (isNum(toks[i])) {
          let e = i + 1;
          if (typeof toks[e] === 'string' && (isMoneyUnit(toks[e]) || isCountUnit(toks[e]))) e += 1;
          if (typeof toks[e] === 'string' && MONEY_1.indexOf(toks[e]) >= 0) e += 1;
          groups.push({ s: i, e: e, money: typeof toks[i + 1] === 'string' && isMoneyUnit(toks[i + 1]), cnt: typeof toks[i + 1] === 'string' && isCountUnit(toks[i + 1]) });
          i = e;
        } else i++;
      }
      // nhóm cuối cùng KHÔNG phải tiền -> số lượng của món kế tiếp
      let cut = g1;
      for (let gi = groups.length - 1; gi >= 0; gi--) {
        const gr = groups[gi];
        if (!gr.money) { cut = gr.s; break; }
      }
      // kéo thêm đơn vị đứng trước số ("ly 2"?) không cần; giữ nguyên
      cutAt.push(cut);
    }
    const segs = [];
    let from = 0;
    cutAt.forEach((c) => { segs.push(toks.slice(from, c)); from = c; });
    segs.push(toks.slice(from));
    return segs;
  }

  /* ------------------------------------------------------------------ */
  /* Phân tích một đoạn (1 món)                                           */
  /* ------------------------------------------------------------------ */
  function lookback(toks, i, set, n) {
    for (let k = Math.max(0, i - (n || 3)); k < i; k++) if (typeof toks[k] === 'string' && set.indexOf(toks[k]) >= 0) return true;
    return false;
  }

  function scanMoney(toks, used) {
    const prices = [];
    for (let i = 0; i < toks.length; i++) {
      if (used.has(i) || !isNum(toks[i])) continue;
      const n = toks[i];
      const nx = toks[i + 1];
      let value = null, end = i, pct = false;
      if (typeof nx === 'string' && MONEY_XI.indexOf(nx) >= 0) { value = n * 1e5; end = i + 1; }
      else if (typeof nx === 'string' && MONEY_M.indexOf(nx) >= 0) { value = n * 1e6; end = i + 1; }
      else if (typeof nx === 'string' && MONEY_K.indexOf(nx) >= 0) { value = n * 1000; end = i + 1; }
      else if (typeof nx === 'string' && MONEY_1.indexOf(nx) >= 0) { value = n; end = i + 1; }
      else if (nx === 'pct') { value = n; pct = true; end = i + 1; }
      else if (n >= 1000) { value = n; }
      else if (n > 0 && (lookback(toks, i, SPECIAL_CUES, 2) || lookback(toks, i, DISCOUNT_CUES, 2)) && !isCountUnit(nx)) { value = n * 1000; }
      if (value === null) continue;
      // "đ" đứng ngay sau tiền như "20 ngàn đ"
      if (typeof toks[end + 1] === 'string' && MONEY_1.indexOf(toks[end + 1]) >= 0) end += 1;
      const special = lookback(toks, i, SPECIAL_CUES, 3);
      const discount = lookback(toks, i, DISCOUNT_CUES, 3) && !lookback(toks, i, ['còn'], 3);
      const total = lookback(toks, i, TOTAL_CUES, 3) || toks[i - 1] === 'cả' || toks[end + 1] === 'hết';
      prices.push({ value: value, pos: i, end: end, pct: pct, special: special, discount: discount, total: total });
      for (let k = i; k <= end; k++) used.add(k);
    }
    return prices;
  }

  function parseSegment(toks, ctx) {
    const products = ctx.products || [];
    const m = matchProduct(toks, products, ctx.aliases);
    const used = new Set(m.idx);
    const prices = scanMoney(toks, used);

    // --- số lượng ---
    let qty = null, unit = null, qtyFromUnit = false;
    // a) số + đơn vị đếm
    for (let i = 0; i < toks.length && qty === null; i++) {
      if (used.has(i) || !isNum(toks[i])) continue;
      const nx = toks[i + 1];
      if (typeof nx === 'string' && isCountUnit(nx) && !used.has(i + 1)) {
        if (nx === 'chục') { qty = toks[i] * 10; unit = null; } else { qty = toks[i]; unit = nx; qtyFromUnit = true; }
        used.add(i); used.add(i + 1);
      }
    }
    // b) số đứng sát ngay trước/sau tên món
    if (qty === null && m.idx.length) {
      const lo = Math.min.apply(null, m.idx), hi = Math.max.apply(null, m.idx);
      [lo - 1, hi + 1].forEach((k) => {
        if (qty === null && k >= 0 && k < toks.length && isNum(toks[k]) && !used.has(k)) { qty = toks[k]; used.add(k); }
      });
    }
    // c) số rời bất kỳ còn lại
    if (qty === null) {
      for (let i = 0; i < toks.length; i++) {
        if (!used.has(i) && isNum(toks[i]) && toks[i] > 0) { qty = toks[i]; used.add(i); break; }
      }
    }
    // Giá nói tắt: "1 ký đường 20" / "một ký đường hai chục" (số lẻ duy nhất còn lại, đã có số lượng+đơn vị)
    let priceGuess = false;
    if (qtyFromUnit && !prices.some((x) => !x.pct)) {
      const left = [];
      toks.forEach((t, i) => { if (!used.has(i) && isNum(t) && t > 0) left.push(i); });
      if (left.length === 1) {
        const n = toks[left[0]];
        const gp = n < 1000 ? n * 1000 : n;
        prices.push({ value: gp, pos: left[0], end: left[0], pct: false, special: false, discount: false, total: false });
        used.add(left[0]);
        priceGuess = true;
      }
    }
    // "cặp" = 2
    if (qty === null && toks.indexOf('cặp') >= 0) qty = 2;
    if (qty === null || !(qty > 0)) qty = 1;
    qty = roundN(qty);

    // --- giá ---
    const p = m.product;
    let unitPrice = null, priceKind = null;
    const real = prices.filter((x) => !x.pct || x.discount || true);
    const pct = prices.find((x) => x.pct);
    const disc = prices.find((x) => x.discount && !x.pct);
    if (p && (pct || disc)) {
      if (pct) unitPrice = Math.round(p.price * (1 - pct.value / 100));
      else unitPrice = p.price - disc.value;
      priceKind = 'discount';
    } else if (real.filter((x) => !x.pct).length) {
      const money = real.filter((x) => !x.pct);
      const cue = money.filter((x) => x.special);
      const chosen = cue.length ? cue[cue.length - 1] : money[money.length - 1];
      let v = chosen.value;
      if (chosen.total && qty > 0) v = Math.round(v / qty);
      unitPrice = v;
      priceKind = chosen.special ? 'special' : 'flash';
    }
    if (unitPrice !== null && (unitPrice <= 0 || (p && unitPrice === p.price))) { unitPrice = null; priceKind = null; }

    // --- cụm từ nói về món (để học alias) ---
    const phraseWords = [];
    toks.forEach((t, i) => {
      if (used.has(i) && m.idx.indexOf(i) < 0) return;
      if (isNum(t)) { if (m.idx.indexOf(i) >= 0) phraseWords.push(String(t)); return; }
      if (STOP.has(t) || isCountUnit(t) || isMoneyUnit(t) || KIN.indexOf(t) >= 0) return;
      phraseWords.push(t);
    });

    // Khớp MỘT PHẦN tên món mà câu còn từ lạ ("bánh gạo" vs "Bánh mì") -> không tự chọn, để hỏi lại / tạo món mới
    let partialExtra = [];
    if (p && !m.viaAlias) {
      const pset = productTokens(p).filter((t) => !/^\d/.test(t));
      const covered = m.idx.map((k) => foldTok(toks[k])).filter((t) => !/^\d/.test(t)).length;
      if (covered < pset.length) {
        partialExtra = phraseWords.map((w) => foldTok(w)).filter((w) => w && !/^\d/.test(w) && !pset.some((t) => tokEq(t, w)));
      }
    }
    return {
      product: p,
      partialExtra: partialExtra,
      candidates: m.candidates,
      ambiguous: m.ambiguous || (!p && m.candidates.length > 0),
      matchScore: m.score,
      viaAlias: m.viaAlias,
      qty: qty,
      unit: unit,
      unitPrice: unitPrice,
      priceKind: priceKind,
      priceGuess: priceGuess && unitPrice !== null,
      phrase: phraseWords.join(' ').trim()
    };
  }


  /**
   * Món CHƯA có trong danh mục: "hai bịch bánh mì năm ngàn" -> {name:'bánh mì', qty:2, unit:'bịch', unitPrice:5000}
   * Chỉ trả về khi câu có dấu hiệu bán hàng (số lượng / đơn vị / tiền) và tên món rõ ràng.
   */
  function parseNewItem(text, ctx) {
    ctx = ctx || {};
    let toks = tokenize(text);
    const customer = extractCustomer(toks, ctx.customers);
    if (!toks.length || toks.length > 10) return null;
    const used = new Set();
    const prices = scanMoney(toks, used);
    let qty = null, unit = null;
    for (let i = 0; i < toks.length && qty === null; i++) {
      if (used.has(i) || !isNum(toks[i])) continue;
      const nx = toks[i + 1];
      if (typeof nx === 'string' && isCountUnit(nx) && !used.has(i + 1)) {
        if (nx === 'chục') { qty = toks[i] * 10; } else { qty = toks[i]; unit = nx; }
        used.add(i); used.add(i + 1);
      }
    }
    if (qty === null) {
      for (let i = 0; i < toks.length; i++) {
        if (!used.has(i) && isNum(toks[i]) && toks[i] > 0) { qty = toks[i]; used.add(i); break; }
      }
    }
    const words = [];
    toks.forEach((t, i) => {
      if (used.has(i) || isNum(t)) return;
      if (STOP.has(t) || isCountUnit(t) || isMoneyUnit(t) || KIN.indexOf(t) >= 0) return;
      words.push(t);
    });
    const name = words.join(' ').trim();
    const money = prices.filter((x) => !x.pct);
    if (!name || name.length < 2 || words.length > 5) return null;
    if (qty === null && !money.length && !unit) return null;
    let unitPrice = null;
    if (money.length) {
      const chosen = money[money.length - 1];
      unitPrice = chosen.total && qty > 0 ? Math.round(chosen.value / qty) : chosen.value;
    }
    return { name: name, qty: qty > 0 ? roundN(qty) : 1, unit: unit, unitPrice: unitPrice, customer: customer };
  }

  /* ------------------------------------------------------------------ */
  /* Quà tặng                                                             */
  /* ------------------------------------------------------------------ */
  function parseGift(toks, ctx) {
    const m = matchProduct(toks, ctx.products || [], ctx.aliases);
    const useProduct = !!(m.product && !m.ambiguous && (m.viaAlias || m.score >= 0.6));
    const used = new Set(useProduct ? m.idx : []);
    let qty = null, unit = null;
    for (let i = 0; i < toks.length; i++) {
      if (used.has(i) || !isNum(toks[i])) continue;
      if (typeof toks[i + 1] === 'string' && MONEY_1.indexOf(toks[i + 1]) >= 0) { used.add(i); used.add(i + 1); continue; } // "0đ"
      if (typeof toks[i + 1] === 'string' && isMoneyUnit(toks[i + 1])) { used.add(i); used.add(i + 1); continue; }
      if (qty === null) {
        qty = toks[i]; used.add(i);
        if (typeof toks[i + 1] === 'string' && isCountUnit(toks[i + 1])) { unit = toks[i + 1]; used.add(i + 1); }
      }
    }
    if (qty === null || !(qty > 0)) qty = 1;
    const words = [];
    toks.forEach((t, i) => {
      if (used.has(i) || isNum(t)) return;
      if (STOP.has(t) || isMoneyUnit(t) || KIN.indexOf(t) >= 0 || t === 'miễn' || t === 'phí' || t === 'free') return;
      if (!unit && isCountUnit(t) && words.length === 0) { unit = t; return; }
      words.push(t);
    });
    if (useProduct) {
      return { name: m.product.name, productId: m.product.id, qty: qty, unit: unit };
    }
    const name = words.join(' ').trim();
    if (!name) return null;
    return { name: name, productId: null, qty: qty, unit: unit };
  }

  /* ------------------------------------------------------------------ */
  /* Hàm chính                                                            */
  /* ------------------------------------------------------------------ */
  /**
   * ctx: { products, customers, aliases }   (aliases: { "cụm đã fold": productId })
   */
  function parse(text, ctx) {
    ctx = ctx || {};
    const raw = String(text || '');
    let toks = tokenize(raw);
    const lower = raw.toLowerCase();
    const result = { raw: raw, lines: [], gifts: [], customer: null, promoCue: PROMO_CUE_RE.test(lower), score: 0, ok: false };
    if (!toks.length) return result;

    result.customer = extractCustomer(toks, ctx.customers);

    // tách phần quà tặng
    let giftToks = null;
    for (let i = 0; i < toks.length; i++) {
      if (typeof toks[i] === 'string' && GIFT_CUES.indexOf(toks[i]) >= 0) {
        giftToks = toks.slice(i + 1);
        toks = toks.slice(0, i);
        break;
      }
    }

    // tách theo từ nối (và/với/rồi) nhưng chỉ khi mỗi đoạn có món riêng
    const segs = [];
    let cur = [];
    toks.forEach((t) => {
      if (typeof t === 'string' && CONNECTORS.indexOf(t) >= 0) { segs.push(cur); cur = []; } else cur.push(t);
    });
    segs.push(cur);
    const groups = [];
    segs.forEach((s) => {
      if (!s.length) return;
      const hasProduct = matchProduct(s, ctx.products, ctx.aliases).idx.length > 0 ||
        matchProduct(s, ctx.products, ctx.aliases).candidates.length > 0;
      if (!hasProduct && groups.length) groups[groups.length - 1] = groups[groups.length - 1].concat(s);
      else groups.push(s);
    });

    const finalGroups = [];
    groups.forEach((g) => {
      const sub = splitMentions(g, ctx.products, ctx.aliases);
      if (sub) sub.forEach((x) => finalGroups.push(x)); else finalGroups.push(g);
    });
    finalGroups.forEach((g) => {
      const line = parseSegment(g, ctx);
      if (line.product || line.candidates.length) result.lines.push(line);
    });

    if (giftToks && giftToks.length) {
      const g = parseGift(giftToks, ctx);
      if (g) result.gifts.push(g);
    }

    const best = result.lines.reduce((s, l) => Math.min(s, l.product ? Math.max(l.matchScore, 0.5) : 0.2), 1);
    result.score = result.lines.length ? best : 0;
    result.ok = result.lines.length > 0 && result.lines.every((l) => !!l.product);
    return result;
  }

  /** Chọn cách hiểu tốt nhất trong các phương án STT trả về. */
  function pickBest(alternatives, confidences, ctx) {
    let best = null;
    (alternatives || []).forEach((alt, i) => {
      const r = parse(alt, ctx);
      const conf = confidences && confidences[i] > 0 ? confidences[i] : null;
      const rank = (r.ok ? 2 : r.lines.length ? 1 : 0) + r.score + (conf !== null ? conf * 0.3 : 0) - i * 0.01;
      const item = { text: alt, parsed: r, conf: conf, rank: rank, index: i };
      if (!best || rank > best.rank) best = item;
    });
    return best;
  }

  /** Cụm từ nên lưu thành alias (đã fold). */
  function aliasKey(phrase) {
    return tokenize(phrase).map(foldTok).join(' ').trim();
  }

  const api = {
    fold: fold, tokenize: tokenize, parse: parse, pickBest: pickBest, matchProduct: matchProduct,
    aliasKey: aliasKey, UNITS: UNITS, extractCustomer: extractCustomer, customerKeys: customerKeys,
    findMentions: findMentions, parseNewItem: parseNewItem
  };
  root.VoiceOrder = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
