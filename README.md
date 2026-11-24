# AD Drop

Feed diário das campanhas publicitárias que estrearam no mundo, com calendário, filtro por região e modo teatro (filmes do YouTube e do Vimeo tocando em sequência; campanhas sem filme aparecem como card).

- `index.html`, `style.css`, `app.js`: o site, sem etapa de build.
- `campaigns.json`: a lista de campanhas.
- `novidades.json`: arquivo pequeno que o site confere a cada minuto; só baixa `campaigns.json` de novo quando ele muda.

## Como o site se atualiza sozinho (sem Claude)

- **Vigia, a cada minuto** (`.github/workflows/vigia.yml` + `robo/vigia.sh`): roda o robô em modo rápido (`RAPIDO=1`) a cada 60 segundos e publica na hora quando entra campanha nova. Lê os feeds (só baixa o que mudou), uma fatia dos canais de YouTube das agências e o Instagram. Cada job vigia por 5h40 e chama o próximo ao terminar; um agendamento a cada 20 min é a reserva caso a corrente quebre. Para desligar: Actions → "Vigia AD Drop" → Disable workflow.
- **De hora em hora** (`.github/workflows/atualizar.yml`): o trabalho pesado — arquivo histórico, buscas por sites novos, capas e carrosséis das campanhas antigas.

Publicado pelo GitHub Pages a partir da branch `main`, pasta raiz.

## Fontes monitoradas pelo robô (`robo/fontes.json`)

- `feeds`: veículos com feed RSS conhecido.
- `sites`: agências e veículos do mapa global. O robô procura o feed de cada site aos poucos (60 por rodada; quem não tem feed é testado de novo a cada 14 dias) e passa a ler os que têm.
- `agencias`: canais de YouTube das agências. Cada vídeo novo de campanha entra com filme. Canais novos são procurados aos poucos (40 por rodada) e só valem se o canal citar o site da agência ou parecer mesmo uma agência.
- `buscas`: buscas no Bing News que acham sites novos (vão para `descobertas`).

## Instagram (`robo/instagram.py`)

Usa a conta @addrop.feed (Business, ligada à Página "AD Drop") pela Graph API, com os secrets `IG_TOKEN` e `IG_USER_ID`.

- Acha sozinho, aos poucos, o Instagram de cada agência da lista `agencias` (as 338 do mapa global + Cannes/Adweek): primeiro o @ linkado no site da própria agência, depois `instagram_candidatos`, os @ do YouTube, o nome e variações (até 6 tentativas). As agências que não tinham sido achadas antes são procuradas de novo uma vez.
- Contas extras (marcas, veículos) podem ser postas à mão em `robo/fontes.json` → `"instagram": [{"usuario": "@conta", "nome": "Nome", "regiao": "Brasil", "cc": "BR"}]`.
- A Meta permite ~200 chamadas por hora; o vigia gasta 2 por minuto e pausa sozinho se a Meta avisar uso alto.
- Se o token vencer ou for recusado, o log do vigia mostra "INSTAGRAM: token recusado" e o resto do robô continua funcionando. Basta gerar um token novo e trocar o secret `IG_TOKEN`.

## Comentários (`supabase/comentarios.sql`)

Sistema próprio: os comentários ficam numa tabela do Supabase, e quem comenta entra com Google (Apple quando `APPLE_LOGIN = true` em `app.js`).

- Configuração em `app.js`: `SUPABASE_URL` e `SUPABASE_KEY` (a chave pública, que pode ficar no site). Vazios = a gaveta mostra "Comentários chegando em breve".
- O nome e a foto vêm da conta Google/Apple; cada pessoa pode comentar no máximo 5 vezes por minuto e apagar só os próprios comentários.
- Para esconder um comentário: Supabase → Table Editor → `comments` → marque `hidden`.
