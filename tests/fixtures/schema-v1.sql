-- =====================================================================
--  VISTTO — schema do Supabase
--  Cole este arquivo inteiro em: Supabase › SQL Editor › New query › Run
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- tabelas ----------
create table if not exists clientes (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,          -- ex.: cliente-exemplo
  nome       text not null,                 -- Nome do cliente
  handle     text,                          -- @cliente
  bio        text,
  avatar_url text,
  token      text unique not null default encode(gen_random_bytes(12), 'hex'), -- vai no link do cliente
  created_at timestamptz default now()
);

create table if not exists meses (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  ano_mes    text not null,                 -- 2026-09
  titulo     text not null,                 -- Setembro 2026
  intro      text,
  publicado  boolean default false,         -- só aparece pro cliente quando true
  created_at timestamptz default now(),
  unique (cliente_id, ano_mes)
);

create table if not exists posts (
  id         uuid primary key default gen_random_uuid(),
  mes_id     uuid not null references meses(id) on delete cascade,
  ordem      int not null default 0,        -- ordem de postagem
  numero     text,                          -- "01"
  data       text,                          -- "09/10" (texto livre)
  tema       text,
  titulo     text,
  tipo       text not null default 'carousel' check (tipo in ('carousel','image','reel')),
  legenda    text,
  slides     jsonb not null default '[]',   -- ["https://.../p01-1.jpg", ...]
  video_url  text,
  capa_url   text,
  status     text not null default 'pendente' check (status in ('pendente','aprovado','ajuste')),
  created_at timestamptz default now()
);

create table if not exists destaques (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id) on delete cascade,
  ordem      int default 0,
  nome       text not null,
  capa_url   text
);

create table if not exists aprovacoes (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references posts(id) on delete cascade,
  acao       text not null check (acao in ('aprovado','ajuste','comentario')),
  comentario text,
  autor      text,
  origem     text default 'cliente',        -- cliente | agencia
  created_at timestamptz default now()
);

create index if not exists posts_mes_idx on posts(mes_id, ordem);
create index if not exists aprovacoes_post_idx on aprovacoes(post_id, created_at);

-- ---------- RLS ----------
-- Regra: usuário logado (você/admin) faz tudo. Anônimo (cliente) só entra pelas funções abaixo.
alter table clientes   enable row level security;
alter table meses      enable row level security;
alter table posts      enable row level security;
alter table destaques  enable row level security;
alter table aprovacoes enable row level security;

do $$ declare t text; begin
  foreach t in array array['clientes','meses','posts','destaques','aprovacoes'] loop
    execute format('drop policy if exists admin_all on %I', t);
    execute format('create policy admin_all on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------- storage ----------
insert into storage.buckets (id, name, public) values ('midia','midia', true)
  on conflict (id) do nothing;
drop policy if exists midia_public_read on storage.objects;
create policy midia_public_read on storage.objects for select using (bucket_id = 'midia');
drop policy if exists midia_admin_write on storage.objects;
create policy midia_admin_write on storage.objects for all to authenticated
  using (bucket_id = 'midia') with check (bucket_id = 'midia');

-- ---------- funções para o link do cliente (chamadas com a chave anon) ----------

-- Retorna tudo que a página precisa, só se o token bater e o mês estiver publicado.
create or replace function get_mes(p_token text, p_ano_mes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c clientes; m meses; result jsonb;
begin
  select * into c from clientes where token = p_token;
  if c.id is null then return null; end if;

  select * into m from meses
   where cliente_id = c.id and publicado
     and (p_ano_mes is null or ano_mes = p_ano_mes)
   order by ano_mes desc limit 1;
  if m.id is null then return jsonb_build_object('cliente', jsonb_build_object('nome', c.nome), 'mes', null); end if;

  select jsonb_build_object(
    'cliente', jsonb_build_object('nome', c.nome, 'handle', c.handle, 'bio', c.bio, 'avatar_url', c.avatar_url),
    'mes', jsonb_build_object('id', m.id, 'ano_mes', m.ano_mes, 'titulo', m.titulo, 'intro', m.intro),
    'meses', (select coalesce(jsonb_agg(jsonb_build_object('ano_mes', ano_mes, 'titulo', titulo) order by ano_mes desc), '[]')
                from meses where cliente_id = c.id and publicado),
    'destaques', (select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'capa_url', capa_url) order by ordem), '[]')
                    from destaques where cliente_id = c.id),
    'posts', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', p.id, 'ordem', p.ordem, 'numero', p.numero, 'data', p.data, 'tema', p.tema,
                'titulo', p.titulo, 'tipo', p.tipo, 'legenda', p.legenda, 'slides', p.slides,
                'video_url', p.video_url, 'capa_url', p.capa_url, 'status', p.status,
                'historico', (select coalesce(jsonb_agg(jsonb_build_object(
                                'acao', a.acao, 'comentario', a.comentario, 'autor', a.autor,
                                'origem', a.origem, 'created_at', a.created_at) order by a.created_at), '[]')
                              from aprovacoes a where a.post_id = p.id)
              ) order by p.ordem), '[]') from posts p where p.mes_id = m.id)
  ) into result;
  return result;
end $$;

-- Cliente aprova / pede ajuste / comenta. Valida o token contra o post.
create or replace function registrar_aprovacao(p_token text, p_post_id uuid, p_acao text, p_comentario text default null, p_autor text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  select exists (
    select 1 from posts p join meses m on m.id = p.mes_id join clientes c on c.id = m.cliente_id
     where p.id = p_post_id and c.token = p_token and m.publicado
  ) into ok;
  if not ok then raise exception 'token inválido'; end if;
  if p_acao not in ('aprovado','ajuste','comentario') then raise exception 'ação inválida'; end if;
  if p_acao = 'ajuste' and coalesce(trim(p_comentario),'') = '' then raise exception 'descreva o ajuste'; end if;

  insert into aprovacoes (post_id, acao, comentario, autor, origem)
    values (p_post_id, p_acao, nullif(trim(p_comentario),''), nullif(trim(p_autor),''), 'cliente');
  if p_acao in ('aprovado','ajuste') then
    update posts set status = p_acao where id = p_post_id;
  end if;
  return jsonb_build_object('ok', true, 'status', (select status from posts where id = p_post_id));
end $$;

grant execute on function get_mes(text, text) to anon, authenticated;
grant execute on function registrar_aprovacao(text, uuid, text, text, text) to anon, authenticated;

-- ---------- opcional: avisar você quando o cliente responder ----------
-- Supabase › Database › Webhooks › Create: table aprovacoes, event INSERT,
-- URL do seu cenário no Make/Zapier/n8n → manda WhatsApp/e-mail.
