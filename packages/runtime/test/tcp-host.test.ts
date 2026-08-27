/**
 * Host-side TCP dispatch tests.
 *
 * Runs the tcp-host fixture through the nxjs-test binary (the host-native
 * runtime build) against a local HTTP peer server hosted by this test file.
 * The fixture uses only public APIs (fetch) — see fixture.ts for what each
 * scenario guards.
 *
 * Requires the nxjs-test binary (cmake build; done automatically in CI's
 * pacman-packages container). Skipped when the binary is absent so local
 * `pnpm test` without a cmake build still passes.
 */
import { execSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseTap } from './src/tap-parser';

const ROOT = import.meta.dirname;
const BINARY = join(ROOT, 'build', 'nxjs-test');
const RUNTIME = join(ROOT, '..', 'runtime.js');
const OUT = join(ROOT, 'build', 'tcp-host-fixture.js');

// Must match the fixture (the runtime has no argv/env surface for scripts).
const PEER_PORT = 46271;

describe('tcp dispatch (host)', () => {
	let server: Server;

	beforeAll(
		async () => {
			await build({
				entryPoints: [join(ROOT, 'tcp-host', 'fixture.ts')],
				bundle: true,
				format: 'esm',
				target: 'es2022',
				outfile: OUT,
				sourcemap: false,
			});

			server = createServer((req, res) => {
				if (req.url === '/slow') {
					// Idle period before responding: exercises reads pending
					// across an idle socket.
					setTimeout(() => {
						res.writeHead(200);
						res.end('delivered');
					}, 1200);
				} else if (req.url === '/abort') {
					// Destroy mid-response: the client's pending read must
					// surface an error, not hang.
					setTimeout(() => {
						res.socket?.destroy();
					}, 100);
				} else {
					res.writeHead(200);
					res.end('ok');
				}
			});
			await new Promise<void>((resolve) =>
				server.listen(PEER_PORT, '127.0.0.1', resolve),
			);
		},
		30_000,
	);

	afterAll(() => {
		server?.close();
	});

	it.skipIf(!existsSync(BINARY))(
		'idle-read tolerance + disconnect surfacing + fresh sockets',
		async () => {
			const output = execSync(`"${BINARY}" "${RUNTIME}" "${OUT}"`, {
				timeout: 60_000,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			const tap = parseTap(output);
			if (tap.summary.fail > 0) {
				// Surface the raw TAP in the test log — the summary alone
				// hides which assertions failed and why.
				console.error('--- fixture TAP output ---\n' + output);
			}
			expect(tap.summary.fail).toBe(0);
			expect(tap.summary.pass).toBeGreaterThan(0);
		},
	);
});
