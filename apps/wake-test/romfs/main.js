// src/main.ts
var DEFAULT_URL = "ws://192.168.0.176:8787/";
var CONFIG_PATH = "sdmc:/switch/wake-test.json";
var LOG_PATH = "sdmc:/switch/wake-test.log";
function flog(msg) {
  try {
    globalThis.Switch?.appendFileSync(
      LOG_PATH,
      `${(/* @__PURE__ */ new Date()).toISOString()} ${msg}
`
    );
  } catch {
  }
}
var url = DEFAULT_URL;
var urlSource = "default";
var reconnectMs = 6e4;
try {
  const cfg = await Promise.race([
    Switch.file(CONFIG_PATH).json(),
    new Promise((r) => setTimeout(() => r(null), 5e3))
  ]);
  if (cfg?.url) {
    url = cfg.url;
    urlSource = "sdmc config";
  }
  if (cfg?.reconnectMs && cfg.reconnectMs >= 100) {
    reconnectMs = cfg.reconnectMs;
  }
} catch {
}
var masked = url.replace(/token=[^&]+/, "token=***");
flog(
  `boot MODE=HOLD url=${masked} source=${urlSource}`
);
var state = "boot";
var connects = 0;
var disconnects = 0;
var messages = 0;
var lastEvent = "boot";
var lastError = "";
var lastBeat = Date.now();
var beats = 0;
var connectedOnce = false;
function render() {
  console.clear();
  console.log("\x1B[1mwake-test6 [HOLD MODE]\x1B[0m \u2014 NO reconnect after wake");
  console.log(`url:         ${masked} (${urlSource})`);
  console.log(`reconnect:   ${reconnectMs}ms`);
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
  flog(`${event}${err ? ` err=${err.slice(0, 120)}` : ""}`);
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
    setTimeout(connect, reconnectMs);
    return;
  }
  ws.addEventListener("open", () => {
    state = "connected";
    connectedOnce = true;
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
    if (connectedOnce) {
      mark("close - HOLD (no reconnect; watch heartbeats vs the bomb)");
      return;
    }
    mark("close");
    setTimeout(connect, reconnectMs);
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
  render();
}, 5e3);
flog("starting connect loop");
render();
connect();
//# sourceMappingURL=main.js.map
