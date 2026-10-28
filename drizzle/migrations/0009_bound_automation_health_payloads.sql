CREATE FUNCTION public.validate_automation_health_payload() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
 IF jsonb_typeof(NEW.counters) <> 'object' OR jsonb_typeof(NEW.stages) <> 'object' OR octet_length(NEW.counters::text) > 4096 OR octet_length(NEW.stages::text) > 4096 THEN RAISE EXCEPTION 'Invalid health payload'; END IF;
 IF NEW.error_code IS NOT NULL AND NEW.error_code NOT IN ('fetch_failed','snapshot_failed','generation_failed','schedule_read_failed','open_shift_read_failed','class_read_failed','checkout_failed','operator_read_failed','dispatch_partial','dispatch_failed') THEN RAISE EXCEPTION 'Invalid health error code'; END IF;
 IF EXISTS (SELECT 1 FROM jsonb_each(NEW.counters) e WHERE jsonb_typeof(e.value) <> 'number' OR length(e.key)>64) OR EXISTS (SELECT 1 FROM jsonb_each(NEW.stages) e WHERE jsonb_typeof(e.value)<>'string' OR length(e.key)>64 OR length(e.value::text)>100) THEN RAISE EXCEPTION 'Invalid health fields'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER validate_automation_health_payload BEFORE INSERT OR UPDATE ON public.automation_health FOR EACH ROW EXECUTE FUNCTION public.validate_automation_health_payload();
REVOKE ALL ON FUNCTION public.validate_automation_health_payload() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_automation_health_payload() TO service_role;