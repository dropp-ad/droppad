#!/usr/bin/env bash
# Retroativo do Instagram em loop: lê um lote de contas, publica, espera o limite da Meta
# baixar e repete, por até ~5h30. O workflow chama o próximo enquanto faltar conta.
set -u
inicio=$(date +%s)
git config user.name "AD Drop robô"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

publicar() {
  cp robo/ig_retro.json /tmp/ig_retro.json
  for tentativa in 1 2 3 4 5 6; do
    git fetch -q origin main
    git reset -q --hard origin/main
    cp /tmp/ig_retro.json robo/ig_retro.json
    python robo/ig_retroativo.py --mesclar
    git add campaigns.json novidades.json robo/ig_retro.json
    if git diff --cached --quiet; then return 0; fi
    git commit -q -m "Instagram retroativo $(TZ=America/Sao_Paulo date '+%F %H:%M') (robô)"
    if git push -q origin HEAD:main; then
      gh api -X POST "repos/${GITHUB_REPOSITORY}/pages/builds" >/dev/null 2>&1 || true
      return 0
    fi
    echo "Push recusado; tentando de novo ($tentativa/6)."
    sleep 7
  done
  return 1
}

while [ $(( $(date +%s) - inicio )) -lt 19800 ]; do
  git fetch -q origin main && git reset -q --hard origin/main
  python robo/ig_retroativo.py
  publicar
  restam=$(python -c "import json;print(json.load(open('robo/ig_retro.json')).get('restam',1))")
  echo "Contas que faltam: $restam"
  if [ "$restam" = "0" ]; then echo "Retroativo completo."; exit 0; fi
  sleep 900   # 15 min para o uso da Meta baixar
done
echo "CONTINUAR=1" >> "$GITHUB_ENV"
