# Zoom Clone

Real-time multi-party video chat built with **vanilla JavaScript**, **WebRTC**, and **Socket.IO**.
Team project (Dec 2022 – Feb 2023), rebuilt in 2026 after the original repo was lost.

## Features

- Join or create named rooms, with a live list of open rooms
- Multi-party video/audio over a WebRTC **mesh** (up to 4 people per room)
- Mute / camera toggle, switching cameras mid-call (`RTCRtpSender.replaceTrack`, no renegotiation)
- In-room text chat
- Signaling server that relays SDP offers/answers and ICE candidates
- Load test simulating **300+ concurrent users**

## Architecture

```
 Browser A ──┐   offer / answer / ICE    ┌── Browser B
             ├──── Socket.IO server ─────┤
             │    (signaling only)       │
             └════ WebRTC media (P2P) ═══┘
```

The server never touches media. When a user joins, the server returns the list of
existing peers; the newcomer creates an `RTCPeerConnection` + offer for each one,
and the rest of the handshake is relayed through Socket.IO.

## Run locally

```bash
npm install
npm start            # http://localhost:3000
```

Open two browser tabs, use the same room name, and allow camera access.

## Tests

```bash
npm test             # Mocha tests for the signaling server
```

## Load testing

The original project was stress-tested with **LoadRunner**. Because LoadRunner is
commercial, this repo includes an equivalent open-source [k6](https://k6.io) scenario
(`loadtest/k6-rooms.js`): users ramp to **300 concurrent**, connect over Socket.IO,
join rooms of 4, and send chat messages every 2 seconds.

```bash
npm start
k6 run loadtest/k6-rooms.js
```

Thresholds: p95 HTTP < 200 ms, p95 room join < 300 ms, p95 WebSocket connect < 500 ms.

Sample local run (300 concurrent users, single Node process):

| Metric | p95 |
| --- | --- |
| HTTP `/api/rooms` | ~13 ms |
| `join_room` round trip | ~6 ms |
| WebSocket connect | ~6 ms |

## Tech stack

JavaScript · WebRTC · Socket.IO · Node.js / Express · Mocha · k6 (LoadRunner originally)
