-- Supabase RLS templates aligned with UI roles (admin vs booker).
-- Assumes JWT claims include:
--   role: "admin" or "booker"
--   bibliotek_id: the local library id for booker users
--   central_id: the central library id for admin users
-- Adjust column names if your schema differs.

create or replace function public.auth_role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
$$;

create or replace function public.auth_bibliotek_id() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'bibliotek_id', '');
$$;

create or replace function public.auth_central_id() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'central_id', '');
$$;

-- tbl_bibliotek
alter table public.tbl_bibliotek enable row level security;
create policy "admins manage biblioteker" on public.tbl_bibliotek
  using (auth_role() = 'admin') with check (auth_role() = 'admin');
create policy "bookers read biblioteker" on public.tbl_bibliotek
  for select using (auth_role() in ('admin','booker'));

-- tbl_bibliotek_relation
alter table public.tbl_bibliotek_relation enable row level security;
create policy "admins manage relationer" on public.tbl_bibliotek_relation
  using (auth_role() = 'admin') with check (auth_role() = 'admin');
create policy "bookers read relationer" on public.tbl_bibliotek_relation
  for select using (auth_role() in ('admin','booker'));

-- tbl_beholdning (inventory)
alter table public.tbl_beholdning enable row level security;
create policy "admins manage beholdning" on public.tbl_beholdning
  using (auth_role() = 'admin') with check (auth_role() = 'admin');
create policy "bookers read own beholdning" on public.tbl_beholdning
  for select using (
    auth_role() = 'booker'
    and owner_bibliotek_id = auth_bibliotek_id()
  );

-- tbl_saet (sets)
alter table public.tbl_saet enable row level security;
create policy "admins manage saet" on public.tbl_saet
  using (auth_role() = 'admin') with check (auth_role() = 'admin');
create policy "bookers read visible saet" on public.tbl_saet
  for select using (auth_role() in ('admin','booker'));

-- tbl_national_holidays
alter table public.tbl_national_holidays enable row level security;
create policy "admins manage national holidays" on public.tbl_national_holidays
  using (auth_role() = 'admin') with check (auth_role() = 'admin');
create policy "bookers read national holidays" on public.tbl_national_holidays
  for select using (auth_role() in ('admin','booker'));

-- tbl_local_holidays
alter table public.tbl_local_holidays enable row level security;
create policy "admins manage local holidays" on public.tbl_local_holidays
  using (auth_role() = 'admin') with check (auth_role() = 'admin');
create policy "bookers read own local holidays" on public.tbl_local_holidays
  for select using (
    auth_role() = 'booker'
    and owner_bibliotek_id = auth_bibliotek_id()
  );

-- tbl_booking_rules
alter table public.tbl_booking_rules enable row level security;
create policy "admins manage booking rules" on public.tbl_booking_rules
  using (auth_role() = 'admin') with check (auth_role() = 'admin');
create policy "bookers read booking rules" on public.tbl_booking_rules
  for select using (auth_role() in ('admin','booker'));

-- tbl_booking (if present)
alter table public.tbl_booking enable row level security;
create policy "admins manage booking" on public.tbl_booking
  using (auth_role() = 'admin') with check (auth_role() = 'admin');
create policy "bookers read own bookings" on public.tbl_booking
  for select using (
    auth_role() = 'booker'
    and requester_bibliotek_id = auth_bibliotek_id()
  );
