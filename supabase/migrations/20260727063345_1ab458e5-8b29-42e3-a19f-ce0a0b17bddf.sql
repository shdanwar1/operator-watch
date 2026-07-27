UPDATE public.operators SET pin_hash = extensions.crypt('1000', extensions.gen_salt('bf')), updated_at = now() WHERE lower(username) = 'admin';
UPDATE public.operators SET pin_hash = extensions.crypt('2000', extensions.gen_salt('bf')), updated_at = now() WHERE lower(username) = 'shad';
UPDATE public.operators SET pin_hash = extensions.crypt('3000', extensions.gen_salt('bf')), updated_at = now() WHERE lower(username) = 'alex';
UPDATE public.operators SET pin_hash = extensions.crypt('4000', extensions.gen_salt('bf')), is_active = true, updated_at = now() WHERE lower(username) = 'max';