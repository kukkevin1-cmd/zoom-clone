const assert = require("assert");
const { io: Client } = require("socket.io-client");
const { createApp, MAX_ROOM_SIZE } = require("../src/app");

describe("Signaling server", () => {
  let httpServer, io, url;
  const clients = [];

  const connect = () =>
    new Promise((resolve) => {
      const c = Client(url, { forceNew: true, transports: ["websocket"] });
      clients.push(c);
      c.on("connect", () => resolve(c));
    });

  const join = (client, room, nick) =>
    new Promise((resolve) => client.emit("join_room", room, nick, resolve));

  before((done) => {
    ({ httpServer, io } = createApp());
    httpServer.listen(0, () => {
      url = `http://localhost:${httpServer.address().port}`;
      done();
    });
  });

  afterEach(() => {
    clients.splice(0).forEach((c) => c.disconnect());
  });

  after((done) => {
    io.close();
    httpServer.close(() => done());
  });

  it("returns existing peers to a newcomer and notifies the room", async () => {
    const a = await connect();
    const b = await connect();
    const first = await join(a, "room-1", "alice");
    assert.deepStrictEqual(first, { ok: true, peers: [] });

    const joined = new Promise((r) => a.once("peer_joined", r));
    const second = await join(b, "room-1", "bob");
    assert.strictEqual(second.peers.length, 1);
    assert.strictEqual(second.peers[0].nickname, "alice");
    assert.strictEqual((await joined).nickname, "bob");
  });

  it("relays offers only to the addressed peer", async () => {
    const a = await connect();
    const b = await connect();
    await join(a, "room-2", "alice");
    await join(b, "room-2", "bob");

    const got = new Promise((r) => b.once("offer", r));
    a.emit("offer", { to: b.id, payload: { type: "offer", sdp: "fake" } });
    const msg = await got;
    assert.strictEqual(msg.from, a.id);
    assert.strictEqual(msg.payload.sdp, "fake");
  });

  it(`rejects joins beyond ${MAX_ROOM_SIZE} participants`, async () => {
    for (let i = 0; i < MAX_ROOM_SIZE; i++) {
      const c = await connect();
      assert.ok((await join(c, "full-room", `u${i}`)).ok);
    }
    const extra = await connect();
    const res = await join(extra, "full-room", "late");
    assert.deepStrictEqual(res, { ok: false, error: "Room is full" });
  });

  it("broadcasts chat messages within a room", async () => {
    const a = await connect();
    const b = await connect();
    await join(a, "room-3", "alice");
    await join(b, "room-3", "bob");
    const got = new Promise((r) => b.once("chat", r));
    a.emit("chat", "hello");
    const msg = await got;
    assert.strictEqual(msg.from, "alice");
    assert.strictEqual(msg.message, "hello");
  });

  it("notifies peers when someone leaves", async () => {
    const a = await connect();
    const b = await connect();
    await join(a, "room-4", "alice");
    await join(b, "room-4", "bob");
    const left = new Promise((r) => a.once("peer_left", r));
    b.disconnect();
    assert.strictEqual((await left).id !== undefined, true);
  });
});
