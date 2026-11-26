"""Clube de Criação (clubedecriacao.com.br): campanhas do Acervo e das Últimas, com o filme.

O Clube publica cada campanha no "Acervo" (38 mil peças, desde décadas atrás), com o filme embutido
(YouTube/Vimeo) e a ficha técnica. O robô lê pela API pública do site (WordPress), pega o filme, a
imagem de capa, a marca, a agência e a ficha técnica, e ESCREVE O TEXTO DO ZERO a partir desses dados:
o texto do Clube não é usado no site (nem resumo, nem "Ver mais").

Também lê as "Últimas" do assunto Campanhas (campanhas do mundo todo que o Clube noticia), só as que
têm filme.

Guarda a ficha técnica em "ficha" (o site ainda não mostra; vira "credits" quando os créditos forem ao ar).

Uso no workflow:  python robo/clube.py            → lê e grava as novas em /tmp/clube.json
                  python robo/clube.py --aplicar  → junta em campaigns.json (depois do git reset)
                  python robo/clube.py --testar   → só mostra as 10 mais recentes, como ficariam
"""
import datetime as dt
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import atualizar as A  # noqa: E402
import creditos as CR  # noqa: E402

API = "https://clubedecriacao.com.br/wp-json/wp/v2/"
ESTADO = os.path.join(AQUI, "clube.json")
ACHADOS = "/tmp/clube.json"
INICIO_ARQUIVO = "2020-11-17"     # até onde o arquivo antigo desce (o mesmo do robô principal)
PAGINAS_NOVAS = 2                 # páginas de 100 mais recentes conferidas a cada rodada
PAGINAS_ANTIGAS = int(os.environ.get("CLUBE_PAGINAS_ANTIGAS", "6"))  # páginas do arquivo antigo por rodada
AGORA = dt.datetime.now(dt.timezone.utc)
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/131.0.0.0 Safari/537.36")
PAISES = {  # país no nome da agência ("VML Peru", "Ogilvy Argentina") → região do site
    "peru": ("América Latina", "PE"), "argentina": ("América Latina", "AR"), "chile": ("América Latina", "CL"),
    "colombia": ("América Latina", "CO"), "colômbia": ("América Latina", "CO"), "mexico": ("América Latina", "MX"),
    "méxico": ("América Latina", "MX"), "uruguay": ("América Latina", "UY"), "uruguai": ("América Latina", "UY"),
    "ecuador": ("América Latina", "EC"), "equador": ("América Latina", "EC"), "paraguay": ("América Latina", "PY"),
    "portugal": ("Europa", "PT"), "lisboa": ("Europa", "PT"), "espanha": ("Europa", "ES"), "spain": ("Europa", "ES"),
    "madrid": ("Europa", "ES"), "london": ("Reino Unido", "GB"), "londres": ("Reino Unido", "GB"), "uk": ("Reino Unido", "GB"),
    "new york": ("EUA", "US"), "nova york": ("EUA", "US"), "usa": ("EUA", "US"), "eua": ("EUA", "US"),
}


def log(*a):
    print(*a, flush=True)


def api(caminho, **params):
    url = API + caminho + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8", "replace")), int(r.headers.get("X-WP-TotalPages") or 0)


def txt(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def filmes(conteudo):
    """YouTube e Vimeo embutidos no texto do Clube."""
    yts, vimeo = [], ""
    for m in re.finditer(r"(?:youtube(?:-nocookie)?\.com/(?:embed/|watch\?v=|shorts/)|youtu\.be/)([\w-]{11})", conteudo):
        if m.group(1) not in yts:
            yts.append(m.group(1))
    m = re.search(r"(?:player\.)?vimeo\.com/(?:video/)?(\d{6,})", conteudo)
    if m:
        vimeo = "https://vimeo.com/" + m.group(1)
    return yts, vimeo


def miolo_da_pagina(url):
    """A página do Clube (o filme do acervo fica num campo do tema, fora do texto da API)."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=25) as r:
            pg = r.read(2_000_000).decode("utf-8", "replace")
    except Exception:  # noqa: BLE001
        return ""
    # o primeiro filme da página é o da campanha (a barra lateral vem depois e só tem links)
    m = re.search(r"<iframe[^>]+(?:youtube|vimeo)[^>]+>", pg, re.I)
    return m.group(0) if m else ""


def ficha_de(conteudo):
    pares = CR.creditos_de("<article><p>%s</p>%s</article>" % ("x " * 200, conteudo))
    return CR.limpar_creditos(pares)


def valor(ficha, *chaves):
    for k in ficha:
        if re.search(r"^(%s)\b" % "|".join(chaves), k["role"], re.I):
            return k["name"]
    return ""


def pessoas(ficha, *chaves):
    out = []
    for k in ficha:
        if re.search(r"(%s)" % "|".join(chaves), k["role"], re.I) and not re.search(r"assistente|assistant|trainee|estagi", k["role"], re.I):
            out.append(k["name"])
    return ", ".join(out[:2])


def regiao_de(agencia, titulo):
    t = (agencia + " " + titulo).lower()
    for k, v in PAISES.items():
        if re.search(r"\b%s\b" % re.escape(k), t):
            return v
    return ("Brasil", "BR")


def texto_proprio(marca, nome, agencia, ficha, pecas):
    """Resumo escrito pelo robô só com os fatos (marca, agência, quem fez): nada do texto do Clube."""
    partes = []
    if agencia and nome:
        partes.append("%s estreia “%s”, campanha assinada pela %s." % (marca, nome, agencia))
    elif agencia:
        partes.append("Nova campanha de %s, assinada pela %s." % (marca, agencia))
    else:
        partes.append("%s estreia “%s”." % (marca, nome) if nome else "Nova campanha de %s." % marca)
    dc = pessoas(ficha, r"\bdire[çc][ãa]o (geral |executiva )?de cria|\bdiretor(a|es|as)? (geral |executiv[oa]s? )?de cria|^(executive )?creative directors?\b|\bcco\b|chief creative|\bvp de cria|\becd\b")
    if dc:
        partes.append("Direção de criação de %s." % dc)
    prod = valor(ficha, r"produtora( de imagem| de filme)?$", r"production company", r"productora", r"casa produtora")
    dire = pessoas(ficha, r"^dire[çc][ãa]o( de cena)?$|^diretor(a)?( de cena)?$|^director$|^film director$|^realiza")
    if prod and ("," in prod or " e " in prod or len(prod.split()) > 5):
        prod = ""  # é a lista de pessoas da produção da agência, não o nome da produtora
    if prod and dire:
        partes.append("O filme tem direção de %s, pela %s." % (dire, prod))
    elif prod:
        partes.append("Produção da %s." % prod)
    if pecas:
        partes.append(pecas)
    return " ".join(partes)


def pecas_de(conteudo):
    """Que tipo de peças a campanha tem (só a categoria, sem copiar frases)."""
    t = txt(conteudo).lower()
    tipos = [("filme", r"\bfilmes?\b|comercia"), ("mídia exterior", r"\bout ?of ?home|\booh\b|mídia exterior|painéis|outdoor"),
             ("redes sociais", r"redes sociais|social media|tiktok|instagram|creators|influenciador"),
             ("ação no ponto de venda", r"ponto de venda|pdv|varejo|retail|loja"), ("rádio", r"\brádio\b|spot"),
             ("ativação", r"ativação|evento|experiência"), ("mídia impressa", r"\bjornal\b|revista|impresso")]
    achou = [n for n, rx in tipos if re.search(rx, t)]
    if len(achou) >= 2:
        return "O esforço inclui %s e %s." % (", ".join(achou[:-1]), achou[-1])
    return ""


def campanha_do_acervo(x):
    titulo = txt(x["title"]["rendered"])
    m = re.match(r"^(.*?)\s+[–—-]\s+(.+?)\s*/\s*(.+)$", titulo)
    if not m:
        return None
    nome, agencia, marca = m.group(1).strip(" “”\""), m.group(2).strip(), m.group(3).strip()
    if agencia.lower() in ("galeria", "in house", "in-house") and marca:
        agencia = "Galeria" if agencia.lower() == "galeria" else "In-house"
    conteudo = x["content"]["rendered"]
    yts, vimeo = filmes(conteudo)
    if not (yts or vimeo):
        yts, vimeo = filmes(miolo_da_pagina(x["link"]))  # o tema do Clube põe o filme fora do texto
    ficha = ficha_de(conteudo)
    if not agencia:
        agencia = valor(ficha, r"ag[êe]ncia", r"agency")
    og = ((x.get("yoast_head_json") or {}).get("og_image") or [{}])[0].get("url", "")
    if not (yts or vimeo or og):
        return None
    data = x["date"][:10]
    regiao, cc = regiao_de(agencia, titulo)
    c = {
        "id": "%s-%s-%s" % (data, A.slug(marca, 20), A.slug(nome or marca, 36)),
        "date": data, "brand": marca, "title": nome or marca, "agency": agencia,
        "source": "Clube de Criação", "url": x["link"], "region": regiao, "cc": cc,
        "summary": texto_proprio(marca, nome, agencia, ficha, pecas_de(conteudo)),
        "addedAt": AGORA.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    if yts:
        c["yt"] = yts[:3]
    elif vimeo:
        c["video"] = vimeo
    if og:
        c["image"] = og
    if ficha:
        c["ficha"] = ficha
    return c


def campanha_das_ultimas(x):
    """Notícia de campanha nas Últimas: só entra com filme, e o texto é escrito do zero."""
    conteudo = x["content"]["rendered"]
    yts, vimeo = filmes(conteudo)
    if not (yts or vimeo):
        return None
    titulo = txt(x["title"]["rendered"])
    corpo = txt(conteudo)
    # marca e agência: os nomes em negrito-itálico do Clube (<strong><em>Marca</em></strong>) na ordem em que aparecem
    nomes = []
    for m in re.finditer(r"<strong>\s*<em>([^<]{2,40})</em>\s*</strong>|<em>\s*<strong>([^<]{2,40})</strong>\s*</em>", conteudo):
        n = (m.group(1) or m.group(2)).strip(" ,.")
        if n and n not in nomes and n.lower() != titulo.lower():
            nomes.append(n)
    agencia = ""
    m = re.search(r"(?:criad[ao]s? pela|assinad[ao]s? pela|desenvolvid[ao]s? pela|da agência)\s+([A-ZÀ-Ý][\w&’'.\- ]{1,40}?)(?=[,.;)]| de | em | para |$)", corpo)
    if m:
        agencia = m.group(1).strip()
    ficha = ficha_de(conteudo)
    agencia = agencia or valor(ficha, r"ag[êe]ncia", r"agency")
    marca = valor(ficha, r"anunciante", r"cliente", r"client", r"marca", r"brand") or \
        next((n for n in nomes if n != agencia and A.marca_ok(n)), "")
    if not marca:
        return None
    data = x["date"][:10]
    regiao, cc = regiao_de(agencia, corpo[:400])
    fora = re.search(r"\b(EUA|Estados Unidos|Nova York|Los Angeles|Reino Unido|Londres|Inglaterra|França|Paris|Alemanha|"
                     r"Itália|Espanha|Japão|Tóquio|China|Coreia|Índia|Austrália|Canadá|México|Argentina|Holanda|Suécia|"
                     r"Dinamarca|Noruega|Irlanda|Escócia|Dubai|Emirados|África do Sul|Nova Zelândia|Singapura)\b", corpo[:700])
    if regiao == "Brasil" and fora and not re.search(r"\bbrasil|brasileir|são paulo|rio de janeiro", corpo[:700], re.I):
        regiao, cc = "Global", ""
    og = ((x.get("yoast_head_json") or {}).get("og_image") or [{}])[0].get("url", "")
    c = {
        "id": "%s-%s-%s" % (data, A.slug(marca, 20), A.slug(titulo, 36)),
        "date": data, "brand": marca, "title": titulo, "agency": agencia,
        "source": "Clube de Criação", "url": x["link"], "region": regiao, "cc": cc, "summary": texto_proprio(marca, titulo, agencia, ficha, pecas_de(conteudo)),
        "addedAt": AGORA.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    if yts:
        c["yt"] = yts[:3]
    else:
        c["video"] = vimeo
    if og:
        c["image"] = og
    if ficha:
        c["ficha"] = ficha
    return c


def ler_paginas(tipo, paginas, conv, extra=None):
    out = []
    for p in paginas:
        try:
            itens, total = api(tipo, per_page=100, page=p, orderby="date", order="desc", **(extra or {}))
        except Exception as e:  # noqa: BLE001
            log("  falhou", tipo, "página", p, e)
            if "400" in str(e):
                return out, True  # passou do fim
            continue
        for x in itens:
            try:
                c = conv(x)
            except Exception as e:  # noqa: BLE001
                log("  item com problema:", x.get("link"), e)
                c = None
            if c:
                out.append(c)
        time.sleep(0.5)
    return out, False


def assunto_campanhas():
    try:
        termos, _ = api("assunto", per_page=100)
        for t in termos:
            if re.match(r"campanhas?$", t.get("name", ""), re.I) or t.get("slug") == "campanhas":
                return t["id"]
    except Exception as e:  # noqa: BLE001
        log("  assuntos falharam:", e)
    return None


def main(testar=False):
    estado = A.ler_json(ESTADO, {})
    novas = []
    # 1) acervo: as mais recentes
    achou, _ = ler_paginas("acervo", range(1, (1 if testar else PAGINAS_NOVAS) + 1), campanha_do_acervo)
    novas += achou
    # 2) últimas do assunto Campanhas (só com filme)
    if not testar:
        aid = estado.get("assunto_campanhas") or assunto_campanhas()
        if aid:
            estado["assunto_campanhas"] = aid
            achou, _ = ler_paginas("ultima", [1], campanha_das_ultimas, {"assunto": aid})
            novas += achou
    # 3) acervo antigo: desce algumas páginas por rodada até INICIO_ARQUIVO
    if not testar and not estado.get("acervo_fim"):
        ini = estado.get("acervo_pagina", PAGINAS_NOVAS) + 1
        achou, fim = ler_paginas("acervo", range(ini, ini + PAGINAS_ANTIGAS), campanha_do_acervo)
        novas += [c for c in achou if c["date"] >= INICIO_ARQUIVO]
        estado["acervo_pagina"] = ini + PAGINAS_ANTIGAS - 1
        if fim or (achou and min(c["date"] for c in achou) < INICIO_ARQUIVO):
            estado["acervo_fim"] = True
    if testar:
        for c in novas[:10]:
            log(json.dumps(c, ensure_ascii=False)[:900])
        return
    A.salvar_json(ESTADO, estado)
    json.dump(novas, open(ACHADOS, "w", encoding="utf-8"), ensure_ascii=False)
    log("Do Clube nesta rodada:", len(novas), "| acervo na página", estado.get("acervo_pagina"))


def _palavras(t):
    return {w for w in re.findall(r"[a-z0-9]{5,}", A.sem_acento(t or "").lower())} - {"campanha", "campaign", "black", "friday", "natal"}


def mesma_campanha(a, b):
    """Mesma marca, estreia com até 3 dias de diferença e o título com uma palavra em comum: é a mesma
    campanha vinda de dois lugares (o Clube e um veículo)."""
    if A.chave(a.get("brand")) != A.chave(b.get("brand")) or not A.chave(a.get("brand")):
        return False
    try:
        d = abs((dt.date.fromisoformat(a["date"]) - dt.date.fromisoformat(b["date"])).days)
    except (ValueError, KeyError):
        return False
    return d <= 3 and bool(_palavras(a.get("title")) & _palavras(b.get("title")))


def enriquecer(velha, nova):
    """A campanha que já estava no site ganha o que o Clube tem a mais (filme, imagem, ficha técnica)."""
    if not velha.get("yt") and not velha.get("video"):
        if nova.get("yt"):
            velha["yt"] = nova["yt"]
        elif nova.get("video"):
            velha["video"] = nova["video"]
    for k in ("image", "ficha"):
        if nova.get(k) and not velha.get(k):
            velha[k] = nova[k]
    if nova.get("agency") and not velha.get("agency"):
        velha["agency"] = nova["agency"]


def aplicar():
    """Junta em campaigns.json sem repetir (mesmo link, mesma marca+título, ou mesmo filme). Campanhas que
    já vieram do Clube pelo feed antigo trocam o texto do Clube pelo texto próprio."""
    try:
        novas = json.load(open(ACHADOS, encoding="utf-8"))
    except (OSError, ValueError):
        return
    camp = A.ler_json(A.CAMP, [])
    por_url = {c.get("url", "").split("?")[0].rstrip("/"): c for c in camp}
    chaves = {(A.chave(c.get("brand", "")), A.chave(c.get("title", ""))) for c in camp}
    yts = {y for c in camp for y in (c.get("yt") or [])}
    ids = {c["id"] for c in camp}
    por_marca = {}
    for x in camp:
        por_marca.setdefault(A.chave(x.get("brand")), []).append(x)
    entrou, trocou = 0, 0
    for c in novas:
        u = c["url"].split("?")[0].rstrip("/")
        velha = por_url.get(u)
        if velha:
            if "clubedecriacao" in u and velha.get("summary") != c["summary"]:
                velha["summary"] = c["summary"]
                velha.pop("story", None)
                velha.pop("frase", None)
                for k in ("yt", "video", "image", "ficha"):
                    if c.get(k) and not velha.get(k):
                        velha[k] = c[k]
                trocou += 1
            continue
        if (A.chave(c["brand"]), A.chave(c["title"])) in chaves or any(y in yts for y in c.get("yt") or []):
            continue
        igual = next((x for x in por_marca.get(A.chave(c["brand"]), []) if mesma_campanha(c, x)), None)
        if igual:
            enriquecer(igual, c)
            trocou += 1
            continue
        while c["id"] in ids:
            c["id"] += "-2"
        camp.append(c)
        ids.add(c["id"])
        chaves.add((A.chave(c["brand"]), A.chave(c["title"])))
        yts.update(c.get("yt") or [])
        entrou += 1
    # o texto do Clube não fica no site: as campanhas que entraram pelo feed antigo e não estão na leva
    for c in camp:
        if "clubedecriacao.com.br" in c.get("url", "") and c.get("story"):
            c.pop("story", None)
            trocou += 1
    if entrou or trocou:
        camp.sort(key=lambda c: (c.get("date", ""), c.get("addedAt", "")), reverse=True)
        A.salvar_json(A.CAMP, camp)
        A.salvar_json(A.NOVIDADES, {"atualizado": AGORA.strftime("%Y-%m-%dT%H:%M:%SZ"), "total": len(camp),
                                    "ultimo": camp[0]["id"]})
    log("Entraram:", entrou, "| texto trocado:", trocou)


if __name__ == "__main__":
    if "--aplicar" in sys.argv:
        aplicar()
    elif "--testar" in sys.argv:
        main(testar=True)
    else:
        main()
