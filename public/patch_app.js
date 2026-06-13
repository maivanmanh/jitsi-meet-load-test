window.botStats = {
  botName: "",
  role: "",
  room: "",
  domain: "",
  joined: false,
  joinState: "",
  iceState: "unknown",
  connectionState: "unknown",
  localAudioTrackExists: false,
  localVideoTrackExists: false,
  localAudioMuted: null,
  localVideoMuted: null,
  localAudioReadyState: null,
  localVideoReadyState: null,
  localAudioEnabled: null,
  localVideoEnabled: null,
  outboundAudioPackets: null,
  outboundAudioBytes: null,
  outboundVideoPackets: null,
  outboundVideoBytes: null,
  framesEncoded: null,
  framesPerSecond: null,
  frameWidth: null,
  frameHeight: null,
  qualityLimitationReason: null,
  qualityLimitationResolutionChanges: null,
  qualityLimitationDurations: null,
  encoderImplementation: null,
  codec: null,
  candidatePairCurrentRoundTripTime: null,
  availableOutgoingBitrate: null,
  peerConnectionCount: 0,
  outboundAudioReportCount: 0,
  outboundVideoReportCount: 0,
  outboundVideoReports: [],
  timestamp: null,
};

window.getJitsiBotStats = async function() {
  const ts = new Date().toISOString();
  window.botStats.timestamp = ts;

  const roomScreenObj = document.getElementById("room-screen");
  window.botStats.joined = roomScreenObj ? roomScreenObj.classList.contains("active") : false;
  window.botStats.room = document.getElementById("current-room")?.textContent || document.getElementById("room-name")?.value;
  window.botStats.botName = document.getElementById("display-name")?.value || "Bot";
  window.botStats.role = typeof currentRole !== "undefined" ? currentRole : "unknown";
  window.botStats.domain = typeof JITSI_DOMAIN !== "undefined" ? JITSI_DOMAIN : "";

  const audioTrack = (typeof localTracks !== "undefined" ? localTracks : []).find(t => t.getType() === "audio");
  const videoTrack = (typeof localTracks !== "undefined" ? localTracks : []).find(t => t.getType() === "video");
  
  window.botStats.localAudioTrackExists = !!audioTrack;
  window.botStats.localVideoTrackExists = !!videoTrack;
  window.botStats.localAudioMuted = audioTrack ? audioTrack.isMuted() : null;
  window.botStats.localVideoMuted = videoTrack ? videoTrack.isMuted() : null;

  try {
      const nativeA = audioTrack ? audioTrack.track : null;
      window.botStats.localAudioReadyState = nativeA ? nativeA.readyState : null;
      window.botStats.localAudioEnabled = nativeA ? nativeA.enabled : null;
  } catch(e) { window.botStats.localAudioReadyState = null; window.botStats.localAudioEnabled = null; }
  
  try {
      const nativeV = videoTrack ? videoTrack.track : null;
      window.botStats.localVideoReadyState = nativeV ? nativeV.readyState : null;
      window.botStats.localVideoEnabled = nativeV ? nativeV.enabled : null;
  } catch(e) { window.botStats.localVideoReadyState = null; window.botStats.localVideoEnabled = null; }

  let iceState = "unknown";
  let connectionState = "unknown";
  let outAudioPkts = 0;
  let outAudioBytes = 0;
  let outVideoPkts = 0;
  let outVideoBytes = 0;
  let framesEnc = 0;
  
  let maxFps = null;
  let maxW = null;
  let maxH = null;
  let qLimReason = null;
  let qLimResChanges = null;
  let qLimDur = null;
  let encoderImpl = null;
  let codecId = null;
  
  let candidateRtt = null;
  let availableBitrate = null;
  
  let pcCount = 0;
  let audioReportCount = 0;
  let videoReportCount = 0;
  
  const outboundVideoReports = [];

  if (typeof activePeerConnections !== "undefined") {
    const activePcs = activePeerConnections.filter(pc => pc.signalingState !== "closed");
    pcCount = activePcs.length;
    
    if (activePcs.length > 0) {
       iceState = activePcs[activePcs.length - 1].iceConnectionState;
       connectionState = activePcs[activePcs.length - 1].connectionState;
    }

    for (const pc of activePcs) {
      try {
        const stats = await pc.getStats();
        stats.forEach(report => {
          if (report.type === "outbound-rtp") {
            if (report.kind === "audio" || report.mediaType === "audio") {
              outAudioPkts += report.packetsSent || 0;
              outAudioBytes += report.bytesSent || 0;
              audioReportCount++;
            } else if (report.kind === "video" || report.mediaType === "video") {
              videoReportCount++;
              outVideoPkts += report.packetsSent || 0;
              outVideoBytes += report.bytesSent || 0;
              framesEnc += report.framesEncoded || 0;
              
              if (report.framesPerSecond !== undefined) maxFps = report.framesPerSecond;
              if (report.frameWidth !== undefined) maxW = report.frameWidth;
              if (report.frameHeight !== undefined) maxH = report.frameHeight;
              if (report.qualityLimitationReason !== undefined) qLimReason = report.qualityLimitationReason;
              if (report.qualityLimitationResolutionChanges !== undefined) qLimResChanges = report.qualityLimitationResolutionChanges;
              if (report.qualityLimitationDurations !== undefined) qLimDur = JSON.stringify(report.qualityLimitationDurations);
              if (report.encoderImplementation !== undefined) encoderImpl = report.encoderImplementation;
              if (report.codecId !== undefined) codecId = report.codecId;
              
              outboundVideoReports.push({
                  id: report.id, ssrc: report.ssrc, mid: report.mid, rid: report.rid, kind: report.kind,
                  mediaType: report.mediaType, packetsSent: report.packetsSent, bytesSent: report.bytesSent,
                  framesEncoded: report.framesEncoded, framesPerSecond: report.framesPerSecond,
                  frameWidth: report.frameWidth, frameHeight: report.frameHeight,
                  qualityLimitationReason: report.qualityLimitationReason,
                  encoderImplementation: report.encoderImplementation, codecId: report.codecId
              });
            }
          }
          if (report.type === "candidate-pair" && report.state === "succeeded") {
              candidateRtt = report.currentRoundTripTime ?? candidateRtt;
              availableBitrate = report.availableOutgoingBitrate ?? availableBitrate;
          }
        });
      } catch(e) {}
    }
  }

  window.botStats.iceState = iceState;
  window.botStats.connectionState = connectionState;
  window.botStats.outboundAudioPackets = audioReportCount > 0 ? outAudioPkts : null;
  window.botStats.outboundAudioBytes = audioReportCount > 0 ? outAudioBytes : null;
  window.botStats.outboundVideoPackets = videoReportCount > 0 ? outVideoPkts : null;
  window.botStats.outboundVideoBytes = videoReportCount > 0 ? outVideoBytes : null;
  window.botStats.framesEncoded = videoReportCount > 0 ? framesEnc : null;
  
  window.botStats.framesPerSecond = maxFps;
  window.botStats.frameWidth = maxW;
  window.botStats.frameHeight = maxH;
  window.botStats.qualityLimitationReason = qLimReason;
  window.botStats.qualityLimitationResolutionChanges = qLimResChanges;
  window.botStats.qualityLimitationDurations = qLimDur;
  window.botStats.encoderImplementation = encoderImpl;
  window.botStats.codec = codecId;
  
  window.botStats.candidatePairCurrentRoundTripTime = candidateRtt;
  window.botStats.availableOutgoingBitrate = availableBitrate;
  
  window.botStats.peerConnectionCount = pcCount;
  window.botStats.outboundAudioReportCount = audioReportCount;
  window.botStats.outboundVideoReportCount = videoReportCount;
  window.botStats.outboundVideoReports = outboundVideoReports;
  
  // Update DOM Attributes
  document.body.setAttribute('data-joined', window.botStats.joined);
  document.body.setAttribute('data-ice-state', window.botStats.iceState);
  document.body.setAttribute('data-audio-packets', window.botStats.outboundAudioPackets ?? "");
  document.body.setAttribute('data-video-packets', window.botStats.outboundVideoPackets ?? "");
  document.body.setAttribute('data-frames-encoded', window.botStats.framesEncoded ?? "");
  document.body.setAttribute('data-local-video-exists', window.botStats.localVideoTrackExists);
  document.body.setAttribute('data-local-video-muted', window.botStats.localVideoMuted ?? "");
  document.body.setAttribute('data-local-video-ready-state', window.botStats.localVideoReadyState ?? "");
  document.body.setAttribute('data-local-video-enabled', window.botStats.localVideoEnabled ?? "");
  document.body.setAttribute('data-outbound-video-report-count', window.botStats.outboundVideoReportCount);

  // Debug Box
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("debug") === "true") {
    const dbg = document.getElementById("debug-box");
    const content = document.getElementById("debug-content");
    if (dbg && content) {
      dbg.style.display = "block";
      content.innerHTML = `
        Bot: ${window.botStats.botName} | Role: ${window.botStats.role}<br>
        Joined: ${window.botStats.joined} | ICE: ${window.botStats.iceState}<br>
        VideoTrack: Exists=${window.botStats.localVideoTrackExists} Mute=${window.botStats.localVideoMuted} Ready=${window.botStats.localVideoReadyState} En=${window.botStats.localVideoEnabled}<br>
        Audio Pkts: ${window.botStats.outboundAudioPackets ?? 0}<br>
        Video Pkts: ${window.botStats.outboundVideoPackets ?? 0}<br>
        Frames Enc: ${window.botStats.framesEncoded ?? 0}<br>
        V.Reports: ${window.botStats.outboundVideoReportCount}<br>
        Update: ${window.botStats.timestamp.split('T')[1]}
      `;
    }
  }

  return window.botStats;
};

setInterval(() => {
  window.getJitsiBotStats();
}, 2000);
