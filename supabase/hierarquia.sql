-- Vistto · hierarquia de acessos por agência.
-- Executar uma vez, depois de multi-agencias.sql. Não apaga conteúdo.
-- Níveis: 4 administrador geral · 3 dono/sócio · 2 head · 1 equipe (designer, editor de vídeo, social media, gestor de tráfego).
-- Cada nível só cadastra, altera ou remove papéis abaixo do seu, e somente dentro da própria agência.
begin;

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
commit;
