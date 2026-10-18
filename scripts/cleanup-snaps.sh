#!/usr/bin/env bash
# One-off: uninstall every snap except VS Code (and what it needs: core20, snapd),
# then drop old disabled revisions. Run: sudo bash scripts/cleanup-snaps.sh
[ -n "${BASH_VERSION:-}" ] || { echo "Run with bash: sudo bash scripts/cleanup-snaps.sh"; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "Needs sudo: sudo bash scripts/cleanup-snaps.sh"; exit 1; }
set -u

APPS=(aws-cli clipboard firefox intellij-idea-community postman pycharm-community rustrover sublime-text vlc)
# shared runtimes; only removable once no app uses them (snap refuses otherwise)
BASES=(gnome-42-2204 gnome-46-2404 gtk-common-themes mesa-2404 core18 core22 core24 bare)

echo "Will uninstall: ${APPS[*]}"
echo "Then unused runtimes: ${BASES[*]}"
echo "Keeps: code, core20, snapd"
df -h / | tail -1 | awk '{print "Free before: " $4}'
read -r -p "Type DELETE to continue: " ans
[ "$ans" = "DELETE" ] || { echo "Aborted."; exit 1; }

for s in "${APPS[@]}" "${BASES[@]}"; do
  snap list "$s" >/dev/null 2>&1 || continue
  echo "Removing $s"
  snap remove --purge "$s" || echo "  (skipped $s)"
done

# old disabled revisions of whatever is left
snap list --all | awk '/disabled/{print $1, $3}' | while read -r name rev; do
  echo "Removing old revision $name $rev"
  snap remove --purge "$name" --revision="$rev"
done
snap set system refresh.retain=2

echo
snap list
df -h / | tail -1 | awk '{print "Free after:  " $4}'
