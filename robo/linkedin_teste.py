"""Teste lado a lado de duas fontes pagas de posts do LinkedIn (Apify/HarvestAPI e Coresignal).

Fase de teste, mas o que passar no filtro já é publicado no site (campaigns.json), como card
com o link do post no LinkedIn. Também lê as páginas de veículos (PUBLICACOES: Contagious, Ads of the World, Adweek...). Cobre TODAS as agências do robô (lista do Pedro +
agências cadastradas, ~1.000), em rodízio: cada rodada pega uma fatia da lista e continua de onde
parou na seguinte. Para cada agência da fatia, três buscas:
  1. posts da página da empresa no LinkedIn;
  2. posts de qualquer pessoa que cite a agência junto de palavras de campanha
     (quem trabalha nela, clientes, imprensa);
  3. (Coresignal) posts de funcionários da agência.
Tudo passa pelos mesmos filtros do robô (só campanha, nada institucional) e o placar vai para
robo/linkedin_teste.json: posts e campanhas por fonte e por tipo de busca, o que só uma das fontes
achou, atraso e custo.

Cada fonte só roda se o token dela existir (secrets APIFY_TOKEN e CORESIGNAL_TOKEN).
Tetos por rodada (variáveis de ambiente): APIFY_EMPRESAS (padrão 150 páginas × 3 posts),
APIFY_BUSCAS (padrão 60 buscas × 5 posts) → no máximo ~US$ 1,50 por rodada;
CORESIGNAL_AGENCIAS (padrão 150 buscas, que são grátis) e CORESIGNAL_COLETAS (padrão 60 créditos).
"""
import collections
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import atualizar as A  # noqa: E402  (filtros e utilidades do robô principal)

SAIDA = os.path.join(AQUI, "linkedin_teste.json")
AGORA = dt.datetime.now(dt.timezone.utc)
DESDE = (AGORA - dt.timedelta(days=int(os.environ.get("JANELA_DIAS", "7")))).date().isoformat()  # janela (o site aceita até 10 dias)
ENV = lambda k, p: int(os.environ.get(k, p))  # noqa: E731
APIFY_EMPRESAS, APIFY_POR_EMPRESA = ENV("APIFY_EMPRESAS", "150"), ENV("APIFY_POR_EMPRESA", "3")
APIFY_BUSCAS, APIFY_POR_BUSCA = ENV("APIFY_BUSCAS", "60"), ENV("APIFY_POR_BUSCA", "25")
# perfis de pessoas que postam campanhas de várias agências (curadores): os posts novos de cada um
PERFIS = [
    {"nome": "Rian Swart", "url": "https://www.linkedin.com/in/rian-swart-425570143/"},
]
APIFY_POR_PERFIL = ENV("APIFY_POR_PERFIL", "15")
# páginas de veículos/publicações no LinkedIn (Contagious, Ads of the World...): cada post de campanha
# vira card. Vários palpites de endereço; o robô fica com o primeiro que trouxer post.
PUBLICACOES = [
    {"nome": "Contagious", "slugs": ["contagious-communications"]},
    {"nome": "Ads of the World", "slugs": ["ads-of-the-world", "adsoftheworld"]},
    {"nome": "Clube de Criação", "slugs": ["clube-de-criacao", "clubedecriacao"]},
    {"nome": "Mumbrella", "slugs": ["mumbrella"]},
    {"nome": "Adweek", "slugs": ["adweek"]},
    {"nome": "The Drum", "slugs": ["the-drum", "thedrum"]},
    {"nome": "Campaign", "slugs": ["campaign-magazine", "campaign-uk", "campaign-us"]},
    {"nome": "Ad Age", "slugs": ["advertising-age", "adage"]},
    {"nome": "LBB Online", "slugs": ["little-black-book", "lbbonline", "lbb-online"]},
    {"nome": "shots", "slugs": ["shots"]},
    {"nome": "Muse by Clios", "slugs": ["muse-by-clios", "clio-awards"]},
    {"nome": "Creative Review", "slugs": ["creative-review"]},
    {"nome": "Campaign Brief", "slugs": ["campaign-brief", "campaignbrief"]},
    {"nome": "Meio & Mensagem", "slugs": ["meio-&-mensagem", "meioemensagem", "meio-e-mensagem"]},
    {"nome": "Propmark", "slugs": ["propmark"]},
    {"nome": "B9", "slugs": ["b9"]},
]
APIFY_POR_PUBLICACAO = ENV("APIFY_POR_PUBLICACAO", "8")
CS_AGENCIAS, CS_COLETAS = ENV("CORESIGNAL_AGENCIAS", "150"), ENV("CORESIGNAL_COLETAS", "60")
PALAVRAS = "(campaign OR campanha OR campaña OR campagne OR film OR filme OR spot OR commercial)"


def log(*a):
    print(*a, flush=True)


def pedir(url, dados=None, cab=None, tempo=300):
    corpo = json.dumps(dados).encode() if dados is not None else None
    req = urllib.request.Request(url, data=corpo, method="POST" if corpo else "GET")
    req.add_header("Accept", "application/json")
    # sem isto a Cloudflare da Coresignal barra o Python (erro 1010)
    req.add_header("User-Agent", "Mozilla/5.0 (compatible; droppad-robo/1.0; +https://dropp.ad)")
    if corpo:
        req.add_header("Content-Type", "application/json")
    for k, v in (cab or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=tempo) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "null")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8") or "null")
        except ValueError:
            return e.code, None
    except Exception as e:  # noqa: BLE001  (tempo esgotado, rede)
        return 0, str(e)


def g(d, *caminho):
    for k in caminho:
        if isinstance(d, dict):
            d = d.get(k)
        elif isinstance(d, list) and isinstance(k, int) and len(d) > k:
            d = d[k]
        else:
            return None
    return d


def slugs_de(nome, site="", usuario=""):
    """Palpites do endereço da página no LinkedIn, do mais provável ao menos."""
    out = []
    if site:
        host = urllib.parse.urlparse(site if "//" in site else "https://" + site).netloc.lower().replace("www.", "")
        if host:
            out.append(host.split(".")[0])
    if usuario:
        out.append(usuario.lstrip("@").lower().replace(".", "-").replace("_", "-"))
    base = re.sub(r"[^a-z0-9]+", "-", A.sem_acento(nome).lower()).strip("-")
    if base:
        out += [base, base.replace("-", "")]
    vistos, ok = set(), []
    for s in out:
        if s and s not in vistos:
            vistos.add(s)
            ok.append(s)
    return ok


def agencias(estado):
    """Todas as agências do robô (fontes.json: agências + lista do Instagram), sem repetir."""
    fontes = json.load(open(os.path.join(AQUI, "fontes.json"), encoding="utf-8"))
    corr = estado.get("linkedin", {})  # correções manuais: nome → slug certo
    por = collections.OrderedDict()
    for a in fontes.get("agencias", []):
        por.setdefault(A.chave(a["nome"]), {"nome": a["nome"], "site": a.get("site", ""), "usuario": "",
                                            "regiao": a.get("regiao", "Global"), "cc": a.get("cc", "")})
    for c in fontes.get("instagram", []):
        nome = c.get("agencia") or c.get("nome") or c["usuario"]
        a = por.setdefault(A.chave(nome), {"nome": nome, "site": "", "usuario": "",
                                           "regiao": c.get("regiao", "Global"), "cc": c.get("cc", "")})
        a["usuario"] = a["usuario"] or c["usuario"]
    out = []
    for a in por.values():
        a["slugs"] = [corr[a["nome"]]] if corr.get(a["nome"]) else slugs_de(a["nome"], a["site"], a["usuario"])
        if a["slugs"] and len(A.chave(a["nome"])) >= 2:
            out.append(a)
    return out


def fatia(lista, estado, chave, n):
    """Próximos n itens da lista, em rodízio (guarda onde parou)."""
    if not lista or n <= 0:
        return []
    pos = estado.setdefault("pos", {}).get(chave, 0) % len(lista)
    sel = (lista + lista)[pos:pos + min(n, len(lista))]
    estado["pos"][chave] = (pos + len(sel)) % len(lista)
    return sel


def casar(item, ags, nome_autor=""):
    """Qual agência da fatia é esta (pelo nome no texto, no autor ou na página)."""
    alvo = A.chave(nome_autor)
    for a in ags:
        if alvo and (alvo == A.chave(a["nome"]) or alvo in [s.replace("-", "") for s in a["slugs"]]):
            return a
    return None


BARRA = re.compile(r"^\s*([^/\n]{2,80}?)\s+/\s+([^/\n]{2,50}?)\s+/\s+([^/\n]{2,80}?)\s*$", re.M)


def agencia_no_texto(texto, por_nome):
    """Agência citada num post de veículo: linha "Título / Marca / Agência, Cidade" (Contagious),
    uma agência da lista do robô, ou "by/via/with X"."""
    m = BARRA.search(texto or "")
    if m:
        nome = m.group(3).split(",")[0].strip()
        return {"nome": nome, "slugs": [""], "regiao": "Global", "cc": "", "cidade": m.group(3)}
    k = A.chave(texto or "")
    a = next((a for a in por_nome if len(A.chave(a["nome"])) >= 4 and A.chave(a["nome"]) in k), None)
    if a:
        return a
    m = re.search(r"\b(?:by|via|with|por|pela|criad[ao] pela|devised with|created by)\s+@?([A-Z][\w&.’'\-]+(?: [A-Z][\w&.’'\-]+){0,3})", texto or "")
    return {"nome": m.group(1).strip() if m else "", "slugs": [""], "regiao": "Global", "cc": ""}


def campanha_de_barra(p):
    """Posts no formato da Contagious: o texto termina com "Mama Bear / Microsoft / Droga5, New York".
    Vira campanha com título, marca e agência dessa linha; o resumo é escrito pelo robô."""
    m = BARRA.search(p["texto"] or "")
    if not m or not p["data"] or p["data"][:10] < DESDE:
        return None
    titulo, marca, ag_txt = [x.strip(" .") for x in m.groups()]
    partes = [x.strip() for x in ag_txt.split(",")]
    agencia = partes[0]
    if not A.marca_ok(marca) or not agencia:
        return None
    pais = partes[-1].lower() if len(partes) >= 2 else ""
    regiao, cc = PAIS_REGIAO.get(pais, ("Global", ""))
    cidade = partes[1] if len(partes) >= 2 else ""
    if not cc and re.search(r"new york|los angeles|chicago|san francisco|portland|minneapolis|austin|boston", cidade, re.I):
        regiao, cc = "EUA", "US"
    elif not cc and re.search(r"london|londres", cidade, re.I):
        regiao, cc = "Reino Unido", "GB"
    elif not cc and re.search(r"s[aã]o paulo|rio de janeiro", cidade, re.I):
        regiao, cc = "Brasil", "BR"
    resumo = "%s lança “%s”, campanha da %s%s." % (marca, titulo, agencia, (" (" + cidade + ")") if cidade else "")
    data = p["data"][:10]
    curador = (p["agencia"] or {}).get("curador", "LinkedIn")
    c = {"id": "%s-%s-%s" % (data, A.slug(marca, 20), A.slug(titulo, 36)), "date": data, "brand": marca,
         "title": titulo, "agency": agencia, "source": "LinkedIn · " + curador, "url": p["url"],
         "region": regiao, "cc": cc, "summary": resumo, "addedAt": AGORA.strftime("%Y-%m-%dT%H:%M:%SZ")}
    if p["imagem"]:
        c["image"] = p["imagem"]
    return {"marca": marca, "titulo": titulo, "agencia": agencia, "data": p["data"], "url": p["url"],
            "video": bool(p["video"]), "fonte": p["fonte"], "tipo": p["tipo"], "campanha": c}


def post_norm(fonte, tipo, ag, texto, url, data, video="", img=""):
    return {"fonte": fonte, "tipo": tipo, "agencia": ag, "texto": texto or "", "url": url or "",
            "data": str(data or "")[:19], "video": video or "", "imagem": img or ""}


# ---------------------------------------------------------------- Apify (HarvestAPI)
def apify_rodar(ator, entrada, maximo, tok):
    url = ("https://api.apify.com/v2/acts/%s/run-sync-get-dataset-items?token=%s&maxItems=%d"
           % (ator, urllib.parse.quote(tok), maximo))
    return pedir(url, entrada, tempo=290)


def apify_item(it, fonte, tipo, ag):
    imgs = it.get("postImages") or []
    img = (imgs[0].get("url") if imgs and isinstance(imgs[0], dict) else (imgs[0] if imgs else "")) or ""
    return post_norm(fonte, tipo, ag, it.get("content") or it.get("text") or "",
                     it.get("linkedinUrl") or it.get("url") or it.get("postUrl"),
                     g(it, "postedAt", "date") or it.get("postedAt"),
                     g(it, "postVideo", "videoUrl") or g(it, "postVideo", "url"), img)


def ler_apify(todas, estado, placar):
    tok = os.environ.get("APIFY_TOKEN", "").strip()
    if not tok:
        placar["status"] = "sem token"
        return []
    out = []
    st_li = estado.setdefault("slug", {})  # nome → índice do palpite atual; "ok" quando a página respondeu
    # 1) páginas das empresas
    ags = fatia(todas, estado, "apify_empresas", APIFY_EMPRESAS)
    urls = []
    for a in ags:
        i = st_li.get(a["nome"], 0)
        if i == "ok":
            i = 0
        if isinstance(i, int) and i < len(a["slugs"]):
            urls.append(("https://www.linkedin.com/company/%s/" % a["slugs"][i], a))
    st, itens = apify_rodar("harvestapi~linkedin-company-posts",
                            {"targetUrls": [u for u, _ in urls], "maxPosts": APIFY_POR_EMPRESA},
                            APIFY_EMPRESAS * APIFY_POR_EMPRESA, tok)
    placar["empresas"] = {"http": st, "paginas": len(urls)}
    vieram = set()
    if isinstance(itens, list):
        placar["empresas"]["posts"] = len(itens)
        placar.setdefault("amostra", itens[:1])
        por_slug = {u.rstrip("/").rsplit("/", 1)[-1]: a for u, a in urls}
        for it in itens:
            if not isinstance(it, dict):
                continue
            autor = it.get("author") or {}
            slug = str(autor.get("universalName") or "").lower()
            a = por_slug.get(slug) or casar(it, [a for _, a in urls], autor.get("name", ""))
            if a:
                vieram.add(a["nome"])
                st_li[a["nome"]] = "ok"
            out.append(apify_item(it, "apify", "empresa", a))
        # página sem nenhum post: na próxima volta tenta o palpite seguinte de endereço
        for _, a in urls:
            if a["nome"] not in vieram and st_li.get(a["nome"]) != "ok":
                st_li[a["nome"]] = (st_li.get(a["nome"], 0) or 0) + 1
        placar["empresas"]["agencias_com_post"] = len(vieram)
    else:
        placar["empresas"]["erro"] = str(itens)[:300]
    # 2) posts de quem trabalha na agência (filtro "authorsCompanies" do LinkedIn) falando de campanha
    ags = fatia(todas, estado, "apify_buscas", APIFY_BUSCAS)
    total = 0
    st2 = None
    for bloco in [ags[i:i + 10] for i in range(0, len(ags), 10)]:  # o ator aceita no máximo 10 empresas
        st2, itens = apify_rodar("harvestapi~linkedin-post-search",
                                 {"searchQueries": ["campaign", "campanha"], "authorsCompanies": [a["nome"] for a in bloco],
                                  "maxPosts": APIFY_POR_BUSCA, "postedLimit": "week", "sortBy": "date"},
                                 2 * APIFY_POR_BUSCA, tok)
        if not isinstance(itens, list):
            placar["citacoes_erro"] = str(itens)[:300]
            break
        total += len(itens)
        placar.setdefault("amostra_citacao", itens[:1])
        for it in itens:
            if not isinstance(it, dict):
                continue
            autor = it.get("author") or {}
            onde = A.chave(" ".join(str(autor.get(k) or "") for k in ("info", "position", "headline", "name"))
                           + " " + (it.get("content") or ""))
            a = next((a for a in sorted(bloco, key=lambda a: -len(a["nome"])) if A.chave(a["nome"]) in onde), None)
            out.append(apify_item(it, "apify", "funcionario", a))
    placar["citacoes"] = {"http": st2, "buscas": len(ags), "posts": total}
    # 3) perfis de curadores: a agência vem do próprio texto (uma das agências da lista, ou "by/por X")
    st3, itens = apify_rodar("harvestapi~linkedin-profile-posts",
                             {"targetUrls": [p["url"] for p in PERFIS], "maxPosts": APIFY_POR_PERFIL},
                             len(PERFIS) * APIFY_POR_PERFIL, tok)
    n3 = 0
    if isinstance(itens, list):
        por_nome = sorted(todas, key=lambda a: -len(a["nome"]))
        for it in itens:
            if not isinstance(it, dict):
                continue
            texto = it.get("content") or it.get("text") or ""
            autor = (it.get("author") or {}).get("name") or ""
            perfil = next((p["nome"] for p in PERFIS if A.chave(p["nome"]) in A.chave(autor)), PERFIS[0]["nome"])
            k = A.chave(texto)
            a = next((a for a in por_nome if len(A.chave(a["nome"])) >= 4 and A.chave(a["nome"]) in k), None)
            if not a:
                m = re.search(r"\b(?:by|por|agency:?|agência:?|agencia:?|created by|criad[ao] pela)\s+@?([A-Z][\w&.’'\-]+(?: [A-Z][\w&.’'\-]+){0,3})", texto)
                a = {"nome": m.group(1).strip() if m else "", "slugs": [""], "regiao": "Global", "cc": ""}
            a = dict(a, curador=perfil)
            out.append(apify_item(it, "apify", "curador", a))
            n3 += 1
    else:
        placar["perfis_erro"] = str(itens)[:300]
    placar["perfis"] = {"http": st3, "posts": n3}
    total += n3
    # 4) páginas de veículos/publicações: agência e marca vêm do texto do post
    st_pub = estado.setdefault("slug_pub", {})
    urls = []
    ok_pub = estado.setdefault("slug_pub_ok", {})
    for pub in PUBLICACOES:
        i = st_pub.get(pub["nome"], 0)
        if pub["nome"] in ok_pub:
            slug = ok_pub[pub["nome"]]
        elif isinstance(i, int) and i < len(pub["slugs"]):
            slug = pub["slugs"][i]
        else:
            continue  # nenhum palpite trouxe post: precisa do endereço certo à mão
        urls.append(("https://www.linkedin.com/company/%s/" % slug, pub))
    st4, itens = apify_rodar("harvestapi~linkedin-company-posts",
                             {"targetUrls": [u for u, _ in urls], "maxPosts": APIFY_POR_PUBLICACAO},
                             len(urls) * APIFY_POR_PUBLICACAO, tok)
    n4, vieram = 0, set()
    if isinstance(itens, list):
        por_slug = {u.rstrip("/").rsplit("/", 1)[-1].lower(): (u, pub) for u, pub in urls}
        por_nome = sorted(todas, key=lambda a: -len(a["nome"]))
        for it in itens:
            if not isinstance(it, dict):
                continue
            autor = it.get("author") or {}
            slug = str(autor.get("universalName") or "").lower()
            achou = por_slug.get(slug) or next(((u, pub) for u, pub in urls
                                               if A.chave(pub["nome"]) in A.chave(autor.get("name", ""))), None)
            if not achou:
                continue
            u, pub = achou
            vieram.add(pub["nome"])
            st_pub[pub["nome"]] = "ok"
            ok_pub[pub["nome"]] = u.rstrip("/").rsplit("/", 1)[-1]
            texto = it.get("content") or it.get("text") or ""
            a = agencia_no_texto(texto, por_nome)
            out.append(apify_item(it, "apify", "publicacao", dict(a, curador=pub["nome"])))
            n4 += 1
        for u, pub in urls:  # página sem post: na próxima volta tenta o palpite seguinte
            if pub["nome"] not in vieram and pub["nome"] not in ok_pub:
                st_pub[pub["nome"]] = (st_pub.get(pub["nome"], 0) or 0) + 1
    else:
        placar["publicacoes_erro"] = str(itens)[:300]
    placar["publicacoes"] = {"http": st4, "paginas": len(urls), "com_post": sorted(vieram), "posts": n4}
    total += n4
    placar["status"] = "ok"
    placar["custo_usd"] = round((placar["empresas"].get("posts", 0) + total) * 0.0028, 2)
    return out


# ---------------------------------------------------------------- Coresignal
CS = "https://api.coresignal.com/cdapi/v2/"
CS_FILTROS = {  # nomes de filtro a testar; o primeiro que a API aceitar fica guardado
    "company_post": ["company_name", "company_shorthand_name", "author_name", "name"],
    "employee_post": ["company_name", "experience_company_name", "description", "text", "keyword"],
}


def cs_buscar(rota, valor, cab, estado, placar):
    aceito = estado.setdefault("cs_filtro", {}).get(rota)
    if not aceito and rota in placar.get("recusas", {}) and len(placar["recusas"][rota]) >= len(CS_FILTROS[rota]):
        return []  # nenhum filtro aceito nesta rodada: não insiste a cada agência
    tentar = [aceito] if aceito else CS_FILTROS[rota]
    for campo in tentar:
        st, r = pedir(CS + rota + "/search/filter", {"date_published_gte": DESDE, campo: valor}, cab, tempo=60)
        if st < 300 and isinstance(r, list):
            estado["cs_filtro"][rota] = campo
            return r
        placar.setdefault("recusas", {}).setdefault(rota, {})[campo] = "%s %s" % (st, str(r)[:150])
        if st in (401, 402, 403, 429):
            break
    return []


def ler_coresignal(todas, estado, placar):
    tok = os.environ.get("CORESIGNAL_TOKEN", "").strip()
    if not tok:
        placar["status"] = "sem token"
        return []
    cab = {"apikey": tok}
    ags = fatia(todas, estado, "coresignal", CS_AGENCIAS)
    ids, vistos = [], set()
    for a in ags:
        for rota, tipo in (("company_post", "empresa"), ("employee_post", "funcionario")):
            r = cs_buscar(rota, a["nome"], cab, estado, placar)
            ids += [(rota, tipo, x, a) for x in r[:3] if (rota, x) not in vistos]
            vistos.update((rota, x) for x in r[:3])
    placar["ids"] = len(ids)
    placar["agencias"] = len(ags)
    out, coletas = [], 0
    for rota, tipo, pid, a in ids:
        if coletas >= CS_COLETAS:
            break
        st, it = pedir(CS + rota + "/collect/%s" % urllib.parse.quote(str(pid)), cab=cab, tempo=60)
        coletas += 1
        if st >= 300 or not isinstance(it, dict):
            continue
        if len(placar.setdefault("amostra", [])) < 2:
            placar["amostra"].append(it)
        out.append(post_norm("coresignal", tipo, a,
                             it.get("text") or it.get("content") or it.get("description"),
                             it.get("url") or it.get("post_url") or it.get("share_url"),
                             it.get("date_published") or it.get("published_at") or it.get("created_at"),
                             g(it, "article_video", "url"),
                             g(it, "article_video", "image_url")))
    placar["status"] = "ok" if estado.get("cs_filtro") else "filtros recusados (ver 'recusas')"
    placar["creditos"] = coletas
    return out


# ---------------------------------------------------------------- filtro (o mesmo do Instagram)
_MARCAS = None


def marcas_conhecidas():
    """Marcas que já estão no site (chave → nome), para reconhecer marca em hashtag ou no texto."""
    global _MARCAS
    if _MARCAS is None:
        _MARCAS = {}
        for c in A.ler_json(A.CAMP, []):
            m = c.get("brand", "")
            k = A.chave(m)
            if len(k) >= 4 and A.marca_ok(m):
                _MARCAS.setdefault(k, m)
    return _MARCAS


MARCA_LI = [  # "A Mercedes-Benz Trucks celebra", "lançamento de Gloss Absolu", "a campanha da Heinz"
    re.compile(r"(?:^|(?<=\s))(?:A|O|The)\s+" + A._NOME + r"\s+(?:celebra|lança|lançou|apresenta|estreia|launches|unveils|celebrates)\b"),
    re.compile(r"\b(?:lançamento|lancamento|launch|estreia)\s+(?:d[aoe]s?|of|for)\s+(?:nova\s+|novo\s+|linha\s+)?" + A._NOME),
    re.compile(r"\b(?:campanha|campaign|filme|film|ação|ativação|activation)\s+(?:\S+\s+){0,6}?(?:para|pra|for|d[aoe]s?)\s+(?:a\s+|o\s+|the\s+)?" + A._NOME),
]


NAO_LI = re.compile(r"\b(finalista|finalist|indicad[ao]s?|nominated|vote|votar|vota[çc][ãa]o|destaque no|case study)\b", re.I)


def campanha_por_marca(p, a, conta, falso):
    """Segunda chance para posts do LinkedIn que falam de campanha mas não têm a marca num formato que o
    filtro do Instagram reconhece: procura a marca nas hashtags (#Kerastase) e em frases de lançamento."""
    texto = p["texto"]
    inicio = A.limpar(A.HASHTAG.sub(" ", texto))[:600]
    if not A.FORTE.search(texto[:800]) and not re.search(r"\b(lançamento|launch|estreia|instalação|installation)\b", inicio, re.I):
        return None
    if A.EXCLUI.search(inicio[:300]) or A.INSTITUCIONAL.search(inicio[:300]) or A.ENTREVISTA.search(inicio[:400]):
        return None
    if NAO_LI.search(inicio[:400]):
        return None
    ag = A.chave(a["nome"])
    conhecidas = marcas_conhecidas()
    marca = ""
    for h in re.findall(r"#([\wÀ-ÿ]{3,40})", texto):
        k = A.chave(h)
        if k in conhecidas and not (ag and (k.startswith(ag) or ag.startswith(k))):
            marca = conhecidas[k]
            break
    if not marca:
        for rx in MARCA_LI:
            m = rx.search(inicio)
            mk = A.marca_ok(m.group(1).rstrip(".,")) if m else ""
            if mk and A.chave(mk) != ag:
                marca = mk
                break
    if not marca:
        return None
    data = A.data_de(falso["timestamp"])
    if not data or data < DESDE:
        return None
    linhas = [A.limpar(x) for x in A.HASHTAG.sub(" ", texto).splitlines() if A.limpar(x).strip(" .·-—|")]
    titulo = (linhas[0] if linhas else marca)[:140]
    q = re.search(r"\b(?:campanha|campaign|campaña|filme|film|projeto|project)\s*:?\s*[“\"«]([^”\"»]{3,70})[”\"»]", inicio, re.I)
    if q:
        titulo = q.group(1).strip()  # o nome da campanha entre aspas é o melhor título
    return {"id": "%s-%s-%s" % (data, A.slug(marca, 20), A.slug(titulo, 36)), "date": data, "brand": marca,
            "title": titulo, "agency": a["nome"], "source": "LinkedIn · " + (a.get("curador") or a["nome"]), "url": p["url"],
            "region": a["regiao"], "cc": a["cc"], "summary": A.primeira_frase(inicio),
            "addedAt": AGORA.strftime("%Y-%m-%dT%H:%M:%SZ")}


PAIS_REGIAO = {  # último pedaço de "Advertising Agency: X, Cidade, País" → região e código do site
    "usa": ("EUA", "US"), "united states": ("EUA", "US"), "canada": ("EUA e Canadá", "CA"), "uk": ("Reino Unido", "GB"),
    "united kingdom": ("Reino Unido", "GB"), "england": ("Reino Unido", "GB"), "scotland": ("Reino Unido", "GB"),
    "brazil": ("Brasil", "BR"), "brasil": ("Brasil", "BR"), "mexico": ("América Latina", "MX"), "argentina": ("América Latina", "AR"),
    "chile": ("América Latina", "CL"), "colombia": ("América Latina", "CO"), "peru": ("América Latina", "PE"),
    "ecuador": ("América Latina", "EC"), "uruguay": ("América Latina", "UY"), "france": ("Europa", "FR"), "germany": ("Europa", "DE"),
    "italy": ("Europa", "IT"), "spain": ("Europa", "ES"), "portugal": ("Europa", "PT"), "netherlands": ("Europa", "NL"),
    "belgium": ("Europa", "BE"), "sweden": ("Europa", "SE"), "denmark": ("Europa", "DK"), "norway": ("Europa", "NO"),
    "finland": ("Europa", "FI"), "ireland": ("Europa", "IE"), "greece": ("Europa", "GR"), "poland": ("Europa", "PL"),
    "switzerland": ("Europa", "CH"), "austria": ("Europa", "AT"), "turkey": ("Europa", "TR"), "romania": ("Europa", "RO"),
    "czech republic": ("Europa", "CZ"), "hungary": ("Europa", "HU"), "japan": ("Ásia-Pacífico", "JP"), "china": ("Ásia-Pacífico", "CN"),
    "hong kong": ("Ásia-Pacífico", "HK"), "singapore": ("Ásia-Pacífico", "SG"), "india": ("Ásia-Pacífico", "IN"),
    "australia": ("Ásia-Pacífico", "AU"), "new zealand": ("Ásia-Pacífico", "NZ"), "south korea": ("Ásia-Pacífico", "KR"),
    "korea": ("Ásia-Pacífico", "KR"), "thailand": ("Ásia-Pacífico", "TH"), "vietnam": ("Ásia-Pacífico", "VN"),
    "indonesia": ("Ásia-Pacífico", "ID"), "philippines": ("Ásia-Pacífico", "PH"), "malaysia": ("Ásia-Pacífico", "MY"),
    "taiwan": ("Ásia-Pacífico", "TW"), "uae": ("Oriente Médio e África", "AE"), "united arab emirates": ("Oriente Médio e África", "AE"),
    "saudi arabia": ("Oriente Médio e África", "SA"), "south africa": ("Oriente Médio e África", "ZA"),
    "israel": ("Oriente Médio e África", "IL"), "egypt": ("Oriente Médio e África", "EG"), "lebanon": ("Oriente Médio e África", "LB"),
    "nigeria": ("Oriente Médio e África", "NG"), "kenya": ("Oriente Médio e África", "KE"),
}


def campanha_de_curador(p):
    """Posts no formato do Ads of the World (o que curadores como Rian Swart publicam):
        Marca Produto, Título da Campanha
        Advertising Agency: Agência, Cidade, País
        Chief Creative Officer: Fulano …
    Vira campanha direto, com a ficha técnica; o texto do site é escrito pelo robô a partir dos dados."""
    linhas = [l.strip() for l in (p["texto"] or "").splitlines() if l.strip()]
    if len(linhas) < 2 or not p["data"] or p["data"][:10] < DESDE:
        return None
    ag_i = next((i for i, l in enumerate(linhas[:6]) if re.match(r"(advertising |creative |digital |media )?agenc(y|ies)\s*:", l, re.I)), None)
    if ag_i is None:
        return None
    cab = linhas[0]
    if "," in cab:
        marca, titulo = [x.strip() for x in cab.split(",", 1)]
    elif re.match(r"^(.{2,30}?)[’']s?\s", cab):
        # "IKEA’s Black Friday Surgery Distraction": a marca é o dono do título
        marca, titulo = re.match(r"^(.{2,30}?)[’']s?\s", cab).group(1).strip(), cab.strip()
    else:
        marca, titulo = cab.strip(), cab.strip()
    marca = re.sub(r"[’']s$", "", marca).strip()
    if not marca or len(marca) > 60:
        return None
    ag_txt = linhas[ag_i].split(":", 1)[1].strip()
    primeira = re.split(r",\s*and\s+|\s+and\s+(?=[A-Z])", ag_txt)[0]
    partes = [x.strip() for x in primeira.split(",")]
    agencia = partes[0]
    pais = partes[-1].lower().strip(" .") if len(partes) >= 2 else ""
    regiao, cc = PAIS_REGIAO.get(pais, ("Global", ""))
    ficha = []
    for l in linhas[ag_i + 1:]:
        m = re.match(r"^([^:]{2,60}?)\s*:\s*(.{2,300})$", l)
        if m:
            ficha.append({"role": m.group(1).strip(), "name": m.group(2).strip(" .")})
        elif ficha and len(l) > 140:
            break
    nome = titulo or marca
    dc = ", ".join(k["name"] for k in ficha if re.search(r"chief creative|executive creative|^creative director", k["role"], re.I))[:120]
    dc = re.sub(r",?\s+and\s+", " e ", dc)
    prod = next((k["name"] for k in ficha if re.match(r"production compan", k["role"], re.I)), "")
    resumo = "%s lança “%s”, campanha da %s%s." % (marca, nome, agencia, (" (" + partes[1].strip() + ")") if len(partes) >= 3 else "")
    if dc:
        resumo += " Criação liderada por %s." % dc
    if prod:
        resumo += " Produção: %s." % prod.split(",")[0]
    data = p["data"][:10]
    c = {"id": "%s-%s-%s" % (data, A.slug(marca, 20), A.slug(nome, 36)), "date": data, "brand": marca, "title": nome,
         "agency": agencia, "source": "LinkedIn · " + (p["agencia"] or {}).get("curador", "LinkedIn"), "url": p["url"],
         "region": regiao, "cc": cc, "summary": resumo, "addedAt": AGORA.strftime("%Y-%m-%dT%H:%M:%SZ")}
    if p["imagem"]:
        c["image"] = p["imagem"]
    if ficha:
        c["ficha"] = ficha[:40]
    return {"marca": marca, "titulo": nome, "agencia": agencia, "data": p["data"], "url": p["url"],
            "video": bool(p["video"]), "fonte": p["fonte"], "tipo": p["tipo"], "campanha": c}


def vira_campanha(p):
    if p.get("tipo") in ("curador", "publicacao"):
        c = campanha_de_curador(p) or campanha_de_barra(p)
        if c:
            return c
    a = p["agencia"]
    if p.get("tipo") == "publicacao" and not (a or {}).get("nome"):
        return None  # post de veículo sem agência identificada
    if not a or not p["texto"] or not p["data"] or p["data"][:10] < DESDE:
        return None
    falso = {"caption": p["texto"], "permalink": p["url"] or "https://www.linkedin.com/",
             "timestamp": p["data"] + ("" if p["data"].endswith("Z") else "Z"),
             "media_type": "VIDEO" if p["video"] else "IMAGE"}
    conta = {"usuario": a["slugs"][0], "nome": a["nome"], "regiao": a["regiao"], "cc": a["cc"], "agencia": a["nome"]}
    c = campanha_por_marca(p, a, conta, falso) or A.post_para_campanha(falso, conta, DESDE)
    if not c:
        return None
    # LinkedIn tem muito vídeo institucional: aqui exige palavra de campanha mesmo com vídeo,
    # e descarta "marca" que é data comemorativa (Thanksgiving, Natal...)
    if not A.FORTE.search(p["texto"][:600]) and not re.search(r"\b(lançamento|launch|estreia)\b", p["texto"][:600], re.I):
        return None
    if A.INSTITUCIONAL.search(c["brand"]) or NAO_LI.search(p["texto"][:400]):
        return None
    # o site não embute post do LinkedIn: entra como card, com a imagem do post e o link para ele
    c["source"] = "LinkedIn · " + (a.get("curador") or a["nome"])
    c.pop("video", None)
    if p["imagem"]:
        c["image"] = p["imagem"]
    return {"marca": c["brand"], "titulo": c["title"], "agencia": a["nome"], "data": p["data"], "url": p["url"],
            "video": bool(p["video"]), "fonte": p["fonte"], "tipo": p["tipo"], "campanha": c}


def publicar(caminho):
    """Junta as campanhas achadas (arquivo gerado pela rodada) em campaigns.json, sem repetir.
    Roda depois do git reset do workflow, sobre a versão mais nova do site."""
    try:
        novas = json.load(open(caminho, encoding="utf-8"))
    except (OSError, ValueError):
        novas = []
    camp = A.ler_json(A.CAMP, [])
    urls = {c.get("url", "").split("?")[0].rstrip("/") for c in camp}
    ids = {c.get("id") for c in camp}
    chaves = {(A.chave(c.get("brand", "")), A.chave(c.get("title", ""))) for c in camp}
    marca_dia = {(A.chave(c.get("brand", "")), c.get("date")) for c in camp}
    import midia  # noqa: PLC0415  (fica ao lado deste arquivo)
    for c in novas:
        midia.completar(c)
    mexeu = False
    entraram = []
    for c in novas:
        u = c["url"].split("?")[0].rstrip("/")
        k = (A.chave(c["brand"]), A.chave(c["title"]))
        if u in urls or k in chaves or (k[0], c["date"]) in marca_dia:
            continue
        # já publicada com outro título (ex.: "Mama Bear" do post da Contagious x legenda do Instagram)
        if len(k[1]) >= 5 and any(k[0] == m and (k[1] in t or t in k[1]) for m, t in chaves if len(t) >= 5):
            continue
        while c["id"] in ids:
            c["id"] += "-2"
        camp.append(c)
        entraram.append(c)
        urls.add(u)
        ids.add(c["id"])
        chaves.add(k)
        marca_dia.add((k[0], c["date"]))
    if entraram or mexeu:
        camp.sort(key=lambda c: (c.get("date", ""), c.get("addedAt", "")), reverse=True)
        A.salvar_json(A.CAMP, camp)
        A.salvar_json(A.NOVIDADES, {"atualizado": AGORA.strftime("%Y-%m-%dT%H:%M:%SZ"), "total": len(camp),
                                    "ultimo": camp[0]["id"]})
    for c in entraram:
        log("  + publicada:", c["source"], "|", c["brand"], "|", c["title"][:90])
    log("Publicadas no site:", len(entraram))


def main():
    try:
        hist = json.load(open(SAIDA, encoding="utf-8"))
    except (OSError, ValueError):
        hist = {}
    estado = hist.setdefault("estado", {})
    estado["linkedin"] = hist.get("linkedin", {}) or estado.get("linkedin", {})
    todas = agencias(estado)
    rodada = {"quando": AGORA.strftime("%Y-%m-%dT%H:%M:%SZ"), "agencias_na_lista": len(todas),
              "apify": {}, "coresignal": {}}
    posts = ler_apify(todas, estado, rodada["apify"]) + ler_coresignal(todas, estado, rodada["coresignal"])
    camp = [c for c in (vira_campanha(p) for p in posts) if c]
    rodada["lidos"] = [{"fonte": p["fonte"], "tipo": p["tipo"], "agencia": (p["agencia"] or {}).get("nome", ""),
                        "data": p["data"][:10], "url": p["url"], "texto": p["texto"][:160]} for p in posts][:400]
    chaves = collections.defaultdict(set)
    for c in camp:
        chaves[c["fonte"]].add((A.chave(c["agencia"]), A.chave(c["marca"])))
        rodada[c["fonte"]].setdefault("campanhas_por_tipo", collections.Counter())[c["tipo"]] += 1
    for f in ("apify", "coresignal"):
        rodada[f]["campanhas"] = len(chaves[f])
        hs = []
        for c in camp:
            if c["fonte"] == f:
                try:
                    t = dt.datetime.fromisoformat(c["data"].replace("Z", "")).replace(tzinfo=dt.timezone.utc)
                    hs.append((AGORA - t).total_seconds() / 3600)
                except ValueError:
                    pass
        rodada[f]["atraso_mediano_h"] = round(sorted(hs)[len(hs) // 2], 1) if hs else None
    rodada["so_apify"] = len(chaves["apify"] - chaves["coresignal"])
    rodada["so_coresignal"] = len(chaves["coresignal"] - chaves["apify"])
    rodada["nas_duas"] = len(chaves["apify"] & chaves["coresignal"])
    paginas_ok = sum(1 for v in estado.get("slug", {}).values() if v == "ok")
    rodada["paginas_linkedin_achadas"] = paginas_ok
    hist.setdefault("rodadas", []).append(rodada)
    hist["rodadas"] = hist["rodadas"][-60:]
    for r in hist["rodadas"][:-3]:
        r.pop("lidos", None)  # a amostra completa fica só nas últimas rodadas
    vistos = {(c["fonte"], c["url"]) for c in hist.get("candidatas", [])}
    novas = [c for c in camp if (c["fonte"], c["url"]) not in vistos]
    hist["candidatas"] = (hist.get("candidatas", []) + [{k: v for k, v in c.items() if k != "campanha"}
                                                        for c in novas])[-500:]
    # a mesma campanha achada pelas duas fontes entra uma vez só
    unicas = {}
    for c in novas:
        unicas.setdefault((A.chave(c["agencia"]), A.chave(c["marca"])), c["campanha"])
    json.dump(list(unicas.values()), open(os.environ.get("LINKEDIN_NOVAS", "/tmp/linkedin_novas.json"), "w",
                                          encoding="utf-8"), ensure_ascii=False)
    hist.setdefault("linkedin", {})
    json.dump(hist, open(SAIDA, "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=dict)
    resumo = {k: v for k, v in rodada.items() if k not in ("apify", "coresignal")}
    log(json.dumps(resumo, ensure_ascii=False))
    for f in ("apify", "coresignal"):
        log(f, json.dumps({k: v for k, v in rodada[f].items() if not k.startswith("amostra")}, ensure_ascii=False, default=dict))


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--publicar":
        publicar(sys.argv[2])
    else:
        main()
