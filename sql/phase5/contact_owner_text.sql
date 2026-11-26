-- ============================================================================
-- Contacts: relationship owner as free text
-- ============================================================================
-- fr_contacts.relationship_owner_name holds the owner as written. Contacts
-- imported from Zoho get their "Contact FR Owner" (scripts/zoho_contact_owners.sql,
-- kept out of git). A new contact defaults to whoever adds it; anyone can
-- edit it. The Contacts page filters on it.
-- Idempotent; run block by block.

-- Block 1: the column ------------------------------------------------------
alter table public.fr_contacts add column if not exists relationship_owner_name text;
create index if not exists fr_contacts_owner_name_idx on public.fr_contacts (relationship_owner_name);

-- Block 2: a new contact's owner defaults to the person adding it ----------
-- Covers every way a contact is created (the form, a deal, a card scan).
create or replace function public.fr_contact_default_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.relationship_owner_name is null or btrim(new.relationship_owner_name) = '' then
    new.relationship_owner_name := (
      select e.name from employees e
      where e.id = coalesce(new.created_by, public.fr_current_employee_id())
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fr_contact_default_owner on public.fr_contacts;
create trigger trg_fr_contact_default_owner
  before insert on public.fr_contacts
  for each row execute function public.fr_contact_default_owner();

-- Block 3: owner names for the filter (aggregated here: 1,800+ contacts) ----
create or replace view public.fr_contact_owner_names with (security_invoker = on) as
select relationship_owner_name as name, count(*) as contacts
from public.fr_contacts
where deleted_at is null and relationship_owner_name is not null and btrim(relationship_owner_name) <> ''
group by relationship_owner_name;

-- Block 4: fill in Zoho's owners -------------------------------------------
-- Run scripts/zoho_contact_owners.sql (generated from Contacts_FR_2026_07_13.csv).

-- Block 5: check -------------------------------------------------------------
select count(*) filter (where relationship_owner_name is not null) as with_owner,
       count(*) as contacts
from public.fr_contacts where deleted_at is null;
