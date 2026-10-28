CREATE OR REPLACE FUNCTION public.record_automation_health(p_process text, p_attempted_at timestamptz, p_finished_at timestamptz, p_outcome text, p_duration_ms integer, p_counters jsonb, p_stages jsonb, p_error_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 p_error_code := nullif(p_error_code,'');
 INSERT INTO public.automation_health AS h (process,attempted_at,finished_at,last_success_at,outcome,duration_ms,counters,stages,error_code,last_error_code,last_error_at)
 VALUES (p_process,p_attempted_at,p_finished_at,CASE WHEN p_outcome IN ('success','noop') THEN p_finished_at END,p_outcome,greatest(0,p_duration_ms),p_counters,p_stages,p_error_code,p_error_code,CASE WHEN p_error_code IS NOT NULL THEN p_finished_at END)
 ON CONFLICT (process) DO UPDATE SET attempted_at=EXCLUDED.attempted_at,finished_at=EXCLUDED.finished_at,
 last_success_at=greatest(h.last_success_at,EXCLUDED.last_success_at),outcome=EXCLUDED.outcome,duration_ms=EXCLUDED.duration_ms,counters=EXCLUDED.counters,stages=EXCLUDED.stages,error_code=EXCLUDED.error_code,
 last_error_code=coalesce(EXCLUDED.last_error_code,h.last_error_code),last_error_at=coalesce(EXCLUDED.last_error_at,h.last_error_at)
 WHERE EXCLUDED.attempted_at > h.attempted_at AND (
 p_process='timetable_sync' OR EXCLUDED.outcome NOT IN ('success','noop') OR h.outcome NOT IN ('success','noop')
 OR EXCLUDED.outcome IS DISTINCT FROM h.outcome OR EXCLUDED.counters IS DISTINCT FROM h.counters OR EXCLUDED.stages IS DISTINCT FROM h.stages
 OR EXCLUDED.finished_at >= h.finished_at + interval '10 minutes');
END; $$;
REVOKE ALL ON FUNCTION public.record_automation_health(text,timestamptz,timestamptz,text,integer,jsonb,jsonb,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_automation_health(text,timestamptz,timestamptz,text,integer,jsonb,jsonb,text) TO service_role;