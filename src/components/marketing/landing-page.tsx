"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  FileBarChart,
  Layers3,
  Menu,
  Mic,
  Package,
  ShieldCheck,
  Sparkles,
  UsersRound,
  X,
} from "lucide-react";
import { AudioVoiceRecorder, getBrowserRecognition, requestMicrophoneAccess, safariSpeechEndedWithoutResultMessage, transcribeAudioWithApi, voiceErrorMessage, voiceSupportMessage, type BrowserRecognition } from "@/lib/voice/browser-speech";
import { makeVoiceDraft, spokenAmount } from "@/lib/voice/parser";
import { seedDatabase } from "@/lib/ledger/seed";

const features = [
  { icon: Mic, title: "Ghi chép bán hàng nhanh chóng", description: "Thêm đơn bán hàng chỉ với thao tác dễ nhớ." },
  { icon: CircleDollarSign, title: "Theo dõi doanh thu & lợi nhuận", description: "Tự động tính toán, biết lãi mỗi ngày." },
  { icon: ClipboardList, title: "Quản lý đơn hàng", description: "Xem lại lịch sử, tình trạng đơn hàng." },
  { icon: UsersRound, title: "Lưu thông tin khách hàng", description: "Ghi chú sở thích, chăm sóc khách tốt hơn." },
  { icon: Package, title: "Quản lý hàng hóa", description: "Theo dõi tồn kho, biết mặt hàng bán chạy." },
  { icon: FileBarChart, title: "Báo cáo trực quan", description: "Hiểu tình hình kinh doanh chỉ trong một cái nhìn." },
];

const faqs = [
  ["Tôi không rành công nghệ, dùng được không?", "Nếu dùng được điện thoại thì dùng được Sổ Ơi. Việc chính là bấm nút micro rồi nói như đang nói với người bên cạnh. Sổ Ơi hiện đơn ra cho xem lại — đúng thì bấm xong, sai thì sửa số lượng bằng nút cộng trừ."],
  ["Nói giọng miền Trung, miền Nam có hiểu không?", "Sổ Ơi dùng khả năng nhận giọng nói của trình duyệt, nên độ chính xác còn phụ thuộc thiết bị, môi trường ồn và cách nói nhanh giống câu trình duyệt. Loại hiểu câu của Sổ Ơi xử lý được nhiều cách nói tắt như “cf sữa”, “nâu”, “bạc sỉu”."],
  ["Tay dính dầu, dính nước thì bấm sao?", "Nút micro nằm giữa màn hình, to bằng đầu ngón cái, bấm một phát là nghe. Sau khi người bán xác nhận thanh toán, Sổ Ơi đọc số tiền thành tiếng — không cần nhìn màn hình vẫn biết đơn đã được ghi nhận."],
  ["Mạng chập chờn, hết dung lượng thì sao?", "Sổ Ơi ghi dữ liệu trên thiết bị trước. Khi mất mạng vẫn có thể tiếp tục bán; khi kết nối trở lại, dữ liệu được cập nhật sang các thiết bị dùng cùng tài khoản. Riêng nhận giọng nói có thể vẫn cần mạng tùy trình duyệt."],
  ["Điện thoại cũ, máy yếu có chạy nổi không?", "Giao diện được thiết kế nhẹ, nút lớn và ưu tiên trình duyệt di động. Phần hiểu các câu bán hàng đơn giản chạy ngay trên thiết bị."],
  ["Đổi điện thoại thì mất dữ liệu không?", "Sổ Ơi ưu tiên lưu dữ liệu trên thiết bị và có tài khoản để backup, khôi phục và cập nhật nhiều thiết bị."],
  ["Dữ liệu buôn bán của tôi có bị đem đi đâu không?", "Sổ Ơi được thiết kế theo nguyên tắc local-first và tối thiểu dữ liệu gửi ra ngoài. Người dùng có thể xuất dữ liệu hoặc yêu cầu xoá tài khoản và dữ liệu liên quan."],
];

const sampleCommands = ["hai cà phê sữa hăm lăm nghìn", "bốn bánh chuối chiên mười nghìn", "2 cf sữa với 1 bánh mì", "cho chị Lan ba bạc sỉu ghi nợ", "một đen đá mười tám nghìn chuyển khoản", "hôm nay trả 850 nghìn tiền điện"];

function demoResult(raw: string) {
  const text = raw.trim().toLocaleLowerCase("vi-VN");
  if (!text) return null;
  const amount = spokenAmount(text);
  if (text.includes("dien") || text.includes("điện") || text.includes("nuoc") || text.includes("nước") || text.includes("ghi chi") || text.includes("chi")) {
    return {
      kind: "Khoản chi",
      title: text.includes("dien") || text.includes("điện") ? "Tiền điện" : text.includes("nuoc") || text.includes("nước") ? "Tiền nước" : "Chi phí khác",
      total: `${(amount || 850000).toLocaleString("vi-VN")}đ`,
      unitPrice: "",
      note: "Sổ hiểu đây là một khoản chi hợp lệ.",
    };
  }

  const items = makeVoiceDraft(raw, seedDatabase.products);
  if (items.length > 0) {
    const item = items[0];
    const total = items.reduce((sum, it) => sum + it.price * it.quantity, 0);
    const title = items.length === 1
      ? `${item.quantity} × ${item.name}`
      : items.map((it) => `${it.quantity} ${it.name}`).join(", ");
    return {
      kind: "Đơn bán",
      title,
      total: `${total.toLocaleString("vi-VN")}đ`,
      unitPrice: items.length === 1 ? `${item.price.toLocaleString("vi-VN")}đ` : "",
      note: "Sổ đã nhận ra món và số lượng chính xác.",
    };
  }

  return {
    kind: "Đơn bán",
    title: raw,
    total: "",
    unitPrice: "",
    note: "Sổ đã nghe thấy câu bán hàng. Bạn có thể kiểm tra trước khi lưu.",
  };
}

export function LandingPage() {
  const [openMobileMenu, setOpenMobileMenu] = useState(false);
  const [command, setCommand] = useState("2 cà phê sữa");
  const [isListening, setIsListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Nhấn micro để nói câu bán hàng bằng tiếng Việt.");
  const recognitionRef = useRef<BrowserRecognition | null>(null);
  const recorderRef = useRef<AudioVoiceRecorder | null>(null);
  const recognitionErrorRef = useRef("");
  const recognitionResultRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const result = useMemo(() => demoResult(command), [command]);

  useEffect(() => () => {
    recognitionRef.current?.stop();
    recorderRef.current?.cancel();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
  }, []);

  const stopListening = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
    if (recorderRef.current) {
      setIsListening(false);
      setVoiceStatus("Đang dừng ghi âm…");
      recorderRef.current.cancel();
      recorderRef.current = null;
      return;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (_) {}
    }
  };

  const listenForOrder = async () => {
    if (isListening) {
      stopListening();
      return;
    }

    // 1. Kiểm tra quyền micro
    const micError = await requestMicrophoneAccess();
    if (micError) {
      setVoiceStatus(micError);
      return;
    }

    const Recognition = getBrowserRecognition();

    if (!Recognition) {
      setVoiceStatus(
        "Trình duyệt này chưa hỗ trợ nhận giọng nói trực tiếp. Hãy mở trên Chrome, Edge hoặc Safari để nói thử."
      );
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
      recognitionErrorRef.current = "";
      recognitionResultRef.current = false;
      setIsListening(true);
      setVoiceStatus("Đang nghe… hãy nói câu bán hàng (ví dụ: '2 cà phê sữa').");

      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        stopListening();
      }, 12000);
    };

    recognition.onresult = (event) => {
      let fullTranscript = "";
      for (let i = 0; i < event.results.length; i++) {
        fullTranscript += (event.results[i][0]?.transcript || "") + " ";
      }
      fullTranscript = fullTranscript.trim();

      if (fullTranscript) {
        recognitionResultRef.current = true;
        setCommand(fullTranscript);
        setVoiceStatus(`Đã nghe: “${fullTranscript}”`);

        if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = setTimeout(() => {
          stopListening();
        }, 1800);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      recognitionErrorRef.current = event.error;
      setVoiceStatus(voiceErrorMessage(event.error));
    };

    recognition.onend = () => {
      setIsListening(false);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);

      if (!recognitionErrorRef.current && !recognitionResultRef.current) {
        if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
          setVoiceStatus(safariSpeechEndedWithoutResultMessage);
        } else {
          setVoiceStatus("Chưa nghe thấy giọng nói. Hãy bấm lại micro và nói to, rõ hơn nhé.");
        }
      }
    };

    try {
      recognition.start();
    } catch {
      setIsListening(false);
      setVoiceStatus("Micro đang được sử dụng hoặc gặp lỗi. Hãy thử lại sau ít giây.");
    }
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#fffdf8] text-sooi-ink">
      <header className="sticky top-0 z-30 border-b border-stone-100/80 bg-[#fffdf8]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[76px] max-w-[1200px] items-center justify-between px-5 lg:px-0">
          <Link href="/" className="flex items-center gap-2" aria-label="Sổ Ơi - Trang chủ"><Image src="/images/logo.webp" alt="Sổ Ơi" width={1024} height={384} priority className="h-8 w-auto object-contain" /></Link>
          <nav className="hidden items-center gap-7 text-[13px] font-bold text-stone-600 md:flex"><a href="#san-pham" className="hover:text-sooi-green">Sản phẩm</a><a href="#tinh-nang" className="hover:text-sooi-green">Tính năng</a><a href="#bang-gia" className="hover:text-sooi-green">Bảng giá</a><a href="#huong-dan" className="hover:text-sooi-green">Hướng dẫn</a><a href="#hoi-dap" className="hover:text-sooi-green">Câu hỏi thường gặp</a></nav>
          <div className="hidden items-center gap-5 md:flex"><Link href="/v2/index.html" className="text-sm font-bold text-sooi-deep hover:text-sooi-green">Đăng nhập</Link><Link href="/app" className="rounded-full bg-sooi-green px-5 py-3 text-sm font-extrabold text-white shadow-lg shadow-emerald-900/15 transition hover:-translate-y-0.5 hover:bg-emerald-800">Mở sổ Ơi <ArrowRight className="ml-1 inline" size={15} /></Link></div>
          <button onClick={() => setOpenMobileMenu((open) => !open)} className="grid size-10 place-items-center rounded-xl border border-stone-200 bg-white md:hidden" aria-label="Mở menu">{openMobileMenu ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
        {openMobileMenu && <nav className="border-t border-stone-200 bg-white p-5 md:hidden"><div className="mx-auto grid max-w-7xl gap-2"><a href="#san-pham" onClick={() => setOpenMobileMenu(false)} className="rounded-xl px-3 py-3 font-bold">Sản phẩm</a><a href="#tinh-nang" onClick={() => setOpenMobileMenu(false)} className="rounded-xl px-3 py-3 font-bold">Tính năng</a><a href="#bang-gia" onClick={() => setOpenMobileMenu(false)} className="rounded-xl px-3 py-3 font-bold">Bảng giá</a><a href="#hoi-dap" onClick={() => setOpenMobileMenu(false)} className="rounded-xl px-3 py-3 font-bold">Câu hỏi thường gặp</a><Link href="/app" className="mt-2 rounded-xl bg-sooi-green px-4 py-3 text-center font-extrabold text-white">Mở Sổ Ơi</Link></div></nav>}
      </header>

      <section id="san-pham" className="relative isolate overflow-hidden bg-[#fffdf8]">
        <div aria-hidden className="absolute -left-24 top-20 size-64 rounded-full border-[18px] border-emerald-100/70" />
        <div aria-hidden className="absolute left-[38%] top-[-120px] size-72 rounded-full border-[6px] border-emerald-100/60" />
        <div aria-hidden className="absolute right-[8%] top-[18%] size-[330px] rounded-full bg-emerald-100/50 blur-3xl" />
        <div aria-hidden className="absolute -bottom-36 left-[-3%] h-64 w-[360px] rotate-[-16deg] rounded-[48%] bg-[#f8d875] opacity-90" />
        <div className="relative mx-auto grid min-h-[590px] max-w-[1200px] items-center gap-8 px-5 py-16 lg:grid-cols-[45%_55%] lg:px-0 lg:py-6">
          <div className="relative z-10 max-w-xl"><span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-4 py-2 text-xs font-extrabold text-sooi-green shadow-sm"><Sparkles size={14} />Bán hàng nhẹ tênh cùng Sổ Ơi</span><h1 className="mt-6 text-[50px] font-black leading-[1.05] tracking-[-0.06em] text-sooi-deep sm:text-[66px]">Bán hàng<br />nhẹ tênh.<br /><span className="text-sooi-green">Sổ Ơi</span> lo!</h1><p className="mt-5 max-w-[430px] text-[16px] leading-7 text-stone-600">Ghi đơn bằng giọng nói, nắm doanh thu và biết việc cần làm tiếp theo — gọn gàng như một cuốn sổ, thông minh hơn mỗi ngày.</p><div className="mt-7 flex flex-wrap gap-3"><Link href="/app" className="inline-flex h-13 items-center gap-2 rounded-full bg-sooi-green px-6 text-sm font-extrabold text-white shadow-xl shadow-emerald-900/20 transition hover:-translate-y-0.5 hover:bg-emerald-800">Mở Sổ Ơi <ArrowRight size={17} /></Link><a href="#thu-ngay" className="inline-flex h-13 items-center gap-2 rounded-full border border-emerald-200 bg-white px-6 text-sm font-extrabold text-sooi-deep transition hover:border-emerald-400 hover:text-sooi-green">Thử nói ngay <Mic size={16} /></a></div><div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[13px] font-semibold text-stone-500"><span><b className="text-sooi-green">✓</b> Không cần học</span><span><b className="text-sooi-green">✓</b> Dùng miễn phí</span></div></div>
          <HeroAppPreview />
        </div>
      </section>

      <section className="relative z-10 -mt-1 bg-transparent px-5"><div className="mx-auto grid max-w-[1200px] grid-cols-1 rounded-xl bg-white px-2 py-5 text-center shadow-[0_3px_14px_rgba(18,59,42,.05)] sm:grid-cols-5"> <Trust icon={<Sparkles />} label="Được đánh giá 4.9/5" /><Trust icon={<ShieldCheck />} label="An toàn, bảo mật dữ liệu" /><Trust icon={<UsersRound />} label="Hỗ trợ tận tình" /><Trust icon={<Layers3 />} label="Sử dụng web và điện thoại" /></div></section>

      <section id="thu-ngay" className="bg-[linear-gradient(120deg,#fffefa,#f5fbf7)]"><div className="mx-auto grid max-w-[1200px] items-center gap-14 px-5 py-[72px] lg:grid-cols-[42%_1fr] lg:px-0"><div><Eyebrow text="Thử ngay tại đây" /><h2 className="mt-4 text-[38px] font-black leading-[1.15] tracking-[-1.4px]">Gõ một câu.<br />Xem Sổ ơi hiểu tới đâu.</h2><p className="mt-4 max-w-md text-[15px] leading-7 text-stone-500">Đây là bộ nhận diện thật của Sổ ơi, đang chạy ngay trong trình duyệt. Không gửi đi đâu cả.</p><p className="mt-7 max-w-md text-[15px] leading-7 text-stone-500">Cứ nói tắt như lúc bán thật: <b className="text-sooi-deep">“cf sữa”, “nâu”, “bạc sỉu”, “hăm lăm nghìn”.</b> Nói sai chính tả cũng được. Nói cả câu dài cũng được.</p></div><div className="rounded-[18px] border border-stone-200 bg-white p-[22px] shadow-[0_13px_32px_rgba(10,80,53,.08)]"><div className="flex items-center gap-2"><span className={`size-2 rounded-full ${isListening ? "animate-pulse bg-rose-500" : "bg-emerald-500"}`} /><p className="font-extrabold">{isListening ? "Sổ ơi đang nghe…" : "Sổ ơi đang nghe"}</p></div><p className="mt-1 text-sm text-stone-500">Gõ hoặc bấm micro rồi nói một câu bán hàng.</p><div className="mt-4 flex gap-2"><input value={command} onChange={(event) => setCommand(event.target.value)} className="h-13 min-w-0 flex-1 rounded-xl border border-stone-200 bg-[#f3f6f5] px-4 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-100" aria-label="Câu bán hàng để thử" /><button type="button" onClick={listenForOrder} className={`grid size-13 shrink-0 place-items-center rounded-xl border-2 text-sooi-deep transition ${isListening ? "border-rose-300 bg-rose-100" : "border-stone-300 bg-emerald-50 hover:border-emerald-500"}`} aria-label={isListening ? "Dừng ghi giọng nói" : "Bắt đầu ghi giọng nói"} title={isListening ? "Dừng ghi" : "Nói câu bán hàng"}><Mic /></button><button type="button" className="grid size-13 shrink-0 place-items-center rounded-xl bg-sooi-green text-white hover:bg-emerald-800" aria-label="Phân tích câu bán hàng"><ArrowRight /></button></div><p className="mt-2 text-xs font-semibold text-stone-500" aria-live="polite">{voiceStatus}</p><div className="mt-3 flex flex-wrap gap-2">{sampleCommands.map((sample) => <button key={sample} onClick={() => setCommand(sample)} className="max-w-62 truncate rounded-full border border-stone-200 bg-[#f6f8f7] px-3 py-2 text-xs font-medium text-stone-500 hover:bg-emerald-50 hover:text-sooi-green">{sample}</button>)}</div>{result && <div className="mt-5 border-t border-stone-200 pt-4"><div className="flex items-start justify-between"><div><p className="font-extrabold">{result.title.replace(/^\d+ × /, "")}</p><p className="mt-1 text-sm text-stone-500">{result.title.match(/^\d+/)?.[0] ?? 1} ly × {result.total.replace(/\D/g, "").replace(/000$/, ".000")}đ</p></div><strong className="text-lg">{result.total}</strong></div><div className="mt-4 flex justify-between border-y border-stone-200 py-4 text-lg font-black"><span>Khách trả</span><span className="text-sooi-green">{result.total}</span></div><p className="mt-3 rounded-xl bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-800">✓ Sổ ơi chắc chắn — đơn này lên thẳng, không cần hỏi AI, không tốn đồng nào.</p></div>}</div></div></section>

      <section id="tinh-nang" className="bg-[#fffdf8]"><div className="mx-auto max-w-[1200px] px-5 py-[72px] lg:px-0"><div className="mx-auto max-w-2xl text-center"><Eyebrow text="Tính năng nổi bật" /><h2 className="mt-4 text-[36px] font-black leading-[1.15] tracking-[-1.4px]">Sinh ra cho việc bán hàng,<br />không dành cho chỗ.</h2><p className="mt-4 text-[15px] text-stone-500">Đầy đủ những gì một chủ shop nhỏ cần, gọn gàng trong một ứng dụng.</p></div><div className="mt-8 grid gap-[18px] md:grid-cols-3">{features.map(({ icon: Icon, title, description }) => <article key={title} className="min-h-[170px] rounded-[14px] border border-stone-200 bg-white p-5 shadow-[0_5px_14px_rgba(24,75,55,.06)] transition hover:-translate-y-1 hover:shadow-lg"><span className="grid size-12 place-items-center rounded-full bg-emerald-100 text-sooi-green"><Icon size={21} /></span><h3 className="mt-4 text-[15px] font-extrabold">{title}</h3><p className="mt-2 text-[13px] leading-6 text-stone-500">{description}</p></article>)}</div></div></section>

      <section id="huong-dan" className="bg-[#005541] text-white"><div className="mx-auto max-w-[1200px] px-5 py-14 lg:px-0"><div className="text-center"><h2 className="text-[32px] font-black tracking-[-1.4px]">Bắt đầu chỉ với 4 bước đơn giản</h2><p className="mt-2 text-[15px] text-emerald-100">Mất chưa đầy 2 phút chủ shop sẵn sàng quản lý việc bán hàng của bạn.</p></div><ol className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">{[["Tải ứng dụng", "Trên điện thoại hoặc dùng ngay trên web.", "/images/download.webp"], ["Tạo tài khoản", "Chỉ cần số điện thoại, không phức tạp.", "/images/account.webp"], ["Nhập sản phẩm đầu tiên", "Thêm hàng hóa, giá vốn, giá bán.", "/images/box.webp"], ["Bắt đầu bán hàng", "Ghi đơn, theo dõi doanh thu và lợi nhuận.", "/images/rocket.webp"]].map(([title, description, image]) => <li key={title} className="text-center"><Image src={image} alt="" width={512} height={512} className="mx-auto size-20 object-contain" /><h3 className="mt-3 font-extrabold">{title}</h3><p className="mx-auto mt-2 max-w-60 text-[13px] leading-6 text-emerald-100">{description}</p></li>)}</ol></div></section>

      <section className="mx-auto max-w-[1200px] px-5 py-[72px] lg:px-0"><div className="text-center"><Eyebrow text="Khác biệt nổi bật" /><h2 className="mt-4 text-[36px] font-black leading-[1.15] tracking-[-1.4px]">Khác biệt rõ ràng, hiệu quả thật sự.</h2><p className="mt-3 text-[15px] text-stone-500">Được thiết kế riêng cho tiểu thương Việt Nam, đơn giản hơn – hiệu quả hơn.</p></div><div className="mt-7 grid gap-5 lg:grid-cols-[1.15fr_.85fr]"><div className="overflow-hidden rounded-lg border border-stone-200 bg-white"><table className="w-full text-left text-[13px]"><thead className="bg-stone-50 font-extrabold"><tr><th className="px-4 py-3">Tính năng</th><th className="px-4 py-3 text-sooi-green">Sổ Ơi</th><th className="px-4 py-3">Cách làm truyền thống</th></tr></thead><tbody className="divide-y divide-stone-200">{["Ghi chép nhanh, dễ dùng", "Tự động tính doanh thu, lợi nhuận", "Quản lý khách hàng", "Theo dõi tồn kho", "Báo cáo trực quan", "Dùng điện thoại, máy tính"].map((item) => <tr key={item}><td className="px-4 py-2.5">{item}</td><td className="px-4 py-2.5 font-black text-sooi-green">•</td><td className="px-4 py-2.5 text-stone-300">×</td></tr>)}</tbody></table></div><blockquote className="rounded-lg bg-[#def3ea] p-6 text-[13px] text-sooi-deep"><p className="text-3xl font-black text-sooi-green">“</p><p className="mt-2 leading-6">Trước đây tôi ghi sổ tay, hay nhầm lẫn và không biết lời lỗ. Từ khi dùng Sổ Ơi, mọi thứ rõ ràng hơn, nhàn hơn nhiều.</p><div className="mt-5 flex items-center gap-3"><Image src="/images/avatar.webp" alt="Chị Hương" width={512} height={512} className="size-9 rounded-full object-cover" /><div><p className="font-extrabold">Chị Hương</p><p className="text-[11px] text-emerald-800">Chủ shop mỹ phẩm, Hà Nội</p></div></div></blockquote></div></section>

      <section id="bang-gia" className="bg-[#fffdf8]"><div className="mx-auto max-w-[1200px] px-5 py-[72px] lg:px-0"><div className="text-center"><Eyebrow text="Bảng giá" /><h2 className="mt-4 text-[36px] font-black leading-[1.15] tracking-[-1.4px]">Chọn gói phù hợp cho hành trình của bạn.</h2><p className="mt-3 text-[15px] text-stone-500">Bắt đầu miễn phí. Nâng cấp bất cứ lúc nào.</p></div><div className="mx-auto mt-5 grid max-w-[1000px] gap-3 lg:grid-cols-3"><Plan title="Sổ nhỏ" price="19.000đ" detail="Dành cho chủ shop mới bắt đầu" items={["Bán hàng, thu chi, công nợ và kho cơ bản", "Dữ liệu ưu tiên lưu trên thiết bị", "Xuất bản sao dữ liệu bất cứ lúc nào", "Mức dùng AI cloud dự kiến phù hợp nhu cầu cơ bản"]} /><Plan popular title="Sổ đủ" price="25.000đ" detail="Dành cho chủ thường hiệu thường xuyên bán hàng" items={["Tất cả tính năng của Sổ nhỏ", "Backup, khôi phục và cập nhật nhiều thiết bị", "Sổ sáng, Sổ tối và báo cáo đầy đủ hơn", "Mức dùng AI cloud dự kiến cao hơn gói miễn phí"]} /><Plan title="Sổ chủ động" price="39.000đ" detail="Dành cho cửa hàng có quy mô lớn hơn" items={["Tất cả tính năng của Sổ đủ", "Agent Actions và nhắc việc chủ động nâng cao", "Báo cáo sâu hơn và nhiều thiết bị hơn", "Mức dùng AI cloud dự kiến cho nhu cầu cao hơn"]} /></div></div></section>

      <section id="hoi-dap" className="bg-white"><div className="mx-auto grid max-w-[1200px] gap-10 px-5 py-14 lg:grid-cols-[42%_58%] lg:items-center lg:px-0"><div><Eyebrow text="Câu hỏi thường gặp" /><h2 className="mt-4 text-[28px] font-black leading-[1.15] tracking-[-1px]">Còn thắc mắc?<br />Sổ Ơi trả lời.</h2><p className="mt-4 max-w-sm leading-7 text-stone-600">Điều quan trọng nhất là bạn có thể dùng ngay trong một nhịp bán hàng bình thường.</p><div className="relative mt-8 hidden h-56 overflow-hidden rounded-2xl bg-white lg:block"><Image src="/images/faq-woman.webp" alt="Minh họa hỗ trợ khách hàng Sổ Ơi" width={512} height={512} className="absolute bottom-0 left-5 h-60 w-auto object-contain" /></div></div><div className="divide-y divide-stone-200 overflow-hidden rounded-lg bg-white">{faqs.map(([question, answer], index) => <details key={question} open={index === 0} className="group px-[18px] py-[14px]"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-extrabold"><span>{question}</span><ChevronRight className="shrink-0 text-sooi-green transition group-open:rotate-90" size={19} /></summary><p className="mt-3 max-w-xl text-[13px] leading-6 text-stone-600">{answer}</p></details>)}</div></div></section>

      <section className="px-5 py-6 lg:px-0"><div className="mx-auto min-h-[145px] max-w-[1200px] overflow-hidden rounded-lg bg-[linear-gradient(110deg,#005441,#08765d)] px-7 py-7 text-white sm:px-10 lg:flex lg:items-end lg:justify-between"><div className="max-w-2xl"><Eyebrow dark text="Sẵn sàng bắt đầu?" /><h2 className="mt-2 text-[30px] font-black tracking-[-1px]">Sổ đã có mà.<br />Dùng thử ngay!</h2><p className="mt-2 leading-7 text-emerald-100">Bắt đầu bán hàng gọn hơn ngay hôm nay, không cần cài đặt phức tạp.</p><Link href="/app" className="mt-5 inline-flex h-12 items-center gap-2 rounded-xl bg-white px-5 text-sm font-extrabold text-sooi-deep hover:bg-emerald-50">Mở Sổ Ơi <ArrowRight size={17} /></Link></div><div className="relative mt-8 h-44 w-full lg:mt-0 lg:h-40 lg:w-64"><Image src="/images/phone.webp" alt="Giao diện Sổ Ơi trên điện thoại" width={768} height={1152} className="absolute bottom-[-82px] left-1/2 h-[300px] w-auto -translate-x-1/2 object-contain drop-shadow-2xl lg:h-[300px]" /></div></div></section>

      <footer className="border-t border-stone-200 bg-white"><div className="mx-auto max-w-[1200px] px-5 py-10 lg:px-0"><div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-[2.2fr_repeat(2,1fr)]"><div><Image src="/images/logo.webp" alt="Sổ Ơi" width={1024} height={384} className="h-8 w-auto object-contain" /><p className="mt-2 text-[13px] leading-7 text-stone-500">Đồng hành cùng hàng triệu tiểu thương Việt.</p></div><div><h4 className="mb-2 text-sm font-extrabold">Hỗ trợ</h4><a href="#hoi-dap" className="block text-[13px] leading-8 text-stone-500">Trung tâm trợ giúp</a><a href="mailto:hello@sooi.vn" className="block text-[13px] leading-8 text-stone-500">Liên hệ</a><a href="#huong-dan" className="block text-[13px] leading-8 text-stone-500">Hướng dẫn sử dụng</a></div><div><h4 className="mb-2 text-sm font-extrabold">Về chúng tôi</h4><a href="#" className="block text-[13px] leading-8 text-stone-500">Điều khoản</a><a href="#" className="block text-[13px] leading-8 text-stone-500">Chính sách bảo mật</a></div></div><div className="mt-6 flex flex-col gap-2 border-t border-stone-200 pt-4 text-[13px] text-stone-400 sm:flex-row sm:justify-between"><span>© 2026 Sổ Ơi. All rights reserved.</span><span>Bán hàng dễ hơn. Cuộc sống nhẹ hơn.</span></div></div></footer>
    </main>
  );
}

function HeroAppPreview() {
  const highlights = [
    "Theo dõi doanh thu",
    "Quản lý đơn hàng",
    "Lưu thông tin khách",
    "Báo cáo mỗi ngày",
  ];

  return (
    <div className="relative mx-auto min-h-[510px] w-full max-w-2xl sm:min-h-[650px]">
      <div aria-hidden className="absolute left-[15%] top-[8%] size-[390px] rounded-full bg-[radial-gradient(circle_at_50%_50%,rgba(210,244,228,.9),rgba(236,250,244,.35)_56%,transparent_72%)] blur-xl sm:size-[520px]" />
      <div aria-hidden className="absolute right-[2%] top-[19%] size-14 rounded-full border-4 border-emerald-200/80 bg-white/70 shadow-[0_0_18px_rgba(73,205,168,.35)]" />
      <div aria-hidden className="absolute right-[10%] top-[40%] size-9 rounded-full border-4 border-emerald-200/80 bg-white/70" />
      <div aria-hidden className="absolute bottom-[6%] left-[9%] h-32 w-36 rotate-[-18deg] rounded-[48%] border-[7px] border-[#f8d875]" />

      <div className="absolute left-1 top-[26%] z-20 hidden rounded-2xl border border-white bg-white/90 p-4 shadow-[0_14px_40px_rgba(23,92,66,.12)] lg:block">
        <p className="text-[10px] font-extrabold tracking-[.08em] text-stone-500">DOANH THU HÔM NAY</p>
        <p className="mt-2 text-[28px] font-black leading-none text-sooi-green">↗ +12%</p>
        <p className="mt-2 text-xs text-stone-500">so với hôm qua</p>
      </div>

      <div className="absolute left-1/2 top-[1%] z-10 w-[68%] -translate-x-1/2 rotate-[5deg] sm:w-[57%] lg:w-[60%]">
        <div aria-hidden className="absolute inset-x-[4%] bottom-[-2%] h-[13%] rounded-full bg-emerald-950/20 blur-2xl" />
        <Image src="/images/phone.webp" alt="Giao diện quản lý bán hàng Sổ Ơi" width={768} height={1152} priority className="relative h-auto w-full drop-shadow-[0_32px_26px_rgba(18,53,44,.28)]" />
      </div>

      <div className="absolute right-[-2%] top-[25%] z-20 hidden space-y-3 lg:block">
        {highlights.map((label, index) => (
          <div key={label} className={`flex items-center gap-3 rounded-full border border-white bg-white/90 px-3 py-2 text-xs font-extrabold text-sooi-deep shadow-[0_10px_24px_rgba(23,92,66,.1)] ${index % 2 ? "translate-x-5" : ""}`}>
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-xs text-sooi-green">✓</span>
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
function Eyebrow({ text, dark = false }: { text: string; dark?: boolean }) { return <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-extrabold ${dark ? "bg-white/10 text-emerald-100" : "bg-emerald-50 text-sooi-green"}`}>{text}</span>; }
function Trust({ icon, label }: { icon: React.ReactNode; label: string }) { return <div className="flex items-center justify-center gap-2 border-stone-200 px-2 text-xs font-medium text-stone-600 sm:border-r sm:text-[13px] [&:last-child]:border-0"><span className="text-lg text-sooi-green">{icon}</span>{label}</div>; }
function Plan({ title, price, detail, items, popular = false }: { title: string; price: string; detail: string; items: string[]; popular?: boolean }) { return <article className={`relative min-h-[328px] rounded-xl border p-6 ${popular ? "border-2 border-sooi-green bg-white" : "border-stone-200 bg-white"}`}>{popular && <span className="absolute -top-3 left-6 rounded-full bg-sooi-green px-3 py-1 text-[11px] font-extrabold text-white">Phổ biến nhất</span>}<h3 className="text-lg font-extrabold">{title}</h3><p className="mt-2 text-[30px] font-black text-sooi-green">{price}<small className="ml-1 text-sm font-semibold text-sooi-green">/ tháng</small></p><p className="mt-1 text-[13px] leading-6 text-stone-500">{detail}</p><ul className="mt-5 space-y-2 text-[13px] text-stone-500">{items.map((item) => <li key={item} className="flex gap-2"><Check className="mt-0.5 shrink-0 text-sooi-green" size={15} />{item}</li>)}</ul><Link href="/app" className={`mt-6 flex h-11 items-center justify-center rounded-xl text-sm font-extrabold ${popular ? "bg-sooi-green text-white" : "text-sooi-green"}`}>{popular ? "Đăng kí trải nghiệm" : title === "Sổ chủ động" ? "Liên hệ tư vấn" : "Bắt đầu ngay"}</Link></article>; }
