# droppad: como continuar de outra conta

Backup gerado em 26/11/2026, às 18h, com o repositório inteiro e o histórico completo de commits (pasta `.git`).

## 1. O que é

**dropp.ad** é um feed diário das campanhas publicitárias que estrearam no mundo. Cada campanha vira um post, com o filme tocando enquanto você rola. Os robôs rodam sozinhos no GitHub Actions, sem depender do Claude. O `README.md` explica a parte técnica.

## 2. Onde cada coisa mora

| O quê | Onde |
|---|---|
| Código, campanhas e robôs | GitHub, repositório **dropp-ad/droppad** (organização dropp-ad), branch `main` |
| Hospedagem | GitHub Pages, a partir da `main` (arquivo `CNAME` = dropp.ad) |
| Domínio e e-mail @dropp.ad | Namecheap; o e-mail é catch-all e encaminha para o Gmail do Pedro |
| Comentários e acessos | Supabase (projeto `lwbqnvmagcplfheabcqp`); a estrutura das tabelas está em `supabase/*.sql` |
| Instagram (leitura das agências) | Conta @addrop.feed (Business), ligada à Página "AD Drop" no Facebook, via Graph API |
| LinkedIn (teste) | Apify e Coresignal (planos gratuitos) |

## 3. Segredos que NÃO vêm no backup

Ficam em GitHub → repositório → Settings → Secrets and variables → Actions:

- `IG_TOKEN`: token da Graph API da Meta (vence; quando vencer, gere outro)
- `IG_USER_ID`: ID da conta @addrop.feed
- `APIFY_TOKEN`
- `CORESIGNAL_TOKEN`

Se o repositório continuar no GitHub, os segredos continuam lá e não há nada a fazer. Só será preciso cadastrar de novo se o repositório for recriado do zero.

Os comentários e os acessos já gravados ficam no Supabase. Para ter cópia desses dados, use Supabase → Table Editor → exportar CSV.

## 4. Como retomar com outra conta do Claude

**Caminho mais simples:** na conta nova, conecte o GitHub e peça para trabalhar no repositório `dropp-ad/droppad`. O GitHub está sempre mais atualizado que este zip, porque os robôs publicam várias vezes por hora.

**Se o acesso ao GitHub se perder:** suba este zip numa conversa e peça ao Claude para descompactar e ler o `CONTINUAR.md` e o `README.md`. Para republicar em outro repositório:

```
git remote set-url origin https://github.com/NOVA-CONTA/NOVO-REPO.git
git push -u origin main
```

Depois disso, cadastre os 4 segredos da seção 3, ative o GitHub Pages e aponte o DNS do dropp.ad na Namecheap para o GitHub Pages.

## 5. Regras do Pedro para o site (o Claude da conta nova deve seguir)

**O que entra no feed**
- Só campanhas. Fica de fora:
  - entrevista ou podcast;
  - post institucional de agência (comemoração, foto da equipe, novos clientes, vagas, aniversário);
  - evento, painel, palestra ou premiação;
  - agência falando de prêmio, festival, finalista ou shortlist;
  - dica ou tutorial de marketing ("Your LinkedIn Ads…", "Google Ads for…");
  - post pessoal de funcionário (formatura, "I'm honored to join…") ou perfil de alguém da equipe;
  - notícia de promoção de varejo (campanha de desconto, campanha promocional, liquidação);
  - vaga ("Looking for Project Managers…"), podcast ou Q&A, "project spotlight" e case de agência;
  - agência falando de plataforma (Meta, Google, TikTok, ChatGPT) ou de data comemorativa (Thanksgiving) como se fosse marca;
  - evento de entidade do mercado (confraternização da ABAP, posse de diretoria).
- Depois de criar um filtro novo, rode `python robo/limpar_feed.py` para tirar do feed o que já tinha entrado.
- Quando aparecer um post desses, barre o **tipo** de post no robô. Não bloqueie a conta da agência.
- A exceção é quando a conta está trocada: o @ não é da agência (como o @crispin, que é de um músico). Nesse caso, ponha o @ em `robo/fontes.json` → `ig_bloqueadas`.
- Nunca copie o texto da fonte; sempre reescreva.
- Cada campanha deve vir com o filme ou a imagem, buscando em outros sites se a fonte não trouxer. O vídeo tem que ser a peça, não uma entrevista sobre ela.

**Fontes**
- Feeds de veículos.
- Sites, YouTube e Instagram das agências.
- Clube de Criação.
- LinkedIn: agências e o curador Rian Swart.
- Quando a fonte tem paywall, achar a mesma campanha em outro lugar.

**Visual e uso**
- O post tem que caber na tela com o botão "Comentar" visível.
- A rolagem sempre trava em cada post, inclusive depois de abrir os comentários.
- Posts do Instagram:
  - no celular, tocar no vídeo abre o post no Instagram;
  - o botão "Abrir no Instagram ↗" fica embaixo do vídeo.
- O site detecta o país do visitante e aparece no idioma dele, com as campanhas traduzidas (começando por inglês e espanhol).

**Rumo**
- O site roda sozinho para sempre, sem depender do Claude.
- Lançamento mundial para profissionais, estudantes e fãs de publicidade.

## 6. Pendências em aberto

- Créditos clicáveis na página de cada campanha (ainda não publicado).
- Arquivo histórico de uns 5 anos para trás, navegável pelo calendário.
- Perfis automáticos "Estreou hoje" do droppad no LinkedIn (primeiro), Instagram, Threads e X, marcando agência e marca.
- Decidir entre Apify e Coresignal no teste de LinkedIn.
- Achar o Instagram certo da agência Crispin (o robô está procurando sozinho).
