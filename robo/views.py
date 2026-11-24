"""Visualizações dos filmes do YouTube, para o modo 🔥 do site.

Grava views.json no formato {"<id da campanha>": {"v": visualizações, "t": "<quando conferiu>"}}.
Usa a API pública do Return YouTube Dislike (não precisa de chave). O limite dela é de
cerca de 100 pedidos por minuto, então cada rodada confere no máximo LIMITE filmes,
começando pelos que estão há mais tempo sem conferir. Campanhas recentes são
reconferidas com mais frequência que as antigas.
"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAMPANHAS = os.path.join(RAIZ, "campaigns.json")
SAIDA = os.path.join(RAIZ, "views.json")
LIMITE = int(os.environ.get("LIMITE", "500"))
PAUSA = 0.7  # segundos entre pedidos (~85 por minuto)

agora = datetime.now(timezone.utc)


def ler(caminho, padrao):
    try:
        with open(caminho, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return padrao


def visualizacoes(video_id):
    url = "https://returnyoutubedislikeapi.com/votes?videoId=" + video_id
    req = urllib.request.Request(url, headers={"User-Agent": "dropp-ad-views/1.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return int(json.load(r).get("viewCount") or 0)


def validade(data_campanha):
    """Quanto tempo a contagem vale antes de reconferir."""
    try:
        idade = agora.date() - datetime.strptime(data_campanha, "%Y-%m-%d").date()
    except ValueError:
        return timedelta(days=7)
    if idade <= timedelta(days=3):
        return timedelta(hours=2)
    if idade <= timedelta(days=30):
        return timedelta(hours=12)
    return timedelta(days=7)


def main():
    campanhas = ler(CAMPANHAS, [])
    salvo = ler(SAIDA, {})
    ids_vivos = set()
    fila = []
    for c in campanhas:
        yt = [y for y in (c.get("yt") or []) if isinstance(y, str) and len(y) == 11]
        cid = c.get("id")
        if not cid or not yt:
            continue
        ids_vivos.add(cid)
        antigo = salvo.get(cid) or {}
        try:
            conferido = datetime.fromisoformat(antigo["t"])
        except (KeyError, ValueError, TypeError):
            conferido = datetime.min.replace(tzinfo=timezone.utc)
        if agora - conferido >= validade(c.get("date", "")):
            fila.append((conferido, cid, yt))

    fila.sort(key=lambda x: x[0])  # quem está há mais tempo sem conferir vai primeiro
    feitos = erros = 0
    for _, cid, yt in fila[:LIMITE]:
        total = 0
        ok = False
        for vid in yt[:3]:  # campanha com vários filmes: soma os três primeiros
            try:
                total += visualizacoes(vid)
                ok = True
            except Exception as e:  # noqa: BLE001
                erros += 1
                if "429" in str(e):
                    print("Limite da API atingido; paro por aqui.", file=sys.stderr)
                    fila = []
                    break
            time.sleep(PAUSA)
        if not fila:
            break
        if ok:
            salvo[cid] = {"v": total, "t": agora.isoformat(timespec="minutes")}
            feitos += 1

    # tira do arquivo campanhas que saíram do feed
    salvo = {k: v for k, v in salvo.items() if k in ids_vivos}
    with open(SAIDA, "w", encoding="utf-8") as f:
        json.dump(salvo, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    print(f"Conferidas: {feitos}; erros: {erros}; na fila: {max(0, len(fila) - LIMITE)}; no arquivo: {len(salvo)}")


if __name__ == "__main__":
    main()
