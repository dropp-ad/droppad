"""Uma página por campanha, para o Google e para a prévia do link (WhatsApp, LinkedIn, X).

Gera, a partir de campaigns.json:
  c/<id>/index.html       versão em português
  en/c/<id>/index.html    versão em inglês  (só quando o robô de traduções já traduziu)
  es/c/<id>/index.html    versão em espanhol (idem)
  sitemap.xml + sitemaps/*.xml (com as três línguas ligadas por hreflang) e robots.txt

Cada página tem título e descrição pensados para busca ("Heinz new campaign", "campanha Bob's Black
Friday", "nueva campaña de Coca-Cola"), imagem e vídeo para a prévia do link, dados estruturados
(VideoObject / CreativeWork) e links para outras campanhas da mesma marca e da mesma agência.

Uso: python tools/paginas.py campaigns.json _site
"""
import datetime as dt
import html
import json
import os
import re
import sys
import urllib.parse

SITE = "https://dropp.ad"
LINGUAS = ("pt", "en", "es")
PREFIXO = {"pt": "", "en": "/en", "es": "/es"}
HTML_LANG = {"pt": "pt-BR", "en": "en", "es": "es"}
OG_LOCALE = {"pt": "pt_BR", "en": "en_US", "es": "es_ES"}
MESES = {
    "pt": ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"],
    "en": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    "es": ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
}
T = {
    "titulo": {"pt": "Campanha {b}: {t}", "en": "{b} new campaign: {t}", "es": "Nueva campaña de {b}: {t}"},
    "titulo_so_marca": {"pt": "Nova campanha de {b}", "en": "{b} new campaign", "es": "Nueva campaña de {b}"},
    "por": {"pt": "por {a}", "en": "by {a}", "es": "por {a}"},
    "estreou": {"pt": "Estreou em {d}", "en": "Launched {d}", "es": "Se estrenó el {d}"},
    "agencia": {"pt": "Agência", "en": "Agency", "es": "Agencia"},
    "marca": {"pt": "Marca", "en": "Brand", "es": "Marca"},
    "origem": {"pt": "Origem", "en": "Origin", "es": "Origen"},
    "fonte": {"pt": "Fonte", "en": "Source", "es": "Fuente"},
    "ler": {"pt": "Ler a matéria completa em {s} ↗", "en": "Read the full story on {s} ↗", "es": "Leer la nota completa en {s} ↗"},
    "ver_feed": {"pt": "Ver no droppad, com as campanhas do dia", "en": "Watch on droppad with today's campaigns",
                 "es": "Ver en droppad con las campañas del día"},
    "mais_marca": {"pt": "Mais campanhas de {b}", "en": "More {b} campaigns", "es": "Más campañas de {b}"},
    "mais_agencia": {"pt": "Mais campanhas de {a}", "en": "More work by {a}", "es": "Más campañas de {a}"},
    "mesmo_dia": {"pt": "Estrearam no mesmo dia", "en": "Also launched that day", "es": "Se estrenaron el mismo día"},
    "lema": {"pt": "as campanhas que estrearam hoje no mundo", "en": "the campaigns that launched today around the world",
             "es": "las campañas que se estrenaron hoy en el mundo"},
    "desc_fim": {"pt": "Campanha de {b}{a}, estreou em {d}.", "en": "{b} campaign{a}, launched {d}.",
                 "es": "Campaña de {b}{a}, se estrenó el {d}."},
    "desc_ag": {"pt": " criada por {a}", "en": " by {a}", "es": " creada por {a}"},
    "chave": {"pt": "campanha {b}, nova campanha {b}, comercial {b}, {a}, publicidade, propaganda",
              "en": "{b} campaign, {b} new ad, {b} commercial, {a}, advertising",
              "es": "campaña {b}, nuevo anuncio {b}, comercial {b}, {a}, publicidad"},
}
REGIOES = {  # nomes que vêm em campaigns.json (em português) → inglês / espanhol
    "Brasil": ("Brazil", "Brasil"), "EUA": ("USA", "EE. UU."), "Reino Unido": ("UK", "Reino Unido"),
    "Europa": ("Europe", "Europa"), "América Latina": ("Latin America", "América Latina"), "Global": ("Global", "Global"),
    "Ásia-Pacífico": ("Asia-Pacific", "Asia-Pacífico"), "Oriente Médio e África": ("Middle East & Africa", "Oriente Medio y África"),
    "EUA e Canadá": ("US & Canada", "EE. UU. y Canadá"),
}
LIXO = re.compile(r"apareceu primeiro em|appeared first on|se publicó primero en|Gostou do conteúdo\?|Leia também|Read more:", re.I)

CSS = """*{box-sizing:border-box}body{margin:0;background:#000;color:#eee;font:17px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:#fff}header{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid #222}
header a{text-decoration:none;font-weight:800;letter-spacing:-.02em;font-size:20px}header span{color:#888;font-size:13px}
main{max-width:860px;margin:0 auto;padding:24px 20px 60px}.kick{color:#f15a3a;font-weight:800;text-transform:uppercase;letter-spacing:.04em;font-size:13px;margin:0 0 8px}
h1{font-size:clamp(26px,4.4vw,40px);line-height:1.12;margin:0 0 10px;color:#fff}.by{color:#aaa;margin:0 0 20px}.by b{color:#fff}
.media{position:relative;width:100%;aspect-ratio:16/9;background:#111;margin:0 0 22px;overflow:hidden}.media iframe,.media img{position:absolute;inset:0;width:100%;height:100%;border:0;object-fit:cover}
.media.v{aspect-ratio:4/5;max-width:400px;margin-left:auto;margin-right:auto}
.cta{display:inline-block;margin:6px 0 26px;padding:12px 18px;background:#fff;color:#000;font-weight:800;text-decoration:none}
dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 18px;margin:22px 0;padding:16px 0;border-top:1px solid #222;border-bottom:1px solid #222}dt{color:#888}dd{margin:0}
h2{font-size:18px;margin:34px 0 10px;color:#fff}ul{list-style:none;padding:0;margin:0}li{padding:8px 0;border-bottom:1px solid #1a1a1a}li a{text-decoration:none}li small{color:#888;margin-left:6px}
footer{color:#666;font-size:13px;text-align:center;padding:30px 20px}"""


def esc(s):
    return html.escape(str(s or ""), quote=True)


def chave(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def data_por_extenso(d, lg):
    try:
        y, m, dd = int(d[:4]), int(d[5:7]), int(d[8:10])
    except (ValueError, TypeError):
        return d or ""
    if lg == "en":
        return "%s %d, %d" % (MESES["en"][m - 1], dd, y)
    return "%d de %s de %d" % (dd, MESES[lg][m - 1], y)


def corta(s, n):
    s = " ".join(str(s or "").split())
    return s if len(s) <= n else s[:n - 1].rsplit(" ", 1)[0].rstrip(",.;:—-") + "…"


def texto(c, campo, lg):
    if lg != "pt" and tem_traducao(c, lg):
        t = ((c.get("tr") or {}).get(lg) or {}).get(campo)
        if t:
            return t
    return c.get(campo) or ""


def tem_traducao(c, lg):
    return lg == "pt" or ((c.get("tr") or {}).get(lg) or {}).get("ok") == 2


def url_de(c, lg):
    return SITE + PREFIXO[lg] + "/c/" + urllib.parse.quote(c["id"]) + "/"


def filme(c):
    """(tipo, id/src, capa) do primeiro filme da campanha."""
    yt = c.get("yt") if isinstance(c.get("yt"), list) else []
    if yt:
        return "yt", yt[0], "https://i.ytimg.com/vi/%s/hqdefault.jpg" % yt[0]
    v = c.get("video") or ""
    m = re.search(r"vimeo\.com/(?:video/)?(\d+)", v)
    if m:
        return "vimeo", m.group(1), c.get("image") or ""
    m = re.search(r"instagram\.com/(p|reel|reels|tv)/([\w-]+)", v)
    if m:
        tipo = "reel" if m.group(1).startswith("reel") else m.group(1)
        return "ig", "https://www.instagram.com/%s/%s/embed/?cr=1&v=14&wp=400" % (tipo, m.group(2)), c.get("image") or ""
    m = re.search(r"tiktok\.com/@[^/]+/video/(\d+)", v)
    if m:
        return "tt", m.group(1), c.get("image") or ""
    return "", "", ""


def titulo_seo(c, lg):
    """Título para o Google: marca + a palavra que as pessoas buscam (campanha / new campaign / campaña)."""
    b, t, a = c.get("brand") or "", texto(c, "title", lg), c.get("agency") or ""
    if b and t and chave(b) in chave(t):
        # o título já fala da marca ("Bob's coloca as ofertas…"): só acrescenta a palavra de busca
        base = t + " · " + {"pt": "campanha {b}", "en": "{b} ad campaign", "es": "campaña de {b}"}[lg].format(b=b)
    elif b and t:
        base = T["titulo"][lg].format(b=b, t=t)
    else:
        base = T["titulo_so_marca"][lg].format(b=b) if b else t
    if a and chave(a) != chave(b) and chave(a) not in chave(base) and len(base) + len(a) <= 82:
        base += " · " + a
    return corta(base, 90) + " | droppad"


def descricao_seo(c, lg):
    s = texto(c, "summary", lg) or texto(c, "frase", lg) or texto(c, "title", lg)
    ag = T["desc_ag"][lg].format(a=c["agency"]) if c.get("agency") and chave(c["agency"]) != chave(c.get("brand")) else ""
    fim = T["desc_fim"][lg].format(b=c.get("brand") or "", a=ag, d=data_por_extenso(c.get("date"), lg))
    return corta(s, 158 - len(fim) - 1) + " " + fim if len(s) + len(fim) > 158 else (s + " " + fim).strip()


def regiao(c, lg):
    r = c.get("region") or ""
    if lg == "pt" or r not in REGIOES:
        return r
    return REGIOES[r][0 if lg == "en" else 1]


def bloco_midia(c):
    tipo, ref, _ = filme(c)
    nome = esc(c.get("brand") or "")
    if tipo == "yt":
        return ('<div class="media"><iframe src="https://www.youtube-nocookie.com/embed/%s?rel=0" title="%s" loading="lazy" '
                'allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>' % (esc(ref), nome))
    if tipo == "vimeo":
        return ('<div class="media"><iframe src="https://player.vimeo.com/video/%s" title="%s" loading="lazy" '
                'allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>' % (esc(ref), nome))
    if tipo == "ig":
        # só a mídia do post: o robô mede onde ela fica no embed ("igm" = [topo, altura] a 400 px de largura)
        m = c.get("igm") if isinstance(c.get("igm"), list) and len(c.get("igm")) == 2 else [54, 500]
        topo, alt = m[0] + 2, max(120, m[1] - 4)
        return ('<div class="media v" style="aspect-ratio:400/%d"><iframe src="%s" title="%s" loading="lazy" scrolling="no" '
                'style="top:-%dpx;height:1100px" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>'
                % (alt, esc(ref), nome, topo))
    if tipo == "tt":
        return ('<div class="media v" style="aspect-ratio:9/16"><iframe src="https://www.tiktok.com/player/v1/%s" title="%s" '
                'loading="lazy" allowfullscreen style="top:0;height:100%%"></iframe></div>' % (esc(ref), nome))
    if c.get("image"):
        return '<div class="media"><img src="%s" alt="%s" loading="eager"></div>' % (esc(c["image"]), esc(texto(c, "title", "pt")))
    return ""


def dados_estruturados(c, lg, titulo, desc, url, imagem):
    tipo, ref, capa = filme(c)
    obra = {
        "@context": "https://schema.org", "@type": "CreativeWork", "name": texto(c, "title", lg), "headline": titulo,
        "description": desc, "url": url, "inLanguage": HTML_LANG[lg], "datePublished": c.get("date"),
        "genre": "Advertising", "keywords": T["chave"][lg].format(b=c.get("brand") or "", a=c.get("agency") or ""),
        "publisher": {"@type": "Organization", "name": "droppad", "url": SITE},
    }
    if c.get("brand"):
        obra["about"] = {"@type": "Brand", "name": c["brand"]}
        obra["sponsor"] = {"@type": "Organization", "name": c["brand"]}
    if c.get("agency"):
        obra["creator"] = {"@type": "Organization", "name": c["agency"]}
    if imagem:
        obra["image"] = imagem
    if tipo in ("yt", "vimeo"):
        obra["video"] = {
            "@type": "VideoObject", "name": texto(c, "title", lg), "description": desc, "thumbnailUrl": capa or imagem,
            "uploadDate": c.get("date"),
            "embedUrl": ("https://www.youtube-nocookie.com/embed/" + ref) if tipo == "yt" else "https://player.vimeo.com/video/" + ref,
        }
        if tipo == "yt":
            obra["video"]["contentUrl"] = "https://www.youtube.com/watch?v=" + ref
    trilha = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "droppad", "item": SITE + PREFIXO[lg] + "/"},
        {"@type": "ListItem", "position": 2, "name": c.get("brand") or texto(c, "title", lg), "item": url}]}
    return json.dumps([obra, trilha], ensure_ascii=False).replace("</", "<\\/")


def lista(titulo, itens, lg):
    if not itens:
        return ""
    lis = "".join('<li><a href="%s">%s</a><small>%s</small></li>' % (
        esc(PREFIXO[lg] + "/c/" + urllib.parse.quote(x["id"]) + "/"),
        esc((x.get("brand") + " · " if x.get("brand") else "") + texto(x, "title", lg)), esc(data_por_extenso(x.get("date"), lg)))
        for x in itens)
    return "<h2>%s</h2><ul>%s</ul>" % (esc(titulo), lis)


def pagina(c, lg, relacionadas):
    url = url_de(c, lg)
    titulo, desc = titulo_seo(c, lg), descricao_seo(c, lg)
    tipo, ref, capa = filme(c)
    imagem = capa or c.get("image") or (SITE + "/compartilhar.png")
    langs = [x for x in LINGUAS if tem_traducao(c, x)]
    alternos = "".join('<link rel="alternate" hreflang="%s" href="%s">' % (HTML_LANG[x], esc(url_de(c, x))) for x in langs)
    alternos += '<link rel="alternate" hreflang="x-default" href="%s">' % esc(url_de(c, "en" if "en" in langs else "pt"))
    og_video = ""
    if tipo == "yt":
        og_video = ('<meta property="og:video" content="https://www.youtube.com/embed/%s"><meta property="og:video:type" content="text/html">'
                    '<meta property="og:video:width" content="1280"><meta property="og:video:height" content="720">' % esc(ref))
    story = [s for s in ((((c.get("tr") or {}).get(lg) or {}).get("story") if lg != "pt" else None) or c.get("story") or [])
             if isinstance(s, str) and s.strip() and not LIXO.search(s)][:6]
    resumo = texto(c, "summary", lg)
    corpo = "".join("<p>%s</p>" % esc(p) for p in ([resumo] if resumo else []) + [p for p in story if p != resumo])
    ficha = []
    if c.get("brand"):
        ficha.append((T["marca"][lg], c["brand"]))
    if c.get("agency"):
        ficha.append((T["agencia"][lg], c["agency"]))
    if c.get("region"):
        ficha.append((T["origem"][lg], regiao(c, lg)))
    if c.get("source"):
        ficha.append((T["fonte"][lg], c["source"]))
    dl = "<dl>%s</dl>" % "".join("<dt>%s</dt><dd>%s</dd>" % (esc(k), esc(v)) for k, v in ficha) if ficha else ""
    feed = SITE + PREFIXO[lg] + "/?c=" + urllib.parse.quote(c["id"])
    if lg != "pt":
        feed = SITE + "/?c=" + urllib.parse.quote(c["id"])
    ler = ('<p><a href="%s" rel="nofollow noopener" target="_blank">%s</a></p>' % (esc(c["url"]), esc(T["ler"][lg].format(s=c.get("source") or "")))
           if str(c.get("url") or "").startswith("http") else "")
    by = ""
    if c.get("agency"):
        by = '<p class="by"><b>%s</b> · %s · %s</p>' % (esc(c.get("brand") or ""), esc(T["por"][lg].format(a=c["agency"])),
                                                       esc(T["estreou"][lg].format(d=data_por_extenso(c.get("date"), lg))))
    else:
        by = '<p class="by"><b>%s</b> · %s</p>' % (esc(c.get("brand") or ""), esc(T["estreou"][lg].format(d=data_por_extenso(c.get("date"), lg))))
    rel = ""
    if relacionadas.get("marca"):
        rel += lista(T["mais_marca"][lg].format(b=c.get("brand")), relacionadas["marca"], lg)
    if relacionadas.get("agencia"):
        rel += lista(T["mais_agencia"][lg].format(a=c.get("agency")), relacionadas["agencia"], lg)
    if relacionadas.get("dia"):
        rel += lista(T["mesmo_dia"][lg], relacionadas["dia"], lg)
    return """<!DOCTYPE html>
<html lang="{hl}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{titulo}</title>
<meta name="description" content="{desc}">
<meta name="keywords" content="{kw}">
<link rel="canonical" href="{url}">
{alternos}
<meta name="robots" content="index, follow, max-image-preview:large, max-video-preview:-1">
<meta property="og:site_name" content="droppad">
<meta property="og:type" content="{ogtipo}">
<meta property="og:title" content="{ogtitulo}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{imagem}">
<meta property="og:locale" content="{oglocale}">
<meta property="article:published_time" content="{data}">
{og_video}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{ogtitulo}">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{imagem}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script type="application/ld+json">{ld}</script>
<link rel="stylesheet" href="/c.css">
</head>
<body>
<header><a href="{home}">droppad</a><span>{lema}</span></header>
<main>
<p class="kick">{estreou}</p>
<h1>{h1}</h1>
{by}
{midia}
<a class="cta" href="{feed}">{verfeed} →</a>
{corpo}
{dl}
{ler}
{rel}
</main>
<footer>droppad · <a href="{home}">dropp.ad</a></footer>
</body>
</html>
""".format(
        hl=HTML_LANG[lg], titulo=esc(titulo), desc=esc(desc), kw=esc(T["chave"][lg].format(b=c.get("brand") or "", a=c.get("agency") or "")),
        url=esc(url), alternos=alternos, ogtipo="video.other" if tipo else "article", ogtitulo=esc(titulo.replace(" | droppad", "")),
        imagem=esc(imagem), oglocale=OG_LOCALE[lg], data=esc(c.get("date") or ""), og_video=og_video,
        ld=dados_estruturados(c, lg, titulo, desc, url, imagem), home=esc(PREFIXO[lg] + "/" if lg != "pt" else "/"),
        lema=esc(T["lema"][lg]), estreou=esc(T["estreou"][lg].format(d=data_por_extenso(c.get("date"), lg))),
        h1=esc(texto(c, "title", lg)), by=by, midia=bloco_midia(c), feed=esc(feed), verfeed=esc(T["ver_feed"][lg]),
        corpo=corpo, dl=dl, ler=ler, rel=rel)


def id_ok(cid):
    return bool(cid) and re.fullmatch(r"[\w.\-]+", cid) is not None and not cid.startswith(".")


def main(src, dst):
    with open(src, encoding="utf-8") as f:
        camp = [x for x in json.load(f) if isinstance(x, dict) and not x.get("hidden") and id_ok(str(x.get("id") or ""))]
    por_marca, por_agencia, por_dia = {}, {}, {}
    for c in camp:
        por_marca.setdefault(chave(c.get("brand")), []).append(c)
        if c.get("agency"):
            por_agencia.setdefault(chave(c["agency"]), []).append(c)
        por_dia.setdefault(c.get("date"), []).append(c)
    with open(os.path.join(dst, "c.css"), "w", encoding="utf-8") as f:
        f.write(CSS)
    urls = {lg: [] for lg in LINGUAS}
    n = 0
    for c in camp:
        rel = {
            "marca": [x for x in por_marca.get(chave(c.get("brand")), []) if x is not c][:6] if chave(c.get("brand")) else [],
            "agencia": [x for x in por_agencia.get(chave(c.get("agency")), []) if x is not c and x not in por_marca.get(chave(c.get("brand")), [])][:6],
            "dia": [x for x in por_dia.get(c.get("date"), []) if x is not c][:8],
        }
        for lg in LINGUAS:
            if not tem_traducao(c, lg):
                continue
            pasta = os.path.join(dst, PREFIXO[lg].strip("/"), "c", c["id"])
            os.makedirs(pasta, exist_ok=True)
            with open(os.path.join(pasta, "index.html"), "w", encoding="utf-8") as f:
                f.write(pagina(c, lg, rel))
            urls[lg].append(c)
            n += 1
    # sitemaps: um arquivo por língua (até 45 mil endereços cada), com as versões ligadas por hreflang
    os.makedirs(os.path.join(dst, "sitemaps"), exist_ok=True)
    arquivos = []
    for lg in LINGUAS:
        for i in range(0, max(1, len(urls[lg])), 45000):
            parte = urls[lg][i:i + 45000]
            nome = "sitemaps/c-%s-%d.xml" % (lg, i // 45000 + 1)
            linhas = ['<?xml version="1.0" encoding="UTF-8"?>',
                      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">']
            for c in parte:
                alt = "".join('<xhtml:link rel="alternate" hreflang="%s" href="%s"/>' % (HTML_LANG[x], esc(url_de(c, x)))
                              for x in LINGUAS if tem_traducao(c, x))
                mod = (c.get("addedAt") or c.get("date") or "")[:10]
                linhas.append("<url><loc>%s</loc>%s%s</url>" % (esc(url_de(c, lg)), "<lastmod>%s</lastmod>" % mod if mod else "", alt))
            linhas.append("</urlset>")
            with open(os.path.join(dst, nome), "w", encoding="utf-8") as f:
                f.write("\n".join(linhas))
            arquivos.append(nome)
    hoje = dt.date.today().isoformat()
    with open(os.path.join(dst, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                + '<sitemap><loc>%s/sitemaps/home.xml</loc><lastmod>%s</lastmod></sitemap>\n' % (SITE, hoje)
                + "".join("<sitemap><loc>%s/%s</loc><lastmod>%s</lastmod></sitemap>\n" % (SITE, a, hoje) for a in arquivos)
                + "</sitemapindex>\n")
    with open(os.path.join(dst, "sitemaps", "home.xml"), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                '<url><loc>%s/</loc><lastmod>%s</lastmod><changefreq>hourly</changefreq></url></urlset>\n' % (SITE, hoje))
    with open(os.path.join(dst, "robots.txt"), "w", encoding="utf-8") as f:
        f.write("User-agent: *\nAllow: /\nDisallow: /painel.html\n\nSitemap: %s/sitemap.xml\n" % SITE)
    print("páginas de campanha:", n, {lg: len(v) for lg, v in urls.items()})


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
