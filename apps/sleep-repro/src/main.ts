/**
 * sleep-repro — minimal reproduction of the sleep/wake console crash.
 *
 * Upstream report: TooTallNate/nx.js — "Console sleep while holding a TCP
 * connection crashes the bsdsocket sysmodule (User Break at +0xef0f0),
 * taking down hbloader/hbmenu/qlaunch until a hard reboot."
 *
 * This app does exactly THREE things: connects a WebSocket, logs lifecycle
 * events to the SD, and idles. NO reconnect, NO traffic, NO timers beyond
 * one liveness tick. Sleep the console for ANY duration while it shows
 * "connected" and wake it — stock nx.js crashes the console within seconds.
 *
 * Run `bun server.mjs` on any machine on the LAN (edit URL below), install
 * this NRO, launch, sleep, wake. See README.md.
 */
const URL_ = 'ws://192.168.0.176:8787/';
const LOG = 'sdmc:/switch/sleep-repro.log';

let state = 'boot';
let beats = 0;

function log(msg: string) {
	const line = `${new Date().toISOString()} ${msg}`;
	console.log(line);
	try {
		(globalThis as any).Switch?.appendFileSync(LOG, `${line}\n`);
	} catch {}
}

function render() {
	console.clear();
	console.log('\x1b[1msleep-repro\x1b[0m — stock-runtime crash reproduction');
	console.log(`url:    ${URL_}`);
	console.log(`state:  ${state}`);
	console.log(`ticks:  ${beats}`);
	console.log('');
	console.log('Wait for "connected", then SLEEP the console (any duration)');
	console.log('and wake it. Stock nx.js: console crashes within seconds.');
	console.log('Fixed runtime (wake-fix branch): survives; app shows "closed".');
}

log('boot');

const ws = new WebSocket(URL_);
ws.addEventListener('open', () => {
	state = 'connected';
	log('open — you can sleep the console NOW');
	render();
});
ws.addEventListener('error', (e: any) => {
	state = 'error: ' + String(e?.message || e?.error || 'unknown');
	log(`error ${state}`);
	render();
});
ws.addEventListener('close', () => {
	state = 'closed (no reconnect by design)';
	log('close');
	render();
});

setInterval(() => {
	beats++;
	render();
}, 5000);

render();
