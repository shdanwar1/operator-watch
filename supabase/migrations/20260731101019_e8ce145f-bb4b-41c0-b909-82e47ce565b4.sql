CREATE TABLE public.pin_reveal (
  username text PRIMARY KEY,
  pin text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.pin_reveal TO service_role;
ALTER TABLE public.pin_reveal ENABLE ROW LEVEL SECURITY;

WITH gen AS (
  SELECT id, username, lpad((floor(random() * 10000))::int::text, 4, '0') AS pin
  FROM public.operators
), upd AS (
  UPDATE public.operators o
  SET pin_hash = extensions.crypt(g.pin, extensions.gen_salt('bf')), updated_at = now()
  FROM gen g WHERE o.id = g.id
  RETURNING g.username, g.pin
)
INSERT INTO public.pin_reveal (username, pin) SELECT username, pin FROM upd;