"""Mede o layout do embed do Instagram (cabeçalho, mídia, rodapé) num navegador de verdade (diagnóstico)."""
import json
import sys
from playwright.sync_api import sync_playwright

urls = json.loads(sys.argv[1])
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 400, "height": 1200})
    for u in urls:
        m = u.rstrip("/").split("/")
        emb = "https://www.instagram.com/%s/%s/embed/?cr=1&v=14&wp=400" % (m[-2], m[-1])
        try:
            pg.goto(emb, wait_until="networkidle", timeout=45000)
            pg.wait_for_timeout(2500)
            info = pg.evaluate("""() => {
              const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.height), Math.round(b.width)]; };
              return { total: document.documentElement.scrollHeight, header: r('.Header') || r('header'),
                       media: r('.EmbeddedMedia') || r('.EmbeddedMediaImage') || r('video') || r('img.EmbeddedMediaImage'),
                       video: r('video'), img: r('.EmbeddedMediaImage'), footer: r('.Footer') || r('.SocialProof'),
                       classes: [...new Set([...document.querySelectorAll('body *')].slice(0,80).map(e => e.className).filter(c => typeof c === 'string' && c))].slice(0,30) };
            }""")
            print(emb, json.dumps(info))
        except Exception as e:  # noqa: BLE001
            print(emb, "ERRO", e)
    b.close()
