"""Gera o que o site carrega a partir de campaigns.json.

- feed.json: só os campos que o site usa, sem os vazios e sem espaços.
- historia/<id>.json: os parágrafos da matéria das campanhas sem filme, que o site
  busca só quando o post aparece (assim o feed.json continua leve).
Uso: python tools/feed.py campaigns.json _site
"""
import datetime as dt
import json
import os
import re
import sys

# rodapé que os sites WordPress põem no feed ("O post … apareceu primeiro em …")
# texto do post que vem cortado ("…"): o site abre o resto pelos três pontinhos
CORTE = re.compile(r"(\.\.\.|…|\[…\]|\[\.\.\.\])\s*$")
LIXO = re.compile(r"apareceu primeiro em|appeared first on|se publicó primero en|Gostou do conteúdo\?|Leia também|Read more:", re.I)

CAMPOS = ("id", "date", "brand", "title", "agency", "source", "url", "region", "cc", "summary",
          "frase", "yt", "video", "image", "addedAt", "idea", "credits", "creatives", "production", "director")

CORTE_DIAS = 400  # o que fica no feed.json; o resto vai para antigo/


def tem_filme(x):
    return bool(x.get("yt")) or bool(x.get("video"))


def enxuta(x):
    out = {k: x[k] for k in CAMPOS if x.get(k) not in (None, "", [], {})}
    if "image" not in out and isinstance(x.get("images"), list) and x["images"]:
        out["image"] = x["images"][0]
    return out


def na_lingua(item, lg):
    out = {k: v for k, v in item.items() if k != "_tr"}
    t = (item.get("_tr") or {}).get(lg) if lg else None
    if isinstance(t, dict) and t.get("ok") == 2:  # só a tradução campo a campo (a primeira, em lote, saía embaralhada)
        out["tl"] = 1  # existe a página da campanha nessa língua (/en/c/… ou /es/c/…)
        for k in ("title", "summary", "frase"):
            if t.get(k) and out.get(k):
                out[k] = t[k]
    return out


def main(src, dst):
    with open(src, encoding="utf-8") as f:
        dados = [x for x in json.load(f) if isinstance(x, dict) and not x.get("hidden")]
    pasta = os.path.join(dst, "historia")
    os.makedirs(pasta, exist_ok=True)
    feed = []
    for x in dados:
        item = enxuta(x)
        if isinstance(x.get("tr"), dict):
            item["_tr"] = x["tr"]
        story = [s for s in (x.get("story") or []) if isinstance(s, str) and s.strip() and not LIXO.search(s)]
        cid = str(x.get("id") or "")
        if story and (not tem_filme(x) or CORTE.search(x.get("frase") or x.get("summary") or "")) and cid and "/" not in cid and not cid.startswith("."):
            with open(os.path.join(pasta, cid + ".json"), "w", encoding="utf-8") as f:
                json.dump({"story": story[:6]}, f, ensure_ascii=False, separators=(",", ":"))
            # o mesmo texto em inglês e espanhol, quando o robô de traduções já fez
            for lg, t in (x.get("tr") or {}).items():
                st_lg = [s for s in ((t or {}).get("story") or []) if isinstance(s, str) and s.strip() and not LIXO.search(s)]
                if lg in ("en", "es") and st_lg:
                    with open(os.path.join(pasta, "%s-%s.json" % (cid, lg)), "w", encoding="utf-8") as f:
                        json.dump({"story": st_lg[:6]}, f, ensure_ascii=False, separators=(",", ":"))
            item["st"] = 1
        feed.append(item)
    # o site abre só com o último ano (feed.json leve); os anos anteriores ficam em antigo/AAAA.json e
    # são baixados quando a pessoa volta no calendário ou chega ao fim da timeline
    corte = (dt.date.today() - dt.timedelta(days=CORTE_DIAS)).isoformat()
    recente = [x for x in feed if str(x.get("date", "")) >= corte]
    por_ano = {}
    for x in feed:
        d = str(x.get("date", ""))
        if d < corte and len(d) >= 4:
            por_ano.setdefault(d[:4], []).append(x)
    pasta_ant = os.path.join(dst, "antigo")
    os.makedirs(pasta_ant, exist_ok=True)
    # uma versão por língua: feed.json (português) e feed-en.json / feed-es.json, com título, resumo e
    # frase traduzidos (campo "tr" de campaigns.json); o que ainda não foi traduzido fica em português
    for lg in ("", "en", "es"):
        suf = "-" + lg if lg else ""
        with open(os.path.join(dst, "feed%s.json" % suf), "w", encoding="utf-8") as f:
            json.dump([na_lingua(x, lg) for x in recente], f, ensure_ascii=False, separators=(",", ":"))
        for ano, itens in por_ano.items():
            with open(os.path.join(pasta_ant, ano + suf + ".json"), "w", encoding="utf-8") as f:
                json.dump([na_lingua(x, lg) for x in itens], f, ensure_ascii=False, separators=(",", ":"))
    datas = sorted(str(x.get("date", "")) for x in feed if x.get("date"))
    with open(os.path.join(pasta_ant, "indice.json"), "w", encoding="utf-8") as f:
        json.dump({"anos": sorted(por_ano, reverse=True), "min": datas[0] if datas else "", "corte": corte}, f)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
