-- Contador de acessos do droppad (só o dono vê).
-- Rode uma vez no Supabase: SQL Editor → New query → cole tudo → Run.

-- 1) cada visita ao site vira uma linha; o site só consegue gravar, nunca ler
create table if not exists public.visits (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  visitor  text not null check (char_length(visitor) between 8 and 64),  -- id aleatório guardado no navegador
  path     text check (char_length(path) <= 300),
  campaign text check (char_length(campaign) <= 300),
  ref      text check (char_length(ref) <= 300),
  device   text check (device in ('mobile', 'desktop'))
);
create index if not exists visits_at_idx on public.visits (at);

alter table public.visits enable row level security;
drop policy if exists "registrar visita" on public.visits;
create policy "registrar visita" on public.visits for insert to anon, authenticated with check (true);
grant insert on public.visits to anon, authenticated;
revoke select, update, delete on public.visits from anon, authenticated;

-- 2) quem pode ver os números: a conta Google que já comentou como "Pedro Rosas"
create table if not exists public.admins (user_id uuid primary key references auth.users (id) on delete cascade);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;
insert into public.admins (user_id)
  select distinct user_id from public.comments where author_name ilike 'Pedro Rosas%'
  on conflict do nothing;
insert into public.admins (user_id)
  select id from auth.users where email = 'pedrorosas20@gmail.com'
  on conflict do nothing;

-- 3) o painel pede os números por esta função; para quem não é admin, ela recusa
create or replace function public.painel_acessos(dias int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare desde timestamptz := now() - make_interval(days => greatest(1, least(dias, 365)));
begin
  if not exists (select 1 from public.admins where user_id = auth.uid()) then
    raise exception 'acesso restrito';
  end if;
  return jsonb_build_object(
    'hoje', (select jsonb_build_object('acessos', count(*), 'pessoas', count(distinct visitor))
             from visits where at >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'),
    'agora', (select count(distinct visitor) from visits where at >= now() - interval '5 minutes'),
    'periodo', (select jsonb_build_object('acessos', count(*), 'pessoas', count(distinct visitor))
                from visits where at >= desde),
    'total', (select jsonb_build_object('acessos', count(*), 'pessoas', count(distinct visitor)) from visits),
    'por_dia', coalesce((select jsonb_agg(jsonb_build_object('dia', dia, 'acessos', a, 'pessoas', p) order by dia) from (
                 select (at at time zone 'America/Sao_Paulo')::date dia, count(*) a, count(distinct visitor) p
                 from visits where at >= desde group by 1) x), '[]'::jsonb),
    'campanhas', coalesce((select jsonb_agg(jsonb_build_object('id', campaign, 'acessos', n) order by n desc) from (
                 select campaign, count(*) n from visits where at >= desde and campaign is not null
                 group by campaign order by n desc limit 15) y), '[]'::jsonb),
    'origens', coalesce((select jsonb_agg(jsonb_build_object('ref', r, 'acessos', n) order by n desc) from (
                 select coalesce(nullif(ref, ''), '(direto)') r, count(*) n from visits where at >= desde
                 group by 1 order by n desc limit 10) z), '[]'::jsonb),
    'dispositivos', (select jsonb_object_agg(coalesce(device, '?'), n) from (
                 select device, count(*) n from visits where at >= desde group by device) w)
  );
end $$;
revoke all on function public.painel_acessos(int) from public, anon;
grant execute on function public.painel_acessos(int) to authenticated;

-- confira: deve aparecer 1 linha (a sua conta)
select count(*) as admins from public.admins;
