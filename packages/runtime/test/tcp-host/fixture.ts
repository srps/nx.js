/**
 * TCP dispatch fixture (host-only, run via tcp-host.test.ts).
 *
 * Regression guard for the sleep/wake socket bugs fixed on the `wake-fix`
 * branch (see /WAKE-FIX.md):
 *
 *  1. Ops must complete when the peer disconnects (a pending read may NOT
 *     hang silently — the original bug: UV_DISCONNECT events that didn't
 *     match the op's interest mask were dropped, so JS never learned the
 *     socket died and libuv polled the corpse until the bsdsocket sysmodule
 *     asserted on-device).
 *  2. Benign unmatched poll events (e.g. writability while only a read is
 *     pending) must NOT complete ops with errors (the v1.0.1 regression:
 *     every healthy connection died within seconds).
 *
 * Self-contained: the runtime's own TCP server binding is the peer, so no
 * external test server is needed.
 */
import { test } from '../src/tap';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface ServerObj {
	close(): void;
}

declare const $: {
	connect(cb: (err: any, fd: number) => void, ip: string, port: number): void;
	read(cb: (err: any, n: number) => void, fd: number, buf: ArrayBuffer): void;
	write(cb: (err: any, n: number) => void, fd: number, buf: ArrayBuffer): void;
	close(fd: number): void;
	tcpServerNew(
		ip: string,
		port: number,
		cb: (clientFd: number) => void,
	): ServerObj;
};

function connect(port: number): Promise<number> {
	return new Promise((resolve, reject) => {
		$.connect(
			(err: any, fd: number) => (err ? reject(err) : resolve(fd)),
			'127.0.0.1',
			port,
		);
	});
}

function read(fd: number, size = 1024): Promise<{ n: number; buf: ArrayBuffer }> {
	const buf = new ArrayBuffer(size);
	return new Promise((resolve, reject) => {
		$.read(
			(err: any, n: number) => (err ? reject(err) : resolve({ n, buf })),
			fd,
			buf,
		);
	});
}

function write(fd: number, data: string): Promise<number> {
	const buf = encoder.encode(data).buffer as ArrayBuffer;
	return new Promise((resolve, reject) => {
		$.write(
			(err: any, n: number) => (err ? reject(err) : resolve(n)),
			fd,
			buf,
		);
	});
}

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

const text = (r: { n: number; buf: ArrayBuffer }) =>
	decoder.decode(new Uint8Array(r.buf).slice(0, r.n));

test('tcp dispatch: echo, idle-read tolerance, disconnect surfaces', async (t) => {
	// ---- 1. start a server on a random port ----
	let serverFd: number | null = null;
	let server: ServerObj | null = null;
	let port = 21000 + Math.floor(Math.random() * 1000);
	for (let i = 0; i < 5 && server === null; i++) {
		try {
			server = $.tcpServerNew('127.0.0.1', port, (fd) => {
				serverFd = fd;
			});
		} catch {
			port++;
		}
	}
	t.ok(server !== null, `server listening on :${port}`);

	// ---- 2. client connects ----
	const fd = await withTimeout(connect(port), 5000, 'connect');
	t.ok(fd >= 0, `client connected (fd ${fd})`);

	for (let i = 0; i < 250 && serverFd === null; i++) {
		await new Promise((r) => setTimeout(r, 20));
	}
	t.ok(serverFd !== null, 'server accepted');
	const sfd = serverFd as number;

	try {
		// ---- 3. basic dispatch: server writes, client's pending read fires ----
		await withTimeout(write(sfd, 'ping'), 5000, 'server write #1');
		const r1 = await withTimeout(read(fd), 5000, 'client read #1');
		t.equal(text(r1), 'ping', 'echo received');

		// ---- 4. idle-read tolerance (v1.0.1 regression guard): a read armed
		// while the socket is idle (benign writability events possible) must
		// stay pending and deliver when data finally arrives. The regression
		// completed the read with EIO at the first unmatched event.
		const idleP = read(fd);
		await new Promise((r) => setTimeout(r, 1200)); // idle period
		await withTimeout(write(sfd, 'second'), 5000, 'server write #2');
		const r2 = await withTimeout(idleP, 5000, 'idle-pending read');
		t.equal(text(r2), 'second', 'idle-pending read delivered later data');

		// ---- 5. disconnect surfacing (original bug guard): peer drops the
		// connection; the pending read must complete (EOF or error) — NOT
		// hang. Pre-fix, the disconnect event was dropped and this hung
		// forever (on-device: libuv polled the dead fd until the bsdsocket
		// sysmodule asserted).
		const closedP = read(fd);
		$.close(sfd);
		await withTimeout(
			closedP.catch(() => 'error surfaced'), // error OR EOF are both fine
			8000,
			'disconnect surfaced',
		);
		t.pass('disconnect surfaced to JS');
	} finally {
		try {
			$.close(fd);
		} catch {}
		try {
			server!.close();
		} catch {}
	}
});
