import { describe, expect, it } from "vitest";
import { businessDate, cancelOrder, cartSubtotal, completeOrder, deleteProduct, findBankByBin, formatMoneyInput, formatMoneyToWords, parseMoneyInput, validateStock } from "./index";
import { seedDatabase } from "./seed";

describe("ledger rules", () => {
  it("uses Vietnam business day instead of UTC day", () => {
    expect(businessDate("2026-10-02T18:30:00.000Z")).toBe("2026-10-03");
  });

  it("calculates cart subtotal", () => {
    expect(cartSubtotal([{ id: "x", name: "Món", unit: "cái", price: 25_000, cost: 10_000, quantity: 3 }])).toBe(75_000);
  });

  it("blocks overselling when negative stock is disabled", () => {
    const product = seedDatabase.products[0]!;
    expect(validateStock(seedDatabase, [{ id: product.id, name: product.name, unit: product.unit, price: product.price, cost: product.cost, quantity: product.stock + 1 }])).toHaveLength(1);
  });

  it("deletes a product from database", () => {
    const product = seedDatabase.products[0]!;
    const nextDb = deleteProduct(seedDatabase, product.id);
    expect(nextDb.products.some((p) => p.id === product.id)).toBe(false);
    expect(nextDb.products.length).toBe(seedDatabase.products.length - 1);
  });

  it("converts money amounts to spoken Vietnamese words", () => {
    expect(formatMoneyToWords(50_000)).toBe("năm mươi nghìn");
    expect(formatMoneyToWords(25_000)).toBe("hai mươi lăm nghìn");
    expect(formatMoneyToWords(100_000)).toBe("một trăm nghìn");
  });

  it("formats money inputs with thousand commas", () => {
    expect(formatMoneyInput("100000")).toBe("100,000");
    expect(formatMoneyInput("1000000")).toBe("1,000,000");
    expect(formatMoneyInput("100.000")).toBe("100,000");
    expect(formatMoneyInput("1,000,000")).toBe("1,000,000");
    expect(formatMoneyInput("")).toBe("");
  });

  it("parses money inputs with commas or dots back to number", () => {
    expect(parseMoneyInput("100,000")).toBe(100_000);
    expect(parseMoneyInput("1,000,000")).toBe(1_000_000);
    expect(parseMoneyInput("100.000")).toBe(100_000);
    expect(parseMoneyInput("")).toBe(0);
  });

  it("finds bank by BIN code correctly", () => {
    const vcb = findBankByBin("970436");
    expect(vcb?.shortName).toBe("Vietcombank");
    const mb = findBankByBin("970422");
    expect(mb?.shortName).toBe("MBBank");
    expect(findBankByBin("invalid")).toBeUndefined();
  });

  it("cancels an order and restores product stock", () => {
    const product = seedDatabase.products[0]!;
    const initialStock = product.stock;
    const dbWithOrder = completeOrder(seedDatabase, {
      items: [{ id: product.id, name: product.name, unit: product.unit, price: product.price, cost: product.cost, quantity: 2 }],
      discount: 0,
      customerName: "Anh Nam",
      method: "cash",
    });
    expect(dbWithOrder.products.find((p) => p.id === product.id)?.stock).toBe(initialStock - 2);
    expect(dbWithOrder.orders).toHaveLength(seedDatabase.orders.length + 1);

    const createdOrder = dbWithOrder.orders[0]!;
    const cancelledDb = cancelOrder(dbWithOrder, createdOrder.id);
    expect(cancelledDb.products.find((p) => p.id === product.id)?.stock).toBe(initialStock);
    expect(cancelledDb.orders).toHaveLength(seedDatabase.orders.length);

    // Non-existent order id should return database as-is
    const untouchedDb = cancelOrder(cancelledDb, "non-existent-order-id");
    expect(untouchedDb).toEqual(cancelledDb);
  });
});

