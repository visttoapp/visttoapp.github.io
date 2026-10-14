# 3 · Cloudflare R2 (artes)

As artes ficam num bucket **R2 privado**: 10 GB grátis, sem cobrança de tráfego. O bucket não tem acesso público. A única porta é o Worker `worker/index.js`.

O Worker não sabe quem é quem. Ele só aceita link assinado (HMAC-SHA256) emitido pelas funções do Supabase, válido por uma hora, para um caminho e um método.

| Rota | O que faz |
|---|---|
| `GET /m/<caminho>?exp&sig` | Entrega a arte. Aceita pedido de trecho (Range), que o Safari do iPhone exige para tocar vídeo |
| `PUT /m/<caminho>?exp&sig` | Grava. Só JPG, PNG, WebP, GIF e MP4, até 100 MB. Não sobrescreve |
| `DELETE /m/<caminho>?exp&sig` | Apaga (usado pela limpeza) |
| `GET /lista?prefixo&exp&sig` | Inventário, para a limpeza saber o que sobrou |
| `GET /saude` | Responde `vistto` (para conferir se está no ar) |

## Passo 1 · Bucket

*Cloudflare › R2 › Create bucket*: nome `forno-vistto-midia`. Não ligue acesso público nem domínio público.

## Passo 2 · Segredo

Gere um segredo longo e guarde. É o mesmo valor que vai no Supabase.

```
openssl rand -hex 32
```

## Passo 3 · Publicar o Worker

**Pela linha de comando**, nesta pasta:

```
npx wrangler login
npx wrangler deploy
npx wrangler secret put SIGN_SECRET     # cole o segredo do passo 2
```

**Pelo GitHub** (deploy a cada push, como no Vistto original): em *Workers & Pages › Create › Import a repository*, escolha o repositório que contém `wrangler.jsonc` e `worker/`. Se ficarem numa subpasta, informe o *Root directory*. Depois, em *Settings › Variables and Secrets*, crie o secret `SIGN_SECRET`.

A URL do Worker sai como `https://forno-vistto-midia.SEU-SUBDOMINIO.workers.dev`. Esse é o `R2_BASE` do Supabase, sem barra no fim. Confira se está no ar abrindo `.../saude`, que deve mostrar `vistto`.

## Passo 4 · Origem do site

Em `wrangler.jsonc`, troque `ORIGENS` pela origem do site: só esquema e domínio, sem caminho e sem barra. Exemplo: `https://SEU-USUARIO.github.io`. Para mais de uma, separe por vírgula. Publique de novo.

É essa lista que deixa o navegador enviar artes direto para o Worker (CORS). A leitura das artes funciona mesmo sem ela.

## Resumo do que liga com o quê

| Onde | Nome | Valor |
|---|---|---|
| Worker (secret) | `SIGN_SECRET` | Segredo do passo 2 |
| Worker (variável) | `ORIGENS` | `https://SEU-USUARIO.github.io` |
| Worker (binding) | `MIDIA` | Bucket `forno-vistto-midia` (já está no `wrangler.jsonc`) |
| Supabase (secret) | `SIGN_SECRET` | O mesmo segredo |
| Supabase (secret) | `R2_BASE` | `https://forno-vistto-midia.SEU-SUBDOMINIO.workers.dev` |
