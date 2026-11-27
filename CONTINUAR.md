# droppad · guia completo para continuar o projeto (em outra conta do Claude)

Atualizado em 27/11/2026. Este arquivo explica **tudo** o que existe no projeto: o site, os robôs, as contas e serviços ligados, os segredos, as regras de conteúdo do Pedro, o que está pendente e como retomar o trabalho numa conta nova do Claude.

---

## 0. Resumo de 30 segundos

- **O que é:** https://dropp.ad, um feed das campanhas publicitárias que estrearam hoje no mundo. Cada campanha é um post com o filme tocando (YouTube, Vimeo, Instagram, TikTok), estilo rede social, com calendário para o arquivo.
- **Onde mora:** repositório GitHub **dropp-ad/droppad** (organização `dropp-ad`, branch `main`), publicado pelo GitHub Pages no domínio `dropp.ad`.
- **Quem atualiza:** robôs em Python que rodam sozinhos no GitHub Actions (a cada minuto e de hora em hora). **Não dependem do Claude nem de computador ligado.**
- **Dono:** Pedro Rosas (conta pessoal do GitHub `pedrorosas`; o repositório antigo era `pedrorosas/estreou-hoje`). Nomes antigos do projeto: "Estreou Hoje", "AD Drop", "Adrop", "dropp Ad".

---

## 1. Como retomar numa conta nova do Claude (passo a passo)

1. **GitHub:** na conta nova, conecte o GitHub (Configurações → Conectores → GitHub) com a conta que é dona da organização `dropp-ad`. Peça ao Claude: *"trabalhe no repositório dropp-ad/droppad; leia o CONTINUAR.md e o README.md antes de tudo"*. O GitHub é sempre mais atualizado que qualquer zip, porque os robôs publicam várias vezes por hora.
2. **Se o Claude não conseguir dar push**, peça para ele anexar o repositório com acesso de escrita ("add repo dropp-ad/droppad com push"). Se pedir confirmação, aprove.
3. **Claude in Chrome (extensão do navegador):** instale e entre com a conta nova. É por ela que o Claude mexe em sites onde você já está logado: LinkedIn, Make, Supabase, Namecheap, GitHub Settings (segredos).
4. **Memória/preferências:** cole numa conversa da conta nova a seção **6 (Regras do Pedro)** e peça "guarde isso na memória". Assim o Claude novo já sabe o que pode e o que não pode aparecer no feed.
5. **Se perder o acesso ao GitHub:** suba o zip do backup numa conversa e peça ao Claude para descompactar e ler este arquivo. Para republicar em outro repositório:
   ```
   git remote set-url origin https://github.com/NOVA-CONTA/NOVO-REPO.git
   git push -u origin main
   ```
   Depois: recadastrar os segredos da seção 3, ligar o GitHub Pages (Settings → Pages → Source: GitHub Actions) e apontar o DNS do dropp.ad na Namecheap para o GitHub Pages.

**Jeito de trabalhar com o Pedro:** ele manda prints do site com "não é pra mostrar post assim"; o Claude descobre o *tipo* de post e cria um filtro (nunca bloqueia a conta da agência), testa o filtro no feed inteiro para não pegar campanha de verdade, roda `python robo/limpar_feed.py` e publica. Quando ele diz "não publique ainda", o Claude só faz commit local e publica tudo junto quando ele pedir.

---

## 2. Contas, serviços e conectores

| Serviço | Para quê | Detalhes |
|---|---|---|
| **GitHub** (org `dropp-ad`, repo `droppad`) | código, campanhas, robôs, hospedagem | Pages publica pelo workflow `publicar.yml`. Domínio no arquivo `CNAME` (dropp.ad). |
| **Namecheap** | domínio `dropp.ad` e e-mail | E-mail **catch-all**: qualquer `@dropp.ad` (ex.: `contato@dropp.ad`) cai no Gmail do Pedro. DNS aponta para o GitHub Pages. |
| **Supabase** (projeto `lwbqnvmagcplfheabcqp`) | comentários, login Google, contador de acessos, formulário de contato | URL e chave pública em `app.js` (`SUPABASE_URL`, `SUPABASE_KEY`; podem ficar no site). Tabelas: `comments` (`supabase/comentarios.sql`), `visits` e `admins` (`supabase/acessos.sql`), `contacts` (formulário "fale com a gente"). Login Apple desligado (`APPLE_LOGIN = false`). Os dados (comentários, acessos) **não** estão no backup: exporte em CSV pelo Table Editor se quiser cópia. |
| **Painel** (`dropp.ad/painel.html`) | ver acessos do site | Só quem está na tabela `admins` vê. |
| **Meta / Instagram Graph API** | ler o Instagram de ~700 agências | Conta **@addrop.feed** (Business), ligada à Página do Facebook "AD Drop". Segredos `IG_TOKEN` e `IG_USER_ID`. O token vence: quando o log do vigia mostrar "INSTAGRAM: token recusado", gere outro na Meta e troque o segredo. |
| **Apify** (HarvestAPI) e **Coresignal** | posts do LinkedIn das agências e curadores (teste lado a lado, planos grátis) | Segredos `APIFY_TOKEN` e `CORESIGNAL_TOKEN`. Roda 2x por dia. Ainda não foi decidido qual dos dois fica. |
| **LinkedIn – Página droppAd** | perfil "Estreou hoje" que posta as campanhas | Página criada em 26/11/2026, ID **145513658**, admin: Pedro. Logo: o "d" do site. |
| **LinkedIn – app de desenvolvedor "droppAd Publisher"** | (opcional) postar pela API oficial | App ID 265168150, Client ID `77dg5f3a8dtvxn`, verificado pela Página, e-mail comercial `contato@dropp.ad` confirmado. O acesso "Community Management API" **não foi pedido**: o LinkedIn só aprova para empresa registrada (seria pela Rosas Publicidade, com CNPJ e endereço). Por isso usamos o Make. |
| **Make** (make.com, conta do Pedro via Google) | publicar na Página droppAd sem precisar de aprovação do LinkedIn | Cenário **"droppad → LinkedIn (Estreou hoje)"** (ID 7205858): Webhook → HTTP baixa a capa → LinkedIn "Create a Company Text Post" (tipo Article: link + título + capa) na Página droppAd, com a conexão "Pedro's LinkedIn connection". Webhook: guardado no segredo `LINKEDIN_WEBHOOK` (não divulgar: quem tem o link posta na Página). Plano grátis: ~1.000 operações/mês, 3 por post → limite de 10 posts/dia no robô. |
| **Google Search Console** | site no Google | Arquivo de verificação `google70ed4a174e58c73b.html`. Cada campanha tem página própria `/c/<id>/` e há `sitemap.xml` (gerados por `tools/paginas.py`). |
| **Claude in Chrome** | o Claude mexer nesses sites pelo navegador do Pedro | Extensão do Chrome, logada na mesma conta/organização do Claude. |

---

## 3. Segredos do GitHub (Settings → Secrets and variables → Actions)

| Segredo | Usado por | De onde vem |
|---|---|---|
| `IG_TOKEN` | vigia, ig-retroativo, ig-diagnostico, testar-instagram | Meta for Developers (token da conta @addrop.feed) |
| `IG_USER_ID` | mesmos | ID da conta @addrop.feed na Graph API |
| `APIFY_TOKEN` | linkedin-teste | apify.com → Settings → Integrations |
| `CORESIGNAL_TOKEN` | linkedin-teste | coresignal.com → API keys |
| `LINKEDIN_WEBHOOK` | linkedin-postar | endereço do webhook do cenário no Make |

Os segredos **não** vêm no backup e o Claude não consegue lê-los. Se o repositório continuar o mesmo, eles continuam lá.

---

## 4. Como o site funciona (arquivos)

- `index.html`, `style.css`, `app.js`: o site inteiro, sem build. Feed vertical tipo rede social; no celular trava em cada post.
  - **Ordem:** dia de estreia (mais novo primeiro) e, dentro do dia, **a campanha adicionada por último aparece primeiro**.
  - **Autoplay:** o filme toca sozinho quando o post para no centro. Tenta com som. Se o navegador barrar, toca mudo, e o primeiro toque na página liga o som; daí em diante os filmes já vêm com som.
  - **Tela cheia:** o YouTube tem a dele. Vimeo, Instagram e TikTok têm um botão próprio (canto de cima); no iPhone o quadro cobre a tela.
  - **Instagram:** no celular, tocar no vídeo abre o post no Instagram, e há o botão "Abrir no Instagram ↗".
  - **Idioma:** detecta o país do visitante e mostra o site e as campanhas em PT, EN ou ES (traduções em cada campanha, campo `tr`).
  - Comentários (Supabase), compartilhar com link `/c/<id>/`, calendário, modo 🔥 (views do YouTube), filtro Mundo/país.
- `campaigns.json`: todas as campanhas (os robôs escrevem aqui). `novidades.json`: o site confere a cada minuto e só baixa tudo de novo quando muda. `arquivo.json`: anos anteriores. `views.json`: visualizações para o modo 🔥.
- `tools/feed.py` gera o `feed.json` enxuto; `tools/paginas.py` gera as páginas `/c/`, `/es/c/`, `/en/c/`, o `sitemap.xml` e o `robots.txt` (na publicação, não ficam no repositório).
- `privacidade.html`: política de privacidade (usada também no app do LinkedIn).

---

## 5. Os robôs (`robo/`) e os workflows (`.github/workflows/`)

| Workflow | Quando | O que faz |
|---|---|---|
| `vigia.yml` + `robo/vigia.sh` | **a cada minuto** (cada job dura 5h40 e chama o próximo; cron a cada 20 min de reserva) | Roda `atualizar.py` em modo rápido: feeds de imprensa, Instagram (rodízio entre ~700 contas), 60 canais de YouTube por minuto (agências + marcas; volta completa em ~6 min). Antes de publicar algo só com imagem, procura o filme. Publica na hora. |
| `atualizar.yml` | de hora em hora (:17) | Trabalho pesado: buscas no Bing News, descoberta de sites, portfólios das agências, capas, carrosséis, textos completos. |
| `publicar.yml` | a cada push | Monta o site e publica no GitHub Pages. |
| `midia.yml` (`midia.py`) | de hora em hora (:27) | Procura filme (matéria, YouTube, outras matérias) para **toda** campanha recente sem filme, mesmo as que já têm imagem. |
| `clube.yml` (`clube.py`) | de hora em hora (:37) | Clube de Criação: acervo e campanhas novas, com filme. |
| `creditos.yml` (`creditos.py`) | de hora em hora (:57) | Ficha técnica das campanhas (créditos). |
| `traducoes.yml` (`traducoes.py`) | de hora em hora (:47) | Traduz título/resumo para EN e ES. |
| `views.yml` (`views.py`) | de hora em hora (:41) | Views do YouTube para o modo 🔥. |
| `ig-medidas.yml` (`ig_medidas.py`) | de hora em hora (:07) | Mede o recorte do vídeo dentro do embed do Instagram. |
| `ig-retroativo.yml` | a cada 6 h (reserva) | Puxa os últimos meses de cada conta de Instagram. |
| `linkedin-teste.yml` (`linkedin_teste.py`) | 2x por dia (8h13 e 20h13) | Posts do LinkedIn de agências e curadores (Apify x Coresignal) que viram campanha. Sem filme/imagem real (só o card azul "Posted on LinkedIn"), não entra. |
| `linkedin-postar.yml` (`linkedin_postar.py`) | :07 e :37 de cada hora | Manda 1 campanha do dia (filmes primeiro, até 10/dia, nunca repete) ao webhook do Make, que posta na Página droppAd. Texto: "Estreou hoje: “Nome”, de Marca, criada pela Agência. Veja o filme no droppad 👇 link #EstreouHoje #publicidade #Marca #Agência". Sem o segredo `LINKEDIN_WEBHOOK`, não faz nada. Estado em `robo/linkedin_postar.json`. |
| `ig-diagnostico`, `medir-ig`, `testar-instagram`, `prints` | manual | Diagnósticos. |

Para desligar qualquer um: Actions → nome do workflow → ⋯ → Disable workflow.

**Fontes** (`robo/fontes.json`): 60 feeds de imprensa (BR, LatAm, EUA, Europa, APAC, Oriente Médio), 308 sites, 373 agências (site, YouTube, Instagram), 704 contas de Instagram, **190 canais oficiais de marcas no YouTube** (GEICO, McDonald's, Coca-Cola, Itaú, Nubank, John Lewis, Telcel...; só entra vídeo com cara de comercial), 24 buscas de notícias, `ig_bloqueadas` (contas trocadas, ex.: `@crispin` é um músico, não a agência).

**Memória dos robôs** (não apagar): `robo/estado.json` (canais achados, descartadas), `robo/vigia.json` (rodízio, contas do Instagram achadas), `robo/midia.json`, `robo/clube.json`, `robo/creditos.json`, `robo/ig_retro.json`, `robo/linkedin_teste.json`, `robo/linkedin_postar.json`.

**Ferramentas úteis:**
- `python robo/limpar_feed.py --teste`: mostra o que os filtros atuais tirariam do feed. Sem `--teste`, tira de verdade (e junta repetidas). Rode depois de criar filtro novo.
- `robo/inspecionar.py <url>`: mostra o que o robô enxerga numa matéria.
- Campanha repetida: `deduplicar()` em `atualizar.py` roda **toda vez que o `campaigns.json` é salvo**. Junta a mesma campanha vinda de fontes diferentes (mesmo filme; ou mesma marca em 7 dias com 2+ palavras próprias em comum; ou mesma marca e agência de outra fonte). Fica a versão com filme e a data mais antiga; filmes diferentes da mesma campanha ficam juntos no mesmo post.

---

## 6. Regras do Pedro para o conteúdo (o Claude novo deve seguir)

**Só campanha.** Não entra:
- entrevista, podcast, Q&A, palestra, painel, "on stage", evento, premiação, prêmio/festival/finalista/shortlist;
- post institucional de agência: comemoração, foto da equipe, novos clientes, novos líderes, aniversário, vagas ("Looking for…", "we're hiring"), perfil de funcionário, post pessoal (formatura, "I'm honored…");
- case/"project spotlight" da agência, agência comentando campanha dos outros ("Coca-Cola ditched AI…", "lessons from", "our take");
- dica/tutorial de marketing ("Your LinkedIn Ads…", "Google Ads for…", "ad budget");
- agência falando de plataforma (Meta, Google, TikTok, ChatGPT…) ou data comemorativa (Thanksgiving, Natal) como se fosse marca;
- notícia de promoção de varejo (campanha de desconto/promocional, liquidação), de patrocínio/parceria sem peça, de entidade do mercado (confraternização da ABAP, posse de diretoria).

**Como tratar post errado:** barrar o **tipo** de post no robô, **nunca bloquear a conta da agência**. A exceção é quando o @ não é da agência (vai para `ig_bloqueadas`).

**Mídia:** sempre preferir o **filme**. Procurar o filme antes de publicar só com imagem, mesmo que esteja em outra matéria ou no YouTube da marca/agência. O vídeo tem que ser a peça, não entrevista sobre ela.

**Sem repetição:** a mesma campanha não aparece duas vezes (ex.: Elo/Sandy & Junior pelo Instagram da Almap e pelo Clube; Suzuki Jimny por dois veículos).

**Texto:** nunca copiar o texto da fonte, sempre reescrever. Créditos clicáveis em cada campanha (pendente).

**Fontes desejadas:** imprensa do mundo todo, sites/YouTube/Instagram das agências, canais das marcas, Clube de Criação, LinkedIn (agências e o curador Rian Swart). Paywall (ex.: Adweek): achar a mesma campanha em outro lugar.

**Site:** o post cabe na tela com o "Comentar" visível; a rolagem trava em cada post (inclusive depois de abrir comentários); ordem por quem entrou por último; autoplay com som; tela cheia em qualquer vídeo; idioma do país do visitante.

**Rumo:** roda sozinho para sempre, sem depender do Claude; lançamento mundial para profissionais, estudantes e fãs de publicidade; perfis "Estreou hoje" que postam sozinhos no LinkedIn (primeiro), Instagram, Threads e X, marcando agência e marca.

---

## 7. Pendências

1. **Ligar a postagem automática no LinkedIn:** ativar o cenário no Make (chave "Inactive" → ligado) e cadastrar o segredo `LINKEDIN_WEBHOOK` no GitHub (valor: o endereço do webhook do cenário, em Make → cenário → módulo Webhook). Depois disso o primeiro post sai sozinho no próximo :07 ou :37.
2. Marcar agência e marca nos posts do LinkedIn (o Make aceita menção `@[Nome](urn:li:organization:ID)`; falta o ID da Página de cada agência/marca).
3. Perfis automáticos no Instagram, Threads e X.
4. Créditos clicáveis na página de cada campanha.
5. Arquivo histórico de ~5 anos navegável pelo calendário.
6. Decidir entre Apify e Coresignal no LinkedIn (e talvez subir para 4 leituras por dia).
7. Achar o Instagram certo da agência Crispin (o robô procura sozinho).
8. (Opcional) tela de entrada com botão "Entrar", para o som valer desde o primeiro filme.
9. (Opcional) acesso oficial à API do LinkedIn pela Rosas Publicidade (CNPJ e endereço), dispensando o Make.

---

## 8. Histórico resumido do que foi feito

- Site criado como "Estreou Hoje" no GitHub do Pedro, depois "AD Drop", e por fim **droppad** com domínio dropp.ad e repositório na organização `dropp-ad`.
- Robôs: feeds, buscas, sites e portfólios de agências, YouTube de agências, Instagram (Graph API), Clube de Criação, LinkedIn (Apify/Coresignal), traduções, créditos, views, filmes e imagens.
- Nov/2026: vigia a cada minuto; feed estilo rede social com comentários (Supabase); idioma por país; páginas por campanha; ordem por entrada mais recente; filtros de não-campanha (vários tipos, seção 6); junção de repetidas; busca de filme antes da imagem; autoplay com som; tela cheia; 190 canais de marcas e 10 veículos novos; Página droppAd no LinkedIn + app de desenvolvedor + cenário no Make + robô de postagem.
