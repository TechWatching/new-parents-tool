-- Portable PostgreSQL domain. No Supabase schemas, roles, or browser actor claims.
begin;
create schema little_sips;
revoke all on schema little_sips from public;
alter default privileges in schema little_sips revoke execute on functions from public;

create table little_sips.app_users (
  id uuid primary key default gen_random_uuid(),
  display_name text not null default 'Parent'
);
create table little_sips.families (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references little_sips.app_users(id),
  revision bigint not null default 0 check (revision >= 0)
);
create table little_sips.memberships (
  user_id uuid primary key references little_sips.app_users(id),
  family_id uuid not null references little_sips.families(id) on delete cascade
);
create index memberships_family on little_sips.memberships(family_id);
create table little_sips.invitations (
  family_id uuid primary key references little_sips.families(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null
);
create table little_sips.record_versions (
  family_id uuid not null references little_sips.families(id) on delete cascade,
  revision bigint not null,
  kind text not null check (kind in ('feed', 'weight')),
  record_id text not null check (length(btrim(record_id)) > 0),
  record jsonb not null,
  primary key (family_id, revision)
);
-- Hash only the index key (always compare full IDs too): imported IDs have no
-- artificial UUID/length restriction and must not hit btree's tuple-size limit.
create index record_versions_key on little_sips.record_versions(family_id, kind, md5(record_id), revision desc);
create table little_sips.mutation_receipts (
  family_id uuid not null references little_sips.families(id) on delete cascade,
  mutation_id uuid not null,
  actor_id uuid not null references little_sips.app_users(id),
  request jsonb not null,
  result jsonb not null,
  primary key (family_id, mutation_id)
);

-- Row locks, not sequences/timestamps, establish the committed family frontier.
create function little_sips.require_member(p_actor uuid, p_family uuid, p_owner boolean default false)
returns little_sips.families language plpgsql set search_path = pg_catalog as $$
declare f little_sips.families;
begin
  if p_actor is null then raise exception using errcode = 'LS401', message = 'Sign-in required'; end if;
  select * into f from little_sips.families where id = p_family for update;
  if not found or not exists (
    select 1 from little_sips.memberships where user_id = p_actor and family_id = p_family
  ) or (p_owner and f.owner_id <> p_actor) then
    raise exception using errcode = 'LS403', message = 'Family access denied';
  end if;
  return f;
end $$;

create function little_sips.member_limit() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  perform 1 from little_sips.families where id = new.family_id for update;
  if (select count(*) from little_sips.memberships where family_id = new.family_id and user_id <> new.user_id) >= 2 then
    raise exception using errcode = 'LS403', message = 'A family supports at most two parents';
  end if;
  return new;
end $$;
create trigger member_limit before insert or update on little_sips.memberships
for each row execute function little_sips.member_limit();

create function little_sips.family_json(p_family uuid) returns jsonb
language sql stable set search_path = pg_catalog as $$
  select jsonb_build_object('id', f.id, 'ownerId', f.owner_id, 'members',
    (select jsonb_agg(jsonb_build_object('userId', m.user_id, 'name', u.display_name) order by m.user_id)
     from little_sips.memberships m join little_sips.app_users u on u.id = m.user_id where m.family_id = f.id))
  from little_sips.families f where f.id = p_family
$$;

create function little_sips.family_current(p_actor uuid) returns jsonb
language plpgsql set search_path = pg_catalog as $$
declare fid uuid;
begin
  if p_actor is null then raise exception using errcode = 'LS401', message = 'Sign-in required'; end if;
  select family_id into fid from little_sips.memberships where user_id = p_actor;
  if fid is null then return null; end if;
  perform little_sips.require_member(p_actor, fid);
  return little_sips.family_json(fid);
end $$;

create function little_sips.family_create(p_actor uuid) returns jsonb
language plpgsql set search_path = pg_catalog as $$
declare fid uuid;
begin
  perform 1 from little_sips.app_users where id = p_actor for update;
  if not found then raise exception using errcode = 'LS401', message = 'Sign-in required'; end if;
  if exists (select 1 from little_sips.memberships where user_id = p_actor) then
    raise exception using errcode = 'LS400', message = 'Already a family member';
  end if;
  insert into little_sips.families(owner_id) values (p_actor) returning id into fid;
  insert into little_sips.memberships values (p_actor, fid);
  return little_sips.family_json(fid);
end $$;

create function little_sips.family_invite(p_actor uuid, p_family uuid) returns jsonb
language plpgsql set search_path = pg_catalog as $$
declare secret text; expiry timestamptz;
begin
  perform little_sips.require_member(p_actor, p_family, true);
  if (select count(*) from little_sips.memberships where family_id = p_family) >= 2 then
    raise exception using errcode = 'LS400', message = 'Family is full';
  end if;
  -- Two independently random UUIDs provide 244 bits of bearer-secret entropy.
  secret := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  expiry := clock_timestamp() + interval '24 hours';
  insert into little_sips.invitations values (p_family, encode(sha256(convert_to(secret, 'UTF8')), 'hex'), expiry)
  on conflict (family_id) do update set token_hash = excluded.token_hash, expires_at = excluded.expires_at;
  return jsonb_build_object('token', secret, 'expiresAt', expiry);
end $$;

create function little_sips.family_revoke_invitation(p_actor uuid, p_family uuid) returns void
language plpgsql set search_path = pg_catalog as $$
begin
  perform little_sips.require_member(p_actor, p_family, true);
  delete from little_sips.invitations where family_id = p_family;
end $$;

create function little_sips.family_join(p_actor uuid, p_token text) returns jsonb
language plpgsql set search_path = pg_catalog as $$
declare fid uuid; digest text;
begin
  perform 1 from little_sips.app_users where id = p_actor for update;
  if not found then raise exception using errcode = 'LS401', message = 'Sign-in required'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'LS400', message = 'Invalid invitation';
  end if;
  digest := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  select family_id into fid from little_sips.invitations where token_hash = digest;
  perform 1 from little_sips.families where id = fid for update;
  if not found then raise exception using errcode = 'LS403', message = 'Invitation unavailable'; end if;
  -- Recheck after obtaining the same lock used by invitation issuance/revocation.
  perform 1 from little_sips.invitations where family_id = fid and token_hash = digest
    and expires_at > clock_timestamp() for update;
  if not found then raise exception using errcode = 'LS403', message = 'Invitation unavailable'; end if;
  if exists (select 1 from little_sips.memberships where user_id = p_actor) then
    raise exception using errcode = 'LS400', message = 'Already a family member';
  end if;
  insert into little_sips.memberships values (p_actor, fid);
  delete from little_sips.invitations where family_id = fid;
  return little_sips.family_json(fid);
end $$;

create function little_sips.family_leave(p_actor uuid, p_family uuid) returns void
language plpgsql set search_path = pg_catalog as $$
declare f little_sips.families;
begin
  f := little_sips.require_member(p_actor, p_family);
  if f.owner_id = p_actor then raise exception using errcode = 'LS403', message = 'The creator must delete the family instead'; end if;
  delete from little_sips.memberships where user_id = p_actor and family_id = p_family;
end $$;

create function little_sips.family_remove_member(p_actor uuid, p_family uuid, p_member uuid) returns void
language plpgsql set search_path = pg_catalog as $$
begin
  perform little_sips.require_member(p_actor, p_family, true);
  if p_member = p_actor then raise exception using errcode = 'LS403', message = 'Cannot remove the creator'; end if;
  delete from little_sips.memberships where user_id = p_member and family_id = p_family;
  delete from little_sips.invitations where family_id = p_family;
end $$;

create function little_sips.family_delete(p_actor uuid, p_family uuid) returns void
language plpgsql set search_path = pg_catalog as $$
begin
  perform little_sips.require_member(p_actor, p_family, true);
  delete from little_sips.families where id = p_family;
end $$;

create function little_sips.valid_timestamp(p_value jsonb) returns boolean
language plpgsql immutable set search_path = pg_catalog as $$
declare s text; parts text[]; yr int; mon int; dy int; days int[];
begin
  if jsonb_typeof(p_value) is distinct from 'string' then return false; end if;
  s := p_value #>> '{}';
  parts := regexp_match(s, '^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})(:([0-9]{2})(\.[0-9]+)?)?(Z|[+-][0-9]{2}:[0-9]{2})$');
  if parts is null then return false; end if;
  yr := parts[1]::int; mon := parts[2]::int; dy := parts[3]::int;
  days := array[31, case when yr % 4 = 0 and (yr % 100 <> 0 or yr % 400 = 0) then 29 else 28 end,31,30,31,30,31,31,30,31,30,31];
  if mon not between 1 and 12 or dy < 1 or dy > days[mon] or parts[4]::int > 23 or parts[5]::int > 59 or coalesce(parts[7], '0')::int > 59 then return false; end if;
  if parts[9] <> 'Z' and (substring(parts[9], 2, 2)::int > 23 or substring(parts[9], 5, 2)::int > 59) then return false; end if;
  return true;
end $$;

create function little_sips.validate_record(p_kind text, p_record jsonb) returns jsonb
language plpgsql immutable set search_path = pg_catalog as $$
declare result jsonb; amount numeric; comment_value text;
begin
  if jsonb_typeof(p_record) is distinct from 'object'
    or jsonb_typeof(p_record->'id') is distinct from 'string'
    or length(btrim(p_record->>'id', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) = 0
    or not little_sips.valid_timestamp(p_record->'occurredAt')
    or (p_record ? 'updatedAt' and not little_sips.valid_timestamp(p_record->'updatedAt'))
    or (p_record ? 'deletedAt' and not little_sips.valid_timestamp(p_record->'deletedAt')) then
    raise exception using errcode = 'LS400', message = 'Invalid record metadata';
  end if;
  result := jsonb_build_object('id', p_record->'id', 'occurredAt', p_record->'occurredAt',
    'updatedAt', coalesce(p_record->'updatedAt', p_record->'occurredAt'));
  if p_record ? 'deletedAt' then result := result || jsonb_build_object('deletedAt', p_record->'deletedAt'); end if;
  if p_kind = 'feed' then
    if jsonb_typeof(p_record->'amount') is distinct from 'number' then
      raise exception using errcode = 'LS400', message = 'Invalid feed amount';
    end if;
    amount := (p_record->>'amount')::numeric;
    if amount < 1 or amount > 2000 or amount <> trunc(amount) then
      raise exception using errcode = 'LS400', message = 'Invalid feed amount';
    end if;
    comment_value := coalesce(p_record->>'comment', '');
    -- JS counts UTF-16 code units, not PostgreSQL Unicode characters.
    if (p_record ? 'comment' and jsonb_typeof(p_record->'comment') <> 'string')
      or (select coalesce(sum(case when ascii(c) > 65535 then 2 else 1 end), 0)
          from regexp_split_to_table(comment_value, '') c) > 160 then
      raise exception using errcode = 'LS400', message = 'Invalid feed comment';
    end if;
    return result || jsonb_build_object('amount', amount, 'comment', comment_value);
  elsif p_kind = 'weight' then
    if jsonb_typeof(p_record->'kilograms') is distinct from 'number' then
      raise exception using errcode = 'LS400', message = 'Invalid weight';
    end if;
    amount := (p_record->>'kilograms')::numeric;
    if amount < 0.1 or amount > 50 then raise exception using errcode = 'LS400', message = 'Invalid weight'; end if;
    return result || jsonb_build_object('kilograms', amount);
  end if;
  raise exception using errcode = 'LS400', message = 'Invalid record kind';
end $$;

create function little_sips.cloud_record(p_kind text, p_record jsonb, p_revision bigint) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select jsonb_build_object('kind', p_kind, 'record', p_record, 'version', p_revision::text)
$$;

create function little_sips.sync_push(p_actor uuid, p_family uuid, p_mutations jsonb) returns jsonb
language plpgsql set search_path = pg_catalog as $$
declare
  f little_sips.families; mutation jsonb; mid uuid; v_kind text; payload jsonb;
  current_row little_sips.record_versions; receipt little_sips.mutation_receipts;
  current_value jsonb; result jsonb; results jsonb := '[]'::jsonb;
begin
  f := little_sips.require_member(p_actor, p_family);
  if jsonb_typeof(p_mutations) is distinct from 'array' then
    raise exception using errcode = 'LS400', message = 'Expected mutation array';
  end if;
  if jsonb_array_length(p_mutations) > 500 then raise exception using errcode = 'LS400', message = 'Maximum 500 mutations per request'; end if;
  for mutation in select value from jsonb_array_elements(p_mutations) loop
    if jsonb_typeof(mutation) is distinct from 'object'
      or jsonb_typeof(mutation->'mutationId') is distinct from 'string'
      or (mutation->>'mutationId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or not (mutation ? 'baseVersion')
      or jsonb_typeof(mutation->'baseVersion') not in ('null', 'string') then
      raise exception using errcode = 'LS400', message = 'Invalid mutation';
    end if;
    mid := (mutation->>'mutationId')::uuid;
    select * into receipt from little_sips.mutation_receipts where family_id = p_family and mutation_id = mid;
    if found then
      if receipt.actor_id <> p_actor or receipt.request <> mutation then
        raise exception using errcode = 'LS400', message = 'Mutation ID already identifies a different immutable request';
      end if;
      results := results || jsonb_build_array(receipt.result);
      continue;
    end if;
    v_kind := mutation->>'kind';
    payload := little_sips.validate_record(v_kind, mutation->'record');
    select * into current_row from little_sips.record_versions
      where family_id = p_family and kind = v_kind
        and md5(record_id) = md5(payload->>'id') and record_id = payload->>'id'
      order by revision desc limit 1;
    current_value := case when found then little_sips.cloud_record(current_row.kind, current_row.record, current_row.revision) else null end;
    if (mutation->>'baseVersion') is not distinct from current_row.revision::text then
      update little_sips.families set revision = revision + 1 where id = p_family returning * into f;
      insert into little_sips.record_versions values (p_family, f.revision, v_kind, payload->>'id', payload);
      current_value := little_sips.cloud_record(v_kind, payload, f.revision);
      result := jsonb_build_object('mutationId', mutation->>'mutationId', 'status', 'accepted', 'current', current_value);
    else
      result := jsonb_build_object('mutationId', mutation->>'mutationId', 'status', 'conflict', 'current', current_value);
    end if;
    insert into little_sips.mutation_receipts values (p_family, mid, p_actor, mutation, result);
    results := results || jsonb_build_array(result);
  end loop;
  return results;
end $$;

create function little_sips.sync_pull(p_actor uuid, p_family uuid, p_cursor text, p_page text) returns jsonb
language plpgsql set search_path = pg_catalog as $$
declare
  f little_sips.families; low bigint := 0; high bigint; after_revision bigint := 0;
  cursor_data jsonb; page_data jsonb; records jsonb; last_revision bigint; more boolean;
begin
  f := little_sips.require_member(p_actor, p_family);
  high := f.revision;
  begin
    if p_cursor is not null then
      cursor_data := p_cursor::jsonb;
      if cursor_data->>'family' is distinct from p_family::text or cursor_data->>'v' is distinct from '1'
        or (cursor_data->>'revision') is null then raise exception 'Invalid cursor'; end if;
      low := (cursor_data->>'revision')::bigint;
    end if;
    if p_page is not null then
      page_data := p_page::jsonb;
      if page_data->>'family' is distinct from p_family::text or page_data->>'v' is distinct from '1'
        or (page_data->>'low')::bigint is distinct from low
        or (page_data->>'high') is null or (page_data->>'after') is null then raise exception 'Invalid page'; end if;
      high := (page_data->>'high')::bigint;
      after_revision := (page_data->>'after')::bigint;
    end if;
    if low < 0 or low > high or high > f.revision or after_revision < 0 or after_revision > high then raise exception 'Invalid bounds'; end if;
  exception when others then
    raise exception using errcode = 'LS400', message = 'Invalid synchronization cursor or page';
  end;
  -- Immutable history retains the version at the bounded frontier even if it is
  -- updated/deleted between pages. Only the latest version of each key is sent.
  with latest as (
    select distinct on (kind, record_id) kind, record_id, record, revision
    from little_sips.record_versions
    where family_id = p_family and revision > low and revision <= high
    order by kind, record_id, revision desc
  ), batch as (
    select * from latest where revision > after_revision order by revision limit 501
  ), visible as (
    select * from batch order by revision limit 500
  )
  select coalesce((select jsonb_agg(little_sips.cloud_record(kind, record, revision) order by revision) from visible), '[]'::jsonb),
    (select max(revision) from visible), (select count(*) > 500 from batch)
  into records, last_revision, more;
  return jsonb_build_object('records', records,
    'cursor', jsonb_build_object('v', 1, 'family', p_family, 'revision', high::text)::text,
    'nextPage', case when more then jsonb_build_object('v', 1, 'family', p_family, 'low', low::text, 'high', high::text, 'after', last_revision::text)::text else null end);
end $$;

alter table little_sips.app_users enable row level security;
alter table little_sips.families enable row level security;
alter table little_sips.memberships enable row level security;
alter table little_sips.invitations enable row level security;
alter table little_sips.record_versions enable row level security;
alter table little_sips.mutation_receipts enable row level security;
revoke all on all tables in schema little_sips from public;
revoke all on all functions in schema little_sips from public;
commit;
