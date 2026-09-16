-- INSTALAÇÃO NOVA APENAS. No projeto atual, multi-agencias.sql, hierarquia.sql, squads.sql, convites.sql, divisoes.sql e gestores.sql já foram aplicadas.
begin;
-- =====================================================================
--  VISTTO — schema do Supabase
--  Cole este arquivo inteiro em: Supabase › SQL Editor › New query › Run
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- tabelas ----------
create table if not exists clientes (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,          -- ex.: cliente-exemplo
  nome       text not null,                 -- Nome do cliente
  handle     text,                          -- @cliente
  bio        text,
  avatar_url text,
  token      text unique not null default encode(extensions.gen_random_bytes(12), 'hex'), -- vai no link do cliente
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

-- Executar uma vez, depois do schema original. Migração transacional, sem excluir conteúdo.
create table public.agencias(id uuid primary key default gen_random_uuid(),slug text unique not null,nome text not null);
insert into public.agencias(id,slug,nome) values
 ('10000000-0000-4000-8000-000000000001','agencia-1','Agência 1'),
 ('10000000-0000-4000-8000-000000000002','agencia-2','Agência 2');
create table public.administradores(usuario_id uuid primary key references auth.users(id) on delete cascade);
create table public.agencia_usuarios(agencia_id uuid references public.agencias(id) on delete cascade,usuario_id uuid references auth.users(id) on delete cascade,primary key(agencia_id,usuario_id));
alter table public.agencias enable row level security;
alter table public.administradores enable row level security;
alter table public.agencia_usuarios enable row level security;
revoke all on public.agencias,public.administradores,public.agencia_usuarios from anon,authenticated;
grant select on public.agencias,public.agencia_usuarios to authenticated;
alter table public.clientes add column agencia_id uuid not null default '10000000-0000-4000-8000-000000000001' references public.agencias(id);
alter table public.clientes alter column agencia_id drop default;
alter table public.clientes drop constraint clientes_slug_key;
alter table public.clientes add unique(agencia_id,slug);
alter table public.clientes alter column token set default encode(extensions.gen_random_bytes(32),'hex');
create index on public.clientes(agencia_id);
create index on public.agencia_usuarios(usuario_id);
create function public.e_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.administradores where usuario_id=auth.uid());
$$;
create function public.pode_agencia(a uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.e_admin() or exists(select 1 from public.agencia_usuarios where agencia_id=a and usuario_id=auth.uid());
$$;
revoke all on function public.e_admin(),public.pode_agencia(uuid) from public;
grant execute on function public.e_admin(),public.pode_agencia(uuid) to authenticated;
create policy agencia_leitura on public.agencias for select to authenticated using(public.pode_agencia(id));
create policy membros_leitura on public.agencia_usuarios for select to authenticated using(public.e_admin() or usuario_id=auth.uid());
do $$ declare t text; begin
 foreach t in array array['clientes','meses','posts','destaques','aprovacoes'] loop
   execute format('drop policy if exists admin_all on public.%I',t);
   execute format('revoke all on public.%I from anon,authenticated',t);
   execute format('grant select,insert,update,delete on public.%I to authenticated',t);
 end loop;
end $$;
create policy clientes_agencia on public.clientes for all to authenticated using(public.pode_agencia(agencia_id)) with check(public.pode_agencia(agencia_id));
create policy meses_agencia on public.meses for all to authenticated using(exists(select 1 from public.clientes c where c.id=cliente_id)) with check(exists(select 1 from public.clientes c where c.id=cliente_id));
create policy posts_agencia on public.posts for all to authenticated using(exists(select 1 from public.meses m where m.id=mes_id)) with check(exists(select 1 from public.meses m where m.id=mes_id));
create policy destaques_agencia on public.destaques for all to authenticated using(exists(select 1 from public.clientes c where c.id=cliente_id)) with check(exists(select 1 from public.clientes c where c.id=cliente_id));
create policy aprovacoes_agencia on public.aprovacoes for select to authenticated using(exists(select 1 from public.posts p where p.id=post_id));
revoke insert,update,delete on public.aprovacoes from authenticated;

create function public.meu_contexto() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('superadmin',public.e_admin(),'agencias',coalesce((select jsonb_agg(to_jsonb(a) order by a.nome) from public.agencias a where public.pode_agencia(a.id)),'[]'::jsonb));
$$;
create function public.listar_acessos(p_agencia uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.e_admin() then raise exception 'Acesso negado';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('usuario_id',u.id,'email',u.email)) from public.agencia_usuarios m join auth.users u on u.id=m.usuario_id where m.agencia_id=p_agencia),'[]'::jsonb);
end $$;
create function public.autorizar_acesso(p_agencia uuid,p_email text) returns void language plpgsql security definer set search_path='' as $$
declare u uuid; begin
 if not public.e_admin() then raise exception 'Acesso negado';end if;
 select id into u from auth.users where lower(email)=lower(trim(p_email)) and email_confirmed_at is not null;
 if u is null then raise exception 'A pessoa precisa criar o acesso e confirmar o e-mail primeiro.';end if;
 insert into public.agencia_usuarios values(p_agencia,u) on conflict do nothing;
end $$;
create function public.revogar_acesso(p_agencia uuid,p_usuario uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.e_admin() then raise exception 'Acesso negado';end if;
 delete from public.agencia_usuarios where agencia_id=p_agencia and usuario_id=p_usuario;
end $$;
create function public.renovar_link(p_cliente uuid) returns text language plpgsql security definer set search_path='public' as $$
declare t text; begin
 if not exists(select 1 from clientes where id=p_cliente and pode_agencia(agencia_id)) then raise exception 'Acesso negado';end if;
 t:=encode(extensions.gen_random_bytes(32),'hex'); update clientes set token=t where id=p_cliente;return t;
end $$;
create function public.marcar_ajustado(p_post uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.posts p join public.meses m on m.id=p.mes_id join public.clientes c on c.id=m.cliente_id where p.id=p_post and public.pode_agencia(c.agencia_id)) then raise exception 'Acesso negado';end if;
 update public.posts set status='pendente' where id=p_post;
 insert into public.aprovacoes(post_id,acao,comentario,autor,origem) values(p_post,'comentario','Ajuste aplicado. Nova versão disponível para aprovação.','Agência','agencia');
end $$;
revoke all on function public.meu_contexto(),public.listar_acessos(uuid),public.autorizar_acesso(uuid,text),public.revogar_acesso(uuid,uuid),public.renovar_link(uuid),public.marcar_ajustado(uuid) from public;
grant execute on function public.meu_contexto(),public.listar_acessos(uuid),public.autorizar_acesso(uuid,text),public.revogar_acesso(uuid,uuid),public.renovar_link(uuid),public.marcar_ajustado(uuid) to authenticated;

-- Cada objeto privado pertence à agência que o enviou. Referências antigas são preservadas.
create function public.midia_path(v text) returns text language sql immutable set search_path='' as $$
 select case when v like 'midia:%' then substr(v,7) when v like 'https://vbiebfcbzproffkrkluy.supabase.co/storage/v1/object/public/midia/%' then split_part(v,'/storage/v1/object/public/midia/',2) else null end;
$$;
create table public.midia_legada(path text primary key,agencia_id uuid not null references public.agencias(id));
alter table public.midia_legada enable row level security;
revoke all on public.midia_legada from anon,authenticated;
insert into public.midia_legada select name,'10000000-0000-4000-8000-000000000001'::uuid from storage.objects where bucket_id='midia';
create function public.midia_da_agencia(v text,a uuid) returns boolean language sql stable security definer set search_path='' as $$
 select v is null or v='' or split_part(public.midia_path(v),'/',1)=a::text or exists(select 1 from public.midia_legada l where l.path=public.midia_path(v) and l.agencia_id=a);
$$;
create function public.validar_midia() returns trigger language plpgsql security definer set search_path='' as $$
declare a uuid;v text; vals text[];begin
 if tg_table_name='clientes' then
  a:=new.agencia_id; vals:=array[new.avatar_url];
  if tg_op='UPDATE' and old.agencia_id<>new.agencia_id then raise exception 'Não é permitido transferir clientes entre agências';end if;
 elsif tg_table_name='destaques' then
  select agencia_id into a from public.clientes where id=new.cliente_id;vals:=array[new.capa_url];
 else
  select c.agencia_id into a from public.clientes c join public.meses m on c.id=m.cliente_id where m.id=new.mes_id;
  if jsonb_typeof(new.slides)<>'array' then raise exception 'Slides inválidos';end if;
  vals:=array[new.capa_url,new.video_url]||array(select jsonb_array_elements_text(new.slides));
 end if;
 foreach v in array vals loop
  if not public.midia_da_agencia(v,a) then
   -- Uma edição de texto pode preservar uma referência externa já existente.
   if tg_op='UPDATE' and (to_jsonb(old)=to_jsonb(new) or
     (tg_table_name='clientes' and to_jsonb(old)->'avatar_url'=to_jsonb(new)->'avatar_url') or
     (tg_table_name='destaques' and to_jsonb(old)->'capa_url'=to_jsonb(new)->'capa_url') or
     (tg_table_name='posts' and to_jsonb(old)->'slides'=to_jsonb(new)->'slides' and to_jsonb(old)->'video_url'=to_jsonb(new)->'video_url' and to_jsonb(old)->'capa_url'=to_jsonb(new)->'capa_url')) then continue;end if;
   raise exception 'Envie a mídia pelo painel desta agência.';
  end if;
 end loop; return new;
end $$;
create trigger validar_cliente before insert or update on public.clientes for each row execute function public.validar_midia();
create trigger validar_destaque before insert or update on public.destaques for each row execute function public.validar_midia();
create trigger validar_post before insert or update on public.posts for each row execute function public.validar_midia();
create function public.pode_midia(n text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.agencias a where public.pode_agencia(a.id) and (split_part(n,'/',1)=a.id::text or exists(select 1 from public.midia_legada l where l.path=n and l.agencia_id=a.id)));
$$;
revoke all on function public.midia_da_agencia(text,uuid),public.validar_midia(),public.pode_midia(text) from public;
grant execute on function public.pode_midia(text) to authenticated;
drop policy if exists midia_public_read on storage.objects;
drop policy if exists midia_admin_write on storage.objects;
update storage.buckets set public=false where id='midia';
create policy midia_agencia_read on storage.objects for select to authenticated using(bucket_id='midia' and public.pode_midia(name));
create policy midia_agencia_insert on storage.objects for insert to authenticated with check(bucket_id='midia' and exists(select 1 from public.agencias a where split_part(name,'/',1)=a.id::text and public.pode_agencia(a.id)));
-- Sem sobrescrita: uma revisão sempre cria um novo arquivo e mantém o histórico.

-- get_mes e registrar_aprovacao são substituídas abaixo pela versão compatível.

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
  if m.id is null then return jsonb_build_object('cliente', jsonb_build_object('nome', c.nome), 'mes', null, 'agencia', (select to_jsonb(a) from agencias a where a.id=c.agencia_id)); end if;

  select jsonb_build_object(
    'agencia', (select to_jsonb(a) from agencias a where a.id=c.agencia_id),
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
  if p_acao in ('ajuste','comentario') and coalesce(trim(p_comentario),'') = '' then raise exception 'descreva o ajuste'; end if;

  if length(p_comentario)>10000 or length(p_autor)>150 then raise exception 'Texto muito longo'; end if;
  insert into aprovacoes (post_id, acao, comentario, autor, origem)
    values (p_post_id, p_acao, nullif(trim(p_comentario),''), nullif(trim(p_autor),''), 'cliente');
  if p_acao in ('aprovado','ajuste') then
    update posts set status = p_acao where id = p_post_id;
  end if;
  return jsonb_build_object('ok', true, 'status', (select status from posts where id = p_post_id));
end $$;

grant execute on function get_mes(text, text) to anon, authenticated;
grant execute on function registrar_aprovacao(text, uuid, text, text, text) to anon, authenticated;


revoke all on function get_mes(text,text) from public,anon,authenticated;
revoke all on function registrar_aprovacao(text,uuid,text,text,text) from public;
grant execute on function get_mes(text,text) to service_role;
grant execute on function registrar_aprovacao(text,uuid,text,text,text) to anon,authenticated;

-- ---------- hierarquia ----------

alter table public.agencia_usuarios
  add column papel text not null default 'designer'
    check (papel in ('dono','socio','head','designer','editor_video','social_media','gestor_trafego')),
  add column nome text check (char_length(nome) <= 80),
  add column criado_por uuid references auth.users(id) on delete set null,
  add column created_at timestamptz not null default now();
alter table public.agencia_usuarios alter column papel drop default;

create function public.nivel_papel(p text) returns int language sql immutable set search_path='' as $$
 select case p when 'dono' then 3 when 'socio' then 3 when 'head' then 2
   when 'designer' then 1 when 'editor_video' then 1 when 'social_media' then 1 when 'gestor_trafego' then 1 else 0 end;
$$;
create function public.meu_nivel(a uuid) returns int language sql stable security definer set search_path='' as $$
 select case when public.e_admin() then 4 else coalesce((
   select public.nivel_papel(m.papel) from public.agencia_usuarios m where m.agencia_id=a and m.usuario_id=auth.uid()),0) end;
$$;
create function public.pode_gerir(a uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.meu_nivel(a) >= 2;
$$;
create function public.agencia_do_cliente(c uuid) returns uuid language sql stable security definer set search_path='' as $$
 select agencia_id from public.clientes where id=c;
$$;
create function public.agencia_do_mes(m uuid) returns uuid language sql stable security definer set search_path='' as $$
 select c.agencia_id from public.meses x join public.clientes c on c.id=x.cliente_id where x.id=m;
$$;
revoke all on function public.nivel_papel(text),public.meu_nivel(uuid),public.pode_gerir(uuid),public.agencia_do_cliente(uuid),public.agencia_do_mes(uuid) from public;
grant execute on function public.nivel_papel(text),public.meu_nivel(uuid),public.pode_gerir(uuid),public.agencia_do_cliente(uuid),public.agencia_do_mes(uuid) to authenticated;

-- Clientes: toda a agência vê; só Head+ cria, edita ou exclui. O token do link fica oculto para a equipe.
drop policy clientes_agencia on public.clientes;
create policy clientes_ler on public.clientes for select to authenticated using (public.pode_agencia(agencia_id));
create policy clientes_criar on public.clientes for insert to authenticated with check (public.pode_gerir(agencia_id));
create policy clientes_editar on public.clientes for update to authenticated using (public.pode_gerir(agencia_id)) with check (public.pode_gerir(agencia_id));
create policy clientes_excluir on public.clientes for delete to authenticated using (public.pode_gerir(agencia_id));
revoke select on public.clientes from authenticated;
grant select (id,agencia_id,slug,nome,handle,bio,avatar_url,created_at) on public.clientes to authenticated;

-- Destaques fazem parte do cadastro do cliente.
drop policy destaques_agencia on public.destaques;
create policy destaques_ler on public.destaques for select to authenticated using (exists(select 1 from public.clientes c where c.id=cliente_id));
create policy destaques_criar on public.destaques for insert to authenticated with check (public.pode_gerir(public.agencia_do_cliente(cliente_id)));
create policy destaques_editar on public.destaques for update to authenticated using (public.pode_gerir(public.agencia_do_cliente(cliente_id))) with check (public.pode_gerir(public.agencia_do_cliente(cliente_id)));
create policy destaques_excluir on public.destaques for delete to authenticated using (public.pode_gerir(public.agencia_do_cliente(cliente_id)));

-- Meses: a equipe cria e edita; publicar e excluir é Head+.
drop policy meses_agencia on public.meses;
create policy meses_ler on public.meses for select to authenticated using (exists(select 1 from public.clientes c where c.id=cliente_id));
create policy meses_criar on public.meses for insert to authenticated with check (exists(select 1 from public.clientes c where c.id=cliente_id));
create policy meses_editar on public.meses for update to authenticated using (exists(select 1 from public.clientes c where c.id=cliente_id)) with check (exists(select 1 from public.clientes c where c.id=cliente_id));
create policy meses_excluir on public.meses for delete to authenticated using (public.pode_gerir(public.agencia_do_cliente(cliente_id)));
create function public.proteger_publicacao() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then return new; end if;
 if (tg_op='INSERT' and new.publicado) or (tg_op='UPDATE' and new.publicado is distinct from old.publicado) then
   if not public.pode_gerir(public.agencia_do_cliente(new.cliente_id)) then raise exception 'Somente Head, sócios e donos publicam o mês.'; end if;
 end if;
 return new;
end $$;
create trigger proteger_publicacao before insert or update on public.meses for each row execute function public.proteger_publicacao();

-- Posts: a equipe cria, edita e reordena; excluir é Head+. O status só muda pela resposta do cliente ou por "marcar como ajustado".
drop policy posts_agencia on public.posts;
create policy posts_ler on public.posts for select to authenticated using (exists(select 1 from public.meses m where m.id=mes_id));
create policy posts_criar on public.posts for insert to authenticated with check (exists(select 1 from public.meses m where m.id=mes_id));
create policy posts_editar on public.posts for update to authenticated using (exists(select 1 from public.meses m where m.id=mes_id)) with check (exists(select 1 from public.meses m where m.id=mes_id));
create policy posts_excluir on public.posts for delete to authenticated using (public.pode_gerir(public.agencia_do_mes(mes_id)));
create function public.proteger_status() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or current_setting('vistto.status_ok',true)='1' then return new; end if;
 if (tg_op='INSERT' and new.status<>'pendente') or (tg_op='UPDATE' and new.status is distinct from old.status) then
   raise exception 'O status muda só pela resposta do cliente.';
 end if;
 return new;
end $$;
create trigger proteger_status before insert or update on public.posts for each row execute function public.proteger_status();

-- Links do cliente: só Head+.
create or replace function public.renovar_link(p_cliente uuid) returns text language plpgsql security definer set search_path='public' as $$
declare t text; begin
 if not public.pode_gerir(public.agencia_do_cliente(p_cliente)) then raise exception 'Acesso negado'; end if;
 t:=encode(extensions.gen_random_bytes(32),'hex'); update clientes set token=t where id=p_cliente; return t;
end $$;
create function public.link_cliente(p_cliente uuid) returns text language plpgsql stable security definer set search_path='' as $$
begin
 if not public.pode_gerir(public.agencia_do_cliente(p_cliente)) then raise exception 'Acesso negado'; end if;
 return (select token from public.clientes where id=p_cliente);
end $$;

create or replace function public.marcar_ajustado(p_post uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.posts p join public.meses m on m.id=p.mes_id join public.clientes c on c.id=m.cliente_id where p.id=p_post and public.pode_agencia(c.agencia_id)) then raise exception 'Acesso negado'; end if;
 perform set_config('vistto.status_ok','1',true);
 update public.posts set status='pendente' where id=p_post;
 perform set_config('vistto.status_ok','',true);
 insert into public.aprovacoes(post_id,acao,comentario,autor,origem) values(p_post,'comentario','Ajuste aplicado. Nova versão disponível para aprovação.','Agência','agencia');
end $$;

create or replace function public.registrar_aprovacao(p_token text, p_post_id uuid, p_acao text, p_comentario text default null, p_autor text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  select exists (
    select 1 from posts p join meses m on m.id = p.mes_id join clientes c on c.id = m.cliente_id
     where p.id = p_post_id and c.token = p_token and m.publicado
  ) into ok;
  if not ok then raise exception 'token inválido'; end if;
  if p_acao not in ('aprovado','ajuste','comentario') then raise exception 'ação inválida'; end if;
  if p_acao in ('ajuste','comentario') and coalesce(trim(p_comentario),'') = '' then raise exception 'descreva o ajuste'; end if;
  if length(p_comentario)>10000 or length(p_autor)>150 then raise exception 'Texto muito longo'; end if;
  insert into aprovacoes (post_id, acao, comentario, autor, origem)
    values (p_post_id, p_acao, nullif(trim(p_comentario),''), nullif(trim(p_autor),''), 'cliente');
  if p_acao in ('aprovado','ajuste') then
    perform set_config('vistto.status_ok','1',true);
    update posts set status = p_acao where id = p_post_id;
    perform set_config('vistto.status_ok','',true);
  end if;
  return jsonb_build_object('ok', true, 'status', (select status from posts where id = p_post_id));
end $$;

-- Contexto e gestão de acessos.
create or replace function public.meu_contexto() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('superadmin',public.e_admin(),'agencias',coalesce((
   select jsonb_agg(jsonb_build_object('id',a.id,'slug',a.slug,'nome',a.nome,
     'papel',case when public.e_admin() then 'admin' else (select m.papel from public.agencia_usuarios m where m.agencia_id=a.id and m.usuario_id=auth.uid()) end,
     'nivel',public.meu_nivel(a.id)) order by a.nome)
   from public.agencias a where public.pode_agencia(a.id)),'[]'::jsonb));
$$;

drop function public.listar_acessos(uuid);
create function public.listar_acessos(p_agencia uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare n int := public.meu_nivel(p_agencia);
begin
 if n < 2 then raise exception 'Acesso negado'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('usuario_id',u.id,'email',u.email,'nome',m.nome,'papel',m.papel,
     'pode_gerir',public.nivel_papel(m.papel) < n) order by public.nivel_papel(m.papel) desc, u.email)
   from public.agencia_usuarios m join auth.users u on u.id=m.usuario_id where m.agencia_id=p_agencia),'[]'::jsonb);
end $$;

drop function public.autorizar_acesso(uuid,text);
create function public.autorizar_acesso(p_agencia uuid,p_email text,p_papel text,p_nome text default null) returns void language plpgsql security definer set search_path='' as $$
declare n int := public.meu_nivel(p_agencia); u uuid; atual text;
begin
 if n < 2 or public.nivel_papel(p_papel) = 0 or public.nivel_papel(p_papel) >= n then raise exception 'Você não pode atribuir esse papel.'; end if;
 select id into u from auth.users where lower(email)=lower(trim(p_email)) and email_confirmed_at is not null;
 if u is null or exists(select 1 from public.administradores where usuario_id=u) then raise exception 'Não foi possível autorizar este e-mail.'; end if;
 select papel into atual from public.agencia_usuarios where agencia_id=p_agencia and usuario_id=u;
 if atual is not null and public.nivel_papel(atual) >= n then raise exception 'Não foi possível autorizar este e-mail.'; end if;
 if atual is null and not public.e_admin() and exists(select 1 from public.agencia_usuarios where usuario_id=u) then
   raise exception 'Não foi possível autorizar este e-mail.';
 end if;
 insert into public.agencia_usuarios(agencia_id,usuario_id,papel,nome,criado_por) values(p_agencia,u,p_papel,nullif(trim(p_nome),''),auth.uid())
 on conflict (agencia_id,usuario_id) do update set papel=excluded.papel, nome=coalesce(excluded.nome,public.agencia_usuarios.nome);
end $$;

create or replace function public.revogar_acesso(p_agencia uuid,p_usuario uuid) returns void language plpgsql security definer set search_path='' as $$
declare n int := public.meu_nivel(p_agencia); atual text;
begin
 select papel into atual from public.agencia_usuarios where agencia_id=p_agencia and usuario_id=p_usuario;
 if n < 2 or atual is null or public.nivel_papel(atual) >= n then raise exception 'Acesso negado'; end if;
 delete from public.agencia_usuarios where agencia_id=p_agencia and usuario_id=p_usuario;
end $$;

create function public.alterar_papel(p_agencia uuid,p_usuario uuid,p_papel text) returns void language plpgsql security definer set search_path='' as $$
declare n int := public.meu_nivel(p_agencia); atual text;
begin
 select papel into atual from public.agencia_usuarios where agencia_id=p_agencia and usuario_id=p_usuario;
 if n < 2 or atual is null or public.nivel_papel(atual) >= n or public.nivel_papel(p_papel) = 0 or public.nivel_papel(p_papel) >= n then
   raise exception 'Você não pode atribuir esse papel.';
 end if;
 update public.agencia_usuarios set papel=p_papel where agencia_id=p_agencia and usuario_id=p_usuario;
end $$;

revoke all on function public.proteger_publicacao(),public.proteger_status() from public,anon,authenticated;
revoke execute on function public.nivel_papel(text),public.meu_nivel(uuid),public.pode_gerir(uuid),public.agencia_do_cliente(uuid),public.agencia_do_mes(uuid) from anon;
revoke all on function public.link_cliente(uuid),public.listar_acessos(uuid),public.autorizar_acesso(uuid,text,text,text),public.alterar_papel(uuid,uuid,text),public.meu_contexto(),public.revogar_acesso(uuid,uuid),public.renovar_link(uuid),public.marcar_ajustado(uuid) from public,anon;
grant execute on function public.link_cliente(uuid),public.listar_acessos(uuid),public.autorizar_acesso(uuid,text,text,text),public.alterar_papel(uuid,uuid,text),public.meu_contexto(),public.revogar_acesso(uuid,uuid),public.renovar_link(uuid),public.marcar_ajustado(uuid) to authenticated;
revoke all on function public.registrar_aprovacao(text,uuid,text,text,text) from public;
grant execute on function public.registrar_aprovacao(text,uuid,text,text,text) to anon,authenticated;

-- ---------- squads ----------

create table public.squads(
  id uuid primary key default gen_random_uuid(),
  agencia_id uuid not null references public.agencias(id) on delete cascade,
  nome text not null check (char_length(trim(nome)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (agencia_id, nome)
);
create table public.squad_membros(
  squad_id uuid not null references public.squads(id) on delete cascade,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (squad_id, usuario_id)
);
create index on public.squad_membros(usuario_id);
alter table public.squads enable row level security;
alter table public.squad_membros enable row level security;
revoke all on public.squads, public.squad_membros from anon, authenticated;
grant select on public.squads to authenticated;

alter table public.clientes add column squad_id uuid references public.squads(id) on delete set null;
create index on public.clientes(squad_id);
grant select (squad_id) on public.clientes to authenticated;

create function public.no_squad(s uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.squad_membros where squad_id=s and usuario_id=auth.uid());
$$;
create function public.pode_ver(a uuid, s uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.meu_nivel(a) >= 3 or (public.meu_nivel(a) >= 1 and s is not null and public.no_squad(s));
$$;
create function public.pode_gerir_em(a uuid, s uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.meu_nivel(a) >= 3 or (public.meu_nivel(a) = 2 and s is not null and public.no_squad(s));
$$;
create function public.pode_ver_cliente(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select public.pode_ver(agencia_id, squad_id) from public.clientes where id=c), false);
$$;
create function public.pode_gerir_cliente(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select public.pode_gerir_em(agencia_id, squad_id) from public.clientes where id=c), false);
$$;
revoke all on function public.no_squad(uuid),public.pode_ver(uuid,uuid),public.pode_gerir_em(uuid,uuid),public.pode_ver_cliente(uuid),public.pode_gerir_cliente(uuid) from public, anon;
grant execute on function public.no_squad(uuid),public.pode_ver(uuid,uuid),public.pode_gerir_em(uuid,uuid),public.pode_ver_cliente(uuid),public.pode_gerir_cliente(uuid) to authenticated;

create policy squads_ler on public.squads for select to authenticated using (public.pode_ver(agencia_id, id));

-- O squad do cliente precisa ser da mesma agência.
create function public.validar_squad_cliente() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.squad_id is not null and not exists(select 1 from public.squads where id=new.squad_id and agencia_id=new.agencia_id) then
   raise exception 'Squad inválido para esta agência.';
 end if;
 return new;
end $$;
create trigger validar_squad_cliente before insert or update on public.clientes for each row execute function public.validar_squad_cliente();

-- Membro de squad precisa pertencer à agência; ao sair da agência, sai dos squads dela.
create function public.validar_membro_squad() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.squads s join public.agencia_usuarios m on m.agencia_id=s.agencia_id where s.id=new.squad_id and m.usuario_id=new.usuario_id) then
   raise exception 'A pessoa precisa fazer parte da agência antes de entrar no squad.';
 end if;
 return new;
end $$;
create trigger validar_membro_squad before insert or update on public.squad_membros for each row execute function public.validar_membro_squad();
create function public.limpar_squads() returns trigger language plpgsql security definer set search_path='' as $$
begin
 delete from public.squad_membros sm using public.squads s where s.id=sm.squad_id and s.agencia_id=old.agencia_id and sm.usuario_id=old.usuario_id;
 return old;
end $$;
create trigger limpar_squads after delete on public.agencia_usuarios for each row execute function public.limpar_squads();
revoke all on function public.validar_squad_cliente(),public.validar_membro_squad(),public.limpar_squads() from public, anon, authenticated;

-- Clientes por squad.
drop policy clientes_ler on public.clientes;
drop policy clientes_criar on public.clientes;
drop policy clientes_editar on public.clientes;
drop policy clientes_excluir on public.clientes;
create policy clientes_ler on public.clientes for select to authenticated using (public.pode_ver(agencia_id, squad_id));
create policy clientes_criar on public.clientes for insert to authenticated with check (public.pode_gerir_em(agencia_id, squad_id));
create policy clientes_editar on public.clientes for update to authenticated using (public.pode_gerir_em(agencia_id, squad_id)) with check (public.pode_gerir_em(agencia_id, squad_id));
create policy clientes_excluir on public.clientes for delete to authenticated using (public.pode_gerir_em(agencia_id, squad_id));

drop policy destaques_criar on public.destaques;
drop policy destaques_editar on public.destaques;
drop policy destaques_excluir on public.destaques;
create policy destaques_criar on public.destaques for insert to authenticated with check (public.pode_gerir_cliente(cliente_id));
create policy destaques_editar on public.destaques for update to authenticated using (public.pode_gerir_cliente(cliente_id)) with check (public.pode_gerir_cliente(cliente_id));
create policy destaques_excluir on public.destaques for delete to authenticated using (public.pode_gerir_cliente(cliente_id));
drop policy meses_excluir on public.meses;
create policy meses_excluir on public.meses for delete to authenticated using (public.pode_gerir_cliente(cliente_id));
drop policy posts_excluir on public.posts;
create policy posts_excluir on public.posts for delete to authenticated using (public.pode_gerir_cliente((select m.cliente_id from public.meses m where m.id=mes_id)));

create or replace function public.proteger_publicacao() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then return new; end if;
 if (tg_op='INSERT' and new.publicado) or (tg_op='UPDATE' and new.publicado is distinct from old.publicado) then
   if not public.pode_gerir_cliente(new.cliente_id) then raise exception 'Somente Head do squad, sócios e donos publicam o mês.'; end if;
 end if;
 return new;
end $$;
create or replace function public.renovar_link(p_cliente uuid) returns text language plpgsql security definer set search_path='public' as $$
declare t text; begin
 if not public.pode_gerir_cliente(p_cliente) then raise exception 'Acesso negado'; end if;
 t:=encode(extensions.gen_random_bytes(32),'hex'); update clientes set token=t where id=p_cliente; return t;
end $$;
create or replace function public.link_cliente(p_cliente uuid) returns text language plpgsql stable security definer set search_path='' as $$
begin
 if not public.pode_gerir_cliente(p_cliente) then raise exception 'Acesso negado'; end if;
 return (select token from public.clientes where id=p_cliente);
end $$;
create or replace function public.marcar_ajustado(p_post uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.posts p join public.meses m on m.id=p.mes_id where p.id=p_post and public.pode_ver_cliente(m.cliente_id)) then raise exception 'Acesso negado'; end if;
 perform set_config('vistto.status_ok','1',true);
 update public.posts set status='pendente' where id=p_post;
 perform set_config('vistto.status_ok','',true);
 insert into public.aprovacoes(post_id,acao,comentario,autor,origem) values(p_post,'comentario','Ajuste aplicado. Nova versão disponível para aprovação.','Agência','agencia');
end $$;

-- Mídia: dono/sócio veem a agência inteira; os demais, só arquivos que enviaram ou que estão em clientes que enxergam.
create or replace function public.pode_midia(n text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.agencias a where (split_part(n,'/',1)=a.id::text or exists(select 1 from public.midia_legada l where l.path=n and l.agencia_id=a.id))
   and (public.meu_nivel(a.id) >= 3 or (public.meu_nivel(a.id) >= 1 and (
     exists(select 1 from public.posts p join public.meses m on m.id=p.mes_id join public.clientes c on c.id=m.cliente_id
            where c.agencia_id=a.id and public.pode_ver(c.agencia_id,c.squad_id)
              and (('midia:'||n) in (p.capa_url,p.video_url) or p.slides ? ('midia:'||n)))
     or exists(select 1 from public.clientes c where c.agencia_id=a.id and c.avatar_url=('midia:'||n) and public.pode_ver(c.agencia_id,c.squad_id))
     or exists(select 1 from public.destaques d join public.clientes c on c.id=d.cliente_id where c.agencia_id=a.id and d.capa_url=('midia:'||n) and public.pode_ver(c.agencia_id,c.squad_id))
   ))));
$$;
drop policy midia_agencia_read on storage.objects;
create policy midia_agencia_read on storage.objects for select to authenticated using (bucket_id='midia' and (owner_id = auth.uid()::text or public.pode_midia(name)));

-- Acessos com squads.
create function public.divide_squad(a uuid, u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.squad_membros x join public.squad_membros y on y.squad_id=x.squad_id join public.squads s on s.id=x.squad_id
   where s.agencia_id=a and x.usuario_id=auth.uid() and y.usuario_id=u);
$$;
create function public.pode_gerir_pessoa(a uuid, u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select public.nivel_papel(m.papel) < public.meu_nivel(a)
     and (public.meu_nivel(a) >= 3 or (public.meu_nivel(a) = 2 and public.divide_squad(a,u)))
   from public.agencia_usuarios m where m.agencia_id=a and m.usuario_id=u), false);
$$;
revoke all on function public.divide_squad(uuid,uuid),public.pode_gerir_pessoa(uuid,uuid) from public, anon;
grant execute on function public.divide_squad(uuid,uuid),public.pode_gerir_pessoa(uuid,uuid) to authenticated;

create or replace function public.listar_acessos(p_agencia uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare n int := public.meu_nivel(p_agencia);
begin
 if n < 2 then raise exception 'Acesso negado'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('usuario_id',u.id,'email',u.email,'nome',m.nome,'papel',m.papel,
     'pode_gerir',public.pode_gerir_pessoa(p_agencia,u.id),
     'squads',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'nome',s.nome) order by s.nome) from public.squad_membros sm join public.squads s on s.id=sm.squad_id where sm.usuario_id=u.id and s.agencia_id=p_agencia and public.pode_ver(p_agencia,s.id)),'[]'::jsonb))
     order by public.nivel_papel(m.papel) desc, coalesce(m.nome,u.email))
   from public.agencia_usuarios m join auth.users u on u.id=m.usuario_id
   where m.agencia_id=p_agencia and (n >= 3 or u.id=auth.uid() or public.divide_squad(p_agencia,u.id))),'[]'::jsonb);
end $$;

drop function public.autorizar_acesso(uuid,text,text,text);
create function public.autorizar_acesso(p_agencia uuid,p_email text,p_papel text,p_nome text default null,p_squad uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare n int := public.meu_nivel(p_agencia); u uuid; atual text;
begin
 if n < 2 or public.nivel_papel(p_papel) = 0 or public.nivel_papel(p_papel) >= n then raise exception 'Você não pode atribuir esse papel.'; end if;
 if p_squad is not null and not exists(select 1 from public.squads where id=p_squad and agencia_id=p_agencia) then raise exception 'Squad inválido.'; end if;
 if n = 2 and (p_squad is null or not public.no_squad(p_squad)) then raise exception 'Escolha um dos seus squads.'; end if;
 select id into u from auth.users where lower(email)=lower(trim(p_email)) and email_confirmed_at is not null;
 if u is null or exists(select 1 from public.administradores where usuario_id=u) then raise exception 'Não foi possível autorizar este e-mail.'; end if;
 select papel into atual from public.agencia_usuarios where agencia_id=p_agencia and usuario_id=u;
 if atual is not null and not public.pode_gerir_pessoa(p_agencia,u) and not (n=2 and public.nivel_papel(atual)<2) then raise exception 'Não foi possível autorizar este e-mail.'; end if;
 if atual is null and not public.e_admin() and exists(select 1 from public.agencia_usuarios where usuario_id=u) then
   raise exception 'Não foi possível autorizar este e-mail.';
 end if;
 insert into public.agencia_usuarios(agencia_id,usuario_id,papel,nome,criado_por) values(p_agencia,u,p_papel,nullif(trim(p_nome),''),auth.uid())
 on conflict (agencia_id,usuario_id) do update set papel=case when n>=3 or public.pode_gerir_pessoa(p_agencia,u) then excluded.papel else public.agencia_usuarios.papel end,
   nome=coalesce(excluded.nome,public.agencia_usuarios.nome);
 if p_squad is not null then insert into public.squad_membros(squad_id,usuario_id) values(p_squad,u) on conflict do nothing; end if;
end $$;

create or replace function public.revogar_acesso(p_agencia uuid,p_usuario uuid) returns void language plpgsql security definer set search_path='' as $$
declare n int := public.meu_nivel(p_agencia);
begin
 if n < 2 or not public.pode_gerir_pessoa(p_agencia,p_usuario) then raise exception 'Acesso negado'; end if;
 if n >= 3 then
   delete from public.agencia_usuarios where agencia_id=p_agencia and usuario_id=p_usuario;
 else
   -- Head tira a pessoa só dos squads dele; sem squad nenhum, ela sai da agência.
   delete from public.squad_membros sm using public.squads s where s.id=sm.squad_id and s.agencia_id=p_agencia and sm.usuario_id=p_usuario and public.no_squad(sm.squad_id);
   if not exists(select 1 from public.squad_membros sm join public.squads s on s.id=sm.squad_id where s.agencia_id=p_agencia and sm.usuario_id=p_usuario) then
     delete from public.agencia_usuarios where agencia_id=p_agencia and usuario_id=p_usuario;
   end if;
 end if;
end $$;

create or replace function public.alterar_papel(p_agencia uuid,p_usuario uuid,p_papel text) returns void language plpgsql security definer set search_path='' as $$
declare n int := public.meu_nivel(p_agencia);
begin
 if n < 2 or not public.pode_gerir_pessoa(p_agencia,p_usuario) or public.nivel_papel(p_papel) = 0 or public.nivel_papel(p_papel) >= n then
   raise exception 'Você não pode atribuir esse papel.';
 end if;
 update public.agencia_usuarios set papel=p_papel where agencia_id=p_agencia and usuario_id=p_usuario;
end $$;

create function public.listar_squads(p_agencia uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'nome',s.nome,
   'clientes',(select count(*) from public.clientes c where c.squad_id=s.id),
   'membros',coalesce((select jsonb_agg(jsonb_build_object('usuario_id',m.usuario_id,'nome',coalesce(m.nome,u.email),'papel',m.papel) order by public.nivel_papel(m.papel) desc, coalesce(m.nome,u.email))
      from public.squad_membros sm join public.agencia_usuarios m on m.usuario_id=sm.usuario_id and m.agencia_id=s.agencia_id join auth.users u on u.id=sm.usuario_id where sm.squad_id=s.id),'[]'::jsonb))
   order by s.nome),'[]'::jsonb)
 from public.squads s where s.agencia_id=p_agencia and public.meu_nivel(p_agencia) >= 1 and public.pode_ver(p_agencia,s.id);
$$;
create function public.salvar_squad(p_agencia uuid,p_nome text,p_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare r uuid;
begin
 if public.meu_nivel(p_agencia) < 3 then raise exception 'Somente donos e sócios organizam os squads.'; end if;
 if p_id is null then
   insert into public.squads(agencia_id,nome) values(p_agencia,trim(p_nome)) returning id into r;
 else
   update public.squads set nome=trim(p_nome) where id=p_id and agencia_id=p_agencia returning id into r;
   if r is null then raise exception 'Squad não encontrado.'; end if;
 end if;
 return r;
end $$;
create function public.excluir_squad(p_squad uuid) returns void language plpgsql security definer set search_path='' as $$
declare a uuid;
begin
 select agencia_id into a from public.squads where id=p_squad;
 if a is null or public.meu_nivel(a) < 3 then raise exception 'Somente donos e sócios organizam os squads.'; end if;
 delete from public.squads where id=p_squad;
end $$;
create function public.definir_membro_squad(p_squad uuid,p_usuario uuid,p_dentro boolean) returns void language plpgsql security definer set search_path='' as $$
declare a uuid;
begin
 select agencia_id into a from public.squads where id=p_squad;
 if a is null or public.meu_nivel(a) < 3 then raise exception 'Somente donos e sócios organizam os squads.'; end if;
 if not exists(select 1 from public.agencia_usuarios where agencia_id=a and usuario_id=p_usuario) then raise exception 'Pessoa fora da agência.'; end if;
 if p_dentro then insert into public.squad_membros(squad_id,usuario_id) values(p_squad,p_usuario) on conflict do nothing;
 else delete from public.squad_membros where squad_id=p_squad and usuario_id=p_usuario; end if;
end $$;

revoke all on function public.listar_acessos(uuid),public.autorizar_acesso(uuid,text,text,text,uuid),public.revogar_acesso(uuid,uuid),public.alterar_papel(uuid,uuid,text),public.listar_squads(uuid),public.salvar_squad(uuid,text,uuid),public.excluir_squad(uuid),public.definir_membro_squad(uuid,uuid,boolean),public.renovar_link(uuid),public.link_cliente(uuid),public.marcar_ajustado(uuid),public.pode_midia(text) from public, anon;
grant execute on function public.listar_acessos(uuid),public.autorizar_acesso(uuid,text,text,text,uuid),public.revogar_acesso(uuid,uuid),public.alterar_papel(uuid,uuid,text),public.listar_squads(uuid),public.salvar_squad(uuid,text,uuid),public.excluir_squad(uuid),public.definir_membro_squad(uuid,uuid,boolean),public.renovar_link(uuid),public.link_cliente(uuid),public.marcar_ajustado(uuid),public.pode_midia(text) to authenticated;

-- ---------- convites ----------
create table public.convites(
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  codigo_hash text not null,
  expira_em timestamptz not null,
  tentativas int not null default 0,
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.convites enable row level security;
revoke all on public.convites from anon, authenticated;

create function public.convite_por_email(p_email text) returns table(usuario_id uuid, codigo_hash text, expira_em timestamptz, tentativas int)
language sql stable security definer set search_path='' as $$
 select c.usuario_id, c.codigo_hash, c.expira_em, c.tentativas
 from public.convites c join auth.users u on u.id=c.usuario_id
 where lower(u.email)=lower(trim(p_email));
$$;
revoke all on function public.convite_por_email(text) from public, anon, authenticated;
grant execute on function public.convite_por_email(text) to service_role;

create or replace function public.listar_acessos(p_agencia uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare n int := public.meu_nivel(p_agencia);
begin
 if n < 2 then raise exception 'Acesso negado'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('usuario_id',u.id,'email',u.email,'nome',m.nome,'papel',m.papel,
     'pode_gerir',public.pode_gerir_pessoa(p_agencia,u.id),
     'pendente',exists(select 1 from public.convites c where c.usuario_id=u.id),
     'squads',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'nome',s.nome) order by s.nome) from public.squad_membros sm join public.squads s on s.id=sm.squad_id where sm.usuario_id=u.id and s.agencia_id=p_agencia and public.pode_ver(p_agencia,s.id)),'[]'::jsonb))
     order by public.nivel_papel(m.papel) desc, coalesce(m.nome,u.email))
   from public.agencia_usuarios m join auth.users u on u.id=m.usuario_id
   where m.agencia_id=p_agencia and (n >= 3 or u.id=auth.uid() or public.divide_squad(p_agencia,u.id))),'[]'::jsonb);
end $$;
revoke all on function public.listar_acessos(uuid) from public, anon;
grant execute on function public.listar_acessos(uuid) to authenticated;

-- ---------- squads opcionais ----------
alter table public.agencias add column usa_squads boolean not null default false;
-- ative squads por agência com: update public.agencias set usa_squads = true where id = '...';

create function public.usa_squads(a uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select usa_squads from public.agencias where id=a), false);
$$;
revoke all on function public.usa_squads(uuid) from public, anon;
grant execute on function public.usa_squads(uuid) to authenticated;

create or replace function public.pode_ver(a uuid, s uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.meu_nivel(a) >= 3 or (public.meu_nivel(a) >= 1 and (not public.usa_squads(a) or (s is not null and public.no_squad(s))));
$$;
create or replace function public.pode_gerir_em(a uuid, s uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.meu_nivel(a) >= 3 or (public.meu_nivel(a) = 2 and (not public.usa_squads(a) or (s is not null and public.no_squad(s))));
$$;
create or replace function public.pode_gerir_pessoa(a uuid, u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select public.nivel_papel(m.papel) < public.meu_nivel(a)
     and (public.meu_nivel(a) >= 3 or (public.meu_nivel(a) = 2 and (not public.usa_squads(a) or public.divide_squad(a,u))))
   from public.agencia_usuarios m where m.agencia_id=a and m.usuario_id=u), false);
$$;

create or replace function public.meu_contexto() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('superadmin',public.e_admin(),'agencias',coalesce((
   select jsonb_agg(jsonb_build_object('id',a.id,'slug',a.slug,'nome',a.nome,'usa_squads',a.usa_squads,
     'papel',case when public.e_admin() then 'admin' else (select m.papel from public.agencia_usuarios m where m.agencia_id=a.id and m.usuario_id=auth.uid()) end,
     'nivel',public.meu_nivel(a.id)) order by a.nome)
   from public.agencias a where public.pode_agencia(a.id)),'[]'::jsonb));
$$;

create or replace function public.listar_acessos(p_agencia uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare n int := public.meu_nivel(p_agencia); todos boolean := n >= 3 or not public.usa_squads(p_agencia);
begin
 if n < 2 then raise exception 'Acesso negado'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('usuario_id',u.id,'email',u.email,'nome',m.nome,'papel',m.papel,
     'pode_gerir',public.pode_gerir_pessoa(p_agencia,u.id),
     'pendente',exists(select 1 from public.convites c where c.usuario_id=u.id),
     'squads',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'nome',s.nome) order by s.nome) from public.squad_membros sm join public.squads s on s.id=sm.squad_id where sm.usuario_id=u.id and s.agencia_id=p_agencia and public.pode_ver(p_agencia,s.id)),'[]'::jsonb))
     order by public.nivel_papel(m.papel) desc, coalesce(m.nome,u.email))
   from public.agencia_usuarios m join auth.users u on u.id=m.usuario_id
   where m.agencia_id=p_agencia and (todos or u.id=auth.uid() or public.divide_squad(p_agencia,u.id))),'[]'::jsonb);
end $$;

create or replace function public.autorizar_acesso(p_agencia uuid,p_email text,p_papel text,p_nome text default null,p_squad uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare n int := public.meu_nivel(p_agencia); u uuid; atual text; sq boolean := public.usa_squads(p_agencia);
begin
 if n < 2 or public.nivel_papel(p_papel) = 0 or public.nivel_papel(p_papel) >= n then raise exception 'Você não pode atribuir esse papel.'; end if;
 if p_squad is not null and (not sq or not exists(select 1 from public.squads where id=p_squad and agencia_id=p_agencia)) then raise exception 'Squad inválido.'; end if;
 if n = 2 and sq and (p_squad is null or not public.no_squad(p_squad)) then raise exception 'Escolha um dos seus squads.'; end if;
 select id into u from auth.users where lower(email)=lower(trim(p_email)) and email_confirmed_at is not null;
 if u is null or exists(select 1 from public.administradores where usuario_id=u) then raise exception 'Não foi possível autorizar este e-mail.'; end if;
 select papel into atual from public.agencia_usuarios where agencia_id=p_agencia and usuario_id=u;
 if atual is not null and not public.pode_gerir_pessoa(p_agencia,u) and not (n=2 and public.nivel_papel(atual)<2) then raise exception 'Não foi possível autorizar este e-mail.'; end if;
 if atual is null and not public.e_admin() and exists(select 1 from public.agencia_usuarios where usuario_id=u) then
   raise exception 'Não foi possível autorizar este e-mail.';
 end if;
 insert into public.agencia_usuarios(agencia_id,usuario_id,papel,nome,criado_por) values(p_agencia,u,p_papel,nullif(trim(p_nome),''),auth.uid())
 on conflict (agencia_id,usuario_id) do update set papel=case when n>=3 or public.pode_gerir_pessoa(p_agencia,u) then excluded.papel else public.agencia_usuarios.papel end,
   nome=coalesce(excluded.nome,public.agencia_usuarios.nome);
 if p_squad is not null then insert into public.squad_membros(squad_id,usuario_id) values(p_squad,u) on conflict do nothing; end if;
end $$;

create or replace function public.revogar_acesso(p_agencia uuid,p_usuario uuid) returns void language plpgsql security definer set search_path='' as $$
declare n int := public.meu_nivel(p_agencia);
begin
 if n < 2 or not public.pode_gerir_pessoa(p_agencia,p_usuario) then raise exception 'Acesso negado'; end if;
 if n >= 3 or not public.usa_squads(p_agencia) then
   delete from public.agencia_usuarios where agencia_id=p_agencia and usuario_id=p_usuario;
 else
   delete from public.squad_membros sm using public.squads s where s.id=sm.squad_id and s.agencia_id=p_agencia and sm.usuario_id=p_usuario and public.no_squad(sm.squad_id);
   if not exists(select 1 from public.squad_membros sm join public.squads s on s.id=sm.squad_id where s.agencia_id=p_agencia and sm.usuario_id=p_usuario) then
     delete from public.agencia_usuarios where agencia_id=p_agencia and usuario_id=p_usuario;
   end if;
 end if;
end $$;

create or replace function public.salvar_squad(p_agencia uuid,p_nome text,p_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare r uuid;
begin
 if public.meu_nivel(p_agencia) < 3 then raise exception 'Somente donos e sócios organizam os squads.'; end if;
 if not public.usa_squads(p_agencia) then raise exception 'Esta agência não trabalha com squads.'; end if;
 if p_id is null then
   insert into public.squads(agencia_id,nome) values(p_agencia,trim(p_nome)) returning id into r;
 else
   update public.squads set nome=trim(p_nome) where id=p_id and agencia_id=p_agencia returning id into r;
   if r is null then raise exception 'Squad não encontrado.'; end if;
 end if;
 return r;
end $$;

revoke all on function public.meu_contexto(),public.listar_acessos(uuid),public.autorizar_acesso(uuid,text,text,text,uuid),public.revogar_acesso(uuid,uuid),public.salvar_squad(uuid,text,uuid),public.pode_ver(uuid,uuid),public.pode_gerir_em(uuid,uuid),public.pode_gerir_pessoa(uuid,uuid) from public, anon;
grant execute on function public.meu_contexto(),public.listar_acessos(uuid),public.autorizar_acesso(uuid,text,text,text,uuid),public.revogar_acesso(uuid,uuid),public.salvar_squad(uuid,text,uuid),public.pode_ver(uuid,uuid),public.pode_gerir_em(uuid,uuid),public.pode_gerir_pessoa(uuid,uuid) to authenticated;
-- ---------- clientes por gestor de tráfego ----------
create table public.cliente_gestores(
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (cliente_id, usuario_id)
);
create index on public.cliente_gestores(usuario_id);
alter table public.cliente_gestores enable row level security;
revoke all on public.cliente_gestores from anon, authenticated;

-- Regras de leitura
create function public.so_atribuidos(a uuid) returns boolean language sql stable security definer set search_path='' as $$
 select not public.e_admin() and exists(select 1 from public.agencia_usuarios where agencia_id=a and usuario_id=auth.uid() and papel='gestor_trafego');
$$;
create function public.cuida_cliente(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.cliente_gestores where cliente_id=c and usuario_id=auth.uid());
$$;
create function public.pode_ver_c(a uuid, s uuid, c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select case when public.so_atribuidos(a) then public.cuida_cliente(c) else public.pode_ver(a,s) end;
$$;
create function public.gestor_elegivel(c uuid, u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.clientes x join public.agencia_usuarios m on m.agencia_id=x.agencia_id and m.usuario_id=u and m.papel='gestor_trafego'
   where x.id=c and (not public.usa_squads(x.agencia_id)
     or (x.squad_id is not null and exists(select 1 from public.squad_membros sm where sm.squad_id=x.squad_id and sm.usuario_id=u))));
$$;

create or replace function public.pode_ver_cliente(c uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select public.pode_ver_c(agencia_id, squad_id, id) from public.clientes where id=c), false);
$$;
drop policy clientes_ler on public.clientes;
create policy clientes_ler on public.clientes for select to authenticated using (public.pode_ver_c(agencia_id, squad_id, id));

create or replace function public.pode_midia(n text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.agencias a where (split_part(n,'/',1)=a.id::text or exists(select 1 from public.midia_legada l where l.path=n and l.agencia_id=a.id))
   and (public.meu_nivel(a.id) >= 3 or (public.meu_nivel(a.id) >= 1 and (
     exists(select 1 from public.posts p join public.meses m on m.id=p.mes_id join public.clientes c on c.id=m.cliente_id
            where c.agencia_id=a.id and public.pode_ver_c(c.agencia_id,c.squad_id,c.id)
              and (('midia:'||n) in (p.capa_url,p.video_url) or p.slides ? ('midia:'||n)))
     or exists(select 1 from public.clientes c where c.agencia_id=a.id and c.avatar_url=('midia:'||n) and public.pode_ver_c(c.agencia_id,c.squad_id,c.id))
     or exists(select 1 from public.destaques d join public.clientes c on c.id=d.cliente_id where c.agencia_id=a.id and d.capa_url=('midia:'||n) and public.pode_ver_c(c.agencia_id,c.squad_id,c.id))
   ))));
$$;

-- Integridade: só gestor de tráfego elegível; saiu do squad, da agência ou do papel, perde os clientes.
create function public.validar_cliente_gestor() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not public.gestor_elegivel(new.cliente_id, new.usuario_id) then
   raise exception 'O gestor precisa ser de tráfego e estar no squad deste cliente.';
 end if;
 return new;
end $$;
create trigger validar_cliente_gestor before insert or update on public.cliente_gestores for each row execute function public.validar_cliente_gestor();

create function public.limpar_gestor_squad() returns trigger language plpgsql security definer set search_path='' as $$
begin
 delete from public.cliente_gestores g using public.clientes x where x.id=g.cliente_id and x.squad_id=old.squad_id and g.usuario_id=old.usuario_id;
 return old;
end $$;
create trigger limpar_gestor_squad after delete on public.squad_membros for each row execute function public.limpar_gestor_squad();

create function public.limpar_gestor_agencia() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' or new.papel <> 'gestor_trafego' then
   delete from public.cliente_gestores g using public.clientes x where x.id=g.cliente_id and x.agencia_id=old.agencia_id and g.usuario_id=old.usuario_id;
 end if;
 return null;
end $$;
create trigger limpar_gestor_agencia after delete or update of papel on public.agencia_usuarios for each row execute function public.limpar_gestor_agencia();

create function public.limpar_gestor_cliente() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.squad_id is distinct from old.squad_id then
   delete from public.cliente_gestores g where g.cliente_id=new.id and not public.gestor_elegivel(new.id, g.usuario_id);
 end if;
 return new;
end $$;
create trigger limpar_gestor_cliente after update of squad_id on public.clientes for each row execute function public.limpar_gestor_cliente();

-- Painel: Head (nos próprios squads), sócios e donos escolhem os clientes de cada gestor.
create function public.clientes_do_gestor(p_agencia uuid, p_usuario uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if public.meu_nivel(p_agencia) < 2 or not public.pode_gerir_pessoa(p_agencia, p_usuario)
    or not exists(select 1 from public.agencia_usuarios where agencia_id=p_agencia and usuario_id=p_usuario and papel='gestor_trafego') then
   raise exception 'Acesso negado';
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'nome',c.nome,'squad',s.nome,
     'marcado',exists(select 1 from public.cliente_gestores g where g.cliente_id=c.id and g.usuario_id=p_usuario))
     order by s.nome nulls first, c.nome)
   from public.clientes c left join public.squads s on s.id=c.squad_id
   where c.agencia_id=p_agencia and public.pode_gerir_cliente(c.id) and public.gestor_elegivel(c.id, p_usuario)),'[]'::jsonb);
end $$;

create function public.definir_gestor_cliente(p_cliente uuid, p_usuario uuid, p_dentro boolean) returns void language plpgsql security definer set search_path='' as $$
declare a uuid := public.agencia_do_cliente(p_cliente);
begin
 if a is null or not public.pode_gerir_cliente(p_cliente) or not public.pode_gerir_pessoa(a, p_usuario) then raise exception 'Acesso negado'; end if;
 if p_dentro then
   insert into public.cliente_gestores(cliente_id, usuario_id, criado_por) values(p_cliente, p_usuario, auth.uid()) on conflict do nothing;
 else
   delete from public.cliente_gestores where cliente_id=p_cliente and usuario_id=p_usuario;
 end if;
end $$;

create or replace function public.listar_acessos(p_agencia uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare n int := public.meu_nivel(p_agencia); todos boolean := n >= 3 or not public.usa_squads(p_agencia);
begin
 if n < 2 then raise exception 'Acesso negado'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('usuario_id',u.id,'email',u.email,'nome',m.nome,'papel',m.papel,
     'pode_gerir',public.pode_gerir_pessoa(p_agencia,u.id),
     'pendente',exists(select 1 from public.convites c where c.usuario_id=u.id),
     'clientes',case when m.papel='gestor_trafego' then (select count(*) from public.cliente_gestores g join public.clientes c on c.id=g.cliente_id
        where g.usuario_id=u.id and c.agencia_id=p_agencia and public.pode_ver_c(p_agencia,c.squad_id,c.id)) end,
     'squads',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'nome',s.nome) order by s.nome) from public.squad_membros sm join public.squads s on s.id=sm.squad_id where sm.usuario_id=u.id and s.agencia_id=p_agencia and public.pode_ver(p_agencia,s.id)),'[]'::jsonb))
     order by public.nivel_papel(m.papel) desc, coalesce(m.nome,u.email))
   from public.agencia_usuarios m join auth.users u on u.id=m.usuario_id
   where m.agencia_id=p_agencia and (todos or u.id=auth.uid() or public.divide_squad(p_agencia,u.id))),'[]'::jsonb);
end $$;

revoke all on function public.validar_cliente_gestor(),public.limpar_gestor_squad(),public.limpar_gestor_agencia(),public.limpar_gestor_cliente() from public, anon, authenticated;
revoke all on function public.so_atribuidos(uuid),public.cuida_cliente(uuid),public.pode_ver_c(uuid,uuid,uuid),public.gestor_elegivel(uuid,uuid),public.pode_ver_cliente(uuid),public.pode_midia(text),public.clientes_do_gestor(uuid,uuid),public.definir_gestor_cliente(uuid,uuid,boolean),public.listar_acessos(uuid) from public, anon;
grant execute on function public.so_atribuidos(uuid),public.cuida_cliente(uuid),public.pode_ver_c(uuid,uuid,uuid),public.gestor_elegivel(uuid,uuid),public.pode_ver_cliente(uuid),public.pode_midia(text),public.clientes_do_gestor(uuid,uuid),public.definir_gestor_cliente(uuid,uuid,boolean),public.listar_acessos(uuid) to authenticated;

commit;
