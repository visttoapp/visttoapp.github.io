# 2 · GitHub (site)

A pasta `site/` é o Vistto inteiro do lado do navegador: HTML, CSS e JS puros, sem build e sem `npm`. Qualquer hospedagem de arquivos estáticos serve. O jeito mais simples é o GitHub Pages.

## Publicar no GitHub Pages

1. Crie um repositório (por exemplo, `vistto` na organização da Forno).
2. Coloque o **conteúdo** de `site/` na raiz do repositório, incluindo o arquivo `.nojekyll`. Faça o commit.
3. *Settings › Pages › Build and deployment*:
   - Source: **Deploy from a branch**;
   - branch `main`;
   - pasta `/ (root)`.
4. Em um ou dois minutos o site sai em `https://SEU-USUARIO.github.io/vistto/`:

| Endereço | O que abre |
|---|---|
| `.../vistto/` | Painel da equipe |
| `.../vistto/c#cliente/codigo/novembro-2026` | Página do cliente (é este link que o painel copia) |

Domínio próprio (ex.: `aprovacao.fornolab.com.br`): *Settings › Pages › Custom domain*, mais um CNAME no DNS.

## Depois de publicar

- **Worker** (`3-cloudflare-r2/wrangler.jsonc`): coloque em `ORIGENS` a **origem** do site, só esquema e domínio, sem caminho e sem barra. Exemplo: `https://SEU-USUARIO.github.io`. Publique o Worker de novo. Sem isso, o navegador não consegue enviar artes.
- **Supabase:** em *Authentication › URL Configuration › Redirect URLs*, acrescente `https://SEU-USUARIO.github.io/vistto/**`.

## Configuração

`site/js/config.js` já aponta para o projeto do taskmanager:

```js
window.CONFIG = { SUPABASE_URL: "https://pbmyudlawyyqfpnswgqt.supabase.co", SUPABASE_ANON_KEY: "sb_publishable_...", DB_SCHEMA: "vistto" };
```

- **Chave:** a publicável é feita para o navegador. A proteção é o RLS do banco.
- **Outro projeto:** troque URL e chave.
- **Nunca** coloque a service_role/secret aqui.

## Ao alterar JS ou CSS

Troque o `?v=...` nos dois HTML (`index.html` e `c.html`). Assim ninguém fica com versão misturada no cache.

## Dá para morar dentro do taskmanager?

Dá. Os caminhos são relativos, então a pasta `site/` funciona em qualquer subpasta de onde o taskmanager estiver hospedado (ex.: `/vistto/`).

Duas condições:

- a política de conteúdo dos HTML (`<meta http-equiv="Content-Security-Policy">`) precisa continuar permitindo `cdn.jsdelivr.net` (supabase-js) e `fonts.googleapis.com`;
- o domínio final precisa estar em `ORIGENS` do Worker e nas Redirect URLs do Supabase.

## Arquivos

| Arquivo | Para quê |
|---|---|
| `index.html`, `js/admin.js` | Painel da equipe |
| `c.html`, `js/app.js`, `js/client-api.js` | Página do cliente |
| `cliente.html` | Redireciona links antigos para `c` |
| `js/link.js` | Monta e lê o link curto do cliente |
| `js/media.js` | Pede os links assinados das artes |
| `js/importar.js` | Importar pasta do mês e subir ajustes (`roteiro.txt`) |
| `js/painel.js` | Contas da visão geral, pauta da semana e números de aprovação |
| `js/ui.js` | Avisos e confirmações |
| `js/brand.js`, `css/agencies.css` | Tema da Forno (preto, branco e laranja `#ff5200`) |
| `js/vendor/jszip.min.js` | Monta o .zip ao baixar carrossel (licença MIT) |
