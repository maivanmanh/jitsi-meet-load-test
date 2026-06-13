require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

// --- CONFIGURATION ---
const RUN_ID = process.env.RUN_ID || `run-${Date.now()}`;
const LOAD_GENERATOR_ID = process.env.LOAD_GENERATOR_ID || "lg-1";
const BOT_START_INDEX = Number(process.env.BOT_START_INDEX) || 1;
const CLIENT_COUNT = Number(process.env.CLIENT_COUNT) || 5;
const ROOM_NAME = process.env.ROOM_NAME || "mvm";
const JITSI_DOMAIN = process.env.JITSI_DOMAIN || "meeting.maivanmanh.online";
const BOT_NAME_PATTERN = process.env.BOT_NAME_PATTERN || "Bot-";
const BOT_ROLE = process.env.BOT_ROLE || "sender";
const PUBLISHERS_COUNT = process.env.PUBLISHERS_COUNT ? Number(process.env.PUBLISHERS_COUNT) : -1;
const HEADLESS = String(process.env.HEADLESS || "true").toLowerCase() === "true";
const BROWSER_STRATEGY = process.env.BROWSER_STRATEGY || "multi-browser";
const BOTS_PER_BROWSER = Number(process.env.BOTS_PER_BROWSER) || 5;
const BROWSER_GROUP_DELAY_MS = Number(process.env.BROWSER_GROUP_DELAY_MS) || 2000;
const RAMP_DELAY_MS = Number(process.env.RAMP_DELAY_MS) || 1000;
const WARMUP_SECONDS = Number(process.env.WARMUP_SECONDS) || 10;
const MEASUREMENT_SECONDS = Number(process.env.MEASUREMENT_SECONDS) || 30;
const STATS_INTERVAL_MS = Number(process.env.STATS_INTERVAL_MS) || 2000;
const TEARDOWN_DELAY_SECONDS = Number(process.env.TEARDOWN_DELAY_SECONDS) || 5;
const INSTANCE_TYPE = process.env.INSTANCE_TYPE || "unknown";
const AWS_AZ = process.env.AWS_AZ || "unknown";
const OUTPUT_DIR = process.env.OUTPUT_DIR || "./results";
const DISABLE_GPU = String(process.env.DISABLE_GPU || "true").toLowerCase() === "true";

const ENABLE_SCREEN_SHARE = String(process.env.ENABLE_SCREEN_SHARE || "false").toLowerCase() === "true";
const LAST_N_NORMAL = Number(process.env.LAST_N_NORMAL) || 9;
const LAST_N_SHARING = Number(process.env.LAST_N_SHARING) || 3;
const SERVER_ONLY = String(process.env.SERVER_ONLY || "false").toLowerCase() === "true";
const UI_OPTIMIZATION = String(process.env.UI_OPTIMIZATION || "true").toLowerCase() === "true";

const DEBUG_STATS = String(process.env.DEBUG_STATS || "false").toLowerCase() === "true";
const DUMP_RAW_WEBRTC_STATS = String(process.env.DUMP_RAW_WEBRTC_STATS || "false").toLowerCase() === "true";

const PORT = process.env.PORT || 3000;
const FAKE_VIDEO = path.resolve(__dirname, process.env.FAKE_VIDEO || "media/fake-video-720p-15fps.y4m");
const FAKE_AUDIO = path.resolve(__dirname, process.env.FAKE_AUDIO || "media/fake-audio-noise-5s.wav");

// --- VALIDATION ---
if (!fs.existsSync(FAKE_VIDEO) || fs.statSync(FAKE_VIDEO).size === 0) {
  console.error(`[FATAL] Fake video file missing or empty: ${FAKE_VIDEO}`);
  process.exit(1);
}
if (!fs.existsSync(FAKE_AUDIO) || fs.statSync(FAKE_AUDIO).size === 0) {
  console.error(`[FATAL] Fake audio file missing or empty: ${FAKE_AUDIO}`);
  process.exit(1);
}
if (CLIENT_COUNT <= 0) { console.error("[FATAL] CLIENT_COUNT must be > 0"); process.exit(1); }
if (BOTS_PER_BROWSER <= 0) { console.error("[FATAL] BOTS_PER_BROWSER must be > 0"); process.exit(1); }
if (MEASUREMENT_SECONDS < 30) { console.error("[FATAL] MEASUREMENT_SECONDS must be >= 30"); process.exit(1); }

let effectiveIntervalMs = STATS_INTERVAL_MS;
if (effectiveIntervalMs < 1000 || effectiveIntervalMs > 5000) {
  console.warn(`[WARN] STATS_INTERVAL_MS ${STATS_INTERVAL_MS} out of bounds, clamping to 2000ms`);
  effectiveIntervalMs = 2000;
}

// --- OUTPUT DIRECTORY ---
const runOutputDir = path.join(OUTPUT_DIR, RUN_ID, LOAD_GENERATOR_ID);
fs.mkdirSync(runOutputDir, { recursive: true });

const botMediaTsPath = path.join(runOutputDir, "bot_media_timeseries.csv");
const aggTsPath = path.join(runOutputDir, "aggregate_timeseries.csv");
const botSummaryPath = path.join(runOutputDir, "bot_summary.csv");
const runSummaryPath = path.join(runOutputDir, "run_summary.json");

// Write run_config.json
const runConfig = {
  RUN_ID, LOAD_GENERATOR_ID, BOT_START_INDEX, CLIENT_COUNT, ROOM_NAME, JITSI_DOMAIN,
  BOT_NAME_PATTERN, BOT_ROLE, PUBLISHERS_COUNT, HEADLESS, BROWSER_STRATEGY, BOTS_PER_BROWSER,
  BROWSER_GROUP_DELAY_MS, RAMP_DELAY_MS, WARMUP_SECONDS, MEASUREMENT_SECONDS,
  STATS_INTERVAL_MS: effectiveIntervalMs, TEARDOWN_DELAY_SECONDS, INSTANCE_TYPE,
  AWS_AZ, OUTPUT_DIR, DISABLE_GPU, SERVER_ONLY, ENABLE_SCREEN_SHARE, LAST_N_NORMAL, LAST_N_SHARING, UI_OPTIMIZATION, FAKE_VIDEO, FAKE_AUDIO, DEBUG_STATS, DUMP_RAW_WEBRTC_STATS
};
fs.writeFileSync(path.join(runOutputDir, "run_config.json"), JSON.stringify(runConfig, null, 2));

// Initialize CSVs
fs.writeFileSync(botMediaTsPath, "sample_timestamp_iso,sample_epoch,collected_timestamp_iso,collected_epoch,collection_drift_sec,run_id,load_generator_id,elapsed_s,phase,bot_id,bot_name,group_id,browser_index,role,ui_joined,ice_state,ice_connected,local_audio_track_exists,local_video_track_exists,local_video_track_count,simulcast_layers,local_audio_muted,local_video_muted,local_audio_ready_state,local_video_ready_state,local_audio_enabled,local_video_enabled,peer_connection_count,outbound_audio_report_count,outbound_video_report_count,audio_packets_total,audio_packets_delta,audio_bytes_total,audio_bytes_delta,audio_active,video_packets_total,video_packets_delta,video_bytes_total,video_bytes_delta,frames_encoded_total,frames_encoded_delta,video_active,frames_per_second,frame_width,frame_height,quality_limitation_reason,quality_limitation_resolution_changes,quality_limitation_durations_cpu,quality_limitation_durations_bandwidth,quality_limitation_durations_other,encoder_implementation,codec,candidate_pair_current_round_trip_time,available_outgoing_bitrate,error\n");
fs.writeFileSync(aggTsPath, "sample_timestamp_iso,sample_epoch,collected_timestamp_iso,collected_epoch,collection_drift_sec,run_id,load_generator_id,elapsed_s,phase,configured_bot_count,ui_joined_count,ice_connected_count,audio_active_count,video_active_count,total_audio_packets_delta,total_audio_bytes_delta,total_video_packets_delta,total_video_bytes_delta,total_frames_encoded_delta,bots_with_stats_count,bots_missing_stats_count,bots_with_local_video_track_count,bots_with_outbound_video_report_count,bots_with_video_report_but_no_frames_count,total_logical_tracks,total_simulcast_layers\n");

console.log(`\n=========================================`);
console.log(`🚀 LOAD GENERATOR CONFIGURATION`);
console.dir(runConfig, { colors: true });
console.log(`=========================================\n`);

const app = express();
app.use(express.static(path.join(__dirname, "public")));

let browsers = [];
let botContexts = []; 
let shuttingDown = false;
let currentPhase = "starting";
let startedAt = Date.now();

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

async function runBenchmark() {
  currentPhase = "ramp_up";
  console.log(`\n[Phase: ${currentPhase}] Launching browsers...`);
  
  const launchArgs = [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${FAKE_VIDEO}`,
    `--use-file-for-fake-audio-capture=${FAKE_AUDIO}`,
    "--ignore-certificate-errors",
    "--allow-insecure-localhost",
    `--unsafely-treat-insecure-origin-as-secure=http://localhost:${PORT}`,
    "--autoplay-policy=no-user-gesture-required",
    "--disable-gesture-requirement-for-media-playback",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-features=CalculateNativeWinOcclusion",
    "--auto-select-desktop-capture-source=Entire screen"
  ];
  if (DISABLE_GPU) launchArgs.push("--disable-gpu");

  if (UI_OPTIMIZATION) {
    launchArgs.push(
      "--mute-audio",
      "--disable-animations",
      "--disable-backing-store-limit"
    );
  }

  let currentBrowser = null;
  let currentBrowserIndex = -1;
  const numBrowsers = BROWSER_STRATEGY === "multi-browser" ? Math.ceil(CLIENT_COUNT / BOTS_PER_BROWSER) : 1;

  for (let i = 0; i < CLIENT_COUNT; i++) {
    if (shuttingDown) break;
    const botId = BOT_START_INDEX + i;
    const botName = `${BOT_NAME_PATTERN}${botId}`;
    const groupIndex = BROWSER_STRATEGY === "multi-browser" ? Math.floor(i / BOTS_PER_BROWSER) : 0;

    if (groupIndex !== currentBrowserIndex) {
      if (currentBrowserIndex !== -1 && BROWSER_STRATEGY === "multi-browser") {
        await delay(BROWSER_GROUP_DELAY_MS);
      }
      currentBrowser = await chromium.launch({ headless: HEADLESS, args: launchArgs });
      browsers.push(currentBrowser);
      currentBrowserIndex = groupIndex;
    }

    let context, page;
    try {
      context = await currentBrowser.newContext({ 
        ignoreHTTPSErrors: true, 
        permissions: ["camera", "microphone"],
        viewport: { width: 1280, height: 720 } 
      });
      page = await context.newPage();
    } catch (err) {
      console.error(`[!] Failed to launch browser context for ${botName}: ${err.message}`);
      let botObj = {
        page: null, botId, botName, groupId: groupIndex, uiJoined: false,
        firstJoinElapsed: null, prevStats: null,
        measurementHistory: [], joinPromise: Promise.resolve(false), lastErrorReason: "browser_context_crashed"
      };
      botContexts.push(botObj);
      continue;
    }
    
    let currentRole = BOT_ROLE;
    
    if (PUBLISHERS_COUNT > -1) {
      currentRole = (i < PUBLISHERS_COUNT) ? "both" : "receiver";
    } else if (BOT_ROLE === "sender" || BOT_ROLE === "receiver") {
      currentRole = (i === 0) ? "both" : BOT_ROLE;
    }
    
    let isScreenShare = false;
    if (ENABLE_SCREEN_SHARE && i === 0) {
      isScreenShare = true;
    }

    const targetUrl = `http://localhost:${PORT}/?room=${encodeURIComponent(ROOM_NAME)}&name=${encodeURIComponent(botName)}&domain=${encodeURIComponent(JITSI_DOMAIN)}&role=${encodeURIComponent(currentRole)}&screenshare=${isScreenShare}&lastn_normal=${LAST_N_NORMAL}&lastn_sharing=${LAST_N_SHARING}&optimize=${UI_OPTIMIZATION}&debug=${DEBUG_STATS}`;
    
    let botObj = {
      page, botId, botName, groupId: groupIndex, uiJoined: false,
      firstJoinElapsed: null, prevStats: null,
      measurementHistory: []
    };
    botContexts.push(botObj);

    // Navigate async
    botObj.joinPromise = page.goto(targetUrl, { timeout: 120000 })
      .then(() => page.waitForSelector("#room-screen.active", { timeout: 120000 }))
      .then(() => {
        if (!shuttingDown) {
          botObj.uiJoined = true;
          botObj.firstJoinElapsed = (Date.now() - startedAt) / 1000;
          console.log(`[+] ${botName} UI joined`);
        }
      })
      .catch(e => {
        if (!shuttingDown) console.log(`[!] ${botName} failed to join: ${e.message}`);
      });

    if (i < CLIENT_COUNT - 1) await delay(RAMP_DELAY_MS);
  }

  // Wait for RAMP_UP to settle
  console.log(`\nWaiting for all bots to finish UI join...`);
  await Promise.all(botContexts.map(b => b.joinPromise));
  const uiJoinedTotal = botContexts.filter(b => b.uiJoined).length;
  console.log(`UI join phase completed: ${uiJoinedTotal}/${CLIENT_COUNT} joined`);

  // WARMUP
  currentPhase = "warmup";
  console.log(`\n[Phase: ${currentPhase}] Warming up for ${WARMUP_SECONDS}s...`);
  await delay(WARMUP_SECONDS * 1000);

  // MEASUREMENT
  if (!shuttingDown) {
    currentPhase = "measurement";
    console.log(`\n[Phase: ${currentPhase}] Starting measurements for ${MEASUREMENT_SECONDS}s at ${effectiveIntervalMs}ms intervals...`);
    
    const intervalSec = effectiveIntervalMs / 1000;
    const maxIterations = Math.floor((MEASUREMENT_SECONDS * 1000) / effectiveIntervalMs);
    let runSummaryAggregates = {
        video_publishers_samples: [],
        audio_publishers_samples: []
    };

    // Initialize first sample epoch aligned
    let nowEpoch = Math.floor(Date.now() / 1000);
    let nextSampleEpoch = Math.floor(nowEpoch / intervalSec + 1) * intervalSec;

    for (let iter = 0; iter < maxIterations; iter++) {
      if (shuttingDown) break;
      
      nowEpoch = Math.floor(Date.now() / 1000);
      let sleepSec = nextSampleEpoch - nowEpoch;
      if (sleepSec > 0) {
        await delay(sleepSec * 1000);
      }

      let collectedEpoch = Math.floor(Date.now() / 1000);
      let sampleTimestampIso = new Date(nextSampleEpoch * 1000).toISOString();
      let collectedTimestampIso = new Date().toISOString();
      let collectionDriftSec = collectedEpoch - nextSampleEpoch;

      const elapsedS = ((Date.now() - startedAt) / 1000).toFixed(2);
      
      let agg = {
        ui_joined: 0, ice_connected: 0, audio_active: 0, video_active: 0,
        tot_audio_pkts_delta: 0, tot_audio_bytes_delta: 0,
        tot_video_pkts_delta: 0, tot_video_bytes_delta: 0, tot_frames_delta: 0,
        with_stats: 0, missing_stats: 0,
        local_video_track_count: 0, outbound_video_report_count: 0, video_report_but_no_frames: 0,
        total_simulcast_layers: 0, total_logical_tracks: 0,
      };

      const promises = botContexts.map(async (bot) => {
        if (!bot.uiJoined) {
          fs.appendFileSync(botMediaTsPath, `${sampleTimestampIso},${nextSampleEpoch},${collectedTimestampIso},${collectedEpoch},${collectionDriftSec},${RUN_ID},${LOAD_GENERATOR_ID},${elapsedS},${currentPhase},${bot.botId},${bot.botName},${bot.groupId},${bot.groupId},${BOT_ROLE},false,unknown,false,false,false,0,0,false,false,,,,,,0,0,0,0,0,0,0,false,0,0,0,0,0,0,false,0,0,0,,,,,,,,,,ui_join_failed\n`);
          return;
        }

        let stats = null;
        try {
          stats = await bot.page.evaluate(() => typeof window.getJitsiBotStats === "function" ? window.getJitsiBotStats() : null);
        } catch(e) {}

        if (!stats) {
          agg.ui_joined++; agg.missing_stats++;
          fs.appendFileSync(botMediaTsPath, `${sampleTimestampIso},${nextSampleEpoch},${collectedTimestampIso},${collectedEpoch},${collectionDriftSec},${RUN_ID},${LOAD_GENERATOR_ID},${elapsedS},${currentPhase},${bot.botId},${bot.botName},${bot.groupId},${bot.groupId},${BOT_ROLE},true,unknown,false,false,false,0,0,false,false,,,,,,0,0,0,0,0,0,0,false,0,0,0,0,0,0,false,0,0,0,,,,,,,,,,stats_unavailable\n`);
          return;
        }
        
        if (DEBUG_STATS && DUMP_RAW_WEBRTC_STATS && iter === 0) {
            console.log(`[DEBUG] ${bot.botName} RAW STATS:`, JSON.stringify(stats.outboundVideoReports));
        }

        agg.ui_joined++;
        agg.with_stats++;

        let prev = bot.prevStats || {};
        let aPktsTot = stats.outboundAudioPackets || 0;
        let aBytesTot = stats.outboundAudioBytes || 0;
        let vPktsTot = stats.outboundVideoPackets || 0;
        let vBytesTot = stats.outboundVideoBytes || 0;
        let fEncTot = stats.framesEncoded || 0;

        let aPktsDelta = prev.outboundAudioPackets != null ? Math.max(0, aPktsTot - prev.outboundAudioPackets) : 0;
        let aBytesDelta = prev.outboundAudioBytes != null ? Math.max(0, aBytesTot - prev.outboundAudioBytes) : 0;
        let vPktsDelta = prev.outboundVideoPackets != null ? Math.max(0, vPktsTot - prev.outboundVideoPackets) : 0;
        let vBytesDelta = prev.outboundVideoBytes != null ? Math.max(0, vBytesTot - prev.outboundVideoBytes) : 0;
        let fEncDelta = prev.framesEncoded != null ? Math.max(0, fEncTot - prev.framesEncoded) : 0;

        bot.prevStats = stats;

        let iceConn = stats.iceState === "connected" || stats.iceState === "completed";
        let audioActive = iceConn && (aPktsDelta > 0 || aBytesDelta > 0);
        let videoActive = iceConn && (fEncDelta > 0 && vPktsDelta > 0);

        if (iceConn) agg.ice_connected++;
        if (audioActive) agg.audio_active++;
        if (videoActive) agg.video_active++;
        
        if (stats.localVideoTrackExists) agg.local_video_track_count++;
        if (stats.outboundVideoReportCount > 0) agg.outbound_video_report_count++;
        if (stats.outboundVideoReportCount > 0 && fEncDelta === 0) agg.video_report_but_no_frames++;
        
        agg.total_simulcast_layers += (stats.simulcastLayers || 0);
        agg.total_logical_tracks += (stats.localVideoTrackCount || 0);

        agg.tot_audio_pkts_delta += aPktsDelta;
        agg.tot_audio_bytes_delta += aBytesDelta;
        agg.tot_video_pkts_delta += vPktsDelta;
        agg.tot_video_bytes_delta += vBytesDelta;
        agg.tot_frames_delta += fEncDelta;

        bot.measurementHistory.push({
            audioActive, videoActive, aPktsDelta, aBytesDelta, vPktsDelta, vBytesDelta, fEncDelta,
            localVideoTrackExists: stats.localVideoTrackExists,
            outboundVideoReportCount: stats.outboundVideoReportCount,
            qualityLimitationReason: stats.qualityLimitationReason
        });

        let qDur = stats.qualityLimitationDurations ? JSON.parse(stats.qualityLimitationDurations) : {};

        let row = [
          sampleTimestampIso, nextSampleEpoch, collectedTimestampIso, collectedEpoch, collectionDriftSec,
          RUN_ID, LOAD_GENERATOR_ID, elapsedS, currentPhase, bot.botId, bot.botName, bot.groupId, bot.groupId, BOT_ROLE,
          true, stats.iceState, iceConn, stats.localAudioTrackExists, stats.localVideoTrackExists, stats.localVideoTrackCount || 0, stats.simulcastLayers || 0, stats.localAudioMuted, stats.localVideoMuted, stats.localAudioReadyState, stats.localVideoReadyState, stats.localAudioEnabled, stats.localVideoEnabled,
          stats.peerConnectionCount, stats.outboundAudioReportCount, stats.outboundVideoReportCount,
          aPktsTot, aPktsDelta, aBytesTot, aBytesDelta, audioActive,
          vPktsTot, vPktsDelta, vBytesTot, vBytesDelta, fEncTot, fEncDelta, videoActive,
          stats.framesPerSecond || 0, stats.frameWidth || 0, stats.frameHeight || 0,
          stats.qualityLimitationReason || "", stats.qualityLimitationResolutionChanges || 0,
          qDur.cpu || 0, qDur.bandwidth || 0, qDur.other || 0,
          stats.encoderImplementation || "", stats.codec || "",
          stats.candidatePairCurrentRoundTripTime || 0, stats.availableOutgoingBitrate || 0, ""
        ].join(",");
        
        fs.appendFileSync(botMediaTsPath, row + "\n");
      });

      await Promise.all(promises);

      // Aggregate
      let aggRow = [
        sampleTimestampIso, nextSampleEpoch, collectedTimestampIso, collectedEpoch, collectionDriftSec,
        RUN_ID, LOAD_GENERATOR_ID, elapsedS, currentPhase, CLIENT_COUNT,
        agg.ui_joined, agg.ice_connected, agg.audio_active, agg.video_active,
        agg.tot_audio_pkts_delta, agg.tot_audio_bytes_delta, agg.tot_video_pkts_delta,
        agg.tot_video_bytes_delta, agg.tot_frames_delta, agg.with_stats, agg.missing_stats,
        agg.local_video_track_count, agg.outbound_video_report_count, agg.video_report_but_no_frames,
        agg.total_logical_tracks, agg.total_simulcast_layers
      ].join(",");
      fs.appendFileSync(aggTsPath, aggRow + "\n");

      runSummaryAggregates.video_publishers_samples.push(agg.video_active);
      runSummaryAggregates.audio_publishers_samples.push(agg.audio_active);

      console.log(`[${currentPhase} Epoch=${nextSampleEpoch}] UI=${agg.ui_joined} ICE=${agg.ice_connected} AudioActive=${agg.audio_active} VideoActive=${agg.video_active} LogicalTracks=${agg.total_logical_tracks} SimulcastLayers=${agg.total_simulcast_layers} OutVideoReports=${agg.outbound_video_report_count} NoFrames=${agg.video_report_but_no_frames} FramesDelta=${agg.tot_frames_delta} MissingStats=${agg.missing_stats}`);

      // Setup for next iteration
      nextSampleEpoch += intervalSec;
    }

    currentPhase = "teardown";
    console.log(`\n[Phase: ${currentPhase}] Writing summaries...`);

    // Write bot summary
    let stableAudioCount = 0;
    let stableVideoCount = 0;
    let uiJoinSuccessCount = 0;

    fs.writeFileSync(botSummaryPath, "run_id,load_generator_id,bot_id,bot_name,group_id,browser_index,role,ui_joined,first_join_elapsed_s,ice_connected_ratio,audio_active_ratio,video_active_ratio,total_audio_packets_delta,total_audio_bytes_delta,total_video_packets_delta,total_video_bytes_delta,total_frames_encoded_delta,stable_audio_publisher,stable_video_publisher,local_video_track_seen,outbound_video_report_seen,quality_limitation_cpu_seen,quality_limitation_bandwidth_seen,failure_reason\n");
    
    botContexts.forEach(bot => {
      if (bot.uiJoined) uiJoinSuccessCount++;
      const hist = bot.measurementHistory;
      let aActRatio = 0, vActRatio = 0, aTotP = 0, aTotB = 0, vTotP = 0, vTotB = 0, fTot = 0;
      let lvSeen = false, ovrSeen = false, qCpuSeen = false, qBwSeen = false;
      if (hist.length > 0) {
        aActRatio = hist.filter(h => h.audioActive).length / hist.length;
        vActRatio = hist.filter(h => h.videoActive).length / hist.length;
        aTotP = hist.reduce((sum, h) => sum + h.aPktsDelta, 0);
        aTotB = hist.reduce((sum, h) => sum + h.aBytesDelta, 0);
        vTotP = hist.reduce((sum, h) => sum + h.vPktsDelta, 0);
        vTotB = hist.reduce((sum, h) => sum + h.vBytesDelta, 0);
        fTot = hist.reduce((sum, h) => sum + h.fEncDelta, 0);
        
        lvSeen = hist.some(h => h.localVideoTrackExists);
        ovrSeen = hist.some(h => h.outboundVideoReportCount > 0);
        qCpuSeen = hist.some(h => h.qualityLimitationReason === "cpu");
        qBwSeen = hist.some(h => h.qualityLimitationReason === "bandwidth");
      }
      
      let stableA = aActRatio >= 0.80;
      let stableV = vActRatio >= 0.80;
      if (stableA) stableAudioCount++;
      if (stableV) stableVideoCount++;

      let failReason = "";
      if (!bot.uiJoined) failReason = "ui_join_failed";
      else if (hist.length === 0) failReason = "stats_unavailable";
      else if (!stableV) {
          if (!lvSeen) failReason = "local_video_track_missing";
          else if (!ovrSeen) failReason = "no_outbound_video_report";
          else if (fTot === 0) failReason = "outbound_video_report_exists_but_no_frames";
          else if (vTotP === 0) failReason = "outbound_video_report_exists_but_no_packet_delta";
          else if (qCpuSeen) failReason = "quality_limitation_cpu";
          else if (qBwSeen) failReason = "quality_limitation_bandwidth";
          else failReason = "unknown_video_inactive";
      }

      fs.appendFileSync(botSummaryPath, `${RUN_ID},${LOAD_GENERATOR_ID},${bot.botId},${bot.botName},${bot.groupId},${bot.groupId},${BOT_ROLE},${bot.uiJoined},${bot.firstJoinElapsed || ""},1,${aActRatio.toFixed(3)},${vActRatio.toFixed(3)},${aTotP},${aTotB},${vTotP},${vTotB},${fTot},${stableA},${stableV},${lvSeen},${ovrSeen},${qCpuSeen},${qBwSeen},${failReason}\n`);
    });

    // Write run_summary.json
    let vsamples = runSummaryAggregates.video_publishers_samples;
    let asamples = runSummaryAggregates.audio_publishers_samples;
    vsamples.sort((a,b) => a-b);
    asamples.sort((a,b) => a-b);
    
    let minV = vsamples.length > 0 ? vsamples[0] : 0;
    let maxV = vsamples.length > 0 ? vsamples[vsamples.length - 1] : 0;
    let medV = vsamples.length > 0 ? vsamples[Math.floor(vsamples.length / 2)] : 0;
    let p95V = vsamples.length > 0 ? vsamples[Math.floor(vsamples.length * 0.95)] : 0;

    let minA = asamples.length > 0 ? asamples[0] : 0;
    let maxA = asamples.length > 0 ? asamples[asamples.length - 1] : 0;
    let medA = asamples.length > 0 ? asamples[Math.floor(asamples.length / 2)] : 0;
    let p95A = asamples.length > 0 ? asamples[Math.floor(asamples.length * 0.95)] : 0;

    let getSecondsGe = (samples, threshold) => samples.filter(v => v >= threshold).length * (effectiveIntervalMs / 1000);
    let getRatioGe = (samples, threshold) => samples.length > 0 ? samples.filter(v => v >= threshold).length / samples.length : 0;

    const clientBottleneck = (uiJoinSuccessCount > 0 && maxV < uiJoinSuccessCount * 0.5);
    const statsParserSuspicion = (uiJoinSuccessCount > 0 && uiJoinSuccessCount === stableAudioCount && stableVideoCount < stableAudioCount);

    const runSummary = {
      run_config: runConfig,
      run_id: RUN_ID,
      load_generator_id: LOAD_GENERATOR_ID,
      started_at: new Date(startedAt).toISOString(),
      ended_at: new Date().toISOString(),
      duration_s: (Date.now() - startedAt) / 1000,
      interrupted: shuttingDown,
      configured_bot_count: CLIENT_COUNT,
      ui_join_success_count: uiJoinSuccessCount,
      ice_connected_count_max: uiJoinSuccessCount, // approx
      stable_audio_publishers: stableAudioCount,
      stable_video_publishers: stableVideoCount,
      max_concurrent_audio_publishers: maxA,
      max_concurrent_video_publishers: maxV,
      median_concurrent_audio_publishers: medA,
      median_concurrent_video_publishers: medV,
      p95_concurrent_audio_publishers: p95A,
      p95_concurrent_video_publishers: p95V,
      min_concurrent_audio_publishers_during_measurement: minA,
      min_concurrent_video_publishers_during_measurement: minV,
      seconds_video_publishers_ge_3: getSecondsGe(vsamples, 3),
      seconds_video_publishers_ge_4: getSecondsGe(vsamples, 4),
      seconds_video_publishers_ge_5: getSecondsGe(vsamples, 5),
      seconds_video_publishers_ge_6: getSecondsGe(vsamples, 6),
      seconds_video_publishers_ge_40: getSecondsGe(vsamples, 40),
      seconds_video_publishers_ge_45: getSecondsGe(vsamples, 45),
      seconds_video_publishers_ge_48: getSecondsGe(vsamples, 48),
      seconds_video_publishers_ge_50: getSecondsGe(vsamples, 50),
      ratio_video_publishers_ge_3: getRatioGe(vsamples, 3),
      ratio_video_publishers_ge_4: getRatioGe(vsamples, 4),
      ratio_video_publishers_ge_5: getRatioGe(vsamples, 5),
      ratio_video_publishers_ge_6: getRatioGe(vsamples, 6),
      ratio_video_publishers_ge_40: getRatioGe(vsamples, 40),
      ratio_video_publishers_ge_45: getRatioGe(vsamples, 45),
      ratio_video_publishers_ge_48: getRatioGe(vsamples, 48),
      ratio_video_publishers_ge_50: getRatioGe(vsamples, 50),
      client_side_bottleneck_warning: clientBottleneck,
      stats_parser_suspicion_warning: statsParserSuspicion
    };
    fs.writeFileSync(runSummaryPath, JSON.stringify(runSummary, null, 2));

    currentPhase = "completed";
  }

  await doCleanup();
}

app.listen(PORT, () => {
  console.log(`🌐 Express Server started on port ${PORT}`);
  if (SERVER_ONLY) {
    console.log(`[INFO] SERVER_ONLY mode is ON. No load test bots will be launched. Serving on http://localhost:${PORT}`);
  } else {
    runBenchmark().catch(console.error);
  }
});

// --- GRACEFUL SHUTDOWN ---
async function doCleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (currentPhase !== "completed") currentPhase = "interrupted";
  console.log(`\n[Phase: teardown] Performing cleanup...`);

  for (const bot of botContexts) {
    if (bot.page && !bot.page.isClosed()) {
      try { await bot.page.evaluate(() => { if (typeof window.cleanupRoom === "function") window.cleanupRoom(); }); } catch(e) {}
    }
  }

  await delay(TEARDOWN_DELAY_SECONDS * 1000);

  console.log(`Closing browsers...`);
  for (const b of browsers) {
    try { await b.close(); } catch(e) {}
  }
  console.log(`✅ Cleanup complete. Exiting.`);
  process.exit(0);
}

process.on("SIGINT", doCleanup);
process.on("SIGTERM", doCleanup);
