"use client";

import { useEffect, useMemo, useState } from "react";
import { seedDatabase } from "@/lib/ledger/seed";
import type { LedgerDatabase } from "@/lib/ledger/types";
import { ledgerDatabaseSchema } from "@/lib/ledger/schema";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

const STORAGE_KEY = "sooi-next-ledger-v1";

export type SyncStatus = "local" | "loading" | "syncing" | "synced" | "offline" | "error";

function readLocalDatabase(storageKey: string) {
  try {
    const scoped = window.localStorage.getItem(storageKey);
    const legacy = window.localStorage.getItem(STORAGE_KEY);
    const stored = scoped ?? legacy;
    if (!stored) return { database: seedDatabase, exists: false };
    const parsed = ledgerDatabaseSchema.safeParse(JSON.parse(stored));
    if (parsed.success && !scoped) window.localStorage.setItem(storageKey, JSON.stringify(parsed.data));
    return parsed.success ? { database: parsed.data, exists: true } : { database: seedDatabase, exists: false };
  } catch {
    return { database: seedDatabase, exists: false };
  }
}

export function useLedger(userId: string | null = null) {
  const [database, setDatabase] = useState<LedgerDatabase>(seedDatabase);
  const [ready, setReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => userId && getSupabaseBrowserClient() ? "loading" : "local");
  const storageKey = useMemo(() => `${STORAGE_KEY}:${userId ?? "guest"}`, [userId]);

  useEffect(() => {
    let cancelled = false;
    const local = readLocalDatabase(storageKey);
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !userId) {
      queueMicrotask(() => {
        if (cancelled) return;
        setDatabase(local.database);
        setReady(true);
        setSyncStatus("local");
      });
      return () => { cancelled = true; };
    }

    void (async () => {
      const { data, error } = await supabase
        .from("ledger_snapshots")
        .select("database")
        .eq("user_id", userId)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        setSyncStatus("offline");
        setDatabase(local.database);
      } else if (data?.database) {
        const parsed = ledgerDatabaseSchema.safeParse(data.database);
        if (parsed.success) {
          setDatabase(parsed.data);
          setSyncStatus("synced");
        } else {
          setDatabase(local.database);
          setSyncStatus("error");
        }
      } else {
        setDatabase(local.database);
        setSyncStatus("syncing");
      }
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [storageKey, userId]);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(database));
    } catch {
      // Một số trình duyệt riêng tư chặn localStorage; app vẫn tiếp tục chạy trong phiên hiện tại.
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase || !userId) return;
    const timer = window.setTimeout(() => {
      setSyncStatus("syncing");
      void supabase.from("ledger_snapshots").upsert({
        user_id: userId,
        database,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" }).then((result: { error: unknown }) => setSyncStatus(result.error ? "error" : "synced"));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [database, ready, storageKey, userId]);

  const reset = () => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Không chặn thao tác reset nếu trình duyệt không cho truy cập localStorage.
    }
    setDatabase(seedDatabase);
  };

  const importDatabase = (value: unknown) => {
    const parsed = ledgerDatabaseSchema.safeParse(value);
    if (!parsed.success) return false;
    setDatabase(parsed.data);
    return true;
  };

  return { database, setDatabase, reset, ready, syncStatus, importDatabase };
}
