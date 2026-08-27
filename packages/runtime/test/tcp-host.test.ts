/**
 * Host-side TCP dispatch tests — runs the tcp-host fixture through the
 * nxjs-test binary (the host-native runtime build) and asserts TAP results.
 *
 * Unlike conformance.test.ts, this does NOT compare against a reference
 * engine: the fixture exercises the runtime's low-level `$` TCP bindings
 * (which no browser has) against the runtime's own TCP server binding.
 *
 * Requires the nxjs-test binary (cmake build; done automatically in CI's
 * pacman-packages container). Skipped when the binary is absent so local
 * `pnpm test` without a cmake build still passes.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { parseTap } from './src/tap-parser';

const ROOT = import.meta.dirname;
const BINARY = join(ROOT, 'build', 'nxjs-test');
const RUNTIME = join(ROOT, '..', 'runtime.js');
const OUT = join(ROOT, 'build', 'tcp-host-fixture.js');

describe('tcp dispatch (host)', () => {
	it.skipIf(!existsSync(BINARY))(
		'echo + idle-read tolerance + disconnect surfacing',
		async () => {
			await build({
				entryPoints: [join(ROOT, 'tcp-host', 'fixture.ts')],
				bundle: true,
				format: 'esm',
				target: 'es2022',
				outfile: OUT,
				sourcemap: false,
			});
			const output = execSync(`"${BINARY}" "${RUNTIME}" "${OUT}"`, {
				timeout: 60_000,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			const tap = parseTap(output);
			expect(tap.summary.fail).toBe(0);
			expect(tap.summary.pass).toBeGreaterThan(0);
		},
	);
});
