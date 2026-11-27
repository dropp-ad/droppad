"""Ficha técnica das campanhas: abre a matéria de origem e lê os créditos (Ficha técnica / Credits).

Guarda em cada campanha "credits": [{"role": "Direção de criação", "name": "Fulana, Beltrano"}, ...]
e marca as já tentadas em robo/creditos.json (não abre a mesma matéria duas vezes).

Formatos que ele entende, em qualquer língua:
  Ficha técnica / Credits / Créditos / Ficha / Credits:  seguido de linhas "Função: Nome(s)"
  (também "Função – Nome", "Função | Nome" e listas <dt>/<dd> ou tabelas de duas colunas).
Sem um título de ficha, só aceita um bloco de 4+ linhas seguidas "Função: Nome" com funções conhecidas.

Uso no workflow:  python robo/creditos.py            → lê e grava em /tmp/creditos.json
                  python robo/creditos.py --aplicar  → aplica em campaigns.json (depois do git reset)
                  python robo/creditos.py --testar URL [URL…]  → só mostra o que acharia
"""
import concurrent.futures as cf
import datetime as dt
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import atualizar as A  # noqa: E402
from midia import bate_com_a_campanha  # noqa: E402

ESTADO = os.path.join(AQUI, "creditos.json")
ACHADOS = "/tmp/creditos.json"
POR_RODADA = int(os.environ.get("CREDITOS_POR_RODADA", "400"))
LIMITE_S = int(os.environ.get("CREDITOS_LIMITE_S", str(20 * 60)))
NAVEGADOR = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
             "Chrome/131.0.0.0 Safari/537.36")

TITULO_FICHA = re.compile(r"^\s*(ficha\s+t[ée]cnica|cr[ée]ditos?|credits?|campaign credits|ficha|cr[ée]dits|credenciales|"
                          r"agency credits|production credits)\s*:?\s*$", re.I)
FUNCOES = re.compile(
    r"\b(client|cliente|anunciante|advertiser|brand|marca|agency|ag[êe]ncia|agencia|agence|"
    r"chief creative|cco|ecd|executive creative|creative director|direç[ãa]o (geral )?de cria[çc][ãa]o|director creativo|"
    r"diretor de cria|dire[çc][ãa]o de arte|art director|director de arte|copy ?writer|copy|reda[çc][ãa]o|redator|redatora|redactor|"
    r"creative|cria[çc][ãa]o|creativ[oa]s?|designer|design|strategy|estrat[ée]gia|planejamento|planning|planner|"
    r"account|atendimento|cuentas|business|neg[óo]cios|media|m[íi]dia|medios|social|pr\b|relações públicas|"
    r"producer|produtor|produtora|producer|productora|produ[çc][ãa]o|production|producci[óo]n|prod\.|rtv|"
    r"director|diretor|dire[çc][ãa]o|realizador|dop|cinematographer|fotografia|photograph|editor|edi[çc][ãa]o|edici[óo]n|"
    r"post|p[óo]s|vfx|color|colorist|grading|sound|som|sonido|audio|[áa]udio|music|m[úu]sica|trilha|composer|"
    r"approval|aprova[çc][ãa]o|marketing|cmo|head|gerente|manager|vp|ceo|founder|cofounder|partner|"
    r"title|t[íi]tulo|campaign|campanha|campaña|film|filme|product|produto)\b", re.I)
SEPARADOR = re.compile(r"^\s*([^:–—|\n]{2,60}?)\s*(?::|\s[–—-]\s|\s\|\s)\s*(.{2,300})$")
NAO_E_NOME = re.compile(r"https?://|www\.|@\w+\.\w|\b(leia|read|see|veja|confira|saiba|clique|click|subscribe|assine|newsletter|"
                        r"cookie|copyright|©|todos os direitos)\b", re.I)
FUNCAO_AGENCIA = re.compile(r"^(?:(?:agência|agencia|agency|agence)(?: (?:criativa|creativa|creative))?|creative agency)$", re.I)
ATRIBUICAO = re.compile(
    r"(?i:\b(?:criad[ao] pela?|desenvolvid[ao] pela?|assinad[ao] pela?|cread[ao] por|"
    r"(?:created|developed) by)\s+(?:(?:a |the )?(?:agência|agencia|creative agency|agency)\s+)?)"
    r"([A-ZÀ-Ý][\w&’'.+-]*(?:\s+[A-ZÀ-Ý&][\w&’'.+-]*){0,4})"
)


def log(*a):
    print(*a, flush=True)


def baixar(url):
    req = urllib.request.Request(url, headers={"User-Agent": NAVEGADOR, "Accept": "text/html,*/*",
                                               "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8,es;q=0.7"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read(3_000_000).decode(r.headers.get_content_charset() or "utf-8", "replace")


def linhas_de(pagina):
    """O miolo da matéria como linhas de texto (quebra em <br>, </p>, </li>, </tr>, </dd>, títulos)."""
    miolo = A.corpo_da_materia(pagina)
    miolo = re.sub(r"<(script|style|noscript|svg|figure|figcaption)\b.*?</\1>", " ", miolo, flags=re.S | re.I)
    miolo = re.sub(r"</t[dh]>\s*<t[dh][^>]*>", " : ", miolo, flags=re.I)          # tabela de duas colunas
    miolo = re.sub(r"</dt>\s*<dd[^>]*>", " : ", miolo, flags=re.I)                 # lista dt/dd
    miolo = re.sub(r"<br\s*/?>|</(p|li|tr|dd|dt|h[1-6]|div|section|ul|ol|table)>", "\n", miolo, flags=re.I)
    texto = html.unescape(re.sub(r"<[^>]+>", " ", miolo))
    out = []
    for ln in texto.split("\n"):
        ln = re.sub(r"[ \t ​]+", " ", ln).strip(" •·*-•")
        if ln:
            out.append(ln)
    return out


def par(ln):
    """'Direção de criação: Fulana e Beltrano' → ('Direção de criação', 'Fulana e Beltrano')."""
    m = SEPARADOR.match(ln)
    if not m:
        return None
    funcao, nome = m.group(1).strip(" .:"), m.group(2).strip(" .;")
    if not FUNCOES.search(funcao) or len(funcao.split()) > 7 or NAO_E_NOME.search(nome):
        return None
    if len(nome) > 220 or nome.count(".") > 3 or len(nome.split()) > 30:
        return None  # é uma frase, não uma lista de nomes
    if re.search(r"[.!?]\s+[A-ZÀ-Ý]", nome):
        return None
    return funcao[:1].upper() + funcao[1:], nome


def creditos_de(pagina):
    linhas = linhas_de(pagina)
    # 1) depois de um título de ficha técnica
    for i, ln in enumerate(linhas):
        if TITULO_FICHA.match(ln):
            achou, ruins = [], 0
            for ln2 in linhas[i + 1:i + 80]:
                p = par(ln2)
                if p:
                    achou.append(p)
                    ruins = 0
                elif achou:
                    ruins += 1
                    if ruins >= 3:
                        break
                elif len(ln2) > 160:
                    break
            if len(achou) >= 2:
                return achou
    # 2) bloco de 4+ linhas "Função: Nome" seguidas, sem título
    melhor, atual = [], []
    for ln in linhas:
        p = par(ln)
        if p:
            atual.append(p)
        else:
            if len(atual) > len(melhor):
                melhor = atual
            atual = []
    if len(atual) > len(melhor):
        melhor = atual
    return melhor if len(melhor) >= 4 else []


def limpar_creditos(pares):
    out, vistos = [], set()
    for funcao, nome in pares:
        nome = re.sub(r"\s+", " ", nome).strip(" ,;")
        if ":" in nome:  # "General Manager: Automotive: Fulano" → função "General Manager, Automotive", nome "Fulano"
            mais, nome = nome.rsplit(":", 1)
            funcao, nome = "%s, %s" % (funcao, mais.strip()), nome.strip()
        k = (A.chave(funcao), A.chave(nome))
        if not nome or k in vistos:
            continue
        vistos.add(k)
        out.append({"role": funcao[:60], "name": nome[:220]})
    return out[:40]


def ler(c):
    try:
        return c["id"], limpar_creditos(creditos_de(baixar(c["url"])))
    except Exception as e:  # noqa: BLE001
        return c["id"], ("erro", str(e)[:80])


def agencia_de_creditos(creditos, c):
    marcas = {A.chave(c["brand"]), "youtube", "instagram", "linkedin", "tiktok"}
    nomes = {
        k["name"].strip(): None for k in creditos
        if FUNCAO_AGENCIA.fullmatch(k["role"])
        and 1 < len(k["name"].strip()) <= 60
        and A.chave(k["name"]) not in marcas
    }
    return next(iter(nomes)) if len(nomes) == 1 else ""


def agencia_na_materia(c, pagina):
    creditos = limpar_creditos(creditos_de(pagina))
    if any(FUNCAO_AGENCIA.fullmatch(k["role"]) for k in creditos):
        return agencia_de_creditos(creditos, c)
    creditos = [
        {"role": "Agência", "name": nome.rstrip(".")}
        for linha in linhas_de(pagina)[:100]
        for nome in ATRIBUICAO.findall(linha)
    ]
    return agencia_de_creditos(creditos, c)


def procurar_agencia(c):
    agencia = agencia_de_creditos(c.get("credits") or c.get("ficha") or [], c)
    if agencia:
        return c["id"], agencia
    fonte = c.get("url") or ""
    if fonte.startswith(("https://", "http://")):
        try:
            agencia = agencia_na_materia(c, baixar(fonte))
        except (OSError, ValueError):
            pass
        if agencia:
            return c["id"], agencia

    consulta = '"%s" %s %s' % (c["brand"], c["title"][:120], "agência" if c.get("cc") == "BR" else "agency")
    idioma, pais = ("pt-BR", "BR") if c.get("cc") == "BR" else ("en-US", "US")
    google = "https://news.google.com/rss/search?" + urllib.parse.urlencode(
        {"q": consulta, "hl": idioma, "gl": pais, "ceid": f"{pais}:{idioma[:2]}"}
    )
    try:
        itens = A.ler_feed(A.baixar(google, timeout=10))
    except (OSError, ValueError, A.ET.ParseError) as e:
        log("  Google Notícias indisponível:", type(e).__name__)
        itens = []
    for item in itens[:6]:
        titulo = item["titulo"].rsplit(" - ", 1)[0]
        if bate_com_a_campanha(c, titulo):
            agencia = agencia_na_materia(c, "<p>" + html.escape(titulo) + "</p>")
            if agencia:
                return c["id"], agencia

    # O feed do Google costuma fornecer links opacos. O Bing já entrega URLs
    # das matérias, onde podemos conferir o crédito quando o título é insuficiente.
    try:
        itens = A.buscar_bing(consulta)
    except (OSError, ValueError, A.ET.ParseError):
        itens = []
    for item in itens[:6]:
        if item["link"] == fonte or not bate_com_a_campanha(c, item["titulo"]):
            continue
        try:
            agencia = agencia_na_materia(c, baixar(item["link"]))
        except (OSError, ValueError):
            continue
        if agencia:
            return c["id"], agencia
    return c["id"], ""


def main():
    inicio = time.time()
    estado = A.ler_json(ESTADO, {})
    feitas = set(estado.get("tentadas", []))
    camp = A.ler_json(A.CAMP, [])
    alvo = [c for c in camp if not c.get("credits") and c["id"] not in feitas and not c.get("hidden")
            and str(c.get("url") or "").startswith("http")
            and not re.search(r"instagram\.com|linkedin\.com|youtube\.com|youtu\.be|tiktok\.com", c["url"])][:POR_RODADA]
    log("Campanhas sem ficha técnica:", len(alvo))
    achados = {}
    with cf.ThreadPoolExecutor(8) as ex:
        for cid, res in ex.map(ler, alvo):
            if time.time() - inicio > LIMITE_S:
                break
            if isinstance(res, tuple):
                if "403" in res[1] or "404" in res[1] or "410" in res[1]:
                    feitas.add(cid)  # site que bloqueia ou matéria apagada: não insiste
                continue
            feitas.add(cid)
            if res:
                achados[cid] = res
                log("  +", cid, "|", "; ".join("%s: %s" % (k["role"], k["name"][:40]) for k in res[:4]))
    estado["tentadas"] = sorted(feitas)
    A.salvar_json(ESTADO, estado)
    log("Com ficha técnica:", len(achados), "de", len(alvo))
    ontem = (dt.datetime.now(A.TZ).date() - dt.timedelta(days=1)).isoformat()
    sem_agencia = [
        dict(c, credits=c.get("credits") or c.get("ficha") or achados.get(c["id"], []))
        for c in camp if c.get("date", "") >= ontem and c.get("brand") and c.get("title")
        and not c.get("hidden") and not (c.get("agency") or "").strip()
    ][:20]
    with cf.ThreadPoolExecutor(8) as ex:
        agencias = {cid: nome for cid, nome in ex.map(procurar_agencia, sem_agencia) if nome}
    log("Agências encontradas:", len(agencias), "de", len(sem_agencia))
    with open(ACHADOS, "w", encoding="utf-8") as f:
        json.dump({"creditos": achados, "agencias": agencias}, f, ensure_ascii=False)


def aplicar():
    try:
        with open(ACHADOS, encoding="utf-8") as f:
            resultado = json.load(f)
    except (OSError, ValueError):
        return
    camp = A.ler_json(A.CAMP, [])
    achados = resultado.get("creditos", {})
    agencias = resultado.get("agencias", {})
    n = 0
    for c in camp:
        cid = c.get("id")
        if cid in achados and not c.get("credits"):
            c["credits"] = achados[cid]
            n += 1
        if cid in agencias and not (c.get("agency") or "").strip():
            c["agency"] = agencias[cid]
            n += 1
    if n:
        A.salvar_json(A.CAMP, camp)
    log("Aplicadas:", n)


def testar(urls):
    for u in urls:
        try:
            pg = baixar(u)
            res = limpar_creditos(creditos_de(pg))
            if not res and os.environ.get("DEPURAR"):
                ls = linhas_de(pg)
                idx = [i for i, l in enumerate(ls) if re.search(r"redit|ficha|agency|agência|cliente|client", l, re.I)][:3]
                for i in idx:
                    log("   ~", " || ".join(x[:70] for x in ls[i:i + 6]))
                if not idx:
                    log("   ~ sem pistas; miolo:", len(ls), "linhas; fim da página tem 'credit'?", bool(re.search(r"redits?", pg[-60000:], re.I)))
        except Exception as e:  # noqa: BLE001
            res = "erro: %s" % e
        log("==", u)
        for k in (res if isinstance(res, list) else [res]):
            log("   ", k)


if __name__ == "__main__":
    if "--aplicar" in sys.argv:
        aplicar()
    elif "--testar" in sys.argv:
        testar(sys.argv[sys.argv.index("--testar") + 1:])
    else:
        main()
