-- Vistto · pauta da equipe. Rode uma vez no SQL Editor do Supabase (pode rodar de novo, não estraga nada).
--  · posts.responsavel: quem da equipe cuida do post (precisa ser da agência do post).
--  · posts.interno: 'revisao' (o Head aprova antes do cliente ver) ou 'reserva' (gaveta). Vazio = vai para o link.
--    Post com interno preenchido não aparece no link do cliente, e o cliente não consegue responder a ele.
--    Só Head, sócio e dono tiram um post da revisão interna.
--  · meses.publicado_em: quando o mês foi publicado, para medir quanto o cliente demora a responder.
--  · membros_agencia(): nomes da equipe para escolher o responsável (qualquer pessoa da agência enxerga).
--  · LinkedIn entra como canal de posts, igual ao feed: um mês por cliente, toda a equipe vê.
--    Meta Ads e Google Ads saem do link do cliente. As campanhas antigas continuam guardadas, nada é apagado.
begin;

alter table public.posts add column if not exists responsavel uuid references auth.users(id) on delete set null;
alter table public.posts add column if not exists interno text;
alter table public.posts drop constraint if exists posts_interno_valido;
alter table public.posts add constraint posts_interno_valido check (interno is null or interno in ('revisao','reserva'));
create index if not exists posts_responsavel_idx on public.posts(responsavel) where responsavel is not null;
alter table public.meses add column if not exists publicado_em timestamptz;

-- ---------- LinkedIn ----------
alter table public.meses drop constraint if exists meses_canal_check;
alter table public.meses add constraint meses_canal_check check (canal in ('instagram','linkedin','meta','google'));
create unique index if not exists meses_um_linkedin_por_mes on public.meses(cliente_id, ano_mes) where canal = 'linkedin';
create or replace function public.pode_canal(a uuid, k text) returns boolean language sql stable security definer set search_path='' as $$
 select case when k in ('instagram','linkedin') then public.meu_nivel(a) >= 1
   else public.meu_nivel(a) >= 2
     or exists(select 1 from public.agencia_usuarios where agencia_id=a and usuario_id=auth.uid() and papel='gestor_trafego') end;
$$;

-- ---------- pauta ----------
create or replace function public.validar_pauta() returns trigger language plpgsql security definer set search_path='' as $$
declare cli uuid; ag uuid;
begin
 select m.cliente_id, c.agencia_id into cli, ag from public.meses m join public.clientes c on c.id = m.cliente_id where m.id = new.mes_id;
 if new.responsavel is not null and (tg_op = 'INSERT' or new.responsavel is distinct from old.responsavel)
    and not exists (select 1 from public.agencia_usuarios u where u.agencia_id = ag and u.usuario_id = new.responsavel) then
   raise exception 'O responsável precisa ser da equipe da agência.';
 end if;
 if auth.uid() is not null and tg_op = 'UPDATE' and old.interno = 'revisao' and new.interno is null
    and not public.pode_gerir_cliente(cli) then
   raise exception 'Só Head, sócio ou dono liberam um post da revisão interna.';
 end if;
 return new;
end $$;
drop trigger if exists validar_pauta on public.posts;
create trigger validar_pauta before insert or update on public.posts for each row execute function public.validar_pauta();

create or replace function public.marcar_publicacao() returns trigger language plpgsql set search_path='' as $$
begin
 if new.publicado and (tg_op = 'INSERT' or not coalesce(old.publicado, false)) then new.publicado_em := now(); end if;
 return new;
end $$;
drop trigger if exists marcar_publicacao on public.meses;
create trigger marcar_publicacao before insert or update of publicado on public.meses for each row execute function public.marcar_publicacao();

create or replace function public.membros_agencia(p_agencia uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select case when public.pode_agencia(p_agencia) then coalesce((
   select jsonb_agg(jsonb_build_object('usuario_id', m.usuario_id, 'nome', coalesce(nullif(trim(m.nome), ''), split_part(u.email, '@', 1)), 'papel', m.papel)
     order by coalesce(nullif(trim(m.nome), ''), u.email))
   from public.agencia_usuarios m join auth.users u on u.id = m.usuario_id
   where m.agencia_id = p_agencia), '[]'::jsonb) else '[]'::jsonb end
$$;
revoke all on function public.validar_pauta(), public.marcar_publicacao() from public, anon, authenticated;
revoke all on function public.membros_agencia(uuid) from public, anon;
grant execute on function public.membros_agencia(uuid) to authenticated;

-- O cliente responde só a post que está no link.
create or replace function public.registrar_aprovacao(p_token text, p_post_id uuid, p_acao text, p_comentario text default null, p_autor text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  select exists (
    select 1 from posts p join meses m on m.id = p.mes_id join clientes c on c.id = m.cliente_id
     where p.id = p_post_id and c.token = p_token and m.publicado and p.interno is null and m.canal in ('instagram','linkedin')
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
revoke all on function public.registrar_aprovacao(text,uuid,text,text,text) from public;
grant execute on function public.registrar_aprovacao(text,uuid,text,text,text) to anon, authenticated;

-- O link do cliente mostra feed e LinkedIn, sem post em revisão interna nem na gaveta.
create or replace function public.get_mes(p_token text, p_ano_mes text default null, p_canal text default null, p_entrega uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c clientes; m meses; k text; canais jsonb; result jsonb;
begin
  select * into c from clientes where token = p_token;
  if c.id is null then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object('canal', x.canal, 'entregas', x.n)
      order by case x.canal when 'instagram' then 0 else 1 end), '[]')
    into canais
    from (select canal, count(*) n from meses where cliente_id = c.id and publicado and canal in ('instagram','linkedin') group by canal) x;

  if p_entrega is not null then
    select * into m from meses where id = p_entrega and cliente_id = c.id and publicado and canal in ('instagram','linkedin');
  end if;
  k := coalesce(m.canal, nullif(p_canal, ''), 'instagram');
  if k not in ('instagram','linkedin') then k := 'instagram'; end if;
  if m.id is null then
    if p_canal is null and not exists(select 1 from meses where cliente_id = c.id and publicado and canal = k) then
      k := coalesce((select canal from meses where cliente_id = c.id and publicado and canal in ('instagram','linkedin')
                      order by case canal when 'instagram' then 0 else 1 end limit 1), k);
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
              ) order by p.ordem), '[]') from posts p where p.mes_id = m.id and p.interno is null)
  ) into result;
  return result;
end $$;
revoke all on function public.get_mes(text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.get_mes(text,text,text,uuid) to service_role;

commit;
