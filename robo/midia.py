"""Procura filme ou imagem para as campanhas do site que estão sem nenhum dos dois.

Para cada campanha recente (até 10 dias) sem filme e sem imagem, nesta ordem:
  1. a própria matéria de onde ela veio: filme embutido (YouTube, Vimeo, Instagram, TikTok) e foto;
  2. busca no YouTube (vídeos do último mês) pela marca + título/agência;
  3. matérias da última semana no Bing Notícias que citem a marca e a agência: filme e foto de capa.
Cada campanha é tentada até 4 vezes (o filme costuma subir depois da notícia).

Uso no workflow:  python robo/midia.py            → procura e grava as descobertas em /tmp/midia.json
                  python robo/midia.py --aplicar  → aplica /tmp/midia.json em campaigns.json (depois do git reset)
"""
import datetime as dt
import json
import os
import re
import sys
import urllib.parse
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import atualizar as A  # noqa: E402

ESTADO = os.path.join(AQUI, "midia.json")
ACHADOS = os.environ.get("MIDIA_ACHADOS", "/tmp/midia.json")
AGORA = dt.datetime.now(dt.timezone.utc)
DIAS = int(os.environ.get("MIDIA_DIAS", "10"))
POR_RODADA = int(os.environ.get("MIDIA_POR_RODADA", "40"))
MAX_TENTATIVAS = 4


def log(*a):
    print(*a, flush=True)


YT_ITEM = re.compile(r'"videoRenderer":\{"videoId":"([\w-]{11})".{0,1500}?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"'
                     r'.{0,3000}?"ownerText":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"', re.S)


GENERICAS = set("""campanha campaign campana lancamento launch lanza lanca estrena estreia brasil agencia agency something
chegada anunciar anuncia apresenta present presents nueva nuevo novo nova natal christmas holiday holidays navidad black
friday semana weeks really celebra celebrates desenvolvida criada created""".split())


def _palavras(t, marca=""):
    """Palavras que identificam a campanha (6+ letras), sem a marca e sem palavras genéricas."""
    tirar = set(re.findall(r"[a-z0-9]+", A.sem_acento(marca).lower()))
    return list(dict.fromkeys(w for w in re.findall(r"[a-z0-9]{6,}", A.sem_acento(t).lower())
                              if w not in GENERICAS and w not in tirar))


def _tem_marca(marca, texto):
    """A marca como palavra inteira (Subway não casa com "Subway Surfers"... mas casa com "Subway")."""
    m = re.escape(A.sem_acento(marca).lower()).replace(r"\ ", r"[\s\-]*")
    return re.search(r"(?<![a-z0-9])" + m + r"(?![a-z0-9])", A.sem_acento(texto).lower()) is not None


def _nome_entre_aspas(c):
    """Nome da campanha entre aspas (“ ” « » "), diferente da marca. Apóstrofo não conta como aspas (IKEA’s)."""
    for m in re.finditer(r"[“\"«]([^”\"»]{5,60})[”\"»]", c.get("title", "") + " " + c.get("summary", "")):
        nome = m.group(1).strip()
        if A.chave(nome) != A.chave(c.get("brand")) and len(A.chave(nome)) >= 6:
            return nome
    return ""


def bate_com_a_campanha(c, texto):
    """O texto (título de vídeo ou de matéria) fala desta campanha? Marca como palavra inteira E um sinal forte:
    a agência (palavra inteira), o nome da campanha entre aspas, um nome próprio composto da campanha
    ("Ary Fontoura", "Gloss Absolu", "Really Philly") ou duas palavras específicas do título."""
    # o vídeo tem exatamente o título da campanha (longo o bastante para não ser genérico): é ele,
    # mesmo sem a marca no nome do vídeo ("What we make of this moment, will make this moment.")
    tit = A.chave(c.get("title", ""))
    if len(tit) >= 24 and len(c.get("title", "").split()) >= 5 and tit in A.chave(texto):
        return True
    if not _tem_marca(c["brand"], texto):
        return False
    t = re.sub(r"\s+", " ", A.sem_acento(texto).lower())
    ag = c.get("agency", "")
    if len(A.chave(ag)) >= 5 and _tem_marca(ag, texto):
        return True
    nome = _nome_entre_aspas(c)
    if nome and A.chave(nome) in A.chave(texto):
        return True
    if any(f in t for f in _nomes_compostos(c)):
        return True
    return sum(1 for w in _palavras(c.get("title", ""), c["brand"]) if w in t) >= 2


def _nomes_compostos(c):
    """Pares de palavras com inicial maiúscula seguidas (nomes de pessoas, produtos, personagens), sem a marca."""
    tirar = set(re.findall(r"[a-z0-9]+", A.sem_acento(c["brand"]).lower()))
    out = []
    for txt in (c.get("title", ""), c.get("summary", "")):
        palavras = re.findall(r"[\wÀ-ÿ’']+", txt)
        for a, b in zip(palavras, palavras[1:]):
            if a[:1].isupper() and b[:1].isupper() and len(a) + len(b) >= 8:
                ka, kb = A.sem_acento(a).lower(), A.sem_acento(b).lower()
                if ka not in tirar and kb not in tirar and ka not in GENERICAS and kb not in GENERICAS \
                        and ka not in ("sao", "the", "nova", "novo", "rio"):
                    out.append(ka + " " + kb)
    return out


NAO_E_FILME = re.compile(r"\b(link in bio|review|resenha|unboxing|haul|tutorial|how to|como usar|gameplay|reagindo|react|"
                         r"podcast|entrevista|interview|ao vivo|live|cupom|achadinhos|vale a pena|shorts|vlog|preso|desafio|challenge|"
                         r"\d+ (?:dias|days|horas|hours)|"
                         # conversa sobre a campanha (prêmio, bastidores, palestra), não o filme
                         r"pr[eê]mio|premio|premiad[ao]s?|premiaci[oó]n|award|awards|winners?|ganadore?s?|vencedore?s?|ganar|ganhar|"
                         r"claves|keys\s+to|charla|conversa|conversamos|painel|panel|keynote|palestra|summit|webinar|"
                         r"bastidores|behind\s+the\s+scenes|making\s+of|case\s+study|caso\s+de\s+[eé]xito|insider|"
                         r"depoimento|testimonio|testimonial|fala\s+sobre|habla\s+de|talks?\s+about)\b", re.I)


UI_YT = re.compile(r"^(adicionar à fila|add to queue|enviar feedback|send feedback|assistir mais tarde|watch later|compartilhar|share|novo|new|"
                   r"\d+[:.]\d+|.*\bvisualiza|.*\bviews?\b|há \d+|\d+ (?:dias?|horas?|semanas?) atrás)", re.I)


def _videos_da_busca(pag):
    """(id, título, canal) dos vídeos da página de busca do YouTube, venha ela no formato antigo ou no novo:
    pega cada videoId e os primeiros textos que vêm logo depois dele (título, canal)."""
    out, vistos = [], set()
    for m in re.finditer(r'"videoId":"([\w-]{11})"', pag or ""):
        vid = m.group(1)
        if vid in vistos:
            continue
        janela = pag[m.end():m.end() + 8000]
        tm = re.search(r'"title":\{(?:"runs":\[\{)?"(?:text|content)":"((?:[^"\\]|\\.){3,200})"', janela)
        if not tm:
            continue
        textos = []
        for t in [tm.group(1)] + re.findall(r'"(?:text|content|simpleText)":"((?:[^"\\]|\\.){3,200})"', janela)[:15]:
            try:
                t = json.loads('"%s"' % t)
            except ValueError:
                pass
            if t not in textos and not UI_YT.search(t):
                textos.append(t)
        vistos.add(vid)
        out.append((vid, textos[0] if textos else "", " ".join(textos[1:8])))
    return out


def buscar_youtube(c):
    """Procura o filme no YouTube (busca do próprio site, vídeos do último mês). Só aceita vídeo cujo título ou
    canal tenha a marca E mais um sinal da campanha (agência, palavra do título ou canal oficial da marca)."""
    consultas = ['"%s"' % c["title"][:80], "%s %s" % (c["brand"], c["title"][:60]), "%s %s" % (c["brand"], c.get("agency", "")),
                 "%s campanha" % c["brand"]]
    for q in list(dict.fromkeys(consultas)):
        url = "https://www.youtube.com/results?" + urllib.parse.urlencode({"search_query": q, "sp": "EgIIBA=="})
        try:
            pag = A.baixar(url, timeout=20)
        except Exception as e:  # noqa: BLE001
            log("  youtube falhou:", e)
            return []
        achados = _videos_da_busca(pag)
        log("  youtube:", q[:60], "| vídeos", len(achados), "|", " / ".join(t[:40] for _, t, _ in achados[:4]))
        for vid, titulo, resto in achados[:10]:
            canal = resto.split("  ")[0][:60]
            if NAO_E_FILME.search(titulo) or len(re.findall(r"#\w", titulo)) >= 2:
                continue  # short de produto, resenha, tutorial, influenciador
            if re.search(r"[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]", titulo) and c.get("region") not in ("Ásia", "Asia", "APAC"):
                continue  # filme da mesma marca em outro país (Coreia, Japão, China)
            if bate_com_a_campanha(c, titulo):  # só o título do vídeo (o texto ao redor é de outros vídeos)
                log("  + youtube:", vid, "|", titulo)
                return [vid]
    return []


def buscar_noticias(c):
    """Matérias sobre a campanha (Bing News, última semana): filme embutido e foto de capa."""
    try:
        itens = A.buscar_bing('"%s" %s' % (c["brand"], c.get("agency", "").replace("&", "and")))
    except Exception as e:  # noqa: BLE001
        log("  bing falhou:", e)
        itens = []
    if not itens:
        try:
            itens = A.buscar_bing('"%s" campanha' % c["brand"])
        except Exception as e:  # noqa: BLE001
            log("  bing falhou:", e)
            return [], "", ""
    yts, video, img = [], "", ""
    log("  bing:", c["brand"], "|", len(itens), "matérias |", " / ".join(i.get("titulo", "")[:40] for i in itens[:3]))
    for it in itens[:6]:
        if not bate_com_a_campanha(c, it.get("titulo", "") + " " + it.get("resumo", "")[:300]):
            continue
        try:
            pag = baixar(it["link"])
        except Exception:  # noqa: BLE001
            continue
        y, v = A.filmes_de(A.corpo_da_materia(pag))
        img = img or boa_imagem(A.imagem_de(pag, it["link"]))
        log("  + matéria da campanha:", it["link"])
        if y or v:
            return y, v, img
    return yts, video, img


NAVEGADOR = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
             "Chrome/131.0.0.0 Safari/537.36")


def baixar(url):
    """Como A.baixar, mas com cara de navegador (vários sites de notícia barram robôs com 403)."""
    req = urllib.request.Request(url, headers={"User-Agent": NAVEGADOR, "Accept": "text/html,*/*",
                                               "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8,es;q=0.7"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read(3_000_000).decode(r.headers.get_content_charset() or "utf-8", "replace")


def boa_imagem(u):
    return "" if not u or re.search(r"empty|blank|placeholder|default|logo|no-image|sem-imagem", u, re.I) else u


def da_materia(c):
    """Filme e foto da própria página de onde a campanha veio."""
    u = c.get("url") or ""
    if not u.startswith("http") or "linkedin.com" in u:
        return [], "", ""
    try:
        pag = baixar(u)
    except Exception as e:  # noqa: BLE001
        log("  matéria falhou:", u, e)
        return [], "", ""
    y, v = A.filmes_de(A.corpo_da_materia(pag))
    img = boa_imagem(A.imagem_de(pag, u))
    if not img:
        fotos = A.fotos_de(pag, u, 1, c.get("date"))
        img = fotos[0] if fotos else ""
    return y, v, img


def completar(c):
    """Procura filme e imagem para uma campanha. Devolve o que achou ({} se nada)."""
    if c.get("yt") or c.get("video"):
        return {}
    achou = {}
    y, v, img = da_materia(c)
    if not (y or v):
        y = buscar_youtube(c)
    if not (y or v):
        y2, v2, img2 = buscar_noticias(c)
        y, v, img = y2, v2, img or img2
    if y:
        achou["yt"] = y[:2]
    elif v:
        achou["video"] = v
    if img and not c.get("image") and not c.get("images"):
        achou["image"] = img
    c.update(achou)
    return achou


def main():
    estado = A.ler_json(ESTADO, {})
    tent = estado.setdefault("tentativas", {})
    limite = (AGORA - dt.timedelta(days=DIAS)).date().isoformat()
    camp = A.ler_json(A.CAMP, [])
    # sem filme e sem imagem; e as do LinkedIn mesmo com imagem: o vídeo do post não toca no site, então
    # procura o filme (YouTube, matérias) pelo título — o link do post continua sendo o do LinkedIn
    # toda campanha recente sem filme, mesmo com imagem: o filme vem antes da imagem, e pode estar em
    # outra matéria ou no YouTube da marca/agência
    alvo = [c for c in camp if c.get("date", "") >= limite and not c.get("yt") and not c.get("video")
            and not c.get("hidden") and tent.get(c["id"], 0) < MAX_TENTATIVAS]
    alvo.sort(key=lambda c: (tent.get(c["id"], 0), c.get("date", "")), reverse=False)
    alvo = sorted(alvo[:POR_RODADA], key=lambda c: c.get("date", ""), reverse=True)
    log("Campanhas recentes sem filme nem imagem:", len(alvo))
    achados = {}
    for c in alvo:
        log("-", c["date"], c["brand"], "|", c["title"][:70], "|", c.get("source", ""))
        tent[c["id"]] = tent.get(c["id"], 0) + 1
        a = completar(dict(c))
        if a:
            achados[c["id"]] = a
            log("  => achou:", ", ".join(a))
    # esquece tentativas de campanhas que já saíram da janela
    ids = {c["id"] for c in camp if c.get("date", "") >= limite}
    estado["tentativas"] = {k: v for k, v in tent.items() if k in ids}
    A.salvar_json(ESTADO, estado)
    json.dump(achados, open(ACHADOS, "w", encoding="utf-8"), ensure_ascii=False)
    log("Com filme ou imagem nova:", len(achados))


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
        if a and not c.get("yt") and not c.get("video"):
            c.update({k: v for k, v in a.items() if not (k == "image" and (c.get("image") or c.get("images")))})
            n += 1
    if n:
        A.salvar_json(A.CAMP, camp)
        A.salvar_json(A.NOVIDADES, {"atualizado": AGORA.strftime("%Y-%m-%dT%H:%M:%SZ"), "total": len(camp),
                                    "ultimo": camp[0]["id"] if camp else ""})
    log("Aplicadas:", n)


if __name__ == "__main__":
    aplicar() if "--aplicar" in sys.argv else main()
