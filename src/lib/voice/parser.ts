import type { CartItem, Product } from "@/lib/ledger/types";

const PRODUCT_ALIASES: Record<string, string[]> = {
  "coffee-milk": [
    "ca phe sua da", "cafe sua da", "cf sua da", "ca phe sua", "cafe sua", "cf sua",
    "ca phe nau", "nau da", "nau nong", "sua da", "ly sua", "ca phe sua nong"
  ],
  "coffee-black": [
    "ca phe den da", "cafe den da", "cf den da", "ca phe den", "cafe den", "cf den",
    "den da", "den nong", "ly den", "ca phe da"
  ],
  "bac-xiu": [
    "bac xiu da", "bac siu da", "bac xiu", "bac siu", "bac xiu nong", "bac siu nong"
  ],
  "peach-tea": [
    "tra dao cam sa da", "tra dao cam sa", "tra dao da", "tra dao", "ly tra dao"
  ],
  water: [
    "nuoc suoi", "nuoc loc", "chai nuoc suoi", "chai nuoc", "aquafina", "lavie", "dasani"
  ],
  avocado: [
    "sinh to bo", "bo xay", "ly sinh to bo", "ly bo"
  ],
  "banh-mi": [
    "banh mi thit", "banh mi", "o banh mi", "banh my thit", "banh my"
  ],
  flan: [
    "banh flan", "flan", "caramen", "cai flan", "dia flan"
  ],
};

const DIGITS: Record<string, number> = {
  khong: 0, mot: 1, hai: 2, ba: 3, bon: 4, tu: 4, nam: 5, lam: 5,
  sau: 6, bay: 7, tam: 8, chin: 9,
};

export function cleanColloquialText(value: string) {
  let s = value.trim();
  // Bỏ từ mở đầu / xưng hô: "sổ ơi", "bữa nay", "cho tui", "lấy giùm", "tính tiền giùm", "bán cho tui"...
  s = s.replace(
    /^(?:sổ ơi|so oi|bữa nay|bua nay|cho tui|cho tôi|cho mình|cho em xin|cho chị xin|cho anh xin|bán cho tui|bán cho tôi|bán cho em|bán cho chị|bán cho anh|lấy cho tui|lấy cho tôi|lấy cho em|lấy cho chị|lấy cho anh|lấy giùm|lấy dùm|tính tiền giùm|tính tiền dùm|ghi giùm|ghi dùm|hỏi cái coi|hỏi coi|em ơi|chị ơi|anh ơi|bác ơi|cô ơi)[,\s]+/iu,
    ""
  );
  // Bỏ từ cảm thán cuối câu: "nghen", "nhen", "nhe", "nha", "nhé", "coi", "với", "hén", "dạ", "á", "ạ"...
  s = s.replace(
    /\s+(?:nghen|nhen|nhe|nha|nhé|coi|với|hén|dạ|á|ạ|giùm nghen|giùm nhen|giùm nhe|giùm nha|giùm nhé)$/iu,
    ""
  );
  return s.trim();
}

export function normalizeVoiceText(value: string) {
  const cleaned = cleanColloquialText(value);
  let result = cleaned
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLocaleLowerCase("vi-VN")
    .replace(/\bcf\b/g, "ca phe")
    .replace(/\bcafe\b/g, "ca phe")
    .replace(/\bbac siu\b/g, "bac xiu")
    // Cặp (pair = 2)
    .replace(/\b(mot cap|1 cap|cap)\b/g, "hai")
    .replace(/\b(hai cap|2 cap)\b/g, "bon")
    .replace(/\b(ba cap|3 cap)\b/g, "sau")
    // Tá (dozen = 12)
    .replace(/\bnua ta\b/g, "sau")
    .replace(/\b(mot ta|1 ta)\b/g, "muoi hai")
    // Chục (10)
    .replace(/\bnua chuc\b/g, "nam")
    .replace(/\b(mot chuc|1 chuc|chuc)\b/g, "muoi")
    .replace(/\b(hai chuc|2 chuc)\b/g, "hai muoi")
    .replace(/\b(ba chuc|3 chuc)\b/g, "ba muoi")
    .replace(/\b(bon chuc|4 chuc|tu chuc)\b/g, "bon muoi")
    .replace(/\b(nam chuc|5 chuc)\b/g, "nam muoi")
    .replace(/\b(sau chuc|6 chuc)\b/g, "sau muoi")
    .replace(/\b(bay chuc|7 chuc)\b/g, "bay muoi")
    .replace(/\b(tam chuc|8 chuc)\b/g, "tam muoi")
    .replace(/\b(chin chuc|9 chuc)\b/g, "chin muoi")
    // Hăm / băm
    .replace(/\bham\b/g, "hai muoi")
    .replace(/\bbam\b/g, "ba muoi")
    // Lăm / mốt khi đứng sau hàng chục dạng tắt: "ba lăm" -> "ba muoi lam", "bốn lăm" -> "bon muoi lam"
    .replace(/\b(hai|ba|bon|tu|nam|sau|bay|tam|chin)\s+lam\b/g, "$1 muoi lam")
    .replace(/\b(hai|ba|bon|tu|nam|sau|bay|tam|chin)\s+mot\b/g, "$1 muoi mot")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return result;
}

export function phraseSimilarity(left: string, right: string) {
  if (left === right) return 1;
  if (!left || !right) return 0;
  const l = left.replaceAll(" ", "");
  const r = right.replaceAll(" ", "");
  if (l === r) return 1;
  if (!l.length || !r.length) return 0;

  // Single or very short characters should NOT match a long phrase via substring
  if (l.length < 3 || r.length < 3) {
    return l === r ? 1 : 0;
  }

  const pairs = (value: string) =>
    Array.from({ length: Math.max(0, value.length - 1) }, (_, index) => value.slice(index, index + 2));
  const first = pairs(l);
  const second = pairs(r);
  if (!first.length || !second.length) {
    if (r.includes(l) || l.includes(r)) {
      return Math.min(l.length, r.length) / Math.max(l.length, r.length);
    }
    return 0;
  }
  const pool = [...second];
  let matches = 0;
  first.forEach((pair) => {
    const index = pool.indexOf(pair);
    if (index >= 0) {
      matches += 1;
      pool.splice(index, 1);
    }
  });
  return (2 * matches) / (first.length + second.length);
}

export function findSpokenPhrase(spoken: string, aliases: string[]) {
  let exact = { index: -1, score: 0, length: 0 };
  for (const alias of aliases) {
    const index = spoken.indexOf(alias);
    if (index >= 0 && alias.length > exact.length) exact = { index, score: 1, length: alias.length };
  }
  if (exact.index >= 0) return exact;

  const words = spoken.split(" ");
  let best = { index: -1, score: 0, length: 0 };
  for (const alias of aliases) {
    const size = alias.split(" ").length;
    for (let length = Math.max(1, size - 1); length <= size + 1; length += 1) {
      for (let start = 0; start <= words.length - length; start += 1) {
        const phrase = words.slice(start, start + length).join(" ");
        const score = phraseSimilarity(phrase, alias);
        if (score > best.score) {
          best = {
            index: words.slice(0, start).join(" ").length + (start ? 1 : 0),
            score,
            length: phrase.length,
          };
        }
      }
    }
  }
  return best.score >= 0.76 ? best : { index: -1, score: best.score, length: best.length };
}

function parseVietnameseNumber(tokens: string[]) {
  let total = 0;
  let group = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (/^\d+$/.test(token)) {
      group += parseInt(token, 10);
    } else if (token in DIGITS) {
      group += DIGITS[token] ?? 0;
    } else if (token === "muoi") {
      const previous = tokens[index - 1] ?? "";
      const prevVal = /^\d+$/.test(previous) ? parseInt(previous, 10) : DIGITS[previous];
      if (prevVal !== undefined && group >= prevVal) group -= prevVal;
      group += (prevVal ?? 1) * 10;
    } else if (token === "tram") {
      const previous = tokens[index - 1] ?? "";
      const prevVal = /^\d+$/.test(previous) ? parseInt(previous, 10) : DIGITS[previous];
      if (prevVal !== undefined && group >= prevVal) group -= prevVal;
      group += (prevVal ?? 1) * 100;
    } else if (token === "nghin" || token === "ngan") {
      total += Math.max(1, group) * 1_000;
      group = 0;
    } else if (token === "trieu") {
      total += Math.max(1, group) * 1_000_000;
      group = 0;
    } else if (token === "ruoi") {
      group += group >= 100 ? 50 : 5;
    }
  }
  return total + group;
}

const MEASURE_WORDS_REGEX = /\b(?:ly|coc|chai|lon|o|cai|bich|goi|hop|to|dia|phan|suat|chen|bat|binh|tach)\b/i;

export function voiceQuantity(value: string) {
  const normalized = normalizeVoiceText(value);

  // 1. Check for digits at end or with measure word: "2 ly", "2", "3 o", "10 lon", "ban 2 ly"
  // but not when followed by words like muoi, tram (e.g. "2 muoi")
  const digitWithUnit = normalized.match(/\b(\d+)\s*(?:\b(?:ly|coc|chai|lon|o|cai|bich|goi|hop|to|dia|phan|suat|chen|bat|binh|tach)\b)?\s*$/i);
  if (digitWithUnit?.[1] && !/\b(?:muoi|tram|nghin|ngan|trieu|ruoi)\b/i.test(normalized)) {
    return Math.max(1, Math.min(999, Number(digitWithUnit[1])));
  }

  // 2. Parse Vietnamese number tokens (without filler/measure words)
  const tokens = normalized.split(" ").filter(Boolean).slice(-6);
  const cleanTokens = tokens.filter(
    (w) => !MEASURE_WORDS_REGEX.test(w) && w !== "cho" && w !== "ban" && w !== "lay" && w !== "them" && w !== "va" && w !== "voi"
  );
  const parsed = parseVietnameseNumber(cleanTokens);
  if (parsed > 0) return Math.max(1, Math.min(999, parsed));

  // 3. Fallback: standalone digits anywhere in the last tokens
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (/^\d+$/.test(tokens[i])) {
      return Math.max(1, Math.min(999, Number(tokens[i])));
    }
  }

  return 1;
}

function checkPostfixQuantity(afterText: string): number {
  const m = afterText.match(/^\s*(\d+)\s*(?:ly|coc|chai|lon|o|cai|bich|goi|hop|phan|to|dia)?(?:\s|$)/i);
  if (m?.[1]) return Math.max(1, Math.min(999, Number(m[1])));
  const wordM = afterText.match(/^\s*(hai|ba|bon|tu|nam|sau|bay|tam|chin|muoi)\s*(?:ly|coc|chai|lon|o|cai|bich|goi|hop|phan|to|dia)?(?:\s|$)/i);
  if (wordM?.[1]) return DIGITS[wordM[1]] ?? 1;
  return 1;
}

export function spokenAmount(value: string) {
  const norm = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLocaleLowerCase("vi-VN");

  // 1. Tiếng lóng "chai" / "củ" (1 chai = 1.000.000đ)
  if (/\b(?:nua|0[.,]5)\s*(?:chai|cu)\b/i.test(norm)) return 500_000;
  if (/\b(?:1|mot)\s*(?:chai|cu)\s+ruoi\b/i.test(norm) || /\b(?:chai|cu)\s+ruoi\b/i.test(norm)) return 1_500_000;
  const chaiRuoiMatch = norm.match(/(\d+)\s*(?:chai|cu)\s+ruoi\b/i);
  if (chaiRuoiMatch) return parseInt(chaiRuoiMatch[1], 10) * 1_000_000 + 500_000;

  const chaiMatch = norm.match(/(\d+(?:[.,]\d+)?)\s*(?:chai|cu)\b/i);
  if (chaiMatch) {
    const val = parseFloat(chaiMatch[1].replace(",", "."));
    return Math.round(val * 1_000_000);
  }
  if (/\b(?:mot|1)\s*(?:chai|cu)\b/i.test(norm)) return 1_000_000;
  if (/\b(?:hai|2)\s*(?:chai|cu)\b/i.test(norm)) return 2_000_000;

  // 2. Tiếng lóng "xị" (1 xị = 100.000đ)
  if (/\bnua\s*xi\b/i.test(norm)) return 50_000;
  if (/\b(?:1|mot)\s*xi\s+ruoi\b/i.test(norm) || /\bxi\s+ruoi\b/i.test(norm)) return 150_000;
  const xiRuoiMatch = norm.match(/(\d+)\s*xi\s+ruoi\b/i);
  if (xiRuoiMatch) return parseInt(xiRuoiMatch[1], 10) * 100_000 + 50_000;

  const xiMatch = norm.match(/(\d+)\s*xi\b/i);
  if (xiMatch) return parseInt(xiMatch[1], 10) * 100_000;
  if (/\b(?:mot|1)\s*xi\b/i.test(norm)) return 100_000;
  if (/\b(?:hai|2)\s*xi\b/i.test(norm)) return 200_000;
  if (/\b(?:ba|3)\s*xi\b/i.test(norm)) return 300_000;
  if (/\b(?:nam|5)\s*xi\b/i.test(norm)) return 500_000;

  // 3. "triệu rưỡi" (1.500.000đ)
  if (/\b(?:1|mot)?\s*trieu\s+ruoi\b/i.test(norm)) return 1_500_000;
  const trieuRuoiMatch = norm.match(/(\d+)\s*trieu\s+ruoi\b/i);
  if (trieuRuoiMatch) return parseInt(trieuRuoiMatch[1], 10) * 1_000_000 + 500_000;

  // 4. "trăm rưỡi" (150.000đ)
  if (/\b(?:1|mot)?\s*tram\s+ruoi\b/i.test(norm)) return 150_000;
  const tramRuoiMatch = norm.match(/(\d+)\s*tram\s+ruoi\b/i);
  if (tramRuoiMatch) return parseInt(tramRuoiMatch[1], 10) * 100_000 + 50_000;

  // 5. "chục rưỡi" (15.000đ)
  if (/\b(?:1|mot)?\s*chuc\s+ruoi\b/i.test(norm)) return 15_000;

  // 6. Tiếng lóng "chục" tiền mặt (5 chục = 50.000đ, 2 chục = 20.000đ)
  const chucDigitMatch = norm.match(/(\d+)\s*chuc(?:\s*(?:ngan|nghin|k))?\b/i);
  if (chucDigitMatch) return parseInt(chucDigitMatch[1], 10) * 10_000;
  const chucWordMatch = norm.match(/\b(mot|hai|ba|bon|tu|nam|sau|bay|tam|chin)\s+chuc(?:\s*(?:ngan|nghin|k))?\b/i);
  if (chucWordMatch) {
    const wordMap: Record<string, number> = { mot: 1, hai: 2, ba: 3, bon: 4, tu: 4, nam: 5, sau: 6, bay: 7, tam: 8, chin: 9 };
    return (wordMap[chucWordMatch[1]] ?? 1) * 10_000;
  }

  // 7. Số chữ liền "k" (vd: 50k, 25k, 100k, 850k)
  const kMatch = norm.match(/\b(\d+(?:[.,]\d+)?)\s*k\b/i);
  if (kMatch) {
    const base = parseFloat(kMatch[1].replace(",", "."));
    return Math.round(base * 1_000);
  }

  const raw = value.toLocaleLowerCase("vi-VN");
  const numeric = raw.match(/\b(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(triệu|trieu|tr|nghìn|nghin|ngàn|ngan|k)?\b/i);
  if (numeric) {
    const written = numeric[1] ?? "0";
    const unit = normalizeVoiceText(numeric[2] ?? "");
    const grouped = /\d{1,3}(?:[.,]\d{3})+/.test(written) && !unit;
    const base = grouped ? Number(written.replace(/[.,]/g, "")) : Number(written.replace(",", "."));
    if (unit === "trieu" || unit === "tr") return Math.round(base * 1_000_000);
    if (unit === "nghin" || unit === "ngan" || unit === "k") return Math.round(base * 1_000);
    return Number.isFinite(base) ? Math.round(base) : 0;
  }

  const normalized = normalizeVoiceText(value);
  const tokens = normalized.split(" ");
  const parsed = parseVietnameseNumber(tokens);
  if (!parsed) return 0;
  const hasLargeUnit = tokens.some((token) => token === "nghin" || token === "ngan" || token === "trieu");
  return hasLargeUnit || parsed >= 1_000 ? parsed : parsed >= 10 ? parsed * 1_000 : parsed;
}

export function getProductAliases(product: Product): string[] {
  const normName = normalizeVoiceText(product.name);
  const aliases = new Set<string>();

  // 1. Static dictionary lookup
  (PRODUCT_ALIASES[product.id] ?? []).forEach((a) => aliases.add(normalizeVoiceText(a)));

  // 2. Full normalized name
  aliases.add(normName);

  // 3. Remove parenthesis like "(ly)", "(chai)", "(lon)", "(size l)"
  const cleanParens = normalizeVoiceText(product.name.replace(/\(.*?\)/g, ""));
  if (cleanParens && cleanParens !== normName) aliases.add(cleanParens);

  // 4. If name has "da" or "nong", also match base name
  if (normName.endsWith(" da") || normName.endsWith(" nong")) {
    aliases.add(normName.slice(0, -3).trim());
  }

  // 5. Common shorthand for "ca phe"
  if (normName.startsWith("ca phe ")) {
    aliases.add(normName.replace(/^ca phe /, "cf "));
    aliases.add(normName.replace(/^ca phe /, "cafe "));
  }

  return [...aliases].filter((a) => a.length >= 2);
}

export function makeVoiceDraft(transcript: string, products: Product[]): CartItem[] {
  const spoken = normalizeVoiceText(transcript);
  const candidates = products
    .filter((product) => product.active)
    .flatMap((product) => {
      const aliases = getProductAliases(product);
      const match = findSpokenPhrase(spoken, aliases);
      return match.index < 0 ? [] : [{ product, match }];
    })
    .sort(
      (left, right) =>
        left.match.index - right.match.index ||
        right.match.score - left.match.score ||
        right.match.length - left.match.length
    );

  const selected = candidates.filter((candidate, index) =>
    !candidates.slice(0, index).some((previous) => {
      const sameStart = previous.match.index === candidate.match.index;
      const overlaps =
        candidate.match.index < previous.match.index + previous.match.length &&
        previous.match.index < candidate.match.index + candidate.match.length;
      return sameStart || (overlaps && previous.match.score >= candidate.match.score);
    })
  );

  const result = new Map<string, CartItem>();
  let previousEndIndex = 0;

  selected.forEach(({ product, match }) => {
    // Only look between previous product and current product
    const sliceStart = Math.max(previousEndIndex, match.index - 25);
    const quantityText = spoken.slice(sliceStart, match.index);
    let quantity = voiceQuantity(quantityText);

    // If prefix quantity was 1, check if quantity was spoken after product: "cà phê sữa 2 ly"
    if (quantity === 1) {
      const afterSlice = spoken.slice(match.index + match.length, match.index + match.length + 15);
      const postQty = checkPostfixQuantity(afterSlice);
      if (postQty > 1) quantity = postQty;
    }

    previousEndIndex = match.index + match.length;
    const existing = result.get(product.id);
    result.set(product.id, {
      id: product.id,
      name: product.name,
      unit: product.unit,
      price: product.price,
      cost: product.cost,
      quantity: (existing?.quantity ?? 0) + quantity,
    });
  });

  return [...result.values()];
}
