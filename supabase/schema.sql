-- Sổ Ơi production-ready starter schema
-- Run once in Supabase SQL Editor on a fresh project.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ledger_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  database jsonb not null default '{}'::jsonb,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

create index if not exists ledger_snapshots_updated_at_idx
  on public.ledger_snapshots (updated_at desc);

alter table public.profiles enable row level security;
alter table public.ledger_snapshots enable row level security;

drop policy if exists "users can read own profile" on public.profiles;
drop policy if exists "users can update own profile" on public.profiles;
drop policy if exists "users can read own ledger" on public.ledger_snapshots;
drop policy if exists "users can insert own ledger" on public.ledger_snapshots;
drop policy if exists "users can update own ledger" on public.ledger_snapshots;

create policy "users can read own profile" on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "users can update own profile" on public.profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "users can read own ledger" on public.ledger_snapshots for select to authenticated using ((select auth.uid()) = user_id);
create policy "users can insert own ledger" on public.ledger_snapshots for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "users can update own ledger" on public.ledger_snapshots for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select, update on public.profiles to authenticated;
grant select, insert, update on public.ledger_snapshots to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (user_id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();
