"""Mede, num navegador de verdade, onde fica o vídeo/foto dentro do embed do Instagram de cada campanha.

O embed (400 px de largura) mostra um cabeçalho (~54 px), a mídia (altura conforme o formato do post:
quadrada, 4:5, deitada…) e um rodapé. O site recorta só a mídia, e para isso precisa saber onde ela
começa e qual a altura. Guarda em cada campanha "igm": [topo, altura].

Uso no workflow:  python robo/ig_medidas.py            → mede e grava em /tmp/ig_medidas.json
                  python robo/ig_medidas.py --aplicar  → aplica em campaigns.json (depois do git reset)
"""
import json
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import atualizar as A  # noqa: E402

ACHADOS = "/tmp/ig_medidas.json"
POR_RODADA = int(os.environ.get("IG_POR_RODADA", "150"))
IG = re.compile(r"instagram\.com/(p|reel|reels|tv)/([\w-]+)")

MEDIR = """() => {
  const q = s => document.querySelector(s);
  const el = q('.EmbeddedMedia') || q('.EmbeddedMediaImage') || q('video') || q('.EmbedSidecar');
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return [Math.round(b.top), Math.round(b.height), Math.round(b.width)];
}"""


def embed(url):
    m = IG.search(url or "")
    if not m:
        return ""
    tipo = "reel" if m.group(1).startswith("reel") else m.group(1)
    return "https://www.instagram.com/%s/%s/embed/?cr=1&v=14&wp=400" % (tipo, m.group(2))


def main():
    from playwright.sync_api import sync_playwright  # noqa: PLC0415
    camp = A.ler_json(A.CAMP, [])
    alvo = [c for c in camp if embed(c.get("video")) and not c.get("yt") and "igm" not in c and not c.get("hidden")][:POR_RODADA]
    print("Instagram sem medida:", len(alvo), flush=True)
    achados = {}
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 400, "height": 1400})
        for c in alvo:
            try:
                pg.goto(embed(c["video"]), wait_until="networkidle", timeout=30000)
                pg.wait_for_timeout(1200)
                r = pg.evaluate(MEDIR)
            except Exception as e:  # noqa: BLE001
                print("  falhou:", c["id"], e, flush=True)
                continue
            if r and r[1] >= 120 and r[2] >= 300:
                achados[c["id"]] = [r[0], r[1]]
                print("  ", c["id"], r, flush=True)
            else:
                achados[c["id"]] = []  # post apagado ou sem mídia: não tenta de novo
        b.close()
    json.dump(achados, open(ACHADOS, "w"), ensure_ascii=False)
    print("Medidos:", sum(1 for v in achados.values() if v), "de", len(achados), flush=True)


def aplicar():
    try:
        achados = json.load(open(ACHADOS))
    except (OSError, ValueError):
        return
    camp = A.ler_json(A.CAMP, [])
    n = 0
    for c in camp:
        if c.get("id") in achados and "igm" not in c:
            c["igm"] = achados[c["id"]]
            n += 1
    if n:
        A.salvar_json(A.CAMP, camp)
    print("Aplicadas:", n)


if __name__ == "__main__":
    aplicar() if "--aplicar" in sys.argv else main()
