#!/usr/bin/env python3
"""Mostra o que o robô enxerga numa matéria: iframes, vídeos, imagens e o que ele extrai."""
import re
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import atualizar as A  # noqa: E402

for url in sys.argv[1:]:
    print("=" * 100)
    print(url)
    try:
        pag = A.baixar(url, timeout=25)
    except Exception as e:  # noqa: BLE001
        print("ERRO", e)
        continue
    print("tamanho", len(pag))
    for pad in [r"<iframe\b[^>]*>", r"<video\b[^>]*>", r"<source\b[^>]*>", r"<lite-youtube[^>]*>",
                r"[^\s\"'<>]*(?:youtube|youtu\.be|vimeo|instagram\.com/(?:p|reel)|tiktok|dailymotion|jwplayer|brightcove|\.mp4)[^\s\"'<>]*",
                r"data-(?:video|src|lazy-src|embed|id)[\w-]*=[\"'][^\"']+[\"']"]:
        vistos = []
        for m in re.finditer(pad, pag, re.I):
            t = m.group(0)[:300]
            if t not in vistos:
                vistos.append(t)
        print("--", pad[:40], len(vistos))
        for t in vistos[:25]:
            print("   ", t)
    imgs = re.findall(r"<img\b[^>]*>", pag, re.I)
    print("-- img tags", len(imgs))
    for t in imgs[:40]:
        print("   ", t[:260])
    links = []
    for m in re.finditer(r'href=["\']([^"\'#]+)["\']', pag):
        u = m.group(1)
        if re.search(r"/(work|projects?|case|news|cases|trabalhos|portfolio)/", u) and u not in links:
            links.append(u)
    print("-- links de trabalhos", len(links))
    for u in links[:60]:
        print("   ", u)
    for m in re.finditer(r'"(_createdAt|_updatedAt|publishedAt|releaseDate|launchDate|date|year)"\s*:\s*"?([^",}]{2,40})', pag):
        print("   DATA", m.group(1), m.group(2))
    for pad in [r'<meta[^>]+property="og:[^"]+"[^>]*>', r'<meta[^>]+name="(?:description|date|article:published_time)"[^>]*>', r'"datePublished"\s*:\s*"[^"]+"', r"<title>[^<]+</title>"]:
        for m in re.finditer(pad, pag, re.I):
            print("   META", m.group(0)[:250])
    miolo = A.corpo_da_materia(pag)
    print("-- miolo tamanho", len(miolo), "é a página inteira?", miolo is pag)
    print("-- filmes_de(miolo)", A.filmes_de(miolo))
    print("-- filmes_de(pagina)", A.filmes_de(pag))
    print("-- fotos_de", A.fotos_de(pag, url))
