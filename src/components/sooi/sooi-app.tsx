"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  Coffee,
  CreditCard,
  Download,
  FileDown,
  LayoutDashboard,
  Mic,
  Minus,
  Package,
  PackageOpen,
  Plus,
  ReceiptText,
  ScanLine,
  Search,
  Settings2,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Upload,
  UserRound,
  WalletCards,
  X,
  Trash2,
  Copy,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import { addToCart, businessDate, calculateSummary, cancelOrder, cartSubtotal, completeOrder, deleteProduct, formatMoney, formatMoneyInput, formatMoneyShort, formatMoneyToWords, parseMoneyInput, today, validateStock, VIETNAM_BANKS, BANK_CATEGORY_LABELS, type BankCategory, findBankByBin } from "@/lib/ledger";
import type { CartItem, CashType, Order, PaymentMethod, Product, StoreSettings } from "@/lib/ledger/types";
import { useLedger } from "@/hooks/use-ledger";
import { createClient } from "@/lib/supabase/client";
import { makeVoiceDraft, normalizeVoiceText, spokenAmount } from "@/lib/voice/parser";
import { AudioVoiceRecorder, getBrowserRecognition, playPaymentSpeakerAnnouncement, requestMicrophoneAccess, safariSpeechEndedWithoutResultMessage, transcribeAudioWithApi, voiceErrorMessage, voiceSupportMessage, type BrowserRecognition } from "@/lib/voice/browser-speech";

type Screen = "home" | "sell" | "cash" | "report" | "manage";
type Panel = "cart" | "cash" | "product" | "debt" | "customer" | null;

const navItems: { id: Screen; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "home", label: "Tổng quan", icon: LayoutDashboard },
  { id: "sell", label: "Bán hàng", icon: ShoppingCart },
  { id: "cash", label: "Thu chi", icon: WalletCards },
  { id: "report", label: "Báo cáo", icon: BarChart3 },
  { id: "manage", label: "Quản lý", icon: Settings2 },
];

function buildVietQrUrl(store: StoreSettings, amount: number, reference: string) {
  const bankBin = store.bankBin?.replace(/\s+/g, "").trim();
  const bankAccount = store.bankAccount?.replace(/\s+/g, "").trim();
  const bankOwner = store.bankOwner?.trim();
  if (!bankBin || !bankAccount || amount <= 0) return null;
  const imagePath = `${encodeURIComponent(bankBin)}-${encodeURIComponent(bankAccount)}-compact2.png`;
  const params = new URLSearchParams({
    amount: String(Math.round(amount)),
    addInfo: reference,
  });
  if (bankOwner) params.set("accountName", bankOwner);
  return `https://img.vietqr.io/image/${imagePath}?${params.toString()}`;
}

function VietQrImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <a href={src} target="_blank" rel="noreferrer" className="grid size-56 place-items-center p-5 text-center text-xs font-bold text-sooi-green underline sm:size-64">Mở ảnh QR trực tiếp</a>;
  }

  return <>
    {/* VietQR is a third-party dynamic image; bypass next/image optimization on Vercel. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={src} alt="Mã QR nhận tiền chuyển khoản" width={280} height={280} loading="eager" referrerPolicy="no-referrer" className="size-56 sm:size-64" onError={() => setFailed(true)} />
  </>;
}

export function SooiApp({ userId, userEmail }: { userId: string | null; userEmail: string }) {
  const router = useRouter();
  const { database, setDatabase, reset, syncStatus, importDatabase } = useLedger(userId);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [screen, setScreen] = useState<Screen>("home");
  const [panel, setPanel] = useState<Panel>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Tất cả");
  const [discount, setDiscount] = useState(0);
  const [customerId, setCustomerId] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [cashType, setCashType] = useState<CashType>("expense");
  const [cashCategory, setCashCategory] = useState("Điện nước");
  const [cashAmount, setCashAmount] = useState("");
  const [cashNote, setCashNote] = useState("");
  const [productName, setProductName] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [productCost, setProductCost] = useState("");
  const [productStock, setProductStock] = useState("");
  const [productCategory, setProductCategory] = useState("Đồ uống");
  const [productId, setProductId] = useState<string | null>(null);
  const [debtType, setDebtType] = useState<"debt" | "payment" | "list">("debt");
  const [debtCustomerId, setDebtCustomerId] = useState("");
  const [debtCustomerName, setDebtCustomerName] = useState("");
  const [debtAmount, setDebtAmount] = useState("");
  const [debtNote, setDebtNote] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  const summary = useMemo(() => calculateSummary(database), [database]);
  const subtotal = cartSubtotal(cart);
  const total = Math.max(0, subtotal - discount);
  const categories = useMemo(() => ["Tất cả", ...new Set(database.products.filter((item) => item.active).map((item) => item.category))], [database.products]);
  const products = useMemo(() => database.products.filter((product) => {
    const matchCategory = category === "Tất cả" || product.category === category;
    const normalized = query.trim().toLocaleLowerCase("vi-VN");
    return product.active && matchCategory && (!normalized || product.name.toLocaleLowerCase("vi-VN").includes(normalized));
  }), [database.products, category, query]);
  const selectedCustomer = database.customers.find((customer) => customer.id === customerId);

  const handleVoiceDraft = (items: CartItem[], transcript: string) => {
    setCart(items);
    setScreen("sell");
    setPanel("cart");
    toast.success(`Sổ đã nhận: “${transcript}”. Kiểm lại đơn trước khi lưu.`);
  };

  const addProduct = (product: Product) => {
    setCart((items) => addToCart(items, product));
    toast.success(`Đã thêm ${product.name}`);
  };

  const updateQuantity = (productId: string, change: number) => {
    setCart((items) => items.flatMap((item) => {
      if (item.id !== productId) return [item];
      const quantity = item.quantity + change;
      return quantity > 0 ? [{ ...item, quantity }] : [];
    }));
  };

  const checkout = () => {
    if (!cart.length) return;
    if (method === "debt" && !selectedCustomer) {
      toast.error("Chọn khách hàng trước khi ghi nợ.");
      return;
    }
    const stockErrors = validateStock(database, cart);
    if (stockErrors.length) {
      toast.error(stockErrors[0]);
      return;
    }
    setDatabase((current) => completeOrder(current, {
      items: cart,
      discount,
      customerId: selectedCustomer?.id,
      customerName: selectedCustomer?.name ?? "Khách lẻ",
      method,
    }));

    const successMessage = method === "debt" ? "Đã lưu đơn ghi nợ" : `Đã thanh toán ${formatMoney(total)}`;
    toast.success(successMessage);

    if (database.store.voiceAnnouncement !== false) {
      playPaymentSpeakerAnnouncement(total, method, selectedCustomer?.name);
    }

    setCart([]);
    setDiscount(0);
    setCustomerId("");
    setMethod("cash");
    setPanel(null);
    setScreen("home");
  };

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [showAllOrders, setShowAllOrders] = useState(false);

  const cancelCart = () => {
    setCart([]);
    setDiscount(0);
    setCustomerId("");
    setMethod("cash");
    setPanel(null);
    toast.info("Đã hủy đơn hàng đang tạo.");
  };

  const handleCancelOrder = (orderId: string) => {
    const order = database.orders.find((o) => o.id === orderId);
    if (!order) return;
    const confirmed = window.confirm(
      `Bạn có chắc muốn hủy đơn ${order.number} (${formatMoney(order.total)}) không?\nToàn bộ sản phẩm sẽ được tự động hoàn lại vào kho.`
    );
    if (!confirmed) return;

    setDatabase((current) => cancelOrder(current, orderId));
    toast.success(`Đã hủy đơn ${order.number} và hoàn lại kho thành công.`);
    setSelectedOrder((current) => (current?.id === orderId ? null : current));
  };

  const updateStoreSettings = (patch: Partial<StoreSettings>) => {
    setDatabase((current) => ({ ...current, store: { ...current.store, ...patch } }));
  };

  const openInventory = () => {
    setScreen("manage");
    window.requestAnimationFrame(() => {
      document.getElementById("inventory-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const saveCashEntry = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = parseMoneyInput(cashAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Nhập số tiền hợp lệ.");
      return;
    }
    setDatabase((current) => ({
      ...current,
      cashEntries: [{
        id: crypto.randomUUID(),
        date: today(),
        type: cashType,
        category: cashCategory.trim() || (cashType === "expense" ? "Chi phí khác" : "Thu khác"),
        note: cashNote.trim() || "Chưa có ghi chú",
        amount,
      }, ...current.cashEntries],
    }));
    toast.success(cashType === "expense" ? "Đã ghi khoản chi" : "Đã ghi khoản thu");
    setCashAmount("");
    setCashNote("");
    setPanel(null);
  };

  const saveProduct = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const price = parseMoneyInput(productPrice);
    const cost = parseMoneyInput(productCost);
    const stock = Number(productStock);
    if (!productName.trim() || !Number.isFinite(price) || price <= 0 || !Number.isFinite(cost) || cost < 0 || !Number.isFinite(stock) || stock < 0) {
      toast.error("Kiểm tra lại tên, giá bán, giá vốn và tồn kho.");
      return;
    }
    if (price > 1_000_000_000 || cost > 1_000_000_000 || stock > 1_000_000_000) return toast.error("Giá hoặc tồn kho vượt giới hạn cho phép.");
    if (database.products.some((product) => product.id !== productId && normalizeVoiceText(product.name) === normalizeVoiceText(productName))) return toast.error("Tên sản phẩm này đã có trong bảng giá.");
    setDatabase((current) => {
      if (productId) {
        return { ...current, products: current.products.map((p) => p.id === productId ? { ...p, name: productName.trim(), category: productCategory.trim() || "Khác", price, cost, stock } : p) };
      }
      return { ...current, products: [...current.products, { id: crypto.randomUUID(), name: productName.trim(), category: productCategory.trim() || "Khác", unit: "món", price, cost, stock, lowStock: Math.max(1, Math.ceil(stock * 0.2)), active: true }] };
    });
    setProductId(null); setProductName(""); setProductPrice(""); setProductCost(""); setProductStock(""); setPanel(null);
    toast.success(productId ? "Đã cập nhật sản phẩm." : "Đã thêm sản phẩm vào bảng giá.");
  };

  const deleteProductFromStore = (product: { id: string; name: string }) => {
    if (!window.confirm(`Bạn có chắc muốn xóa mặt hàng "${product.name}" khỏi kho không? Dữ liệu đơn hàng cũ vẫn được giữ nguyên.`)) {
      return;
    }
    setDatabase((current) => deleteProduct(current, product.id));
    setCart((current) => current.filter((item) => item.id !== product.id));
    if (productId === product.id) {
      setProductId(null);
      setProductName("");
      setProductPrice("");
      setProductCost("");
      setProductStock("");
      setPanel(null);
    }
    toast.success(`Đã xóa mặt hàng "${product.name}" khỏi kho.`);
  };

  const saveDebtEntry = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (debtType === "list") return;
    const amount = parseMoneyInput(debtAmount);
    const knownCustomer = database.customers.find((customer) => customer.id === debtCustomerId);
    const customerName = knownCustomer?.name ?? debtCustomerName.trim();
    if (!customerName || !Number.isFinite(amount) || amount <= 0) { toast.error("Chọn khách và nhập số tiền hợp lệ."); return; }
    setDatabase((current) => ({ ...current, debtEntries: [{ id: crypto.randomUUID(), date: today(), customerId: knownCustomer?.id, customerName, type: debtType as "debt" | "payment", amount, note: debtNote.trim() || (debtType === "debt" ? "Ghi công nợ" : "Khách trả nợ") }, ...(current.debtEntries ?? [])] }));
    if (database.store.voiceAnnouncement !== false) {
      playPaymentSpeakerAnnouncement(amount, debtType === "payment" ? "settle_debt" : "debt", customerName);
    }
    setDebtAmount(""); setDebtNote(""); setDebtCustomerName(""); setDebtCustomerId(""); setPanel(null);
    toast.success(debtType === "debt" ? "Đã ghi công nợ" : "Đã ghi nhận khách trả nợ");
  };

  const quickAdjustStock = (productId: string, delta: number) => {
    setDatabase((current) => ({
      ...current,
      products: current.products.map((p) => p.id === productId ? { ...p, stock: Math.max(0, p.stock + delta) } : p),
    }));
    const found = database.products.find((p) => p.id === productId);
    toast.success(`Đã nhập thêm ${delta} ${found?.unit ?? "món"} cho ${found?.name ?? "sản phẩm"}.`);
  };

  const saveCustomer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = customerName.trim();
    const phone = customerPhone.replace(/\s+/g, "");
    if (name.length < 2) return toast.error("Tên khách cần ít nhất 2 ký tự.");
    if (phone && !/^(?:\+84|0)\d{9,10}$/.test(phone)) return toast.error("Số điện thoại chưa đúng định dạng.");
    if (database.customers.some((customer) => normalizeVoiceText(customer.name) === normalizeVoiceText(name) || (phone && customer.phone === phone))) return toast.error("Khách hàng này đã có trong sổ.");
    setDatabase((current) => ({ ...current, customers: [...current.customers, { id: crypto.randomUUID(), name, phone: phone || undefined }] }));
    setCustomerName(""); setCustomerPhone(""); setPanel(null);
    toast.success("Đã thêm khách hàng.");
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(database, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `so-oi-backup-${today()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Đã xuất bản sao dữ liệu Sổ Ơi.");
  };

  const exportDailyPdf = () => {
    const reportWindow = window.open("", "_blank");
    if (!reportWindow) {
      toast.error("Trình duyệt đang chặn cửa sổ xuất PDF. Hãy cho phép cửa sổ bật lên rồi thử lại.");
      return;
    }

    const reportDate = new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());
    const todaysOrders = database.orders.filter((order) => businessDate(order.createdAt) === today());
    const todaysCash = database.cashEntries.filter((entry) => entry.date === today());
    const todaysDebt = (database.debtEntries ?? []).filter((entry) => entry.date === today());
    const otherIncome = todaysCash.filter((entry) => entry.type === "income").reduce((total, entry) => total + entry.amount, 0);
    const expense = todaysCash.filter((entry) => entry.type === "expense").reduce((total, entry) => total + entry.amount, 0);
    const money = (amount: number) => `${Math.round(amount).toLocaleString("vi-VN")}đ`;
    const time = (value: string) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
    const method = (value: PaymentMethod) => value === "cash" ? "Tiền mặt" : value === "transfer" ? "Chuyển khoản" : "Ghi nợ";
    const orderRows = todaysOrders.map((order) => `<tr><td>${escapeHtml(order.number)}</td><td>${time(order.createdAt)}</td><td>${escapeHtml(order.customerName)}</td><td>${method(order.method)}</td><td class="amount">${money(order.total)}</td><td class="amount">${money(order.paid)}</td><td class="amount">${money(Math.max(0, order.total - order.paid))}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">Chưa có đơn hàng nào hôm nay.</td></tr>`;
    const cashRows = todaysCash.map((entry) => `<tr><td><span class="tag ${entry.type === "income" ? "income" : "expense"}">${entry.type === "income" ? "Thu" : "Chi"}</span></td><td>${escapeHtml(entry.category)}</td><td>${escapeHtml(entry.note)}</td><td class="amount ${entry.type === "income" ? "positive" : "negative"}">${entry.type === "income" ? "+" : "-"}${money(entry.amount)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">Chưa có khoản thu chi nào hôm nay.</td></tr>`;
    const debtRows = todaysDebt.map((entry) => `<tr><td><span class="tag ${entry.type === "payment" ? "income" : "expense"}">${entry.type === "payment" ? "Khách trả" : "Ghi nợ"}</span></td><td>${escapeHtml(entry.customerName)}</td><td>${escapeHtml(entry.note)}</td><td class="amount">${money(entry.amount)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">Chưa có phát sinh công nợ hôm nay.</td></tr>`;

    reportWindow.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8" /><title>Báo cáo ${escapeHtml(database.store.name)} - ${today()}</title><style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;color:#10231e;font-family:Arial,sans-serif;font-size:12px}.header{border-bottom:2px solid #0b7a60;padding-bottom:16px}.brand{color:#0b7a60;font-size:20px;font-weight:800}.title{margin:5px 0 0;font-size:26px}.sub{margin:5px 0 0;color:#6b7280}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0}.metric{border:1px solid #d8d5cc;border-radius:10px;padding:12px}.metric p{margin:0;color:#6b7280}.metric strong{display:block;margin-top:6px;font-size:18px}.section{margin-top:22px}.section h2{margin:0 0 8px;font-size:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #e5e7eb;padding:8px;text-align:left;vertical-align:top}th{background:#effaf5;color:#166a54;font-size:11px}.amount{text-align:right;white-space:nowrap;font-weight:700}.positive{color:#08765d}.negative{color:#b91c1c}.tag{display:inline-block;border-radius:999px;padding:3px 7px;font-size:10px;font-weight:700}.tag.income{background:#dcfce7;color:#166534}.tag.expense{background:#fee2e2;color:#b91c1c}.empty{text-align:center;color:#6b7280;padding:16px}.note{margin-top:18px;border-radius:8px;background:#f4f1e9;padding:10px;color:#57534e;font-size:11px}.footer{margin-top:18px;color:#78716c;font-size:10px;text-align:center}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body><header class="header"><div class="brand">Sổ Ơi</div><h1 class="title">Báo cáo bán hàng hằng ngày</h1><p class="sub">${escapeHtml(database.store.name)} · Ngày ${reportDate}</p></header><section class="metrics"><article class="metric"><p>Doanh thu bán hàng</p><strong>${money(summary.revenue)}</strong></article><article class="metric"><p>Đã thu từ đơn hàng</p><strong>${money(summary.collected)}</strong></article><article class="metric"><p>Lợi nhuận tạm tính</p><strong>${money(summary.profit)}</strong></article><article class="metric"><p>Khoản thu khác</p><strong>${money(otherIncome)}</strong></article><article class="metric"><p>Khoản chi hôm nay</p><strong>${money(expense)}</strong></article><article class="metric"><p>Công nợ đang mở</p><strong>${money(summary.openDebt)}</strong></article></section><section class="section"><h2>Đơn hàng hôm nay (${todaysOrders.length})</h2><table><thead><tr><th>Mã đơn</th><th>Giờ</th><th>Khách hàng</th><th>Thanh toán</th><th class="amount">Tổng đơn</th><th class="amount">Đã thu</th><th class="amount">Còn nợ</th></tr></thead><tbody>${orderRows}</tbody></table></section><section class="section"><h2>Thu chi hôm nay</h2><table><thead><tr><th>Loại</th><th>Khoản mục</th><th>Ghi chú</th><th class="amount">Số tiền</th></tr></thead><tbody>${cashRows}</tbody></table></section><section class="section"><h2>Phát sinh công nợ hôm nay</h2><table><thead><tr><th>Loại</th><th>Khách hàng</th><th>Ghi chú</th><th class="amount">Số tiền</th></tr></thead><tbody>${debtRows}</tbody></table></section><p class="note">Lợi nhuận tạm tính = doanh thu bán hàng − giá vốn hàng đã bán − khoản chi hôm nay. Khoản thu khác được hiển thị riêng.</p><footer class="footer">Xuất từ Sổ Ơi lúc ${new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date())}</footer><script>window.onload=()=>window.print()<\/script></body></html>`);
    reportWindow.document.close();
  };

  const importData = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 5_000_000) return toast.error("Bản sao vượt quá 5 MB.");
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!window.confirm("Khôi phục bản sao sẽ thay toàn bộ dữ liệu đang mở. Bạn có muốn tiếp tục?")) return;
      if (!importDatabase(parsed)) return toast.error("File không đúng cấu trúc dữ liệu Sổ Ơi.");
      toast.success("Đã khôi phục dữ liệu từ bản sao.");
    } catch {
      toast.error("Không đọc được file JSON này.");
    }
  };

  const signOut = async () => {
    const supabase = createClient();
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) return toast.error("Chưa thể đăng xuất. Hãy thử lại.");
    router.replace("/dang-nhap");
    router.refresh();
  };

  const handleAssistantCommand = (raw: string) => {
    const command = normalizeVoiceText(raw);
    const has = (...phrases: string[]) => phrases.some((phrase) => command.includes(phrase));
    const currentSummary = calculateSummary(database);
    const lowStock = database.products.filter((product) => product.active && product.stock <= product.lowStock);
    const potentialItems = makeVoiceDraft(raw, database.products);
    const debtByCustomer = new Map<string, number>();
    database.orders.forEach((order) => { const open = Math.max(0, order.total - order.paid); if (open) debtByCustomer.set(order.customerName, (debtByCustomer.get(order.customerName) ?? 0) + open); });
    (database.debtEntries ?? []).forEach((entry) => debtByCustomer.set(entry.customerName, (debtByCustomer.get(entry.customerName) ?? 0) + (entry.type === "debt" ? entry.amount : -entry.amount)));

    const voiceAmount = spokenAmount(` ${command} `);
    const namedKnownCustomer = database.customers.find((candidate) => command.includes(normalizeVoiceText(candidate.name)));
    const hasCustomerName = Boolean(namedKnownCustomer || raw.match(/(?:chị|anh|cô|chú|bác|em)\s+[\p{L}]+/iu));
    const debtPayment = (has("tra no", "thanh toan no", "gui tra", "khach tra", "thu no") || (hasCustomerName && has("tra", "gui") && voiceAmount > 0)) && !potentialItems.length;
    const debtRecord = (has("ghi no", "ghi cong no", "them cong no", "cho no", "no them", "con no", "cong no", "mua chiu", "chiu tien", "thieu tien", "cho thieu") || (hasCustomerName && (command.includes("no") || command.includes("chiu") || command.includes("thieu")) && voiceAmount > 0)) && !potentialItems.length;
    if (debtPayment || debtRecord) {
      const amount = voiceAmount;
      const knownCustomer = namedKnownCustomer;
      const spokenName = raw.match(/(?:chị|anh|cô|chú|bác|em)\s+[\p{L}]+/iu)?.[0] ?? "";
      const isListOnly = amount === 0 && !knownCustomer && !spokenName;
      setDebtType(isListOnly ? "list" : debtPayment ? "payment" : "debt");
      setDebtCustomerId(knownCustomer?.id ?? "");
      setDebtCustomerName(knownCustomer?.name ?? spokenName);
      setDebtAmount(amount > 0 ? formatMoneyInput(amount) : "");
      setDebtNote(amount > 0 || spokenName || knownCustomer ? raw.trim() : "");
      setPanel("debt");
      if (isListOnly) return "Đã mở bảng tổng nợ.";
      return `${debtPayment ? "Đã chuẩn bị ghi nhận khách trả nợ" : "Đã chuẩn bị ghi công nợ"}${amount > 0 ? ` ${formatMoney(amount)}` : ""}${knownCustomer || spokenName ? ` cho ${knownCustomer?.name ?? spokenName}` : ""}. Bạn kiểm tra rồi bấm lưu.`;
    }

    if (has("huy don", "xoa don", "huy don hang", "xoa don hang", "huy don vua tao", "huy don gan nhat", "huy don vua roi")) {
      const latestOrder = database.orders[0];
      if (!latestOrder) return "Hiện tại chưa có đơn hàng nào để hủy.";
      handleCancelOrder(latestOrder.id);
      return `Đã yêu cầu hủy đơn ${latestOrder.number}.`;
    }

    if (has("hom nay ban bao nhieu", "ban duoc bao nhieu", "bua nay ban duoc nhieu", "ban duoc nhieu", "doanh thu", "tong ket", "tinh hinh hom nay", "hom nay the nao", "doanh thu bua nay")) return `Hôm nay có ${currentSummary.orders} đơn, doanh thu ${formatMoney(currentSummary.revenue)}, đã thu ${formatMoney(currentSummary.collected)} và lợi nhuận ${formatMoney(currentSummary.profit)}.`;
    if (has("ai dang no", "khach no", "con thieu", "chua tra", "ghi no bao nhieu", "ai no", "ai con thieu", "ai mua chiu", "ai thieu", "so no", "cong no", "ai chiu")) {
      const debtors = [...debtByCustomer.entries()].filter(([, amount]) => amount > 0).sort((left, right) => right[1] - left[1]);
      return debtors.length ? `Đang có ${debtors.map(([name, amount]) => `${name} nợ ${formatMoney(amount)}`).join("; ")}. Tổng cộng ${formatMoney(debtors.reduce((sum, [, amount]) => sum + amount, 0))}.` : "Hiện không có khách nào đang nợ.";
    }
    if (has("mon nao sap het", "sap het hang", "kiem tra ton", "ton kho", "con bao nhieu", "can nhap hang", "con do hong", "con hang hong", "het do chua", "kiem kho", "mon nao het", "con do khong", "con hang khong")) return lowStock.length ? `${lowStock.map((product) => `${product.name} còn ${product.stock} ${product.unit}`).join("; ")}.` : "Tồn kho đang ổn, chưa có món nào chạm ngưỡng cảnh báo.";
    if (has("tien lai", "loi nhuan", "lai bao nhieu", "lo hay lai")) return `Lợi nhuận hôm nay đang là ${formatMoney(currentSummary.profit)} sau khi trừ giá vốn và các khoản chi.`;
    if (has("chi bao nhieu", "tong chi", "da chi")) return `Tổng các khoản chi hôm nay là ${formatMoney(currentSummary.expense)}.`;

    const amount = spokenAmount(` ${command} `);
    const looksLikeExpense = (has("ghi chi", "them khoan chi", "tra tien", "dong tien", "tien dien", "tien nuoc", "tien nha", "tien luong", "nhap hang", "mua hang", "chi phi", "xai", "tieu") || command.startsWith("chi ") || command.startsWith("xai ") || command.startsWith("mua ")) && amount > 0;
    if (looksLikeExpense) {
      setCashType("expense");
      setCashAmount(formatMoneyInput(amount));
      setCashCategory(has("dien", "nuoc") ? "Điện nước" : has("nhap hang", "mua hang") ? "Nhập hàng" : has("luong", "tien cong") ? "Lương nhân viên" : has("tien nha", "mat bang") ? "Thuê mặt bằng" : "Chi phí khác");
      setCashNote(raw.trim());
      setPanel("cash");
      return `Đã chuẩn bị khoản chi ${formatMoney(amount)}. Bạn kiểm tra rồi bấm lưu.`;
    }
    const looksLikeIncome = (has("ghi thu", "them khoan thu", "thu khac", "nhan tien", "thu ve", "lum", "tien vo") || command.startsWith("thu ") || command.startsWith("nhan ")) && amount > 0;
    if (looksLikeIncome) {
      setCashType("income");
      setCashAmount(formatMoneyInput(amount));
      setCashCategory("Thu khác");
      setCashNote(raw.trim());
      setPanel("cash");
      return `Đã chuẩn bị khoản thu ${formatMoney(amount)}. Bạn kiểm tra rồi bấm lưu.`;
    }

    if (has("them san pham", "them mon moi", "tao san pham", "tao mon", "nhap mat hang moi")) { setProductId(null); setProductName(""); setProductPrice(""); setProductCost(""); setProductStock(""); setPanel("product"); return "Đã mở phần thêm sản phẩm mới."; }
    if (has("xoa san pham", "xoa mon", "xoa mat hang", "xoa hang trong kho", "xoa hang")) {
      const targetProduct = database.products.find((p) => command.includes(normalizeVoiceText(p.name)));
      if (targetProduct) {
        setProductId(targetProduct.id);
        setProductName(targetProduct.name);
        setProductPrice(formatMoneyInput(targetProduct.price));
        setProductCost(formatMoneyInput(targetProduct.cost));
        setProductStock(String(targetProduct.stock));
        setProductCategory(targetProduct.category);
        setPanel("product");
        return `Đã mở mặt hàng "${targetProduct.name}". Bạn bấm nút "Xóa hàng" màu đỏ để xác nhận xóa khỏi kho nhé.`;
      }
      openInventory();
      return "Đã mở danh sách hàng trong kho. Bạn bấm nút “Xóa” ở món cần xóa nhé.";
    }
    if (has("them khach hang", "them khach moi", "luu khach", "tao khach hang")) { setPanel("customer"); return "Đã mở phần thêm khách hàng mới."; }
    if (has("sao luu", "xuat du lieu", "tai du lieu", "backup")) { exportData(); return "Đã tạo bản sao dữ liệu để tải xuống."; }
    if (has("mo gio", "xem gio", "xem don dang tao", "chot don", "thanh toan")) { setPanel("cart"); return "Đã mở đơn hàng để bạn kiểm tra trước khi thanh toán."; }
    if (has("bao cao", "thong ke", "xem so lieu", "ket qua kinh doanh")) { setScreen("report"); return "Đã mở báo cáo hôm nay."; }
    if (has("quan ly", "bang gia", "quet bang gia", "danh sach san pham", "kho hang")) { setScreen("manage"); return "Đã mở phần quản lý hàng hóa và bảng giá."; }

    const items = potentialItems;
    if (items.length) {
      setMethod(has("ghi no", "ghi so", "tra sau", "con no") ? "debt" : has("chuyen khoan", "banking", "quet ma") ? "transfer" : "cash");
      const customer = database.customers.find((candidate) => command.includes(normalizeVoiceText(candidate.name)));
      setCustomerId(customer?.id ?? "");
      const discountIndex = command.search(/giam|bot|tru/);
      setDiscount(discountIndex >= 0 ? spokenAmount(command.slice(discountIndex)) : 0);
      handleVoiceDraft(items, raw);
      const customerText = customer ? ` cho ${customer.name}` : "";
      return `Sổ đã tạo bản nháp${customerText} gồm ${items.reduce((sum, item) => sum + item.quantity, 0)} món. Hãy kiểm tra trước khi lưu.`;
    }

    if (has("ban hang", "tao don", "len don", "mo ban")) { setScreen("sell"); return "Đã mở màn hình bán hàng."; }
    if (has("thu chi", "so quy", "giao dich")) { setScreen("cash"); return "Đã mở Sổ thu chi."; }
    if (has("trang chu", "tong quan", "ve dau", "so sang")) { setScreen("home"); return "Đã quay về màn hình tổng quan."; }

    const productNames = database.products.filter((product) => product.active).slice(0, 4).map((product) => product.name).join(", ");
    return `Mình chưa chắc bạn muốn tạo đơn hay mở chức năng nào. Bạn có thể nói lại kèm hành động, ví dụ “bán hai cà phê sữa”, “ghi chi tiền điện”, “xem công nợ”. Các món hiện có: ${productNames}.`;
  };

  return (
    <main className="min-h-screen bg-stone-100 text-sooi-ink">
      <div className="flex min-h-screen w-full">
        <aside className="hidden w-72 shrink-0 border-r border-stone-200 bg-sooi-card p-5 lg:flex lg:flex-col">
          <Brand />
          <p className="mt-8 px-3 text-xs font-bold tracking-[0.16em] text-stone-400">SỔ BÁN HÀNG</p>
          <nav className="mt-3 space-y-1">
            {navItems.map(({ id, label, icon: Icon }) => <NavButton key={id} active={screen === id} icon={<Icon size={19} />} label={label} onClick={() => setScreen(id)} />)}
          </nav>
        </aside>

        <section className="min-w-0 flex-1 pb-24 lg:pb-8">
          <header className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200/70 bg-[#f4f7fb]/95 px-3 py-3 backdrop-blur sm:px-5 lg:px-8 lg:py-4">
            <div>
              <p className="text-[10px] font-semibold text-stone-500 sm:text-xs">Chào buổi sáng · {syncStatus === "synced" ? "Đã đồng bộ" : syncStatus === "loading" || syncStatus === "syncing" ? "Đang đồng bộ…" : syncStatus === "error" ? "Lỗi đồng bộ" : "Lưu trên máy"}</p>
              <h1 className="mt-0.5 text-[18px] font-black tracking-tight sm:text-xl">{database.store.name}</h1>
            </div>
            <div className="flex items-center gap-2"><div className="hidden sm:block"><VoiceOrderButton onCommand={handleAssistantCommand} store={database.store} /></div><button onClick={() => setPanel("cart")} className="relative hidden size-10 items-center justify-center rounded-full bg-emerald-50 text-sooi-green shadow-sm hover:bg-emerald-100 sm:inline-flex sm:size-11 sm:rounded-xl sm:border sm:border-stone-200 sm:bg-white sm:text-sooi-deep" aria-label="Mở giỏ hàng">
              <ShoppingCart size={20} />
              {cart.length > 0 && <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-sooi-green text-[11px] font-bold text-white">{cart.reduce((sum, item) => sum + item.quantity, 0)}</span>}
            </button></div>
          </header>

          <div className="w-full p-2.5 sm:p-5 lg:p-8">
            {screen === "home" && <HomeScreen summary={summary} database={database} onSell={() => setScreen("sell")} onCash={() => setPanel("cash")} onDebt={() => setPanel("debt")} onManage={openInventory} onCommand={handleAssistantCommand} onSelectOrder={setSelectedOrder} onCancelOrder={handleCancelOrder} onViewAllOrders={() => setShowAllOrders(true)} />}
            {screen === "sell" && <SellScreen products={products} categories={categories} category={category} query={query} cartCount={cart.reduce((sum, item) => sum + item.quantity, 0)} onCategory={setCategory} onQuery={setQuery} onAdd={addProduct} onOpenCart={() => setPanel("cart")} />}
            {screen === "cash" && <CashScreen database={database} onCreate={() => setPanel("cash")} />}
            {screen === "report" && <ReportScreen summary={summary} database={database} onSelectOrder={setSelectedOrder} onCancelOrder={handleCancelOrder} />}
            {screen === "manage" && <ManageScreen database={database} userEmail={userEmail} onSettings={() => setDatabase((current) => ({ ...current, store: { ...current.store, allowNegativeStock: !current.store.allowNegativeStock } }))} onStoreSettings={updateStoreSettings} onReset={() => { if (window.confirm("Khôi phục dữ liệu mẫu sẽ thay toàn bộ dữ liệu hiện tại. Bạn có chắc không?")) { reset(); toast.success("Đã khôi phục dữ liệu mẫu"); } }} onCreate={() => { setProductId(null); setProductName(""); setProductPrice(""); setProductCost(""); setProductStock(""); setPanel("product"); }} onCreateCustomer={() => setPanel("customer")} onEdit={(p) => { setProductId(p.id); setProductName(p.name); setProductPrice(formatMoneyInput(p.price)); setProductCost(formatMoneyInput(p.cost)); setProductStock(String(p.stock)); setProductCategory(p.category); setPanel("product"); }} onExport={exportData} onExportDailyPdf={exportDailyPdf} onImport={() => importInputRef.current?.click()} onPassword={() => router.push("/dat-lai-mat-khau")} onSignOut={signOut} onToggle={(id) => setDatabase((current) => ({ ...current, products: current.products.map((product) => product.id === id ? { ...product, active: !product.active } : product) }))} onDeleteProduct={deleteProductFromStore} onQuickAdjustStock={quickAdjustStock} />}
          </div>
        </section>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 flex h-[66px] border-t border-stone-200 bg-white px-2 pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-2 lg:hidden">
        {[navItems[0], navItems[1]].map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setScreen(id)} className={`flex min-w-0 flex-1 flex-col items-center gap-1 text-[9px] font-bold ${screen === id ? "text-sooi-green" : "text-stone-400"}`}><Icon size={18} />{id === "home" ? "Sổ ơi" : label}</button>)}
        <div className="relative min-w-16 flex-1"><div className="absolute left-1/2 top-[-28px] -translate-x-1/2 rounded-full border-4 border-[#f4f7fb] bg-white p-1 shadow-lg"><VoiceOrderButton onCommand={handleAssistantCommand} variant="fab" store={database.store} /></div></div>
        {[navItems[2], navItems[4]].map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setScreen(id)} className={`flex min-w-0 flex-1 flex-col items-center gap-1 text-[9px] font-bold ${screen === id ? "text-sooi-green" : "text-stone-400"}`}><Icon size={18} />{label}</button>)}
      </nav>

      {panel === "cart" && <CartSheet cart={cart} total={total} subtotal={subtotal} discount={discount} customerId={customerId} method={method} store={database.store} paymentReference={`DH${today().slice(2).replaceAll("-", "")}${String(database.orders.length + 1).padStart(3, "0")}`} customers={database.customers} onClose={() => setPanel(null)} onQuantity={updateQuantity} onDiscount={setDiscount} onCustomer={setCustomerId} onMethod={setMethod} onCheckout={checkout} onCancelCart={cancelCart} />}
      {panel === "cash" && <CashSheet cashType={cashType} category={cashCategory} amount={cashAmount} note={cashNote} onClose={() => setPanel(null)} onType={setCashType} onCategory={setCashCategory} onAmount={setCashAmount} onNote={setCashNote} onSubmit={saveCashEntry} />}
      {panel === "product" && <ProductSheet isEdit={!!productId} name={productName} price={productPrice} cost={productCost} stock={productStock} category={productCategory} onName={setProductName} onPrice={setProductPrice} onCost={setProductCost} onStock={setProductStock} onCategory={setProductCategory} onClose={() => setPanel(null)} onSubmit={saveProduct} onDelete={productId ? () => deleteProductFromStore({ id: productId, name: productName }) : undefined} />}
      {panel === "debt" && <DebtSheet type={debtType} customerId={debtCustomerId} customerName={debtCustomerName} amount={debtAmount} note={debtNote} database={database} onType={setDebtType} onCustomerId={setDebtCustomerId} onCustomerName={setDebtCustomerName} onAmount={setDebtAmount} onNote={setDebtNote} onClose={() => setPanel(null)} onSubmit={saveDebtEntry} />}
      {panel === "customer" && <CustomerSheet name={customerName} phone={customerPhone} onName={setCustomerName} onPhone={setCustomerPhone} onClose={() => setPanel(null)} onSubmit={saveCustomer} />}
      {selectedOrder && <OrderDetailSheet order={selectedOrder} onClose={() => setSelectedOrder(null)} onCancelOrder={handleCancelOrder} />}
      {showAllOrders && <AllOrdersSheet orders={database.orders} onClose={() => setShowAllOrders(false)} onSelectOrder={(o) => { setShowAllOrders(false); setSelectedOrder(o); }} onCancelOrder={handleCancelOrder} />}
      <input ref={importInputRef} type="file" accept="application/json,.json" onChange={importData} className="hidden" aria-hidden />
    </main>
  );
}

function VoiceOrderButton({
  onCommand,
  onInterim,
  variant = "default",
  store,
}: {
  onCommand: (transcript: string) => string;
  onInterim?: (transcript: string) => void;
  variant?: "default" | "fab" | "field";
  store?: StoreSettings;
}) {
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const recognitionRef = useRef<BrowserRecognition | null>(null);
  const recorderRef = useRef<AudioVoiceRecorder | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handledRef = useRef(false);
  const transcriptRef = useRef("");
  const errorRef = useRef("");


  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recorderRef.current?.cancel();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
    };
  }, []);

  const handleTranscript = (transcript: string) => {
    const text = transcript.trim();
    if (handledRef.current || !text) return;
    handledRef.current = true;
    const reply = onCommand(text);
    if (reply) toast.message(reply);
  };

  const stopVoiceOrder = async () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);

    if (recorderRef.current) {
      setListening(false);
      setProcessing(true);
      try {
        const audioBlob = await recorderRef.current.stop();
        toast.info("Đang nhận diện giọng nói...");
        const text = await transcribeAudioWithApi(audioBlob);
        if (text) {
          handleTranscript(text);
        } else {
          toast.error("Không nghe rõ âm thanh. Hãy nói to rõ hơn.");
        }
      } catch (err: unknown) {
        console.warn("[VoiceOrder] AI transcription error:", err);
        const msg = err instanceof Error ? err.message : "Lỗi nhận diện giọng nói.";
        toast.error(msg);
      } finally {
        setProcessing(false);
        recorderRef.current = null;
      }
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (_) {}
    }

    const captured = transcriptRef.current.trim();
    if (captured && !handledRef.current) {
      handleTranscript(captured);
    }
  };

  const startVoiceOrder = async () => {
    if (processing) return;
    if (listening) {
      await stopVoiceOrder();
      return;
    }

    handledRef.current = false;
    transcriptRef.current = "";
    errorRef.current = "";

    // 1. Kiểm tra / xin quyền micro từ trình duyệt
    const micError = await requestMicrophoneAccess();
    if (micError) {
      toast.error(micError);
      return;
    }

    const Recognition = getBrowserRecognition();

    if (!Recognition) {
      try {
        const recorder = new AudioVoiceRecorder();
        recorderRef.current = recorder;
        await recorder.start();
        setListening(true);
        timeoutRef.current = setTimeout(() => {
          stopVoiceOrder();
        }, 12000);
      } catch (err) {
        console.warn("[VoiceOrder] mic access error:", err);
        toast.error("Không thể mở micro. Hãy kiểm tra lại quyền micro trong cài đặt trình duyệt.");
      }
      return;
    }

    try {
      recognitionRef.current?.stop();
    } catch (_) {}

    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.lang = "vi-VN";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      handledRef.current = false;
      transcriptRef.current = "";
      errorRef.current = "";
      setListening(true);

      // Tự động dừng sau tối đa 12 giây
      timeoutRef.current = setTimeout(() => {
        stopVoiceOrder();
      }, 12000);
    };

    recognition.onend = () => {
      setListening(false);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);

      const captured = transcriptRef.current.trim();
      console.warn("[SooiVoice] onend — transcript:", captured, "| error:", errorRef.current, "| handled:", handledRef.current);

      if (!handledRef.current && captured) {
        handleTranscript(captured);
      } else if (!handledRef.current && !captured && !errorRef.current) {
        if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
          toast.info(safariSpeechEndedWithoutResultMessage);
        } else {
          toast.info("Chưa nghe thấy giọng nói. Hãy bấm lại micro và nói to, rõ hơn nhé.");
        }
      }
    };

    recognition.onerror = ({ error }) => {
      console.warn("[SooiVoice] onerror:", error);
      if (error === "aborted") return;
      if (error === "no-speech") {
        // Khoảng lặng bình thường, không báo lỗi đỏ dọa người dùng
        return;
      }
      errorRef.current = error;
      toast.error(voiceErrorMessage(error));
    };

    recognition.onresult = (event) => {
      let fullTranscript = "";
      for (let i = 0; i < event.results.length; i++) {
        fullTranscript += (event.results[i][0]?.transcript || "") + " ";
      }
      fullTranscript = fullTranscript.trim();

      if (fullTranscript) {
        transcriptRef.current = fullTranscript;
        onInterim?.(fullTranscript);

        // Tự động chốt lệnh sau 1.8 giây im lặng kể từ khi có nội dung
        if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = setTimeout(() => {
          stopVoiceOrder();
        }, 1800);
      }
    };

    try {
      recognition.start();
    } catch (startError) {
      console.warn("[SooiVoice] recognition.start() failed:", startError);
      const msg = startError instanceof DOMException && startError.name === "InvalidStateError"
        ? "Micro đang bận, hãy đợi một giây rồi thử lại."
        : "Không thể khởi động micro. Hãy kiểm tra quyền micro trong cài đặt trình duyệt.";
      toast.error(msg);
    }
  };

  const variantClass = variant === "fab" ? "size-11 justify-center rounded-full p-0" : variant === "field" ? "size-10 justify-center rounded-xl p-0" : "h-11 gap-2 rounded-xl px-3 sm:px-4";
  return (
    <button
      type="button"
      onClick={startVoiceOrder}
      disabled={processing}
      className={`inline-flex items-center text-sm font-extrabold text-white shadow-sm transition ${variantClass} ${
        processing
          ? "animate-pulse bg-amber-600"
          : listening
          ? "animate-pulse bg-rose-500 hover:bg-rose-600"
          : "bg-sooi-green hover:bg-emerald-800"
      }`}
      aria-label={processing ? "Đang xử lý giọng nói" : listening ? "Dừng ghi đơn bằng giọng nói" : "Ghi đơn bằng giọng nói"}
      title={processing ? "Đang xử lý giọng nói..." : listening ? "Đang nghe, bấm để dừng" : "Ghi đơn bằng giọng nói"}
    >
      <Mic size={variant === "fab" ? 19 : 18} />
      <span className={variant === "default" ? "hidden sm:inline" : "hidden"}>
        {processing ? "Đang xử lý…" : listening ? "Đang nghe…" : "Nói với Sổ"}
      </span>
    </button>
  );
}

function Brand() { return <Link href="/" className="flex items-center px-2" aria-label="Sổ Ơi - Trang chủ"><Image src="/images/logo.webp" alt="Sổ Ơi" width={1024} height={384} priority className="h-10 w-auto object-contain" /></Link>; }
function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) { return <button onClick={onClick} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold transition ${active ? "bg-emerald-50 text-sooi-green" : "text-stone-600 hover:bg-stone-100"}`}>{icon}{label}</button>; }

function HomeScreen({
  summary,
  database,
  onSell,
  onCash,
  onDebt,
  onManage,
  onCommand,
  onSelectOrder,
  onCancelOrder,
  onViewAllOrders,
}: {
  summary: ReturnType<typeof calculateSummary>;
  database: ReturnType<typeof useLedger>["database"];
  onSell: () => void;
  onCash: () => void;
  onDebt: () => void;
  onManage: () => void;
  onCommand: (command: string) => string;
  onSelectOrder?: (order: Order) => void;
  onCancelOrder?: (orderId: string) => void;
  onViewAllOrders?: () => void;
}) {
  const lowStock = database.products.filter((product) => product.active && product.stock <= product.lowStock);
  const urgentProduct = lowStock[0];

  return <div className="space-y-3.5 sm:space-y-6">
    <VoiceCommandCard onCommand={onCommand} store={database.store} />

    <section>
      <h2 className="text-[16px] font-black tracking-tight">VIỆC HÔM NAY</h2>
      <div className="mt-2 grid grid-cols-4 gap-2">
        <Action icon={<ShoppingCart />} label="Bán hàng" onClick={onSell} />
        <Action icon={<WalletCards />} label="Thu chi" onClick={onCash} />
        <Action icon={<ReceiptText />} label="Công nợ" onClick={onDebt} />
        <Action icon={<PackageOpen />} label="Xem kho" onClick={onManage} />
      </div>
    </section>

    <section className="relative overflow-hidden rounded-[20px] bg-[linear-gradient(145deg,#07966e,#00664f)] p-4 text-white shadow-lg shadow-emerald-950/10 sm:p-6">
      <div className="absolute -right-3 -top-4 size-20 rounded-full bg-white/8" />
      <div className="absolute right-3 top-3 size-8 rounded-full bg-emerald-950/20" />
      <span className="inline-flex rounded-full bg-white/15 px-2 py-1 text-[9px] font-extrabold">Sổ chủ động</span>
      <p className="mt-2 text-[11px] font-bold text-emerald-100">SỔ SÁNG · {String(new Date().getHours()).padStart(2, "0")}:{String(new Date().getMinutes()).padStart(2, "0")}</p>
      <h2 className="mt-1 text-[22px] font-black leading-tight tracking-[-0.03em] sm:text-3xl">Mở sổ cho một ngày mới.</h2>
      <p className="mt-2 max-w-2xl text-[11px] leading-4 text-emerald-50 sm:text-sm sm:leading-6">{urgentProduct ? `Việc nên làm trước: ${urgentProduct.name} chỉ đủ khoảng 6 ngày. Đang có ${formatMoneyShort(summary.openDebt)} công nợ cần để mắt tới.` : "Tồn kho đang ổn. Sổ sẽ nhắc ngay khi có món cần nhập thêm."}</p>
      <div className="mt-4 grid grid-cols-3 border-t border-white/25 pt-3">
        <Metric label="Doanh thu" value={formatMoneyShort(summary.revenue)} />
        <Metric label="Tiền lãi" value={formatMoneyShort(summary.profit)} />
        <Metric label="Đơn" value={String(summary.orders)} />
      </div>
    </section>

    <section>
      <div className="flex items-end justify-between"><SectionTitle title="Sổ thấy việc này" subtitle="Một việc đáng chú ý hôm nay." /><button onClick={onManage} className="text-[10px] font-extrabold text-sooi-green">Tất cả ›</button></div>
      <div className="mt-2 rounded-2xl border border-amber-200 bg-[#fffdf8] p-3.5">
        {urgentProduct ? <><div className="flex gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-50 text-sooi-green"><Package size={18} /></span><div><p className="text-[12px] font-extrabold">{urgentProduct.name} chỉ đủ khoảng 6 ngày</p><p className="mt-1 text-[10px] leading-4 text-stone-500">Còn {urgentProduct.stock} {urgentProduct.unit}. Dựa trên nhịp bán gần nhất, Sổ gợi ý nhập khoảng {Math.max(urgentProduct.lowStock * 2 - urgentProduct.stock, urgentProduct.lowStock)} {urgentProduct.unit} để đủ gần 7 ngày.</p></div></div><div className="mt-3 grid grid-cols-2 gap-2"><button onClick={onManage} className="h-10 rounded-xl bg-emerald-100 text-[11px] font-extrabold text-sooi-green">Nhập gợi ý</button><button className="h-10 rounded-xl border border-stone-200 bg-white text-[11px] font-extrabold">Để mai</button></div></> : <Empty text="Hôm nay chưa có việc tồn kho cần xử lý." />}
      </div>
    </section>

    <section>
      <div className="flex items-end justify-between"><SectionTitle title="Hôm nay" subtitle="Ba con số đủ để nắm nhịp." /><button onClick={() => toast.message("Mở mục Báo cáo để xem chi tiết.")} className="text-[10px] font-extrabold text-sooi-green">Chi tiết</button></div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <MiniMetric label="Đã thu về" value={formatMoneyShort(summary.collected)} />
        <MiniMetric label="Chi" value={formatMoneyShort(summary.expense)} />
        <MiniMetric label="Khách còn nợ" value={formatMoneyShort(summary.openDebt)} />
      </div>
    </section>

    <section>
      <div className="flex items-end justify-between">
        <SectionTitle title="Gần đây" subtitle="Giao dịch mới nhất." />
        <button onClick={onViewAllOrders ?? onSell} className="text-[10px] font-extrabold text-sooi-green">Xem tất cả</button>
      </div>
      <div className="mt-2 rounded-2xl border border-stone-200 bg-white px-4 py-3">
        {database.orders.length ? (
          <div className="divide-y divide-stone-100">
            {database.orders.slice(0, 5).map((order) => (
              <div key={order.id} className="group flex items-center justify-between py-3">
                <button
                  type="button"
                  onClick={() => onSelectOrder?.(order)}
                  className="min-w-0 flex-1 text-left transition hover:opacity-80"
                >
                  <p className="truncate text-xs font-extrabold text-stone-900 group-hover:text-sooi-green transition">
                    {order.customerName}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-stone-500">
                    {order.number} · {order.method === "debt" ? "Ghi nợ" : order.method === "transfer" ? "Chuyển khoản" : "Tiền mặt"} · {order.items.reduce((s, i) => s + i.quantity, 0)} món
                  </p>
                </button>
                <div className="flex items-center gap-2.5 pl-3">
                  <span className="text-xs font-extrabold text-stone-900">{formatMoney(order.total)}</span>
                  {onCancelOrder && (
                    <button
                      type="button"
                      onClick={() => onCancelOrder(order.id)}
                      className="grid size-8 place-items-center rounded-lg text-stone-400 hover:bg-rose-50 hover:text-rose-600 transition"
                      title="Hủy đơn hàng"
                      aria-label={`Hủy đơn ${order.number}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-5 text-center">
            <p className="text-xs font-extrabold text-stone-500">Chưa có đơn hôm nay</p>
            <p className="mt-1 text-[10px] text-stone-400">Thử nói “bán 2 cà phê sữa 25 nghìn”.</p>
          </div>
        )}
      </div>
    </section>
  </div>;
}

function VoiceCommandCard({ onCommand, store }: { onCommand: (command: string) => string; store?: StoreSettings }) {
  const [command, setCommand] = useState("");
  const [reply, setReply] = useState("");
  const submit = () => {
    const value = command.trim();
    if (!value) { toast.error("Hãy nói hoặc nhập một câu bán hàng."); return; }
    setReply(onCommand(value));
  };

  return <section className="rounded-[18px] border border-stone-200 bg-white p-3 shadow-sm sm:p-5">
    <p className="text-[9px] font-extrabold text-sooi-green">Nói với Sổ ơi</p>
    <h2 className="text-[16px] font-black">Sổ ơi, mình làm gì?</h2>
    <p className="mt-0.5 text-[10px] text-stone-500">Nói tự nhiên. Sổ sẽ hiểu và làm phần còn lại.</p>
    <div className="mt-3 flex items-center gap-1.5 rounded-xl bg-stone-50 p-1">
      <input
        value={command}
        onChange={(event) => setCommand(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") submit(); }}
        className="h-9 min-w-0 flex-1 bg-transparent px-2 text-[11px] outline-none"
        placeholder="Ví dụ: bán chị Lan 2 cà phê sữa..."
        aria-label="Nói hoặc nhập lệnh cho Sổ Ơi"
      />
      <VoiceOrderButton
        onCommand={(value) => {
          setCommand(value);
          const response = onCommand(value);
          setReply(response);
          return "";
        }}
        onInterim={(value) => {
          setCommand(value);
        }}
        variant="field"
        store={store}
      />
      <button onClick={submit} className="grid size-10 shrink-0 place-items-center rounded-xl bg-sooi-green text-white" aria-label="Thực hiện lệnh"><ArrowRight size={18} /></button>
    </div>
    <div className="mt-2 flex flex-wrap gap-1.5">{["Hôm nay bán bao nhiêu?", "Ai đang nợ?", "Món nào sắp hết?"].map((item) => <button key={item} onClick={() => { setCommand(item); setReply(onCommand(item)); }} className="rounded-full bg-stone-100 px-2.5 py-1.5 text-[9px] font-semibold text-stone-500">{item}</button>)}</div>
    {reply && <div className="mt-2 rounded-xl bg-emerald-50 px-3 py-2 text-[10px] font-semibold leading-4 text-emerald-800" aria-live="polite">{reply}</div>}
  </section>;
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-stone-200 bg-white p-3"><p className="text-[9px] font-semibold text-stone-500">{label}</p><p className="mt-1 text-[15px] font-black">{value}</p></div>;
}

function SellScreen({ products, categories, category, query, cartCount, onCategory, onQuery, onAdd, onOpenCart }: { products: Product[]; categories: string[]; category: string; query: string; cartCount: number; onCategory: (value: string) => void; onQuery: (value: string) => void; onAdd: (product: Product) => void; onOpenCart: () => void }) { return <div><SectionTitle title="Bán hàng" subtitle="Chạm vào món để thêm ngay vào đơn." /><div className="relative mt-5"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" size={19} /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Tìm món…" className="h-12 w-full rounded-xl border border-stone-200 bg-white pl-11 pr-4 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100" /></div><div className="mt-4 flex gap-2 overflow-x-auto pb-1">{categories.map((item) => <button key={item} onClick={() => onCategory(item)} className={`shrink-0 rounded-xl px-4 py-2 text-sm font-bold ${category === item ? "bg-sooi-green text-white" : "border border-stone-200 bg-white text-stone-600"}`}>{item}</button>)}</div><div className="mt-5 grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">{products.map((product) => <button key={product.id} onClick={() => onAdd(product)} className="group min-h-40 rounded-2xl border border-stone-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"><div className="flex items-start justify-between gap-3"><span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-sooi-green"><Coffee size={20} /></span>{product.stock <= product.lowStock && <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-700">Sắp hết</span>}</div><p className="mt-6 font-extrabold">{product.name}</p><p className="mt-1 text-xs text-stone-500">Còn {product.stock} {product.unit}</p><p className="mt-3 text-lg font-extrabold text-sooi-green">{formatMoney(product.price)}</p></button>)}</div>{!products.length && <Empty text="Không tìm thấy món phù hợp." />}<div className="mt-3 flex justify-end sm:hidden"><button onClick={onOpenCart} className="relative grid size-12 place-items-center rounded-full bg-sooi-green text-white shadow-lg shadow-emerald-900/20" aria-label="Mở giỏ hàng"><ShoppingCart size={22} />{cartCount > 0 && <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-emerald-900 text-[11px] font-bold text-white">{cartCount}</span>}</button></div></div>; }

function CashScreen({ database, onCreate }: { database: ReturnType<typeof useLedger>["database"]; onCreate: () => void }) { const entries = database.cashEntries.filter((entry) => entry.date === today()); return <div><div className="flex items-start justify-between"><SectionTitle title="Sổ thu chi" subtitle="Các khoản ngoài doanh thu bán hàng." /><button onClick={onCreate} className="inline-flex h-11 items-center gap-2 rounded-xl bg-sooi-green px-4 text-sm font-bold text-white"><Plus size={18} />Ghi khoản</button></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><StatCard icon={<TrendingDown />} label="Tổng chi hôm nay" value={formatMoney(entries.filter((item) => item.type === "expense").reduce((sum, item) => sum + item.amount, 0))} tone="red" /><StatCard icon={<TrendingUp />} label="Thu khác hôm nay" value={formatMoney(entries.filter((item) => item.type === "income").reduce((sum, item) => sum + item.amount, 0))} tone="green" /></div><div className="mt-5 rounded-2xl border border-stone-200 bg-white p-5"><SectionTitle title="Giao dịch hôm nay" subtitle="" />{entries.length ? <div className="divide-y divide-stone-100">{entries.map((entry) => <div key={entry.id} className="flex items-center gap-3 py-3"><div className={`grid size-10 place-items-center rounded-xl ${entry.type === "expense" ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"}`}>{entry.type === "expense" ? <TrendingDown size={18} /> : <TrendingUp size={18} />}</div><div className="min-w-0 flex-1"><p className="truncate font-bold">{entry.category}</p><p className="truncate text-xs text-stone-500">{entry.note}</p></div><strong className={entry.type === "expense" ? "text-red-600" : "text-emerald-700"}>{entry.type === "expense" ? "−" : "+"}{formatMoney(entry.amount)}</strong></div>)}</div> : <Empty text="Chưa có khoản thu chi nào hôm nay." />}</div></div>; }

function ReportScreen({
  summary,
  database,
  onSelectOrder,
  onCancelOrder,
}: {
  summary: ReturnType<typeof calculateSummary>;
  database: ReturnType<typeof useLedger>["database"];
  onSelectOrder?: (order: Order) => void;
  onCancelOrder?: (orderId: string) => void;
}) {
  const sold = database.orders.flatMap((order) => order.items).reduce<Record<string, number>>((map, item) => ({ ...map, [item.name]: (map[item.name] ?? 0) + item.quantity }), {});
  const best = Object.entries(sold).sort(([, a], [, b]) => b - a).slice(0, 4);
  const todaysOrders = database.orders.filter((order) => businessDate(order.createdAt) === today());

  return (
    <div>
      <SectionTitle title="Báo cáo hôm nay" subtitle="Con số quan trọng, không làm rối mắt." />
      <div className="mt-5 grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <StatCard icon={<ReceiptText />} label="Doanh thu" value={formatMoney(summary.revenue)} tone="green" />
        <StatCard icon={<CreditCard />} label="Đã thu" value={formatMoney(summary.collected)} tone="blue" />
        <StatCard icon={<TrendingDown />} label="Chi phí" value={formatMoney(summary.expense)} tone="red" />
        <StatCard icon={<TrendingUp />} label="Tiền lời" value={formatMoney(summary.profit)} tone="green" />
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <SectionTitle title="Công nợ đang mở" subtitle="Tổng các đơn ghi nợ chưa thu đủ." />
          <p className="mt-5 text-3xl font-extrabold text-amber-700">{formatMoney(summary.openDebt)}</p>
          <p className="mt-1 text-sm text-stone-500">Sổ sẽ tự cập nhật khi ghi nhận khách trả nợ.</p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-5">
          <SectionTitle title="Bán chạy" subtitle="Tổng số lượng trong các đơn đã tạo." />
          {best.length ? (
            <div className="mt-2 divide-y divide-stone-100">
              {best.map(([name, quantity], index) => (
                <div className="flex items-center gap-3 py-3" key={name}>
                  <span className="grid size-7 place-items-center rounded-lg bg-emerald-50 text-xs font-extrabold text-sooi-green">{index + 1}</span>
                  <p className="flex-1 font-bold">{name}</p>
                  <strong>{quantity} món</strong>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="Dữ liệu bán chạy sẽ xuất hiện sau đơn đầu tiên." />
          )}
        </div>
      </div>
      <div className="mt-5 rounded-2xl border border-stone-200 bg-white p-5">
        <SectionTitle title={`Đơn hàng hôm nay (${todaysOrders.length})`} subtitle="Bấm vào đơn để xem chi tiết hoặc hủy đơn." />
        {todaysOrders.length ? (
          <div className="mt-3 divide-y divide-stone-100">
            {todaysOrders.map((order) => (
              <div key={order.id} className="group flex items-center justify-between py-3">
                <button
                  type="button"
                  onClick={() => onSelectOrder?.(order)}
                  className="min-w-0 flex-1 text-left transition hover:opacity-85"
                >
                  <p className="truncate font-extrabold text-stone-900 group-hover:text-sooi-green transition">
                    {order.customerName}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-stone-500">
                    {order.number} · {order.method === "cash" ? "Tiền mặt" : order.method === "transfer" ? "Chuyển khoản" : "Ghi nợ"} · {order.items.reduce((s, i) => s + i.quantity, 0)} món
                  </p>
                </button>
                <div className="flex items-center gap-3 pl-3">
                  <span className="font-extrabold text-stone-900">{formatMoney(order.total)}</span>
                  {onCancelOrder && (
                    <button
                      type="button"
                      onClick={() => onCancelOrder(order.id)}
                      className="grid size-8 place-items-center rounded-lg text-stone-400 hover:bg-rose-50 hover:text-rose-600 transition"
                      title="Hủy đơn hàng"
                      aria-label={`Hủy đơn ${order.number}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty text="Chưa có đơn hàng nào hôm nay." />
        )}
      </div>
    </div>
  );
}

function PaymentSettingsCard({ store, onSave }: { store: StoreSettings; onSave: (patch: Partial<StoreSettings>) => void }) {
  const matchedBank = store.bankBin ? findBankByBin(store.bankBin) : undefined;
  const initialIsCustom = Boolean(store.bankBin && !matchedBank);

  const [selectedBin, setSelectedBin] = useState(() => {
    if (!store.bankBin) return "";
    return matchedBank ? matchedBank.bin : "custom";
  });
  const [isCustom, setIsCustom] = useState(initialIsCustom);
  const [bankName, setBankName] = useState(store.bankName ?? (matchedBank ? matchedBank.shortName : ""));
  const [bankBin, setBankBin] = useState(store.bankBin ?? "");
  const [bankAccount, setBankAccount] = useState(store.bankAccount ?? "");
  const [bankOwner, setBankOwner] = useState(store.bankOwner ?? "");

  const handleBankChange = (bin: string) => {
    setSelectedBin(bin);
    if (bin === "custom") {
      setIsCustom(true);
    } else {
      setIsCustom(false);
      const found = findBankByBin(bin);
      if (found) {
        setBankBin(found.bin);
        setBankName(found.shortName);
      } else {
        setBankBin("");
        setBankName("");
      }
    }
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedAccount = bankAccount.replace(/\s+/g, "");
    const finalBin = bankBin.trim();
    const finalName = bankName.trim();

    if (!finalName && !finalBin && !normalizedAccount && !bankOwner.trim()) {
      onSave({ bankName: "", bankBin: "", bankAccount: "", bankOwner: "" });
      toast.success("Đã tắt QR nhận tiền.");
      return;
    }
    if (!finalBin || !normalizedAccount) {
      toast.error("Vui lòng chọn ngân hàng và nhập số tài khoản để bật QR.");
      return;
    }
    if (normalizedAccount && !/^\d{4,30}$/.test(normalizedAccount)) {
      toast.error("Số tài khoản chỉ được gồm 4–30 chữ số.");
      return;
    }
    if (finalBin && !/^[a-z0-9]{3,20}$/i.test(finalBin)) {
      toast.error("Mã BIN ngân hàng không hợp lệ.");
      return;
    }
    onSave({
      bankName: finalName,
      bankBin: finalBin,
      bankAccount: normalizedAccount,
      bankOwner: bankOwner.trim(),
    });
    toast.success("Đã lưu thông tin nhận chuyển khoản.");
  };

  const selectedBank = findBankByBin(bankBin);
  const categories: BankCategory[] = ["popular", "digital", "commercial", "foreign"];

  return (
    <form onSubmit={save} className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 lg:col-span-2">
      <p className="text-xs font-bold tracking-[0.14em] text-emerald-700">QR NHẬN TIỀN</p>
      <p className="mt-2 text-lg font-extrabold">Hiển thị QR khi khách chuyển khoản</p>
      <p className="mt-1 text-sm text-stone-600">Chọn ngân hàng và nhập số tài khoản. QR sẽ tự điền số tiền và mã đơn ở bước thanh toán.</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="block text-xs font-bold text-stone-700">
            Ngân hàng
            <select
              value={selectedBin}
              onChange={(e) => handleBankChange(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm font-semibold text-stone-800 outline-none focus:border-emerald-500 cursor-pointer"
            >
              <option value="">-- Chọn ngân hàng nhận tiền --</option>
              {categories.map((cat) => {
                const banks = VIETNAM_BANKS.filter((b) => b.category === cat);
                if (!banks.length) return null;
                return (
                  <optgroup key={cat} label={BANK_CATEGORY_LABELS[cat]}>
                    {banks.map((b) => (
                      <option key={b.bin} value={b.bin}>
                        {b.shortName} - {b.name} (Mã BIN: {b.bin})
                      </option>
                    ))}
                  </optgroup>
                );
              })}
              <optgroup label="Khác">
                <option value="custom">⚡ Ngân hàng khác (Tự điền mã BIN)</option>
              </optgroup>
            </select>
          </label>
          {selectedBank && !isCustom && (
            <p className="mt-1.5 text-[11px] text-stone-500">
              Mã BIN: <span className="font-bold text-emerald-700">{selectedBank.bin}</span> · {selectedBank.name} ({selectedBank.code})
            </p>
          )}
        </div>

        {isCustom && (
          <>
            <label className="text-xs font-bold text-stone-700">
              Tên ngân hàng
              <input
                value={bankName}
                onChange={(event) => setBankName(event.target.value)}
                className="mt-1.5 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm font-normal outline-none focus:border-emerald-500"
                placeholder="Ví dụ: Vietcombank"
              />
            </label>
            <label className="text-xs font-bold text-stone-700">
              Mã BIN ngân hàng
              <input
                value={bankBin}
                onChange={(event) => setBankBin(event.target.value)}
                className="mt-1.5 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm font-normal outline-none focus:border-emerald-500"
                placeholder="Ví dụ: 970436"
              />
            </label>
          </>
        )}

        <label className="text-xs font-bold text-stone-700">
          Số tài khoản
          <input
            inputMode="numeric"
            value={bankAccount}
            onChange={(event) => setBankAccount(event.target.value)}
            className="mt-1.5 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm font-normal outline-none focus:border-emerald-500"
            placeholder="Nhập số tài khoản nhận tiền"
          />
        </label>
        <label className="text-xs font-bold text-stone-700">
          Tên chủ tài khoản <span className="font-normal text-stone-400">(không bắt buộc)</span>
          <input
            value={bankOwner}
            onChange={(event) => setBankOwner(event.target.value)}
            className="mt-1.5 h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm font-normal uppercase outline-none focus:border-emerald-500"
            placeholder="Ví dụ: NGUYEN VAN A"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" className="rounded-xl bg-sooi-green px-4 py-2.5 text-xs font-extrabold text-white hover:bg-emerald-800 transition">
          Lưu thông tin QR
        </button>
        <span className="text-xs text-stone-500">Để trống toàn bộ để tắt QR.</span>
      </div>
    </form>
  );
}

function VoiceSettingsCard({ store, onSave }: { store: StoreSettings; onSave: (patch: Partial<StoreSettings>) => void }) {
  const isEnabled = store.voiceAnnouncement !== false;

  const toggle = () => {
    const next = !isEnabled;
    onSave({ voiceAnnouncement: next });
    toast.success(next ? "Đã bật loa đọc tiền khi thanh toán." : "Đã tắt loa đọc tiền.");
  };

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5 lg:col-span-1">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold tracking-[0.14em] text-stone-400">LOA THÔNG BÁO</p>
        <span className="grid size-8 place-items-center rounded-xl bg-emerald-50 text-sooi-green">
          <Volume2 size={16} />
        </span>
      </div>
      <p className="mt-2 text-lg font-extrabold">{isEnabled ? "Bật loa đọc tiền" : "Tắt loa đọc tiền"}</p>
      <p className="mt-1 text-sm text-stone-500">
        Tự động phát giọng đọc số tiền khi khách thanh toán thành công (tương tự loa thông báo MoMo / VNPay).
      </p>
      <button
        type="button"
        onClick={toggle}
        className="mt-5 rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-bold text-sooi-deep hover:bg-stone-50 transition"
      >
        {isEnabled ? "Tắt loa đọc tiền" : "Bật loa đọc tiền"}
      </button>
    </div>
  );
}

function ManageScreen({ database, userEmail, onSettings, onStoreSettings, onReset, onCreate, onCreateCustomer, onEdit, onExport, onExportDailyPdf, onImport, onPassword, onSignOut, onToggle, onDeleteProduct, onQuickAdjustStock }: { database: ReturnType<typeof useLedger>["database"]; userEmail: string; onSettings: () => void; onStoreSettings: (patch: Partial<StoreSettings>) => void; onReset: () => void; onCreate: () => void; onCreateCustomer: () => void; onEdit: (product: Product) => void; onExport: () => void; onExportDailyPdf: () => void; onImport: () => void; onPassword: () => void; onSignOut: () => void; onToggle: (id: string) => void; onDeleteProduct: (product: Product) => void; onQuickAdjustStock: (productId: string, delta: number) => void }) {
  const activeProducts = database.products.filter((p) => p.active);
  const outOfStock = activeProducts.filter((p) => p.stock <= 0);
  const lowStock = activeProducts.filter((p) => p.stock > 0 && p.stock <= p.lowStock);
  const okStock = activeProducts.filter((p) => p.stock > p.lowStock);

  return <div>
    <div className="flex items-start justify-between gap-3"><SectionTitle title="Quản lý cửa hàng" subtitle="Thiết lập và dữ liệu phục vụ bán hàng." /><button onClick={onCreate} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-sooi-green px-3 text-xs font-extrabold text-white"><Plus size={16} />Thêm món</button></div>
    <div className="mt-5 grid gap-4 lg:grid-cols-3">
      <div className="rounded-2xl border border-stone-200 bg-white p-5"><p className="text-xs font-bold tracking-[0.14em] text-stone-400">TỒN KHO</p><p className="mt-2 text-lg font-extrabold">{database.store.allowNegativeStock ? "Cho phép bán âm kho" : "Chặn bán âm kho"}</p><p className="mt-1 text-sm text-stone-500">Sổ kiểm tra tồn trước khi thanh toán để tránh bán quá số lượng hiện có.</p><button onClick={onSettings} className="mt-5 rounded-xl border border-stone-200 px-4 py-2.5 text-sm font-bold text-sooi-deep hover:bg-stone-50">{database.store.allowNegativeStock ? "Bật chặn bán âm" : "Cho phép bán âm"}</button></div>
      <PaymentSettingsCard key={`${database.store.bankName ?? ""}|${database.store.bankBin ?? ""}|${database.store.bankAccount ?? ""}|${database.store.bankOwner ?? ""}`} store={database.store} onSave={onStoreSettings} />
      <VoiceSettingsCard key={String(database.store.voiceAnnouncement !== false)} store={database.store} onSave={onStoreSettings} />
      <div className="rounded-2xl border border-stone-200 bg-white p-5"><p className="text-xs font-bold tracking-[0.14em] text-stone-400">SAO LƯU & BÁO CÁO</p><p className="mt-2 text-lg font-extrabold">Dữ liệu local-first</p><p className="mt-1 text-sm text-stone-500">Hiện có {database.products.length} sản phẩm, {database.customers.length} khách hàng và {database.orders.length} đơn.</p><div className="mt-5 flex flex-wrap gap-2"><button onClick={onExport} className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-xs font-bold text-sooi-green"><Download size={15} />Xuất JSON</button><button onClick={onExportDailyPdf} className="inline-flex items-center gap-2 rounded-xl bg-sooi-green px-3 py-2.5 text-xs font-bold text-white"><FileDown size={15} />Xuất PDF hôm nay</button><button onClick={onImport} className="inline-flex items-center gap-2 rounded-xl border border-stone-200 px-3 py-2.5 text-xs font-bold"><Upload size={15} />Khôi phục</button></div></div>
      <div className="rounded-2xl border border-stone-200 bg-white p-5"><p className="text-xs font-bold tracking-[0.14em] text-stone-400">TÀI KHOẢN</p><div className="mt-3 flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-sooi-green"><UserRound size={19} /></span><p className="min-w-0 truncate text-sm font-bold">{userEmail}</p></div><div className="mt-5 flex flex-wrap gap-2"><button onClick={onPassword} className="rounded-xl border border-stone-200 px-3 py-2.5 text-xs font-bold">Đổi mật khẩu</button><button onClick={onSignOut} className="rounded-xl border border-red-200 px-3 py-2.5 text-xs font-bold text-red-600">Đăng xuất</button></div></div>
    </div>

    <div className="mt-5 rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3"><SectionTitle title="Khách hàng" subtitle="Lưu khách quen để ghi nợ và tra cứu chính xác." /><button onClick={onCreateCustomer} className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-extrabold text-sooi-green">+ Thêm khách</button></div>
      {database.customers.length ? <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{database.customers.map((customer) => <div key={customer.id} className="rounded-xl border border-stone-100 bg-stone-50 px-3 py-3"><p className="text-sm font-bold">{customer.name}</p><p className="mt-1 text-xs text-stone-500">{customer.phone || "Chưa có số điện thoại"}</p></div>)}</div> : <Empty text="Chưa có khách hàng nào." />}
    </div>

    {/* Stock overview strip */}
    <div className="mt-5 grid grid-cols-3 gap-3">
      <div className="rounded-2xl border border-stone-200 bg-white p-4 text-center">
        <p className="text-2xl font-black text-sooi-green">{okStock.length}</p>
        <p className="mt-1 text-[10px] font-bold text-stone-500">Đủ hàng</p>
      </div>
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-center">
        <p className="text-2xl font-black text-amber-600">{lowStock.length}</p>
        <p className="mt-1 text-[10px] font-bold text-amber-600">Sắp hết</p>
      </div>
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center">
        <p className="text-2xl font-black text-red-600">{outOfStock.length}</p>
        <p className="mt-1 text-[10px] font-bold text-red-500">Hết hàng</p>
      </div>
    </div>

    {/* Product table with stock visualization */}
    <div id="inventory-section" className="mt-4 scroll-mt-24 rounded-2xl border border-stone-200 bg-white">
      <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4">
        <SectionTitle title="Bảng giá & tồn kho" subtitle="Quét nhanh trạng thái từng mặt hàng." />
        <button onClick={onCreate} className="text-xs font-extrabold text-sooi-green">+ Thêm</button>
      </div>
      <div className="divide-y divide-stone-100">
        {database.products.map((product) => {
          const pct = product.lowStock > 0 ? Math.min(100, Math.round((product.stock / (product.lowStock * 3)) * 100)) : 100;
          const isOut = product.stock <= 0;
          const isLow = !isOut && product.stock <= product.lowStock;
          const barColor = isOut ? "bg-red-500" : isLow ? "bg-amber-400" : "bg-emerald-500";
          const badge = isOut
            ? <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-extrabold text-red-600">Hết hàng</span>
            : isLow
              ? <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-extrabold text-amber-700">Sắp hết</span>
              : <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-extrabold text-emerald-700">Đủ hàng</span>;
          return (
            <div key={product.id} className={`px-5 py-4 ${!product.active ? "opacity-50" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="font-extrabold">{product.name}</p>
                    {badge}
                  </div>
                  <p className="mt-0.5 text-[11px] text-stone-500">{product.category} · vốn {formatMoney(product.cost)}</p>
                </div>
                <div className="ml-2 shrink-0 text-right">
                  <strong className="block text-base font-extrabold text-sooi-green">{formatMoney(product.price)}</strong>
                  <div className="mt-1 flex items-center justify-end gap-1.5">
                    <button onClick={() => onQuickAdjustStock(product.id, 10)} className="rounded-lg bg-emerald-50 px-2 py-0.5 text-[10px] font-extrabold text-sooi-green hover:bg-emerald-100 transition" title="Nhập thêm 10">+10</button>
                    <button onClick={() => onEdit(product)} className="text-[10px] font-bold text-blue-500 hover:text-blue-600">Sửa</button>
                    <button onClick={() => onToggle(product.id)} className="text-[10px] font-bold text-stone-400 hover:text-stone-600">{product.active ? "Đang bán" : "Đã dừng"}</button>
                    <button onClick={() => onDeleteProduct(product)} className="inline-flex items-center gap-0.5 text-[10px] font-bold text-red-500 hover:text-red-700 transition" title="Xóa khỏi kho"><Trash2 size={11} />Xóa</button>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100">
                  <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                </div>
                <span className={`shrink-0 text-xs font-extrabold ${isOut ? "text-red-600" : isLow ? "text-amber-600" : "text-stone-600"}`}>
                  {product.stock} {product.unit}
                </span>
              </div>
            </div>
          );
        })}
        {!database.products.length && <div className="py-10 text-center text-sm text-stone-400">Chưa có sản phẩm nào. Bấm “+ Thêm” để bắt đầu.</div>}
      </div>
    </div>

    <button onClick={onReset} className="mt-5 rounded-xl border border-red-200 px-4 py-2.5 text-sm font-bold text-red-600 hover:bg-red-50">Khôi phục dữ liệu mẫu</button>
  </div>;
}

function CartSheet({ cart, total, subtotal, discount, customerId, method, store, paymentReference, customers, onClose, onQuantity, onDiscount, onCustomer, onMethod, onCheckout, onCancelCart }: { cart: CartItem[]; total: number; subtotal: number; discount: number; customerId: string; method: PaymentMethod; store: StoreSettings; paymentReference: string; customers: { id: string; name: string }[]; onClose: () => void; onQuantity: (id: string, change: number) => void; onDiscount: (value: number) => void; onCustomer: (value: string) => void; onMethod: (value: PaymentMethod) => void; onCheckout: () => void; onCancelCart?: () => void }) {
  const qrUrl = method === "transfer" ? buildVietQrUrl(store, total, paymentReference) : null;

  return <Modal title="Đơn hàng" onClose={onClose}>{!cart.length ? <Empty text="Giỏ hàng đang trống." /> : <><div className="space-y-3">{cart.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-xl bg-stone-50 p-3"><div className="min-w-0 flex-1"><p className="font-bold">{item.name}</p><p className="text-xs text-stone-500">{formatMoney(item.price)} / {item.unit}</p></div><div className="flex items-center rounded-lg border border-stone-200 bg-white"><button className="p-2 text-stone-600" onClick={() => onQuantity(item.id, -1)}><Minus size={16} /></button><span className="w-7 text-center text-sm font-bold">{item.quantity}</span><button className="p-2 text-sooi-green" onClick={() => onQuantity(item.id, 1)}><Plus size={16} /></button></div><strong className="w-20 text-right">{formatMoney(item.price * item.quantity)}</strong></div>)}</div><div className="mt-5 grid gap-3"><label className="text-sm font-bold">Khách hàng<select value={customerId} onChange={(event) => onCustomer(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-stone-200 bg-white px-3 font-normal outline-none focus:border-emerald-500"><option value="">Khách lẻ</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><label className="text-sm font-bold">Giảm giá (đồng)<input inputMode="numeric" type="text" value={discount ? formatMoneyInput(discount) : ""} onChange={(event) => onDiscount(parseMoneyInput(event.target.value))} className="mt-1.5 h-11 w-full rounded-xl border border-stone-200 bg-white px-3 font-normal outline-none focus:border-emerald-500" placeholder="0" />{discount > 0 && <span className="mt-1 block text-xs font-semibold text-emerald-700 capitalize">Giảm {formatMoneyToWords(discount)} đồng</span>}</label></div><div className="mt-5 grid grid-cols-3 gap-2">{(["cash", "transfer", "debt"] as PaymentMethod[]).map((item) => <button key={item} onClick={() => onMethod(item)} className={`rounded-xl border px-2 py-3 text-xs font-bold ${method === item ? "border-sooi-green bg-emerald-50 text-sooi-green" : "border-stone-200 bg-white text-stone-600"}`}>{item === "cash" ? "Tiền mặt" : item === "transfer" ? "Chuyển khoản" : "Ghi nợ"}</button>)}</div>{method === "transfer" && <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-white text-sooi-green shadow-sm"><ScanLine size={20} /></span><div><p className="text-sm font-extrabold text-sooi-deep">QR nhận tiền</p><p className="text-xs text-emerald-800">Khách quét mã để chuyển đúng {formatMoney(total)}.</p></div></div>{qrUrl ? <div className="mt-4 flex flex-col items-center"><div className="rounded-2xl bg-white p-3 shadow-sm"><VietQrImage key={qrUrl} src={qrUrl} /></div><div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 text-center text-[11px] text-stone-500"><span>{store.bankName} · STK <span className="font-bold text-stone-700">{store.bankAccount}</span></span>{store.bankAccount && <button type="button" onClick={() => { navigator.clipboard.writeText(store.bankAccount || ""); toast.success("Đã sao chép số tài khoản!"); }} className="inline-flex items-center gap-0.5 rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] font-bold text-sooi-green hover:bg-emerald-50 transition" title="Sao chép số tài khoản"><Copy size={11} />Sao chép STK</button>}</div><p className="text-center text-[11px] text-stone-500">Chủ TK: <span className="font-bold text-stone-700">{store.bankOwner}</span> · Nội dung: <span className="font-bold text-stone-700">{paymentReference}</span></p></div> : <div className="mt-3 rounded-xl bg-white/80 p-3 text-xs leading-5 text-stone-600"><p className="font-bold text-stone-800">Chưa có thông tin tài khoản nhận tiền.</p><p>Vào Quản lý → QR nhận tiền để nhập tài khoản ngân hàng.</p></div>}</div>}<div className="mt-5 rounded-xl bg-sooi-deep p-4 text-white"><div className="flex justify-between text-sm text-emerald-100"><span>Tiền hàng</span><span>{formatMoney(subtotal)}</span></div>{discount > 0 && <div className="mt-2 flex justify-between text-sm text-emerald-100"><span>Giảm giá</span><span>−{formatMoney(discount)}</span></div>}<div className="mt-3 flex justify-between border-t border-white/15 pt-3 text-lg font-extrabold"><span>Khách trả</span><span>{formatMoney(total)}</span></div></div><div className="mt-4 flex gap-2">{onCancelCart && <button type="button" onClick={onCancelCart} className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-rose-200 px-4 text-sm font-extrabold text-rose-600 hover:bg-rose-50 transition"><Trash2 size={16} />Hủy đơn</button>}<button onClick={onCheckout} className="flex h-12 flex-1 items-center justify-center rounded-xl bg-sooi-green text-sm font-extrabold text-white hover:bg-emerald-800 transition">Hoàn tất đơn</button></div></>}</Modal>;
}

function DebtSheet({ type, customerId, customerName, amount, note, database, onType, onCustomerId, onCustomerName, onAmount, onNote, onClose, onSubmit }: { type: "debt" | "payment" | "list"; customerId: string; customerName: string; amount: string; note: string; database: ReturnType<typeof useLedger>["database"]; onType: (value: "debt" | "payment" | "list") => void; onCustomerId: (value: string) => void; onCustomerName: (value: string) => void; onAmount: (value: string) => void; onNote: (value: string) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const [selectedDebtQr, setSelectedDebtQr] = useState<{ customerName: string; amount: number; qrUrl: string } | null>(null);
  const debtByCustomer = new Map<string, number>();
  database.orders.forEach((order) => { const open = Math.max(0, order.total - order.paid); if (open) debtByCustomer.set(order.customerName, (debtByCustomer.get(order.customerName) ?? 0) + open); });
  (database.debtEntries ?? []).forEach((entry) => debtByCustomer.set(entry.customerName, (debtByCustomer.get(entry.customerName) ?? 0) + (entry.type === "debt" ? entry.amount : -entry.amount)));
  const debtors = [...debtByCustomer.entries()].filter(([, amt]) => amt > 0).sort((a, b) => b[1] - a[1]);

  return <Modal title={selectedDebtQr ? `Mã QR trả nợ - ${selectedDebtQr.customerName}` : "Công nợ khách hàng"} onClose={onClose}>
    {selectedDebtQr ? (
      <div className="flex flex-col items-center">
        <div className="rounded-2xl border border-emerald-200 bg-white p-3 shadow-sm">
          <VietQrImage key={selectedDebtQr.qrUrl} src={selectedDebtQr.qrUrl} />
        </div>
        <p className="mt-3 text-lg font-extrabold text-sooi-deep">{formatMoney(selectedDebtQr.amount)}</p>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5 text-center text-xs text-stone-500">
          <span>{database.store.bankName} · STK <span className="font-bold text-stone-700">{database.store.bankAccount}</span></span>
          {database.store.bankAccount && (
            <button
              type="button"
              onClick={() => { navigator.clipboard.writeText(database.store.bankAccount || ""); toast.success("Đã sao chép số tài khoản!"); }}
              className="inline-flex items-center gap-0.5 rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] font-bold text-sooi-green hover:bg-emerald-50 transition"
              title="Sao chép số tài khoản"
            >
              <Copy size={11} />Sao chép STK
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-stone-500">Chủ TK: <span className="font-bold text-stone-700">{database.store.bankOwner}</span> · Nội dung: <span className="font-bold text-stone-700">TRA NO {selectedDebtQr.customerName}</span></p>
        <div className="mt-5 flex w-full gap-2">
          <button
            type="button"
            onClick={() => setSelectedDebtQr(null)}
            className="flex-1 rounded-xl border border-stone-200 py-2.5 text-xs font-bold text-stone-600 hover:bg-stone-50"
          >
            Quay lại
          </button>
          <button
            type="button"
            onClick={() => {
              onType("payment");
              onCustomerName(selectedDebtQr.customerName);
              onAmount(formatMoneyInput(selectedDebtQr.amount));
              onNote(`Khách ${selectedDebtQr.customerName} thanh toán nợ qua QR`);
              setSelectedDebtQr(null);
            }}
            className="flex-1 rounded-xl bg-sooi-green py-2.5 text-xs font-extrabold text-white hover:bg-emerald-800"
          >
            Khách đã trả tiền
          </button>
        </div>
      </div>
    ) : (
      <>
        <div className="mb-6 grid grid-cols-3 gap-2 rounded-xl bg-stone-100 p-1">
          <button onClick={() => onType("debt")} className={`rounded-lg py-2 text-[11px] font-bold ${type === "debt" ? "bg-white text-sooi-deep shadow-sm" : "text-stone-500 hover:text-stone-700"}`}>Ghi khách nợ</button>
          <button onClick={() => onType("payment")} className={`rounded-lg py-2 text-[11px] font-bold ${type === "payment" ? "bg-white text-sooi-deep shadow-sm" : "text-stone-500 hover:text-stone-700"}`}>Khách trả</button>
          <button onClick={() => onType("list")} className={`rounded-lg py-2 text-[11px] font-bold ${type === "list" ? "bg-white text-sooi-deep shadow-sm" : "text-stone-500 hover:text-stone-700"}`}>Xem tổng nợ</button>
        </div>

        {type === "list" ? (
          <div>
            <h3 className="text-sm font-extrabold tracking-tight">Danh sách đang nợ</h3>
            {debtors.length > 0 ? (
              <div className="mt-4 divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
                {debtors.map(([name, amt]) => {
                  const debtQrUrl = buildVietQrUrl(database.store, amt, `TRA NO ${name.replace(/\s+/g, " ")}`);
                  return (
                    <div key={name} className="flex items-center justify-between p-4 font-semibold text-stone-800">
                      <div>
                        <span className="font-bold">{name}</span>
                        <p className="text-xs text-red-600 font-extrabold">{formatMoney(amt)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {debtQrUrl && (
                          <button
                            type="button"
                            onClick={() => setSelectedDebtQr({ customerName: name, amount: amt, qrUrl: debtQrUrl })}
                            className="inline-flex items-center gap-1 rounded-xl bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-sooi-green hover:bg-emerald-100 transition"
                          >
                            <ScanLine size={14} />QR trả nợ
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            onType("payment");
                            onCustomerName(name);
                            onAmount(String(amt));
                            onNote(`Khách ${name} thanh toán nợ`);
                          }}
                          className="rounded-xl bg-stone-100 px-2.5 py-1.5 text-xs font-bold text-stone-700 hover:bg-stone-200 transition"
                        >
                          Thu nợ
                        </button>
                      </div>
                    </div>
                  );
                })}
                <div className="flex justify-between bg-stone-50 p-4 font-black">
                  <span>Tổng cộng</span>
                  <span className="text-red-600">{formatMoney(debtors.reduce((sum, [, amt]) => sum + amt, 0))}</span>
                </div>
              </div>
            ) : (
              <Empty text="Hiện không có khách nào đang nợ." />
            )}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block text-sm font-bold">Khách quen<select value={customerId} onChange={(event) => { onCustomerId(event.target.value); const customer = database.customers.find((item) => item.id === event.target.value); if (customer) onCustomerName(customer.name); }} className="mt-1.5 h-11 w-full rounded-xl border border-stone-200 bg-white px-3 font-normal outline-none focus:border-emerald-500"><option value="">Nhập tên khác</option>{database.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
            {!customerId && <label className="block text-sm font-bold">Tên khách<input value={customerName} onChange={(event) => onCustomerName(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-stone-200 px-3 font-normal outline-none focus:border-emerald-500" placeholder="Ví dụ: Chị Mai" /></label>}
            <label className="block text-sm font-bold">Số tiền<input inputMode="numeric" type="text" value={amount} onChange={(event) => onAmount(formatMoneyInput(event.target.value))} className="mt-1.5 h-11 w-full rounded-xl border border-stone-200 px-3 font-normal outline-none focus:border-emerald-500" placeholder="200,000" />{parseMoneyInput(amount) > 0 && <span className="mt-1 block text-xs font-semibold text-emerald-700 capitalize">{formatMoneyToWords(parseMoneyInput(amount))} đồng</span>}</label>
            <label className="block text-sm font-bold">Ghi chú<input value={note} onChange={(event) => onNote(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-stone-200 px-3 font-normal outline-none focus:border-emerald-500" placeholder="Ví dụ: lấy hàng ngày 28/9" /></label>
            <button className={`flex h-12 w-full items-center justify-center rounded-xl text-sm font-extrabold text-white ${type === "debt" ? "bg-amber-600 hover:bg-amber-700" : "bg-sooi-green hover:bg-emerald-800"}`}>{type === "debt" ? "Lưu công nợ" : "Xác nhận đã trả"}</button>
          </form>
        )}
      </>
    )}
  </Modal>;
}

function ProductSheet({ isEdit, name, price, cost, stock, category, onName, onPrice, onCost, onStock, onCategory, onClose, onSubmit, onDelete }: { isEdit: boolean; name: string; price: string; cost: string; stock: string; category: string; onName: (value: string) => void; onPrice: (value: string) => void; onCost: (value: string) => void; onStock: (value: string) => void; onCategory: (value: string) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onDelete?: () => void }) { return <Modal title={isEdit ? "Sửa sản phẩm" : "Thêm sản phẩm"} onClose={onClose}><form onSubmit={onSubmit} className="space-y-4"><label className="block text-sm font-bold">Tên sản phẩm<input autoFocus value={name} onChange={(event) => onName(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-stone-200 px-3 font-normal outline-none focus:border-emerald-500" placeholder="Ví dụ: Cà phê muối" /></label><label className="block text-sm font-bold">Nhóm hàng<input value={category} onChange={(event) => onCategory(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-stone-200 px-3 font-normal outline-none focus:border-emerald-500" /></label><div className="grid grid-cols-2 gap-3"><label className="block text-sm font-bold">Giá bán<input inputMode="numeric" type="text" value={price} onChange={(event) => onPrice(formatMoneyInput(event.target.value))} className="mt-1.5 h-11 w-full rounded-xl border border-stone-200 px-3 font-normal outline-none focus:border-emerald-500" placeholder="25,000" />{parseMoneyInput(price) > 0 && <span className="mt-1 block text-[11px] font-semibold text-emerald-700 capitalize">{formatMoneyToWords(parseMoneyInput(price))} đ</span>}</label><label className="block text-sm font-bold">Giá vốn<input inputMode="numeric" type="text" value={cost} onChange={(event) => onCost(formatMoneyInput(event.target.value))} className="mt-1.5 h-11 w-full rounded-xl border border-stone-200 px-3 font-normal outline-none focus:border-emerald-500" placeholder="10,000" />{parseMoneyInput(cost) > 0 && <span className="mt-1 block text-[11px] font-semibold text-stone-500 capitalize">{formatMoneyToWords(parseMoneyInput(cost))} đ</span>}</label></div><label className="block text-sm font-bold">Tồn kho ban đầu<input inputMode="numeric" type="number" min="0" value={stock} onChange={(event) => onStock(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-stone-200 px-3 font-normal outline-none focus:border-emerald-500" placeholder="50" /></label><div className="flex gap-2 pt-1">{isEdit && onDelete && <button type="button" onClick={onDelete} className="inline-flex h-12 items-center justify-center gap-1.5 rounded-xl border border-red-200 px-4 text-sm font-extrabold text-red-600 hover:bg-red-50 hover:border-red-300 transition"><Trash2 size={16} />Xóa hàng</button>}<button className={`flex h-12 flex-1 items-center justify-center rounded-xl text-sm font-extrabold text-white transition ${isEdit ? "bg-blue-600 hover:bg-blue-700" : "bg-sooi-green hover:bg-emerald-800"}`}>{isEdit ? "Cập nhật sản phẩm" : "Lưu sản phẩm"}</button></div></form></Modal>; }

function CustomerSheet({ name, phone, onName, onPhone, onClose, onSubmit }: { name: string; phone: string; onName: (value: string) => void; onPhone: (value: string) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <Modal title="Thêm khách hàng" onClose={onClose}><form onSubmit={onSubmit} className="space-y-4"><label className="block text-sm font-bold">Tên khách<input autoFocus value={name} onChange={(event) => onName(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-stone-200 px-3 font-normal outline-none focus:border-emerald-500" placeholder="Ví dụ: Chị Lan" /></label><label className="block text-sm font-bold">Số điện thoại<input inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => onPhone(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-stone-200 px-3 font-normal outline-none focus:border-emerald-500" placeholder="0901234567" /></label><button className="flex h-12 w-full items-center justify-center rounded-xl bg-sooi-green text-sm font-extrabold text-white">Lưu khách hàng</button></form></Modal>; }

function formatOrderDateTime(isoString: string) {
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

function OrderDetailSheet({
  order,
  onClose,
  onCancelOrder,
}: {
  order: Order;
  onClose: () => void;
  onCancelOrder: (orderId: string) => void;
}) {
  const methodLabel = order.method === "cash" ? "Tiền mặt" : order.method === "transfer" ? "Chuyển khoản" : "Ghi nợ";
  const isDebt = order.method === "debt";

  return (
    <Modal title={`Chi tiết đơn ${order.number}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-start justify-between rounded-2xl bg-stone-50 p-4">
          <div>
            <p className="text-xs font-bold text-stone-500">Khách hàng</p>
            <p className="mt-0.5 text-base font-extrabold text-stone-900">{order.customerName}</p>
            <p className="mt-1 text-xs text-stone-500">{formatOrderDateTime(order.createdAt)}</p>
          </div>
          <div className="text-right">
            <span
              className={`inline-block rounded-full px-2.5 py-1 text-xs font-extrabold ${
                isDebt ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
              }`}
            >
              {methodLabel}
            </span>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-bold tracking-wider text-stone-400 uppercase">Danh sách sản phẩm</p>
          <div className="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between p-3.5">
                <div>
                  <p className="font-extrabold text-stone-800">{item.name}</p>
                  <p className="text-xs text-stone-500">
                    {formatMoney(item.price)} × {item.quantity} {item.unit}
                  </p>
                </div>
                <strong className="text-stone-900">{formatMoney(item.price * item.quantity)}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl bg-sooi-deep p-4 text-white">
          <div className="flex justify-between text-sm text-emerald-100">
            <span>Tiền hàng</span>
            <span>{formatMoney(order.subtotal)}</span>
          </div>
          {order.discount > 0 && (
            <div className="mt-2 flex justify-between text-sm text-emerald-100">
              <span>Giảm giá</span>
              <span>−{formatMoney(order.discount)}</span>
            </div>
          )}
          <div className="mt-3 flex justify-between border-t border-white/15 pt-3 text-lg font-extrabold">
            <span>Tổng thanh toán</span>
            <span>{formatMoney(order.total)}</span>
          </div>
          {isDebt && (
            <div className="mt-2 flex justify-between text-xs font-bold text-amber-200">
              <span>Còn nợ</span>
              <span>{formatMoney(Math.max(0, order.total - order.paid))}</span>
            </div>
          )}
        </div>

        <div className="pt-2">
          <button
            type="button"
            onClick={() => onCancelOrder(order.id)}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 text-sm font-extrabold text-rose-600 hover:bg-rose-100 transition"
          >
            <Trash2 size={16} />
            Hủy đơn hàng (hoàn lại kho)
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AllOrdersSheet({
  orders,
  onClose,
  onSelectOrder,
  onCancelOrder,
}: {
  orders: Order[];
  onClose: () => void;
  onSelectOrder: (order: Order) => void;
  onCancelOrder: (orderId: string) => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredOrders = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return orders;
    return orders.filter(
      (o) =>
        o.number.toLowerCase().includes(term) ||
        o.customerName.toLowerCase().includes(term) ||
        o.items.some((item) => item.name.toLowerCase().includes(term))
    );
  }, [orders, searchTerm]);

  return (
    <Modal title={`Tất cả đơn hàng (${orders.length})`} onClose={onClose}>
      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={17} />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Tìm theo mã đơn, tên khách, món..."
            className="h-10 w-full rounded-xl border border-stone-200 bg-white pl-9 pr-3 text-xs outline-none focus:border-emerald-500"
          />
        </div>

        {filteredOrders.length ? (
          <div className="max-h-[60vh] divide-y divide-stone-100 overflow-y-auto rounded-2xl border border-stone-200 bg-white">
            {filteredOrders.map((order) => (
              <div key={order.id} className="group flex items-center justify-between p-3.5 transition hover:bg-stone-50/70">
                <button
                  type="button"
                  onClick={() => onSelectOrder(order)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate font-extrabold text-stone-900 group-hover:text-sooi-green transition">
                    {order.customerName}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-stone-500">
                    {order.number} · {formatOrderDateTime(order.createdAt)} · {order.items.reduce((s, i) => s + i.quantity, 0)} món
                  </p>
                </button>
                <div className="flex items-center gap-2 pl-3">
                  <span className="text-xs font-extrabold text-stone-900">{formatMoney(order.total)}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCancelOrder(order.id);
                    }}
                    className="grid size-8 place-items-center rounded-lg text-stone-400 hover:bg-rose-50 hover:text-rose-600 transition"
                    title="Hủy đơn"
                    aria-label={`Hủy đơn ${order.number}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty text={searchTerm ? "Không tìm thấy đơn phù hợp." : "Chưa có đơn hàng nào."} />
        )}
      </div>
    </Modal>
  );
}

function CashSheet({ cashType, category, amount, note, onClose, onType, onCategory, onAmount, onNote, onSubmit }: { cashType: CashType; category: string; amount: string; note: string; onClose: () => void; onType: (value: CashType) => void; onCategory: (value: string) => void; onAmount: (value: string) => void; onNote: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <Modal title="Ghi thu chi" onClose={onClose}><form onSubmit={onSubmit} className="space-y-4"><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => onType("expense")} className={`rounded-xl border p-3 text-sm font-bold ${cashType === "expense" ? "border-red-300 bg-red-50 text-red-700" : "border-stone-200"}`}>Khoản chi</button><button type="button" onClick={() => onType("income")} className={`rounded-xl border p-3 text-sm font-bold ${cashType === "income" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-stone-200"}`}>Khoản thu</button></div><label className="block text-sm font-bold">Khoản mục<input value={category} onChange={(event) => onCategory(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-stone-200 px-3 font-normal outline-none focus:border-emerald-500" /></label><label className="block text-sm font-bold">Số tiền<input autoFocus inputMode="numeric" type="text" value={amount} onChange={(event) => onAmount(formatMoneyInput(event.target.value))} className="mt-1.5 h-11 w-full rounded-xl border border-stone-200 px-3 font-normal outline-none focus:border-emerald-500" placeholder="Ví dụ: 850,000" />{parseMoneyInput(amount) > 0 && <span className="mt-1 block text-xs font-semibold text-emerald-700 capitalize">{formatMoneyToWords(parseMoneyInput(amount))} đồng</span>}</label><label className="block text-sm font-bold">Ghi chú<input value={note} onChange={(event) => onNote(event.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-stone-200 px-3 font-normal outline-none focus:border-emerald-500" placeholder="Ví dụ: tiền điện tháng này" /></label><button className="flex h-12 w-full items-center justify-center rounded-xl bg-sooi-green text-sm font-extrabold text-white">Lưu giao dịch</button></form></Modal>; }

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="fixed inset-0 z-30 bg-stone-950/45 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={title}><div className="mx-auto mt-auto max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-sooi-card shadow-2xl sm:mt-[8vh]"><div className="sticky top-0 flex items-center justify-between border-b border-stone-100 bg-sooi-card px-5 py-4"><h2 className="text-lg font-extrabold">{title}</h2><button onClick={onClose} className="grid size-9 place-items-center rounded-xl text-stone-500 hover:bg-stone-100" aria-label="Đóng"><X size={19} /></button></div><div className="p-5">{children}</div></div></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div><p className="text-[11px] font-semibold text-emerald-100">{label}</p><p className="mt-1 text-base font-extrabold">{value}</p></div>; }
function Action({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) { return <button onClick={onClick} className="flex min-h-[58px] flex-col items-center justify-center gap-1.5 rounded-xl border border-stone-200 bg-white px-1.5 py-2 text-[9px] font-extrabold shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 sm:min-h-28 sm:gap-2 sm:rounded-2xl sm:p-4 sm:text-sm"><span className="grid size-7 place-items-center rounded-lg bg-emerald-50 text-sooi-green sm:size-10 sm:rounded-xl">{icon}</span>{label}</button>; }
function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) { return <div><h2 className="text-[16px] font-black tracking-tight sm:text-lg">{title}</h2>{subtitle && <p className="mt-0.5 text-[9px] text-stone-500 sm:mt-1 sm:text-sm">{subtitle}</p>}</div>; }
function Empty({ text }: { text: string }) { return <div className="py-8 text-center text-sm text-stone-500">{text}</div>; }
function StatCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "green" | "red" | "blue" }) { const classes = { green: "bg-emerald-50 text-emerald-700", red: "bg-red-50 text-red-600", blue: "bg-blue-50 text-blue-600" }; return <div className="rounded-2xl border border-stone-200 bg-white p-4"><div className={`grid size-10 place-items-center rounded-xl ${classes[tone]}`}>{icon}</div><p className="mt-4 text-xs font-bold text-stone-500">{label}</p><p className="mt-1 text-xl font-extrabold tracking-tight">{value}</p></div>; }
