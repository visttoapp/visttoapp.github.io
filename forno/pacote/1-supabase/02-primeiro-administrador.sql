-- =====================================================================
--  VISTTO · FORNO — primeiro administrador (rode depois do 01)
--  1. Troque o e-mail abaixo pelo de quem vai administrar o Vistto.
--     A pessoa precisa JÁ TER login neste projeto (ex.: o mesmo login do taskmanager).
--  2. Supabase › SQL Editor › cole › Run.
--  O administrador geral (nível 4) faz tudo no Vistto e cadastra donos e sócios
--  em Gerenciar equipe. Depois disso, o resto da equipe é cadastrado pelo próprio painel.
-- =====================================================================
do $$
declare
  v_email text := 'TROQUE-PELO-EMAIL@forno.com.br';
  v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(trim(v_email));
  if v_id is null then
    raise exception 'Não existe login com o e-mail %. Crie o login antes (Authentication › Users › Add user) ou use o e-mail do taskmanager.', v_email;
  end if;
  insert into vistto.administradores(usuario_id) values (v_id) on conflict do nothing;
  raise notice 'Pronto: % é administrador geral do Vistto.', v_email;
end $$;

-- Conferir quem é administrador:
select u.email from vistto.administradores a join auth.users u on u.id = a.usuario_id;

-- Opcional: trabalhar com squads (cada Head enxerga só os clientes do próprio squad).
-- update vistto.agencias set usa_squads = true where slug = 'forno';

-- Opcional: trocar o nome que aparece no painel e na página do cliente.
-- update vistto.agencias set nome = 'Forno Lab' where slug = 'forno';
