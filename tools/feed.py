"""Gera o que o site carrega a partir de campaigns.json.

- feed.json: só os campos que o site usa, sem os vazios e sem espaços.
- historia/<id>.json: os parágrafos da matéria das campanhas sem filme, que o site
  busca só quando o post aparece (assim o feed.json continua leve).
Uso: python tools/feed.py campaigns.json _site
"""
import json
import os
import re
import sys

# rodapé que os sites WordPress põem no feed ("O post … apareceu primeiro em …")
LIXO = re.compile(r"apareceu primeiro em|appeared first on|se publicó primero en|Gostou do conteúdo\?|Leia também|Read more:", re.I)

CAMPOS = ("id", "date", "brand", "title", "agency", "source", "url", "region", "cc", "summary",
          "frase", "yt", "video", "image", "addedAt", "idea", "credits", "creatives", "production", "director")


def tem_filme(x):
    return bool(x.get("yt")) or bool(x.get("video"))


def enxuta(x):
    out = {k: x[k] for k in CAMPOS if x.get(k) not in (None, "", [], {})}
    if "image" not in out and isinstance(x.get("images"), list) and x["images"]:
        out["image"] = x["images"][0]
    return out


def main(src, dst):
    with open(src, encoding="utf-8") as f:
        dados = [x for x in json.load(f) if isinstance(x, dict) and not x.get("hidden")]
    pasta = os.path.join(dst, "historia")
    os.makedirs(pasta, exist_ok=True)
    feed = []
    for x in dados:
        item = enxuta(x)
        story = [s for s in (x.get("story") or []) if isinstance(s, str) and s.strip() and not LIXO.search(s)]
        cid = str(x.get("id") or "")
        if story and not tem_filme(x) and cid and "/" not in cid and not cid.startswith("."):
            with open(os.path.join(pasta, cid + ".json"), "w", encoding="utf-8") as f:
                json.dump({"story": story[:6]}, f, ensure_ascii=False, separators=(",", ":"))
            item["st"] = 1
        feed.append(item)
    with open(os.path.join(dst, "feed.json"), "w", encoding="utf-8") as f:
        json.dump(feed, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
