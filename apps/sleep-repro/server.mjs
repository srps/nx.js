// Zero-dependency WebSocket peer for the sleep-repro app (Bun has native
// WS). Accepts connections and holds them — no traffic, so the only thing
// that can kill the console is the sleep/wake path itself.
//
//   bun server.mjs            # listens on 0.0.0.0:8787
//   PORT=9000 bun server.mjs  # custom port (update the app URL to match)
const PORT = Number(process.env.PORT || 8787);

new Bun.Server({
	port: PORT,
	hostname: '0.0.0.0',
	fetch(req, server) {
		if (server.upgrade(req)) return; // upgraded to WS
		return new Response('ws endpoint only', { status: 426 });
	},
	websocket: {
		open(ws) {
			console.log(`[peer] connected from ${ws.remoteAddress}`);
		},
		message() {}, // silent by design
		close(ws) {
			console.log(`[peer] closed ${ws.remoteAddress}`);
		},
	},
});

console.log(`[peer] holding WebSocket connections on ws://0.0.0.0:${PORT}/`);
