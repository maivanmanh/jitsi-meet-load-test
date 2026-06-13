#!/usr/bin/env bash

set -u

###############################################################################
# Runner: OS collector only
#
# Use this on:
#   - Web node
#   - Jicofo node
#   - Prosody node
#   - Any non-JVB node
#
# Usage:
#   ./run_os_collector_only.sh <duration_seconds> [run_label]
#
# Example:
#   ./run_os_collector_only.sh 1800 c3_web_jicofo_node_6rooms_10users_run1
###############################################################################

###############################################################################
# Configurable values
###############################################################################

INTERVAL_SECONDS="${INTERVAL_SECONDS:-5}"
TIMEZONE="${TIMEZONE:-Asia/Ho_Chi_Minh}"
BASE_DIR="${BASE_DIR:-/home/ubuntu}"
METRICS_BASE_DIR="${METRICS_BASE_DIR:-$BASE_DIR/jitsi-metrics}"

###############################################################################
# Input
###############################################################################

DURATION_SECONDS="${1:-}"
RUN_LABEL="${2:-os_only_run}"

if [ -z "$DURATION_SECONDS" ]; then
  echo "Usage: $0 <duration_seconds> [run_label]" >&2
  echo "Example: $0 1800 c3_web_jicofo_node_6rooms_10users_run1" >&2
  exit 1
fi

if ! [[ "$DURATION_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "ERROR: duration_seconds must be an integer." >&2
  exit 1
fi

###############################################################################
# Timezone setup for timestamp formatting
###############################################################################

export TZ="$TIMEZONE"

###############################################################################
# Optional: set system timezone if possible
###############################################################################

if command -v timedatectl >/dev/null 2>&1; then
  CURRENT_TZ=$(timedatectl show -p Timezone --value 2>/dev/null || echo "")
  if [ "$CURRENT_TZ" != "$TIMEZONE" ]; then
    echo "Attempting to set system timezone to $TIMEZONE"

    if [ "$(id -u)" -eq 0 ]; then
      timedatectl set-timezone "$TIMEZONE" 2>/dev/null || true
    else
      sudo timedatectl set-timezone "$TIMEZONE" 2>/dev/null || true
    fi
  fi
fi

###############################################################################
# Prepare directories
###############################################################################

mkdir -p "$METRICS_BASE_DIR"

###############################################################################
# Validate collector script
###############################################################################

OS_SCRIPT="$BASE_DIR/collect_os_metrics_5s.sh"

if [ ! -x "$OS_SCRIPT" ]; then
  echo "ERROR: OS collector script not found or not executable: $OS_SCRIPT" >&2
  exit 1
fi

###############################################################################
# Create run output directory
###############################################################################

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RUN_ID="${RUN_LABEL}_${TIMESTAMP}"
OUT_DIR="$METRICS_BASE_DIR/$RUN_ID"

mkdir -p "$OUT_DIR"

###############################################################################
# Ownership normalization
###############################################################################

if id ubuntu >/dev/null 2>&1; then
  if [ "$(id -u)" -eq 0 ]; then
    chown -R ubuntu:ubuntu "$METRICS_BASE_DIR"
  else
    sudo chown -R ubuntu:ubuntu "$METRICS_BASE_DIR" 2>/dev/null || true
  fi
fi

###############################################################################
# Metadata
###############################################################################

CURRENT_EPOCH=$(date +%s)
FIRST_ALIGNED_SAMPLE_EPOCH=$(( ((CURRENT_EPOCH / INTERVAL_SECONDS) + 1) * INTERVAL_SECONDS ))
EXPECTED_LAST_SAMPLE_EPOCH=$(( FIRST_ALIGNED_SAMPLE_EPOCH + DURATION_SECONDS ))

cat > "$OUT_DIR/run_metadata.txt" <<META
run_id=$RUN_ID
run_label=$RUN_LABEL
hostname=$(hostname)
collector_type=os_only
timezone=$TIMEZONE
interval_seconds=$INTERVAL_SECONDS
duration_seconds=$DURATION_SECONDS
runner_start_epoch=$CURRENT_EPOCH
first_aligned_sample_epoch=$FIRST_ALIGNED_SAMPLE_EPOCH
first_aligned_sample_time=$(date -d "@$FIRST_ALIGNED_SAMPLE_EPOCH" -Iseconds)
expected_last_sample_epoch=$EXPECTED_LAST_SAMPLE_EPOCH
expected_last_sample_time=$(date -d "@$EXPECTED_LAST_SAMPLE_EPOCH" -Iseconds)
base_dir=$BASE_DIR
metrics_base_dir=$METRICS_BASE_DIR
out_dir=$OUT_DIR
os_script=$OS_SCRIPT
META

echo "Starting OS collector..."
echo "RUN_ID=$RUN_ID"
echo "OUT_DIR=$OUT_DIR"
echo "TIMEZONE=$TIMEZONE"
echo "INTERVAL_SECONDS=$INTERVAL_SECONDS"
echo "DURATION_SECONDS=$DURATION_SECONDS"
echo "FIRST_ALIGNED_SAMPLE_TIME=$(date -d "@$FIRST_ALIGNED_SAMPLE_EPOCH" -Iseconds)"

###############################################################################
# Export shared environment variables
###############################################################################

export RUN_ID
export OUT_DIR
export INTERVAL_SECONDS
export TIMEZONE

###############################################################################
# Start collector
###############################################################################

nohup "$OS_SCRIPT" > "$OUT_DIR/os_collector.log" 2>&1 &
OS_PID=$!

echo "$OS_PID" > "$OUT_DIR/os_collector.pid"

cat >> "$OUT_DIR/run_metadata.txt" <<META
os_collector_pid=$OS_PID
META

echo "OS collector PID: $OS_PID"

###############################################################################
# Run for requested duration, then stop collector
###############################################################################

sleep "$DURATION_SECONDS"

echo "Stopping OS collector..."

kill "$OS_PID" 2>/dev/null || true

wait "$OS_PID" 2>/dev/null
OS_EXIT=$?

cat >> "$OUT_DIR/run_metadata.txt" <<META
os_collector_exit_code=$OS_EXIT
actual_finished_at=$(date -Iseconds)
META

echo "OS collector finished."
echo "OS collector exit code: $OS_EXIT"
echo "Output directory: $OUT_DIR"