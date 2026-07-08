
-- Remove permissive public policies on shifts
DROP POLICY IF EXISTS "Public can view shifts" ON public.shifts;
DROP POLICY IF EXISTS "Public can insert shifts" ON public.shifts;
DROP POLICY IF EXISTS "Public can update shifts" ON public.shifts;
DROP POLICY IF EXISTS "Public can delete shifts" ON public.shifts;

-- Remove permissive public policies on scheduled_shifts
DROP POLICY IF EXISTS "Public can view scheduled_shifts" ON public.scheduled_shifts;
DROP POLICY IF EXISTS "Public can insert scheduled_shifts" ON public.scheduled_shifts;
DROP POLICY IF EXISTS "Public can update scheduled_shifts" ON public.scheduled_shifts;
DROP POLICY IF EXISTS "Public can delete scheduled_shifts" ON public.scheduled_shifts;

-- Ensure RLS remains enabled (default-deny with no policies)
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_shifts ENABLE ROW LEVEL SECURITY;

-- Revoke Data API access from anon and authenticated roles.
-- Access happens exclusively through server functions using the service role.
REVOKE ALL ON public.shifts FROM anon, authenticated;
REVOKE ALL ON public.scheduled_shifts FROM anon, authenticated;

GRANT ALL ON public.shifts TO service_role;
GRANT ALL ON public.scheduled_shifts TO service_role;
