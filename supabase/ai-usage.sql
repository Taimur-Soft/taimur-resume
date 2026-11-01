-- Daily AI usage limit for the site's shared Gemini key (used by api/gemini.js).
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  count integer not null default 0,
  primary key (user_id, day)
);

-- Row Level Security on with no policies: nobody can read or change this
-- table directly from the website. Only the function below touches it.
alter table public.ai_usage enable row level security;

-- Adds one use for the signed-in user today and returns today's total.
-- The server compares that total with the daily limit.
create or replace function public.use_ai_quota()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  used integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  insert into public.ai_usage (user_id, day, count)
  values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1
  returning count into used;

  -- Keep the table small: forget days older than a week.
  delete from public.ai_usage where user_id = auth.uid() and day < current_date - 7;

  return used;
end;
$$;

revoke all on function public.use_ai_quota() from public, anon;
grant execute on function public.use_ai_quota() to authenticated;
