
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
POSTS_POR_DIA = int(os.environ.get("POSTS_POR_DIA", "10"))
POSTS_POR_RODADA = int(os.environ.get("POSTS_POR_RODADA", "1"))
POSTAR_DEPOIS_MIN = int(os.environ.get("POSTAR_DEPOIS_MIN", "15"))
TESTE = os.environ.get("TESTE") == "1"

BRT = dt.timezone(dt.timedelta(hours=-3))
AGORA = dt.datetime.now(dt.timezone.utc)
HOJE = AGORA.astimezone(BRT).date()

ABERTURAS = (
    "Fresh drop.",
    "Just dropped.",
    "New work alert.",
    "Straight from the creative world.",
    "Hot off the creative press.",
    "The latest drop.",
    "New on our radar.",
    "Worth a look.",
    "Creativity just dropped.",
    "Another one for your radar.",
    "Here's what's new.",
    "Fresh from the industry.",
    "One to watch.",
    "New work, fresh inspiration.",
    "On our creative radar.",
)

ASSINATURA = "More on dropp.ad, your social feed for advertising."


def ler(p, padrao):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return padrao


RESERVADOS = re.compile(r"([|{}@\[\]()<>#\\*_~])")


def esc(s):
    return RESERVADOS.sub(r"\\\1", s or "")


def link_de(c):
    return "https://dropp.ad/c/%s/" % urllib.request.quote(c["id"])


def tem_filme(c):
    return bool(c.get("yt") or c.get("video"))


def mencao(nome, cadastro):
    # Apenas IDs confirmados manualmente, nunca palpites de slug.
    item = cadastro.get(nome.casefold().strip(), {})
    if isinstance(item, dict):
        ident = str(item.get("id", ""))
        oficial = item.get("name", "")
        if re.fullmatch(r"[1-9][0-9]*", ident) and isinstance(oficial, str) and oficial.strip():
            return "@[%s](urn:li:organization:%s)" % (esc(oficial), ident)
    return esc(nome)


def texto_de(c, indice=0):
    marca = c.get("brand", "").strip()
    ag = c.get("agency", "").strip()

    abertura = ABERTURAS[indice % len(ABERTURAS)]

    cadastro = ler(os.path.join(AQUI, "linkedin_empresas.json"), {})
    if not isinstance(cadastro, dict):
        cadastro = {}
    corpo = "New work for %s by %s." % (mencao(marca, cadastro), mencao(ag, cadastro))

    return "%s\n\n%s\n\n%s\n\n%s" % (
        esc(abertura),
        corpo,
        esc(ASSINATURA),
        esc(link_de(c)),
    )


def imagem_de(c):
    img = c.get("image") or (c.get("images") or [""])[0]

    if img and "cdninstagram" not in img:
        return img

    if c.get("yt"):
        return "https://i.ytimg.com/vi/%s/hqdefault.jpg" % c["yt"][0]

    return img or "https://dropp.ad/compartilhar.png"


def candidatas(camp, postados):
    ontem = (HOJE - dt.timedelta(days=1)).isoformat()
    limite = (
        AGORA - dt.timedelta(minutes=POSTAR_DEPOIS_MIN)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    madrugada = AGORA.astimezone(BRT).hour < 6
    out = []

    for c in camp:
        if c.get("id") in postados:
            continue

        if not c.get("brand") or not c.get("agency"):
            continue

        if c.get("date") != HOJE.isoformat() and not (
            madrugada and c.get("date") == ontem
        ):
            continue

        if not (c.get("addedAt") or "") or c["addedAt"] > limite:
            continue

        if not (tem_filme(c) or c.get("image") or c.get("images")):
            continue

        out.append(c)

    out.sort(
        key=lambda c: (
            not tem_filme(c),
            c.get("addedAt", ""),
        )
    )

    return out


def postar(c, indice=0):
    corpo = {
        "texto": texto_de(c, indice),
        "link": link_de(c),
        "titulo": "%s | New advertising work" % c.get("brand", ""),
        "marca": c.get("brand", ""),
        "agencia": c.get("agency", ""),
        "imagem": imagem_de(c),
    }

    if TESTE or not WEBHOOK:
        print(
            "--- TEST PREVIEW ---\n"
            + corpo["texto"]
            + "\n[image] "
            + corpo["imagem"]
        )
        return True

    req = urllib.request.Request(
        WEBHOOK,
        data=json.dumps(
            corpo, ensure_ascii=False
        ).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            ok = 200 <= r.status < 300
    except Exception as e:
        print("falhou:", c["id"], type(e).__name__)
        return False

    print("postada:" if ok else "recusada:", c["id"])
    return ok


def main():
    if not WEBHOOK and not TESTE:
        print("LINKEDIN_WEBHOOK nao configurado.")
        return 0

    est = ler(
        ESTADO,
        {
            "postados": [],
            "por_dia": {},
            "aberturas_usadas": 0,
        },
    )

    postados = set(est["postados"])
    dia = HOJE.isoformat()
    feitos_hoje = est["por_dia"].get(dia, 0)

    indice = est.get(
        "aberturas_usadas",
        len(est["postados"]),
    )

    vagas = min(
        POSTS_POR_RODADA,
        POSTS_POR_DIA - feitos_hoje,
    )

    if vagas <= 0:
        print("Limite diario atingido.")
        return 0

    fila = candidatas(ler(CAMP, []), postados)

    print(
        "Na fila: %d | Postadas hoje: %d/%d"
        % (len(fila), feitos_hoje, POSTS_POR_DIA)
    )

    for c in fila[:vagas]:
        if postar(c, indice):
            indice += 1

            if not TESTE:
                est["postados"].append(c["id"])
                feitos_hoje += 1
                est["aberturas_usadas"] = indice

    est["postados"] = est["postados"][-3000:]

    est["por_dia"] = {
        d: n
        for d, n in est["por_dia"].items()
        if d >= (
            HOJE - dt.timedelta(days=7)
        ).isoformat()
    }

    est["por_dia"][dia] = feitos_hoje

    if not TESTE:
        with open(ESTADO, "w", encoding="utf-8") as f:
            json.dump(
                est,
                f,
                ensure_ascii=False,
                indent=1,
            )

    return 0


if __name__ == "__main__":
    sys.exit(main())
