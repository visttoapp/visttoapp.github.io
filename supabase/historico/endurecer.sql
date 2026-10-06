-- Vistto · fechaduras extras. Executar uma vez, depois de r2.sql. Não apaga conteúdo.
-- 1) O número do post vira texto simples, para ninguém conseguir injetar código na página do cliente.
-- 2) O código de primeiro acesso passa a contar a tentativa antes de conferir, de forma atômica.
-- 3) O Storage do Supabase deixa de aceitar arquivo novo: tudo que entra agora vai para o R2.
begin;

alter table public.posts
  add constraint posts_numero_simples check (numero is null or numero ~ '^[[:alnum:] ._/-]{1,12}$') not valid,
  add constraint posts_data_curta check (data is null or char_length(data) <= 16) not valid;
alter table public.posts validate constraint posts_numero_simples;
alter table public.posts validate constraint posts_data_curta;

-- Conta a tentativa e devolve o convite na mesma operação: mil pedidos ao mesmo tempo não furam o limite.
create function public.tentar_convite(p_email text) returns table(usuario_id uuid, codigo_hash text)
language sql security definer set search_path='' as $$
 update public.convites c set tentativas = c.tentativas + 1
 from auth.users u
 where u.id = c.usuario_id and lower(u.email) = lower(trim(p_email))
   and c.tentativas < 5 and c.expira_em > now()
 returning c.usuario_id, c.codigo_hash;
$$;
revoke all on function public.tentar_convite(text) from public, anon, authenticated;
grant execute on function public.tentar_convite(text) to service_role;

-- Envio novo só pelo R2. A leitura das artes antigas continua igual.
drop policy if exists midia_agencia_insert on storage.objects;
commit;
