"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/client";

type AuthMode = "login" | "register" | "forgot" | "reset";

const emailSchema = z.string().trim().email("Email chưa đúng định dạng.");
const passwordSchema = z.string().min(8, "Mật khẩu cần ít nhất 8 ký tự.").regex(/[A-Za-z]/, "Mật khẩu cần có chữ.").regex(/\d/, "Mật khẩu cần có số.");

const content: Record<AuthMode, { eyebrow: string; title: string; subtitle: string; submit: string }> = {
  login: { eyebrow: "Chào mừng trở lại", title: "Đăng nhập vào Sổ Ơi", subtitle: "Mở đúng cuốn sổ của bạn trên mọi thiết bị.", submit: "Đăng nhập" },
  register: { eyebrow: "Bắt đầu miễn phí", title: "Tạo tài khoản Sổ Ơi", subtitle: "Chỉ mất một phút để mở cuốn sổ bán hàng đầu tiên.", submit: "Tạo tài khoản" },
  forgot: { eyebrow: "Khôi phục tài khoản", title: "Quên mật khẩu?", subtitle: "Nhập email, Sổ Ơi sẽ gửi liên kết đặt lại mật khẩu.", submit: "Gửi liên kết" },
  reset: { eyebrow: "Bảo mật tài khoản", title: "Đặt mật khẩu mới", subtitle: "Dùng ít nhất 8 ký tự, gồm cả chữ và số.", submit: "Lưu mật khẩu mới" },
};

function authError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials")) return "Email hoặc mật khẩu chưa đúng.";
  if (normalized.includes("email not confirmed")) return "Bạn cần xác nhận email trước khi đăng nhập.";
  if (normalized.includes("user already registered")) return "Email này đã có tài khoản.";
  if (normalized.includes("password should be")) return "Mật khẩu chưa đủ mạnh.";
  if (normalized.includes("rate limit")) return "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.";
  return "Chưa thể hoàn tất. Vui lòng kiểm tra kết nối và thử lại.";
}

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const copy = content[mode];
  const needsEmail = mode !== "reset";
  const needsPassword = mode === "login" || mode === "register" || mode === "reset";
  const needsConfirmation = mode === "register" || mode === "reset";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (needsEmail) {
      const parsedEmail = emailSchema.safeParse(email);
      if (!parsedEmail.success) return setError(parsedEmail.error.issues[0]?.message ?? "Email chưa hợp lệ.");
    }
    if (needsPassword) {
      const parsedPassword = passwordSchema.safeParse(password);
      if (!parsedPassword.success) return setError(parsedPassword.error.issues[0]?.message ?? "Mật khẩu chưa hợp lệ.");
    }
    if (needsConfirmation && password !== confirmPassword) return setError("Hai mật khẩu chưa trùng nhau.");
    if (mode === "register" && name.trim().length < 2) return setError("Hãy nhập tên của bạn.");

    const supabase = createClient();
    if (!supabase) return setError("Chưa cấu hình Supabase trong .env.local.");
    setBusy(true);

    try {
      if (mode === "login") {
        const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (result.error) throw result.error;
        router.replace("/app");
        router.refresh();
      } else if (mode === "register") {
        const result = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: name.trim() },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=/app`,
          },
        });
        if (result.error) throw result.error;
        if (result.data.session) {
          router.replace("/app");
          router.refresh();
        } else {
          setMessage("Đã tạo tài khoản. Hãy mở email và bấm liên kết xác nhận.");
        }
      } else if (mode === "forgot") {
        const result = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/auth/callback?next=/dat-lai-mat-khau`,
        });
        if (result.error) throw result.error;
        setMessage("Đã gửi email đặt lại mật khẩu. Hãy kiểm tra cả hộp thư rác.");
      } else {
        const result = await supabase.auth.updateUser({ password });
        if (result.error) throw result.error;
        setMessage("Mật khẩu đã được cập nhật. Bạn có thể tiếp tục dùng Sổ Ơi.");
        window.setTimeout(() => router.replace("/app"), 800);
      }
    } catch (caught) {
      setError(authError(caught instanceof Error ? caught.message : "unknown"));
    } finally {
      setBusy(false);
    }
  };

  const fieldClass = "h-14 w-full rounded-2xl border border-[#d8e0ed] bg-[#eaf1fc] font-normal outline-none transition placeholder:text-slate-400 focus:border-sooi-green focus:ring-4 focus:ring-emerald-100";

  return (
    <main className="grid min-h-screen bg-[#fffdf8] lg:grid-cols-2">
      <section className="flex min-h-[360px] flex-col items-center justify-center border-stone-200 bg-[#fffdf8] px-6 py-12 text-center sm:px-12 lg:min-h-screen lg:border-r">
        <Link href="/" aria-label="Sổ Ơi - Trang chủ">
          <Image src="/images/logo.webp" alt="Sổ Ơi" width={1024} height={384} priority className="h-11 w-auto object-contain" />
        </Link>
        <div className="mt-14 max-w-xl sm:mt-20">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-sooi-green sm:text-sm">Nói là ghi · Hỏi là biết</p>
          <h2 className="mt-5 text-4xl font-black leading-[1.08] tracking-[-0.05em] text-sooi-deep sm:text-5xl">Bớt một việc phải nhớ mỗi ngày.</h2>
          <p className="mx-auto mt-6 max-w-md text-base leading-8 text-slate-600">Đơn hàng, thu chi, công nợ và tồn kho nằm trong đúng cuốn sổ của bạn.</p>
        </div>
        <p className="mt-14 text-sm text-sooi-green sm:mt-20">Dữ liệu local-first, đồng bộ riêng theo tài khoản.</p>
      </section>

      <section className="flex items-center justify-center px-5 py-12 sm:px-10 lg:px-12 lg:py-16">
        <div className="w-full max-w-xl rounded-[2rem] border border-stone-200/80 bg-white p-7 shadow-[0_20px_60px_rgba(16,35,30,0.08)] sm:p-10 lg:p-12">
          <div className="text-center">
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-sooi-green">{copy.eyebrow}</p>
            <h1 className="mt-3 text-3xl font-black tracking-[-0.04em] text-sooi-deep sm:text-4xl">{copy.title}</h1>
            <p className="mx-auto mt-3 max-w-md leading-7 text-slate-500">{copy.subtitle}</p>
          </div>

          <form onSubmit={submit} className="mt-9 space-y-5" noValidate>
            {mode === "register" && <label className="block text-sm font-bold text-sooi-ink">Tên của bạn<input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} className={`${fieldClass} mt-2 px-4`} placeholder="Nguyễn Văn An" /></label>}
            {needsEmail && <label className="block text-sm font-bold text-sooi-ink">Email<div className="relative mt-2"><Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><input autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} className={`${fieldClass} pl-11 pr-4`} placeholder="ban@example.com" /></div></label>}
            {needsPassword && <label className="block text-sm font-bold text-sooi-ink"><span className="flex items-center justify-between">{mode === "reset" ? "Mật khẩu mới" : "Mật khẩu"}{mode === "login" && <Link href="/quen-mat-khau" className="font-bold text-sooi-green hover:underline">Quên mật khẩu?</Link>}</span><div className="relative mt-2"><LockKeyhole className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><input type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} className={`${fieldClass} pl-11 pr-12`} placeholder="Ít nhất 8 ký tự" /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-1/2 grid size-8 -translate-y-1/2 place-items-center text-slate-400" aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>}
            {needsConfirmation && <label className="block text-sm font-bold text-sooi-ink">Nhập lại mật khẩu<input type={showPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className={`${fieldClass} mt-2 px-4`} /></label>}
            {error && <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}
            {message && <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{message}</p>}
            <button disabled={busy} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-sooi-green text-sm font-extrabold text-white shadow-lg shadow-emerald-900/15 transition hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-70">{busy ? <LoaderCircle className="animate-spin" size={18} /> : <>{copy.submit}<ArrowRight size={17} /></>}</button>
          </form>

          {mode === "login" && <p className="mt-8 text-center text-sm text-slate-500">Chưa có tài khoản? <Link href="/dang-ky" className="font-extrabold text-sooi-green">Đăng ký miễn phí</Link></p>}
          {mode === "register" && <p className="mt-8 text-center text-sm text-slate-500">Đã có tài khoản? <Link href="/dang-nhap" className="font-extrabold text-sooi-green">Đăng nhập</Link></p>}
          {mode === "forgot" && <p className="mt-8 text-center text-sm"><Link href="/dang-nhap" className="font-extrabold text-sooi-green">← Quay lại đăng nhập</Link></p>}
        </div>
      </section>
    </main>
  );
}
