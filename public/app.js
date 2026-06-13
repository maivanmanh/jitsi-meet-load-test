// ==========================================
// THỦ THUẬT INTERCEPT WEB RTC PEER CONNECTION
// Dùng để lấy thông tin thống kê thực tế (Stats)
// ==========================================
const activePeerConnections = [];
const OrigPeerConnection = window.RTCPeerConnection;
window.RTCPeerConnection = function(...args) {
  const pc = new OrigPeerConnection(...args);
  activePeerConnections.push(pc);
  
  pc.addEventListener('iceconnectionstatechange', () => {
    document.body.setAttribute('data-ice-state', pc.iceConnectionState);
  });
  
  return pc;
};

let JITSI_DOMAIN = "";

let connection = null;
let room = null;
let localTracks = [];
let participants = {};
let myUserId = null;
let currentRole = "sender";

const roleSelect = document.getElementById("role-select");
const videoGrid = document.getElementById("video-grid");
const roleBadge = document.getElementById("role-badge");
const joinScreen = document.getElementById("join-screen");
const roomScreen = document.getElementById("room-screen");
const joinBtn = document.getElementById("join-btn");
const leaveBtn = document.getElementById("leave-btn");
const domainInput = document.getElementById("domain-name");
const roomNameInput = document.getElementById("room-name");
const displayNameInput = document.getElementById("display-name");
const statusMsg = document.getElementById("status-msg");
const currentRoomSpan = document.getElementById("current-room");
const userCountVal = document.getElementById("user-count-val");
const participantsList = document.getElementById("participants-list");

let isJitsiLoaded = false;
let lastNNormal = 9;
let lastNSharing = 3;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// Hỗ trợ Load Test tự động qua URL
window.addEventListener("DOMContentLoaded", async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get("room");
  const nameParam = urlParams.get("name");
  const domainParam = urlParams.get("domain");
  const roleParam = urlParams.get("role");

  if (domainParam) {
    JITSI_DOMAIN = domainParam;
  }
  if (roleParam) {
    roleSelect.value = roleParam;
  }

  // Luôn điền giá trị từ JS (có thể là mặc định hoặc từ URL) vào giao diện
  domainInput.value = JITSI_DOMAIN;
  if (roomParam) roomNameInput.value = roomParam;
  if (nameParam) displayNameInput.value = nameParam;

  // Nếu Playwright truyền đủ domain, room và name, tự động kết nối luôn
  if (roomParam && nameParam) {
    joinBtn.click();
  }
});

let isJitsiInitialized = false;
function initJitsi() {
  if (isJitsiInitialized) return;
  JitsiMeetJS.init({ disableAudioLevels: true }); // Tắt luôn bộ đo decibel cho nhẹ
  JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.ERROR);
  isJitsiInitialized = true;
}

function connect(roomName, displayName) {
  statusMsg.textContent = "Đang kết nối tới máy chủ...";

  let serviceUrl = config.websocket || config.bosh;
  serviceUrl += (serviceUrl.includes("?") ? "&" : "?") + "room=" + roomName;

  const options = {
    ...config,
    p2p: { enabled: false }, // Luôn tắt P2P
    hosts: config.hosts,
    serviceUrl: serviceUrl,
    clientNode: "http://jitsi.org/jitsimeet",
  };

  connection = new JitsiMeetJS.JitsiConnection(null, null, options);
  connection.addEventListener(
    JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,
    () => {
      onConnectionSuccess(roomName, displayName);
    },
  );
  connection.addEventListener(
    JitsiMeetJS.events.connection.CONNECTION_FAILED,
    onConnectionFailed,
  );
  connection.addEventListener(
    JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED,
    onDisconnect,
  );
  connection.connect();
}

function onConnectionSuccess(roomName, displayName) {
  statusMsg.textContent = "Kết nối thành công. Đang vào phòng...";

  const confOptions = Object.assign({}, config, {
    openBridgeChannel: true,
    p2p: { enabled: false },
  });

  room = connection.initJitsiConference(roomName, confOptions);
  room.setDisplayName(displayName);

  room.on(JitsiMeetJS.events.conference.CONFERENCE_JOINED, onConferenceJoined);
  room.on(JitsiMeetJS.events.conference.USER_JOINED, onUserJoined);
  room.on(JitsiMeetJS.events.conference.USER_LEFT, onUserLeft);
  room.on(JitsiMeetJS.events.conference.TRACK_ADDED, onRemoteTrackAdded);
  room.on(JitsiMeetJS.events.conference.TRACK_REMOVED, onRemoteTrackRemoved);

  room.join();
}

function onConnectionFailed() {
  statusMsg.textContent = "Lỗi: Không thể kết nối tới máy chủ!";
  joinBtn.disabled = false;
  joinBtn.textContent = "Vào phòng ngay";
}

function onDisconnect() {
  cleanupRoom();
  showScreen("join");
}

function onConferenceJoined() {
  myUserId = room.myUserId();

  participants[myUserId] = displayNameInput.value || "LoadTest-Bot";
  updateParticipantsList();

  currentRoomSpan.textContent = roomNameInput.value;
  showScreen("room");

  const urlParams = new URLSearchParams(window.location.search);
  const isScreenShare = urlParams.get("screenshare") === "true";
  const lastNNormalStr = urlParams.get("lastn_normal");
  if (lastNNormalStr) {
    const parsedLastNNormal = parseInt(lastNNormalStr, 10);
    if (!isNaN(parsedLastNNormal)) {
      lastNNormal = (parsedLastNNormal === 0) ? -1 : parsedLastNNormal;
    }
  }

  const lastNSharingStr = urlParams.get("lastn_sharing");
  if (lastNSharingStr) {
    const parsedLastNSharing = parseInt(lastNSharingStr, 10);
    if (!isNaN(parsedLastNSharing)) {
      lastNSharing = (parsedLastNSharing === 0) ? -1 : parsedLastNSharing;
    }
  }

  // --- HÀM CẬP NHẬT LASTN ĐỘNG ---
  let currentLastNVal = null; // Theo dõi LastN hiện tại để không gửi lệnh API thừa
  window.applyLastNConstraint = function(forceValue) {
    if (currentRole === "sender") return; // Sender luôn từ chối video từ đầu

    const newLastN = forceValue !== undefined ? forceValue : lastNNormal;
    if (currentLastNVal !== newLastN) {
      currentLastNVal = newLastN;
      try {
        room.setReceiverConstraints({
          lastN: currentLastNVal !== -1 ? currentLastNVal : undefined,
        });
        console.log(`[Dynamic LastN] Switched to ${currentLastNVal}`);
      } catch (e) {
        console.warn("[Dynamic LastN] Failed to update constraints:", e);
      }
    }
  };

  if (currentRole === "sender") {
    roleBadge.textContent = "Đang gửi (Bot)";
    roleBadge.className = "badge green";
    videoGrid.style.display = "none";
    
    room.setReceiverConstraints({
      lastN: 0,
      selectedEndpoints: [],
      onStageEndpoints: []
    });
    
    // Ép Jitsi Bridge nhận diện luồng Video của client này
    try { room.setSenderVideoConstraint(720); } catch(e) {}

    JitsiMeetJS.createLocalTracks({ devices: ["audio", "video"] })
      .then(async (tracks) => {
        localTracks = tracks;
        console.log(`[Sender] Created ${tracks.length} local tracks.`);
        for (const track of tracks) {
          try {
            await room.addTrack(track);
            forceAttachToHiddenElement(track);
          } catch(e) {
            console.error("Lỗi addTrack (audio/video):", e);
          }
        }
        console.log("Đã phát Audio/Video cục bộ lên phòng.");

        if (isScreenShare) {
          try {
            const desktopTracks = await JitsiMeetJS.createLocalTracks({ devices: ["desktop"] });
            for (const dt of desktopTracks) {
              localTracks.push(dt);
              try {
                await room.addTrack(dt);
                forceAttachToHiddenElement(dt);
              } catch(e) {
                console.error("Lỗi addTrack (desktop):", e);
              }
            }
            console.log("Đã phát thêm Screen Share track.");
          } catch(e) {
            console.warn("Lỗi tạo desktop track:", e);
          }
        }
      })
      .catch((error) => console.warn("Lỗi lấy thiết bị Webcam/Mic:", error));
  } else if (currentRole === "receiver") {
    roleBadge.textContent = "Chỉ nhận (Khán giả)";
    roleBadge.className = "badge blue";
    videoGrid.style.display = "grid";
    
    window.applyLastNConstraint(lastNNormal);
  } else if (currentRole === "both") {
    roleBadge.textContent = "Gửi và Nhận (Tiêu chuẩn)";
    roleBadge.className = "badge green pulse";
    videoGrid.style.display = "grid";
    
    window.applyLastNConstraint(lastNNormal);
    
    try { room.setSenderVideoConstraint(720); } catch(e) {}

    JitsiMeetJS.createLocalTracks({ devices: ["audio", "video"] })
      .then(async (tracks) => {
        localTracks = tracks;
        console.log(`[Both] Created ${tracks.length} local tracks.`);
        for (const track of tracks) {
          try {
            await room.addTrack(track);
            forceAttachToHiddenElement(track);
          } catch(e) {
            console.error("Lỗi addTrack (both audio/video):", e);
          }
        }
        console.log("Đã phát Audio/Video cục bộ.");

        if (isScreenShare) {
          try {
            const desktopTracks = await JitsiMeetJS.createLocalTracks({ devices: ["desktop"] });
            for (const dt of desktopTracks) {
              localTracks.push(dt);
              try {
                await room.addTrack(dt);
                forceAttachToHiddenElement(dt);
              } catch(e) {
                console.error("Lỗi addTrack (both desktop):", e);
              }
            }
            console.log("Đã phát thêm Screen Share track.");
          } catch(e) {
            console.warn("Lỗi tạo desktop track:", e);
          }
        }
      })
      .catch((error) => console.warn("Lỗi lấy thiết bị Webcam/Mic:", error));
  }
}

function forceAttachToHiddenElement(track) {
  try {
    if (track.getType() === "video") {
      const video = document.createElement("video");
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.style.position = "fixed";
      video.style.top = "-2000px";
      video.style.left = "-2000px";
      video.style.width = "320px";
      video.style.height = "240px";
      document.body.appendChild(video);
      track.attach(video);
    } else if (track.getType() === "audio") {
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.muted = true;
      audio.style.display = "none";
      document.body.appendChild(audio);
      track.attach(audio);
    }
  } catch(e) {
    console.error("Lỗi attach hidden:", e);
  }
}

function onRemoteTrackAdded(track) {
  if (track.isLocal()) return;
  if (currentRole === "sender") return; // Sender không hiển thị video
  
  const participantId = track.getParticipantId();
  
  if (track.getType() === "video") {
    addVideoToGrid(track, participantId, participants[participantId] || "Thành viên");
  } else if (track.getType() === "audio") {
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.id = `audio-${participantId}-${track.getId()}`;
    document.body.appendChild(audio);
    track.attach(audio);
  }
}

function onRemoteTrackRemoved(track) {
  if (track.isLocal()) return;
  const participantId = track.getParticipantId();
  const trackId = track.getId() || "track";
  
  if (track.getType() === "video") {
    removeVideoFromGrid(track, participantId, trackId);
  } else if (track.getType() === "audio") {
    track.detach();
    const audio = document.getElementById(`audio-${participantId}-${track.getId()}`);
    if (audio) audio.remove();
  }
}

function addVideoToGrid(track, participantId, displayName) {
  const trackId = track.getId() || "track";
  const videoType = track.videoType || "camera";
  
  let videoContainer = document.getElementById(`video-container-${participantId}-${trackId}`);
  if (!videoContainer) {
    videoContainer = document.createElement("div");
    videoContainer.className = "video-container";
    videoContainer.id = `video-container-${participantId}-${trackId}`;
    videoContainer.dataset.videoType = videoType;
    
    const video = document.createElement("video");
    video.autoplay = true;
    video.id = `video-${participantId}-${trackId}`;
    
    // Nếu là luồng của chính mình, lật gương (mirror)
    if (track.isLocal()) {
      video.style.transform = "scaleX(-1)";
      video.muted = true; // Chống tiếng vọng
    }
    
    videoContainer.appendChild(video);
    
    const badge = document.createElement("div");
    badge.className = "video-name-badge";
    badge.textContent = displayName;
    badge.id = `badge-video-${participantId}`;
    videoContainer.appendChild(badge);
    
    // Ẩn mặc định, chỉ hiện khi video thực sự có luồng dữ liệu (loadeddata)
    videoContainer.style.display = "none";
    
    video.addEventListener("loadeddata", () => {
      videoContainer.style.display = "block";
      adjustGridLayout();
    });
    
    video.addEventListener("playing", () => {
      videoContainer.style.display = "block";
      adjustGridLayout();
    });

    videoGrid.appendChild(videoContainer);
    adjustGridLayout();

    // Lắng nghe sự kiện mute của Jitsi và Native WebRTC
    const handleMuteState = () => {
      const isMuted = track.isMuted() || (track.track && track.track.muted);
      // Nếu bị mute thì ẩn, nếu không mute thì phải chờ loadeddata/playing mới hiện (nếu chưa có data)
      if (isMuted) {
        videoContainer.style.display = "none";
        adjustGridLayout();
      }
    };

    track.on(JitsiMeetJS.events.track.TRACK_MUTE_CHANGED, handleMuteState);
    if (track.track) {
      track.track.onmute = handleMuteState;
      // Không cần onunmute hiện ngay vì ta sẽ chờ sự kiện 'playing' của thẻ <video>
    }
  }
  track.attach(videoContainer.querySelector("video"));
}

function removeVideoFromGrid(track, participantId, trackId) {
  track.detach();
  const container = document.getElementById(`video-container-${participantId}-${trackId}`);
  if (container) {
    container.remove();
    adjustGridLayout();
  }
}

function adjustGridLayout() {
  const allContainers = Array.from(videoGrid.querySelectorAll('.video-container')).filter(c => c.style.display !== "none");
  const count = allContainers.length;
  if (count === 0) {
    return;
  }
  
  const desktopContainers = allContainers.filter(c => c.dataset.videoType === "desktop");
  
  try {
    if (desktopContainers.length > 0) {
      // Kích hoạt Sharing LastN
      if (typeof window.applyLastNConstraint === "function") {
        window.applyLastNConstraint(lastNSharing);
      }
    } else {
      // Kích hoạt lại Normal LastN
      if (typeof window.applyLastNConstraint === "function") {
        window.applyLastNConstraint(lastNNormal);
      }
    }
  } catch (err) {
    console.error("LastN Error:", err);
  }

  // --- GIAO DIỆN LƯỚI BÌNH THƯỜNG (CỨNG NHẮC ĐỂ FULL MÀN HÌNH) ---
  let cols = Math.ceil(Math.sqrt(count));
  let rows = Math.ceil(count / cols);
  
  videoGrid.style.display = "grid";
  videoGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  videoGrid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  
  allContainers.forEach(c => {
    c.style.gridColumn = "";
    c.style.gridRow = "";
  });
}

function onUserJoined(id, user) {
  const name = user.getDisplayName() || "Người dùng ẩn danh";
  participants[id] = name;
  updateParticipantsList();
  
  const badge = document.getElementById(`badge-${id}`);
  if (badge) badge.textContent = name;
  
  const videoBadge = document.getElementById(`badge-video-${id}`);
  if (videoBadge) videoBadge.textContent = name;
}

function onUserLeft(id) {
  delete participants[id];
  updateParticipantsList();
}

function updateParticipantsList() {
  participantsList.innerHTML = "";
  const ids = Object.keys(participants);
  userCountVal.textContent = ids.length;

  ids.forEach((id) => {
    const name = participants[id];
    const isMe = id === myUserId;

    const li = document.createElement("li");
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = name.charAt(0).toUpperCase();

    const details = document.createElement("div");
    details.className = "user-details";

    const nameSpan = document.createElement("span");
    nameSpan.className = "user-name";
    nameSpan.textContent = name;
    if (isMe) {
      const badge = document.createElement("span");
      badge.className = "you-badge";
      badge.textContent = "Bạn";
      nameSpan.appendChild(badge);
    }

    const roleSpan = document.createElement("span");
    roleSpan.className = "user-role";
    roleSpan.textContent = isMe ? "Bot giả lập" : "Thành viên";

    details.appendChild(nameSpan);
    details.appendChild(roleSpan);

    li.appendChild(avatar);
    li.appendChild(details);
    participantsList.appendChild(li);
  });
}

function showScreen(screenId) {
  joinScreen.classList.remove("active");
  roomScreen.classList.remove("active");

  if (screenId === "join") {
    joinScreen.classList.add("active");
    statusMsg.textContent = "";
    joinBtn.disabled = false;
    joinBtn.textContent = "Vào phòng ngay";
  } else {
    roomScreen.classList.add("active");
  }
}

async function cleanupRoom() {
  if (room) {
    try {
      await room.leave();
    } catch (e) {
      console.warn(e);
    }
    room = null;
  }
  if (connection) {
    try {
      await connection.disconnect();
    } catch (e) {
      console.warn(e);
    }
    connection = null;
  }
  if (localTracks.length > 0) {
    localTracks.forEach((track) => track.dispose());
    localTracks = [];
  }
  participants = {};
  myUserId = null;
  videoGrid.innerHTML = "";
  videoGrid.style.display = "none";
}

joinBtn.addEventListener("click", async () => {
  const domainVal = domainInput.value.trim();
  const rName = roomNameInput.value.trim();
  const dName = displayNameInput.value.trim();
  currentRole = roleSelect.value;

  if (!domainVal) {
    statusMsg.textContent = "Vui lòng nhập Jitsi Domain / IP!";
    return;
  }
  if (!rName) {
    statusMsg.textContent = "Vui lòng nhập tên phòng!";
    return;
  }

  JITSI_DOMAIN = domainVal;

  joinBtn.disabled = true;
  statusMsg.textContent = `Đang tải Jitsi từ ${JITSI_DOMAIN}...`;

  try {
    if (!isJitsiLoaded) {
      await loadScript(`https://${JITSI_DOMAIN}/libs/lib-jitsi-meet.min.js`);
      await loadScript(`https://${JITSI_DOMAIN}/config.js`);
      isJitsiLoaded = true;
    }

    statusMsg.textContent = "Đang khởi tạo Jitsi...";
    initJitsi(); // BẮT BUỘC KHỞI TẠO

    statusMsg.textContent = "Đang kết nối...";
    connect(rName, dName || "Khách");
  } catch (err) {
    console.error("Lỗi tải Jitsi scripts:", err);
    statusMsg.textContent =
      "Không thể tải Script! Kiểm tra lại Domain/IP hoặc chứng chỉ (gõ thisisunsafe ở thẻ mới).";
    joinBtn.disabled = false;
  }
});

leaveBtn.addEventListener("click", async () => {
  leaveBtn.disabled = true;
  leaveBtn.textContent = "Đang thoát...";
  await cleanupRoom(); // Chờ ngắt kết nối an toàn

  window.close(); // Yêu cầu đóng tab hiện tại

  // Đề phòng trường hợp browser chặn window.close()
  setTimeout(() => {
    statusMsg.textContent = "Đã rời phòng an toàn. Bạn có thể tự đóng Tab này.";
    showScreen("join");
  }, 300);
});

window.addEventListener("beforeunload", () => {
  cleanupRoom();
});
// ==========================================
// THỐNG KÊ WEBRTC & PLAYWRIGHT INTERFACE
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

  const audioTracks = (typeof localTracks !== "undefined" ? localTracks : []).filter(t => t.getType() === "audio");
  const videoTracks = (typeof localTracks !== "undefined" ? localTracks : []).filter(t => t.getType() === "video");
  
  window.botStats.localAudioTrackExists = audioTracks.length > 0;
  window.botStats.localVideoTrackExists = videoTracks.length > 0;
  window.botStats.localVideoTrackCount = videoTracks.length;
  window.botStats.localAudioMuted = audioTracks[0] ? audioTracks[0].isMuted() : null;
  window.botStats.localVideoMuted = videoTracks[0] ? videoTracks[0].isMuted() : null;

  try {
      const nativeA = audioTracks[0] ? audioTracks[0].track : null;
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
  window.botStats.simulcastLayers = videoReportCount;
  
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
