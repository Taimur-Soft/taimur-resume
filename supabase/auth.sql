-- Sign-up check: does this email already have an account?
-- Lets the sign-up form say "this email already has an account, sign in
-- instead" before any code email is sent.
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
--
-- Only confirmed accounts count, so someone who started signing up but
-- never entered the code can still finish. Returns true/false only.

create or replace function public.email_registered(check_email text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from auth.users
    where lower(email) = lower(trim(check_email))
      and email_confirmed_at is not null
  );
$$;

revoke all on function public.email_registered(text) from public;
grant execute on function public.email_registered(text) to anon, authenticated;
