export type PaymentMethod = "cash" | "transfer" | "debt";
export type CashType = "income" | "expense";

export type Product = {
  id: string;
  name: string;
  category: string;
  unit: string;
  price: number;
  cost: number;
  stock: number;
  lowStock: number;
  active: boolean;
};

export type Customer = {
  id: string;
  name: string;
  phone?: string;
};

export type CartItem = Pick<Product, "id" | "name" | "unit" | "price" | "cost"> & {
  quantity: number;
};

export type Order = {
  id: string;
  number: string;
  createdAt: string;
  customerId?: string;
  customerName: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  method: PaymentMethod;
};

export type CashEntry = {
  id: string;
  date: string;
  type: CashType;
  category: string;
  note: string;
  amount: number;
};

export type DebtEntry = {
  id: string;
  date: string;
  customerId?: string;
  customerName: string;
  type: "debt" | "payment";
  amount: number;
  note: string;
};

export type StoreSettings = {
  name: string;
  allowNegativeStock: boolean;
  bankName?: string;
  bankBin?: string;
  bankAccount?: string;
  bankOwner?: string;
  voiceAnnouncement?: boolean;
  phowhisperModel?: string;
  hfToken?: string;
  phowhisperEndpoint?: string;
};

export type LedgerDatabase = {
  store: StoreSettings;
  products: Product[];
  customers: Customer[];
  orders: Order[];
  cashEntries: CashEntry[];
  debtEntries: DebtEntry[];
};

export type DashboardSummary = {
  revenue: number;
  collected: number;
  expense: number;
  profit: number;
  openDebt: number;
  orders: number;
};
