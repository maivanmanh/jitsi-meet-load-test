#!/usr/bin/env bash

set -u

###############################################################################
# JVB Colibri Metrics Collector
#
# Purpose:
#   Collect Jitsi Videobridge Colibri stats from:
#   http://localhost:8080/colibri/stats
#
# Time alignment:
#   The first sample is collected at the next epoch timestamp divisible by
#   INTERVAL_SECONDS.
#
# CSV join key:
#   Use sample_epoch for joining JVB metrics with OS metrics or other nodes.
###############################################################################

###############################################################################
# Configurable values
###############################################################################

INTERVAL_SECONDS="${INTERVAL_SECONDS:-5}"
TIMEZONE="${TIMEZONE:-Asia/Ho_Chi_Minh}"
JVB_STATS_URL="${JVB_STATS_URL:-http://localhost:8080/colibri/stats}"

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
# Dependency check
###############################################################################

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl is not installed." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is not installed." >&2
  exit 1
fi

###############################################################################
# Output setup
###############################################################################

mkdir -p "$OUT_DIR"

OUT_FILE="$OUT_DIR/jvb_colibri_${RUN_ID}.csv"
HOSTNAME_VALUE=$(hostname)

###############################################################################
# CSV header
###############################################################################

echo "sample_timestamp_iso,sample_epoch,collected_timestamp_iso,collected_epoch,collection_drift_sec,run_id,hostname,timezone,jvb_current_timestamp,healthy,version,conferences,participants,endpoints,local_endpoints,local_active_endpoints,largest_conference,endpoints_sending_video,endpoints_sending_audio,inactive_endpoints,inactive_conferences,bit_rate_download,bit_rate_upload,packet_rate_download,packet_rate_upload,incoming_loss,outgoing_loss,overall_loss,rtt_aggregate,stress_level,average_participant_stress,threads,muc_clients_connected,muc_clients_configured,mucs_joined,mucs_configured,total_conferences_created,total_conferences_completed,total_ice_succeeded,total_ice_failed,endpoints_ice_failed,endpoints_disconnected,endpoints_reconnected,total_data_channel_messages_received,total_data_channel_messages_sent,total_packets_received,total_packets_sent,total_bytes_received,total_bytes_sent,curl_success,curl_error" > "$OUT_FILE"

###############################################################################
# Determine first aligned sample time
###############################################################################

CURRENT_EPOCH=$(date +%s)
NEXT_SAMPLE_EPOCH=$(( ((CURRENT_EPOCH / INTERVAL_SECONDS) + 1) * INTERVAL_SECONDS ))

echo "JVB Colibri collector started."
echo "RUN_ID=$RUN_ID"
echo "OUT_FILE=$OUT_FILE"
echo "TIMEZONE=$TIMEZONE"
echo "INTERVAL_SECONDS=$INTERVAL_SECONDS"
echo "JVB_STATS_URL=$JVB_STATS_URL"
echo "CURRENT_EPOCH=$CURRENT_EPOCH"
echo "FIRST_SAMPLE_EPOCH=$NEXT_SAMPLE_EPOCH"
echo "FIRST_SAMPLE_TIME=$(date -d "@$NEXT_SAMPLE_EPOCH" -Iseconds)"

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

  CURL_OUTPUT=$(curl -sS --max-time 2 "$JVB_STATS_URL" 2>&1)
  CURL_EXIT=$?

  if [ "$CURL_EXIT" -ne 0 ]; then
    CURL_ERROR=$(echo "$CURL_OUTPUT" | tr ',' ';' | tr '\n' ' ')

    jq -n -r \
      --arg sample_ts "$SAMPLE_TIMESTAMP_ISO" \
      --arg sample_epoch "$NEXT_SAMPLE_EPOCH" \
      --arg collected_ts "$COLLECTED_TIMESTAMP_ISO" \
      --arg collected_epoch "$COLLECTED_EPOCH" \
      --arg drift "$COLLECTION_DRIFT_SEC" \
      --arg run_id "$RUN_ID" \
      --arg hostname "$HOSTNAME_VALUE" \
      --arg timezone "$TIMEZONE" \
      --arg curl_error "$CURL_ERROR" \
      '[
        $sample_ts,
        $sample_epoch,
        $collected_ts,
        $collected_epoch,
        $drift,
        $run_id,
        $hostname,
        $timezone,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "false",
        $curl_error
      ] | @csv' >> "$OUT_FILE"

  else
    ROW=$(echo "$CURL_OUTPUT" | jq -r \
      --arg sample_ts "$SAMPLE_TIMESTAMP_ISO" \
      --arg sample_epoch "$NEXT_SAMPLE_EPOCH" \
      --arg collected_ts "$COLLECTED_TIMESTAMP_ISO" \
      --arg collected_epoch "$COLLECTED_EPOCH" \
      --arg drift "$COLLECTION_DRIFT_SEC" \
      --arg run_id "$RUN_ID" \
      --arg hostname "$HOSTNAME_VALUE" \
      --arg timezone "$TIMEZONE" \
      '[
        $sample_ts,
        $sample_epoch,
        $collected_ts,
        $collected_epoch,
        $drift,
        $run_id,
        $hostname,
        $timezone,
        (.current_timestamp // ""),
        (.healthy // ""),
        (.version // ""),
        (.conferences // ""),
        (.participants // ""),
        (.endpoints // ""),
        (.local_endpoints // ""),
        (.local_active_endpoints // ""),
        (.largest_conference // ""),
        (.endpoints_sending_video // ""),
        (.endpoints_sending_audio // ""),
        (.inactive_endpoints // ""),
        (.inactive_conferences // ""),
        (.bit_rate_download // ""),
        (.bit_rate_upload // ""),
        (.packet_rate_download // ""),
        (.packet_rate_upload // ""),
        (.incoming_loss // ""),
        (.outgoing_loss // ""),
        (.overall_loss // ""),
        (.rtt_aggregate // ""),
        (.stress_level // ""),
        (.average_participant_stress // ""),
        (.threads // ""),
        (.muc_clients_connected // ""),
        (.muc_clients_configured // ""),
        (.mucs_joined // ""),
        (.mucs_configured // ""),
        (.total_conferences_created // ""),
        (.total_conferences_completed // ""),
        (.total_ice_succeeded // ""),
        (.total_ice_failed // ""),
        (.endpoints_ice_failed // ""),
        (.endpoints_disconnected // ""),
        (.endpoints_reconnected // ""),
        (.total_data_channel_messages_received // ""),
        (.total_data_channel_messages_sent // ""),
        (.total_packets_received // ""),
        (.total_packets_sent // ""),
        (.total_bytes_received // ""),
        (.total_bytes_sent // ""),
        "true",
        ""
      ] | @csv')

    if [ -z "$ROW" ]; then
      jq -n -r \
        --arg sample_ts "$SAMPLE_TIMESTAMP_ISO" \
        --arg sample_epoch "$NEXT_SAMPLE_EPOCH" \
        --arg collected_ts "$COLLECTED_TIMESTAMP_ISO" \
        --arg collected_epoch "$COLLECTED_EPOCH" \
        --arg drift "$COLLECTION_DRIFT_SEC" \
        --arg run_id "$RUN_ID" \
        --arg hostname "$HOSTNAME_VALUE" \
        --arg timezone "$TIMEZONE" \
        '[
          $sample_ts,
          $sample_epoch,
          $collected_ts,
          $collected_epoch,
          $drift,
          $run_id,
          $hostname,
          $timezone,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "false",
          "jq_parse_error"
        ] | @csv' >> "$OUT_FILE"
    else
      echo "$ROW" >> "$OUT_FILE"
    fi
  fi

  NEXT_SAMPLE_EPOCH=$((NEXT_SAMPLE_EPOCH + INTERVAL_SECONDS))
done