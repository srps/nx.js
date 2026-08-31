/**
 * TCP dispatch fixture (host-only, run via tcp-host.test.ts).
 *
 * Regression guard for the sleep/wake socket bugs fixed on the `wake-fix`
 * branch (see /WAKE-FIX.md), using only the runtime's PUBLIC API (fetch) —
 * the internal `$` bridge is deleted from the global scope after boot.
 *
 * The peer is an HTTP server hosted by the vitest wrapper (Node) on
 * PEER_PORT:
 *
 *  - /slow   : waits 1.2 s before responding — a read op pending across an
 *              idle period must survive and deliver (v1.0.1 regression
 *              guard: benign unmatched poll events must not complete ops).
 *  - /abort  : destroys the connection mid-response — the pending read must
 *              surface an error (original bug guard: disconnect events were
 *              dropped and ops hung forever; on-device this spun the dead
 *              fd until the bsdsocket sysmodule asserted).
 *  - /ok     : plain 200 — verifies fresh sockets work after a disconnect.
 */
import { test } from '../src/tap';

const PEER_PORT = 46271;
const base = `http://127.0.0.1:${PEER_PORT}`;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	return Promise.race([
		p,
		new Promise<T>((_, reject) =>
			setTimeout(
				() => reject(new Error(`${label}: timed out after ${ms}ms`)),
				ms,
			),
		),
	]);
}

test('tcp: read pending across an idle period still delivers', async (t) => {
	const res = await withTimeout(fetch(`${base}/slow`), 8000, '/slow fetch');
	t.equal(res.status, 200, 'slow response arrived after idle delay');
	const body = await withTimeout(res.text(), 4000, '/slow body');
	t.equal(body, 'delivered', 'body intact');
});

test('tcp: abrupt disconnect surfaces as an error', async (t) => {
	// Outcome-based (not catch-based): a timed-out fetch must NOT count as
	// "surfaced" — only a genuine rejection does.
	let outcome: 'rejected' | 'resolved' = 'resolved';
	try {
		await fetch(`${base}/abort`);
	} catch {
		outcome = 'rejected';
	}
	t.equal(outcome, 'rejected', 'fetch rejected (disconnect surfaced to JS)');
});

test('fetch: abort mid-stream rejects cleanly (locked body pipe)', async (t) => {
	// Regression guard: the request's abort listener used to call
	// readable.cancel()/writable.abort() on LOCKED streams (the response
	// body pipe holds the readable's lock), throwing "Cannot abort/cancel a
	// stream that already has a writer/reader" from the listener instead of
	// aborting the fetch. Outcome-based: the body read must reject and a
	// fresh request must still work afterwards.
	const controller = new AbortController();
	const res = await withTimeout(
		fetch(`${base}/stream`, { signal: controller.signal }),
		8000,
		'/stream fetch',
	);
	t.equal(res.status, 200, 'streaming response opened');
	const reader = res.body!.getReader();
	const first = await withTimeout(reader.read(), 4000, 'first chunk');
	t.equal(first.done, false, 'first chunk arrived before abort');
	// The historical bug: the abort listener called cancel()/abort() on
	// LOCKED streams, THREW (surfacing as a runtime error event), and the
	// pending read hung forever. So (a) capture error events, (b) a read
	// that only settles via our timeout counts as HUNG, not rejected.
	const errorEvents: string[] = [];
	const onError = (e: any) => {
		errorEvents.push(String(e?.error ?? e?.message ?? e));
		e.preventDefault?.();
	};
	addEventListener('error', onError);
	controller.abort();
	let outcome: 'rejected' | 'resolved' | 'hung' = 'resolved';
	try {
		for (;;) {
			const r = await withTimeout(reader.read(), 3000, 'post-abort read');
			if (r.done) break;
		}
	} catch (err) {
		outcome = String(err).includes('timed out') ? 'hung' : 'rejected';
	}
	removeEventListener('error', onError);
	t.equal(outcome, 'rejected', 'body read rejected promptly after abort');
	t.equal(
		errorEvents.filter((m) => m.includes('already has a')).length,
		0,
		'no locked-stream throw escaped the abort listener',
	);
	const ok = await withTimeout(fetch(`${base}/ok`), 8000, '/ok after abort');
	t.equal(ok.status, 200, 'fresh socket works after aborted fetch');
});

test('tcp: fresh connections work after a disconnect', async (t) => {
	const res = await withTimeout(fetch(`${base}/ok`), 8000, '/ok fetch');
	t.equal(res.status, 200, 'fresh socket connected');
	const body = await withTimeout(res.text(), 4000, '/ok body');
	t.equal(body, 'ok', 'body intact');
});
