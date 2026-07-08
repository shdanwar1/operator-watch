import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarDays, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getGoogleClientId } from "@/lib/gcal.functions";
import { listScheduledShifts, insertScheduledShifts } from "@/lib/shifts.functions";

const GSI_SRC = "https://accounts.google.com/gsi/client";
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

type TokenClient = {
  requestAccessToken: (opts?: { prompt?: string }) => void;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (resp: { access_token?: string; error?: string }) => void;
          }) => TokenClient;
        };
      };
    };
  }
}

function loadGsi(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Google script")));
      return;
    }
    const s = document.createElement("script");
    s.src = GSI_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google script"));
    document.head.appendChild(s);
  });
}

type ExistingSched = { day_of_week: number; start_time: string; label: string | null };

export function GoogleCalendarSync({ onSynced }: { onSynced?: () => void }) {
  const [keyword, setKeyword] = useState<string>(
    () => localStorage.getItem("gcal:keyword") ?? "shift",
  );
  const [clientId, setClientId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tokenClientRef = useRef<TokenClient | null>(null);
  const fetchScheduled = useServerFn(listScheduledShifts);
  const insertScheduled = useServerFn(insertScheduledShifts);

  useEffect(() => {
    getGoogleClientId()
      .then((r) => setClientId(r.clientId))
      .catch((e) => toast.error(e.message ?? "Google Client ID missing"));
  }, []);

  useEffect(() => {
    localStorage.setItem("gcal:keyword", keyword);
  }, [keyword]);

  async function ensureTokenClient(): Promise<TokenClient> {
    if (tokenClientRef.current) return tokenClientRef.current;
    if (!clientId) throw new Error("Google Client ID not loaded yet");
    await loadGsi();
    const tc = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: () => {}, // replaced per request
    });
    tokenClientRef.current = tc;
    return tc;
  }

  async function requestToken(): Promise<string> {
    const tc = await ensureTokenClient();
    return new Promise<string>((resolve, reject) => {
      (tc as unknown as { callback: (r: { access_token?: string; error?: string }) => void }).callback =
        (resp) => {
          if (resp.error || !resp.access_token) {
            reject(new Error(resp.error ?? "No access token"));
          } else {
            resolve(resp.access_token);
          }
        };
      tc.requestAccessToken({ prompt: "" });
    });
  }

  async function sync() {
    const kw = keyword.trim();
    if (!kw) return toast.error("Enter a keyword first");
    setBusy(true);
    try {
      const token = await requestToken();
      const timeMin = new Date();
      const timeMax = new Date();
      timeMax.setDate(timeMax.getDate() + 60);
      const url =
        `https://www.googleapis.com/calendar/v3/calendars/primary/events` +
        `?q=${encodeURIComponent(kw)}` +
        `&timeMin=${encodeURIComponent(timeMin.toISOString())}` +
        `&timeMax=${encodeURIComponent(timeMax.toISOString())}` +
        `&singleEvents=true&orderBy=startTime&maxResults=250`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Google Calendar: ${res.status} ${await res.text()}`);
      const data = (await res.json()) as {
        items?: Array<{
          summary?: string;
          start?: { dateTime?: string };
          end?: { dateTime?: string };
        }>;
      };
      const items = data.items ?? [];
      const kwLower = kw.toLowerCase();

      // Load existing schedules for dedupe
      const existingRows = await fetchScheduled();
      const existing = new Set<string>(
        existingRows.map((r) => `${r.day_of_week}|${r.start_time}|${r.label ?? ""}`),
      );

      const toInsert: Array<{
        day_of_week: number;
        start_time: string;
        end_time: string;
        label: string;
      }> = [];

      for (const ev of items) {
        const summary = (ev.summary ?? "").trim();
        if (!summary.toLowerCase().includes(kwLower)) continue;
        const startDT = ev.start?.dateTime;
        const endDT = ev.end?.dateTime;
        if (!startDT || !endDT) continue; // skip all-day events
        const start = new Date(startDT);
        const end = new Date(endDT);
        const dow = start.getDay();
        const st = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}:00`;
        const et = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}:00`;
        const key = `${dow}|${st}|${summary}`;
        if (existing.has(key)) continue;
        existing.add(key);
        toInsert.push({ day_of_week: dow, start_time: st, end_time: et, label: summary });
      }

      if (toInsert.length === 0) {
        toast.info(`No new shifts found for "${kw}"`);
      } else {
        await insertScheduled({ data: { rows: toInsert } });
        toast.success(`Imported ${toInsert.length} shift${toInsert.length === 1 ? "" : "s"}`);
        onSynced?.();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <div className="flex items-center gap-2 text-sm font-medium">
          <CalendarDays className="h-4 w-4" /> Google Calendar
        </div>
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="gcal-kw" className="text-xs text-muted-foreground">
            Import events whose title contains
          </Label>
          <Input
            id="gcal-kw"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="shift"
          />
        </div>
        <Button onClick={sync} disabled={busy || !clientId}>
          {busy ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-4 w-4" />
          )}
          Sync
        </Button>
      </CardContent>
    </Card>
  );
}
