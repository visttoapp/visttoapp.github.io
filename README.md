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
4. O painel mostra um código de 6 números (vale 7 dias). Envie para a pessoa o endereço do sistema, o e-mail cadastrado e o código.
5. A pessoa abre o sistema, clica em **Primeiro acesso**, digita e-mail e código e cria a própria senha (mínimo 8 caracteres).
6. Para várias pessoas, use **Cadastro em lote**: uma por linha, `Nome; e-mail; papel; squad`. Sai um código para cada uma.
7. Se a pessoa já tem conta sem agência, use **Autorizar conta existente**.
8. Na lista da equipe dá para trocar o papel, gerar **novo código** (a senha atual deixa de valer) ou remover o acesso de quem está abaixo de você.

Um e-mail é uma conta. Para ter contas separadas por agência com a mesma caixa do Gmail, use apelidos como `nome+1@gmail.com` e `nome+2@gmail.com`.

## Senhas
- **Primeiro acesso:** e-mail + código de 6 números gerado por quem cadastrou. O código vale 7 dias e bloqueia após 5 tentativas erradas.
- **Trocar a própria senha:** **trocar minha senha**, no rodapé da barra lateral.
- **Esqueceu a senha:** peça ao responsável um **novo código** (em Gerenciar equipe). O botão **Esqueci minha senha** manda link por e-mail, mas só funciona para qualquer endereço depois de configurar SMTP próprio no Supabase (Authentication › Emails › SMTP Settings).

## Clientes e aprovação
1. Head ou acima cria o cliente em **+ novo cliente**.
2. A equipe cria o mês, envia imagens ou MP4 (até 50 MB) e salva os posts.
3. Head ou acima marca **Publicado para o cliente** e usa **copiar link**.
4. O cliente abre o link, aprova, comenta ou pede ajuste.
5. No painel, **Atualizar aprovações** traz os retornos. Depois da correção, **marcar como ajustado** pede nova aprovação.

O link funciona como chave. **Invalidar link antigo e gerar outro** revoga o anterior. URLs temporárias de mídia já emitidas duram até uma hora. O status de um post só muda pela resposta do cliente ou por "marcar como ajustado".

## Importar a pasta do mês
Com o mês aberto, **Importar pasta** (no topo) lê uma pasta do computador e monta os posts. A regra: pasta com várias artes vira carrossel na ordem dos nomes, arte solta vira post de imagem, `.mp4` vira reel e puxa a capa de mesmo nome ou número. Pastas de categoria (`carrosseis`, `esteticos`, `feed`, `reels`, `stories`, `artes`…) são só organização e não viram post. Pastas de trabalho (`brutos`, `psd`, `editaveis`, `fontes`, `refs`, `backup`) e formatos fora de JPG, PNG, WebP, GIF e MP4 ficam de fora.

Do nome saem só o número (`01`, `1.`, `01 -`) e a ordem; o resto do nome entra como tema, para ajustar. Data, legenda e título ficam vazios de propósito, porque nem todo arquivo traz essa informação. Antes de subir nada, o painel mostra uma revisão com número, tema, dia e formato editáveis, marca quem já tem número igual no mês (desmarcado) e avisa quando o reel está sem capa ou o número foi deduzido. O leitor de nomes fica em `js/importar.js` e é coberto por `tests/importar.mjs`.

## Baixar os originais
Na lista de posts, **baixar** entrega os arquivos exatamente como foram enviados, sem compressão: imagem única sai como arquivo, carrossel sai em .zip com as lâminas numeradas na ordem, reel sai com vídeo e capa. Quem enxerga o post pode baixar. O .zip é montado no navegador com o JSZip (`js/vendor`, licença MIT).

## Onde as artes ficam
As artes novas vão para um bucket privado no **Cloudflare R2** (10 GB no plano gratuito, sem cobrança de tráfego) e são guardadas como `r2:<agencia>/<arquivo>`. As antigas (`midia:...` e URLs públicas antigas) continuam no Storage do Supabase e seguem funcionando. Texto, logins e aprovações ficam todos no Supabase.

O bucket é fechado. Quem serve os arquivos é o Worker em `worker/index.js` (`wrangler.jsonc`, deploy pelo próprio GitHub a cada push), que só aceita link assinado com HMAC-SHA256, válido por uma hora, para um caminho e um método só. Quem assina é o Supabase: a função `midia` (ler e enviar, conferindo `pode_ref` e `pode_enviar` com o token de quem pediu), a função `cliente` (prévia do cliente) e a função `limpeza` (apagar). O segredo `SIGN_SECRET` fica nos dois lados, Worker e Supabase, e nunca no repositório.

## Espaço e limpeza
O plano atual do Supabase guarda 1 GB de arquivos, com no máximo 50 MB por arquivo, e 5 GB de tráfego por mês. Em **Espaço e limpeza** (só o administrador geral, porque a conta mostra o total do servidor) o painel mostra o uso, quantos arquivos não estão em nenhum post e quantos meses passaram do prazo. Acima de 80% aparece um aviso no topo do painel. A conta cobre o Storage do Supabase; o R2 tem dez vezes mais espaço e é acompanhado no painel da Cloudflare.

Duas ações: **apagar arquivos sem dono** remove do servidor o que nenhum post, cliente ou destaque referencia (arquivos da lista `midia_legada` nunca saem), e **arquivar mês** limpa as artes daquele mês, fecha o link do cliente e mantém post, tema, legenda e histórico de aprovação. As duas passam pela função `limpeza`, que confere o nível pelas funções `plano_limpeza` e `arquivar_mes` com o token de quem clicou. Não existe rotina automática: alguém precisa clicar.

## Arquitetura
- GitHub Pages publica os arquivos estáticos em https://visttoapp.github.io/ (painel na raiz, página do cliente em `/c`). Ao alterar JS ou CSS, troque o `?v=` nos HTML para ninguém ficar com versão misturada em cache.
- Supabase Auth cuida dos logins. RLS isola agências, clientes, meses, posts, históricos e mídias, e aplica os níveis acima.
- A identidade de cada agência é escolhida pelo id em `js/brand.js`; os nomes vêm só do banco.
- O bucket `midia` é privado. A função `cliente` valida o token e assina só as mídias daquele conteúdo.
- A função `acessos` valida a sessão e o nível de quem cadastra antes de criar a conta. Ambas usam `verify_jwt=false` (ver `supabase/config.toml`); a chave privilegiada fica só no servidor.

### Banco
No projeto em uso, `multi-agencias.sql`, `hierarquia.sql`, `squads.sql`, `convites.sql`, `divisoes.sql`, `gestores.sql`, `espaco.sql` e `r2.sql` já foram aplicadas. **Não execute de novo.** `schema.sql` é a instalação completa para um banco novo.

Instalação nova: execute `schema.sql`, crie a primeira conta no Supabase Auth, cadastre o UUID em `administradores`, ajuste os nomes em `agencias`, configure `js/config.js` com a URL e a publishable key, publique as funções `cliente`, `acessos` e `primeiro-acesso` e configure a URL do site no Auth.

### Verificação
`npm install` e `npm test` na raiz. Os testes usam PGlite com usuários fictícios para conferir isolamento, níveis e funções.
