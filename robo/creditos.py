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
import html
import json
import os
import re
import sys
import time
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import atualizar as A  # noqa: E402

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
    json.dump(achados, open(ACHADOS, "w", encoding="utf-8"), ensure_ascii=False)
    log("Com ficha técnica:", len(achados), "de", len(alvo))


def aplicar():
    try:
        achados = json.load(open(ACHADOS, encoding="utf-8"))
    except (OSError, ValueError):
        return
    camp = A.ler_json(A.CAMP, [])
    n = 0
    for c in camp:
        if c.get("id") in achados and not c.get("credits"):
            c["credits"] = achados[c["id"]]
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
