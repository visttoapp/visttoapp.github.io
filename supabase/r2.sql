-- Vistto · mídias no Cloudflare R2. Executar uma vez, depois de espaco.sql. Não apaga conteúdo.
-- As artes novas passam a ser guardadas como 'r2:<agencia>/<arquivo>' e servidas por um Worker,
-- que só aceita link assinado emitido pelo Supabase. As antigas ('midia:...') continuam no Storage.
begin;

-- Agora o caminho também sai de uma referência do R2.
create or replace function public.midia_path(v text) returns text language sql immutable set search_path='' as $$
 select case
   when v like 'midia:%' then substr(v,7)
   when v like 'r2:%' then substr(v,4)
   when v like 'https://vbiebfcbzproffkrkluy.supabase.co/storage/v1/object/public/midia/%' then split_part(v,'/storage/v1/object/public/midia/',2)
   else null end;
$$;

-- Quem pode ver este arquivo do R2: dono e sócio veem a agência inteira; os demais, só o que aparece
-- em cliente que eles enxergam (mesma regra da mídia do Storage, incluindo squad e gestor de tráfego).
create function public.pode_ref(v text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.agencias a
   where public.midia_path(v) is not null and split_part(public.midia_path(v),'/',1)=a.id::text
     and (public.meu_nivel(a.id) >= 3 or (public.meu_nivel(a.id) >= 1 and (
       exists(select 1 from public.posts p join public.meses m on m.id=p.mes_id join public.clientes c on c.id=m.cliente_id
              where c.agencia_id=a.id and public.pode_ver_c(c.agencia_id,c.squad_id,c.id)
                and (v in (p.capa_url,p.video_url) or p.slides ? v))
       or exists(select 1 from public.clientes c where c.agencia_id=a.id and c.avatar_url=v and public.pode_ver_c(c.agencia_id,c.squad_id,c.id))
       or exists(select 1 from public.destaques d join public.clientes c on c.id=d.cliente_id
              where c.agencia_id=a.id and d.capa_url=v and public.pode_ver_c(c.agencia_id,c.squad_id,c.id))
     ))));
$$;

-- Quem pode enviar arte nesta agência: qualquer pessoa da equipe.
create function public.pode_enviar(p_agencia uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.meu_nivel(p_agencia) >= 1;
$$;

-- Espaço e limpeza passam a ser só do administrador geral: a conta mostra o total do servidor,
-- e um dono de agência não deve nem saber que existe outra agência ali.
create or replace function public.uso_armazenamento(p_agencia uuid, p_dias int default 90) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;
begin
 if not public.e_admin() then raise exception 'Acesso negado'; end if;
 select jsonb_build_object(
   'arquivos', count(*), 'bytes', coalesce(sum(tam),0),
   'orfaos', count(*) filter (where orfao), 'bytes_orfaos', coalesce(sum(tam) filter (where orfao),0),
   'bytes_bucket', (select coalesce(sum(coalesce((metadata->>'size')::bigint,0)),0) from storage.objects where bucket_id='midia'),
   'meses_antigos', (select count(*) from public.meses m join public.clientes c on c.id=m.cliente_id
      where c.agencia_id=p_agencia and m.arquivado_em is null and m.created_at < now() - make_interval(days => greatest(p_dias,1)))
 ) into r
 from (
   select coalesce((o.metadata->>'size')::bigint,0) tam,
     not exists(select 1 from public.midia_refs() f where f.path=o.name)
     and not exists(select 1 from public.midia_legada l where l.path=o.name) orfao
   from storage.objects o
   where o.bucket_id='midia' and split_part(o.name,'/',1)=p_agencia::text
 ) t;
 return r;
end $$;

create or replace function public.arquivar_mes(p_mes uuid) returns void language plpgsql security definer set search_path='' as $$
declare c uuid;
begin
 select cliente_id into c from public.meses where id=p_mes;
 if c is null or not public.e_admin() then raise exception 'Acesso negado'; end if;
 update public.posts set slides='[]'::jsonb, capa_url=null, video_url=null where mes_id=p_mes;
 update public.meses set publicado=false, arquivado_em=now() where id=p_mes;
end $$;

-- O plano de limpeza passa a devolver a referência inteira, para saber de onde apagar cada arquivo.
create or replace function public.plano_limpeza(p_agencia uuid, p_dias int default 90) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;
begin
 if not public.e_admin() then raise exception 'Acesso negado'; end if;
 select jsonb_build_object(
   'orfaos', coalesce((select jsonb_agg(o.name) from storage.objects o
      where o.bucket_id='midia' and split_part(o.name,'/',1)=p_agencia::text
        and not exists(select 1 from public.midia_refs() f where f.path=o.name)
        and not exists(select 1 from public.midia_legada l where l.path=o.name)),'[]'::jsonb),
   'meses', coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'titulo',m.titulo,'cliente',c.nome,'criado_em',m.created_at,
        'arquivos', coalesce((select jsonb_agg(v) from (
            select jsonb_array_elements_text(p.slides) v from public.posts p where p.mes_id=m.id
            union all select p.capa_url from public.posts p where p.mes_id=m.id
            union all select p.video_url from public.posts p where p.mes_id=m.id
          ) y where v is not null and v <> '' and public.midia_path(v) is not null),'[]'::jsonb))
      order by m.created_at)
      from public.meses m join public.clientes c on c.id=m.cliente_id
      where c.agencia_id=p_agencia and m.arquivado_em is null and m.created_at < now() - make_interval(days => greatest(p_dias,1))),'[]'::jsonb)
 ) into r;
 return r;
end $$;

revoke all on function public.pode_ref(text),public.pode_enviar(uuid),public.midia_path(text),public.plano_limpeza(uuid,int),public.uso_armazenamento(uuid,int),public.arquivar_mes(uuid) from public, anon;
grant execute on function public.pode_ref(text),public.pode_enviar(uuid),public.midia_path(text),public.plano_limpeza(uuid,int),public.uso_armazenamento(uuid,int),public.arquivar_mes(uuid) to authenticated;
commit;
