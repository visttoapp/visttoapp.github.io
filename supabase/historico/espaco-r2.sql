-- Vistto · o painel passa a enxergar também o depósito da Cloudflare. Executar uma vez, depois de endurecer.sql.
begin;

-- Caminhos de arte que hoje moram no R2, por agência. Só o administrador geral.
create function public.refs_r2(p_agencia uuid) returns setof text language sql stable security definer set search_path='' as $$
 select distinct public.midia_path(v) from (
   select jsonb_array_elements_text(slides) v from public.posts
   union all select capa_url from public.posts
   union all select video_url from public.posts
   union all select avatar_url from public.clientes
   union all select capa_url from public.destaques
 ) x
 where public.e_admin() and v like 'r2:%' and public.midia_path(v) like p_agencia::text || '/%';
$$;
revoke all on function public.refs_r2(uuid) from public, anon;
grant execute on function public.refs_r2(uuid) to authenticated;
commit;
