-- ============================================================
-- Nudge database schema — run this once in Supabase
-- (Supabase dashboard → SQL Editor → paste → Run)
-- ============================================================

-- Each row tracks one user's access. The id matches Supabase Auth's user id.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  -- 'free' | 'daypass' | 'monthly' | 'yearly'
  plan text not null default 'free',
  -- when paid access ends. null = no paid access.
  -- day pass = now + 24h, monthly = now + ~1 month, yearly = now + ~1 year
  access_until timestamptz,
  -- stripe customer id, so renewals/cancellations can find this user
  stripe_customer_id text,
  -- how many free analyses they've used (free tier = 3 total)
  free_used int not null default 0,
  created_at timestamptz not null default now()
);

-- Turn on row level security so users can only read their own row.
alter table public.profiles enable row level security;

-- A user can read their own profile.
create policy "read own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- A user can update their own free_used counter (nothing else).
create policy "update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- When a new auth user signs up, automatically create their profile row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
