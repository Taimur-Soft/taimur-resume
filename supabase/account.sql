-- Account features: "AI usage today" and "Delete my account" (GDPR).
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Needs supabase/ai-usage.sql to have been run first.

-- How many shared-AI requests the signed-in user has made today.
-- Read-only: unlike use_ai_quota() it does not count as a use.
create or replace function public.get_ai_usage()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select count from public.ai_usage where user_id = auth.uid() and day = current_date),
    0
  );
$$;

revoke all on function public.get_ai_usage() from public, anon;
grant execute on function public.get_ai_usage() to authenticated;

-- Permanently deletes the signed-in user's account and everything tied to
-- it: saved resumes, AI usage and the login itself. Only ever acts on the
-- caller's own account (auth.uid()); the website asks for the password
-- and a typed confirmation before calling it.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;

  delete from public.resumes where user_id = uid;
  delete from public.ai_usage where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
