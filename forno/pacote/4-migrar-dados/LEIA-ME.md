# 4 · Migrar os dados da Forno (opcional)

`migrar.mjs` traz do Vistto atual (projeto do Felipe) **só o que é da Forno**:

- squads, equipe e gestores por cliente;
- clientes, meses, posts, destaques e aprovações;
- todas as artes.

Os ids, os tokens e os códigos do link do cliente continuam os mesmos. Nada da outra agência é lido nem copiado.

## Antes de rodar

- Passos 1, 2 e 3 feitos: banco instalado com `vistto` exposto e Worker novo no ar com `SIGN_SECRET`.
- Node 18 ou mais novo. Não precisa instalar nada.
- As chaves dos dois lados. O Felipe tem as do projeto antigo e o Dante as do novo. Uma pessoa pode rodar com as duas, ou rodem juntos.

| Variável | Onde achar |
|---|---|
| `ANTIGO_SUPABASE_URL` | `https://vbiebfcbzproffkrkluy.supabase.co` |
| `ANTIGO_SERVICE_KEY` | Projeto antigo › *Project Settings › API Keys* › secret (ou service_role) |
| `ANTIGO_R2_BASE` | `https://vistto-midia.felipelabmor.workers.dev` |
| `ANTIGO_SIGN_SECRET` | O `SIGN_SECRET` do Worker antigo (o Felipe sabe) |
| `NOVO_SUPABASE_URL` | `https://pbmyudlawyyqfpnswgqt.supabase.co` |
| `NOVO_SERVICE_KEY` | `forno-task` › *Project Settings › API Keys* › secret (ou service_role) |
| `NOVO_R2_BASE` | URL do Worker novo |
| `NOVO_SIGN_SECRET` | O `SIGN_SECRET` novo |

## Rodar

```
export ANTIGO_SUPABASE_URL=... ANTIGO_SERVICE_KEY=... ANTIGO_R2_BASE=... ANTIGO_SIGN_SECRET=...
export NOVO_SUPABASE_URL=...   NOVO_SERVICE_KEY=...   NOVO_R2_BASE=...   NOVO_SIGN_SECRET=...

node migrar.mjs              # 1) simulação: lê tudo, mostra o que faria, não grava nada
node migrar.mjs --executar   # 2) grava de verdade
```

Pode rodar o `--executar` de novo sem medo: o script atualiza o que já está lá e não duplica nada. Se alguma arte não copiar, ele para **antes** de gravar os dados e diz qual foi.

## O que acontece com cada coisa

- **Pessoas:** o login é casado pelo **e-mail**.
  - Quem já entra no taskmanager continua com o mesmo login e a mesma senha.
  - Quem não tem conta no projeto novo ganha uma, com um **código de primeiro acesso** de 6 números, válido por 48 h. Os códigos ficam em `codigos-primeiro-acesso-<data>.txt`. Mande para cada pessoa o endereço do painel, o e-mail e o código, e **apague o arquivo** depois.
  - Essas contas novas aparecem no taskmanager como `inativo` (veja o LEIA-ME principal).
  - O administrador geral do sistema antigo (o Felipe) não vem: o novo é definido no `02-primeiro-administrador.sql`.
- **Artes:**
  - as do R2 antigo vão para o R2 novo, no mesmo caminho;
  - as bem antigas, do Storage do Supabase (`midia:` ou URL pública), e links externos também vão para o R2 novo, em `<id da Forno>/legado/...`, e as referências nos posts são reescritas.
  - No fim, o projeto novo só tem `r2:...`.
- **Datas:** criação, publicação do mês e histórico de aprovação ficam como estavam. As contas de tempo de resposta da Visão geral seguem valendo.
- **Status dos posts e revisão interna:** ficam como estavam. Responsável que não está mais na equipe fica vazio.
- **Não vêm:**
  - os códigos de primeiro acesso pendentes (gere de novo no painel);
  - as sessões abertas.

## Links dos clientes

O token e o código de cada cliente são os mesmos, mas o **endereço do site muda**. Um link antigo (`visttoapp.github.io/c#...`) abre o sistema antigo, não o novo.

Depois da migração:

- copie de novo o link de cada cliente no painel novo (botão **copiar link**);
- envie o link novo;
- combine com a equipe uma data a partir da qual só o painel novo é usado.
