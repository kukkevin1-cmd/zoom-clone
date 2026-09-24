const http = require("http");
const path = require("path");
const express = require("express");
const { Server } = require("socket.io");

const MAX_ROOM_SIZE = 4; // mesh topology: keep rooms small

function createApp() {
  const app = express();
  app.use(express.static(path.join(__dirname, "public")));

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { cors: { origin: "*" } });

  // Public room list = adapter rooms that are not a socket's private room
  const publicRooms = () => {
    const { rooms, sids } = io.sockets.adapter;
    const result = [];
    rooms.forEach((members, name) => {
      if (!sids.has(name)) result.push({ name, count: members.size });
    });
    return result;
  };

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/rooms", (_req, res) => res.json(publicRooms()));

  io.on("connection", (socket) => {
    socket.data.nickname = "Anonymous";

    socket.on("join_room", (roomName, nickname, ack) => {
      const room = io.sockets.adapter.rooms.get(roomName);
      if (room && room.size >= MAX_ROOM_SIZE) {
        if (typeof ack === "function") ack({ ok: false, error: "Room is full" });
        return;
      }
      socket.data.nickname = nickname || "Anonymous";
      socket.data.room = roomName;
      const peers = room
        ? [...room].map((id) => ({ id, nickname: io.sockets.sockets.get(id)?.data.nickname }))
        : [];
      socket.join(roomName);
      // Newcomer receives existing peers and creates offers to each of them.
      if (typeof ack === "function") ack({ ok: true, peers });
      socket.to(roomName).emit("peer_joined", { id: socket.id, nickname: socket.data.nickname });
      io.emit("room_change", publicRooms());
    });

    // WebRTC signaling relay: offer / answer / ICE candidates
    ["offer", "answer", "ice"].forEach((type) => {
      socket.on(type, ({ to, payload }) => {
        io.to(to).emit(type, { from: socket.id, nickname: socket.data.nickname, payload });
      });
    });

    socket.on("chat", (message) => {
      if (!socket.data.room || typeof message !== "string") return;
      io.to(socket.data.room).emit("chat", {
        from: socket.data.nickname,
        message: message.slice(0, 500),
        at: Date.now(),
      });
    });

    socket.on("disconnecting", () => {
      socket.rooms.forEach((r) => socket.to(r).emit("peer_left", { id: socket.id }));
    });
    socket.on("disconnect", () => io.emit("room_change", publicRooms()));
  });

  return { app, httpServer, io };
}

module.exports = { createApp, MAX_ROOM_SIZE };
