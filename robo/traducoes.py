"""Traduz título, resumo e frase das campanhas para inglês e espanhol (o site mostra a versão da
língua de quem entra; o português continua sendo o texto principal de campaigns.json).

Guarda em cada campanha:  "tr": {"en": {"title": ..., "summary": ..., "frase": ...}, "es": {...}}
e, para as campanhas com texto longo (o que abre em "Ver mais"), "story": [parágrafos].
Título curto (até 4 palavras) costuma ser o nome da campanha ("Really Philly Good"): fica como está.

Uso no workflow:  python robo/traducoes.py            → traduz e grava em /tmp/traducoes.json
                  python robo/traducoes.py --aplicar  → aplica em campaigns.json (depois do git reset)
"""
import json
import os
import sys
import time
import urllib.parse

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import atualizar as A  # noqa: E402

LINGUAS = ("en", "es")
CAMPOS = ("title", "summary", "frase")
ACHADOS = os.environ.get("TRADUCOES_ACHADOS", "/tmp/traducoes.json")
POR_RODADA = int(os.environ.get("TRADUCOES_POR_RODADA", "1500"))
LOTE = 25  # campanhas por pedido ao tradutor
INICIO = time.time()
LIMITE_S = int(os.environ.get("TRADUCOES_LIMITE_S", str(22 * 60)))  # para antes do tempo do workflow acabar


def sem_tempo():
    return time.time() - INICIO > LIMITE_S
STORY_CHARS = int(os.environ.get("TRADUCOES_STORY_CHARS", "250000"))  # texto longo traduzido por rodada, por língua
STORY_PARAGRAFOS = 6  # o site mostra no máximo 6 parágrafos


def log(*a):
    print(*a, flush=True)


def _pedir(texto, lingua):
    url = "https://translate.googleapis.com/translate_a/single?" + urllib.parse.urlencode(
        {"client": "gtx", "sl": "auto", "tl": lingua, "dt": "t", "q": texto})
    dados = json.loads(A.baixar(url, timeout=20))
    return "".join(p[0] for p in dados[0] if p and p[0])


def traduzir_lista(textos, lingua):
    """Traduz vários textos num pedido só (um por linha). Se as linhas não baterem, traduz um a um."""
    limpos = [" ".join(str(t).split()) for t in textos]
    try:
        out = _pedir("\n".join(limpos), lingua).split("\n")
        if len(out) == len(limpos):
            return [o.strip() or t for o, t in zip(out, limpos)]
    except Exception as e:  # noqa: BLE001
        log("  lote falhou:", e)
    res = []
    for t in limpos:
        try:
            res.append(_pedir(t, lingua).strip() or t)
        except Exception:  # noqa: BLE001
            res.append(t)
        time.sleep(0.2)
    return res


def precisa(c):
    tr = c.get("tr") or {}
    return any(not (tr.get(lg) or {}).get("ok") for lg in LINGUAS) and not c.get("hidden")


def traduzir_campanhas(camps):
    """Devolve {id: {"en": {...}, "es": {...}}} para as campanhas dadas."""
    achados = {}
    for i in range(0, len(camps), LOTE):
        if sem_tempo():
            log("  tempo esgotado: o resto fica para a próxima rodada")
            break
        lote = camps[i:i + LOTE]
        pares = []  # (id, campo, texto)
        for c in lote:
            for k in CAMPOS:
                v = (c.get(k) or "").strip()
                if not v or (k == "title" and len(v.split()) <= 4):
                    continue
                pares.append((c["id"], k, v))
        for lg in LINGUAS:
            textos = traduzir_lista([p[2] for p in pares], lg) if pares else []
            for (cid, k, orig), novo in zip(pares, textos):
                achados.setdefault(cid, {}).setdefault(lg, {})[k] = novo
            for c in lote:  # marca título/resumo como feitos (mesmo sem nada a traduzir, só título curto)
                achados.setdefault(c["id"], {}).setdefault(lg, {})["ok"] = 1
            time.sleep(0.5)
        log("  traduzidas: %d/%d" % (min(i + LOTE, len(camps)), len(camps)))
    return achados


def precisa_story(c, lg):
    return bool(c.get("story")) and not c.get("hidden") and "story" not in ((c.get("tr") or {}).get(lg) or {})


def traduzir_storys(camp, achados):
    """Texto longo (parágrafos): junta parágrafos em pedidos de até ~4.500 caracteres."""
    for lg in LINGUAS:
        alvo, total = [], 0
        for c in camp:
            if precisa_story(c, lg):
                pars = [" ".join(str(p).split()) for p in c["story"][:STORY_PARAGRAFOS] if str(p).strip()]
                tam = sum(len(p) for p in pars)
                if total + tam > STORY_CHARS and alvo:
                    break
                alvo.append((c["id"], pars))
                total += tam
        log("Texto longo para %s: %d campanhas (%d caracteres)" % (lg, len(alvo), total))
        for cid, pars in alvo:
            if sem_tempo():
                log("  tempo esgotado no texto longo: o resto fica para a próxima rodada")
                break
            out, bloco = [], []
            for p in pars + [None]:
                if p is None or (bloco and sum(len(b) for b in bloco) + len(p) > 4500):
                    if bloco:
                        out += traduzir_lista(bloco, lg)
                        time.sleep(0.3)
                    bloco = []
                if p is not None:
                    bloco.append(p[:4500])
            achados.setdefault(cid, {}).setdefault(lg, {})["story"] = out


def main():
    camp = A.ler_json(A.CAMP, [])
    alvo = [c for c in camp if precisa(c)][:POR_RODADA]  # campaigns.json já vem do mais novo ao mais velho
    log("Campanhas sem tradução:", sum(1 for c in camp if precisa(c)), "| nesta rodada:", len(alvo))
    achados = traduzir_campanhas(alvo)
    traduzir_storys(camp, achados)
    json.dump(achados, open(ACHADOS, "w", encoding="utf-8"), ensure_ascii=False)


def aplicar():
    try:
        achados = json.load(open(ACHADOS, encoding="utf-8"))
    except (OSError, ValueError):
        achados = {}
    if not achados:
        return
    camp = A.ler_json(A.CAMP, [])
    n = 0
    for c in camp:
        a = achados.get(c.get("id"))
        if a:
            tr = c.setdefault("tr", {})
            for lg, campos in a.items():
                tr.setdefault(lg, {}).update(campos)  # junta (título/resumo de uma rodada, texto longo de outra)
            n += 1
    if n:
        A.salvar_json(A.CAMP, camp)
    log("Aplicadas:", n)


if __name__ == "__main__":
    aplicar() if "--aplicar" in sys.argv else main()
