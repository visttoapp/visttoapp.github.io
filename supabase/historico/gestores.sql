-- Vistto · clientes por gestor de tráfego. Executar uma vez, depois de divisoes.sql. Não apaga conteúdo.
-- Gestor de tráfego vê só os clientes atribuídos a ele (posts, meses e mídias desses clientes).
-- Os outros papéis seguem as regras de squads. Head, sócios e donos continuam vendo tudo o que já viam.
-- Em agência com squads, o gestor precisa estar no squad do cliente para ser atribuído a ele.
begin;

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
