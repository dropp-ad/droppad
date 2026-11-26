"""Tira prints de páginas num celular e num computador (diagnóstico visual, roda no Actions)."""
import json
import sys
from playwright.sync_api import sync_playwright

urls = json.loads(sys.argv[1])
with sync_playwright() as p:
    b = p.chromium.launch()
    for nome, vp, mob in (("cel", {"width": 390, "height": 844}, True), ("pc", {"width": 1366, "height": 900}, False)):
        ctx = b.new_context(viewport=vp, is_mobile=mob, has_touch=mob, device_scale_factor=2 if mob else 1, locale="pt-BR")
        pg = ctx.new_page()
        for i, u in enumerate(urls):
            try:
                r = pg.goto(u, wait_until="networkidle", timeout=45000)
                print("status", r.status if r else None, u)
                pg.wait_for_timeout(5000)
                pg.screenshot(path="prints/%d-%s.png" % (i, nome))
                print("ok", nome, u)
            except Exception as e:  # noqa: BLE001
                print("erro", nome, u, e)
        ctx.close()
    b.close()
