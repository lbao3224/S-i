import type { CartItem, DashboardSummary, LedgerDatabase, Order, PaymentMethod, Product } from "@/lib/ledger/types";

export const formatMoney = (amount: number) =>
  `${Math.round(amount).toLocaleString("vi-VN")}đ`;

export const formatMoneyShort = (amount: number) => {
  if (Math.abs(amount) >= 1_000_000) return `${(amount / 1_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}tr`;
  if (Math.abs(amount) >= 1_000) return `${(amount / 1_000).toLocaleString("vi-VN", { maximumFractionDigits: 0 })}k`;
  return formatMoney(amount);
};

export function formatMoneyInput(value: string | number): string {
  if (value === "" || value === null || value === undefined) return "";
  const str = String(value);
  const digits = str.replace(/\D/g, "");
  if (!digits) return "";
  const num = parseInt(digits, 10);
  if (isNaN(num)) return "";
  return num.toLocaleString("en-US");
}

export function parseMoneyInput(value: string | number): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return 0;
  const num = parseInt(digits, 10);
  return isNaN(num) ? 0 : num;
}

export function formatMoneyToWords(num: number): string {
  if (!num || !Number.isFinite(num) || num <= 0) return "không";
  const digits = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];

  function readGroup(n: number) {
    const h = Math.floor(n / 100);
    const t = Math.floor((n % 100) / 10);
    const u = n % 10;
    let res = "";
    if (h > 0) res += digits[h] + " trăm ";
    if (t > 1) {
      res += digits[t] + " mươi ";
      if (u === 1) res += "mốt";
      else if (u === 5) res += "lăm";
      else if (u > 0) res += digits[u];
    } else if (t === 1) {
      res += "mười ";
      if (u === 5) res += "lăm";
      else if (u > 0) res += digits[u];
    } else if (t === 0 && u > 0) {
      if (h > 0) res += "lẻ " + digits[u];
      else res += digits[u];
    }
    return res.trim();
  }

  const bil = Math.floor(num / 1_000_000_000);
  const mil = Math.floor((num % 1_000_000_000) / 1_000_000);
  const tho = Math.floor((num % 1_000_000) / 1_000);
  const rem = Math.floor(num % 1_000);

  let result = "";
  if (bil > 0) result += readGroup(bil) + " tỷ ";
  if (mil > 0) result += readGroup(mil) + " triệu ";
  if (tho > 0) result += readGroup(tho) + " nghìn ";
  if (rem > 0 && result) {
    const h = Math.floor(rem / 100);
    const t = Math.floor((rem % 100) / 10);
    if (h === 0 && t === 0) result += "lẻ " + readGroup(rem);
    else result += readGroup(rem);
  } else if (rem > 0) {
    result += readGroup(rem);
  }
  return result.trim();
}


const businessDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const businessDate = (value: Date | string = new Date()) => businessDateFormatter.format(typeof value === "string" ? new Date(value) : value);
export const today = () => businessDate();

export function cartSubtotal(items: CartItem[]) {
  return items.reduce((total, item) => total + item.price * item.quantity, 0);
}

export function calculateSummary(database: LedgerDatabase): DashboardSummary {
  const todaysOrders = database.orders.filter((order) => businessDate(order.createdAt) === today());
  const todaysCash = database.cashEntries.filter((entry) => entry.date === today());
  const revenue = todaysOrders.reduce((total, order) => total + order.total, 0);
  const collected = todaysOrders.reduce((total, order) => total + order.paid, 0);
  const cogs = todaysOrders.reduce(
    (total, order) => total + order.items.reduce((sum, item) => sum + item.cost * item.quantity, 0),
    0,
  );
  const expense = todaysCash.filter((entry) => entry.type === "expense").reduce((total, entry) => total + entry.amount, 0);
  const orderDebt = database.orders.reduce((total, order) => total + Math.max(0, order.total - order.paid), 0);
  const manualDebt = (database.debtEntries ?? []).reduce((total, entry) => total + (entry.type === "debt" ? entry.amount : -entry.amount), 0);
  const openDebt = Math.max(0, orderDebt + manualDebt);

  return { revenue, collected, expense, profit: revenue - cogs - expense, openDebt, orders: todaysOrders.length };
}

export function validateStock(database: LedgerDatabase, items: CartItem[]) {
  if (database.store.allowNegativeStock) return [];
  return items.flatMap((item) => {
    const product = database.products.find((candidate) => candidate.id === item.id);
    if (!product || product.stock >= item.quantity) return [];
    return [`${product.name} chỉ còn ${product.stock} ${product.unit}`];
  });
}

export function completeOrder(
  database: LedgerDatabase,
  input: { items: CartItem[]; discount: number; customerId?: string; customerName: string; method: PaymentMethod },
): LedgerDatabase {
  const subtotal = cartSubtotal(input.items);
  const total = Math.max(0, subtotal - input.discount);
  const paid = input.method === "debt" ? 0 : total;
  const order: Order = {
    id: crypto.randomUUID(),
    number: `DH${today().slice(2).replaceAll("-", "")}${String(database.orders.length + 1).padStart(3, "0")}`,
    createdAt: new Date().toISOString(),
    customerId: input.customerId,
    customerName: input.customerName || "Khách lẻ",
    items: input.items,
    subtotal,
    discount: input.discount,
    total,
    paid,
    method: input.method,
  };

  const soldQuantities = new Map(input.items.map((item) => [item.id, item.quantity]));
  return {
    ...database,
    products: database.products.map((product) => ({
      ...product,
      stock: product.stock - (soldQuantities.get(product.id) ?? 0),
    })),
    orders: [order, ...database.orders],
  };
}

export function addToCart(items: CartItem[], product: Product): CartItem[] {
  const existing = items.find((item) => item.id === product.id);
  if (!existing) return [...items, { id: product.id, name: product.name, unit: product.unit, price: product.price, cost: product.cost, quantity: 1 }];
  return items.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
}

export function deleteProduct(database: LedgerDatabase, productId: string): LedgerDatabase {
  return {
    ...database,
    products: database.products.filter((product) => product.id !== productId),
  };
}

export function cancelOrder(database: LedgerDatabase, orderId: string): LedgerDatabase {
  const order = database.orders.find((o) => o.id === orderId);
  if (!order) return database;

  const restoredQuantities = new Map(order.items.map((item) => [item.id, item.quantity]));

  return {
    ...database,
    products: database.products.map((product) => {
      const restoreQty = restoredQuantities.get(product.id) ?? 0;
      if (!restoreQty) return product;
      return {
        ...product,
        stock: product.stock + restoreQty,
      };
    }),
    orders: database.orders.filter((o) => o.id !== orderId),
  };
}

export * from "@/lib/ledger/banks";

