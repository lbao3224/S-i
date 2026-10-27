export type BankCategory = "popular" | "digital" | "commercial" | "foreign";

export type BankInfo = {
  bin: string;
  shortName: string;
  name: string;
  code: string;
  category: BankCategory;
};

export const BANK_CATEGORY_LABELS: Record<BankCategory, string> = {
  popular: "⭐ Ngân hàng phổ biến",
  digital: "📱 Ngân hàng số & Ví điện tử",
  commercial: "🏛️ Ngân hàng thương mại khác",
  foreign: "🌐 Ngân hàng nước ngoài & Liên doanh",
};

export const VIETNAM_BANKS: BankInfo[] = [
  // ⭐ Ngân hàng phổ biến nhất
  { bin: "970436", shortName: "Vietcombank", name: "Ngoại thương Việt Nam", code: "VCB", category: "popular" },
  { bin: "970422", shortName: "MBBank", name: "Quân đội", code: "MB", category: "popular" },
  { bin: "970407", shortName: "Techcombank", name: "Kỹ thương Việt Nam", code: "TCB", category: "popular" },
  { bin: "970415", shortName: "VietinBank", name: "Công thương Việt Nam", code: "CTG", category: "popular" },
  { bin: "970418", shortName: "BIDV", name: "Đầu tư và Phát triển Việt Nam", code: "BIDV", category: "popular" },
  { bin: "970405", shortName: "Agribank", name: "Nông nghiệp & PTNT Việt Nam", code: "VBA", category: "popular" },
  { bin: "970416", shortName: "ACB", name: "Á Châu", code: "ACB", category: "popular" },
  { bin: "970432", shortName: "VPBank", name: "Việt Nam Thịnh Vượng", code: "VPB", category: "popular" },
  { bin: "970423", shortName: "TPBank", name: "Tiên Phong", code: "TPB", category: "popular" },
  { bin: "970403", shortName: "Sacombank", name: "Sài Gòn Thương Tín", code: "STB", category: "popular" },
  { bin: "970441", shortName: "VIB", name: "Quốc tế Việt Nam", code: "VIB", category: "popular" },
  { bin: "970437", shortName: "HDBank", name: "Phát triển TP.HCM", code: "HDB", category: "popular" },
  { bin: "970443", shortName: "SHB", name: "Sài Gòn - Hà Nội", code: "SHB", category: "popular" },
  { bin: "970449", shortName: "LPBank", name: "Lộc Phát Việt Nam", code: "LPB", category: "popular" },
  { bin: "970426", shortName: "MSB", name: "Hàng Hải Việt Nam", code: "MSB", category: "popular" },
  { bin: "970440", shortName: "SeABank", name: "Đông Nam Á", code: "SEAB", category: "popular" },
  { bin: "970448", shortName: "OCB", name: "Phương Đông", code: "OCB", category: "popular" },
  { bin: "970431", shortName: "Eximbank", name: "Xuất Nhập khẩu Việt Nam", code: "EIB", category: "popular" },

  // 📱 Ngân hàng số & Ví điện tử
  { bin: "963388", shortName: "Timo", name: "Ngân hàng số Timo", code: "TIMO", category: "digital" },
  { bin: "546034", shortName: "Cake by VPBank", name: "Ngân hàng số Cake", code: "CAKE", category: "digital" },
  { bin: "971005", shortName: "Viettel Money", name: "Viettel Money", code: "VTLMONEY", category: "digital" },
  { bin: "971025", shortName: "MoMo", name: "Ví MoMo", code: "MOMO", category: "digital" },
  { bin: "971011", shortName: "VNPT Money", name: "VNPT Money", code: "VNPTMONEY", category: "digital" },
  { bin: "963326", shortName: "TNEX", name: "Ngân hàng số TNEX", code: "TNEX", category: "digital" },
  { bin: "546035", shortName: "Ubank by VPBank", name: "Ngân hàng số Ubank", code: "UBANK", category: "digital" },
  { bin: "970406", shortName: "Vikki", name: "Ngân hàng số Vikki", code: "VIKKI", category: "digital" },

  // 🏛️ Nhóm ngân hàng TMCP khác
  { bin: "970409", shortName: "BacABank", name: "Bắc Á", code: "BAB", category: "commercial" },
  { bin: "970438", shortName: "BaoVietBank", name: "Bảo Việt", code: "BVB", category: "commercial" },
  { bin: "970428", shortName: "NamABank", name: "Nam Á", code: "NAB", category: "commercial" },
  { bin: "970427", shortName: "VietABank", name: "Việt Á", code: "VAB", category: "commercial" },
  { bin: "970425", shortName: "ABBANK", name: "An Bình", code: "ABB", category: "commercial" },
  { bin: "970412", shortName: "PVcomBank", name: "Đại Chúng Việt Nam", code: "PVCB", category: "commercial" },
  { bin: "970452", shortName: "Kienlongbank", name: "Kiên Long", code: "KLB", category: "commercial" },
  { bin: "970400", shortName: "SaigonBank", name: "Sài Gòn Công Thương", code: "SGICB", category: "commercial" },
  { bin: "970430", shortName: "PGBank", name: "Thịnh vượng và Phát triển", code: "PGB", category: "commercial" },
  { bin: "970433", shortName: "VietBank", name: "Việt Nam Thương Tín", code: "VIETBANK", category: "commercial" },
  { bin: "970454", shortName: "BVBank", name: "Bản Việt", code: "VCCB", category: "commercial" },
  { bin: "970419", shortName: "NCB", name: "Quốc Dân", code: "NCB", category: "commercial" },
  { bin: "970429", shortName: "SCB", name: "Sài Gòn", code: "SCB", category: "commercial" },
  { bin: "970446", shortName: "Co-op Bank", name: "Hợp tác xã Việt Nam", code: "COOPBANK", category: "commercial" },

  // 🌐 Nhóm ngân hàng nước ngoài & liên doanh tại Việt Nam
  { bin: "970424", shortName: "Shinhan Bank", name: "Shinhan Việt Nam", code: "SHBVN", category: "foreign" },
  { bin: "970457", shortName: "Woori Bank", name: "Woori Việt Nam", code: "WVN", category: "foreign" },
  { bin: "970434", shortName: "IndovinaBank", name: "Indovina (IVB)", code: "IVB", category: "foreign" },
  { bin: "970421", shortName: "VRB", name: "Việt - Nga", code: "VRB", category: "foreign" },
  { bin: "970439", shortName: "Public Bank", name: "Public Bank Việt Nam", code: "PBVN", category: "foreign" },
  { bin: "970410", shortName: "Standard Chartered", name: "Standard Chartered VN", code: "SCVN", category: "foreign" },
  { bin: "970442", shortName: "Hong Leong Bank", name: "Hong Leong Việt Nam", code: "HLBVN", category: "foreign" },
  { bin: "458761", shortName: "HSBC", name: "HSBC Việt Nam", code: "HSBC", category: "foreign" },
  { bin: "422589", shortName: "CIMB", name: "CIMB Việt Nam", code: "CIMB", category: "foreign" },
  { bin: "668888", shortName: "KBank", name: "Kasikornbank", code: "KBANK", category: "foreign" },
  { bin: "970458", shortName: "UOB", name: "United Overseas Bank VN", code: "UOB", category: "foreign" },
];

export function findBankByBin(bin?: string): BankInfo | undefined {
  if (!bin) return undefined;
  const clean = bin.trim();
  return VIETNAM_BANKS.find((b) => b.bin === clean);
}
