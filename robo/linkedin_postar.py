"""Posta na Página do droppAd no LinkedIn as campanhas que estrearam hoje, via webhook do Make.

O Make recebe {texto, link, titulo, marca, agencia, imagem} e publica na Página (ação de post
da LinkedIn Page). Roda pelo workflow linkedin-postar.yml; o endereço do webhook fica no secret
LINKEDIN_WEBHOOK. Sem o secret, não faz nada.

Regras:
- só campanhas de hoje (ou de ontem, de madrugada), com filme ou imagem, marca e agência;
- espera a página /c/<id>/ do site ficar no ar (POSTAR_DEPOIS_MIN) para o LinkedIn montar a prévia;
- no máximo POSTS_POR_RODADA por vez e POSTS_POR_DIA por dia (o Make grátis tem ~1.000 operações/mês);
- filmes primeiro; nunca posta a mesma campanha duas vezes (estado em robo/linkedin_postar.json).
"""
import datetime as dt
import json
import os
import re
import sys
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
CAMP = os.path.join(RAIZ, "campaigns.json")
ESTADO = os.path.join(AQUI, "linkedin_postar.json")

WEBHOOK = os.environ.get("LINKEDIN_WEBHOOK", "").strip()
POSTS_POR_DIA = int(os.environ.get("POSTS_POR_DIA", "10"))  # Make grátis: 3 operações por post, ~1.000/mês
POSTS_POR_RODADA = int(os.environ.get("POSTS_POR_RODADA", "1"))
POSTAR_DEPOIS_MIN = int(os.environ.get("POSTAR_DEPOIS_MIN", "15"))
TESTE = os.environ.get("TESTE") == "1"   # só mostra o que postaria

BRT = dt.timezone(dt.timedelta(hours=-3))
AGORA = dt.datetime.now(dt.timezone.utc)
HOJE = AGORA.astimezone(BRT).date()


def ler(p, padrao):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return padrao


RESERVADOS = re.compile(r"([|{}@\[\]()<>#\\*_~])")


def esc(s):
    """Texto para o "little Text Format" do LinkedIn: caracteres reservados com barra."""
    return RESERVADOS.sub(r"\\\1", s or "")


def hashtag(s):
    s = re.sub(r"[^\w]", "", (s or "").replace("&", "e"), flags=re.U)
    return "{hashtag|\\#|%s}" % s if 2 < len(s) <= 30 and not s.isdigit() else ""


def link_de(c):
    return "https://dropp.ad/c/%s/" % urllib.request.quote(c["id"])


def tem_filme(c):
    return bool(c.get("yt") or c.get("video"))


def texto_de(c):
    marca, ag, tit = c.get("brand", "").strip(), c.get("agency", "").strip(), (c.get("title") or "").strip()
    # título curto e com cara de nome de campanha vira citação; legenda longa não
    nome = tit if 3 <= len(tit) <= 70 and not re.search(r"[.!?…]\s|\n|#|@", tit) and tit.lower() != marca.lower() else ""
    if nome:
        abre = "Estreou hoje: “%s”, de %s" % (nome, marca)
    else:
        abre = "Estreou hoje a nova campanha de %s" % marca
    abre += (", criada pela %s." % ag) if ag else "."
    onde = "Veja o filme no droppad 👇" if tem_filme(c) else "Veja a campanha no droppad 👇"
    tags = " ".join(t for t in [hashtag("EstreouHoje"), hashtag("publicidade"), hashtag(marca), hashtag(ag)] if t)
    return "%s\n\n%s\n%s\n\n%s" % (esc(abre), esc(onde), esc(link_de(c)), tags)


def imagem_de(c):
    """Capa do post: a imagem da campanha, senão a capa do YouTube, senão a imagem do site."""
    img = c.get("image") or (c.get("images") or [""])[0]
    if img and "cdninstagram" not in img:  # link do Instagram vence em poucos dias
        return img
    if c.get("yt"):
        return "https://i.ytimg.com/vi/%s/hqdefault.jpg" % c["yt"][0]
    return img or "https://dropp.ad/compartilhar.png"


def candidatas(camp, postados):
    ontem = (HOJE - dt.timedelta(days=1)).isoformat()
    limite = (AGORA - dt.timedelta(minutes=POSTAR_DEPOIS_MIN)).strftime("%Y-%m-%dT%H:%M:%SZ")
    madrugada = AGORA.astimezone(BRT).hour < 6
    out = []
    for c in camp:
        if c.get("id") in postados or not c.get("brand") or not c.get("agency"):
            continue
        if c.get("date") != HOJE.isoformat() and not (madrugada and c.get("date") == ontem):
            continue
        if not (c.get("addedAt") or "") or c["addedAt"] > limite:
            continue  # a página /c/<id>/ ainda pode não estar no ar
        if not (tem_filme(c) or c.get("image") or c.get("images")):
            continue
        out.append(c)
    # filmes primeiro; dentro disso, as que entraram antes
    out.sort(key=lambda c: (not tem_filme(c), c.get("addedAt", "")))
    return out


def postar(c):
    corpo = {"texto": texto_de(c), "link": link_de(c), "titulo": "%s · %s" % (c.get("brand", ""), c.get("title", ""))[:200],
             "marca": c.get("brand", ""), "agencia": c.get("agency", ""),
             "imagem": imagem_de(c)}
    if TESTE or not WEBHOOK:
        print("--- (teste) postaria:\n" + corpo["texto"] + "\n[capa] " + corpo["imagem"])
        return True
    req = urllib.request.Request(WEBHOOK, data=json.dumps(corpo, ensure_ascii=False).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            ok = 200 <= r.status < 300
    except Exception as e:  # noqa: BLE001
        print("falhou:", c["id"], e)
        return False
    print("postada:" if ok else "recusada:", c["id"])
    return ok


def main():
    if not WEBHOOK and not TESTE:
        print("LINKEDIN_WEBHOOK não configurado; nada a fazer.")
        return 0
    est = ler(ESTADO, {"postados": [], "por_dia": {}})
    postados = set(est["postados"])
    dia = HOJE.isoformat()
    feitos_hoje = est["por_dia"].get(dia, 0)
    vagas = min(POSTS_POR_RODADA, POSTS_POR_DIA - feitos_hoje)
    if vagas <= 0:
        print("limite do dia atingido (%d)" % POSTS_POR_DIA)
        return 0
    fila = candidatas(ler(CAMP, []), postados)
    print("na fila: %d · postadas hoje: %d/%d" % (len(fila), feitos_hoje, POSTS_POR_DIA))
    for c in fila[:vagas]:
        if postar(c) and not TESTE:
            est["postados"].append(c["id"])
            feitos_hoje += 1
    est["postados"] = est["postados"][-3000:]
    est["por_dia"] = {d: n for d, n in est["por_dia"].items() if d >= (HOJE - dt.timedelta(days=7)).isoformat()}
    est["por_dia"][dia] = feitos_hoje
    if not TESTE:
        with open(ESTADO, "w", encoding="utf-8") as f:
            json.dump(est, f, ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
