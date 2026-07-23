
UPDATE public.operators SET pin_hash = extensions.crypt('2026', extensions.gen_salt('bf')) WHERE lower(username) = 'admin';
UPDATE public.operators SET pin_hash = extensions.crypt('2217', extensions.gen_salt('bf')) WHERE lower(username) = 'shad';
UPDATE public.operators SET pin_hash = extensions.crypt('1125', extensions.gen_salt('bf')) WHERE lower(username) = 'alex';
UPDATE public.operators SET pin_hash = extensions.crypt('1412', extensions.gen_salt('bf')) WHERE lower(username) = 'max';
