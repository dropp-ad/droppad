"""Retroativo do Instagram: puxa o que cada conta monitorada postou nos últimos DIAS dias.

Roda de hora em hora (workflow ig-retroativo.yml) até passar por todas as contas uma vez.
Usa no máximo CHAMADAS chamadas da Meta por rodada, para somar com as 120/hora do vigia
sem passar do limite (~200/hora). O progresso fica em robo/ig_retro.json.

Uso:
  python robo/ig_retroativo.py            → lê as próximas contas e grava /tmp/ig_novas.json
  python robo/ig_retroativo.py --mesclar  → junta /tmp/ig_novas.json ao campaigns.json atual
"""
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atualizar as A  # noqa: E402
import instagram  # noqa: E402

DIAS = 90
CHAMADAS = int(os.environ.get("CHAMADAS", "60"))
POSTS = 60          # posts pedidos por conta (cobre ~3 meses da maioria das agências)
PARA_SE_USO = 70    # % de uso da Meta em que a rodada para
PROGRESSO = os.path.join(A.RAIZ, "robo", "ig_retro.json")
NOVAS = "/tmp/ig_novas.json"


def contas(fontes, vigia):
    lista, vistos = [], set()
    for c in fontes.get("instagram", []):
        u = c["usuario"].lstrip("@").lower()
        if u not in vistos:
            vistos.add(u)
            lista.append({"usuario": u, "nome": c.get("nome", u), "regiao": c.get("regiao", "Global"),
                          "cc": c.get("cc", ""), "agencia": c.get("agencia", "")})
    por_nome = {a["nome"]: a for a in fontes.get("agencias", [])}
    for nome, u in (vigia.get("ig", {}).get("contas") or {}).items():
        if u and u not in vistos and nome in por_nome:
            vistos.add(u)
            a = por_nome[nome]
            lista.append({"usuario": u, "nome": nome, "regiao": a.get("regiao", "Global"), "cc": a.get("cc", ""),
                          "agencia": nome})
    return lista


def ler_posts(usuario):
    campos = ("business_discovery.username(%s){username,media.limit(%d)"
              "{id,caption,media_type,media_product_type,permalink,timestamp}}") % (usuario, POSTS)
    dados, uso = instagram._chamar(campos)  # noqa: SLF001
    if "erro" in dados:
        return None, uso
    return ((dados.get("business_discovery") or {}).get("media") or {}).get("data", []), uso


def ler():
    if not instagram.configurado():
        print("Sem IG_TOKEN/IG_USER_ID; nada a fazer.")
        return
    fontes = A.ler_json(A.FONTES, {})
    vigia = A.ler_json(A.VIGIA, {})
    prog = A.ler_json(PROGRESSO, {"feitas": {}, "inicio": A.HOJE.isoformat()})
    feitas = prog.setdefault("feitas", {})
    mortas = set((vigia.get("ig") or {}).get("mortas", {}))
    pendentes = [c for c in contas(fontes, vigia) if c["usuario"] not in feitas]
    limite = (A.HOJE - dt.timedelta(days=DIAS)).isoformat()
    novas, gastas = [], 0
    for conta in pendentes:
        if gastas >= CHAMADAS:
            break
        if conta["usuario"] in mortas:
            feitas[conta["usuario"]] = "sem conta"
            continue
        try:
            itens, uso = ler_posts(conta["usuario"])
        except instagram.ErroToken as e:
            print("Token recusado pela Meta:", e)
            break
        gastas += 1
        if itens is None:
            feitas[conta["usuario"]] = "sem conta"
        else:
            achadas = [c for c in (A.post_para_campanha(p, conta, limite) for p in itens) if c]
            novas += achadas
            feitas[conta["usuario"]] = len(achadas)
            if achadas:
                print("  @%s: %d campanhas" % (conta["usuario"], len(achadas)))
        if uso >= PARA_SE_USO:
            print("Uso da API em %d%%; paro por aqui." % uso)
            break
    restam = len([c for c in contas(fontes, vigia) if c["usuario"] not in feitas])
    prog["restam"] = restam
    A.salvar_json(PROGRESSO, prog)
    with open(NOVAS, "w", encoding="utf-8") as f:
        json.dump(novas, f, ensure_ascii=False)
    print("Chamadas: %d | campanhas achadas: %d | contas que faltam: %d" % (gastas, len(novas), restam))


def mesclar():
    novas = A.ler_json(NOVAS, [])
    camp = A.ler_json(A.CAMP, [])
    ids = {c["id"] for c in camp}
    urls = {c.get("url", "").split("?")[0].rstrip("/") for c in camp}
    marca_dia = {(A.chave(c.get("brand", "")), c.get("date")) for c in camp}
    chaves = {(A.chave(c.get("brand", "")), A.chave(c.get("title", ""))) for c in camp}
    entram = []
    for c in sorted(novas, key=lambda x: x["date"], reverse=True):
        k = (A.chave(c["brand"]), c["date"])
        if c["id"] in ids or k in marca_dia or c["url"].split("?")[0].rstrip("/") in urls \
                or (A.chave(c["brand"]), A.chave(c["title"])) in chaves:
            continue
        if c.get("summary"):
            try:
                c["summary"] = A.traduzir(c["summary"])
            except Exception:  # noqa: BLE001
                pass
        entram.append(c)
        ids.add(c["id"])
        marca_dia.add(k)
    if entram:
        camp += entram
        camp.sort(key=lambda c: (c.get("date", ""), c.get("addedAt", "")), reverse=True)
        assert len({c["id"] for c in camp}) == len(camp)
        A.salvar_json(A.CAMP, camp)
        A.salvar_json(A.NOVIDADES, {"atualizado": A.AGORA.strftime("%Y-%m-%dT%H:%M:%SZ"), "total": len(camp),
                                    "ultimo": camp[0]["id"]})
    print("Entraram no site: %d (de %d achadas)" % (len(entram), len(novas)))


if __name__ == "__main__":
    mesclar() if "--mesclar" in sys.argv else ler()
