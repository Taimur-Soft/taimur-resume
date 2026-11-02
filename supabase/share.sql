-- Short, private share links for saved resumes (used by assets/js/share.js
-- and view.html?r=CODE).
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
--
-- A share points at a saved resume, so the link always shows the latest
-- version ("live"). The owner can hide phone/address on the shared page,
-- see how often it was opened, and turn the link off.

create table if not exists public.resume_shares (
  id text primary key check (id ~ '^[A-Za-z0-9]{8,16}$'),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  resume_id text not null,
  hide_contact boolean not null default false,
  views integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, resume_id)
);

alter table public.resume_shares enable row level security;

-- Owners manage their own links. Nobody else can list or read the table;
-- visitors only get a resume through get_shared_resume() below.
drop policy if exists "owner reads shares" on public.resume_shares;
create policy "owner reads shares" on public.resume_shares
  for select using (user_id = auth.uid());
drop policy if exists "owner creates shares" on public.resume_shares;
create policy "owner creates shares" on public.resume_shares
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.resumes r where r.id::text = resume_id and r.user_id = auth.uid())
  );
drop policy if exists "owner updates shares" on public.resume_shares;
create policy "owner updates shares" on public.resume_shares
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "owner deletes shares" on public.resume_shares;
create policy "owner deletes shares" on public.resume_shares
  for delete using (user_id = auth.uid());

-- What a visitor with the link sees: the resume's current data (minus phone
-- and address if the owner chose to hide them). Counts the view.
-- Returns null when the link doesn't exist or was turned off.
create or replace function public.get_shared_resume(share_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.resume_shares;
  d jsonb;
begin
  if share_id is null or share_id !~ '^[A-Za-z0-9]{8,16}$' then
    return null;
  end if;

  select * into s from public.resume_shares where id = share_id;
  if not found then
    return null;
  end if;

  select r.data into d from public.resumes r
  where r.id::text = s.resume_id and r.user_id = s.user_id;
  if d is null then
    return null;
  end if;

  if s.hide_contact then
    d := d #- '{personal,phoneno}' #- '{personal,address}';
  end if;

  update public.resume_shares set views = views + 1 where id = share_id;
  return d;
end;
$$;

revoke all on function public.get_shared_resume(text) from public;
grant execute on function public.get_shared_resume(text) to anon, authenticated;
