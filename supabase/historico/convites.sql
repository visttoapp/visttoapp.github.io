-- Vistto · primeiro acesso por código. Executar uma vez, depois de squads.sql.
-- Quem cadastra recebe um código de 6 dígitos (vale 7 dias, 5 tentativas). A pessoa entra com e-mail + código e cria a própria senha.
begin;
create table public.convites(
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  codigo_hash text not null,
  expira_em timestamptz not null,
  tentativas int not null default 0,
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.convites enable row level security;
revoke all on public.convites from anon, authenticated;

create function public.convite_por_email(p_email text) returns table(usuario_id uuid, codigo_hash text, expira_em timestamptz, tentativas int)
language sql stable security definer set search_path='' as $$
 select c.usuario_id, c.codigo_hash, c.expira_em, c.tentativas
 from public.convites c join auth.users u on u.id=c.usuario_id
 where lower(u.email)=lower(trim(p_email));
$$;
revoke all on function public.convite_por_email(text) from public, anon, authenticated;
grant execute on function public.convite_por_email(text) to service_role;

create or replace function public.listar_acessos(p_agencia uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare n int := public.meu_nivel(p_agencia);
begin
 if n < 2 then raise exception 'Acesso negado'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('usuario_id',u.id,'email',u.email,'nome',m.nome,'papel',m.papel,
     'pode_gerir',public.pode_gerir_pessoa(p_agencia,u.id),
     'pendente',exists(select 1 from public.convites c where c.usuario_id=u.id),
     'squads',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'nome',s.nome) order by s.nome) from public.squad_membros sm join public.squads s on s.id=sm.squad_id where sm.usuario_id=u.id and s.agencia_id=p_agencia and public.pode_ver(p_agencia,s.id)),'[]'::jsonb))
     order by public.nivel_papel(m.papel) desc, coalesce(m.nome,u.email))
   from public.agencia_usuarios m join auth.users u on u.id=m.usuario_id
   where m.agencia_id=p_agencia and (n >= 3 or u.id=auth.uid() or public.divide_squad(p_agencia,u.id))),'[]'::jsonb);
end $$;
revoke all on function public.listar_acessos(uuid) from public, anon;
grant execute on function public.listar_acessos(uuid) to authenticated;
commit;
