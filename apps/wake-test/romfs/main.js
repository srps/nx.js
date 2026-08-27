// src/main.ts
var DEFAULT_URL = "ws://192.168.0.176:8787/";
var url = DEFAULT_URL;
try {
  const cfg = Switch.file("sdmc:/switch/wake-test.json").json() ?? {};
  if (cfg.url) url = cfg.url;
} catch {
}
var state = "boot";
var connects = 0;
var disconnects = 0;
var messages = 0;
var lastEvent = "boot";
var lastError = "";
var lastBeat = Date.now();
var beats = 0;
function render() {
  console.clear();
  console.log("\x1B[1mwake-test\x1B[0m \u2014 sleep/wake socket harness");
  console.log(`url:         ${url}`);
  console.log(`state:       ${state}`);
  console.log(`connects:    ${connects}   disconnects: ${disconnects}`);
  console.log(`messages:    ${messages}   heartbeats: ${beats}`);
  console.log(`last event:  ${lastEvent}`);
  console.log(`last error:  ${lastError || "(none)"}`);
  console.log("");
  console.log("Sleep the console (>= 1 min), wake it, and watch:");
  console.log("  FIXED   : disconnect -> reconnect ~1s later, counters keep climbing");
  console.log("  BROKEN  : app quits to hbmenu; everything socket-y crashes after");
  console.log("");
  console.log("[heartbeat every 5s \u2014 a large gap after wake is expected and logged]");
}
function mark(event, err = "") {
  lastEvent = `${event} @ ${(/* @__PURE__ */ new Date()).toISOString()}`;
  if (err) lastError = err.slice(0, 60);
  render();
}
function connect() {
  state = "connecting";
  mark("connecting");
  let ws;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    mark("ws constructor threw", String(e));
    setTimeout(connect, 2e3);
    return;
  }
  ws.addEventListener("open", () => {
    state = "connected";
    connects++;
    lastError = "";
    mark("open");
    ws.send("wake-test hello");
  });
  ws.addEventListener("message", () => {
    messages++;
  });
  ws.addEventListener("close", () => {
    state = "disconnected";
    disconnects++;
    mark("close");
    setTimeout(connect, 1e3);
  });
  ws.addEventListener("error", () => {
    mark("error event");
  });
}
setInterval(() => {
  const now = Date.now();
  const gap = now - lastBeat;
  lastBeat = now;
  beats++;
  if (gap > 6e4) {
    mark(`heartbeat resumed after ${(gap / 1e3).toFixed(0)}s (wake)`);
  } else {
    lastEvent = `heartbeat ${(gap / 1e3).toFixed(1)}s @ ${(/* @__PURE__ */ new Date()).toISOString()}`;
  }
}, 5e3);
render();
connect();
//# sourceMappingURL=main.js.map
