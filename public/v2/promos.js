/**
 * Sổ ơi - Khuyến mãi / giá riêng / quà tặng.
 *
 * Mô hình dữ liệu
 *  - Sản phẩm:  product.promos = [{ id, minQty, type: 'price'|'percent'|'gift', value, giftName, giftQty }]
 *      price   : mua từ minQty thì giảm `value` đồng cho mỗi đơn vị
 *      percent : mua từ minQty thì giảm `value` %
 *      gift    : mua từ minQty thì tặng `giftQty` x `giftName` (0đ)
 *  - Giỏ hàng:  cartExtras = {
 *      price:  { [productId]: đơn giá riêng (giá người quen / giảm tức thời) },
 *      promo:  { [productId]: promoId đang áp dụng },
 *      gifts:  [{ name, qty, unit, productId }]   // quà tặng nói bằng giọng nói
 *      customer: tên khách (nếu có)
 *    }
 */
var cartExtras = { price: {}, promo: {}, gifts: [], customer: null };

function resetCartExtras() {
  cartExtras = { price: {}, promo: {}, gifts: [], customer: null };
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function promoLabel(pr) {
  if (!pr) return '';
  var base = 'Mua từ ' + pr.minQty;
  if (pr.type === 'price') return base + ' giảm ' + formatVND(pr.value) + '/cái';
  if (pr.type === 'percent') return base + ' giảm ' + pr.value + '%';
  return base + ' tặng ' + (pr.giftQty || 1) + ' ' + (pr.giftName || 'quà');
}

function promoById(p, pid) {
  return (p && p.promos || []).find(function (x) { return x.id === pid; }) || null;
}

function eligiblePromos(p, qty) {
  return (p && p.promos || []).filter(function (x) { return qty >= (x.minQty || 1); });
}

/** Khuyến mãi đang bật cho dòng hàng (và còn đủ số lượng). */
function activePromo(p, qty) {
  var pr = promoById(p, cartExtras.promo[p.id]);
  return pr && qty >= (pr.minQty || 1) ? pr : null;
}

/** Đơn giá thực tế: giá riêng > khuyến mãi giảm giá > giá niêm yết. */
function effectiveUnitPrice(p, qty) {
  var ov = cartExtras.price[p.id];
  if (ov !== undefined && ov !== null) return ov;
  var pr = activePromo(p, qty);
  if (pr && pr.type === 'price') return Math.max(0, p.price - (pr.value || 0));
  if (pr && pr.type === 'percent') return Math.max(0, Math.round(p.price * (1 - (pr.value || 0) / 100)));
  return p.price;
}

function cartLineTotal(p, qty) {
  return Math.round(effectiveUnitPrice(p, qty) * qty);
}

/** Quà đang được tặng: quà nói bằng giọng nói + quà của khuyến mãi đang bật. */
function activeGifts() {
  var out = cartExtras.gifts.map(function (g) { return { name: g.name, qty: g.qty, unit: g.unit, productId: g.productId || null }; });
  Object.keys(currentCart).forEach(function (id) {
    var p = db.products.find(function (x) { return x.id === id; });
    if (!p) return;
    var pr = activePromo(p, currentCart[id]);
    if (pr && pr.type === 'gift') {
      out.push({ name: pr.giftName || 'Quà tặng', qty: pr.giftQty || 1, unit: null, productId: null, fromPromo: true });
    }
  });
  return out;
}

/** Bật/tắt khuyến mãi cho dòng hàng trong giỏ (người bán bấm chọn). */
function cartTogglePromo(prodId, promoId) {
  if (cartExtras.promo[prodId] === promoId) delete cartExtras.promo[prodId];
  else cartExtras.promo[prodId] = promoId;
  if (typeof renderCartDrawerItems === 'function') renderCartDrawerItems();
  if (typeof updatePosCartBadges === 'function') updatePosCartBadges();
}

function cartClearSpecialPrice(prodId) {
  delete cartExtras.price[prodId];
  if (typeof renderCartDrawerItems === 'function') renderCartDrawerItems();
  if (typeof updatePosCartBadges === 'function') updatePosCartBadges();
}

function cleanupCartExtrasFor(prodId) {
  delete cartExtras.price[prodId];
  delete cartExtras.promo[prodId];
}

/* ------------------------------------------------------------------ */
/* Ô nhập khuyến mãi trong màn hình Thêm / Sửa mặt hàng                */
/* ------------------------------------------------------------------ */
function promoEditorEnsure() {
  if (document.getElementById('prod-promos-list')) return;
  var btn = document.querySelector('#product-modal-panel button[onclick="saveProductModal()"]');
  if (!btn) return;
  var wrap = document.createElement('div');
  wrap.innerHTML =
    '<div class="flex items-center justify-between mb-1">' +
    '<label class="block text-[12px] font-bold text-slate-700">Khuyến mãi cho khách</label>' +
    '<button type="button" onclick="promoEditorAdd()" class="px-2.5 py-1 rounded-lg bg-[#ECFBF2] text-[#0B7A60] text-[12px] font-bold active:scale-95">+ Thêm</button>' +
    '</div>' +
    '<p class="text-[11px] text-slate-400 mb-1.5">Ví dụ: mua từ 5 giảm 1.000đ mỗi cái, hoặc mua từ 10 tặng 1 bịt bánh mì. Lúc bán, bạn chạm vào khuyến mãi để áp dụng cho khách.</p>' +
    '<div id="prod-promos-list" class="space-y-2"></div>';
  btn.parentNode.insertBefore(wrap, btn);
}

function promoRowHtml(pr) {
  pr = pr || { minQty: 5, type: 'price', value: '', giftName: '', giftQty: 1 };
  var t = pr.type || 'price';
  return '' +
    '<div class="promo-row p-2 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5" data-id="' + escHtml(pr.id || '') + '">' +
    '<div class="flex items-center gap-1.5">' +
    '<span class="text-[11px] font-bold text-slate-600 shrink-0">Mua từ</span>' +
    '<input type="number" min="1" class="promo-min w-14 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-[13px] font-bold text-slate-800" value="' + (pr.minQty || 1) + '" />' +
    '<select class="promo-type flex-1 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-[12.5px] font-semibold text-slate-800" onchange="promoRowTypeChanged(this)">' +
    '<option value="price"' + (t === 'price' ? ' selected' : '') + '>Giảm đ / cái</option>' +
    '<option value="percent"' + (t === 'percent' ? ' selected' : '') + '>Giảm %</option>' +
    '<option value="gift"' + (t === 'gift' ? ' selected' : '') + '>Tặng kèm</option>' +
    '</select>' +
    '<button type="button" onclick="this.closest(\'.promo-row\').remove()" class="w-7 h-7 rounded-full bg-red-50 text-red-500 flex items-center justify-center shrink-0 font-bold">×</button>' +
    '</div>' +
    '<div class="promo-val-wrap' + (t === 'gift' ? ' hidden' : '') + '">' +
    '<input type="number" class="promo-val w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-[13px] font-bold text-[#0B7A60]" placeholder="' + (t === 'percent' ? 'Giảm bao nhiêu %' : 'Giảm bao nhiêu đồng / cái') + '" value="' + (t === 'gift' ? '' : (pr.value || '')) + '" />' +
    '</div>' +
    '<div class="promo-gift-wrap flex gap-1.5' + (t === 'gift' ? '' : ' hidden') + '">' +
    '<input type="text" class="promo-gift-name flex-1 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-[13px] font-semibold text-slate-800" placeholder="Tên quà (vd: bịt bánh mì)" value="' + escHtml(pr.giftName || '') + '" />' +
    '<input type="number" min="1" class="promo-gift-qty w-14 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-[13px] font-bold text-slate-800" value="' + (pr.giftQty || 1) + '" />' +
    '</div>' +
    '</div>';
}

function promoRowTypeChanged(sel) {
  var row = sel.closest('.promo-row');
  var isGift = sel.value === 'gift';
  row.querySelector('.promo-val-wrap').classList.toggle('hidden', isGift);
  row.querySelector('.promo-gift-wrap').classList.toggle('hidden', !isGift);
  var v = row.querySelector('.promo-val');
  v.placeholder = sel.value === 'percent' ? 'Giảm bao nhiêu %' : 'Giảm bao nhiêu đồng / cái';
}

function promoEditorLoad(list) {
  promoEditorEnsure();
  var box = document.getElementById('prod-promos-list');
  if (!box) return;
  box.innerHTML = (list || []).map(promoRowHtml).join('');
}

function promoEditorAdd() {
  promoEditorEnsure();
  var box = document.getElementById('prod-promos-list');
  if (box) box.insertAdjacentHTML('beforeend', promoRowHtml(null));
}

function promoEditorCollect() {
  var box = document.getElementById('prod-promos-list');
  if (!box) return [];
  var out = [];
  box.querySelectorAll('.promo-row').forEach(function (row, i) {
    var type = row.querySelector('.promo-type').value;
    var minQty = parseFloat(row.querySelector('.promo-min').value) || 1;
    var id = row.getAttribute('data-id') || ('pr_' + Date.now().toString(36) + i);
    if (type === 'gift') {
      var gname = (row.querySelector('.promo-gift-name').value || '').trim();
      if (!gname) return;
      out.push({ id: id, minQty: minQty, type: 'gift', giftName: gname, giftQty: parseFloat(row.querySelector('.promo-gift-qty').value) || 1 });
    } else {
      var val = parseFloat(row.querySelector('.promo-val').value) || 0;
      if (val <= 0) return;
      if (type === 'percent' && val > 100) val = 100;
      out.push({ id: id, minQty: minQty, type: type, value: val });
    }
  });
  return out;
}

document.addEventListener('DOMContentLoaded', promoEditorEnsure);
