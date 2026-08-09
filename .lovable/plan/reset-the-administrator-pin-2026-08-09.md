# Reset the Administrator PIN

The current Administrator PIN cannot be recovered: the database stores only a one-way hash, and the saved project secret can never be displayed. So we mint a new random 4-digit PIN and show it to you once.

## What happens

1. A new random 4-digit PIN is generated inside the database and applied to the `admin` account.
2. The plain PIN is written to a temporary, admin-only holding row so it can be read back exactly once.
3. I read that row and show you the PIN in chat.
4. A cleanup step immediately deletes the temporary row, so the plain PIN exists nowhere in the database or in migration files afterwards.
5. The stored project secret `OPERATOR_PIN_ADMIN` is left as-is unless you want it updated; the migration files never contain the PIN.

## Why it is done this way

Writing a chosen PIN directly into a migration would leave it in plaintext in the project history — the exact issue fixed earlier. Generating it inside the database and deleting the temporary record keeps the migration history clean.

## Technical notes

- Migration A: creates `public.pin_handoff` (no Data API grants, RLS enabled, no policies), generates `lpad((floor(random()*10000))::int::text, 4, '0')`, sets `operators.pin_hash = crypt(<pin>, gen_salt('bf'))` for `lower(username) = 'admin'`, and inserts the plain PIN into `pin_handoff`.
- I then read the value with a read-only query and report it to you.
- Migration B: `DROP TABLE public.pin_handoff`.
- No application code changes; login continues to use `verify_operator_pin`.

## After approval

I will post the new PIN in chat. Save it somewhere safe — it will not be retrievable again.
