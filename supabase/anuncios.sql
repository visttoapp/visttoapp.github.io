-- Vistto · anúncios: Meta Ads e Google Ads. Executar uma vez, depois de espaco-r2.sql. Não apaga conteúdo.
-- A entrega ganha um canal. 'instagram' é o que já existe (o mês do feed). 'meta' e 'google' são campanhas.
-- Campanha → conjunto (Meta) ou grupo de anúncios (Google) → anúncio, como nos gerenciadores.
-- Quem vê anúncio: gestor de tráfego, Head, sócio, dono e administrador geral. Designer e editor seguem só no feed.
-- O cliente aprova anúncio pelo mesmo link, em abas separadas.
begin;

-- ---------- 1. canal na entrega ----------
alter table public.meses
  add column canal text not null default 'instagram' check (canal in ('instagram','meta','google')),
  add column objetivo text check (objetivo is null or char_length(objetivo) <= 40);

-- Um mês de feed por cliente, como antes. Campanhas podem repetir o mesmo mês.
alter table public.meses drop constraint if exists meses_cliente_id_ano_mes_key;
create unique index meses_um_mes_por_cliente on public.meses(cliente_id, ano_mes) where canal = 'instagram';
create index meses_canal_idx on public.meses(cliente_id, canal, ano_mes);

-- ---------- 2. campos do anúncio ----------
alter table public.posts
  add column conjunto  text check (conjunto is null or char_length(conjunto) <= 80),
  add column publico   text check (publico is null or char_length(publico) <= 300),
  add column descricao text check (descricao is null or char_length(descricao) <= 300),
  add column cta       text check (cta is null or char_length(cta) <= 30),
  add column destino   text check (destino is null or (char_length(destino) <= 300 and destino ~ '^https://[^[:space:]]{4,}$'));
-- Anúncio de pesquisa do Google é só texto.
alter table public.posts drop constraint posts_tipo_check;
alter table public.posts add constraint posts_tipo_check check (tipo in ('carousel','image','reel','texto'));
create index posts_conjunto_idx on public.posts(mes_id, conjunto);

-- ---------- 3. quem enxerga cada canal ----------
create function public.pode_canal(a uuid, k text) returns boolean language sql stable security definer set search_path='' as $$
 select case when k = 'instagram' then public.meu_nivel(a) >= 1
   else public.meu_nivel(a) >= 2
     or exists(select 1 from public.agencia_usuarios where agencia_id=a and usuario_id=auth.uid() and papel='gestor_trafego') end;
$$;
create function public.canal_do_mes(m uuid) returns text language sql stable security definer set search_path='' as $$
 select canal from public.meses where id=m;
$$;
revoke all on function public.pode_canal(uuid,text),public.canal_do_mes(uuid) from public, anon;
grant execute on function public.pode_canal(uuid,text),public.canal_do_mes(uuid) to authenticated;

-- As regras dos posts continuam passando pela entrega, então basta fechar a entrega por canal.
drop policy meses_ler on public.meses;
drop policy meses_criar on public.meses;
drop policy meses_editar on public.meses;
drop policy meses_excluir on public.meses;
create policy meses_ler on public.meses for select to authenticated
  using (exists(select 1 from public.clientes c where c.id=cliente_id) and public.pode_canal(public.agencia_do_cliente(cliente_id), canal));
create policy meses_criar on public.meses for insert to authenticated
  with check (exists(select 1 from public.clientes c where c.id=cliente_id) and public.pode_canal(public.agencia_do_cliente(cliente_id), canal));
create policy meses_editar on public.meses for update to authenticated
  using (exists(select 1 from public.clientes c where c.id=cliente_id) and public.pode_canal(public.agencia_do_cliente(cliente_id), canal))
  with check (exists(select 1 from public.clientes c where c.id=cliente_id) and public.pode_canal(public.agencia_do_cliente(cliente_id), canal));
create policy meses_excluir on public.meses for delete to authenticated
  using (public.pode_gerir_cliente(cliente_id) and public.pode_canal(public.agencia_do_cliente(cliente_id), canal));

-- ---------- 4. arte do anúncio segue a mesma porta ----------
create or replace function public.pode_ref(v text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.agencias a
   where public.midia_path(v) is not null and split_part(public.midia_path(v),'/',1)=a.id::text
     and (public.meu_nivel(a.id) >= 3 or (public.meu_nivel(a.id) >= 1 and (
       exists(select 1 from public.posts p join public.meses m on m.id=p.mes_id join public.clientes c on c.id=m.cliente_id
              where c.agencia_id=a.id and public.pode_ver_c(c.agencia_id,c.squad_id,c.id) and public.pode_canal(c.agencia_id,m.canal)
                and (v in (p.capa_url,p.video_url) or p.slides ? v))
       or exists(select 1 from public.clientes c where c.agencia_id=a.id and c.avatar_url=v and public.pode_ver_c(c.agencia_id,c.squad_id,c.id))
       or exists(select 1 from public.destaques d join public.clientes c on c.id=d.cliente_id
              where c.agencia_id=a.id and d.capa_url=v and public.pode_ver_c(c.agencia_id,c.squad_id,c.id))
     ))));
$$;
create or replace function public.pode_midia(n text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.agencias a where (split_part(n,'/',1)=a.id::text or exists(select 1 from public.midia_legada l where l.path=n and l.agencia_id=a.id))
   and (public.meu_nivel(a.id) >= 3 or (public.meu_nivel(a.id) >= 1 and (
     exists(select 1 from public.posts p join public.meses m on m.id=p.mes_id join public.clientes c on c.id=m.cliente_id
            where c.agencia_id=a.id and public.pode_ver_c(c.agencia_id,c.squad_id,c.id) and public.pode_canal(c.agencia_id,m.canal)
              and (('midia:'||n) in (p.capa_url,p.video_url) or p.slides ? ('midia:'||n)))
     or exists(select 1 from public.clientes c where c.agencia_id=a.id and c.avatar_url=('midia:'||n) and public.pode_ver_c(c.agencia_id,c.squad_id,c.id))
     or exists(select 1 from public.destaques d join public.clientes c on c.id=d.cliente_id where c.agencia_id=a.id and d.capa_url=('midia:'||n) and public.pode_ver_c(c.agencia_id,c.squad_id,c.id))
   ))));
$$;

-- ---------- 5. a página do cliente ganha as abas ----------
drop function if exists public.get_mes(text,text);
create function public.get_mes(p_token text, p_ano_mes text default null, p_canal text default null, p_entrega uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c clientes; m meses; k text; canais jsonb; result jsonb;
begin
  select * into c from clientes where token = p_token;
  if c.id is null then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object('canal', x.canal, 'entregas', x.n)
      order by case x.canal when 'instagram' then 0 when 'meta' then 1 else 2 end), '[]')
    into canais
    from (select canal, count(*) n from meses where cliente_id = c.id and publicado group by canal) x;

  if p_entrega is not null then
    select * into m from meses where id = p_entrega and cliente_id = c.id and publicado;
  end if;
  k := coalesce(m.canal, nullif(p_canal, ''), 'instagram');
  if k not in ('instagram','meta','google') then k := 'instagram'; end if;
  if m.id is null then
    if p_canal is null and not exists(select 1 from meses where cliente_id = c.id and publicado and canal = k) then
      k := coalesce((select canal from meses where cliente_id = c.id and publicado
                      order by case canal when 'instagram' then 0 when 'meta' then 1 else 2 end limit 1), k);
    end if;
    select * into m from meses
      where cliente_id = c.id and publicado and canal = k
        and (p_ano_mes is null or ano_mes = p_ano_mes)
      order by ano_mes desc, created_at desc limit 1;
  end if;

  if m.id is null then
    return jsonb_build_object('cliente', jsonb_build_object('nome', c.nome), 'mes', null, 'canal', k, 'canais', canais,
      'agencia', (select to_jsonb(a) from agencias a where a.id = c.agencia_id));
  end if;

  select jsonb_build_object(
    'agencia', (select to_jsonb(a) from agencias a where a.id = c.agencia_id),
    'canal', m.canal, 'canais', canais,
    'cliente', jsonb_build_object('nome', c.nome, 'handle', c.handle, 'bio', c.bio, 'avatar_url', c.avatar_url),
    'mes', jsonb_build_object('id', m.id, 'ano_mes', m.ano_mes, 'titulo', m.titulo, 'intro', m.intro,
                              'canal', m.canal, 'objetivo', m.objetivo),
    'meses', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'ano_mes', ano_mes, 'titulo', titulo)
                       order by ano_mes desc, created_at desc), '[]')
                from meses where cliente_id = c.id and publicado and canal = m.canal),
    'destaques', (select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'capa_url', capa_url) order by ordem), '[]')
                    from destaques where cliente_id = c.id),
    'posts', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', p.id, 'ordem', p.ordem, 'numero', p.numero, 'data', p.data, 'tema', p.tema,
                'titulo', p.titulo, 'tipo', p.tipo, 'legenda', p.legenda, 'slides', p.slides,
                'video_url', p.video_url, 'capa_url', p.capa_url, 'status', p.status,
                'conjunto', p.conjunto, 'publico', p.publico, 'descricao', p.descricao, 'cta', p.cta, 'destino', p.destino,
                'historico', (select coalesce(jsonb_agg(jsonb_build_object(
                                'acao', a.acao, 'comentario', a.comentario, 'autor', a.autor,
                                'origem', a.origem, 'created_at', a.created_at) order by a.created_at), '[]')
                              from aprovacoes a where a.post_id = p.id)
              ) order by p.ordem), '[]') from posts p where p.mes_id = m.id)
  ) into result;
  return result;
end $$;
revoke all on function public.get_mes(text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.get_mes(text,text,text,uuid) to service_role;
commit;
