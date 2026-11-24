# AD Drop

Feed diário das campanhas publicitárias que estrearam no mundo, com calendário, filtro por região e modo teatro (filmes do YouTube e do Vimeo tocando em sequência; campanhas sem filme aparecem como card).

- `index.html`, `style.css`, `app.js`: o site, sem etapa de build.
- `campaigns.json`: a lista de campanhas. É o único arquivo que a atualização diária altera.

Publicado pelo GitHub Pages a partir da branch `main`, pasta raiz.

## Fontes monitoradas pelo robô (`robo/fontes.json`)

- `feeds`: veículos com feed RSS conhecido.
- `sites`: agências e veículos do mapa global. O robô procura o feed de cada site aos poucos (60 por rodada; quem não tem feed é testado de novo a cada 14 dias) e passa a ler os que têm.
- `agencias`: canais de YouTube das agências. Cada vídeo novo de campanha entra com filme. Canais novos são procurados aos poucos (40 por rodada) e só valem se o canal citar o site da agência ou parecer mesmo uma agência.
- `buscas`: buscas no Bing News que acham sites novos (vão para `descobertas`).
