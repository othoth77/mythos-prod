#!/usr/bin/env bash
# =====================================================
# MYTHOS HADDAD — V0 hardware / system diagnostics
# projects/mythos-haddad/bin/haddad-diagnostics.sh
#
# Read-only snapshot of the machine: CPU, memory, storage, GPU, sensors,
# network, services. No root needed; sections that would need root say so.
# Prints to stdout and keeps a copy under the state log dir.
#   haddad-diagnostics.sh [--no-log]
# =====================================================
set -u
STATE_DIR="${HADDAD_STATE_DIR:-$HOME/.local/state/mythos-haddad}"
LOG_DIR="$STATE_DIR/logs"

section() { printf '\n===== %s =====\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

report() {
  echo "MYTHOS HADDAD diagnostics — $(hostname) — $(date -Is)"

  section "System"
  . /etc/os-release && echo "OS:      $PRETTY_NAME"
  echo "Kernel:  $(uname -r)"
  echo "Uptime:  $(uptime -p), load $(cut -d' ' -f1-3 /proc/loadavg)"
  echo "Board:   $(cat /sys/class/dmi/id/board_vendor 2>/dev/null) $(cat /sys/class/dmi/id/board_name 2>/dev/null), BIOS $(cat /sys/class/dmi/id/bios_version 2>/dev/null)"

  section "CPU"
  lscpu | grep -E '^(Model name|CPU\(s\)|Thread|Core|Socket|CPU max MHz|Virtualization)'

  section "Memory"
  free -h

  section "Storage"
  lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,MODEL | grep -v '^loop'
  echo; df -h -x tmpfs -x devtmpfs -x squashfs -x efivarfs
  have smartctl || echo "(SMART health: smartmontools not installed — see README, Known limits)"

  section "GPU"
  lspci -nnk | grep -A3 -E 'VGA|3D controller|Display controller'
  for card in /sys/class/drm/card[0-9]; do
    [ -e "$card/device/vendor" ] && echo "$(basename "$card"): vendor $(cat "$card/device/vendor") device $(cat "$card/device/device") driver $(basename "$(readlink "$card/device/driver")")"
  done
  ls -l /dev/dri/renderD* 2>/dev/null
  journalctl -k -b --no-pager 2>/dev/null | grep -iE 'nouveau|nvidia|NVRM' | grep -iE 'TU|gsp|VRAM|error|fail' | tail -8

  section "Sensors (hwmon)"
  for h in /sys/class/hwmon/hwmon*; do
    name=$(cat "$h/name" 2>/dev/null)
    for t in "$h"/temp*_input; do
      [ -r "$t" ] || continue
      label=$(cat "${t%_input}_label" 2>/dev/null || basename "${t%_input}")
      printf '%-12s %-10s %5.1f C\n' "$name" "$label" "$(awk '{print $1/1000}' "$t")"
    done
    for f in "$h"/fan*_input; do [ -r "$f" ] && printf '%-12s %-10s %5d RPM\n' "$name" "$(basename "${f%_input}")" "$(cat "$f")"; done
  done

  section "Network"
  ip -br -4 addr
  have tailscale && { echo; tailscale status 2>&1 | head -10; }

  section "Services"
  for u in ssh tailscaled; do printf '%-12s %s / %s\n' "$u" "$(systemctl is-active $u 2>&1)" "$(systemctl is-enabled $u 2>&1)"; done
  printf '%-12s %s\n' "health timer" "$(systemctl --user is-active mythos-haddad-health.timer 2>&1)"
  echo "Failed units: $(systemctl --failed --no-legend --plain | awk '{print $1}' | tr '\n' ' ')"
  echo "Listening TCP: $(ss -tlnH | awk '{print $4}' | sort -u | tr '\n' ' ')"

  section "Toolchain"
  for c in git node npm python3 claude tailscale gcc; do
    printf '%-10s %s\n' "$c" "$(have $c && $c --version 2>&1 | head -1 || echo MISSING)"
  done

  section "Top memory consumers"
  ps -eo pid,user,%mem,%cpu,comm --sort=-%mem | head -6
}

if [ "${1:-}" = "--no-log" ]; then
  report
else
  mkdir -p "$LOG_DIR"
  out="$LOG_DIR/diagnostics-$(date +%Y%m%dT%H%M%S).txt"
  report | tee "$out"
  ls -1t "$LOG_DIR"/diagnostics-*.txt 2>/dev/null | tail -n +21 | xargs -r rm -f
  echo; echo "saved: $out"
fi
