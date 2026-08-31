# wake-fix branch — local console sleep/wake experiment

This file documents a local-fork investigation. It must not be treated as an
upstream-ready change set. Current `origin/main` (`f41fb550`, fetched
2026-08-29) still has the unmatched-`UV_DISCONNECT` dispatch behavior in layer
1 below, and two stock beta.6 device incidents exercised it. The session-reset,
dead-fd registry, `Switch.lastWakeAt`, and wake detection in layers 2–4 are all
fork code and need separately reduced evidence before any upstream report.

The field corpus contains 20 on-device incidents (see
`fx-switch/docs/TEST-LOG.md`; evidence in per-boot logs and Atmosphère crash
reports). It establishes real bsdsocket failures, but several causal claims
made during the investigation were too broad and are corrected below.

## The failure, in four layers

The dispatch bug and stale-session behavior were isolated on-device. Later
reconnect timing observations are retained as incident history, not as a
duration-dependent model:

1. **Dropped `UV_DISCONNECT`** (`source/tcp.cc`) — this behavior is present in
   current `origin/main`, not introduced by the fork. Disconnect-type poll
   events that don't match an op's interest mask were silently dropped, so
   JS never saw the socket die and libuv kept polling the dead fd every
   frame until the sysmodule asserted (`User Break` at `bsdsocket+0xef0f0`,
   paired `hbl+0x7544`). Fix: complete the op with `ECONNRESET`. Only
   `UV_DISCONNECT` is treated as fatal — completing ops on other unmatched
   bits (e.g. writability) kills healthy connections (field-verified
   regression during development).
2. **Stale bsd session experiment** — device incidents showed failures after
   post-wake operations on the old bsd session, including a no-user-socket
   harness. The fork resets the session: stop all polls → dead-mark fds →
   `socketExit()` + `socketInitialize()` → fire pending ops with
   `ECONNRESET` → free stale handles without `close()`. The old two-second
   wall-clock frame-gap trigger was invalid: ordinary WASM/GPU work produced
   false wakes. The 2026-08-29 candidate uses libnx's native
   `AppletHookType_OnResume` instead and still needs a physical device matrix.
3. **Post-wake reconnect observations** — crashes followed reconnects at
   several delays, while other reconnects survived. The old “about a minute”
   recovery-window theory is not supported by a controlled comparison; short
   versus long sleep/wake is likewise not a useful discriminator.
4. **Conservative product policy** — because reconnect safety is not proven,
   apps currently avoid reconnecting in-process after a wake. This is a safety
   policy, not evidence of a timed sysmodule “delayed bomb.”

## The local app contract under test

- At wake, every pending socket op completes with `ECONNRESET` and the fd
  dies with the session — apps observe a normal disconnect.
- **`Switch.lastWakeAt`** is a fork-only API (wall-clock ms, set natively at
  the wake reset), not standard nx.js. Timer/frame-gap heuristics were shown
  to be unreliable, but that does not by itself prove this API should be
  upstreamed.
- Conservative app policy from the successful runs: **observe the disconnect,
  hold, and let the user relaunch**. This avoids the same-process reconnect
  operation correlated with several failures; it is not a claim that sleep
  duration determines safety.

## Forensics built in

- **Per-boot debug log** `sdmc:/nx.js/nxjs-debug-<version>-<epoch>.log` —
  unique names defeat the MTP/DBI read cache, which serves stale contents
  for a fixed filename indefinitely (two incidents were blind because of
  it). Crash-path lines land: stderr is unbuffered.
- Boot banner (`[nxjs] runtime v… (libnx …)`) — ground truth for which
  runtime NRO actually booted; MTP metadata lies.
- Step breadcrumbs through the wake reset (`polls stopped` → `bsd session
  reset` → `ops fired` → `complete` → `returned` → `lastWakeAt set: yes`).

## Reproducing the standard-runtime behavior

See `apps/sleep-repro/` — a minimal app (one idle WebSocket, no reconnect,
no traffic) plus a zero-dependency Bun WS peer. Published stock beta.6
reproduced the console crash twice, once in `fx-switch` and once in the
minimal wake harness. Current `origin/main` source still drops unmatched
`UV_DISCONNECT`, but the current commit has not yet been rerun in a clean,
stock-built device artifact. Log/report survival varied, and there is no
evidence that sleep duration controls the failure.

## Testing

- **Host**: `packages/runtime/test/tcp-host.test.ts` is a regression harness for
  idle reads, disconnect surfacing, and the known
  complete-on-benign-writability regression. It requires the host-native
  `nxjs-test` binary and is skipped when that binary is absent. It cannot prove
  the Horizon/libnx session-reset behavior.
- **On-device**: `apps/wake-test/` walks the protocol (connect → hold →
  wake → observe); `fx-switch/docs/TEST-LOG.md` documents 18 field
  incidents with per-layer verdicts.

## Deploying

Grab the `runtime-nro` artifact from the latest **runtime-build** workflow
run (or build with devkitPro), then drop it on the SD card:

```
sdmc:/nx.js/nxjs-v<version>.nro     # the launcher chainloads the highest
```

Verify the boot banner in the newest per-boot log — deploy channels lie
(MTP produced phantom uploads and stale listings during development; ftpd
over LAN is the reliable channel).
