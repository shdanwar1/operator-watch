
UPDATE public.operators SET pin_hash = extensions.crypt(to_char(floor(random()*10000)::int, 'FM0000'), extensions.gen_salt('bf')) WHERE lower(username) = 'admin';
UPDATE public.operators SET pin_hash = extensions.crypt(to_char(floor(random()*10000)::int, 'FM0000'), extensions.gen_salt('bf')) WHERE lower(username) = 'shad';
UPDATE public.operators SET pin_hash = extensions.crypt(to_char(floor(random()*10000)::int, 'FM0000'), extensions.gen_salt('bf')) WHERE lower(username) = 'alex';
UPDATE public.operators SET pin_hash = extensions.crypt(to_char(floor(random()*10000)::int, 'FM0000'), extensions.gen_salt('bf')) WHERE lower(username) = 'max';
