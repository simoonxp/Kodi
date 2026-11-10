-- Tabelas do Kodi (Supabase/Postgres). Cada pessoa só enxerga as próprias linhas (RLS).
create table public.chats (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  model text,
  created bigint not null,
  updated bigint not null,
  deleted boolean not null default false
);
create table public.chat_messages (
  id text primary key references public.chats(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  messages jsonb not null default '[]',
  updated bigint not null
);
create table public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}',
  updated bigint not null
);
alter table public.chats enable row level security;
alter table public.chat_messages enable row level security;
alter table public.user_settings enable row level security;
create policy "meus chats" on public.chats for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "minhas mensagens" on public.chat_messages for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "minhas configs" on public.user_settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.chats, public.chat_messages, public.user_settings to authenticated;

-- Permite que a pessoa exclua a própria conta pelo app
create or replace function public.delete_my_account() returns void
language sql security definer set search_path = '' as $$ delete from auth.users where id = auth.uid(); $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
