-- Kard - TCG Simulator: tabelas de contas no Supabase.
-- Cole este arquivo inteiro em: Supabase → SQL Editor → New query → Run.
-- Pode rodar de novo sem problema (usa "if not exists" / "or replace").

-- Perfil público de cada conta (o e-mail e a senha ficam em auth.users, gerenciados pelo Supabase)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);

-- Nome de usuário único sem diferenciar maiúsculas/minúsculas
create unique index if not exists profiles_username_lower on public.profiles (lower(username));

-- Segurança: cada pessoa só lê e altera o próprio perfil
alter table public.profiles enable row level security;

drop policy if exists "profiles: ler o próprio" on public.profiles;
create policy "profiles: ler o próprio" on public.profiles
  for select using (auth.uid() = id);

-- Perfis visíveis para quem está logado (foto e informações aparecem no lobby e na mesa online).
-- O e-mail não fica aqui (fica em auth.users), então não é exposto.
drop policy if exists "profiles: logados leem" on public.profiles;
create policy "profiles: logados leem" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles: criar o próprio" on public.profiles;
create policy "profiles: criar o próprio" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles: alterar o próprio" on public.profiles;
create policy "profiles: alterar o próprio" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Informações do perfil ("Meu Perfil" no app)
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists location text;
alter table public.profiles add column if not exists favorite_format text;
alter table public.profiles add column if not exists favorite_colors text;
alter table public.profiles add column if not exists playing_since integer;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists updated_at timestamptz;
-- TCG favorito + campos específicos de cada jogo, ex.: {"mtg": {"colors": "WU", "since": 2005}, "pokemon": {"pokemon": "Pikachu"}}
alter table public.profiles add column if not exists favorite_tcg text;
alter table public.profiles add column if not exists tcg_info jsonb;
alter table public.profiles drop constraint if exists profiles_tcg_check;
alter table public.profiles add constraint profiles_tcg_check check (
  (favorite_tcg is null or favorite_tcg in ('mtg', 'pokemon', 'ygo'))
  and (tcg_info is null or (jsonb_typeof(tcg_info) = 'object' and octet_length(tcg_info::text) <= 4000))
);
-- primeira versão do perfil (só Magic: favorite_colors/favorite_format/playing_since) → tcg_info.mtg
update public.profiles
set tcg_info = jsonb_build_object('mtg', jsonb_strip_nulls(jsonb_build_object('colors', favorite_colors, 'format', favorite_format, 'since', playing_since))),
    favorite_tcg = coalesce(favorite_tcg, 'mtg')
where tcg_info is null and (favorite_colors is not null or favorite_format is not null or playing_since is not null);

alter table public.profiles drop constraint if exists profiles_info_check;
alter table public.profiles add constraint profiles_info_check check (
  (display_name is null or char_length(display_name) <= 40)
  and (bio is null or char_length(bio) <= 300)
  and (location is null or char_length(location) <= 60)
  and (favorite_format is null or char_length(favorite_format) <= 30)
  and (favorite_colors is null or favorite_colors ~ '^[WUBRG]{0,5}$')
  and (playing_since is null or playing_since between 1993 and 2100)
  and (avatar_url is null or char_length(avatar_url) <= 500)
);

-- Fotos de perfil: bucket público para leitura; cada pessoa só mexe na própria pasta (<id da conta>/...)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "avatars: ver a própria pasta" on storage.objects;
create policy "avatars: ver a própria pasta" on storage.objects
  for select to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars: enviar na própria pasta" on storage.objects;
create policy "avatars: enviar na própria pasta" on storage.objects
  for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars: alterar na própria pasta" on storage.objects;
create policy "avatars: alterar na própria pasta" on storage.objects
  for update to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars: apagar na própria pasta" on storage.objects;
create policy "avatars: apagar na própria pasta" on storage.objects
  for delete to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Cria o perfil automaticamente quando uma conta é criada (cadastro por e-mail ou Google).
-- O nome de usuário vem do cadastro do app; no Google fica vazio até a pessoa escolher.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.profiles (id, username)
    values (new.id, nullif(new.raw_user_meta_data ->> 'username', ''));
  exception when unique_violation or check_violation then
    -- nome já usado ou inválido: cria sem nome (o app pede outro)
    insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Verifica se um nome de usuário está livre (usado no cadastro, antes de ter conta)
create or replace function public.username_available(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.profiles where lower(username) = lower(name));
$$;

grant execute on function public.username_available(text) to anon, authenticated;

-- ============================================================
-- Relatório de problemas do motor de regras (enviado pelos apps dos jogadores)
-- ============================================================
-- Os jogadores só ENVIAM (pela função report_engine_issues, com limites de tamanho).
-- Só administradores LEEM e apagam. Para se tornar administrador, rode uma vez (troque o e-mail):
--   insert into public.app_admins (user_id) select id from auth.users where email = 'seu@email.com';

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.app_admins enable row level security;
-- sem políticas: ninguém lê/altera pela API; só pelo SQL Editor

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;
grant execute on function public.is_app_admin() to authenticated;

-- Contas banidas pelos administradores (sem políticas: só as funções abaixo leem/alteram).
create table if not exists public.app_bans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  reason text not null default '',
  banned_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- null = permanente
  expires_at timestamptz
);
alter table public.app_bans enable row level security;

create or replace function public.is_banned(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_bans where user_id = uid and (expires_at is null or expires_at > now()));
$$;
grant execute on function public.is_banned(uuid) to authenticated;

create table if not exists public.engine_issues (
  key text primary key,
  kind text not null,
  card text,
  text text not null,
  count integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  app_version text,
  card_data jsonb,
  examples jsonb not null default '[]'::jsonb
);
create index if not exists engine_issues_last_seen on public.engine_issues (last_seen desc);

-- quantos jogadores diferentes viram cada problema
create table if not exists public.engine_issue_reporters (
  key text not null references public.engine_issues (key) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (key, user_id)
);

alter table public.engine_issues enable row level security;
alter table public.engine_issue_reporters enable row level security;

drop policy if exists "engine_issues: admin lê" on public.engine_issues;
create policy "engine_issues: admin lê" on public.engine_issues
  for select using (public.is_app_admin());

drop policy if exists "engine_issues: admin apaga" on public.engine_issues;
create policy "engine_issues: admin apaga" on public.engine_issues
  for delete using (public.is_app_admin());

drop policy if exists "engine_issue_reporters: admin lê" on public.engine_issue_reporters;
create policy "engine_issue_reporters: admin lê" on public.engine_issue_reporters
  for select using (public.is_app_admin());

-- Recebe um lote de problemas do app (no máximo 100 por chamada) e agrega por chave.
create or replace function public.report_engine_issues(items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  it jsonb;
  k text;
  ex jsonb;
  n integer := 0;
begin
  if auth.uid() is null then
    raise exception 'login necessário';
  end if;
  if jsonb_typeof(items) <> 'array' then
    raise exception 'formato inválido';
  end if;
  for it in select value from jsonb_array_elements(items) limit 100 loop
    k := left(coalesce(it ->> 'key', ''), 400);
    if k = '' or coalesce(it ->> 'kind', '') not in ('unparsed', 'aiJudge', 'aiFailed', 'manual', 'unknownPT', 'crash', 'botRejected', 'userReport') then
      continue;
    end if;
    ex := case when octet_length((it -> 'example')::text) <= 6000 then it -> 'example' else null end;
    insert into public.engine_issues as e (key, kind, card, text, app_version, card_data, examples)
    values (
      k,
      it ->> 'kind',
      left(it ->> 'card', 200),
      left(coalesce(it ->> 'text', ''), 3000),
      left(it ->> 'appVersion', 20),
      case when octet_length((it -> 'cardData')::text) <= 8000 then it -> 'cardData' else null end,
      case when ex is null then '[]'::jsonb else jsonb_build_array(ex) end
    )
    on conflict (key) do update set
      count = e.count + 1,
      last_seen = now(),
      app_version = coalesce(excluded.app_version, e.app_version),
      card_data = coalesce(excluded.card_data, e.card_data),
      examples = case when ex is null then e.examples else (
        select coalesce(jsonb_agg(v), '[]'::jsonb)
        from (select v from jsonb_array_elements(jsonb_build_array(ex) || e.examples) as x(v) limit 3) s
      ) end;
    insert into public.engine_issue_reporters (key, user_id) values (k, auth.uid()) on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.report_engine_issues(jsonb) from public, anon;
grant execute on function public.report_engine_issues(jsonb) to authenticated;

-- Lista para o administrador (com o número de jogadores que viram cada problema).
create or replace function public.list_engine_issues()
returns table (
  key text, kind text, card text, text text, count integer, reporters bigint,
  first_seen timestamptz, last_seen timestamptz, app_version text, card_data jsonb, examples jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select i.key, i.kind, i.card, i.text, i.count,
         (select count(*) from public.engine_issue_reporters r where r.key = i.key),
         i.first_seen, i.last_seen, i.app_version, i.card_data, i.examples
  from public.engine_issues i
  where public.is_app_admin()
  order by i.last_seen desc
  limit 3000;
$$;
grant execute on function public.list_engine_issues() to authenticated;

-- ============================================================
-- Amigos e convites para partidas
-- ============================================================
-- Todas as alterações passam por funções (validadas no servidor); as tabelas só aceitam leitura
-- de quem participa da amizade/convite.

create table if not exists public.friendships (
  requester uuid not null references auth.users (id) on delete cascade,
  addressee uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (requester, addressee),
  check (requester <> addressee)
);
-- um único registro por par, não importa quem pediu
create unique index if not exists friendships_pair on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index if not exists friendships_addressee on public.friendships (addressee);
alter table public.friendships enable row level security;

drop policy if exists "friendships: participantes leem" on public.friendships;
create policy "friendships: participantes leem" on public.friendships
  for select to authenticated using (auth.uid() in (requester, addressee));

create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships
    where status = 'accepted' and ((requester = a and addressee = b) or (requester = b and addressee = a))
  );
$$;
grant execute on function public.are_friends(uuid, uuid) to authenticated;

-- Procura jogadores pelo nome de usuário ou de exibição (mínimo 2 letras, até 20 resultados).
create or replace function public.search_users(q text)
returns table (id uuid, username text, display_name text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  with term as (
    select '%' || replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  )
  select p.id, p.username, p.display_name, p.avatar_url
  from public.profiles p, term
  where auth.uid() is not null
    and char_length(trim(q)) >= 2
    and p.id <> auth.uid()
    and p.username is not null
    and not public.is_banned(p.id)
    and (p.username ilike term.pat or p.display_name ilike term.pat)
  order by (lower(p.username) = lower(trim(q))) desc, p.username
  limit 20;
$$;
grant execute on function public.search_users(text) to authenticated;

-- Pede amizade. Se o outro já tinha pedido para mim, aceita. Retorna: 'requested' | 'accepted' | 'already'.
create or replace function public.send_friend_request(target uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  f public.friendships;
begin
  if me is null then raise exception 'login necessário'; end if;
  if public.is_banned(me) then raise exception 'conta suspensa'; end if;
  if target is null or target = me then raise exception 'jogador inválido'; end if;
  if not exists (select 1 from auth.users where id = target) then raise exception 'jogador não encontrado'; end if;
  select * into f from public.friendships
  where (requester = me and addressee = target) or (requester = target and addressee = me);
  if found then
    if f.status = 'pending' and f.requester = target then
      update public.friendships set status = 'accepted', accepted_at = now() where requester = target and addressee = me;
      return 'accepted';
    end if;
    return 'already';
  end if;
  -- limite contra spam: no máximo 50 pedidos pendentes enviados
  if (select count(*) from public.friendships where requester = me and status = 'pending') >= 50 then
    raise exception 'muitos pedidos pendentes';
  end if;
  insert into public.friendships (requester, addressee) values (me, target);
  return 'requested';
end;
$$;
grant execute on function public.send_friend_request(uuid) to authenticated;

-- Responde a um pedido recebido (aceitar ou recusar).
create or replace function public.respond_friend_request(other uuid, accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'login necessário'; end if;
  if accept then
    update public.friendships set status = 'accepted', accepted_at = now()
    where requester = other and addressee = auth.uid() and status = 'pending';
  else
    delete from public.friendships where requester = other and addressee = auth.uid() and status = 'pending';
  end if;
end;
$$;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;

-- Desfaz a amizade ou cancela um pedido (enviado ou recebido).
create or replace function public.remove_friend(other uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.friendships
  where auth.uid() is not null
    and ((requester = auth.uid() and addressee = other) or (requester = other and addressee = auth.uid()));
$$;
grant execute on function public.remove_friend(uuid) to authenticated;

-- Convites para partidas (o convidado recebe na hora pelo Realtime)
create table if not exists public.game_invites (
  id bigint generated always as identity primary key,
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  room_code text not null check (room_code ~ '^[A-Z0-9]{6}$'),
  created_at timestamptz not null default now()
);
create index if not exists game_invites_to on public.game_invites (to_user, created_at desc);
alter table public.game_invites enable row level security;

drop policy if exists "game_invites: participantes leem" on public.game_invites;
create policy "game_invites: participantes leem" on public.game_invites
  for select to authenticated using (auth.uid() in (from_user, to_user));

create or replace function public.invite_friend(target uuid, code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'login necessário'; end if;
  if public.is_banned(auth.uid()) then raise exception 'conta suspensa'; end if;
  if not public.are_friends(auth.uid(), target) then raise exception 'só é possível convidar amigos'; end if;
  -- um convite por amigo (o novo substitui o anterior) e limpa os antigos
  delete from public.game_invites where (from_user = auth.uid() and to_user = target) or created_at < now() - interval '1 day';
  insert into public.game_invites (from_user, to_user, room_code) values (auth.uid(), target, upper(code));
end;
$$;
grant execute on function public.invite_friend(uuid, text) to authenticated;

create or replace function public.dismiss_invite(invite_id bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.game_invites where id = invite_id and to_user = auth.uid();
$$;
grant execute on function public.dismiss_invite(bigint) to authenticated;

-- Avisos em tempo real (pedidos de amizade e convites) pelo Supabase Realtime
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'friendships') then
      alter publication supabase_realtime add table public.friendships;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_invites') then
      alter publication supabase_realtime add table public.game_invites;
    end if;
  end if;
end;
$$;

-- ============================================================
-- Uso da IA (Juiz e bot): contador diário por jogador, usado pela Edge Function "ai"
-- ============================================================
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  count integer not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
-- sem políticas: só a Edge Function (com a chave de serviço) mexe nesta tabela

-- Soma 1 ao uso de hoje e devolve o total (chamada pela Edge Function).
create or replace function public.ai_usage_hit(uid uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  insert into public.ai_usage as u (user_id, day, count) values (uid, current_date, 1)
  on conflict (user_id, day) do update set count = u.count + 1
  returning count;
$$;
revoke execute on function public.ai_usage_hit(uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.ai_usage_hit(uuid) to service_role;
  end if;
end $$;

-- ============================================================
-- Administração: painel exclusivo para administradores
-- ============================================================
-- Primeiro administrador (rode uma vez no SQL Editor, trocando o e-mail):
--   insert into public.app_admins (user_id) select id from auth.users where email = 'seu@email.com';
-- Depois disso, os outros administradores podem ser nomeados pelo próprio painel do app.
-- Todas as funções "admin_*" conferem is_app_admin() no servidor: o painel escondido no app é só
-- conveniência; a segurança está aqui.

-- Configurações do app editáveis pelo painel (aviso para todos, limite diário da IA).
create table if not exists public.app_config (
  key text primary key check (key in ('announcement', 'ai_daily_limit')),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
alter table public.app_config enable row level security;

-- Registro do que cada administrador fez (banir, nomear admin, mudar configurações...).
create table if not exists public.admin_log (
  id bigserial primary key,
  admin_id uuid references auth.users (id) on delete set null,
  action text not null,
  target uuid references auth.users (id) on delete set null,
  details jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_log enable row level security;

create or replace function public.admin_guard()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_app_admin() then raise exception 'apenas administradores'; end if;
end;
$$;

create or replace function public.admin_write_log(act text, tgt uuid, info jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_log (admin_id, action, target, details) values (auth.uid(), act, tgt, info);
$$;
revoke execute on function public.admin_write_log(text, uuid, jsonb) from public, anon, authenticated;

-- Situação da minha conta (o app mostra o painel para admins e o aviso de suspensão para banidos).
create or replace function public.my_account_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'admin', public.is_app_admin(),
    'banned', public.is_banned(auth.uid()),
    'reason', (select reason from public.app_bans where user_id = auth.uid()),
    'until', (select expires_at from public.app_bans where user_id = auth.uid())
  );
$$;
grant execute on function public.my_account_status() to authenticated;

-- Quem é administrador (selo "Administrador" nos perfis; não é segredo).
create or replace function public.admin_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select user_id from public.app_admins where auth.uid() is not null;
$$;
grant execute on function public.admin_ids() to authenticated;

-- Aviso para todos os jogadores (aparece no app).
create or replace function public.get_announcement()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select value || jsonb_build_object('updated_at', updated_at) from public.app_config where key = 'announcement';
$$;
grant execute on function public.get_announcement() to anon, authenticated;

-- Números gerais do painel.
create or replace function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_guard();
  return jsonb_build_object(
    'users', (select count(*) from auth.users),
    'new_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'active_7d', (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
    'admins', (select count(*) from public.app_admins),
    'banned', (select count(*) from public.app_bans where expires_at is null or expires_at > now()),
    'ai_today', (select coalesce(sum(count), 0) from public.ai_usage where day = current_date),
    'ai_users_today', (select count(*) from public.ai_usage where day = current_date),
    'ai_7d', (select coalesce(sum(count), 0) from public.ai_usage where day > current_date - 7),
    'ai_limit', (select value from public.app_config where key = 'ai_daily_limit'),
    'friendships', (select count(*) from public.friendships where status = 'accepted')
  );
end;
$$;
grant execute on function public.admin_stats() to authenticated;

-- Lista de contas (com e-mail, só para administradores). sort: 'recent' | 'active' | 'ai'
create or replace function public.admin_list_users(q text default '', sort text default 'recent', lim integer default 50, off integer default 0)
returns table (
  id uuid, username text, display_name text, avatar_url text, email text,
  created_at timestamptz, last_sign_in_at timestamptz, is_admin boolean,
  banned boolean, ban_reason text, ban_until timestamptz, ai_today integer, ai_7d bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pat text := '%' || replace(replace(replace(coalesce(trim(q), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  perform public.admin_guard();
  return query
  select u.id, p.username, p.display_name, p.avatar_url, u.email::text,
         u.created_at, u.last_sign_in_at,
         exists (select 1 from public.app_admins a where a.user_id = u.id),
         (b.user_id is not null and (b.expires_at is null or b.expires_at > now())),
         b.reason, b.expires_at,
         coalesce((select x.count from public.ai_usage x where x.user_id = u.id and x.day = current_date), 0),
         coalesce((select sum(x.count) from public.ai_usage x where x.user_id = u.id and x.day > current_date - 7), 0)
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.app_bans b on b.user_id = u.id
  where coalesce(trim(q), '') = '' or p.username ilike pat or p.display_name ilike pat or u.email ilike pat
  order by
    case when sort = 'active' then u.last_sign_in_at end desc nulls last,
    case when sort = 'ai' then coalesce((select x.count from public.ai_usage x where x.user_id = u.id and x.day = current_date), 0) end desc,
    u.created_at desc
  limit least(greatest(lim, 1), 200) offset greatest(off, 0);
end;
$$;
grant execute on function public.admin_list_users(text, text, integer, integer) to authenticated;

-- Nomeia ou tira um administrador (não deixa o app sem nenhum).
create or replace function public.admin_set_admin(target uuid, make boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.admin_guard();
  if make then
    if public.is_banned(target) then raise exception 'conta suspensa não pode ser administradora'; end if;
    insert into public.app_admins (user_id) values (target) on conflict do nothing;
  else
    if (select count(*) from public.app_admins) <= 1 and exists (select 1 from public.app_admins where user_id = target) then
      raise exception 'o app precisa de pelo menos um administrador';
    end if;
    delete from public.app_admins where user_id = target;
  end if;
  perform public.admin_write_log(case when make then 'admin_add' else 'admin_remove' end, target, null);
end;
$$;
grant execute on function public.admin_set_admin(uuid, boolean) to authenticated;

-- Suspende uma conta (days null = permanente). Administradores não podem ser banidos (tire o cargo antes).
create or replace function public.admin_ban(target uuid, reason text, days integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.admin_guard();
  if target = auth.uid() then raise exception 'você não pode banir a si mesmo'; end if;
  if exists (select 1 from public.app_admins where user_id = target) then raise exception 'tire o cargo de administrador antes de banir'; end if;
  insert into public.app_bans (user_id, reason, banned_by, created_at, expires_at)
  values (target, left(coalesce(reason, ''), 300), auth.uid(), now(), case when days is null or days <= 0 then null else now() + make_interval(days => days) end)
  on conflict (user_id) do update set reason = excluded.reason, banned_by = excluded.banned_by, created_at = now(), expires_at = excluded.expires_at;
  -- some da lista de amigos online e dos convites pendentes
  delete from public.game_invites where from_user = target;
  perform public.admin_write_log('ban', target, jsonb_build_object('reason', left(coalesce(reason, ''), 300), 'days', days));
end;
$$;
grant execute on function public.admin_ban(uuid, text, integer) to authenticated;

create or replace function public.admin_unban(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.admin_guard();
  delete from public.app_bans where user_id = target;
  perform public.admin_write_log('unban', target, null);
end;
$$;
grant execute on function public.admin_unban(uuid) to authenticated;

-- Zera o uso da IA de hoje de um jogador.
create or replace function public.admin_reset_ai(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.admin_guard();
  delete from public.ai_usage where user_id = target and day = current_date;
  perform public.admin_write_log('ai_reset', target, null);
end;
$$;
grant execute on function public.admin_reset_ai(uuid) to authenticated;

-- Altera uma configuração ('announcement' = {"text","level"}; 'ai_daily_limit' = número). value null apaga.
create or replace function public.admin_set_config(k text, v jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.admin_guard();
  if k not in ('announcement', 'ai_daily_limit') then raise exception 'configuração desconhecida'; end if;
  if k = 'ai_daily_limit' and v is not null and (jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric < 0 or (v #>> '{}')::numeric > 10000) then
    raise exception 'limite inválido';
  end if;
  if k = 'announcement' and v is not null and char_length(coalesce(v ->> 'text', '')) > 600 then raise exception 'aviso longo demais'; end if;
  if v is null or (k = 'announcement' and coalesce(trim(v ->> 'text'), '') = '') then
    delete from public.app_config where key = k;
  else
    insert into public.app_config (key, value, updated_at, updated_by) values (k, v, now(), auth.uid())
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  end if;
  perform public.admin_write_log('config', null, jsonb_build_object('key', k, 'value', v));
end;
$$;
grant execute on function public.admin_set_config(text, jsonb) to authenticated;

-- Últimas ações dos administradores.
create or replace function public.admin_list_log(lim integer default 100)
returns table (id bigint, created_at timestamptz, admin_name text, action text, target_name text, details jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_guard();
  return query
  select l.id, l.created_at,
         coalesce(pa.username, pa.display_name, '?'),
         l.action,
         coalesce(pt.username, pt.display_name, (select u.email::text from auth.users u where u.id = l.target)),
         l.details
  from public.admin_log l
  left join public.profiles pa on pa.id = l.admin_id
  left join public.profiles pt on pt.id = l.target
  order by l.id desc
  limit least(greatest(lim, 1), 500);
end;
$$;
grant execute on function public.admin_list_log(integer) to authenticated;
