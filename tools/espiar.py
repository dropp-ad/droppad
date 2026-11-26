"""Diagnóstico: baixa páginas e mostra links, feeds, iframes de vídeo e trechos (roda no Actions)."""
import re
import sys
import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
for u in sys.argv[1:]:
    print("=" * 90)
    print(u)
    try:
        req = urllib.request.Request(u, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=25) as r:
            pg = r.read(4_000_000).decode("utf-8", "replace")
            print("status", r.status, "tamanho", len(pg))
    except Exception as e:  # noqa: BLE001
        print("ERRO", e)
        continue
    print("title:", (re.search(r"<title>(.*?)</title>", pg, re.S) or [None, ""])[1][:150])
    for m in re.findall(r'<link[^>]+(?:rss|atom)[^>]*>', pg, re.I)[:5]:
        print("feed:", m[:200])
    links = []
    for m in re.findall(r'href="(https?://(?:www\.)?clubedecriacao\.com\.br/[^"#?]+)"', pg):
        if m not in links:
            links.append(m)
    print("links internos:", len(links))
    for l in [x for x in links if "/acervo/" in x or "/ultimas/" in x][:12]:
        print("  ", l)
    for m in re.findall(r"<iframe[^>]+>", pg, re.I)[:10]:
        print("iframe:", m[:250])
    for m in sorted(set(re.findall(r"(?:youtube\.com/embed/|youtu\.be/|youtube\.com/watch\?v=|player\.vimeo\.com/video/|vimeo\.com/)[\w-]+", pg)))[:10]:
        print("video:", m)
    m = re.search(r"<(article|main)\b.*?</\1>", pg, re.S | re.I)
    if m:
        txt = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " | ", m.group(0)))
        print("ARTIGO:", txt[:2500])
    for pad in [r"ficha t[ée]cnica", r"[Aa]nunciante", r"Dire[çc][ãa]o de cria", r"<item>"]:
        i = pg.find(re.search(pad, pg).group(0)) if re.search(pad, pg) else -1
        if i >= 0:
            print("--", pad, ":", re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " | ", pg[i:i + 900]))[:700])
