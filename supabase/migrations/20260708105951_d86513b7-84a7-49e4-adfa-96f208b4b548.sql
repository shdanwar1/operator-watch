
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.operators (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  mobile TEXT,
  magic_word_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Access is controlled entirely via server functions using the service role;
-- no direct client access.
GRANT ALL ON public.operators TO service_role;
ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_operators_updated_at
BEFORE UPDATE ON public.operators
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed operator "shad" with magic word "letsgo" and initial password "letsgo".
-- Passwords/magic words are hashed with pgcrypto's crypt() using bcrypt.
INSERT INTO public.operators (username, password_hash, magic_word_hash)
VALUES ('shad', crypt(to_char(floor(random()*10000)::int, 'FM0000'), gen_salt('bf')), crypt(to_char(floor(random()*10000)::int, 'FM0000'), gen_salt('bf')))
ON CONFLICT (username) DO NOTHING;
