"""Teste visual da caixa da campanha sobre a timeline (roda no Actions com o site servido em localhost)."""
import sys
from playwright.sync_api import sync_playwright

base, cid = sys.argv[1], sys.argv[2]
with sync_playwright() as p:
    b = p.chromium.launch()
    for nome, vp, mob in (("pc", {"width": 1366, "height": 900}, False), ("cel", {"width": 390, "height": 844}, True)):
        ctx = b.new_context(viewport=vp, is_mobile=mob, has_touch=mob, device_scale_factor=2 if mob else 1, locale="pt-BR")
        pg = ctx.new_page()
        pg.on("console", lambda m: print("console:", m.text[:200]) if m.type == "error" and "Permissions" not in m.text else None)
        pg.on("pageerror", lambda e: print("pageerror:", e))
        pg.goto(base + "/c/" + cid + "/", wait_until="load", timeout=60000)
        pg.wait_for_timeout(3000)
        pg.screenshot(path="prints/1-chegada-%s.png" % nome)
        pg.click(".detalhe-fechar")
        pg.wait_for_timeout(2500)
        print(nome, "depois de fechar:", pg.url, "| caixa aberta?", pg.evaluate("document.getElementById('detalhe').classList.contains('aberto')"))
        pg.screenshot(path="prints/2-feed-%s.png" % nome)
        pg.click("article.post .who-link >> nth=1")
        pg.wait_for_timeout(2500)
        print(nome, "clicou no post:", pg.url, "| caixa aberta?", pg.evaluate("document.getElementById('detalhe').classList.contains('aberto')"))
        pg.screenshot(path="prints/3-caixa-%s.png" % nome)
        links = pg.locator("#detalhe-conteudo a[href^='/p/'], #detalhe-conteudo a[href^='/a/']")
        if links.count():
            links.first.click()
            pg.wait_for_timeout(2000)
            print(nome, "clicou num crédito:", pg.url)
            pg.screenshot(path="prints/4-credito-%s.png" % nome)
        pg.go_back()
        pg.wait_for_timeout(1500)
        print(nome, "voltar do navegador:", pg.url, "| caixa aberta?", pg.evaluate("document.getElementById('detalhe').classList.contains('aberto')"))
        ctx.close()
    b.close()
