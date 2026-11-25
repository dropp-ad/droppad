#!/usr/bin/env bash
# Vigia do droppad: roda o robô em modo rápido a cada minuto, por quase 6 horas seguidas
# (o limite de um job do GitHub), e publica na hora sempre que entra campanha nova.
# Quando acaba, o workflow chama o próximo vigia sozinho (ver .github/workflows/vigia.yml).
set -u
cd "$(dirname "$0")/.."

DURACAO=${DURACAO:-20400}   # 5h40 de vigia por job
INTERVALO=${INTERVALO:-60}  # segundos entre o início de uma varredura e o da seguinte
FIM=$((SECONDS + DURACAO))
export RAPIDO=1

git config user.name "droppad robô"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

# Traz a versão mais nova da main sem perder o estado do vigia (que só existe aqui até ser publicado).
sincronizar() {
  cp robo/vigia.json /tmp/vigia.json 2>/dev/null || true
  git fetch -q origin main && git reset -q --hard origin/main
  cp /tmp/vigia.json robo/vigia.json 2>/dev/null || true
}

varrer() {
  timeout 240 python robo/atualizar.py > /tmp/rodada.log 2>&1
  local ok=$?
  grep -E "^Novas campanhas|^  \+|instagram|INSTAGRAM|Candidatos" /tmp/rodada.log | head -25
  [ $ok -ne 0 ] && { echo "rodada falhou ($ok):"; tail -5 /tmp/rodada.log; }
  return 0
}

publicar() {
  local motivo=$1
  for tentativa in 1 2 3; do
    git add campaigns.json novidades.json robo/vigia.json 2>/dev/null
    if git diff --cached --quiet; then return 0; fi
    git commit -q -m "$motivo ($(TZ=America/Sao_Paulo date '+%F %H:%M'), robô)"
    if git push -q origin HEAD:main; then
      echo ">> publicado: $motivo"
      [ "$motivo" = "Campanhas novas" ] && gh workflow run publicar.yml -R "${GITHUB_REPOSITORY}" --ref main >/dev/null 2>&1
      return 0
    fi
    echo "push recusado; pegando a versão nova e refazendo ($tentativa/3)"
    sincronizar
    [ "$motivo" = "Campanhas novas" ] && varrer
  done
  return 1
}

rodadas=0
while [ $SECONDS -lt $FIM ]; do
  inicio=$SECONDS
  rodadas=$((rodadas + 1))
  echo "== rodada $rodadas · $(TZ=America/Sao_Paulo date '+%d/%m %H:%M:%S')"
  sincronizar
  varrer
  if ! git diff --quiet -- campaigns.json; then
    publicar "Campanhas novas"
  elif [ $((rodadas % 30)) -eq 0 ]; then
    publicar "Estado do vigia"   # a cada ~30 min, para não perder o rodízio se o job cair
  fi
  espera=$((INTERVALO - (SECONDS - inicio)))
  [ $espera -gt 0 ] && sleep $espera
done

# fim do turno: guarda o estado do vigia (rodízio, contas do Instagram já achadas, etc.)
publicar "Estado do vigia"
echo "Turno encerrado depois de $rodadas rodadas."
