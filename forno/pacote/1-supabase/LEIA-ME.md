# 1 · Supabase

Projeto: o mesmo do taskmanager (`forno-task`, `https://pbmyudlawyyqfpnswgqt.supabase.co`). Faça o passo 3 do Cloudflare antes, para já ter `SIGN_SECRET` e `R2_BASE` em mãos.

## Passo 1 · Banco

*SQL Editor › New query*: cole o `01-instalar-vistto.sql` inteiro e clique em **Run**. Rode uma vez só.

O script cria o schema `vistto` com as 13 tabelas, as funções, as políticas de RLS e o bucket `midia`. O bucket guarda só artes antigas. Ninguém consegue enviar arte nova para ele: tudo novo vai para o R2.

O script não cria, não altera e não apaga nada no `public` do taskmanager.

| Tabela | Para quê |
|---|---|
| `agencias` | Uma linha: a Forno. `usa_squads` liga ou desliga os squads |
| `administradores` | Administrador geral (nível 4) |
| `agencia_usuarios` | Equipe e papel de cada pessoa |
| `squads`, `squad_membros` | Squads (opcional) |
| `cliente_gestores` | Clientes liberados para cada gestor de tráfego |
| `convites` | Códigos de primeiro acesso (guardados com hash, valem 48 h) |
| `clientes` | Cliente, @, bio, avatar, token e código do link |
| `meses` | Uma entrega por cliente, mês e canal (Instagram ou LinkedIn) |
| `posts` | Posts do mês: tema, título, legenda e artes (`r2:...`) |
| `destaques` | Destaques da prévia do perfil |
| `aprovacoes` | Histórico de aprovar, ajuste e comentário |
| `midia_legada` | Lista de artes antigas do Storage (fica vazia numa instalação nova) |

## Passo 2 · Expor o schema na API

*Project Settings › Data API › Exposed schemas*: acrescente `vistto`, sem tirar o que já está, e salve.

Sem isso, o painel dá erro do tipo *"The schema must be one of the following..."*.

## Passo 3 · Segredos das funções

*Edge Functions › Secrets* (ou `supabase secrets set ...`):

| Nome | Valor |
|---|---|
| `SIGN_SECRET` | O mesmo do Worker (ex.: `openssl rand -hex 32`) |
| `R2_BASE` | URL do Worker, sem barra no fim. Ex.: `https://forno-vistto-midia.SEU-SUBDOMINIO.workers.dev` |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` o Supabase já entrega às funções sozinho.

## Passo 4 · Publicar as 5 funções

**Pela linha de comando** (recomendado):

```
# numa pasta qualquer:
supabase init                       # se ainda não tiver a pasta supabase/
cp -r functions/* supabase/functions/
cat config.toml >> supabase/config.toml
supabase link --project-ref pbmyudlawyyqfpnswgqt
supabase functions deploy vistto-cliente --no-verify-jwt
supabase functions deploy vistto-acessos --no-verify-jwt
supabase functions deploy vistto-primeiro-acesso --no-verify-jwt
supabase functions deploy vistto-midia --no-verify-jwt
supabase functions deploy vistto-limpeza --no-verify-jwt
```

**Pelo painel:** em *Edge Functions › Deploy a new function › Via Editor*:

- crie cada uma com o nome exato da pasta;
- cole o `index.ts`;
- desligue **Verify JWT** nas cinco.

Elas conferem o login por conta própria:

- `vistto-cliente` e `vistto-primeiro-acesso` são chamadas sem login, de propósito;
- `vistto-acessos`, `vistto-midia` e `vistto-limpeza` validam o token de quem chamou.

| Função | O que faz |
|---|---|
| `vistto-cliente` | Abre o link do cliente (curto ou antigo) e assina as artes daquele mês |
| `vistto-acessos` | Cadastra a equipe e gera o código de primeiro acesso, conferindo o nível de quem pede |
| `vistto-primeiro-acesso` | Troca e-mail + código de 6 números pela senha da pessoa (no máximo 5 tentativas) |
| `vistto-midia` | Emite o link assinado para ver ou enviar arte no R2 |
| `vistto-limpeza` | Espaço usado, apagar arquivos sem dono e arquivar mês (só administrador geral) |

## Passo 5 · Primeiro administrador

Abra o `02-primeiro-administrador.sql`, troque o e-mail pelo seu (o mesmo login do taskmanager serve) e rode no SQL Editor.

Depois, no painel:

- cadastre donos e sócios em **Gerenciar equipe**;
- eles cadastram Heads e a equipe.

## Passo 6 · Endereço do painel no Auth

*Authentication › URL Configuration › Redirect URLs*: acrescente o endereço do painel, por exemplo `https://SEU-USUARIO.github.io/vistto/**`.

**Não troque o Site URL:** ele é do taskmanager. O endereço do painel nessa lista é o que faz o link de "Esqueci minha senha" voltar para o Vistto.
