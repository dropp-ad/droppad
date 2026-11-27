"""Passa os filtros atuais do robô nas campanhas que já estão no feed e tira o que não é campanha.

Uso: python robo/limpar_feed.py [--teste]
Serve para quando um filtro novo entra: o robô só filtra o que chega depois, e isto limpa o que já entrou.
Curadorias (Clube de Criação, Rian Swart) não passam por estes filtros.
"""
import json
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import atualizar as A  # noqa: E402

RAIZ = os.path.dirname(AQUI)
CURADORIAS = ("LinkedIn · Rian Swart", "LinkedIn · Clube", "Clube de Criação")


def motivo(c):
    src = c.get("source") or ""
    if src.startswith("LinkedIn") and not (c.get("yt") or c.get("video") or c.get("images")
                                           or ("static.licdn.com" not in (c.get("image") or "") and c.get("image"))):
        return "LinkedIn sem filme nem imagem"
    if src.startswith(CURADORIAS):
        return ""
    social = src.startswith(("Instagram", "LinkedIn"))
    t = c.get("title") or ""
    txt = t + " " + (c.get("summary") or "")
    marca = A.sem_acento(c.get("brand") or "").lower()
    if social and (A.CONTEUDO.search(txt[:500]) or A.PREMIO.search(txt[:1000]) or A.PROMO.search(txt[:300])):
        return "conteúdo/prêmio/promoção"
    if social and (A.COMEMORACAO.search(txt[:300]) or A.EVENTO.search(txt[:300])) and not A.TEM_PECA.search(t):
        return "comemoração/evento"
    if social and marca in A.PLATAFORMAS and not A.TEM_PECA.search(t):
        return "plataforma como marca"
    if social and c.get("brand") and not A.marca_ok(c["brand"]) and marca in {A.sem_acento(x) for x in A.NAO_MARCA}:
        return "marca inválida"
    if src.startswith("LinkedIn") and not (c.get("yt") or c.get("video") or c.get("images")
                                           or ("static.licdn.com" not in (c.get("image") or "") and c.get("image"))):
        return "LinkedIn sem filme nem imagem"
    if not social and (A.CONTEUDO_TIT.search(t) or A.PROMO.search(t) or (A.NEGOCIO_TIT.search(t) and not A.TEM_PECA.search(t))):
        return "título de não-campanha"
    return ""


def main():
    teste = "--teste" in sys.argv
    caminho = os.path.join(RAIZ, "campaigns.json")
    camp = json.load(open(caminho, encoding="utf-8"))
    fora = [(c, motivo(c)) for c in camp]
    fora = [(c, m) for c, m in fora if m]
    for c, m in fora:
        print("%s | %-24s | %-55s | %s" % (c["date"], (c.get("source") or "")[:24], c["title"][:55], m))
    ids = {c["id"] for c, _ in fora}
    novo = [c for c in camp if c["id"] not in ids]
    antes = len(novo)
    novo = A.deduplicar(novo)
    print("%d de %d saem pelos filtros; %d repetidas juntadas" % (len(fora), len(camp), antes - len(novo)))
    if teste or len(novo) == len(camp):
        return
    with open(caminho, "w", encoding="utf-8") as f:
        f.write(json.dumps(novo, ensure_ascii=False, indent=2) + "\n")
    nov = os.path.join(RAIZ, "novidades.json")
    n = json.load(open(nov, encoding="utf-8"))
    n["total"] = len(novo)
    n["ultimo"] = max(novo, key=lambda c: c.get("addedAt", ""))["id"]
    with open(nov, "w", encoding="utf-8") as f:
        f.write(json.dumps(n, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
