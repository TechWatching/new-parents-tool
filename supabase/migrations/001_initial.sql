-- =============================================================================
-- Little Sips – Supabase initial schema
-- =============================================================================
--
-- SECURITY NOTES
-- --------------
-- • Only the publishable (anon) key is used by the client.  It is safe to
--   expose in browser bundles.  Row Level Security (RLS) is the authorisation
--   boundary: every table grants only the minimum set of operations to the
--   `authenticated` role and enforces `user_id = auth.uid()`.
-- • The service-role key must NEVER appear in client code.
-- • Apply this file once in the Supabase SQL editor or via the Supabase CLI:
--     supabase db push
--
-- =============================================================================

-- ---------------------------------------------------------------------------
-- feeds
-- ---------------------------------------------------------------------------

create table if not exists public.feeds (
  id           uuid        not null,
  user_id      uuid        not null references auth.users (id) on delete cascade,
  amount       integer     not null check (amount > 0 and amount <= 2000),
  occurred_at  timestamptz not null,
  comment      text        not null default '' check (length(comment) <= 160),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,

  constraint feeds_pkey primary key (id)
);

comment on table public.feeds is
  'Individual bottle-feed records owned by a single authenticated user.';

create index if not exists feeds_user_id_occurred_at_idx
  on public.feeds (user_id, occurred_at desc);

create index if not exists feeds_user_id_updated_at_idx
  on public.feeds (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- weights
-- ---------------------------------------------------------------------------

create table if not exists public.weights (
  id           uuid        not null,
  user_id      uuid        not null references auth.users (id) on delete cascade,
  kilograms    numeric(6,3) not null check (kilograms > 0 and kilograms <= 50),
  occurred_at  timestamptz not null,
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,

  constraint weights_pkey primary key (id)
);

comment on table public.weights is
  'Baby weight measurements owned by a single authenticated user.';

create index if not exists weights_user_id_occurred_at_idx
  on public.weights (user_id, occurred_at desc);

create index if not exists weights_user_id_updated_at_idx
  on public.weights (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.feeds   enable row level security;
alter table public.weights enable row level security;

-- Revoke all anonymous access (belt-and-suspenders on top of RLS).
revoke all on public.feeds   from anon;
revoke all on public.weights from anon;

-- feeds policies
create policy "feeds: authenticated users can select their own rows"
  on public.feeds for select
  to authenticated
  using (user_id = auth.uid());

create policy "feeds: authenticated users can insert their own rows"
  on public.feeds for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "feeds: authenticated users can update their own rows"
  on public.feeds for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "feeds: authenticated users can delete their own rows"
  on public.feeds for delete
  to authenticated
  using (user_id = auth.uid());

-- weights policies
create policy "weights: authenticated users can select their own rows"
  on public.weights for select
  to authenticated
  using (user_id = auth.uid());

create policy "weights: authenticated users can insert their own rows"
  on public.weights for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "weights: authenticated users can update their own rows"
  on public.weights for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "weights: authenticated users can delete their own rows"
  on public.weights for delete
  to authenticated
  using (user_id = auth.uid());
