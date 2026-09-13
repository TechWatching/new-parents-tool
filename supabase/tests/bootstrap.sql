-- Disposable PostgreSQL fixture only. These substitutes are NOT a hosted OAuth
-- or PostgREST test: the runner supplies the JWT subject through a test setting.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth, public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
-- Supabase's broad default grants are intentionally simulated to prove 003
-- closes them, not merely that a pristine PostgreSQL installation denies them.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
insert into auth.users(id, email) values
  ('10000000-0000-4000-8000-000000000001', 'owner@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'parent@example.test'),
  ('10000000-0000-4000-8000-000000000003', 'third@example.test'),
  ('10000000-0000-4000-8000-000000000004', 'other@example.test'),
  ('10000000-0000-4000-8000-000000000005', 'legacy@example.test'),
  ('10000000-0000-4000-8000-000000000006', 'racer@example.test');
