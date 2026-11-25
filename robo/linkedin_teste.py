"""Teste lado a lado de duas fontes pagas de posts do LinkedIn (Apify/HarvestAPI e Coresignal).

Fase de teste: NÃO publica nada no site. A cada rodada lê os posts recentes das páginas das
agências nas duas fontes, passa pelos mesmos filtros do robô (só campanha, nada institucional)
e grava o placar em robo/linkedin_teste.json: quantos posts cada fonte trouxe, quantos viraram
campanha, quantas campanhas só uma delas achou, com que atraso, e quanto custou.

Cada fonte só roda se o token dela existir (secrets APIFY_TOKEN e CORESIGNAL_TOKEN).
Tetos de gasto por rodada: APIFY_MAX_POSTS (padrão 120 posts ≈ US$ 0,24) e
CORESIGNAL_MAX_COLETAS (padrão 40 créditos).
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
ONTEM = (AGORA - dt.timedelta(days=2)).date().isoformat()  # janela de 2 dias
N_AGENCIAS = int(os.environ.get("LI_AGENCIAS", "40"))
APIFY_POR_AGENCIA = int(os.environ.get("APIFY_POR_AGENCIA", "3"))
APIFY_MAX_POSTS = int(os.environ.get("APIFY_MAX_POSTS", "120"))
CS_MAX_COLETAS = int(os.environ.get("CORESIGNAL_MAX_COLETAS", "40"))


def log(*a):
    print(*a, flush=True)


def pedir(url, dados=None, cab=None, metodo=None, tempo=300):
    corpo = json.dumps(dados).encode() if dados is not None else None
    req = urllib.request.Request(url, data=corpo, method=metodo or ("POST" if corpo else "GET"))
    req.add_header("Accept", "application/json")
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


def agencias():
    """As agências que mais aparecem no site, com o endereço provável da página no LinkedIn
    (o nome do site da agência: almapbbdo.com.br → linkedin.com/company/almapbbdo)."""
    fontes = json.load(open(os.path.join(AQUI, "fontes.json"), encoding="utf-8"))
    camp = json.load(open(os.path.join(AQUI, "..", "campaigns.json"), encoding="utf-8"))
    freq = collections.Counter(c.get("agency") for c in camp if c.get("agency"))
    extra = {}
    try:
        extra = json.load(open(SAIDA, encoding="utf-8")).get("linkedin", {})  # correções manuais: nome → slug
    except (OSError, ValueError):
        pass
    out = []
    for a in sorted(fontes.get("agencias", []), key=lambda a: -freq.get(a["nome"], 0)):
        slug = extra.get(a["nome"])
        if not slug and a.get("site"):
            host = urllib.parse.urlparse(a["site"]).netloc.lower().replace("www.", "")
            slug = host.split(".")[0]
        if slug:
            out.append({"nome": a["nome"], "slug": slug, "regiao": a.get("regiao", "Global"), "cc": a.get("cc", "")})
        if len(out) >= N_AGENCIAS:
            break
    return out


def g(d, *caminho):
    for k in caminho:
        if isinstance(d, dict):
            d = d.get(k)
        elif isinstance(d, list) and isinstance(k, int) and len(d) > k:
            d = d[k]
        else:
            return None
    return d


# ---------------------------------------------------------------- Apify (HarvestAPI)
def ler_apify(ags, placar):
    tok = os.environ.get("APIFY_TOKEN", "").strip()
    if not tok:
        placar["status"] = "sem token"
        return []
    urls = ["https://www.linkedin.com/company/%s/" % a["slug"] for a in ags]
    por_url = {u.rstrip("/").rsplit("/", 1)[-1].lower(): a for u, a in zip(urls, ags)}
    entrada = {"targetUrls": urls, "maxPosts": APIFY_POR_AGENCIA}
    log("apify: %d páginas, até %d posts cada" % (len(urls), APIFY_POR_AGENCIA))
    st, itens = pedir("https://api.apify.com/v2/acts/harvestapi~linkedin-company-posts/run-sync-get-dataset-items?token="
                      + urllib.parse.quote(tok) + "&maxItems=%d" % APIFY_MAX_POSTS, entrada, tempo=290)
    placar["http"] = st
    if st >= 300 or not isinstance(itens, list):
        placar["status"] = "erro %s" % st
        placar["erro"] = str(itens)[:300]
        return []
    placar["status"] = "ok"
    placar["posts"] = len(itens)
    placar["custo_usd"] = round(len(itens) * 0.002, 3)
    placar["amostra"] = itens[:2]
    out = []
    for it in itens:
        if not isinstance(it, dict):
            continue
        autor = g(it, "author") or {}
        slug = str(autor.get("universalName") or g(it, "query", "companyUniversalName") or "").lower()
        ag = por_url.get(slug)
        if not ag:  # tenta casar pela URL de entrada ou pelo nome
            alvo = str(g(it, "query", "targetUrl") or it.get("inputUrl") or "").rstrip("/").rsplit("/", 1)[-1].lower()
            ag = por_url.get(alvo) or next((a for a in ags if A.chave(a["nome"]) == A.chave(str(autor.get("name", "")))), None)
        data = str(g(it, "postedAt", "date") or it.get("postedAt") or "")[:19]
        video = g(it, "postVideo", "videoUrl") or g(it, "postVideo", "url") or ""
        imgs = it.get("postImages") or []
        img = (imgs[0].get("url") if imgs and isinstance(imgs[0], dict) else (imgs[0] if imgs else "")) or ""
        out.append({"fonte": "apify", "agencia": ag, "texto": it.get("content") or it.get("text") or "",
                    "url": it.get("linkedinUrl") or it.get("url") or it.get("postUrl") or "",
                    "data": data, "video": video, "imagem": img})
    return out


# ---------------------------------------------------------------- Coresignal
def ler_coresignal(ags, placar):
    tok = os.environ.get("CORESIGNAL_TOKEN", "").strip()
    if not tok:
        placar["status"] = "sem token"
        return []
    cab = {"apikey": tok}
    base = "https://api.coresignal.com/cdapi/v2/company_post"
    ids, buscas = [], []
    # a busca é grátis; por agência, pelo nome da empresa e data de publicação
    for a in ags:
        filtro = {"date_published_gte": ONTEM, "company_name": a["nome"]}
        st, r = pedir(base + "/search/filter", filtro, cab, tempo=60)
        buscas.append({"agencia": a["nome"], "http": st, "n": len(r) if isinstance(r, list) else None,
                       "erro": None if st < 300 else str(r)[:200]})
        if st == 422 or st == 400:  # filtro não aceito: guarda a resposta para eu ajustar e para de tentar
            break
        if st < 300 and isinstance(r, list):
            ids += [(x, a) for x in r[:5]]
    placar["buscas"] = buscas[:60]
    placar["ids"] = len(ids)
    out = []
    coletas = 0
    for pid, a in ids:
        if coletas >= CS_MAX_COLETAS:
            break
        st, it = pedir(base + "/collect/%s" % urllib.parse.quote(str(pid)), cab=cab, tempo=60)
        coletas += 1
        if st >= 300 or not isinstance(it, dict):
            continue
        if len(placar.setdefault("amostra", [])) < 2:
            placar["amostra"].append(it)
        texto = it.get("text") or it.get("content") or it.get("description") or ""
        data = str(it.get("date_published") or it.get("published_at") or it.get("created_at") or "")[:19]
        url = it.get("url") or it.get("post_url") or it.get("share_url") or ""
        video = g(it, "article_video", "url") or ""
        img = (it.get("images") or [""])[0] if isinstance(it.get("images"), list) else ""
        out.append({"fonte": "coresignal", "agencia": a, "texto": texto, "url": url, "data": data,
                    "video": video, "imagem": img or g(it, "article_video", "image_url") or ""})
    placar["status"] = "ok" if buscas and buscas[0]["http"] < 300 else "erro na busca"
    placar["creditos"] = coletas
    placar["posts"] = len(out)
    return out


# ---------------------------------------------------------------- filtro (o mesmo do Instagram)
def vira_campanha(p):
    a = p["agencia"]
    if not a or not p["texto"] or not p["data"]:
        return None
    if p["data"][:10] < ONTEM:
        return None
    falso = {"caption": p["texto"], "permalink": p["url"] or "https://www.linkedin.com/",
             "timestamp": p["data"] + ("" if p["data"].endswith("Z") else "Z"),
             "media_type": "VIDEO" if p["video"] else "IMAGE"}
    conta = {"usuario": a["slug"], "nome": a["nome"], "regiao": a["regiao"], "cc": a["cc"], "agencia": a["nome"]}
    c = A.post_para_campanha(falso, conta, ONTEM)
    if not c:
        return None
    return {"marca": c["brand"], "titulo": c["title"], "agencia": a["nome"], "data": p["data"], "url": p["url"],
            "video": bool(p["video"]), "fonte": p["fonte"]}


def main():
    try:
        hist = json.load(open(SAIDA, encoding="utf-8"))
    except (OSError, ValueError):
        hist = {}
    ags = agencias()
    rodada = {"quando": AGORA.strftime("%Y-%m-%dT%H:%M:%SZ"), "agencias": len(ags), "apify": {}, "coresignal": {}}
    posts = ler_apify(ags, rodada["apify"]) + ler_coresignal(ags, rodada["coresignal"])
    camp = [c for c in (vira_campanha(p) for p in posts) if c]
    por_fonte = collections.defaultdict(set)
    for c in camp:
        por_fonte[c["fonte"]].add((A.chave(c["agencia"]), A.chave(c["marca"])))
    for f in ("apify", "coresignal"):
        rodada[f]["campanhas"] = len(por_fonte[f])
    rodada["so_apify"] = len(por_fonte["apify"] - por_fonte["coresignal"])
    rodada["so_coresignal"] = len(por_fonte["coresignal"] - por_fonte["apify"])
    rodada["nas_duas"] = len(por_fonte["apify"] & por_fonte["coresignal"])
    # atraso: horas entre a publicação no LinkedIn e esta rodada (mediana por fonte)
    for f in ("apify", "coresignal"):
        hs = []
        for c in camp:
            if c["fonte"] != f:
                continue
            try:
                t = dt.datetime.fromisoformat(c["data"].replace("Z", "")).replace(tzinfo=dt.timezone.utc)
                hs.append((AGORA - t).total_seconds() / 3600)
            except ValueError:
                pass
        rodada[f]["atraso_mediano_h"] = round(sorted(hs)[len(hs) // 2], 1) if hs else None
    hist.setdefault("rodadas", []).append(rodada)
    hist["rodadas"] = hist["rodadas"][-60:]
    vistos = {(c["fonte"], c["url"]) for c in hist.get("candidatas", [])}
    hist["candidatas"] = (hist.get("candidatas", []) + [c for c in camp if (c["fonte"], c["url"]) not in vistos])[-300:]
    hist.setdefault("linkedin", {})
    json.dump(hist, open(SAIDA, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    log(json.dumps({k: v for k, v in rodada.items() if k not in ("apify", "coresignal")}, ensure_ascii=False))
    for f in ("apify", "coresignal"):
        log(f, json.dumps({k: v for k, v in rodada[f].items() if k not in ("amostra", "buscas")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
