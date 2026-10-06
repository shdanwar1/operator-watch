import { createFileRoute } from "@tanstack/react-router";

/**
 * Daily timetable sync (pg_cron, 05:00 Europe/Berlin). Runs the same engine as
 * the admin "Sync" button. Idempotent: every write is keyed on source ids, and
 * a failed fetch never touches stored data.
 */
export const Route = createFileRoute("/api/public/hooks/timetable-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-cron-secret") ?? "";
        if (!provided || provided.length > 200) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: allowed } = await supabaseAdmin.rpc(
          "verify_cron_secret" as never,
          { _provided: provided } as never,
        );
        if (allowed !== true) return new Response("Unauthorized", { status: 401 });

        const { runTimetableSync } = await import("@/domain/timetable-sync.server");
        try {
          const result = await runTimetableSync();
          if (!result.ok) console.error("[timetable-sync] failed:", result.error);
          return Response.json(result, { status: result.ok ? 200 : 502 });
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          console.error("[timetable-sync] failed:", error);
          return Response.json({ ok: false, error }, { status: 500 });
        }
      },
    },
  },
});
