# Vistto

Sistema de aprovação de posts. Cada agência vê apenas os próprios clientes, com a própria identidade visual. Quem entra no painel não vê outras agências.

## Papéis

| Nível | Papel | O que faz |
|---|---|---|
| 4 | Administrador geral | Tudo, em todas as agências. Cadastra donos e sócios. |
| 3 | Dono / Sócio | Tudo na própria agência. Cadastra Heads e equipe. |
| 2 | Head | No(s) próprio(s) squad(s): cria clientes, publica o mês, copia e renova o link, cadastra a equipe. |
| 1 | Equipe (designer, editor de vídeo, social media, gestor de tráfego) | Nos clientes do(s) próprio(s) squad(s) (gestor de tráfego: só nos clientes liberados para ele): cria meses, envia e edita posts, vê os retornos e marca como ajustado. Não vê o link do cliente, não publica e não exclui. |

## Squads
Squads são opcionais por agência (coluna `agencias.usa_squads`). Sem squads, toda a equipe vê todos os clientes da agência e o Head cuida de toda a equipe; os campos de squad somem do painel.

Cada squad tem um Head, a equipe e seus clientes. Head e equipe só enxergam os clientes (e as mídias) dos squads em que estão; dono, sócio e administrador geral enxergam todos. Uma pessoa pode estar em mais de um squad, como um gestor de tráfego compartilhado.

Donos e sócios criam squads e colocam ou tiram pessoas em **Gerenciar equipe › Squads**. Ao cadastrar um cliente, escolha o squad. Quando um Head cria um login, a pessoa já entra no squad escolhido. Se o Head remove alguém, a pessoa sai só dos squads dele; sem nenhum squad, perde o acesso à agência.

## Clientes do gestor de tráfego
O gestor de tráfego não vê o squad inteiro, só os clientes marcados para ele. Em **Gerenciar equipe**, clique em **Clientes** na linha do gestor e marque os clientes. O Head marca clientes dos próprios squads; dono e sócio, de qualquer squad. Em agência com squads, o gestor precisa estar no squad do cliente. Se ele sair do squad, mudar de papel ou o cliente trocar de squad, a liberação correspondente some sozinha. Sem nenhum cliente marcado, ele não vê nada.

Cada nível só cadastra, troca ou remove papéis abaixo do seu, e só na própria agência. Donos, sócios e Heads não conseguem autorizar contas que já pertencem a outra agência.

## Cadastrar alguém
1. Entre no painel e clique em **Gerenciar equipe** (Head, sócio, dono e administrador geral).
2. O administrador geral escolhe antes a agência no seletor.
3. Preencha nome, e-mail, papel e squad e clique em **Cadastrar e gerar código**.
4. O painel mostra um código de 6 números (vale 48 horas). Envie para a pessoa o endereço do sistema, o e-mail cadastrado e o código.
5. A pessoa abre o sistema, clica em **Primeiro acesso**, digita e-mail e código e cria a própria senha (mínimo 8 caracteres).
6. Para várias pessoas, use **Cadastro em lote**: uma por linha, `Nome; e-mail; papel; squad`. Sai um código para cada uma.
7. Se a pessoa já tem conta sem agência, use **Autorizar conta existente**.
8. Na lista da equipe dá para trocar o papel, gerar **novo código** (a senha atual deixa de valer) ou remover o acesso de quem está abaixo de você.

Um e-mail é uma conta. Para ter contas separadas por agência com a mesma caixa do Gmail, use apelidos como `nome+1@gmail.com` e `nome+2@gmail.com`.

## Senhas
- **Primeiro acesso:** e-mail + código de 6 números gerado por quem cadastrou. O código vale 48 horas e bloqueia após 5 tentativas erradas, contadas no banco de forma atômica.
- **Trocar a própria senha:** **trocar minha senha**, no rodapé da barra lateral.
- **Esqueceu a senha:** peça ao responsável um **novo código** (em Gerenciar equipe). O botão **Esqueci minha senha** manda link por e-mail, mas só funciona para qualquer endereço depois de configurar SMTP próprio no Supabase (Authentication › Emails › SMTP Settings).

## Clientes e aprovação
1. Head ou acima cria o cliente em **+ novo cliente**.
2. A equipe cria o mês, envia imagens ou MP4 (até 50 MB) e salva os posts.
3. Head ou acima marca **Publicado para o cliente** e usa **copiar link**.
4. O cliente abre o link, aprova, comenta ou pede ajuste.
5. No painel, **Atualizar aprovações** traz os retornos. Depois da correção, **marcar como ajustado** pede nova aprovação.

O link que o painel copia é curto e legível: `visttoapp.github.io/c#prime-plus/k7f3q2m9/outubro-2026` (no LinkedIn, `.../linkedin-outubro-2026`). O identificador do cliente (o campo Identificador, no cadastro) e o mês ficam à mostra; o código de 8 letras é a chave. A função `cliente` troca identificador e código pelo token (`resolver_link`, só o servidor chama) e devolve o token para a página registrar as respostas. Trocar o identificador do cliente muda o link. O formato antigo, `#t=<token>&m=...`, continua valendo; a leitura e a montagem ficam em `js/link.js`, coberto por `tests/link.mjs`.

O link funciona como chave. **Invalidar link antigo e gerar outro** revoga o anterior, no formato curto e no antigo. URLs temporárias de mídia já emitidas duram até uma hora. O status de um post só muda pela resposta do cliente ou por "marcar como ajustado".

## Canais: Instagram e LinkedIn
Na barra lateral, **Canal** troca entre Instagram e LinkedIn. Os dois funcionam igual: mês, número, tema, título, legenda e artes (imagem, carrossel ou vídeo), com importar pasta, subir ajustes e roteiro. Cada cliente tem um mês de cada canal. O cliente aprova pelo mesmo link: a página ganha uma aba por canal com algo publicado, e o LinkedIn aparece em uma coluna, no formato do feed da rede. O link de um mês de LinkedIn leva o id da entrega (`#t=...&e=...`).

Meta Ads e Google Ads saíram do painel e do link do cliente. As campanhas antigas continuam guardadas no banco, sem aparecer em lugar nenhum, e as colunas de anúncio (`conjunto`, `publico`, `descricao`, `cta`, `destino`, `objetivo`) ficaram para não perder dado.

## Visão geral, entregas e pauta
Ao entrar numa agência, o painel abre na **Visão geral**: os números do mês (posts, com o cliente, em ajuste, aprovados, atrasados) e um cartão por cliente com a barra de aprovados e o que está atrasado. Atrasado é post com dia previsto já passado e ainda sem aprovação. Duas abas completam a tela: **Pauta da semana**, com os posts de cada pessoa por dia, e **Aprovação**, com quanto tempo cada cliente costuma levar para responder, quantos ajustes pede por post e quanto aprova de primeira (últimos três meses). As contas ficam em `js/painel.js`, coberto por `tests/painel.mjs`.

Dentro do cliente, os meses aparecem como **entregas**, com progresso. Os posts podem ser vistos em lista ou em quadro (Aguardando, Ajuste, Aprovado), e o formulário de post só abre ao criar ou editar. Os retornos do cliente atualizam sozinhos quando a aba volta a ficar visível.

Cada post pode ter um **responsável** da equipe e ficar em **revisão interna** (o Head libera antes de o cliente ver) ou na **gaveta** (reserva, fora do link). O cliente não vê nem responde a post em revisão ou na gaveta, e só Head, sócio e dono tiram um post da revisão. Avisos e confirmações do painel saem de `js/ui.js`, no lugar das caixas do navegador.

### Para ligar o link curto no projeto em uso
Nesta ordem (ao contrário, o painel passa a copiar um link curto que a função ainda não sabe abrir):
1. Publique de novo a função `cliente` (no painel do Supabase, Edge Functions › cliente › Code, colando o `supabase/functions/cliente/index.ts` inteiro, ou `supabase functions deploy cliente --no-verify-jwt`).
2. Rode `supabase/link-curto.sql` no SQL Editor. Pode rodar de novo sem estragar nada.

Antes disso, o painel continua copiando o link antigo, que segue funcionando.

## Importar a pasta do mês
Com o mês aberto, **Importar pasta** (no topo) lê uma pasta do computador e monta os posts. A regra: pasta com várias artes vira carrossel na ordem dos nomes, arte solta vira post de imagem, `.mp4` vira reel e puxa a capa de mesmo nome ou número. Pastas de categoria (`carrosseis`, `esteticos`, `feed`, `reels`, `stories`, `artes`…) são só organização e não viram post. Pastas de trabalho (`brutos`, `psd`, `editaveis`, `fontes`, `refs`, `backup`) e formatos fora de JPG, PNG, WebP, GIF e MP4 ficam de fora.

Do nome saem só o número (`01`, `1.`, `01 -`) e a ordem; o resto do nome entra como tema, para ajustar. O `@2x` que o Figma acrescenta é ignorado.

Os textos vêm de um `roteiro.txt` na pasta (também vale `legendas.txt` ou `linha-editorial.txt`, ou `.md`). Cada post é um bloco que começa com `# 01`, casado pelo número da arte; dentro dele, `data:`, `tema:`, `titulo:` e, por último, `legenda:`, que segue em quantas linhas precisar até o próximo `#`. Campo que faltar fica vazio. Sem roteiro, data, título e legenda ficam para preencher na mão.

```
# 01
data: 06/10
tema: Lançamento da coleção
titulo: Chegou a <em>coleção</em>
legenda:
Primeira linha da legenda.

Hashtags e emojis podem ir aqui.
```

A revisão avisa post sem bloco no roteiro, bloco sem arte na pasta, legenda acima de 2.200 caracteres e data com mais de 16.

O **Subir ajustes** também lê o roteiro. Com um `roteiro.txt` na pasta das artes corrigidas, cada bloco troca tema, título, legenda e data do post de mesmo número, junto com a arte. Só entra o que está preenchido e é diferente do atual: campo vazio no roteiro não apaga nada. Um bloco sem arte na pasta troca só o texto, e a arte continua. A revisão mostra o que muda em cada post antes de confirmar. Antes de subir nada, o painel mostra uma revisão com número, tema, dia e formato editáveis, marca quem já tem número igual no mês (desmarcado) e avisa quando o reel está sem capa ou o número foi deduzido. O leitor de nomes fica em `js/importar.js` e é coberto por `tests/importar.mjs`.

## Baixar os originais
Na lista de posts, **baixar** entrega os arquivos exatamente como foram enviados, sem compressão: imagem única sai como arquivo, carrossel sai em .zip com as lâminas numeradas na ordem, reel sai com vídeo e capa. Quem enxerga o post pode baixar. O .zip é montado no navegador com o JSZip (`js/vendor`, licença MIT).

## Onde as artes ficam
As artes novas vão para um bucket privado no **Cloudflare R2** (10 GB no plano gratuito, sem cobrança de tráfego) e são guardadas como `r2:<agencia>/<arquivo>`. As antigas (`midia:...` e URLs públicas antigas) continuam no Storage do Supabase e seguem funcionando. Texto, logins e aprovações ficam todos no Supabase.

O bucket é fechado. Quem serve os arquivos é o Worker em `worker/index.js` (`wrangler.jsonc`, deploy pelo próprio GitHub a cada push), que só aceita link assinado com HMAC-SHA256, válido por uma hora, para um caminho e um método só. Quem assina é o Supabase: a função `midia` (ler e enviar, conferindo `pode_ref` e `pode_enviar` com o token de quem pediu), a função `cliente` (prévia do cliente) e a função `limpeza` (apagar). O segredo `SIGN_SECRET` fica nos dois lados, Worker e Supabase, e nunca no repositório.

## Espaço e limpeza
Em **Espaço e limpeza** (só o administrador geral, porque a conta mostra o servidor inteiro) o painel mostra os dois lugares: as artes novas no R2 (10 GB) e o armazenamento antigo do Supabase (1 GB, que só diminui). Acima de 80% em qualquer um dos dois aparece um aviso no topo do painel. Duas ações: **apagar arquivos sem dono** varre os dois lugares (no Supabase pela lista do banco, no R2 comparando o inventário do bucket, `/lista` no Worker, com `refs_r2`) e remove o que nenhum post, cliente ou destaque referencia; arquivos da lista `midia_legada` nunca saem. **Arquivar mês** apaga as artes daquele mês dos dois lados, fecha o link do cliente e mantém post, tema, legenda e histórico de aprovação. As duas passam pela função `limpeza`, que confere o nível pelas funções `plano_limpeza` e `arquivar_mes` com o token de quem clicou. Não existe rotina automática: alguém precisa clicar.

## Fechaduras
O número e a data do post são limitados no banco a texto simples e curto, e a página do cliente escapa tudo o que vem do banco. As duas páginas carregam com uma política de conteúdo (CSP) que só deixa rodar script do próprio site. O código de primeiro acesso conta a tentativa no banco antes de conferir, numa operação só, então pedidos simultâneos não furam o limite de 5, e o código vale 48 horas. O Storage do Supabase não aceita mais envio novo: tudo que entra agora vai para o R2. O Worker responde a pedido de trecho (Range), que é o que o Safari do iPhone exige para tocar vídeo.

## Arquitetura
- GitHub Pages publica os arquivos estáticos em https://visttoapp.github.io/ (painel na raiz, página do cliente em `/c`). Ao alterar JS ou CSS, troque o `?v=` nos HTML para ninguém ficar com versão misturada em cache.
- Supabase Auth cuida dos logins. RLS isola agências, clientes, meses, posts, históricos e mídias, e aplica os níveis acima.
- A identidade de cada agência é escolhida pelo id em `js/brand.js`; os nomes vêm só do banco.
- O bucket `midia` é privado. A função `cliente` valida o token e assina só as mídias daquele conteúdo.
- A função `acessos` valida a sessão e o nível de quem cadastra antes de criar a conta. Ambas usam `verify_jwt=false` (ver `supabase/config.toml`); a chave privilegiada fica só no servidor.

### Banco
As migrações já aplicadas no projeto em uso ficam em `supabase/historico/` (`multi-agencias.sql`, `hierarquia.sql`, `squads.sql`, `convites.sql`, `divisoes.sql`, `gestores.sql`, `espaco.sql`, `r2.sql`, `endurecer.sql`, `espaco-r2.sql`, `anuncios.sql` e `pauta-e-linkedin.sql`, nesta ordem). **Não execute de novo.** Elas continuam no repositório porque os testes montam o banco a partir delas. Migração nova fica na raiz de `supabase/` até ser aplicada, e depois vai para `historico/`. `schema.sql` é a instalação completa para um banco novo.

Instalação nova: execute `schema.sql`, crie a primeira conta no Supabase Auth, cadastre o UUID em `administradores`, ajuste os nomes em `agencias`, configure `js/config.js` com a URL e a publishable key, publique as funções `cliente`, `acessos`, `primeiro-acesso`, `midia` e `limpeza` e configure a URL do site no Auth.

### Verificação
`npm install` e `npm test` na raiz. Os testes usam PGlite com usuários fictícios para conferir isolamento, níveis e funções.
