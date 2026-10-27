import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/app/:path*", "/dang-nhap", "/dang-ky", "/dat-lai-mat-khau", "/auth/:path*"],
};
