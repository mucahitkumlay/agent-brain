#!/bin/sh
# Runs on the server while the tunnel from your PC is open. Every 3 s it sends the machine's body signals
# (CPU, memory, network and disk per second, read from /proc) so the brain stem can show them, keeps the
# "tunnel up" heartbeat, and delivers anything queued while the tunnel was down.
SRC=$(hostname)
U=http://127.0.0.1:27182
NCPU=$(nproc 2>/dev/null || echo 1)
pt=0; pi=0; prx=0; ptx=0; prd=0; pwr=0; n=0
while :; do
  set -- $(awk '
    FILENAME == "/proc/stat" && $1 == "cpu" { t = $2 + $3 + $4 + $5 + $6 + $7 + $8 + $9; i = $5 + $6 }
    FILENAME == "/proc/net/dev" && FNR > 2 { split($0, a, ":"); gsub(/ /, "", a[1]); if (a[1] != "lo") { split(a[2], f, " "); rx += f[1]; tx += f[9] } }
    FILENAME == "/proc/diskstats" && $3 ~ /^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme[0-9]+n[0-9]+|mmcblk[0-9]+)$/ { rd += $6; wr += $10 }
    FILENAME == "/proc/meminfo" && $1 == "MemTotal:" { mt = $2 }
    FILENAME == "/proc/meminfo" && $1 == "MemAvailable:" { ma = $2 }
    FILENAME == "/proc/loadavg" { la = $1; split($4, q, "/"); pr = q[2] }
    END { printf "%.0f %.0f %.0f %.0f %.0f %.0f %.0f %.0f %.0f %.0f\n", t, i, rx, tx, rd, wr, mt, ma, la * 100, pr }
  ' /proc/stat /proc/net/dev /proc/diskstats /proc/meminfo /proc/loadavg 2>/dev/null)
  if [ $# -eq 10 ]; then
    if [ "$pt" -gt 0 ] && [ "$1" -gt "$pt" ]; then
      dt=$(( $1 - pt )); di=$(( $2 - pi ))
      cpu=$(( 1000 * (dt - di) / dt ))
      mem=0; [ "$7" -gt 0 ] && mem=$(( 1000 * ($7 - $8) / $7 ))
      body=$(printf '{"cpu":%d,"mem":%d,"rx":%d,"tx":%d,"rd":%d,"wr":%d,"load":%d,"procs":%d,"ncpu":%d}' \
        "$cpu" "$mem" $(( ($3 - prx) / 3 )) $(( ($4 - ptx) / 3 )) $(( ($5 - prd) * 512 / 3 )) $(( ($6 - pwr) * 512 / 3 )) "$9" "${10}" "$NCPU")
      curl -s -m 2 -o /dev/null -H 'Content-Type: application/json' -H "X-Brain-Source: $SRC" --data "$body" "$U/vitals"
    fi
    pt=$1; pi=$2; prx=$3; ptx=$4; prd=$5; pwr=$6
  fi
  n=$(( (n + 1) % 7 ))
  if [ "$n" -eq 1 ]; then
    if curl -s -m 3 -o /dev/null "$U/heartbeat?src=$SRC"; then sh "$HOME/.claude/brain-flush.sh"; fi
  fi
  sleep 3
done
