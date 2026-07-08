
ALTER TABLE public.operators ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE public.operators SET is_admin = TRUE WHERE username = 'shad';
