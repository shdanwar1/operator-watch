import type { AutomationProcess, AutomationReport } from "@/domain/automation-health";

/** Sanitized, bounded telemetry; never changes the caller's business outcome. */
export async function recordAutomationHealth(process: AutomationProcess, startedAt: number, report: AutomationReport) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const finished = Date.now();
    const { error } = await supabaseAdmin.rpc("record_automation_health", {
      p_process: process,
      p_attempted_at: new Date(startedAt).toISOString(),
      p_finished_at: new Date(finished).toISOString(),
      p_outcome: report.outcome,
      p_duration_ms: Math.min(2_147_483_647, Math.max(0, finished - startedAt)),
      p_counters: report.counters,
      p_stages: report.stages,
      p_error_code: report.errorCode ?? "",
    }).abortSignal(AbortSignal.timeout(2000));
    if (error) console.error("Automation health write failed", process);
  } catch {
    console.error("Automation health unavailable", process);
  }
}