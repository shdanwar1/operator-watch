
INSERT INTO public.operators (username, password_hash, mobile, magic_word_hash, is_admin)
VALUES (
  'admin',
  extensions.crypt(to_char(floor(random()*10000)::int, 'FM0000'), extensions.gen_salt('bf')),
  '+490000000000',
  extensions.crypt(to_char(floor(random()*10000)::int, 'FM0000') || gen_random_uuid()::text, extensions.gen_salt('bf')),
  TRUE
)
ON CONFLICT (username) DO UPDATE SET
  password_hash = extensions.crypt(to_char(floor(random()*10000)::int, 'FM0000'), extensions.gen_salt('bf')),
  is_admin = TRUE;
