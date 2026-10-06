-- Executar uma vez, depois do schema original. Migração transacional, sem excluir conteúdo.
begin;
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
commit;
