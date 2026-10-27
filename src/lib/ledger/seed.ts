import type { LedgerDatabase } from "@/lib/ledger/types";

export const seedDatabase: LedgerDatabase = {
  store: { name: "Cà Phê Sáng Sổ Ơi", allowNegativeStock: false, bankName: "", bankBin: "", bankAccount: "", bankOwner: "", voiceAnnouncement: true },
  products: [
    { id: "coffee-black", name: "Cà phê đen", category: "Đồ uống", unit: "ly", price: 18000, cost: 7000, stock: 120, lowStock: 20, active: true },
    { id: "coffee-milk", name: "Cà phê sữa", category: "Đồ uống", unit: "ly", price: 25000, cost: 10000, stock: 150, lowStock: 25, active: true },
    { id: "bac-xiu", name: "Bạc xỉu", category: "Đồ uống", unit: "ly", price: 28000, cost: 12000, stock: 80, lowStock: 15, active: true },
    { id: "peach-tea", name: "Trà đào cam sả", category: "Đồ uống", unit: "ly", price: 35000, cost: 14000, stock: 60, lowStock: 10, active: true },
    { id: "water", name: "Nước suối", category: "Đồ uống", unit: "chai", price: 10000, cost: 5000, stock: 40, lowStock: 24, active: true },
    { id: "avocado", name: "Sinh tố bơ", category: "Đồ uống", unit: "ly", price: 40000, cost: 18000, stock: 25, lowStock: 10, active: true },
    { id: "banh-mi", name: "Bánh mì thịt", category: "Đồ ăn", unit: "ổ", price: 20000, cost: 12000, stock: 35, lowStock: 10, active: true },
    { id: "flan", name: "Bánh flan", category: "Đồ ăn", unit: "cái", price: 15000, cost: 7000, stock: 6, lowStock: 10, active: true },
  ],
  customers: [
    { id: "lan", name: "Chị Lan", phone: "0912345678" },
    { id: "tuan", name: "Anh Tuấn", phone: "0987654321" },
    { id: "bay", name: "Cô Bảy", phone: "0903334444" },
  ],
  orders: [],
  cashEntries: [],
  debtEntries: [],
};
