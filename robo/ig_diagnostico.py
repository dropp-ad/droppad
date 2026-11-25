"""Diagnóstico do filtro do Instagram: lê algumas contas e mostra, post a post dos últimos
DIAS dias, se virou campanha ou por que foi barrado. Não grava nada."""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atualizar as A  # noqa: E402
import instagram  # noqa: E402
import datetime as dt  # noqa: E402

DIAS = int(os.environ.get("DIAS", "10"))
CONTAS = (os.environ.get("CONTAS") or "almapbbdo africacreative droga5sp ampfy artplan wmccannbr gutagency dpzoficial "
          "wiedenkennedy motherlondon droga5 publicisbrasil").split()


def motivo(p, nome):
    legenda = p.get("caption") or ""
    linhas = [A.limpar(x) for x in legenda.splitlines() if A.limpar(A.HASHTAG.sub(" ", x)).strip(" .·-—|")]
    titulo = re.sub(r"\s+", " ", A.HASHTAG.sub(" ", linhas[0]).strip(" .·-—|")) if linhas else ""
    texto = A.limpar(A.HASHTAG.sub(" ", legenda))
    if not titulo:
        return "sem legenda"
    m = A.EXCLUI.search(titulo)
    if m:
        return "EXCLUI no título: '%s'" % m.group(0)
    if A.PERGUNTA.search(titulo):
        return "título parece pergunta"
    m = A.ENTREVISTA.search(texto[:400])
    if m:
        return "parece entrevista: '%s'" % m.group(0)
    if not A.FORTE.search(texto[:600]) and p.get("media_type") != "VIDEO":
        return "foto sem palavra de campanha"
    c = A.post_para_campanha(p, {"usuario": nome, "nome": nome}, "0000")
    return ("OK → " + c["brand"]) if c else "não achou a marca (ou é a própria agência)"


limite = (A.HOJE - dt.timedelta(days=DIAS)).isoformat()
for u in CONTAS:
    itens, uso, existe = instagram.posts(u)
    datas = sorted((A.data_de(p.get("timestamp", "")) for p in itens), reverse=True)
    print("\n=== @%s (%s) uso %d%% | %d posts lidos, mais recente: %s" % (u, "ok" if existe else "NÃO EXISTE", uso,
                                                                       len(itens), datas[0] if datas else "-"))
    for p in itens:
        data = A.data_de(p.get("timestamp", ""))
        if data < limite:
            continue
        leg = re.sub(r"\s+", " ", (p.get("caption") or ""))[:150]
        print("  %s %-6s | %s\n      %s" % (data, p.get("media_type", "")[:6], motivo(p, u), leg))
