CREATE TABLE IF NOT EXISTS public.pin_rotation_tmp (username text primary key, pin text not null);
REVOKE ALL ON public.pin_rotation_tmp FROM anon, authenticated;
GRANT ALL ON public.pin_rotation_tmp TO service_role;
ALTER TABLE public.pin_rotation_tmp ENABLE ROW LEVEL SECURITY;

DELETE FROM public.pin_rotation_tmp;

DO $$
DECLARE r record; p text;
BEGIN
  FOR r IN SELECT id, username FROM public.operators LOOP
    p := lpad((floor(random()*10000))::int::text, 4, '0');
    UPDATE public.operators
      SET pin_hash = extensions.crypt(p, extensions.gen_salt('bf')), updated_at = now()
      WHERE id = r.id;
    INSERT INTO public.pin_rotation_tmp(username, pin) VALUES (r.username, p);
  END LOOP;
END $$;