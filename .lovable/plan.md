Run a one-off data update that calls the existing `update_operator` database function to set shad's password to `operator` (stored as a bcrypt hash via `crypt()`).

SQL:
```sql
SELECT public.update_operator(
  (SELECT id FROM public.operators WHERE username = 'shad'),
  NULL, 'operator', NULL, NULL
);
```

No code or schema changes. After this runs, shad can sign in with username `shad` / password `operator`.