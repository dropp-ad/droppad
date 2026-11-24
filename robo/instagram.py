"""Instagram no robô do AD Drop (Graph API, sem IA).

Usa a conta @addrop.feed (Business, ligada à Página "AD Drop") para ler os posts
públicos de outras contas profissionais pelo "business_discovery":
  - contas das agências (descobertas sozinhas a partir de robo/fontes.json → agencias);
  - contas extras listadas à mão em robo/fontes.json → instagram.

Precisa dos secrets IG_TOKEN e IG_USER_ID no GitHub. Sem eles, não faz nada.

A Meta limita a ~200 chamadas por hora; o robô gasta no máximo CHAMADAS_POR_RODADA
por minuto e para sozinho se o uso informado pela Meta passar de 75%.
"""
import datetime as dt
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

GRAPH = "https://graph.facebook.com/v23.0"
CHAMADAS_POR_RODADA = 3       # 3 por minuto = 180 por hora (limite da Meta: 200)
TENTATIVAS_POR_AGENCIA = 3    # @ candidatos testados para achar a conta de cada agência
POSTS_POR_CONTA = 8
PAUSA_SE_USO = 75             # % de uso informado pela Meta que faz o robô pausar o Instagram
PAUSA_MIN = 20
PAUSA_ERRO_TOKEN_MIN = 30


class ErroToken(Exception):
    pass


def configurado():
    return bool(os.environ.get("IG_TOKEN") and os.environ.get("IG_USER_ID"))


def _uso(headers):
    """Maior % de uso que a Meta informa nos cabeçalhos da resposta."""
    maior = 0
    for nome in ("x-app-usage", "x-business-use-case-usage", "x-ad-account-usage"):
        bruto = headers.get(nome)
        if not bruto:
            continue
        try:
            dados = json.loads(bruto)
        except ValueError:
            continue
        blocos = []
        if isinstance(dados, dict) and any(isinstance(v, list) for v in dados.values()):
            for v in dados.values():
                blocos += v if isinstance(v, list) else []
        else:
            blocos = [dados]
        for b in blocos:
            for k in ("call_count", "total_time", "total_cputime"):
                try:
                    maior = max(maior, int(b.get(k, 0)))
                except (TypeError, ValueError):
                    pass
    return maior


def _chamar(campos):
    q = urllib.parse.urlencode({"fields": campos, "access_token": os.environ["IG_TOKEN"]})
    url = "%s/%s?%s" % (GRAPH, os.environ["IG_USER_ID"], q)
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            return json.loads(r.read().decode("utf-8")), _uso(r.headers)
    except urllib.error.HTTPError as e:
        uso = _uso(e.headers or {})
        try:
            err = json.loads(e.read().decode("utf-8")).get("error", {})
        except ValueError:
            err = {"message": str(e)}
        if err.get("code") == 190:
            raise ErroToken(err.get("message", "token inválido")) from None
        return {"erro": err}, uso


def descobrir(usuario):
    """Perfil público de uma conta profissional, ou None se não existir/não for profissional."""
    campos = "business_discovery.username(%s){username,name,biography,website}" % usuario
    dados, uso = _chamar(campos)
    return dados.get("business_discovery"), uso


def posts(usuario):
    campos = ("business_discovery.username(%s){username,name,media.limit(%d)"
              "{id,caption,media_type,media_product_type,permalink,timestamp}}") % (usuario, POSTS_POR_CONTA)
    dados, uso = _chamar(campos)
    bd = dados.get("business_discovery") or {}
    return (bd.get("media") or {}).get("data", []), uso


def _candidatos(ag, chave):
    cands = []
    for h in ag.get("instagram_candidatos", []) + ag.get("youtube", []) + [ag["nome"]]:
        h = re.sub(r"[^a-z0-9._]", "", h.lstrip("@").lower())
        if 2 < len(h) <= 30 and h not in cands:
            cands.append(h)
    return cands[:TENTATIVAS_POR_AGENCIA]


def _parece_da_agencia(ag, perfil, chave):
    nome = (perfil.get("name") or "") + " " + (perfil.get("username") or "")
    alvo = chave(ag.get("confere", ag["nome"]))
    if not alvo or alvo[:5] not in chave(nome):
        return False
    site = urllib.parse.urlparse(ag.get("site", "")).netloc.replace("www.", "").lower()
    web = (perfil.get("website") or "").lower()
    if site and site in web:
        return True
    generico = len(alvo) <= 6 or ag.get("estrito")
    texto = nome + " " + (perfil.get("biography") or "") + " " + web
    parece = re.search(r"agen|advertis|creative|criativ|publicid|marketing|brand|studio|comunica|network|ideas|design", texto, re.I)
    return bool(parece) or not generico


def rodada(fontes, vigia, agora, log, chave):
    """Gasta até CHAMADAS_POR_RODADA chamadas: lê contas conhecidas e descobre as das agências.
    Devolve [(post, conta)] com os posts lidos; conta = {"usuario","nome","regiao","cc","agencia"}."""
    if not configurado():
        return []
    st = vigia.setdefault("ig", {})
    contas = st.setdefault("contas", {})       # nome da agência → @ (ou "" se não achou)
    pos = st.get("pos", 0)
    pausa = st.get("pausa_ate", "")
    if pausa and pausa > agora.isoformat():
        return []

    # contas para ler: as fixas de fontes.json + as das agências já descobertas
    leitura = []
    for c in fontes.get("instagram", []):
        leitura.append({"usuario": c["usuario"].lstrip("@").lower(), "nome": c.get("nome", c["usuario"]),
                        "regiao": c.get("regiao", "Global"), "cc": c.get("cc", ""), "agencia": c.get("agencia", "")})
    por_nome = {a["nome"]: a for a in fontes.get("agencias", [])}
    for nome, usuario in contas.items():
        if usuario and nome in por_nome:
            a = por_nome[nome]
            leitura.append({"usuario": usuario, "nome": nome, "regiao": a.get("regiao", "Global"), "cc": a.get("cc", ""),
                            "agencia": nome})
    pendentes = [a for a in fontes.get("agencias", []) if a["nome"] not in contas]

    saida, gastas = [], 0
    try:
        while gastas < CHAMADAS_POR_RODADA:
            # uma descoberta por rodada enquanto houver agência sem conta; o resto lê posts
            if pendentes and (gastas == 0 or not leitura):
                ag = pendentes.pop(0)
                tentadas = st.setdefault("tentadas", {}).setdefault(ag["nome"], [])
                cands = [c for c in _candidatos(ag, chave) if c not in tentadas]
                if not cands:
                    contas[ag["nome"]] = ""
                    continue
                u = cands[0]
                tentadas.append(u)
                perfil, uso = descobrir(u)
                gastas += 1
                if perfil and _parece_da_agencia(ag, perfil, chave):
                    contas[ag["nome"]] = perfil["username"].lower()
                    st["tentadas"].pop(ag["nome"], None)
                    log("  instagram encontrado:", ag["nome"], "→ @" + perfil["username"])
                elif len(tentadas) >= len(_candidatos(ag, chave)):
                    contas[ag["nome"]] = ""
                    st["tentadas"].pop(ag["nome"], None)
            elif leitura:
                conta = leitura[pos % len(leitura)]
                pos += 1
                itens, uso = posts(conta["usuario"])
                gastas += 1
                saida += [(p, conta) for p in itens]
            else:
                break
            if uso >= PAUSA_SE_USO:
                st["pausa_ate"] = (agora + dt.timedelta(minutes=PAUSA_MIN)).isoformat()
                log("  instagram: uso da API em %d%%, pausa de %d min" % (uso, PAUSA_MIN))
                break
    except ErroToken as e:
        st["pausa_ate"] = (agora + dt.timedelta(minutes=PAUSA_ERRO_TOKEN_MIN)).isoformat()
        st["erro_token"] = agora.isoformat()
        log("  INSTAGRAM: token recusado pela Meta (%s). Gere um token novo e troque o secret IG_TOKEN." % e)
    except Exception as e:  # noqa: BLE001
        log("  instagram falhou:", e)
    st["pos"] = pos
    log("  instagram: %d chamadas, %d posts lidos, %d contas conhecidas, %d agências a procurar"
        % (gastas, len(saida), len(leitura), len(pendentes)))
    return saida
