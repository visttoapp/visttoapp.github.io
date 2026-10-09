-- Vistto · link curto do cliente: visttoapp.github.io/c#prime-plus/k7f3q2m9/outubro-2026
-- Rode uma vez no SQL Editor do Supabase (pode rodar de novo, não estraga nada).
--  · clientes.codigo: 8 letras que, junto com o identificador do cliente (slug), abrem o link. Só Head+ vê.
--  · "Gerar novo link" troca o token e o código: os dois links antigos param de abrir.
--  · resolver_link(): a função "cliente" troca identificador + código pelo token. Só o servidor chama.
begin;

create or replace function public.novo_codigo() returns text language sql volatile set search_path='' as $$
 select string_agg(substr('abcdefghjkmnpqrstuvwxyz23456789', (get_byte(x.b, i) % 31) + 1, 1), '' order by i)
   from (select extensions.gen_random_bytes(8) b) x, generate_series(0, 7) i
$$;
grant execute on function public.novo_codigo() to authenticated;

alter table public.clientes add column if not exists codigo text;
update public.clientes set codigo = public.novo_codigo() where codigo is null;
alter table public.clientes alter column codigo set default public.novo_codigo();
alter table public.clientes alter column codigo set not null;
alter table public.clientes drop constraint if exists clientes_codigo_valido;
alter table public.clientes add constraint clientes_codigo_valido check (codigo ~ '^[a-z2-9]{8}$');
create unique index if not exists clientes_link_curto on public.clientes(slug, codigo);
-- a coluna não entra no grant de leitura da tabela: a equipe não vê o código, como já não vê o token

create or replace function public.renovar_link(p_cliente uuid) returns text language plpgsql security definer set search_path='public' as $$
declare t text; begin
 if not public.pode_gerir_cliente(p_cliente) then raise exception 'Acesso negado'; end if;
 t := encode(extensions.gen_random_bytes(32), 'hex');
 update clientes set token = t, codigo = public.novo_codigo() where id = p_cliente;
 return t;
end $$;

create or replace function public.link_curto(p_cliente uuid) returns text language plpgsql stable security definer set search_path='' as $$
begin
 if not public.pode_gerir_cliente(p_cliente) then raise exception 'Acesso negado'; end if;
 return (select codigo from public.clientes where id = p_cliente);
end $$;
revoke all on function public.link_curto(uuid) from public, anon;
grant execute on function public.link_curto(uuid) to authenticated;

create or replace function public.resolver_link(p_slug text, p_codigo text) returns text language sql stable security definer set search_path='' as $$
 select token from public.clientes where slug = lower(trim(p_slug)) and codigo = lower(trim(p_codigo)) limit 1
$$;
revoke all on function public.resolver_link(text, text) from public, anon, authenticated;
grant execute on function public.resolver_link(text, text) to service_role;

commit;
