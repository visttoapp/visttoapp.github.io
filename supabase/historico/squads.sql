-- Vistto · squads. Executar uma vez, depois de hierarquia.sql. Não apaga conteúdo.
-- Dono, sócio e administrador geral veem todos os clientes da agência.
-- Head e equipe veem só os clientes dos squads em que estão. Cliente sem squad só aparece para dono/sócio.
begin;

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
commit;
