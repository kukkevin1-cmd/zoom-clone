// k6 load test: 300+ concurrent users joining rooms and chatting over Socket.IO.
// Run: k6 run loadtest/k6-rooms.js   (server must be running; override with -e BASE=host:port)
//
// The original project used LoadRunner; this is an open-source equivalent
// so anyone can reproduce the scenario.
import ws from "k6/ws";
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Counter } from "k6/metrics";

const BASE = __ENV.BASE || "localhost:3000";
const joinLatency = new Trend("join_room_latency", true);
const chatReceived = new Counter("chat_messages_received");

export const options = {
  scenarios: {
    rooms: {
      executor: "ramping-vus",
      startVUs: 0,
      // SMOKE=1 runs a short 30-user profile (used in CI)
      stages: __ENV.SMOKE
        ? [{ duration: "10s", target: 30 }, { duration: "10s", target: 30 }, { duration: "5s", target: 0 }]
        : [
            { duration: "30s", target: 100 },
            { duration: "30s", target: 300 },
            { duration: "1m", target: 300 }, // hold 300 concurrent users
            { duration: "20s", target: 0 },
          ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<200"],
    join_room_latency: ["p(95)<300"],
    ws_connecting: ["p(95)<500"],
  },
};

// Socket.IO wire format over Engine.IO v4:
//   "0{...}" open, "2"/"3" ping/pong, "40" namespace connect, "42[...]" event, "43<id>[...]" ack
export default function () {
  const res = http.get(`http://${BASE}/api/rooms`);
  check(res, { "rooms list 200": (r) => r.status === 200 });

  const room = `load-${Math.floor(__VU / 4)}`; // 4 users per room
  const url = `ws://${BASE}/socket.io/?EIO=4&transport=websocket`;

  ws.connect(url, {}, (socket) => {
    let joinSentAt = 0;

    socket.on("message", (msg) => {
      if (msg.startsWith("0")) {
        socket.send("40");
      } else if (msg.startsWith("40")) {
        joinSentAt = Date.now();
        socket.send(`421${JSON.stringify(["join_room", room, `vu-${__VU}`])}`);
      } else if (msg.startsWith("431")) {
        joinLatency.add(Date.now() - joinSentAt);
        const ack = JSON.parse(msg.slice(3))[0];
        check(ack, { "joined room": (a) => a.ok === true });
        socket.setInterval(() => socket.send(`42${JSON.stringify(["chat", "ping from k6"])}`), 2000);
      } else if (msg === "2") {
        socket.send("3");
      } else if (msg.startsWith('42["chat"')) {
        chatReceived.add(1);
      }
    });

    socket.setTimeout(() => socket.close(), 20000);
  });

  sleep(1);
}
