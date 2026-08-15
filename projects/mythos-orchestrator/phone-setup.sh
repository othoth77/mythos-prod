#!/usr/bin/env bash
# =====================================================
# Mythos Orchestrator — abonnement du téléphone
# projects/mythos-orchestrator/phone-setup.sh
#
# Usage: phone-setup.sh [--test]
#
# Affiche le topic ntfy courant et un QR code à scanner avec le
# téléphone pour (ré)abonner l'application ntfy, puis envoie une
# notification de test avec --test.
#
# Le topic est un secret de capacité : ce script l'affiche à l'écran,
# c'est son rôle — à lancer uniquement dans un terminal privé, jamais
# depuis un outil qui journalise la sortie. Le script lui-même ne
# contient aucun secret et lit la même configuration que notify.sh.
# =====================================================
set -u

CONFIG_FILE="${MYTHOS_NOTIFY_CONFIG:-${HOME}/.config/mythos-orchestrator/notify.env}"
if [[ -z "${MYTHOS_NTFY_URL:-}" && -r "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE" 2>/dev/null || true
fi

if [[ -z "${MYTHOS_NTFY_URL:-}" ]]; then
  printf 'Aucune configuration trouvée : définir MYTHOS_NTFY_URL ou %s\n' "$CONFIG_FILE" >&2
  exit 1
fi

topic="${MYTHOS_NTFY_URL##*/}"

printf 'URL d'"'"'abonnement : %s\n' "$MYTHOS_NTFY_URL"
printf 'Topic            : %s\n\n' "$topic"

printf 'Sur le téléphone (application ntfy) :\n'
printf '  1. Supprimer l'"'"'ancien abonnement (topic révoqué le 2026-08-12).\n'
printf '  2. « + » / « Add subscription », puis saisir exactement le topic ci-dessus.\n'
printf '  3. Régler le son de notification dans les réglages de l'"'"'abonnement.\n'

if command -v qrencode >/dev/null 2>&1; then
  printf '\nOu scanner ce QR code avec le téléphone (ouvre la page du topic,\npuis « Subscribe » / ouvrir dans l'"'"'application ntfy) :\n\n'
  qrencode -t ANSIUTF8 -m 2 "$MYTHOS_NTFY_URL"
else
  printf '\n(Installer « qrencode » pour afficher un QR code à scanner.)\n'
fi

if [[ "${1:-}" == "--test" ]]; then
  printf '\nEnvoi d'"'"'une notification de test…\n'
  "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/notify.sh" task_completed PHONE-SETUP "abonnement téléphone : notification de test"
  printf 'Envoyée (outcome dans notify.log). Vérifier le téléphone.\n'
fi

exit 0
