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

interface Config {
	url?: string;
}

let url = DEFAULT_URL;
try {
	const cfg = (Switch.file('sdmc:/switch/wake-test.json').json() ?? {}) as Config;
	if (cfg.url) url = cfg.url;
} catch {
	// no config file — use default
}

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
	console.log(`url:         ${url}`);
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
		setTimeout(connect, 2000);
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
		setTimeout(connect, 1000);
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

render();
connect();
