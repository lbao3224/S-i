import { describe, expect, it } from "vitest";
import { makeVoiceDraft, normalizeVoiceText, spokenAmount, voiceQuantity } from "./parser";
import { seedDatabase } from "../ledger/seed";

describe("Vietnamese voice parser", () => {
  it.each([
    ["hai mươi lăm nghìn", 25_000],
    ["hăm lăm nghìn", 25_000],
    ["850 nghìn tiền điện", 850_000],
    ["25.000đ", 25_000],
    ["1,5 triệu", 1_500_000],
    ["một triệu hai trăm nghìn", 1_200_000],
    ["5 chục", 50_000],
    ["hai chục", 20_000],
    ["1 xị", 100_000],
    ["2 xị", 200_000],
    ["nửa xị", 50_000],
    ["1 chai", 1_000_000],
    ["nửa chai", 500_000],
    ["1 củ", 1_000_000],
    ["trăm rưỡi", 150_000],
    ["triệu rưỡi", 1_500_000],
    ["1 triệu rưỡi", 1_500_000],
    ["1 củ rưỡi", 1_500_000],
    ["1 chai rưỡi", 1_500_000],
    ["chục rưỡi", 15_000],
    ["ba lăm ngàn", 35_000],
    ["bốn lăm k", 45_000],
    ["năm lăm nghìn", 55_000],
    ["bảy lăm ngàn", 75_000],
    ["50k", 50_000],
    ["100k", 100_000],
    ["1 xị rưỡi", 150_000],
  ])("parses amount: %s -> %i", (spoken, expected) => {
    expect(spokenAmount(spoken)).toBe(expected);
  });

  it.each([
    ["hai", 2],
    ["mười hai", 12],
    ["hăm lăm", 25],
    ["3", 3],
    ["một cặp", 2],
    ["cặp", 2],
    ["nửa tá", 6],
    ["nửa chục", 5],
    ["2 ly", 2],
    ["ban 2 ly", 2],
    ["cho 3 o", 3],
    ["5 chai", 5],
    ["6 cái", 6],
    ["10 lon", 10],
    ["hai ly", 2],
    ["2 chục", 20],
  ])("understands quantity: %s -> %i", (spoken, expected) => {
    expect(voiceQuantity(spoken)).toBe(expected);
  });

  it("normalizes common ASR variants", () => {
    expect(normalizeVoiceText("CF sữa và bạc sỉu")).toBe("ca phe sua va bac xiu");
  });

  it("creates a multi-item draft with the right quantities", () => {
    const draft = makeVoiceDraft("bán 2 cà phê sữa và 1 bánh mì", seedDatabase.products);
    expect(draft).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "coffee-milk", quantity: 2 }),
      expect.objectContaining({ id: "banh-mi", quantity: 1 }),
    ]));
    expect(draft).toHaveLength(2);
  });

  it("understands quantities with measure words like ly, o, cai", () => {
    const draft = makeVoiceDraft("bán 2 ly cà phê sữa", seedDatabase.products);
    expect(draft).toEqual([
      expect.objectContaining({ id: "coffee-milk", quantity: 2 }),
    ]);

    const draftBanhMi = makeVoiceDraft("cho 3 ổ bánh mì", seedDatabase.products);
    expect(draftBanhMi).toEqual([
      expect.objectContaining({ id: "banh-mi", quantity: 3 }),
    ]);
  });

  it("handles complex multi-item orders with measure words", () => {
    const draft = makeVoiceDraft("bán 2 ly cà phê đen và 3 cái bánh flan", seedDatabase.products);
    expect(draft).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "coffee-black", quantity: 2 }),
      expect.objectContaining({ id: "flan", quantity: 3 }),
    ]));
    expect(draft).toHaveLength(2);
  });

  it("understands postfix quantities (e.g. cà phê sữa 2 ly)", () => {
    const draft = makeVoiceDraft("cà phê sữa 2 ly", seedDatabase.products);
    expect(draft).toEqual([
      expect.objectContaining({ id: "coffee-milk", quantity: 2 }),
    ]);
  });

  it("understands southern shorthand for bạc xỉu", () => {
    expect(makeVoiceDraft("cho cô ba 3 bạc sỉu", seedDatabase.products)).toEqual([
      expect.objectContaining({ id: "bac-xiu", quantity: 3 }),
    ]);
  });

  it("handles conversational Western prefixes and suffixes", () => {
    const draft = makeVoiceDraft("sổ ơi cho một cặp đen đá nghen", seedDatabase.products);
    expect(draft).toEqual([
      expect.objectContaining({ id: "coffee-black", quantity: 2 }),
    ]);
  });
});
