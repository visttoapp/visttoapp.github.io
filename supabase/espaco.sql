-- Vistto · espaço: uso do armazenamento, limpeza de arquivos sem dono e arquivamento de meses antigos.
-- Executar uma vez, depois de gestores.sql. Não apaga conteúdo por conta própria: só prepara as contas e a lista.
-- Arquivar um mês tira as artes do servidor e mantém no painel o post, o tema, a legenda e o histórico de aprovação.
begin;

alter table public.meses add column arquivado_em timestamptz;

-- Todo caminho de mídia citado em algum lugar do sistema.
create function public.midia_refs() returns table(path text) language sql stable security definer set search_path='' as $$
 select public.midia_path(v) from (
   select jsonb_array_elements_text(slides) v from public.posts
   union all select capa_url from public.posts
   union all select video_url from public.posts
   union all select avatar_url from public.clientes
   union all select capa_url from public.destaques
 ) x where v is not null and v <> '' and public.midia_path(v) is not null and public.midia_path(v) <> '';
$$;

-- Quanto a agência ocupa, quanto é lixo e quantos meses já passaram do prazo.
create function public.uso_armazenamento(p_agencia uuid, p_dias int default 90) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;
begin
 if public.meu_nivel(p_agencia) < 3 then raise exception 'Acesso negado'; end if;
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

-- O que pode sair do servidor: arquivos sem dono e meses vencidos, com os caminhos de cada um.
create function public.plano_limpeza(p_agencia uuid, p_dias int default 90) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;
begin
 if public.meu_nivel(p_agencia) < 3 then raise exception 'Acesso negado'; end if;
 select jsonb_build_object(
   'orfaos', coalesce((select jsonb_agg(o.name) from storage.objects o
      where o.bucket_id='midia' and split_part(o.name,'/',1)=p_agencia::text
        and not exists(select 1 from public.midia_refs() f where f.path=o.name)
        and not exists(select 1 from public.midia_legada l where l.path=o.name)),'[]'::jsonb),
   'meses', coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'titulo',m.titulo,'cliente',c.nome,'criado_em',m.created_at,
        'arquivos', coalesce((select jsonb_agg(public.midia_path(v)) from (
            select jsonb_array_elements_text(p.slides) v from public.posts p where p.mes_id=m.id
            union all select p.capa_url from public.posts p where p.mes_id=m.id
            union all select p.video_url from public.posts p where p.mes_id=m.id
          ) y where v is not null and v <> '' and public.midia_path(v) <> ''),'[]'::jsonb))
      order by m.created_at)
      from public.meses m join public.clientes c on c.id=m.cliente_id
      where c.agencia_id=p_agencia and m.arquivado_em is null and m.created_at < now() - make_interval(days => greatest(p_dias,1))),'[]'::jsonb)
 ) into r;
 return r;
end $$;

-- Arquiva o mês: limpa as referências de mídia dos posts e fecha o link do cliente.
create function public.arquivar_mes(p_mes uuid) returns void language plpgsql security definer set search_path='' as $$
declare c uuid;
begin
 select cliente_id into c from public.meses where id=p_mes;
 if c is null or public.meu_nivel((select agencia_id from public.clientes where id=c)) < 3 then raise exception 'Acesso negado'; end if;
 update public.posts set slides='[]'::jsonb, capa_url=null, video_url=null where mes_id=p_mes;
 update public.meses set publicado=false, arquivado_em=now() where id=p_mes;
end $$;

revoke all on function public.midia_refs(),public.uso_armazenamento(uuid,int),public.plano_limpeza(uuid,int),public.arquivar_mes(uuid) from public, anon;
grant execute on function public.uso_armazenamento(uuid,int),public.plano_limpeza(uuid,int),public.arquivar_mes(uuid) to authenticated;
commit;
