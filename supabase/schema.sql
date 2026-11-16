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

drop policy if exists "profiles: criar o próprio" on public.profiles;
create policy "profiles: criar o próprio" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles: alterar o próprio" on public.profiles;
create policy "profiles: alterar o próprio" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

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
