#!/usr/bin/env bash

set -u

###############################################################################
# OS Metrics Collector
#
# Purpose:
#   Collect OS-level metrics: CPU, RAM, load average, network in/out.
#
# Time alignment:
#   The first sample is collected at the next epoch timestamp divisible by
#   INTERVAL_SECONDS.
#
# Example:
#   If current local time is 11:03:03 and INTERVAL_SECONDS=5,
#   the first sample is collected at 11:03:05.
#
# CSV join key:
#   Use sample_epoch for joining data across multiple machines.
###############################################################################

###############################################################################
# Configurable values
###############################################################################

INTERVAL_SECONDS="${INTERVAL_SECONDS:-5}"
TIMEZONE="${TIMEZONE:-Asia/Ho_Chi_Minh}"

###############################################################################
# Required environment variables
###############################################################################

if [ -z "${RUN_ID:-}" ] || [ -z "${OUT_DIR:-}" ]; then
  echo "ERROR: Missing required environment variables." >&2
  echo "Required: RUN_ID, OUT_DIR" >&2
  exit 1
fi

###############################################################################
# Timezone setup for timestamp formatting
###############################################################################

export TZ="$TIMEZONE"

###############################################################################
# Output setup
###############################################################################

mkdir -p "$OUT_DIR"

OUT_FILE="$OUT_DIR/os_metrics_${RUN_ID}.csv"
HOSTNAME_VALUE=$(hostname)

IFACE=$(ip route | awk '/default/ {print $5; exit}')

if [ -z "$IFACE" ]; then
  echo "ERROR: Cannot detect primary network interface." >&2
  exit 1
fi

###############################################################################
# CSV header
###############################################################################

echo "sample_timestamp_iso,sample_epoch,collected_timestamp_iso,collected_epoch,collection_drift_sec,run_id,hostname,timezone,net_iface,cpu_user_pct,cpu_system_pct,cpu_idle_pct,cpu_iowait_pct,load_1m,load_5m,load_15m,mem_total_mb,mem_used_mb,mem_available_mb,mem_used_pct,net_rx_bytes_total,net_tx_bytes_total,net_rx_bytes_per_sec,net_tx_bytes_per_sec" > "$OUT_FILE"

###############################################################################
# Determine first aligned sample time
###############################################################################

CURRENT_EPOCH=$(date +%s)
NEXT_SAMPLE_EPOCH=$(( ((CURRENT_EPOCH / INTERVAL_SECONDS) + 1) * INTERVAL_SECONDS ))

echo "OS collector started."
echo "RUN_ID=$RUN_ID"
echo "OUT_FILE=$OUT_FILE"
echo "TIMEZONE=$TIMEZONE"
echo "INTERVAL_SECONDS=$INTERVAL_SECONDS"
echo "IFACE=$IFACE"
echo "CURRENT_EPOCH=$CURRENT_EPOCH"
echo "FIRST_SAMPLE_EPOCH=$NEXT_SAMPLE_EPOCH"
echo "FIRST_SAMPLE_TIME=$(date -d "@$NEXT_SAMPLE_EPOCH" -Iseconds)"

###############################################################################
# Initial baseline
###############################################################################

read _ USER NICE SYSTEM IDLE IOWAIT IRQ SOFTIRQ STEAL GUEST GUEST_NICE < /proc/stat

TOTAL_PREV=$((USER + NICE + SYSTEM + IDLE + IOWAIT + IRQ + SOFTIRQ + STEAL))
IDLE_PREV=$((IDLE + IOWAIT))
USER_PREV=$((USER + NICE))
SYSTEM_PREV=$((SYSTEM + IRQ + SOFTIRQ))
IOWAIT_PREV=$IOWAIT

RX_PREV=$(cat /sys/class/net/$IFACE/statistics/rx_bytes)
TX_PREV=$(cat /sys/class/net/$IFACE/statistics/tx_bytes)

###############################################################################
# Main collection loop
###############################################################################

while true; do
  NOW=$(date +%s)

  if [ "$NOW" -lt "$NEXT_SAMPLE_EPOCH" ]; then
    sleep $((NEXT_SAMPLE_EPOCH - NOW))
  fi

  COLLECTED_EPOCH=$(date +%s)
  SAMPLE_TIMESTAMP_ISO=$(date -d "@$NEXT_SAMPLE_EPOCH" -Iseconds)
  COLLECTED_TIMESTAMP_ISO=$(date -Iseconds)
  COLLECTION_DRIFT_SEC=$((COLLECTED_EPOCH - NEXT_SAMPLE_EPOCH))

  read _ USER NICE SYSTEM IDLE IOWAIT IRQ SOFTIRQ STEAL GUEST GUEST_NICE < /proc/stat

  TOTAL_NOW=$((USER + NICE + SYSTEM + IDLE + IOWAIT + IRQ + SOFTIRQ + STEAL))
  IDLE_NOW=$((IDLE + IOWAIT))
  USER_NOW=$((USER + NICE))
  SYSTEM_NOW=$((SYSTEM + IRQ + SOFTIRQ))
  IOWAIT_NOW=$IOWAIT

  TOTAL_DELTA=$((TOTAL_NOW - TOTAL_PREV))
  IDLE_DELTA=$((IDLE_NOW - IDLE_PREV))
  USER_DELTA=$((USER_NOW - USER_PREV))
  SYSTEM_DELTA=$((SYSTEM_NOW - SYSTEM_PREV))
  IOWAIT_DELTA=$((IOWAIT_NOW - IOWAIT_PREV))

  if [ "$TOTAL_DELTA" -gt 0 ]; then
    CPU_USER=$(awk -v x="$USER_DELTA" -v t="$TOTAL_DELTA" 'BEGIN {printf "%.2f", x * 100 / t}')
    CPU_SYSTEM=$(awk -v x="$SYSTEM_DELTA" -v t="$TOTAL_DELTA" 'BEGIN {printf "%.2f", x * 100 / t}')
    CPU_IDLE=$(awk -v x="$IDLE_DELTA" -v t="$TOTAL_DELTA" 'BEGIN {printf "%.2f", x * 100 / t}')
    CPU_IOWAIT=$(awk -v x="$IOWAIT_DELTA" -v t="$TOTAL_DELTA" 'BEGIN {printf "%.2f", x * 100 / t}')
  else
    CPU_USER="0.00"
    CPU_SYSTEM="0.00"
    CPU_IDLE="0.00"
    CPU_IOWAIT="0.00"
  fi

  TOTAL_PREV=$TOTAL_NOW
  IDLE_PREV=$IDLE_NOW
  USER_PREV=$USER_NOW
  SYSTEM_PREV=$SYSTEM_NOW
  IOWAIT_PREV=$IOWAIT_NOW

  read LOAD1 LOAD5 LOAD15 _ < /proc/loadavg

  MEM_TOTAL_KB=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
  MEM_AVAILABLE_KB=$(awk '/MemAvailable/ {print $2}' /proc/meminfo)
  MEM_USED_KB=$((MEM_TOTAL_KB - MEM_AVAILABLE_KB))

  MEM_TOTAL_MB=$((MEM_TOTAL_KB / 1024))
  MEM_AVAILABLE_MB=$((MEM_AVAILABLE_KB / 1024))
  MEM_USED_MB=$((MEM_USED_KB / 1024))

  MEM_USED_PCT=$(awk -v used="$MEM_USED_KB" -v total="$MEM_TOTAL_KB" 'BEGIN {printf "%.2f", used * 100 / total}')

  RX_NOW=$(cat /sys/class/net/$IFACE/statistics/rx_bytes)
  TX_NOW=$(cat /sys/class/net/$IFACE/statistics/tx_bytes)

  RX_RATE=$(( (RX_NOW - RX_PREV) / INTERVAL_SECONDS ))
  TX_RATE=$(( (TX_NOW - TX_PREV) / INTERVAL_SECONDS ))

  RX_PREV=$RX_NOW
  TX_PREV=$TX_NOW

  echo "$SAMPLE_TIMESTAMP_ISO,$NEXT_SAMPLE_EPOCH,$COLLECTED_TIMESTAMP_ISO,$COLLECTED_EPOCH,$COLLECTION_DRIFT_SEC,$RUN_ID,$HOSTNAME_VALUE,$TIMEZONE,$IFACE,$CPU_USER,$CPU_SYSTEM,$CPU_IDLE,$CPU_IOWAIT,$LOAD1,$LOAD5,$LOAD15,$MEM_TOTAL_MB,$MEM_USED_MB,$MEM_AVAILABLE_MB,$MEM_USED_PCT,$RX_NOW,$TX_NOW,$RX_RATE,$TX_RATE" >> "$OUT_FILE"

  NEXT_SAMPLE_EPOCH=$((NEXT_SAMPLE_EPOCH + INTERVAL_SECONDS))
done