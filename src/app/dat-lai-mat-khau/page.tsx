import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Đặt lại mật khẩu" };
export default function ResetPasswordPage() { return <AuthForm mode="reset" />; }
