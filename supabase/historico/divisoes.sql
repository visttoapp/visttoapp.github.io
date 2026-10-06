-- Vistto · squads opcionais por agência. Executar uma vez, depois de convites.sql.
-- Agência sem squads (usa_squads = false): toda a equipe vê todos os clientes; Heads cuidam de toda a equipe.
-- Agência com squads: regras de squads.sql.
begin;
alter table public.agencias add column usa_squads boolean not null default false;
update public.agencias set usa_squads = true where id = '10000000-0000-4000-8000-000000000002';

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
commit;
