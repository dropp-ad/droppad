"""Instagram no robô do droppad (Graph API, sem IA).

Usa a conta @addrop.feed (Business, ligada à Página "AD Drop") para ler os posts
públicos de outras contas profissionais pelo "business_discovery":
  - contas das agências (descobertas sozinhas a partir de robo/fontes.json → agencias: primeiro
    o @ que aparece no próprio site da agência, depois os @ do YouTube, o nome e variações);
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
CHAMADAS_POR_RODADA = 2       # 2 por minuto = 120 por hora (limite da Meta: ~200)
TENTATIVAS_POR_AGENCIA = 6    # @ candidatos testados para achar a conta de cada agência
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
IG_LINK = re.compile(r"instagram\.com/(?:_u/)?([A-Za-z0-9._]{2,30})", re.I)
IG_NAO = {"p", "reel", "reels", "tv", "explore", "accounts", "stories", "instagram", "sharer", "share",
          "about", "developer", "legal", "direct", "web", "embed.js", "static", "privacy", "help"}
POSTS_POR_CONTA = 8
PAUSA_SE_USO = 85             # % de uso informado pela Meta que faz o robô pausar o Instagram
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
    """Posts recentes; devolve (posts, uso, existe). existe=False quando a Meta diz que a conta
    não existe ou não é profissional (aí não adianta ler de novo tão cedo)."""
    campos = ("business_discovery.username(%s){username,name,media.limit(%d)"
              "{id,caption,media_type,media_product_type,permalink,timestamp}}") % (usuario, POSTS_POR_CONTA)
    dados, uso = _chamar(campos)
    if "erro" in dados:
        err = dados["erro"]
        sem_conta = err.get("code") == 110 or err.get("error_subcode") == 2207013 or \
            re.search(r"cannot be found|does not exist|invalid user|not.*business", err.get("message", ""), re.I)
        return [], uso, not sem_conta
    bd = dados.get("business_discovery") or {}
    return (bd.get("media") or {}).get("data", []), uso, True


def do_site(ag, st):
    """@ de Instagram linkados no site da agência (rodapé/cabeçalho), do mais citado ao menos.
    Não gasta chamada da Meta; guarda o resultado para não baixar o site de novo."""
    cache = st.setdefault("site_ig", {})
    if ag["nome"] in cache:
        return cache[ag["nome"]]
    achados = []
    if ag.get("site"):
        try:
            req = urllib.request.Request(ag["site"], headers={"User-Agent": UA, "Accept-Language": "en,pt;q=0.8"})
            with urllib.request.urlopen(req, timeout=15) as r:
                pag = r.read(1_500_000).decode("utf-8", "ignore")
            cont = {}
            for h in IG_LINK.findall(pag):
                h = h.rstrip(".").lower()
                if h not in IG_NAO:
                    cont[h] = cont.get(h, 0) + 1
            achados = sorted(cont, key=lambda k: -cont[k])[:3]
        except Exception:  # noqa: BLE001
            achados = []
    cache[ag["nome"]] = achados
    return achados


def _variacoes(nome):
    base = nome.lower().replace("&", "and").replace("+", "")
    base = re.sub(r"[^a-z0-9]", "", base)
    return [base, base + "agency", base + "_"] if base else []


def _candidatos(ag, chave, st=None):
    cands = []
    site = do_site(ag, st) if st is not None else []
    for h in site + ag.get("instagram_candidatos", []) + ag.get("youtube", []) + [ag["nome"]] + _variacoes(ag["nome"]):
        h = re.sub(r"[^a-z0-9._]", "", h.lstrip("@").lower())
        if 2 < len(h) <= 30 and h not in cands:
            cands.append(h)
    return cands[:TENTATIVAS_POR_AGENCIA]


def _parece_da_agencia(ag, perfil, chave, st=None):
    usuario = (perfil.get("username") or "").lower()
    if st is not None and usuario in st.get("site_ig", {}).get(ag["nome"], []):
        return True  # o próprio site da agência aponta para essa conta
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


PARADA_DIAS = 30        # conta sem post há mais que isso: lida no máximo 1x por dia
QUENTE_DIAS = 60        # conta que rendeu campanha nesse prazo: entra no rodízio rápido


def _quentes():
    """@ das contas de Instagram que já viraram campanha no site nos últimos QUENTE_DIAS."""
    try:
        with open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "campaigns.json"),
                  encoding="utf-8") as f:
            camp = json.load(f)
    except (OSError, ValueError):
        return set()
    desde = (dt.date.today() - dt.timedelta(days=QUENTE_DIAS)).isoformat()
    return {c["source"].split("@", 1)[1].lower() for c in camp
            if (c.get("source") or "").startswith("Instagram · @") and (c.get("date") or "") >= desde}


def _proxima(leitura, pos, st, agora, quente=False):
    """Escolhe a próxima conta a ler. A 1ª chamada de cada rodada vai para as contas que mais rendem
    campanha (rodízio próprio, volta em ~1-2h); as outras seguem o rodízio geral, pulando contas
    paradas (sem post há PARADA_DIAS) que já foram lidas nas últimas 24h."""
    if quente:
        q = _quentes()
        lista = [c for c in leitura if c["usuario"] in q]
        if lista:
            i = st.get("pos_quente", 0)
            st["pos_quente"] = i + 1
            return lista[i % len(lista)], pos
    ult, lida = st.get("ultimo_post", {}), st.get("lida", {})
    parada = (agora - dt.timedelta(days=PARADA_DIAS)).date().isoformat()
    ontem = (agora - dt.timedelta(hours=24)).isoformat()
    for _ in range(len(leitura)):
        conta = leitura[pos % len(leitura)]
        pos += 1
        u = conta["usuario"]
        if ult.get(u, "9") < parada and lida.get(u, "") > ontem:
            continue
        return conta, pos
    return leitura[pos % len(leitura)], pos + 1


def bloqueadas(fontes):
    """@ de Instagram que não são da agência (achados errado pelo robô): nunca lidos."""
    return {u.lstrip("@").lower() for u in (fontes.get("ig_bloqueadas") or {}).get("contas", [])}


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
    # contas que a Meta disse não existir / não serem profissionais: tenta de novo só depois de 30 dias
    mortas = st.setdefault("mortas", {})
    limite_morta = (agora - dt.timedelta(days=30)).isoformat()
    for u in [u for u, quando in mortas.items() if quando < limite_morta]:
        mortas.pop(u)
    try:  # as que o retroativo já viu que não existem contam como mortas também
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "ig_retro.json"), encoding="utf-8") as f:
            for u, v in json.load(f).get("feitas", {}).items():
                if v == "sem conta":
                    mortas.setdefault(u, agora.isoformat())
    except (OSError, ValueError):
        pass
    bloq = bloqueadas(fontes)
    for nome in [n for n, u in contas.items() if u in bloq]:
        contas.pop(nome)  # @ errado: a agência volta para a fila e o robô procura o certo
    for c in fontes.get("instagram", []):
        if c["usuario"].lstrip("@").lower() in mortas or c["usuario"].lstrip("@").lower() in bloq:
            continue
        leitura.append({"usuario": c["usuario"].lstrip("@").lower(), "nome": c.get("nome", c["usuario"]),
                        "regiao": c.get("regiao", "Global"), "cc": c.get("cc", ""), "agencia": c.get("agencia", "")})
    por_nome = {a["nome"]: a for a in fontes.get("agencias", [])}
    # contas da lista fixa cujo @ não existe: o robô procura o @ certo pelo nome da agência
    for c in fontes.get("instagram", []):
        if c["usuario"].lstrip("@").lower() in mortas and c.get("nome") and c["nome"] not in por_nome:
            por_nome[c["nome"]] = {"nome": c["nome"], "youtube": [], "regiao": c.get("regiao", "Global"),
                                   "cc": c.get("cc", ""), "estrito": True, "auto": True}
    for nome, usuario in contas.items():
        if usuario and nome in por_nome:
            a = por_nome[nome]
            leitura.append({"usuario": usuario, "nome": nome, "regiao": a.get("regiao", "Global"), "cc": a.get("cc", ""),
                            "agencia": nome})
    # agências sem conta + (uma vez) as que não foram achadas antes desta busca pelo site
    revistas = st.setdefault("revistas", [])
    pendentes = [a for a in por_nome.values()
                 if a["nome"] not in contas or (contas[a["nome"]] == "" and a["nome"] not in revistas)]
    pendentes.sort(key=lambda a: a.get("cc") != "BR")  # brasileiras primeiro (o feed é daqui)
    st["rodadas"] = st.get("rodadas", 0) + 1

    # enquanto o retroativo de 3 meses (ig_retroativo.py) não termina, o vigia usa metade das chamadas
    por_rodada = CHAMADAS_POR_RODADA
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "ig_retro.json"), encoding="utf-8") as f:
            if json.load(f).get("restam", 1) > 0:
                por_rodada = 1
    except (OSError, ValueError):
        pass
    saida, gastas = [], 0
    try:
        while gastas < por_rodada:
            # uma descoberta por rodada enquanto houver agência sem conta; o resto lê posts
            # enquanto houver agência a procurar: 1ª chamada sempre, 2ª em rodadas alternadas
            if pendentes and (not leitura or st["rodadas"] % 2 or (gastas == 0 and por_rodada > 1)):
                ag = pendentes.pop(0)
                if contas.get(ag["nome"]) == "":
                    revistas.append(ag["nome"])
                    contas.pop(ag["nome"], None)
                tentadas = st.setdefault("tentadas", {}).setdefault(ag["nome"], [])
                cands = [c for c in _candidatos(ag, chave, st) if c not in tentadas and c not in bloq]
                if not cands:
                    contas[ag["nome"]] = ""
                    st["tentadas"].pop(ag["nome"], None)
                    continue
                u = cands[0]
                tentadas.append(u)
                perfil, uso = descobrir(u)
                gastas += 1
                if perfil and _parece_da_agencia(ag, perfil, chave, st):
                    contas[ag["nome"]] = perfil["username"].lower()
                    st["tentadas"].pop(ag["nome"], None)
                    log("  instagram encontrado:", ag["nome"], "→ @" + perfil["username"])
                elif len(tentadas) >= len(_candidatos(ag, chave, st)):
                    contas[ag["nome"]] = ""
                    st["tentadas"].pop(ag["nome"], None)
            elif leitura:
                conta, pos = _proxima(leitura, pos, st, agora, quente=(gastas == 0))
                itens, uso, existe = posts(conta["usuario"])
                gastas += 1
                st.setdefault("lida", {})[conta["usuario"]] = agora.isoformat()
                datas = sorted((p.get("timestamp") or "")[:10] for p in itens if p.get("timestamp"))
                if datas:
                    st.setdefault("ultimo_post", {})[conta["usuario"]] = datas[-1]
                if not existe:
                    mortas[conta["usuario"]] = agora.isoformat()
                    log("  instagram: @%s não existe ou não é conta profissional; pulando por 30 dias" % conta["usuario"])
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
