-- Comentários do dropp Ad / AD Drop.
-- Rode uma vez no Supabase: SQL Editor → New query → cole tudo → Run.

create table if not exists public.comments (
  id            bigint generated always as identity primary key,
  campaign_id   text        not null check (char_length(campaign_id) between 1 and 300),
  user_id       uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  author_name   text        not null default 'Leitor',
  author_avatar text,
  body          text        not null check (char_length(btrim(body)) between 1 and 1000),
  hidden        boolean     not null default false,  -- marque para esconder um comentário
  created_at    timestamptz not null default now()
);
create index if not exists comments_campaign_idx on public.comments (campaign_id, created_at);

-- Nome e foto vêm sempre da conta Google/Apple (ninguém consegue se passar por outra pessoa),
-- e cada pessoa só pode comentar 5 vezes por minuto.
create or replace function public.comments_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare meta jsonb;
begin
  if auth.uid() is null then raise exception 'precisa entrar para comentar'; end if;
  if (select count(*) from public.comments
      where user_id = auth.uid() and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'devagar: muitos comentários seguidos';
  end if;
  select raw_user_meta_data into meta from auth.users where id = auth.uid();
  new.user_id       := auth.uid();
  new.author_name   := left(coalesce(nullif(meta->>'full_name', ''), nullif(meta->>'name', ''), 'Leitor'), 80);
  new.author_avatar := coalesce(meta->>'avatar_url', meta->>'picture');
  new.body          := btrim(new.body);
  new.hidden        := false;
  new.created_at    := now();
  return new;
end $$;

drop trigger if exists comments_before_insert on public.comments;
create trigger comments_before_insert before insert on public.comments
  for each row execute function public.comments_before_insert();

alter table public.comments enable row level security;

drop policy if exists "ler comentários visíveis" on public.comments;
create policy "ler comentários visíveis" on public.comments
  for select using (hidden = false);

drop policy if exists "comentar logado" on public.comments;
create policy "comentar logado" on public.comments
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "apagar o próprio" on public.comments;
create policy "apagar o próprio" on public.comments
  for delete to authenticated using (user_id = auth.uid());

-- ninguém edita pelo site (só você, pelo painel)
revoke update on public.comments from anon, authenticated;
