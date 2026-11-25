"""Gera feed.json: a versão enxuta de campaigns.json que o site carrega.

Mantém só os campos que o site usa, tira os vazios e salva sem espaços.
Uso: python tools/feed.py campaigns.json _site/feed.json
"""
import json
import sys

CAMPOS = ("id", "date", "brand", "title", "agency", "source", "url", "region", "cc", "summary",
          "frase", "yt", "video", "image", "addedAt", "idea", "credits", "creatives", "production", "director")


def enxuta(x):
    out = {k: x[k] for k in CAMPOS if x.get(k) not in (None, "", [], {})}
    if "image" not in out and isinstance(x.get("images"), list) and x["images"]:
        out["image"] = x["images"][0]
    return out


def main(src, dst):
    with open(src, encoding="utf-8") as f:
        dados = json.load(f)
    feed = [enxuta(x) for x in dados if isinstance(x, dict)]
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(feed, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
