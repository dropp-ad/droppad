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


def _palavras(t):
    return list(dict.fromkeys(w for w in re.findall(r"[a-z0-9]{6,}", A.sem_acento(t).lower()) if w not in
            ("campanha", "campaign", "lancamento", "launch", "brasil", "agencia", "agency", "something", "chegada")))


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
    marca, ag = A.chave(c["brand"]), A.chave(c.get("agency", ""))
    chaves_titulo = _palavras(c["title"])
    for q in ("%s %s" % (c["brand"], c["title"][:60]), "%s %s" % (c["brand"], c.get("agency", "")),
              "%s campanha" % c["brand"]):
        url = "https://www.youtube.com/results?" + urllib.parse.urlencode({"search_query": q, "sp": "EgIIBA=="})
        try:
            pag = A.baixar(url, timeout=20)
        except Exception as e:  # noqa: BLE001
            log("  youtube falhou:", e)
            return []
        achados = _videos_da_busca(pag)
        log("  youtube:", q[:60], "| vídeos", len(achados), "|", " / ".join(t[:40] for _, t, _ in achados[:4]))
        for vid, titulo, resto in achados[:10]:
            tudo = A.chave(titulo + " " + resto)
            if marca not in A.chave(titulo) and marca not in A.chave(resto[:80]):
                continue
            # sinal forte: o nome da agência, ou duas palavras do título da campanha no título do vídeo
            iguais = sum(1 for w in chaves_titulo if w in A.sem_acento(titulo).lower())
            sinal = (ag and len(ag) >= 4 and ag in tudo) or iguais >= 2
            if sinal:
                log("  + youtube:", vid, "|", titulo)
                return [vid]
    return []


def buscar_noticias(c):
    """Matérias sobre a campanha (Bing News, última semana): filme embutido e foto de capa."""
    marca, ag = A.chave(c["brand"]), A.chave(c.get("agency", ""))
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
    for it in itens[:5]:
        if marca not in A.chave(it.get("titulo", "") + " " + it.get("resumo", "")):
            continue
        try:
            pag = A.baixar(it["link"], timeout=20)
        except Exception:  # noqa: BLE001
            continue
        if ag and ag not in A.chave(A.limpar(pag)[:60000]):
            continue  # a matéria tem que falar da agência também (senão é outra campanha da marca)
        miolo = A.corpo_da_materia(pag)
        y, v = A.filmes_de(miolo)
        img = img or A.imagem_de(pag, it["link"])
        if y or v:
            log("  + matéria com filme:", it["link"])
            return y, v, img
        yts = yts or y
    return yts, video, img


def da_materia(c):
    """Filme e foto da própria página de onde a campanha veio."""
    u = c.get("url") or ""
    if not u.startswith("http") or "linkedin.com" in u:
        return [], "", ""
    try:
        pag = A.baixar(u, timeout=20)
    except Exception as e:  # noqa: BLE001
        log("  matéria falhou:", u, e)
        return [], "", ""
    y, v = A.filmes_de(A.corpo_da_materia(pag))
    img = A.imagem_de(pag, u)
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
    alvo = [c for c in camp if c.get("date", "") >= limite and not c.get("yt") and not c.get("video")
            and not c.get("image") and not c.get("images") and not c.get("hidden")
            and tent.get(c["id"], 0) < MAX_TENTATIVAS]
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
