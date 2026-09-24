/* global io */
const socket = io();

const $ = (id) => document.getElementById(id);
const welcome = $("welcome");
const call = $("call");
const videos = $("videos");
const localVideo = $("local-video");

const RTC_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

let localStream = null;
let roomName = null;
let muted = false;
let cameraOff = false;
const peers = new Map(); // socketId -> RTCPeerConnection

// ---------- Media ----------
async function getMedia(deviceId) {
  const constraints = {
    audio: true,
    video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" },
  };
  try {
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    console.warn("Camera unavailable, joining without media:", err.message);
    localStream = new MediaStream();
  }
  localVideo.srcObject = localStream;
  if (!deviceId) await listCameras();
}

async function listCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const current = localStream.getVideoTracks()[0];
  $("camera-select").innerHTML = devices
    .filter((d) => d.kind === "videoinput")
    .map((d) => `<option value="${d.deviceId}" ${current && current.label === d.label ? "selected" : ""}>${d.label || "Camera"}</option>`)
    .join("");
}

$("mute-btn").onclick = () => {
  muted = !muted;
  localStream.getAudioTracks().forEach((t) => (t.enabled = !muted));
  $("mute-btn").textContent = muted ? "Unmute" : "Mute";
};

$("camera-btn").onclick = () => {
  cameraOff = !cameraOff;
  localStream.getVideoTracks().forEach((t) => (t.enabled = !cameraOff));
  $("camera-btn").textContent = cameraOff ? "Camera on" : "Camera off";
};

$("camera-select").onchange = async (e) => {
  await getMedia(e.target.value);
  const newTrack = localStream.getVideoTracks()[0];
  // Swap the video track on every live connection without renegotiation
  peers.forEach((pc) => {
    const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
    if (sender && newTrack) sender.replaceTrack(newTrack);
  });
};

// ---------- Peer connections ----------
function createPeer(peerId, nickname) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit("ice", { to: peerId, payload: candidate });
  };
  pc.ontrack = ({ streams }) => addRemoteVideo(peerId, nickname, streams[0]);
  pc.onconnectionstatechange = () => {
    if (["failed", "closed"].includes(pc.connectionState)) removePeer(peerId);
  };

  peers.set(peerId, pc);
  return pc;
}

function addRemoteVideo(peerId, nickname, stream) {
  let tile = document.getElementById(`tile-${peerId}`);
  if (!tile) {
    tile = document.createElement("figure");
    tile.className = "tile";
    tile.id = `tile-${peerId}`;
    tile.innerHTML = `<video autoplay playsinline></video><figcaption></figcaption>`;
    tile.querySelector("figcaption").textContent = nickname || "Guest";
    videos.appendChild(tile);
  }
  tile.querySelector("video").srcObject = stream;
}

function removePeer(peerId) {
  const pc = peers.get(peerId);
  if (pc) pc.close();
  peers.delete(peerId);
  const tile = document.getElementById(`tile-${peerId}`);
  if (tile) tile.remove();
}

// ---------- Signaling ----------
socket.on("peer_joined", ({ id, nickname }) => {
  // The newcomer sends the offer; we just prepare a connection for them.
  createPeer(id, nickname);
  addChat("system", `${nickname} joined`);
});

socket.on("offer", async ({ from, nickname, payload }) => {
  const pc = peers.get(from) || createPeer(from, nickname);
  await pc.setRemoteDescription(payload);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("answer", { to: from, payload: answer });
});

socket.on("answer", async ({ from, payload }) => {
  const pc = peers.get(from);
  if (pc) await pc.setRemoteDescription(payload);
});

socket.on("ice", async ({ from, payload }) => {
  const pc = peers.get(from);
  if (pc) await pc.addIceCandidate(payload).catch(console.error);
});

socket.on("peer_left", ({ id }) => removePeer(id));

socket.on("room_change", renderRooms);

// ---------- Chat ----------
function addChat(from, message) {
  const li = document.createElement("li");
  li.textContent = `${from}: ${message}`;
  $("messages").appendChild(li);
  $("messages").scrollTop = $("messages").scrollHeight;
}
socket.on("chat", ({ from, message }) => addChat(from, message));
$("chat-form").onsubmit = (e) => {
  e.preventDefault();
  const input = $("chat-input");
  if (input.value.trim()) socket.emit("chat", input.value.trim());
  input.value = "";
};

// ---------- Rooms ----------
function renderRooms(rooms) {
  $("room-list").innerHTML = "";
  rooms.forEach(({ name, count }) => {
    const li = document.createElement("li");
    li.textContent = `${name} (${count})`;
    li.onclick = () => ($("room").value = name);
    $("room-list").appendChild(li);
  });
}
fetch("/api/rooms").then((r) => r.json()).then(renderRooms);

$("join-form").onsubmit = async (e) => {
  e.preventDefault();
  $("error").textContent = "";
  roomName = $("room").value.trim();
  await getMedia();

  socket.emit("join_room", roomName, $("nickname").value.trim(), async (res) => {
    if (!res.ok) {
      $("error").textContent = res.error;
      localStream.getTracks().forEach((t) => t.stop());
      return;
    }
    welcome.hidden = true;
    call.hidden = false;
    $("room-title").textContent = `Room: ${roomName}`;

    // Newcomer creates an offer to every existing peer (mesh)
    for (const { id: peerId, nickname } of res.peers) {
      const pc = createPeer(peerId, nickname);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("offer", { to: peerId, payload: offer });
    }
  });
};

$("leave-btn").onclick = () => window.location.reload();
