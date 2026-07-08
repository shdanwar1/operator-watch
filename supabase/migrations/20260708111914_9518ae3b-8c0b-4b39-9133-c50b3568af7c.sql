
INSERT INTO public.operators (username, password_hash, mobile, magic_word_hash, is_admin)
VALUES (
  'admin',
  extensions.crypt('admin', extensions.gen_salt('bf')),
  '+490000000000',
  extensions.crypt('admin-magic-' || gen_random_uuid()::text, extensions.gen_salt('bf')),
  TRUE
)
ON CONFLICT (username) DO UPDATE SET
  password_hash = extensions.crypt('admin', extensions.gen_salt('bf')),
  is_admin = TRUE;
