import { createClient } from "@/lib/supabase/client";

let client: ReturnType<typeof createClient> | undefined;

export function getSupabaseBrowserClient() {
  if (client === undefined) client = createClient();
  return client;
}
