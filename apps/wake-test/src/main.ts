/**
 * wake-test — sleep/wake socket regression harness.
 *
 * Distills the fx-switch failure into a minimal app: hold a WebSocket open,
 * count everything, auto-reconnect, and show the timeline on screen. With
 * the wake-fix runtime the app survives console sleep; without it, the
 * process (and the console's bsdsocket sysmodule) dies within seconds of
 * wake. See /WAKE-FIX.md for the protocol.
 *
 * Config: sdmc:/switch/wake-test.json → { "url": "ws://<bridge>:8787/..." }
 * (any WebSocket echo/server works; default below.)
 */
const DEFAULT_URL = 'ws://192.168.0.176:8787/';
const CONFIG_PATH = 'sdmc:/switch/wake-test.json';
const LOG_PATH = 'sdmc:/switch/wake-test.log';

interface Config {
	url?: string;
	reconnectMs?: number;
}

// SD event log (synchronous appends — survives hard kills).
function flog(msg: string): void {
	try {
		(globalThis as any).Switch?.appendFileSync(
			LOG_PATH,
			`${new Date().toISOString()} ${msg}\n`,
		);
	} catch {
		/* SD unavailable */
	}
}

let url = DEFAULT_URL;
let urlSource = 'default';
// Reconnect grace: a +1s reconnect on the fresh post-wake session tripped
// the bsdsocket sysmodule once (v1.0.0-beta.8 field run) — give the
// sysmodule a few seconds to settle before the first new socket().
let reconnectMs = 8000;
try {
	// NOTE: Switch.file(path).json() returns a PROMISE — awaiting is not
	// optional (reading properties off the promise yields undefined and
	// silently falls back to the default URL).
	const cfg = (await Promise.race([
		Switch.file(CONFIG_PATH).json(),
		new Promise((r) => setTimeout(() => r(null), 5000)),
	])) as Config | null;
	if (cfg?.url) {
		url = cfg.url;
		urlSource = 'sdmc config';
	}
	if (cfg?.reconnectMs && cfg.reconnectMs >= 100) {
		reconnectMs = cfg.reconnectMs;
	}
} catch {
	// no config file — use default
}
const masked = url.replace(/token=[^&]+/, 'token=***');
flog(
	`boot url=${masked} source=${urlSource} reconnect=${reconnectMs}ms`,
);

let state = 'boot';
let connects = 0;
let disconnects = 0;
let messages = 0;
let lastEvent = 'boot';
let lastError = '';
let lastBeat = Date.now();
let beats = 0;

function render() {
	console.clear();
	console.log('\x1b[1mwake-test\x1b[0m — sleep/wake socket harness');
	console.log(`url:         ${masked} (${urlSource})`);
	console.log(`reconnect:   ${reconnectMs}ms`);
	console.log(`state:       ${state}`);
	console.log(`connects:    ${connects}   disconnects: ${disconnects}`);
	console.log(`messages:    ${messages}   heartbeats: ${beats}`);
	console.log(`last event:  ${lastEvent}`);
	console.log(`last error:  ${lastError || '(none)'}`);
	console.log('');
	console.log('Sleep the console (>= 1 min), wake it, and watch:');
	console.log('  FIXED   : disconnect -> reconnect ~1s later, counters keep climbing');
	console.log('  BROKEN  : app quits to hbmenu; everything socket-y crashes after');
	console.log('');
	console.log('[heartbeat every 5s — a large gap after wake is expected and logged]');
}

function mark(event: string, err = '') {
	lastEvent = `${event} @ ${new Date().toISOString()}`;
	if (err) lastError = err.slice(0, 60);
	flog(`${event}${err ? ` err=${err.slice(0, 120)}` : ''}`);
	render();
}

function connect() {
	state = 'connecting';
	mark('connecting');
	let ws: WebSocket;
	try {
		ws = new WebSocket(url);
	} catch (e) {
		mark('ws constructor threw', String(e));
		setTimeout(connect, reconnectMs);
		return;
	}
	ws.addEventListener('open', () => {
		state = 'connected';
		connects++;
		lastError = '';
		mark('open');
		ws.send('wake-test hello');
	});
	ws.addEventListener('message', () => {
		messages++;
	});
	ws.addEventListener('close', () => {
		state = 'disconnected';
		disconnects++;
		mark('close');
		setTimeout(connect, reconnectMs);
	});
	ws.addEventListener('error', () => {
		mark('error event');
	});
}

setInterval(() => {
	const now = Date.now();
	const gap = now - lastBeat;
	lastBeat = now;
	beats++;
	if (gap > 60_000) {
		mark(`heartbeat resumed after ${(gap / 1000).toFixed(0)}s (wake)`);
	} else {
		// keep the last-beat line fresh without spamming the visible log
		lastEvent = `heartbeat ${(gap / 1000).toFixed(1)}s @ ${new Date().toISOString()}`;
	}
}, 5000);
flog('starting connect loop');

render();
connect();
