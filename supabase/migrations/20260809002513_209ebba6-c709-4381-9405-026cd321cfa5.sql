CREATE TABLE public.pin_handoff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  pin text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.pin_handoff TO service_role;

ALTER TABLE public.pin_handoff ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE v_pin text;
BEGIN
  v_pin := lpad((floor(random() * 10000))::int::text, 4, '0');
  UPDATE public.operators
     SET pin_hash = extensions.crypt(v_pin, extensions.gen_salt('bf')),
         updated_at = now()
   WHERE lower(username) = 'admin';
  INSERT INTO public.pin_handoff (username, pin) VALUES ('admin', v_pin);
END $$;