#!/usr/bin/env python3
"""Robô do droppad: atualiza campaigns.json sozinho, sem IA.

Roda no GitHub Actions. A cada execução:
  1. Lê os feeds RSS das fontes (robo/fontes.json) e as notícias do Bing News
     para buscas em vários idiomas (é assim que acha lugares novos).
  2. Fica só com o que parece campanha (filtro por palavras) e descarta prêmios,
     contratações, contas etc.
  3. Abre cada matéria e pega os filmes (YouTube / Vimeo) que estão na página.
  4. Acrescenta as novas em campaigns.json, sem apagar nada.
  5. Testa os sites novos que apareceram nas buscas; se tiverem feed, passam a
     ser fontes fixas (lista "descobertas" em fontes.json).
  6. Arquivo histórico: em cada execução volta algumas páginas nos feeds, até
     ARQUIVO_INICIO, para preencher os dias antigos.

Só usa a biblioteca padrão do Python.
"""
import concurrent.futures as cf
import datetime as dt
import email.utils
import html
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAMP = os.path.join(RAIZ, "campaigns.json")
FONTES = os.path.join(RAIZ, "robo", "fontes.json")
ESTADO = os.path.join(RAIZ, "robo", "estado.json")
TZ = ZoneInfo("America/Sao_Paulo")
ARQUIVO_INICIO = "2020-11-17"   # 6 anos de arquivo (era 2025-11-17; ampliado em nov/2026)
JANELA_DIAS = 10          # no modo normal, aceita campanhas de até 10 dias atrás
MAX_MATERIAS = 300        # matérias abertas por execução (para achar filmes)
MAX_NOVAS = 300           # campanhas novas por execução (= MAX_MATERIAS, para nenhuma matéria aberta ficar sem análise)
PAGINAS_ARQUIVO = 4       # páginas antigas por feed em cada execução
MES_INICIO_ARQUIVO_MES = "2025-11"  # o arquivo por mês desce daqui até ARQUIVO_INICIO
PAGINAS_POR_MES = 6       # no máximo 60 matérias por mês por fonte (as de campanha passam no filtro)
BUSCAS_POR_RODADA = 6
TESTES_DESCOBERTA = 8     # sites novos testados por rodada
MAX_POR_FONTE_DIA = 5     # para nenhuma fonte dominar o dia
SITES_POR_RODADA = 60     # sites de agências/veículos testados por rodada (procura o feed de cada um)
NOVOS_CANAIS_POR_RODADA = 40  # canais de YouTube de agências procurados pela primeira vez por rodada
RETESTE_DIAS = 14         # site sem feed é testado de novo depois de N dias
SIMULAR = bool(os.environ.get("SIMULAR"))
# Modo rápido (vigia que roda a cada minuto): só o que é novo nas fontes já conhecidas
# (feeds, canais do YouTube, Instagram). O trabalho pesado (arquivo histórico, buscas,
# descobrir sites, capas antigas) continua na execução de hora em hora.
RAPIDO = bool(os.environ.get("RAPIDO"))
VIGIA = os.path.join(RAIZ, "robo", "vigia.json")
NOVIDADES = os.path.join(RAIZ, "novidades.json")
CANAIS_POR_MINUTO = 30    # canais de YouTube lidos por rodada no modo rápido (todos a cada ~5 min)
MATERIAS_RAPIDO = 40      # matérias abertas por rodada no modo rápido
MAX_VISTOS = 4000
UA = "Mozilla/5.0 (compatible; droppadBot/1.0; +https://dropp.ad)"

AGORA = dt.datetime.now(dt.timezone.utc)
HOJE = AGORA.astimezone(TZ).date()
LOG = []


def log(*a):
    s = " ".join(str(x) for x in a)
    LOG.append(s)
    print(s, flush=True)


def baixar(url, timeout=20, limite=3_000_000, cond=None):
    """Baixa a página. Com cond (dicionário url → {etag, mod}), pede só se mudou: devolve None se não mudou."""
    cab = {"User-Agent": UA, "Accept": "*/*", "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8,es;q=0.7"}
    ant = (cond or {}).get(url) or {}
    if ant.get("etag"):
        cab["If-None-Match"] = ant["etag"]
    if ant.get("mod"):
        cab["If-Modified-Since"] = ant["mod"]
    req = urllib.request.Request(url, headers=cab)
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        if e.code == 304 and cond is not None:
            return None
        raise
    with r:
        dados = r.read(limite)
        cs = r.headers.get_content_charset() or "utf-8"
        if cond is not None:
            novo = {k: v for k, v in (("etag", r.headers.get("ETag")), ("mod", r.headers.get("Last-Modified"))) if v}
            if novo:
                cond[url] = novo
            else:
                cond.pop(url, None)
    try:
        return dados.decode(cs, "replace")
    except LookupError:
        return dados.decode("utf-8", "replace")


def ler_json(p, padrao):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return padrao


def salvar_json(p, obj):
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")


# ---------------------------------------------------------------- texto
def limpar(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    s = html.unescape(html.unescape(s))
    return re.sub(r"\s+", " ", s).strip()


def sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def slug(s, n=40):
    s = re.sub(r"[^a-z0-9]+", "-", sem_acento(s).lower()).strip("-")
    return s[:n].strip("-") or "campanha"


def chave(s):
    return re.sub(r"[^a-z0-9]", "", sem_acento(s).lower())


def primeira_frase(s, n=240):
    s = limpar(s)
    s = re.sub(r"(The post|O post|La entrada|L'article) .* (appeared first on|apareceu primeiro em|aparece primero en).*$", "", s).strip()
    m = re.match(r"(.{40,}?[.!?])(\s|$)", s)
    s = m.group(1) if m else s
    return s if len(s) <= n else s[: n - 1].rsplit(" ", 1)[0] + "…"


# ---------------------------------------------------------------- filtro
FORTE = re.compile(r"""(\bcampaign|\bcampanha|\bcampaña|\bcampagne|\bkampagne|\bcampagna|\bads?\b|\badvert|\bspots?\b|\btvc\b|
    \bcommercials?\b|\bcomerciais\b|\bcomercial\b|\bfilme\b|\bfilm\b|\banúncio|\banuncio|\bpublicidade|\bpublicitári|\bpublicitari|
    \bactivation|\bativação|\bactivación|\bbrand\s+film|\bnew\s+work\b|\bjingle|\bmanifesto|\bmanifiesto|\bwerbung|\bpub\b|\bstunt\b|\bOOH\b)""", re.I | re.X)
EXCLUI = re.compile(r"""\b(award|awards|winners?|shortlist|jury|júri|jurado|prêmio|premio|premiação|premiados|effie|lions|
    appoint(s|ed|ment)?|hires?|hired|promot(es|ed|ion)|joins|named|contrata|contratação|nomeia|nomeado|assume|ficha|nombra|nombramiento|
    ceo|cmo|cco|cfo|diretora?|director|directora|head\s+of|vice-?president|executiv[oa]s?|
    wins?|won|bags|retains|mandate|commissions|aor|agency\s+of\s+record|pitch|conquista|gana|account|licitação|concorrência|
    study|survey|report|research|estudo|pesquisa|relatório|estudio|encuesta|informe|dados|data\s+shows|
    podcast|webinar|interview|entrevista|opinion|opinião|opinión|column|coluna|obituary|layoffs?|demissões|
    revenue|earnings|lucro|faturamento|vendas\s+crescem|acquires|acquisition|aquisição|adquiere|merger|fusão|ipo|
    trailer|tráiler|teaser\s+trailer|bilheteria|taquilla|box\s+office|cinemas|ingressos|boletos|estreno\s+de|reality|novela|série|serie\s+de|episódio|
    conference|conferência|congresso|summit|evento|festival|ranking|top\s+\d+|melhores|best\s+ads|lo\s+mejor|semana|week'?s|weekly|roundup|
    tendências|tendencias|trends?|estratégias|estrategias|desafi\w+|mercado\s+de|setor|sector|investimento|inversión|guide|guia|guía|
    conversa|charla|habla\s+de|habla\s+sobre|explica|explains|talks|shares\s+how|on\s+how|insights?|
    panel|painel|keynote|palestra|awlatam|masterclass|depoimento|testimonial|
    afiliada|fidelidade|equipe\s+comercial|equipo\s+comercial|reforça\s+equipe|screens?|telas?|pantallas?|
    agent|agente|agentes|retail\s+media|media\s+bill|calls\s+for|crece|cresce|grows|growth|reúne\s+membros|studio|
    associação|asociación|association|sindicato|regulação|regulación|regulation|lei|ley|law|loyalty\s+program|app\s+update|tutorial|dicas|tips|curso|course|vagas|jobs)\b""", re.I | re.X)
ENTREVISTA = re.compile(r"\b(entrevista|entrevistado|interview|interviewed|bate-papo|conversamos|conversou com|charlamos|en diálogo con|platicamos|"
                        r"sits down with|in conversation with|q&a|podcast|depoimento|testimonial)\b", re.I)
PERGUNTA = re.compile(r"(\?|¿|^(why|how|what|when|is|are|can|should|por\s+que|porque|como|cómo|qué|que|o\s+que|quando|quem)\b|^(en|in|em)\s+(19|20)\d\d\b)", re.I)


def parece_campanha(titulo, resumo="", so_campanhas=False):
    if EXCLUI.search(titulo) or PERGUNTA.search(titulo.strip()):
        return False
    if so_campanhas:
        return True
    return bool(FORTE.search(titulo))


# ---------------------------------------------------------------- marca / agência / país
VERBOS = r"(?:apela|appeals|presentan|lanzan|lançam|apresentam|estrelam|unen|unem|transforms?|transforma|convierte|leva|levou|reúne|chama|homenageia|promove|mostra|muestra|invites?|shows?|puts?|helps?|launch(?:es|ed)?|unveil(?:s|ed)?|debut(?:s|ed)?|rolls? out|introduces?|releases?|drops?|celebrates?|returns?|teams up|taps|turns|brings|goes|gets|makes|asks|wants|lança|lançou|apresenta|estreia|celebra|aposta|traz|convida|faz|ganha|lanza|presenta|estrena|apuesta|celebra|invita|lance|dévoile|présente|startet|zeigt)"


NAO_MARCA = {"black friday", "cyber monday", "natal", "navidad", "christmas", "noel", "noël", "outdoor", "marketing", "publicidade",
             "publicidad", "campanha", "campaign", "campaña", "the", "new", "nova", "novo", "nueva", "nuevo", "why", "how", "ia", "ai",
             "australian", "american", "british", "global", "holiday", "festive", "brasil", "brazil", "méxico", "mexico", "argentina",
             "españa", "spain", "uk", "us", "eua", "india", "this", "esta", "este", "a", "o", "el", "la", "le", "les", "os", "as",
             "black", "friday", "dia", "day", "mundial", "copa", "vantagens", "brand", "marca", "marcas", "brands", "agency", "agência", "agencia",
             "film", "filme", "spot", "case", "case study", "commercial", "comercial", "tvc", "ad", "ads", "video", "vídeo", "official", "oficial"}


def marca_ok(m):
    m = re.sub(r"\s+(campaign|campanha|campaña|ad|ads)$", "", (m or "").strip(" \"'“”‘’.,"), flags=re.I)
    if re.search(r"[.!?]\s|-based$|^\d+$", m):
        return ""
    if not m or len(m) > 40 or len(m.split()) > 4:
        return ""
    if sem_acento(m).lower() in {sem_acento(x) for x in NAO_MARCA}:
        return ""
    if sem_acento(m.split()[0]).lower() in {"navidad", "natal", "christmas", "black", "halloween", "verano", "verao", "summer", "dia", "copa", "mundial"}:
        return ""
    if not re.match(r"[A-Z0-9À-Ý]", m):
        return ""
    return m


def marca_de(titulo):
    t = titulo.strip(" \"'“”‘’")
    m = re.match(r"^([^:|–—]{2,40})\s*[:|–—]\s+[\"'“‘]", t)
    if m and marca_ok(m.group(1)):
        return marca_ok(m.group(1))
    m = re.match(r"^([A-Z0-9À-Ý][\w&'’.\-À-ÿ]*(?:\s+(?:[A-Z0-9À-Ý&][\w&'’.\-À-ÿ]*|de|do|da|of|the|y|e|&)){0,3}?)(?:'s|’s)?\s+(?:new\s+|nova\s+|novo\s+|nueva\s+|nuevo\s+)?" + VERBOS + r"\b", t)
    if m and marca_ok(m.group(1)):
        return marca_ok(m.group(1))
    m = re.search(r"\b(?:campanha|campaña|campagne|filme|anúncio|anuncio|comercial|spot)\s+(?:d[aoe]s?|del|de\s+la)\s+([A-Z0-9][\w&'’.\-À-ÿ]*(?:\s+[A-Z0-9][\w&'’.\-À-ÿ]*){0,2})", t)
    if m and marca_ok(m.group(1)):
        return marca_ok(m.group(1))
    m = re.search(r"([A-Z0-9][\w&'’.\-À-ÿ]*(?:\s+[A-Z0-9][\w&'’.\-À-ÿ]*){0,2})(?:'s|’s)\s+(?:\w+\s+){0,3}(?:campaign|ad|spot|film)\b", t)
    if m and marca_ok(m.group(1)):
        return marca_ok(m.group(1))
    if ": " in t:
        r = marca_de(t.split(": ", 1)[1])
        if r:
            return r
    m = re.search(r"\b(?:for|para|pour|für)\s+([A-Z][\w&'’.\-À-ÿ]*(?:\s+[A-Z][\w&'’.\-À-ÿ]*){0,2})", t)
    if m and marca_ok(m.group(1)):
        return marca_ok(m.group(1))
    return ""


AGENCIA_RE = [
    r"\b(?:via|by|from|thanks to|assinad[ao] pela?|criad[ao] pela?|desenvolvid[ao] pela?|produzid[ao] pela?|da agência|pela agência|de la agencia|por la agencia|firmad[ao] por|creada por|signée|par l'agence)\s+([A-Z][\w&'’.+\-À-ÿ]*(?:\s+(?:[A-Z&][\w&'’.+\-À-ÿ]*|de|do|da|and|y|e|&)){0,4})",
]


def agencia_de(texto):
    for r in AGENCIA_RE:
        m = re.search(r, texto)
        if m:
            a = re.split(r"[.;,]\s", m.group(1))[0].strip(" .,;")
            if 1 < len(a) <= 50:
                return a
    return ""


PAISES = [  # (padrão, nome em pt, ISO)
    (r"brasil|brazil", "Brasil", "BR"), (r"méxico|mexico|mexican[ao]?", "México", "MX"),
    (r"argentina", "Argentina", "AR"), (r"colombia|colômbia", "Colômbia", "CO"), (r"chile", "Chile", "CL"),
    (r"per[uú]", "Peru", "PE"), (r"ecuador|equador", "Equador", "EC"), (r"uruguai|uruguay", "Uruguai", "UY"),
    (r"espa[ñn]a|spain|espanha", "Espanha", "ES"), (r"portugal", "Portugal", "PT"),
    (r"\buk\b|united kingdom|britain|british|reino unido|london|londres", "Reino Unido", "GB"),
    (r"ireland|irlanda|irish", "Irlanda", "IE"), (r"fran[cç]e?a?|french|paris", "França", "FR"),
    (r"germany|alemanha|alemania|german|deutschland", "Alemanha", "DE"), (r"ital[yi]a?|italian", "Itália", "IT"),
    (r"netherlands|holanda|dutch|países baixos", "Países Baixos", "NL"), (r"sweden|suécia|swedish", "Suécia", "SE"),
    (r"norway|noruega|norwegian", "Noruega", "NO"), (r"denmark|dinamarca|danish", "Dinamarca", "DK"),
    (r"poland|polônia|polish", "Polônia", "PL"), (r"belgi", "Bélgica", "BE"),
    (r"canad", "Canadá", "CA"), (r"\bus\b|\busa\b|u\.s\.|united states|estados unidos|eua|eeuu|american", "EUA", "US"),
    (r"australia|austrália|aussie", "Austrália", "AU"), (r"new zealand|nova zelândia|nueva zelanda|\bnz\b|kiwi", "Nova Zelândia", "NZ"),
    (r"india|índia|indian", "Índia", "IN"), (r"singapore|singapura", "Singapura", "SG"), (r"japan|japão|japón|japanese", "Japão", "JP"),
    (r"korea|coreia|corea", "Coreia do Sul", "KR"), (r"china|chinese", "China", "CN"), (r"hong kong", "Hong Kong", "HK"),
    (r"thailand|tailândia|thai", "Tailândia", "TH"), (r"malaysia|malásia", "Malásia", "MY"), (r"indonesia", "Indonésia", "ID"),
    (r"philippines|filipinas", "Filipinas", "PH"), (r"vietnam|vietnã", "Vietnã", "VN"),
    (r"\buae\b|dubai|emirates|emirados", "Emirados Árabes", "AE"), (r"saudi|saudita", "Arábia Saudita", "SA"),
    (r"south africa|áfrica do sul|sudáfrica", "África do Sul", "ZA"), (r"nigeria", "Nigéria", "NG"), (r"kenya|quênia", "Quênia", "KE"),
]

TLD = {"br": ("Brasil", "BR"), "mx": ("México", "MX"), "ar": ("Argentina", "AR"), "co": ("Colômbia", "CO"), "cl": ("Chile", "CL"),
       "pe": ("Peru", "PE"), "es": ("Espanha", "ES"), "pt": ("Portugal", "PT"), "uk": ("Reino Unido", "GB"), "ie": ("Irlanda", "IE"),
       "fr": ("França", "FR"), "de": ("Alemanha", "DE"), "it": ("Itália", "IT"), "nl": ("Países Baixos", "NL"), "se": ("Suécia", "SE"),
       "au": ("Austrália", "AU"), "nz": ("Nova Zelândia", "NZ"), "in": ("Índia", "IN"), "sg": ("Singapura", "SG"), "jp": ("Japão", "JP"),
       "kr": ("Coreia do Sul", "KR"), "za": ("África do Sul", "ZA"), "ae": ("Emirados Árabes", "AE"), "ca": ("Canadá", "CA"),
       "ch": ("Suíça", "CH"), "at": ("Áustria", "AT"), "be": ("Bélgica", "BE"), "dk": ("Dinamarca", "DK"), "no": ("Noruega", "NO"),
       "pl": ("Polônia", "PL"), "uy": ("Uruguai", "UY"), "ec": ("Equador", "EC"), "my": ("Malásia", "MY"), "ph": ("Filipinas", "PH"),
       "th": ("Tailândia", "TH"), "id": ("Indonésia", "ID"), "hk": ("Hong Kong", "HK"), "tr": ("Turquia", "TR")}


def pais_por_dominio(dom):
    fim = dom.rsplit(".", 1)[-1]
    return TLD.get(fim, ("Global", ""))


def pais_por_texto(texto, padrao):
    for pad, nome, cc in PAISES:
        if re.search(r"(?<![\w])(?:" + pad + r")", texto, re.I):
            if nome == "EUA" and padrao[1] not in ("", "US", "GB"):
                continue  # "american" aparece demais em texto estrangeiro
            return nome, cc
    return padrao


# ---------------------------------------------------------------- feeds
def tag(e):
    return e.tag.rsplit("}", 1)[-1]


def filho(e, *nomes):
    for c in e:
        if tag(c) in nomes:
            return c
    return None


def texto_de(e, *nomes):
    c = filho(e, *nomes)
    return (c.text or "").strip() if c is not None and c.text else ""


def data_de(s):
    s = (s or "").strip()
    if not s:
        return None
    try:
        d = email.utils.parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.timezone.utc)
    return d.astimezone(TZ).date().isoformat()


def ler_feed(xml):
    xml = re.sub(r"^[^<]+", "", xml)
    raiz = ET.fromstring(xml.encode("utf-8"))
    itens = []
    for e in raiz.iter():
        if tag(e) not in ("item", "entry"):
            continue
        titulo = limpar(texto_de(e, "title"))
        link = texto_de(e, "link")
        if not link:
            l = filho(e, "link")
            if l is not None:
                link = l.get("href", "")
        corpo = ""
        for c in e:
            if tag(c) == "encoded" and c.text:
                corpo = c.text
        resumo = texto_de(e, "description", "summary", "content")
        data = data_de(texto_de(e, "pubDate", "published", "updated", "date"))
        if titulo and link.startswith("http") and data:
            itens.append({"titulo": titulo, "link": link.strip(), "resumo": resumo, "corpo": corpo, "data": data})
    return itens


def parece_feed(txt):
    return bool(re.search(r"<(rss|feed|rdf:RDF)[\s>]", txt[:2000]))


def pegar_feed(fonte, estado, pagina=1, cond=None):
    """Tenta as URLs da fonte (lembra a que funcionou) e devolve os itens.
    Com cond (modo rápido), devolve [] quando o feed não mudou desde a última leitura."""
    st = estado["feeds"].setdefault(fonte["nome"], {})
    urls = ([st["url"]] if st.get("url") else []) + [u for u in fonte["urls"] if u != st.get("url")]
    if cond is not None and st.get("url"):
        urls = [st["url"]]  # no modo rápido, só a URL que já funciona (as outras ficam para a execução de hora em hora)
    for u in urls:
        alvo = u
        if pagina > 1:
            alvo = u + ("&" if "?" in u else "?") + "paged=%d" % pagina
        try:
            txt = baixar(alvo, timeout=12 if cond is not None else 20, cond=cond)
            if txt is None:
                return []
            if not parece_feed(txt):
                continue
            itens = ler_feed(txt)
            if pagina == 1:
                st["url"], st["falhas"] = u, 0
            return itens
        except Exception:  # noqa: BLE001
            continue
    if pagina == 1:
        st["falhas"] = st.get("falhas", 0) + 1
    return None


def buscar_bing(q):
    url = "https://www.bing.com/news/search?" + urllib.parse.urlencode({"q": q, "format": "rss", "setlang": "pt-br", "qft": 'interval="7"'})
    itens = []
    for it in ler_feed(baixar(url)):
        link = it["link"]
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(link).query)
        if "url" in qs:
            link = qs["url"][0]
        it["link"] = link
        itens.append(it)
    return itens


# ---------------------------------------------------------------- filmes
YT = re.compile(r"(?:youtube(?:-nocookie)?\.com/(?:embed/|watch\?v=|shorts/|v/)|youtu\.be/)([\w-]{11})")
VIMEO = re.compile(r"player\.vimeo\.com/video/(\d+)(?:\?h=([0-9a-f]+))?|vimeo\.com/(\d{6,})(?:/([0-9a-f]{6,}))?")


INSTA = re.compile(r"instagram\.com/(p|reel|reels|tv)/([\w-]{6,})")
TIKTOK = re.compile(r"tiktok\.com/@[\w.-]+/video/(\d{8,})")


def filmes_de(pagina):
    """IDs do YouTube e, se não houver, um vídeo de Vimeo, Instagram ou TikTok embutido."""
    yts = []
    for m in YT.finditer(pagina):
        if m.group(1) not in yts:
            yts.append(m.group(1))
    video = ""
    for m in VIMEO.finditer(pagina):
        vid, h = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
        video = "https://vimeo.com/%s/%s" % (vid, h) if h else "https://vimeo.com/%s" % vid
        break
    if not video:
        m = re.search(r"vumbnail\.com(?:/|%2F)(\d{6,})", pagina)
        if m:
            video = "https://vimeo.com/" + m.group(1)
    if not video:
        m = INSTA.search(pagina)
        if m:
            video = "https://www.instagram.com/%s/%s/" % ("reel" if m.group(1).startswith("reel") else m.group(1), m.group(2))
    if not video:
        m = TIKTOK.search(pagina)
        if m:
            video = "https://www.tiktok.com/" + m.group(0).split("tiktok.com/", 1)[1]
    return yts[:4], video


INICIO_MIOLO = re.compile(r'class="[^"]*\b(entry-content|post-content|article-body|article__body|articleBody|single-content|td-post-content|'
                          r'elementor-widget-theme-post-content|post-body|post__content|content-text|materia-conteudo|texto-materia|'
                          r'news-content|article-content|story-body|rich-text)\b', re.I)
FIM_MIOLO = re.compile(r'class="[^"]*\b(related|relacionad|jp-relatedposts|sharedaddy|share-|comments?-area|comentarios|post-tags|'
                       r'tags-links|newsletter|author-box|elementor-widget-post-navigation|elementor-widget-posts|leia-tambem|veja-tambem)|<footer\b', re.I)


def corpo_da_materia(pagina):
    """Pega só o miolo da matéria (para não pegar vídeo nem foto da barra lateral ou dos relacionados)."""
    m = INICIO_MIOLO.search(pagina)
    if m:
        ini = pagina.rfind("<", 0, m.start())
        fim = FIM_MIOLO.search(pagina, m.end())
        trecho = pagina[ini: fim.start() if fim else ini + 80000]
        if len(limpar(trecho)) > 300:
            return trecho
    arts = re.findall(r"<article\b.*?</article>", pagina, re.S | re.I)
    if arts:
        maior = max(arts, key=lambda a: len(limpar(a)))
        if len(limpar(maior)) > 600:
            return maior
    return re.sub(r"<(aside|footer|nav|header)\b.*?</\1>", "", pagina, flags=re.S | re.I)


IMG_RE = [r'<meta[^>]+property=["\']og:image(?::secure_url)?["\'][^>]+content=["\']([^"\']+)',
          r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image["\']',
          r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)']


def imagem_de(pagina, base):
    for r in IMG_RE:
        m = re.search(r, pagina, re.I)
        if m:
            u = urllib.parse.urljoin(base, html.unescape(m.group(1).strip()))
            if u.startswith("https://") and not re.search(r"logo|default|placeholder|favicon|avatar", u, re.I):
                return u
    return ""


RUIM_IMG = re.compile(r"logo|default|placeholder|favicon|avatar|gravatar|icon|emoji|sprite|banner-ad|/ads?/|pixel|spacer|blank|loading|"
                      r"\b(?:\d{2,3})x(?:\d{2,3})\.|share|button|badge|author|profile|newsletter|\.svg|\.gif", re.I)


def fotos_de(pagina, base, limite=4, data=None):
    """Só imagens da própria notícia: a capa (og:image) e as fotos que estão no texto da matéria.
    Fica de fora: foto que é link para outra matéria (relacionadas), miniatura, logo, banner,
    imagem enviada ao site em outro mês (de outra matéria) e o que vem depois do fim do texto."""
    out = []
    ym = None
    if data:
        y, mth = int(data[:4]), int(data[5:7])
        ym = {(y, mth), (y, mth - 1) if mth > 1 else (y - 1, 12), (y, mth + 1) if mth < 12 else (y + 1, 1)}

    def add(u):
        u = urllib.parse.urljoin(base, html.unescape(u.strip()))
        if not u.startswith("https://") or RUIM_IMG.search(u) or not re.search(r"\.(jpe?g|png|webp)(\?|$)|/image|/img|wp-content/uploads", u, re.I):
            return
        mu = re.search(r"/uploads/(\d{4})/(\d{2})/", u)
        if ym and mu and (int(mu.group(1)), int(mu.group(2))) not in ym:
            return  # imagem de outra época: é de outra matéria
        k = re.sub(r"-\d{2,4}x\d{2,4}(?=\.\w+$)", "", u.split("?")[0])
        if k not in [re.sub(r"-\d{2,4}x\d{2,4}(?=\.\w+$)", "", x.split("?")[0]) for x in out]:
            out.append(u)
    capa = imagem_de(pagina, base)
    if capa:
        add(capa)
    miolo = corpo_da_materia(pagina)
    dom = urllib.parse.urlparse(base).netloc
    for m in re.finditer(r"<img\b[^>]*>", miolo, re.I):
        t = m.group(0)
        if re.search(r'alt=["\'][^"\']*(background|logo|avatar|icon|banner|publicidade|anúncio|advert)', t, re.I):
            continue
        if re.search(r'class=["\'][^"\']*(thumb|avatar|related|widget|ad-|ads|banner|logo|icon|emoji|author)', t, re.I):
            continue
        # foto dentro de link para outra página do site = card de "leia também"
        antes = miolo[max(0, m.start() - 400): m.start()]
        a = antes.rfind("<a ")
        if a >= 0 and "</a>" not in antes[a:]:
            href = re.search(r'href=["\']([^"\']+)', antes[a:])
            if href and not re.search(r"\.(jpe?g|png|webp)(\?|$)", href.group(1), re.I):
                continue
        w = re.search(r'\bwidth=["\']?(\d+)', t)
        if w and int(w.group(1)) < 400:
            continue
        srcset = re.search(r'(?:data-srcset|srcset)=["\']([^"\']+)', t)
        if srcset:
            cands = [x.strip().split(" ") for x in srcset.group(1).split(",") if x.strip()]
            cands = [(int(re.sub(r"\D", "", c[1]) or 0) if len(c) > 1 else 0, c[0]) for c in cands]
            if cands:
                add(max(cands)[1])
        else:
            s = re.search(r'(?:data-lazy-src|data-src|data-original|src)=["\']([^"\']+)', t)
            if s:
                add(s.group(1))
        if len(out) >= limite:
            break
    return out[:limite]


def historia_de(pagina, limite=10, alvo=300):
    """A matéria inteira, em blocos de ~300 caracteres (um por slide), traduzida para o português:
    é o roteiro do carrossel que conta a notícia."""
    miolo = corpo_da_materia(pagina)
    frases = []
    for m in re.finditer(r"<p\b[^>]*>(.*?)</p>", miolo, re.S | re.I):
        t = limpar(m.group(1))
        if len(t) < 50 or re.search(r"cookie|newsletter|subscribe|assine|inscreva|suscr|©|all rights|leia também|leia mais|read more|"
                                     r"^(credits?|ficha técnica|client|agency|cliente|agência|agencia|director|diretor|produção|production)\b", t, re.I):
            continue
        frases += [f.strip() for f in re.split(r"(?<=[.!?])\s+(?=[A-ZÀ-Ý“\"'])", t) if len(f.strip()) > 2]
    blocos, atual = [], ""
    for f in frases:
        if atual and len(atual) + len(f) + 1 > alvo:
            blocos.append(atual)
            atual = f
        else:
            atual = (atual + " " + f).strip()
        if len(blocos) >= limite:
            break
    if atual and len(blocos) < limite:
        blocos.append(atual)
    blocos = [b if len(b) <= alvo + 120 else b[:alvo + 100].rsplit(" ", 1)[0] + "…" for b in blocos]
    if not blocos:
        return []
    junto = traduzir("\n".join(blocos))
    partes = [x.strip() for x in junto.split("\n") if x.strip()]
    return partes if len(partes) == len(blocos) else blocos


def completar_fotos(camp, estado, limite=220):
    """Abre a matéria de cada campanha sem filme: embute o filme que estiver lá (YouTube, Vimeo,
    Instagram, TikTok) e, se não houver filme, guarda as fotos e as frases para o carrossel."""
    feitas = set(estado.setdefault("midia_v4", []))
    bloq = set(estado.get("bloqueados_yt", []))
    alvo = [c for c in camp if not c.get("yt") and not c.get("video") and c.get("url") and c["url"] not in feitas]
    alvo.sort(key=lambda c: c.get("date", ""), reverse=True)  # mais recentes primeiro
    alvo = alvo[:limite]

    def job(c):
        try:
            pag = baixar(c["url"], timeout=15)
        except Exception:  # noqa: BLE001
            return c, None
        yts, video = filmes_de(corpo_da_materia(pag))
        return c, (yts, video, fotos_de(pag, c["url"], data=c.get("date")), historia_de(pag) if not yts and not video else [])
    with cf.ThreadPoolExecutor(8) as ex:
        res = list(ex.map(job, alvo))
    # vídeo repetido em várias matérias do mesmo site é da página, não da campanha
    cont = {}
    for c, r in res:
        if r:
            dom = urllib.parse.urlparse(c["url"]).netloc
            for y in r[0]:
                cont[(dom, y)] = cont.get((dom, y), 0) + 1
    bloq.update(y for (d, y), n in cont.items() if n > 1)
    usados = {y for c in camp for y in c.get("yt", [])}
    n = 0
    for c, r in res:
        feitas.add(c["url"])
        if r is None:
            continue  # o site recusou o acesso: fica como está
        yts, video, fotos, hist = r
        yts = [y for y in yts if y not in bloq and y not in usados]
        if yts:
            c["yt"] = yts
            usados.update(yts)
        elif video:
            c["video"] = video
        c["images"] = fotos  # substitui as fotos antigas (podiam ser de outras matérias)
        if fotos:
            c["image"] = fotos[0]
        if hist and not yts and len(hist) >= len(c.get("story", [])):
            c["story"] = hist
        if yts or video or fotos:
            n += 1
    estado["midia_v4"] = sorted(feitas)
    estado["bloqueados_yt"] = sorted(bloq)
    return n


CORTADO = re.compile(r"(\.\.\.|…|\[…\]|\[\.\.\.\])\s*$")


def completar_textos(camp, estado, limite=120):
    """Campanhas cujo resumo vem cortado ("…"): guarda os parágrafos da matéria, que o site
    mostra quando a pessoa clica nos três pontinhos."""
    feitas = set(estado.setdefault("texto_v1", []))
    alvo = [c for c in camp if c.get("url") and not c.get("story") and c["url"] not in feitas
            and CORTADO.search(c.get("frase") or c.get("summary") or "")]
    alvo.sort(key=lambda c: c.get("date", ""), reverse=True)
    alvo = alvo[:limite]

    def job(c):
        try:
            return c, historia_de(baixar(c["url"], timeout=15))
        except Exception:  # noqa: BLE001
            return c, None
    n = 0
    with cf.ThreadPoolExecutor(8) as ex:
        for c, hist in ex.map(job, alvo):
            if hist is None:
                continue  # o site recusou agora: tenta de novo na próxima rodada
            feitas.add(c["url"])
            if hist:
                c["story"] = hist
                n += 1
    estado["texto_v1"] = sorted(feitas)
    return n


def completar_imagens(camp, estado, limite=150):
    """Busca a imagem de capa (og:image) das campanhas antigas que não têm filme nem imagem."""
    tentadas = set(estado.setdefault("sem_imagem", []))
    alvo = [c for c in camp if not c.get("yt") and not c.get("image") and c.get("url") and c["url"] not in tentadas][:limite]

    def job(c):
        try:
            return c, imagem_de(baixar(c["url"], timeout=15), c["url"])
        except Exception:  # noqa: BLE001
            return c, ""
    n = 0
    with cf.ThreadPoolExecutor(10) as ex:
        for c, img in ex.map(job, alvo):
            if img:
                c["image"] = img
                n += 1
            else:
                tentadas.add(c["url"])
    estado["sem_imagem"] = sorted(tentadas)
    return n


# ---------------------------------------------------------------- portfólios de agências
def canal_id(ag, estado):
    """Descobre o ID do canal do YouTube da agência a partir dos @ candidatos (guarda o resultado)."""
    cache = estado.setdefault("canais", {})
    if ag["nome"] in cache:
        return cache[ag["nome"]]
    if BUSCA_CANAIS["feitas"] >= NOVOS_CANAIS_POR_RODADA:
        return None  # fica para a próxima rodada
    BUSCA_CANAIS["feitas"] += 1
    dom_ag = urllib.parse.urlparse(ag.get("site", "")).netloc.replace("www.", "")
    chave_ag = chave(ag.get("confere", ag["nome"]))
    for h in ag["youtube"]:
        try:
            pag = baixar("https://www.youtube.com/@" + h.lstrip("@"), timeout=15)
        except Exception:  # noqa: BLE001
            continue
        m = re.search(r'"(?:channelId|externalId)"\s*:\s*"(UC[\w-]{22})"', pag) or re.search(r"/channel/(UC[\w-]{22})", pag)
        t = re.search(r'<meta property="og:title" content="([^"]+)"', pag)
        nome = html.unescape(t.group(1)) if t else ""
        d = re.search(r'<meta property="og:description" content="([^"]*)"', pag)
        desc = html.unescape(d.group(1)) if d else ""
        # nomes curtos/genéricos (Loop, Known, Cape...) precisam parecer agência de verdade
        generico = len(chave_ag) <= 6 or ag.get("estrito")
        parece_agencia = re.search(r"agen|advertis|creative|criativ|publicid|marketing|brand|studio|comunica|network|ideas", nome + " " + desc, re.I)
        # lista nova (estrito): o canal tem de citar o site da agência ou parecer agência de verdade
        cita_site = bool(dom_ag) and dom_ag.lower() in pag.lower()
        if m and chave_ag[:5] in chave(nome) and (not generico or parece_agencia or cita_site):
            cache[ag["nome"]] = {"id": m.group(1), "canal": nome, "handle": h}
            log("  canal encontrado:", ag["nome"], "→", nome, m.group(1))
            return cache[ag["nome"]]
    cache[ag["nome"]] = None
    log("  canal não encontrado:", ag["nome"])
    return None


BUSCA_CANAIS = {"feitas": 0}


def achar_feed(site):
    """Procura o feed RSS/Atom de um site: primeiro o <link rel="alternate"> da home, depois os caminhos comuns."""
    base = site.rstrip("/")
    cands = []
    try:
        home = baixar(site, timeout=15)
        for m in re.finditer(r"<link[^>]+>", home, re.I):
            t = m.group(0)
            if re.search(r"application/(?:rss|atom)\+xml", t, re.I) and not re.search(r"comments", t, re.I):
                h = re.search(r'href=["\']([^"\']+)', t)
                if h:
                    cands.append(urllib.parse.urljoin(site, html.unescape(h.group(1))))
    except Exception:  # noqa: BLE001
        pass
    for c in ("/feed/", "/rss", "/feed", "/rss.xml", "/news/feed/", "/blog/feed/", "/en/feed/", "/atom.xml"):
        cands.append(base + c)
    vistos = set()
    for u in cands:
        if u in vistos:
            continue
        vistos.add(u)
        try:
            txt = baixar(u, timeout=12)
            if parece_feed(txt) and ler_feed(txt):
                return u
        except Exception:  # noqa: BLE001
            continue
    return ""


def fontes_dos_sites(fontes, estado):
    """Sites da lista "sites" (agências e veículos): descobre o feed de cada um aos poucos
    e devolve os que têm feed no mesmo formato das fontes fixas."""
    st = estado.setdefault("sites", {})
    hoje = HOJE.isoformat()
    limite = (HOJE - dt.timedelta(days=RETESTE_DIAS)).isoformat()
    testar = [s for s in fontes.get("sites", [])
              if s["nome"] not in st or (not st[s["nome"]].get("feed") and st[s["nome"]].get("testado", "") < limite)]
    testar = [] if RAPIDO else testar[:SITES_POR_RODADA]
    if testar:
        with cf.ThreadPoolExecutor(12) as ex:
            for s, feed in zip(testar, ex.map(lambda x: achar_feed(x["site"]), testar)):
                st[s["nome"]] = {"feed": feed, "testado": hoje}
                log("  site:", s["nome"], "→", feed or "sem feed")
    out = []
    for s in fontes.get("sites", []):
        feed = st.get(s["nome"], {}).get("feed")
        if feed:
            out.append({"nome": s["nome"], "urls": [feed], "regiao": s.get("regiao", "Global"), "cc": s.get("cc", ""),
                        "so_campanhas": False, "agencia": s.get("agencia", "")})
    log("Sites com feed:", len(out), "de", len(fontes.get("sites", [])))
    return out


def ler_canais(fontes, estado, dias=45, vigia=None):
    """Vídeos novos dos canais de YouTube das agências: cada vídeo vira uma campanha com filme.
    No modo rápido (vigia), lê só uma fatia dos canais já conhecidos por rodada, em rodízio."""
    out = []
    limite = (HOJE - dt.timedelta(days=dias)).isoformat()
    ags = [a for a in fontes.get("agencias", []) if a.get("youtube")]
    if vigia is not None:
        ags = [a for a in ags if (estado.get("canais") or {}).get(a["nome"])]
        if ags:
            k = vigia.get("yt_pos", 0) % len(ags)
            vigia["yt_pos"] = k + CANAIS_POR_MINUTO
            ags = (ags + ags)[k:k + min(CANAIS_POR_MINUTO, len(ags))]
    cond = vigia.setdefault("cond", {}) if vigia is not None else None

    def baixar_canal(ag):
        cid = canal_id(ag, estado)
        if not cid:
            return ag, cid, ""
        try:
            return ag, cid, baixar("https://www.youtube.com/feeds/videos.xml?channel_id=" + cid["id"], cond=cond)
        except Exception as e:  # noqa: BLE001
            return ag, cid, e
    if vigia is not None:
        with cf.ThreadPoolExecutor(10) as ex:
            lidos = list(ex.map(baixar_canal, ags))
    else:
        lidos = [baixar_canal(a) for a in ags]
    for ag, cid, xml in lidos:
        if not cid or xml is None:
            continue
        if isinstance(xml, Exception):
            log("  canal falhou:", ag["nome"], xml)
            continue
        try:
            raiz = ET.fromstring(xml.encode("utf-8"))
        except Exception as e:  # noqa: BLE001
            log("  canal falhou:", ag["nome"], e)
            continue
        for e in raiz.iter():
            if tag(e) != "entry":
                continue
            vid = texto_de(e, "videoId")
            titulo = limpar(texto_de(e, "title"))
            data = data_de(texto_de(e, "published"))
            if not vid or not titulo or not data or data < limite or data > HOJE.isoformat():
                continue
            if EXCLUI.search(titulo) or PERGUNTA.search(titulo) or re.search(r"#shorts|reel|showreel|credentials|we are hiring|vagas|introducing|platform|plataforma|podcast|webinar|our people|culture|dinner|breakdown|stack|linkedin|tips|how to|panel|talk|summit|lessons|guide|insight|keynote|interview|behind the|bastidores|making of|recap|highlights|evento|livestream|ao vivo", titulo, re.I):
                continue
            desc = ""
            for g in e.iter():
                if tag(g) == "description" and g.text:
                    desc = g.text
            partes = [x.strip() for x in re.split(r"\s+[|–—]\s+|\s+-\s+|:\s+", titulo) if x.strip()]
            marca = marca_ok(partes[0]) if len(partes) > 1 else ""
            marca = marca or marca_de(titulo)
            if not marca or chave(marca) == chave(ag["nome"]):
                continue  # vídeo institucional da agência, não campanha
            nome_t = " — ".join(partes[1:]) if len(partes) > 1 and marca == marca_ok(partes[0]) else titulo
            out.append({"id": "%s-%s-%s" % (data, slug(marca, 20), slug(nome_t, 36)), "date": data, "brand": marca,
                        "title": nome_t, "agency": ag["nome"], "source": "YouTube · " + cid["canal"],
                        "url": "https://www.youtube.com/watch?v=" + vid, "region": ag.get("regiao", "Global"),
                        "cc": ag.get("cc", ""), "yt": [vid],
                        "summary": (primeira_frase(desc) if vigia is not None else traduzir(primeira_frase(desc)))
                        if desc and len(desc) > 40 else "",
                        "addedAt": AGORA.strftime("%Y-%m-%dT%H:%M:%SZ")})
    return out


# ---------------------------------------------------------------- Instagram
HASHTAG = re.compile(r"(?:^|\s)#\w+")
INSTITUCIONAL = re.compile(r"\b(thankful|thanksgiving|grateful|gratid[aã]o|happy holidays|feliz natal|boas festas|our (team|people|office|family)|"
                           r"nosso time|nossa equipe|meet the (people|team)|meet our|conhe[cç]a (o )?nosso|conhe[cç]a (a )?nossa|we'?re hiring|"
                           r"estamos contratando|vagas|anniversary|anivers[aá]rio|birthday|tbt|throwback|reflects on|portfolio night|is a wrap|"
                           r"year in review|retrospectiva|first year|primeiro ano)\b", re.I)
TEM_PECA = re.compile(r"\b(campaign|campanha|campaña|film|filme|spot|commercial|comercial|anúncio|ad)\b", re.I)


def ler_instagram(fontes, vigia, dias=JANELA_DIAS):
    """Posts recentes das contas de Instagram (robo/instagram.py): cada post de campanha vira uma
    campanha com o post do Instagram embutido no lugar do filme."""
    import instagram  # noqa: PLC0415  (fica ao lado deste arquivo)
    out = []
    limite = (HOJE - dt.timedelta(days=dias)).isoformat()
    for p, conta in instagram.rodada(fontes, vigia, AGORA, log, chave):
        c = post_para_campanha(p, conta, limite)
        if c:
            out.append(c)
    return out


_NOME = r"([A-Z0-9À-Ý][\w&'’.\-À-ÿ]*(?:\s+(?:[A-Z0-9À-Ý&][\w&'’.\-À-ÿ]*|de|do|da|of)){0,3})"
MARCA_IG = [
    # "A DPZ criou para a Seguros Unimed", "criamos para Subway", "new work for Nike"
    re.compile(r"\b(?:cri(?:ou|amos|ad[ao]s?)|fizemos|fez|desenvolve(?:u|mos)|assin(?:a|amos|ou)|produzi(?:u|mos)|"
               r"lança(?:mos)?|lançou|created|made|crafted|launched|work|trabalho|projeto|project)\s+"
               r"(?:para|pra|for|com|with|junto\s+(?:com|a))\s+(?:a\s+|o\s+|as\s+|os\s+|the\s+)?" + _NOME),
    # "Na campanha da linha Honda City", "novo filme de Bauducco", "campaign for Heinz"
    re.compile(r"\b(?:campanha|campaign|campaña|filme|film|spot|comercial|anúncio|ação|activation|ativação|case)\s+"
               r"(?:nova\s+|novo\s+)?(?:d[aoe]s?|of|for|para|pra|del)\s+(?:linha\s+|marca\s+|nova\s+|novo\s+)?" + _NOME),
    # "para O Boticário", "for Heinz" depois de aspas/título de trabalho
    re.compile(r"[”\"’']\s*,?\s+(?:para|pra|for|de|da|do)\s+(?:a\s+|o\s+)?" + _NOME),
]


def marca_ig(texto):
    for rx in MARCA_IG:
        for m in rx.finditer(texto[:500]):
            mk = marca_ok(m.group(1).rstrip(".,"))
            if mk:
                return mk
    return ""


def post_para_campanha(p, conta, limite):
    """Um post de Instagram vira campanha, ou None se não tiver cara de campanha."""
    legenda = p.get("caption") or ""
    link = p.get("permalink") or ""
    data = data_de(p.get("timestamp", ""))
    if not link or not data or data < limite or data > HOJE.isoformat():
        return None
    linhas = [limpar(x) for x in legenda.splitlines() if limpar(HASHTAG.sub(" ", x)).strip(" .·-—|")]
    titulo = HASHTAG.sub(" ", linhas[0]).strip(" .·-—|") if linhas else ""
    titulo = re.sub(r"\s+", " ", titulo)
    if len(titulo) > 140:
        titulo = titulo[:139].rsplit(" ", 1)[0] + "…"
    texto = limpar(HASHTAG.sub(" ", legenda))
    if not titulo or EXCLUI.search(titulo) or PERGUNTA.search(titulo) or ENTREVISTA.search(texto[:400]):
        return None
    if not FORTE.search(texto[:600]) and p.get("media_type") != "VIDEO":
        return None  # foto sem cara de campanha (bastidores, vagas, cultura da agência...)
    marca = marca_de(titulo) or marca_ig(texto) or marca_de(texto[:300])
    if not marca:
        m = re.search(r"(?:for|para|pour|für|with|com|con|x)\s+@?([a-z][\w]*\.[\w.]{2,30}|@[\w.]{2,30})", texto, re.I)
        marca = marca_ok(m.group(1).replace(".", " ").replace("_", " ").title()) if m else ""
    if not marca or chave(marca) == chave(conta["nome"]):
        return None
    # post da própria agência (equipe, datas, eventos), não campanha: marca que começa com o nome
    # da agência (HLK → "HLKers") sem falar de peça, ou título de agradecimento/bastidores
    if chave(marca).startswith(chave(conta["nome"])) and not TEM_PECA.search(titulo):
        return None
    if INSTITUCIONAL.search(titulo):
        return None
    tipo = "reel" if "/reel/" in link else "p"
    cod = link.rstrip("/").rsplit("/", 1)[-1]
    return {"id": "%s-%s-%s" % (data, slug(marca, 20), slug(titulo, 36)), "date": data, "brand": marca,
        "title": titulo, "agency": conta.get("agencia") or "", "source": "Instagram · @" + conta["usuario"],
        "url": link, "region": conta.get("regiao", "Global"), "cc": conta.get("cc", ""),
        "video": "https://www.instagram.com/%s/%s/" % (tipo, cod),
        "summary": primeira_frase(texto) if len(texto) > len(titulo) + 20 else "",
        "addedAt": AGORA.strftime("%Y-%m-%dT%H:%M:%SZ")}


def ler_portfolios(fontes, estado, camp, max_por_site=10, dias=60):
    """Lê a página de trabalhos de cada agência (fontes.json → "portfolios") e transforma cada
    trabalho novo em campanha: marca, data de publicação no site, filme (Vimeo/YouTube) e fotos."""
    out = []
    vistos_all = estado.setdefault("portfolio", {})
    limite = (HOJE - dt.timedelta(days=dias)).isoformat()
    for pf in fontes.get("portfolios", []):
        vistos = set(vistos_all.get(pf["nome"], []))
        try:
            idx = baixar(pf["pagina"])
        except Exception as e:  # noqa: BLE001
            log("  portfólio falhou:", pf["nome"], e)
            continue
        links = []
        for m in re.finditer(r'href=["\']([^"\'#?]+)["\']', idx):
            u = urllib.parse.urljoin(pf["pagina"], html.unescape(m.group(1)))
            if pf["padrao"] in u and u.rstrip("/") != pf["pagina"].rstrip("/") and u not in links:
                links.append(u)
        log("  portfólio:", pf["nome"], len(links), "trabalhos na página")
        for u in [x for x in links if x not in vistos][:max_por_site]:
            vistos.add(u)
            try:
                pag = baixar(u)
            except Exception:  # noqa: BLE001
                continue
            m = re.search(r'"(?:publishedAt|_createdAt|datePublished)"\s*:\s*"(\d{4}-\d{2}-\d{2}T[^"]+)"', pag)
            data = data_de(m.group(1)) if m else None
            if not data or data < limite or data > HOJE.isoformat():
                continue
            og = re.search(r'property=["\']og:title["\'][^>]*content=["\']([^"\']+)', pag)
            marca = limpar(og.group(1)) if og else ""
            marca = re.split(r"\s+[|–—-]\s+", marca)[0].strip() if marca else ""
            slug_t = urllib.parse.unquote(u.rstrip("/").rsplit("/", 1)[-1]).replace("_", "-")
            palavras = [w for w in re.split(r"[-\s]+", slug_t) if w]
            if marca and palavras and chave(palavras[0]) in chave(marca):
                palavras = palavras[1:] if len(palavras) > 1 else palavras
            titulo = " ".join(palavras).strip().capitalize() or marca
            if not marca:
                marca = palavras[0].capitalize() if palavras else pf["nome"]
            yts, video = filmes_de(pag)
            fotos = fotos_de(pag, u)
            desc = re.search(r'property=["\']og:description["\'][^>]*content=["\']([^"\']+)', pag)
            desc = limpar(desc.group(1)) if desc else ""
            if re.search(r"all you need to know|founded in|independent creative", desc, re.I):
                desc = ""
            c = {"id": "%s-%s-%s" % (data, slug(marca, 20), slug(titulo, 36)), "date": data, "brand": marca, "title": titulo,
                 "agency": pf.get("agencia", pf["nome"]), "source": pf["nome"], "url": u,
                 "region": pf.get("regiao", "Global"), "cc": pf.get("cc", "")}
            if yts:
                c["yt"] = yts
            elif video:
                c["video"] = video
            if fotos:
                c["image"] = fotos[0]
                if not yts and not video:
                    c["images"] = fotos
            hist = historia_de(pag) if not yts and not video else []
            if hist:
                c["story"] = hist
            c["summary"] = traduzir(desc) if desc else ""
            c["addedAt"] = AGORA.strftime("%Y-%m-%dT%H:%M:%SZ")
            out.append(c)
        vistos_all[pf["nome"]] = sorted(vistos)
    return out


# ---------------------------------------------------------------- tradução (opcional)
def traduzir(s):
    if not s or os.environ.get("SEM_TRADUCAO"):
        return s
    try:
        url = "https://translate.googleapis.com/translate_a/single?" + urllib.parse.urlencode({"client": "gtx", "sl": "auto", "tl": "pt", "dt": "t", "q": s})
        dados = json.loads(baixar(url, timeout=10))
        if dados and dados[2] == "pt":
            return s
        out = "".join(p[0] for p in dados[0] if p and p[0])
        return out.strip() or s
    except Exception:  # noqa: BLE001
        return s


# ---------------------------------------------------------------- principal
def main():
    fontes = ler_json(FONTES, {"feeds": [], "buscas": [], "descobertas": []})
    estado = ler_json(ESTADO, {})
    estado.setdefault("feeds", {})
    estado.setdefault("testados", {})
    estado.setdefault("bloqueados_yt", [])
    estado.setdefault("arquivo", {})
    if estado.get("arquivo_inicio") != ARQUIVO_INICIO:
        # o começo do arquivo mudou: os feeds que tinham "acabado" voltam a descer páginas de onde pararam
        for st in estado["arquivo"].values():
            st["fim"] = False
        estado["arquivo_inicio"] = ARQUIVO_INICIO
    camp = ler_json(CAMP, [])
    vigia = ler_json(VIGIA, {}) if RAPIDO else None
    lista_vistos = list(vigia.get("vistos", [])) if RAPIDO else []
    vistos_vigia = set(lista_vistos)
    cond = vigia.setdefault("cond", {}) if RAPIDO else None
    log("Hoje (São Paulo):", HOJE, "| campanhas no site:", len(camp), "| modo rápido" if RAPIDO else "")

    urls = {c.get("url", "").split("?")[0].rstrip("/") for c in camp}
    ids = {c.get("id") for c in camp}
    chaves = {(chave(c.get("brand", "")), chave(c.get("title", ""))) for c in camp}
    titulos = {chave(c.get("title", "")) for c in camp if len(chave(c.get("title", ""))) > 12}
    yts_usados = {y for c in camp for y in c.get("yt", [])}
    marca_dia = {(chave(c.get("brand", "")), c.get("date")) for c in camp}
    bloqueados = set(estado["bloqueados_yt"])
    inicio_normal = (HOJE - dt.timedelta(days=JANELA_DIAS)).isoformat()

    todas_fontes = fontes["feeds"] + fontes.get("descobertas", []) + fontes_dos_sites(fontes, estado)
    candidatos = []  # (item, fonte)
    # matérias antigas (do arquivo) já abertas que não viraram campanha: não abre de novo
    descartadas = set(estado.setdefault("descartadas", [])) if not RAPIDO else set()

    def considerar(it, fonte, minimo):
        if not (minimo <= it["data"] <= HOJE.isoformat()):
            return
        u = it["link"].split("?")[0].rstrip("/")
        if u in urls or u in vistos_vigia or u in descartadas:
            return
        if not parece_campanha(it["titulo"], "", fonte.get("so_campanhas")):
            return
        candidatos.append((it, fonte))

    # 1) feeds, página 1
    def job_feed(f):
        return f, pegar_feed(f, estado, cond=cond)
    with cf.ThreadPoolExecutor(12) as ex:
        for f, itens in ex.map(job_feed, todas_fontes):
            if itens is None:
                log("  feed falhou:", f["nome"])
                continue
            log("  feed ok:", f["nome"], len(itens), "itens")
            for it in itens:
                considerar(it, f, inicio_normal)

    # 2) arquivo histórico: volta páginas nos feeds até ARQUIVO_INICIO
    def job_arquivo(f):
        if RAPIDO:
            return f, []  # arquivo histórico fica para a execução de hora em hora
        st = estado["arquivo"].setdefault(f["nome"], {"pagina": 1, "fim": False})
        if st.get("fim") or not estado["feeds"].get(f["nome"], {}).get("url"):
            return f, []
        achados = []
        for _ in range(PAGINAS_ARQUIVO):
            p = st["pagina"] + 1
            itens = pegar_feed(f, estado, p)
            if not itens:
                st["fim"] = True
                break
            st["pagina"] = p
            achados += itens
            if min(i["data"] for i in itens) < ARQUIVO_INICIO:
                st["fim"] = True
                break
        return f, achados
    with cf.ThreadPoolExecutor(12) as ex:
        for f, itens in ex.map(job_arquivo, todas_fontes):
            for it in itens:
                considerar(it, f, ARQUIVO_INICIO)

    # 2b) arquivo por mês: nos feeds de WordPress, "?m=AAAAMM" devolve só aquele mês. Assim o robô pula
    # direto para os anos antigos (um mês por fonte a cada execução) em vez de descer página por página.
    estado.setdefault("arquivo_mes", {})

    def job_mes(f):
        if RAPIDO:
            return f, []
        url = estado["feeds"].get(f["nome"], {}).get("url")
        st = estado["arquivo_mes"].setdefault(f["nome"], {"mes": MES_INICIO_ARQUIVO_MES, "pagina": 0})
        if not url or st.get("fim") or st.get("sem_wp"):
            return f, []
        achados = []
        for _ in range(PAGINAS_ARQUIVO):
            mes = st["mes"]
            if mes < ARQUIVO_INICIO[:7]:
                st["fim"] = True
                break
            p = st["pagina"] + 1
            alvo = url + ("&" if "?" in url else "?") + "m=%s" % mes.replace("-", "") + ("&paged=%d" % p if p > 1 else "")
            try:
                txt = baixar(alvo, timeout=20)
                itens = ler_feed(txt) if parece_feed(txt) else []
            except Exception:  # noqa: BLE001
                itens = []
            do_mes = [i for i in itens if i["data"][:7] == mes]
            if p == 1 and itens and not do_mes:
                st["sem_wp"] = True  # o site ignora ?m= (não é WordPress): fica só com o arquivo por páginas
                break
            achados += do_mes
            if not do_mes or len(itens) < 5 or p >= PAGINAS_POR_MES:
                y, m = int(mes[:4]), int(mes[5:7]) - 1
                st["mes"], st["pagina"] = ("%d-%02d" % (y - 1, 12) if m == 0 else "%d-%02d" % (y, m)), 0
            else:
                st["pagina"] = p
        return f, achados
    with cf.ThreadPoolExecutor(12) as ex:
        for f, itens in ex.map(job_mes, todas_fontes):
            for it in itens:
                considerar(it, f, ARQUIVO_INICIO)

    # 3) buscas no Bing News (acha sites novos)
    buscas = [] if RAPIDO else fontes.get("buscas", [])
    if buscas:
        k = estado.get("proxima_busca", 0) % len(buscas)
        rodada = (buscas + buscas)[k:k + BUSCAS_POR_RODADA]
        estado["proxima_busca"] = k + BUSCAS_POR_RODADA
        conhecidos = {urllib.parse.urlparse(u).netloc.replace("www.", "") for f in todas_fontes for u in f["urls"]}
        for q in rodada:
            try:
                itens = buscar_bing(q)
            except Exception as e:  # noqa: BLE001
                log("  busca falhou:", q, e)
                continue
            log("  busca:", q, len(itens), "resultados")
            for it in itens:
                dom = urllib.parse.urlparse(it["link"]).netloc.replace("www.", "")
                if not dom:
                    continue
                if dom not in conhecidos and dom not in estado["testados"]:
                    estado["testados"][dom] = "pendente"

    # 4) testa sites novos: se tiverem feed com campanhas, viram fontes fixas
    pend = [] if RAPIDO else [d for d, v in estado["testados"].items() if v == "pendente"][:TESTES_DESCOBERTA]
    for dom in pend:
        achou = None
        for u in ("https://%s/feed/" % dom, "https://%s/rss" % dom, "https://%s/feed" % dom, "https://%s/rss.xml" % dom):
            try:
                txt = baixar(u, timeout=12)
                if parece_feed(txt):
                    itens = ler_feed(txt)
                    bons = [i for i in itens if parece_campanha(i["titulo"])]
                    if len(itens) >= 8 and len(bons) >= 3 and len(bons) >= 0.25 * len(itens):
                        achou = u
                        break
            except Exception:  # noqa: BLE001
                continue
        estado["testados"][dom] = "fonte" if achou else "sem-feed"
        if achou:
            nome, cc = pais_por_dominio(dom)
            fontes.setdefault("descobertas", []).append({"nome": dom, "urls": [achou], "regiao": nome, "cc": cc,
                                                        "so_campanhas": False, "adicionadaEm": HOJE.isoformat()})
            log("  FONTE NOVA:", dom, achou)

    # 5) tira repetidos entre os candidatos e ordena (mais recentes primeiro)
    vistos, fila, por_fonte_dia = set(), [], {}
    for it, f in sorted(candidatos, key=lambda x: x[0]["data"], reverse=True):
        u = it["link"].split("?")[0].rstrip("/")
        k = chave(it["titulo"])
        if u in vistos or k in vistos or (len(k) > 12 and k in titulos):
            continue
        fd = (f["nome"], it["data"])
        if por_fonte_dia.get(fd, 0) >= MAX_POR_FONTE_DIA:
            continue
        por_fonte_dia[fd] = por_fonte_dia.get(fd, 0) + 1
        vistos.update({u, k})
        fila.append((it, f))
    log("Candidatos a campanha:", len(fila))
    if RAPIDO:
        fila = fila[:MATERIAS_RAPIDO]
    else:
        # as recentes primeiro, mas sempre sobra espaço para o arquivo antigo andar
        recentes = [x for x in fila if x[0]["data"] >= inicio_normal]
        antigas = [x for x in fila if x[0]["data"] < inicio_normal]
        n_rec = min(len(recentes), MAX_MATERIAS - min(len(antigas), MAX_MATERIAS // 2))
        fila = recentes[:n_rec] + antigas[:MAX_MATERIAS - n_rec]
    abertas_antigas = [it["link"].split("?")[0].rstrip("/") for it, _ in fila if it["data"] < inicio_normal]
    if RAPIDO:
        # matéria aberta uma vez não é aberta de novo a cada minuto (entrando ou não no site)
        for it, _ in fila:
            u = it["link"].split("?")[0].rstrip("/")
            if u not in vistos_vigia:
                vistos_vigia.add(u)
                lista_vistos.append(u)

    # 6) abre as matérias para pegar filmes
    def job_materia(par):
        it, f = par
        try:
            pag = baixar(it["link"], timeout=20)
        except Exception:  # noqa: BLE001
            pag = ""
        if it.get("corpo"):
            # o texto completo que o próprio site publica no feed também traz os filmes e as fotos
            pag = (pag + "\n" if pag else "") + "<article>" + it["corpo"] + "</article>"
        if not pag:
            return par, [], "", "", "", [], []
        miolo = corpo_da_materia(pag)
        yts, vimeo = filmes_de(miolo)
        if not yts and not vimeo and it.get("corpo"):
            yts, vimeo = filmes_de(it["corpo"])
        # matéria de entrevista: o vídeo embutido é a conversa, não a campanha
        if ENTREVISTA.search(it["titulo"] + " " + limpar(miolo)[:1500]) or "insiderlatam" in it["link"]:
            yts, vimeo = [], ""
        img = imagem_de(pag, it["link"])
        fotos = fotos_de(pag, it["link"], data=it["data"]) if not yts and not vimeo else []
        hist = historia_de(pag) if not yts and not vimeo else []
        desc = ""
        m = re.search(r'<meta[^>]+(?:property="og:description"|name="description")[^>]+content="([^"]+)"', pag)
        if m:
            desc = m.group(1)
        return par, yts, vimeo, desc, img, fotos, hist
    with cf.ThreadPoolExecutor(10) as ex:
        resultados = list(ex.map(job_materia, fila))

    # vídeo que aparece em várias matérias do mesmo site é da página, não da campanha
    por_dom = {}
    for (it, f), yts, _, _, _, _, _ in resultados:
        dom = urllib.parse.urlparse(it["link"]).netloc
        for y in yts:
            por_dom.setdefault((dom, y), 0)
            por_dom[(dom, y)] += 1
    for (dom, y), n in por_dom.items():
        if n > 1:
            bloqueados.add(y)

    novas = []
    for (it, f), yts, vimeo, desc, img, fotos, hist in resultados:
        if len(novas) >= MAX_NOVAS:
            break
        yts = [y for y in yts if y not in bloqueados]
        if yts and all(y in yts_usados for y in yts):
            continue  # o mesmo filme já está no site (mesma campanha, outra fonte)
        titulo = it["titulo"]
        resumo_txt = limpar(it["resumo"]) or limpar(desc) or limpar(it["corpo"])
        texto = f"{titulo}. {resumo_txt}. {limpar(it['corpo'])[:1500]}"
        marca = marca_de(titulo)
        if not marca:
            continue  # sem marca identificável, provavelmente não é campanha
        k = (chave(marca), chave(titulo))
        if k in chaves:
            continue
        if (chave(marca), it["data"]) in marca_dia:
            continue  # mesma marca no mesmo dia: quase sempre a mesma campanha em outro veículo
        regiao, cc = pais_por_texto(f"{titulo} {resumo_txt}", (f["regiao"], f["cc"]))
        nid = "%s-%s-%s" % (it["data"], slug(marca, 20), slug(titulo, 36))
        while nid in ids:
            nid += "-2"
        c = {"id": nid, "date": it["data"], "brand": marca, "title": titulo, "agency": agencia_de(texto) or f.get("agencia", ""),
             "source": f["nome"], "url": it["link"], "region": regiao, "cc": cc}
        if yts:
            c["yt"] = yts
        elif vimeo:
            c["video"] = vimeo
        if img and not yts:
            c["image"] = img
        if fotos:
            c["images"] = fotos
        if hist:
            c["story"] = hist
        c["summary"] = traduzir(primeira_frase(resumo_txt)) if resumo_txt else ""
        c["addedAt"] = AGORA.strftime("%Y-%m-%dT%H:%M:%SZ")
        novas.append(c)
        ids.add(nid)
        chaves.add(k)
        yts_usados.update(yts)
        marca_dia.add((chave(marca), it["data"]))

    # 6b) sites das próprias agências (portfólio): cada trabalho novo vira uma campanha
    if RAPIDO:
        extras = ler_canais(fontes, estado, vigia=vigia) + ler_instagram(fontes, vigia)
    else:
        extras = ler_portfolios(fontes, estado, camp) + ler_canais(fontes, estado)
    for c in extras:
        if (chave(c["brand"]), c["date"]) in marca_dia or c["id"] in ids:
            continue
        if c["url"].split("?")[0].rstrip("/") in urls or (chave(c["brand"]), chave(c["title"])) in chaves:
            continue
        if c.get("yt") and all(y in yts_usados for y in c["yt"]):
            continue
        if RAPIDO and c.get("summary"):
            c["summary"] = traduzir(c["summary"])
        novas.append(c)
        ids.add(c["id"])
        marca_dia.add((chave(c["brand"]), c["date"]))
        yts_usados.update(c.get("yt", []))
        log("  + portfólio:", c["source"], "|", c["brand"], "|", c["title"])

    # 7) capas das campanhas antigas sem filme
    capas = 0 if SIMULAR or RAPIDO else completar_imagens(camp, estado)
    log("Capas novas em campanhas antigas:", capas)
    fts = 0 if SIMULAR or RAPIDO else completar_fotos(camp, estado)
    log("Carrosséis novos em campanhas antigas:", fts)
    capas += fts
    txs = 0 if SIMULAR or RAPIDO else completar_textos(camp, estado)
    log("Textos completos para resumos cortados:", txs)
    capas += txs

    # 8) salva
    if SIMULAR:
        log("SIMULAÇÃO: %d novas (nada foi salvo)" % len(novas))
        for c in novas:
            log("  ~", c["date"], c["source"], "|", c["brand"], "|", c["title"][:90], "|", "filme" if c.get("yt") or c.get("video") else "card", "|", c["region"])
        return 0
    if RAPIDO:
        # o vigia não mexe em estado.json/fontes.json (são da execução de hora em hora)
        vigia["vistos"] = lista_vistos[-MAX_VISTOS:]
        vigia["ultima_rodada"] = AGORA.isoformat()
        if novas:
            vigia["ultima_novidade"] = AGORA.isoformat()
        salvar_json(VIGIA, vigia)
    else:
        entrou = {c["url"].split("?")[0].rstrip("/") for c in novas}
        descartadas.update(u for u in abertas_antigas if u not in entrou)
        estado["descartadas"] = sorted(descartadas)[-30000:]
        estado["bloqueados_yt"] = sorted(bloqueados)
        estado["ultima_execucao"] = AGORA.isoformat()
        estado["ultimas_novas"] = len(novas)
        salvar_json(ESTADO, estado)
        salvar_json(FONTES, fontes)
    if novas or capas:
        camp += novas
        camp.sort(key=lambda c: (c.get("date", ""), c.get("addedAt", "")), reverse=True)
        assert len({c["id"] for c in camp}) == len(camp)
        assert all(re.match(r"^\d{4}-\d{2}-\d{2}$", c["date"]) for c in camp)
        salvar_json(CAMP, camp)
        # arquivo pequeno que o site confere a cada minuto (para não baixar campaigns.json à toa)
        salvar_json(NOVIDADES, {"atualizado": AGORA.strftime("%Y-%m-%dT%H:%M:%SZ"), "total": len(camp),
                                "ultimo": camp[0]["id"] if camp else ""})
    com_filme = sum(1 for c in novas if c.get("yt") or c.get("video"))
    log("Novas campanhas: %d (%d com filme, %d como card)" % (len(novas), com_filme, len(novas) - com_filme))
    for c in novas[:40]:
        log("  +", c["date"], c["source"], "|", c["brand"], "|", c["title"][:80])
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as s:
            s.write("```\n" + "\n".join(LOG[-120:]) + "\n```\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
