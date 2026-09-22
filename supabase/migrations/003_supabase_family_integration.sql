-- Supabase-only identity bridge and HTTPS RPC exposure. Apply after 001 and 002.
begin;
create schema little_sips_supabase;
revoke all on schema little_sips_supabase from public, anon, authenticated;
revoke all on schema little_sips from anon, authenticated;
alter default privileges in schema little_sips_supabase revoke execute on functions from public;

create table little_sips_supabase.identities (
  subject uuid primary key,
  app_user_id uuid not null unique references little_sips.app_users(id)
);
alter table little_sips_supabase.identities enable row level security;
create table little_sips_supabase.legacy_import_errors (
  kind text not null, record_id text not null, reason text not null,
  primary key (kind, record_id)
);
alter table little_sips_supabase.legacy_import_errors enable row level security;

create function little_sips_supabase.map_identity(p_subject uuid, p_name text) returns uuid
language plpgsql set search_path = pg_catalog as $$
declare app_id uuid;
begin
  -- Only trusted wrappers/migration owner can invoke this helper.
  perform pg_advisory_xact_lock(hashtextextended(p_subject::text, 0));
  select app_user_id into app_id from little_sips_supabase.identities where subject = p_subject;
  if app_id is null then
    insert into little_sips.app_users(display_name) values (coalesce(nullif(left(btrim(p_name), 80), ''), 'Parent')) returning id into app_id;
    insert into little_sips_supabase.identities values (p_subject, app_id);
  end if;
  return app_id;
end $$;

create function little_sips_supabase.actor() returns uuid
language plpgsql set search_path = pg_catalog as $$
declare subject uuid; display_name text;
begin
  subject := auth.uid();
  if subject is null then raise exception using errcode = 'LS401', message = 'Sign-in required'; end if;
  select coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', 'Parent')
    into display_name from auth.users where id = subject;
  if not found then raise exception using errcode = 'LS401', message = 'Account unavailable'; end if;
  return little_sips_supabase.map_identity(subject, display_name);
end $$;

create function public.ls_identity() returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare app_id uuid; email_address text;
begin
  app_id := little_sips_supabase.actor();
  select email into email_address from auth.users where id = auth.uid();
  return jsonb_strip_nulls(jsonb_build_object('id', app_id, 'email', email_address));
end $$;
create function public.ls_family_current() returns jsonb
language sql security definer set search_path = pg_catalog as $$
  select little_sips.family_current(little_sips_supabase.actor())
$$;
create function public.ls_family_create() returns jsonb
language sql security definer set search_path = pg_catalog as $$
  select little_sips.family_create(little_sips_supabase.actor())
$$;
create function public.ls_family_invite(p_family uuid) returns jsonb
language sql security definer set search_path = pg_catalog as $$
  select little_sips.family_invite(little_sips_supabase.actor(), p_family)
$$;
create function public.ls_family_revoke_invitation(p_family uuid) returns void
language sql security definer set search_path = pg_catalog as $$
  select little_sips.family_revoke_invitation(little_sips_supabase.actor(), p_family)
$$;
create function public.ls_family_join(p_token text) returns jsonb
language sql security definer set search_path = pg_catalog as $$
  select little_sips.family_join(little_sips_supabase.actor(), p_token)
$$;
create function public.ls_family_leave(p_family uuid) returns void
language sql security definer set search_path = pg_catalog as $$
  select little_sips.family_leave(little_sips_supabase.actor(), p_family)
$$;
create function public.ls_family_remove_member(p_family uuid, p_member uuid) returns void
language sql security definer set search_path = pg_catalog as $$
  select little_sips.family_remove_member(little_sips_supabase.actor(), p_family, p_member)
$$;
create function public.ls_family_delete(p_family uuid) returns void
language sql security definer set search_path = pg_catalog as $$
  select little_sips.family_delete(little_sips_supabase.actor(), p_family)
$$;
create function public.ls_sync_pull(p_family uuid, p_cursor text default null, p_page text default null) returns jsonb
language sql security definer set search_path = pg_catalog as $$
  select little_sips.sync_pull(little_sips_supabase.actor(), p_family, p_cursor, p_page)
$$;
create function public.ls_sync_push(p_family uuid, p_mutations jsonb) returns jsonb
language sql security definer set search_path = pg_catalog as $$
  select little_sips.sync_push(little_sips_supabase.actor(), p_family, p_mutations)
$$;

-- Freeze legacy writes before taking the migration snapshot. Keep the original
-- rows in an inaccessible archive, including rows invalid under today's parser.
lock table public.feeds, public.weights in access exclusive mode;
-- Preserve the lookup key for existing browser `user-<subject>` histories.
-- This is a one-time ID allocation choice, not an auth FK or a client identity
-- assertion. New accounts still receive independently generated app IDs, and
-- all callers must resolve identity through the bridge even when values match.
with migrated_users as (
  insert into little_sips.app_users(id, display_name)
  select id, coalesce(nullif(left(btrim(coalesce(raw_user_meta_data->>'full_name',
    raw_user_meta_data->>'name', 'Parent')), 80), ''), 'Parent')
  from auth.users
  returning id
)
insert into little_sips_supabase.identities(subject, app_user_id)
select id, id from migrated_users;
do $$
declare legacy record; app_id uuid; fid uuid; revision_number bigint; payload jsonb; canonical jsonb;
begin
  for legacy in
    select user_id as subject from public.feeds union select user_id from public.weights
  loop
    app_id := little_sips_supabase.map_identity(legacy.subject, 'Parent');
    fid := (little_sips.family_create(app_id)->>'id')::uuid;
  end loop;
  for legacy in
    select 'feed'::text as kind, user_id as subject, id::text as id,
      jsonb_strip_nulls(jsonb_build_object('id', id::text, 'amount', amount, 'comment', comment,
        'occurredAt', to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedAt', to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'deletedAt', to_char(deleted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) as payload
    from public.feeds
    union all
    select 'weight', user_id, id::text,
      jsonb_strip_nulls(jsonb_build_object('id', id::text, 'kilograms', kilograms,
        'occurredAt', to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedAt', to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'deletedAt', to_char(deleted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
    from public.weights
  loop
    begin
      canonical := little_sips.validate_record(legacy.kind, legacy.payload);
      select m.family_id into fid from little_sips.memberships m
        join little_sips_supabase.identities i on i.app_user_id = m.user_id where i.subject = legacy.subject;
      update little_sips.families set revision = revision + 1 where id = fid returning revision into revision_number;
      insert into little_sips.record_versions values (fid, revision_number, legacy.kind, legacy.id, canonical);
    exception when sqlstate 'LS400' then
      insert into little_sips_supabase.legacy_import_errors values (legacy.kind, legacy.id, sqlerrm);
    end;
  end loop;
end $$;
alter table public.feeds set schema little_sips_supabase;
alter table public.weights set schema little_sips_supabase;
revoke all on all tables in schema little_sips from public, anon, authenticated;
revoke all on all tables in schema little_sips_supabase from public, anon, authenticated;
revoke all on all functions in schema little_sips from public, anon, authenticated;
revoke all on all functions in schema little_sips_supabase from public, anon, authenticated;

-- Revoke PUBLIC's default function EXECUTE and Supabase's default API grants,
-- then expose only the wrappers with no actor argument.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'ls\_%' escape '\'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to authenticated', f.signature);
  end loop;
end $$;
notify pgrst, 'reload schema';
commit;
