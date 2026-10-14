# Vistto · Forno: pacote de implantação

O Vistto é o sistema de **aprovação de posts** feito pelo Felipe. A equipe monta o mês de cada cliente (Instagram e LinkedIn: imagem, carrossel e reel), e o cliente recebe um link para aprovar, pedir ajuste ou comentar. Este pacote tem **só a parte da Forno**: a outra agência que usava o sistema saiu do banco, da marca e dos arquivos.

O pacote foi preparado para rodar **no mesmo projeto do Supabase do taskmanager** (`forno-task`), sem encostar nas tabelas dele.

## O que tem aqui

| Pasta | Vai para | O que é |
|---|---|---|
| `1-supabase/` | Supabase | Banco completo (`01-instalar-vistto.sql`), primeiro administrador (`02-...sql`) e as 5 Edge Functions |
| `2-github/` | GitHub Pages | O site: painel da equipe (`index.html`) e página do cliente (`c.html`). HTML, CSS e JS puros, sem build |
| `3-cloudflare-r2/` | Cloudflare | Worker que guarda e entrega as artes num bucket R2 privado |
| `4-migrar-dados/` | (roda uma vez) | Script que traz clientes, meses, posts, aprovações, equipe e artes da Forno do Vistto atual |
| `verificar/` | (seu computador) | Testes que conferem o pacote sem tocar em nada de verdade |

Cada pasta tem o próprio `LEIA-ME.md` com o passo a passo.

## Como as peças conversam

```
 navegador (equipe e cliente)
   │  site estático (GitHub Pages)
   ├──► Supabase Auth ............ login da equipe (o mesmo login do taskmanager)
   ├──► Supabase REST, schema vistto ... clientes, meses, posts, aprovações (com RLS)
   ├──► Edge Functions vistto-* ....... link do cliente, cadastro de equipe, links das artes, limpeza
   └──► Worker no Cloudflare ─► R2 ..... artes (só abre com link assinado pelo Supabase, vale 1 hora)
```

O bucket R2 é fechado. Quem decide se alguém pode ver ou enviar uma arte é o banco. A função assina um link curto, e o Worker só confere a assinatura. As duas pontas usam o mesmo segredo, `SIGN_SECRET`.

## O que mudou em relação ao Vistto original

- **Só a Forno.** Uma agência só (`Forno Lab`, id `10000000-0000-4000-8000-000000000002`, o mesmo do sistema atual, para a migração manter tudo). O tema da outra agência, a logo dela e os dados de exemplo saíram.
- **Schema `vistto`.** O taskmanager já tem `public.clientes` e `public.comentarios`. Por isso, todo o Vistto (13 tabelas, funções, políticas) mora no schema `vistto`. O `01-instalar-vistto.sql` não cria, não altera e não apaga nada no `public`.
- **Funções com prefixo:** `vistto-cliente`, `vistto-acessos`, `vistto-primeiro-acesso`, `vistto-midia`, `vistto-limpeza`. Assim não se misturam com `convidar` e `mig-import` do taskmanager.
- **Sem endereços do Felipe.** O Worker antigo (`felipelabmor.workers.dev`) e o site antigo (`visttoapp.github.io`) saíram do site, das funções e do Worker. O endereço do Worker agora vem do segredo `R2_BASE`, e o do site vem da variável `ORIGENS` do Worker. O SQL ainda cita o endereço do projeto antigo numa função (`midia_path`), só para reconhecer URLs de arte antigas, que a migração já converte. Não atrapalha nada.
- **Bucket e Worker com nome da Forno:** `forno-vistto-midia`.

## Ordem de instalação (checklist)

1. **Cloudflare** (`3-cloudflare-r2/`): crie o bucket, publique o Worker, defina o `SIGN_SECRET`. Anote a URL do Worker, que será o `R2_BASE`.
2. **Supabase** (`1-supabase/`):
   - rode o `01`;
   - acrescente `vistto` em *Exposed schemas*;
   - cadastre os segredos `SIGN_SECRET` e `R2_BASE`;
   - publique as 5 funções;
   - rode o `02` com o seu e-mail.
3. **GitHub** (`2-github/`): publique o site. Depois volte ao Worker e coloque o endereço do site em `ORIGENS`. No Supabase, em *Authentication › URL Configuration › Redirect URLs*, acrescente o endereço do painel.
4. **Dados** (`4-migrar-dados/`, opcional): simule e depois execute a migração.
5. **Teste de ponta a ponta:**
   - entre no painel com o seu login;
   - crie um cliente e um mês, e envie uma arte;
   - publique e copie o link;
   - abra o link numa janela anônima e aprove.

## Convivência com o taskmanager

- **Mesmos logins.** O Vistto usa o Supabase Auth do projeto. Quem já entra no taskmanager pode ganhar acesso ao Vistto em *Gerenciar equipe › Autorizar conta existente*, sem conta nova.
- **Papéis separados.** O taskmanager usa `public.pessoas.papel` (diretoria, coordenador, colaborador). O Vistto usa `vistto.agencia_usuarios.papel` (dono, sócio, head, designer, editor de vídeo, social media, gestor de tráfego) e `vistto.administradores` (administrador geral). Ter acesso a um não dá acesso ao outro.
- **Logins criados pelo Vistto aparecem no taskmanager como `inativo`.** O trigger `trg_nova_pessoa` do taskmanager cria uma linha em `public.pessoas` para todo usuário novo. Quem o Vistto cria não tem `invited_at`, então entra como `inativo` e não ganha acesso ao taskmanager. É esperado.
- **"Gerar novo código" troca a senha do login**, e o login é o mesmo nos dois sistemas. Se o Head gerar um código novo para alguém no Vistto, a senha antiga dessa pessoa para de funcionar no taskmanager também.
- **Clientes são cadastros diferentes.** `vistto.clientes` (id uuid) e `public.clientes` (id bigint) não se conhecem. Se quiser ligar os dois depois (por exemplo, abrir o Vistto do cliente a partir do taskmanager), um caminho simples é uma coluna em `vistto.clientes` apontando para `public.clientes(id)`. O Vistto não depende disso.
- **E-mail de "Esqueci minha senha"** sai do SMTP do projeto, o mesmo do taskmanager.

## Segredos: onde fica cada um (nunca no repositório)

| Segredo | Onde |
|---|---|
| `SIGN_SECRET` (o mesmo valor nos dois lados) | Cloudflare: Worker › Settings › Variables and Secrets. Supabase: Edge Functions › Secrets |
| `R2_BASE` (URL do Worker, sem barra no fim) | Supabase: Edge Functions › Secrets |
| service_role / secret key | Só no Supabase (as funções recebem sozinhas) e, durante a migração, na sua máquina |
| Chave publicável (`sb_publishable_...`) | `2-github/site/js/config.js`. É pública por natureza: vai para o navegador e a proteção é o RLS |

## Conferir o pacote

```
cd verificar
npm install
npm test
```

Os testes montam um Postgres de mentira (PGlite) imitando o Supabase com um taskmanager ao lado e conferem:

- a instalação, sem mexer no `public`;
- os papéis e o link do cliente;
- a aprovação e as artes;
- o Worker e as funções;
- as contas da visão geral e o leitor de pasta.

## Custos

- **Cloudflare R2:** 10 GB grátis, sem cobrança de tráfego.
- **Cloudflare Workers:** 100 mil pedidos por dia no plano grátis.
- **GitHub Pages:** grátis.
- **Supabase:** usa o plano do projeto do taskmanager. As artes não ficam no Storage do Supabase.
