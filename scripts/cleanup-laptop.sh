#!/usr/bin/env bash
# One-off: free disk space by removing everything on this laptop that isn't 7xen.
# Keeps: ~/fun/7xen, docker volume 7xen_7xen-pgdata, ~/.paddlex, PaddlePaddle HF models,
#        ~/.local/share/7xen-android, uv/npm/pnpm/nvm/gradle/android toolchains.
# Usage: bash scripts/cleanup-laptop.sh   (asks before deleting)
[ -n "${BASH_VERSION:-}" ] || { echo "Run with bash, not sh: bash scripts/cleanup-laptop.sh"; exit 1; }
[ "$(id -u)" -ne 0 ] || { echo "Don't use sudo — run as your normal user: bash scripts/cleanup-laptop.sh"; exit 1; }
set -u
cd "$HOME" || exit 1

PATHS=(
  # other projects
  Work report-ui skill SkillProject src PycharmProjects IdeaSnapshots fun/SevenXen
  Documents Downloads
  # junk files
  Backup.zip java_error_in_idea.hprof aa.sh a.map openvpn-connect-v3-linux.deb
  # other tools' leftovers
  .codeium .continue .copilot .cursor .kiro .junie .kimi-code .gemini .codex .ollama
  .m2 .rbenv .gem .cargo .rustup .dotnet
  # trash bins
  .local/share/Trash
  snap/code/271/.local/share/Trash
  snap/code/257 snap/code/218 snap/code/209
  # caches not used by 7xen
  .cache/JetBrains .local/share/JetBrains
  .cache/yarn .cache/pip .cache/google-chrome
  .cache/huggingface/hub/models--Lightricks--LTX-Video
  .cache/huggingface/hub/models--Lightricks--LTX-Video-0.9.5
  .cache/huggingface/hub/models--facebook--nllb-200-distilled-600M
)

VOLUMES=(
  fe-stack_es_data fe-stack_localstack fe-stack_psql_db fe-stack_rabbitmq_data fe-stack_redis_data
  libre-translator_libretranslate-data libre-translator_ollama_data
  plugins-mile_registry-storage portainer_data
)

echo "Will permanently delete (from $HOME):"
for p in "${PATHS[@]}"; do [ -e "$p" ] && echo "  $p"; done
echo "Docker volumes:"
for v in "${VOLUMES[@]}"; do docker volume inspect "$v" >/dev/null 2>&1 && echo "  $v"; done
echo
df -h / | tail -1 | awk '{print "Free before: " $4}'
read -r -p "Type DELETE to continue: " ans
[ "$ans" = "DELETE" ] || { echo "Aborted."; exit 1; }

for p in "${PATHS[@]}"; do
  [ -e "$p" ] || continue
  echo "Removing $p"
  rm -rf -- "$p"
done

for v in "${VOLUMES[@]}"; do
  docker volume rm "$v" >/dev/null 2>&1 && echo "Removed volume $v"
done

echo
df -h / | tail -1 | awk '{print "Free after:  " $4}'
