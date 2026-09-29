# SQL migrations

**SQL-first discipline.** Every schema/RLS change is written here as idempotent, re-runnable SQL
and verified **block by block** in the Supabase SQL editor *before* any front-end work. Never let
the UI or an ORM define schema. Never a one-shot destructive operation.

Tables are created **phase by phase**, not all up front — each phase adds only what it needs.

Target project: `https://ujevzgzgyvehtodiclfo.supabase.co` (ref `ujevzgzgyvehtodiclfo`).
**Never run these against ref `nxpmxlxjmpwkrwpopqbr` — that is the live Nucleus instance.**

---

## Phase 0 — Foundation

Run in order, in the Supabase SQL editor. Each file is split into `-- BLOCK n` sections; paste
and run one block at a time, checking the result before moving on. Every file ends with a
commented `VERIFY` query.

| # | File | What it does |
|---|---|---|
| 00 | `phase0/00_employees_stub.sql` | Local stub of the shared Nucleus `employees` table + 3 launch users + read-only RLS |
| 01 | `phase0/01_helpers.sql` | `fr_set_updated_at()`, `fr_fiscal_year()`, `fr_fiscal_quarter()` |
| 02 | `phase0/02_team_members.sql` | `fr_team_members` + the solo builder seeded as FR `lead` |
| 03 | `phase0/03_access_helpers.sql` | **The security core** — `is_fr_authorised()`, `is_fr_manager()`, `fr_can_see_record()`, `fr_current_employee_id()` |
| 04 | `phase0/04_config_tables.sql` | 12 config/picklist tables + `fr_targets` |
| 05 | `phase0/05_seed.sql` | All reference data (10 stages, 12 programs, 7 bank accounts, currencies, FX, milestone types/templates, settings) |
| 06 | `phase0/06_rls_and_triggers.sql` | RLS on every table + `updated_at` triggers |
| 07 | `phase0/07_verify.sql` | Verification — object inventory, seed counts, invariants, and the access-helper truth table |

Files 00–06 are re-runnable at any time. 07 mutates nothing (its one insert is inside a
transaction it rolls back).

### After running 00–07

Create the matching **auth users** so someone can actually sign in. Auth is deliberately
email/password for now — Google SSO comes later and will touch only the sign-in screen, because
every policy resolves identity by JWT email regardless of how the user authenticated.

In the Supabase dashboard → **Authentication → Users → Add user**, create a user whose email
**exactly matches** the one seeded `employees` row:

- `achintya.rao@thenudge.org` (super_admin — full access, solo build for now)

Tick *Auto Confirm User* so no email verification is needed. The email is the only thing that
has to match — the auth UID is expected to differ from `employees.id`, by design.

---

## The four rules that will cost you hours if forgotten

1. **Identity resolves by email from the JWT, never `auth.uid()`.**
   `auth.users.id` is deliberately different from `employees.id`.
   `where e.id = auth.uid()` returns **zero rows with no error**.

2. **`auth.jwt() ->> 'email'` is NULL in the Supabase SQL editor.** Anything RLS- or RPC-guarded
   evaluates false there. That is correct, not broken. To test helper *logic* in the editor,
   impersonate an email:
   ```sql
   select set_config('request.jwt.claims', '{"email":"you@thenudge.org"}', false);
   select public.is_fr_authorised(), public.is_fr_manager();
   select set_config('request.jwt.claims', '', false);  -- reset when done
   ```
   The editor runs as the table owner, so **RLS is bypassed there** — this proves the functions,
   not the policies. Real proof is a signed-in browser session.

3. **`external_ref` unique indexes are PARTIAL** (`WHERE external_ref IS NOT NULL`), so Postgres
   rejects `ON CONFLICT (external_ref)`. Use the **bare** `ON CONFLICT DO NOTHING`.

4. **A `for all` policy needs both `using` and `with check`** — with only `using`, inserts fail
   silently.

## Seed values still to confirm

Marked `[CONFIRM]` in `05_seed.sql`:

- **Stage probabilities** — the handover records the 10 stages but not their win probabilities.
  Current values are interpolated from the PRD's 7-stage curve. These drive **weighted pipeline**,
  so confirm these with the FR team before anyone trusts a forecast number.
- **FX rates** — only USD @ 95 is documented. EUR/GBP/SGD/AED/CHF are ballpark placeholders
  tagged `seed_placeholder_confirm_with_finance`.
- **Bank account `full_name`** — left NULL rather than guessed. (The design system records the
  legal entity as *Nudge Lifeskills Foundation*, which likely expands `nlf`/`nlf_fcra`, but a
  wrong legal name on an FCRA receipt is not worth the risk.)
- **Milestone templates** — a minimal starting set derived from the PRD's per-category compliance
  notes; the handover does not record the real ones.
- **Projects** — only `EIP-KA` is documented. The rest must come from the FR team; project codes
  are resolution keys, so they must not be invented.
