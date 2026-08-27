# wake-test — sleep/wake socket regression harness

Minimal nx.js app that holds a WebSocket open across console sleep and
auto-reconnects. This is the on-device regression test for the `wake-fix`
branch (see [/WAKE-FIX.md](../../WAKE-FIX.md)).

## Setup

1. Build + install this app's `.nro` (`pnpm nro --filter wake-test`) and a
   runtime built from this branch (`nxjs-v<version>.nro` in `sdmc:/nx.js/`).
2. Point it at any WebSocket server: create `sdmc:/switch/wake-test.json`:
   ```json
   { "url": "ws://192.168.x.x:9000/" }
   ```
   (any WS server works — it doesn't need to answer; connection state
   transitions are what's being tested).

## Protocol (the actual test)

1. Launch `wake-test` from hbmenu. Wait for `state: connected`.
2. Let the console sleep for **at least 1 minute** (auto-sleep or power menu).
3. Wake it.

### PASS

- The app is still running (no quit to hbmenu).
- `disconnects` incremented, `last event: close @ …`, and within ~1–2 s
  `state: connected` again with `connects` incremented.
- `heartbeats` keeps climbing; `last event` shows the wake gap.
- hbmenu still works afterward; other apps still launch; the console
  reboots cleanly. (`atmosphere/crash_reports/` gains **no** new files.)

### FAIL (the bug this branch fixes)

- The app dies to hbmenu within seconds of wake.
- Subsequently launching anything socket-holding (hbmenu itself, ftpd, …)
  crashes; `atmosphere/crash_reports/` gains a paired
  `0100000000000012` (bsdsocket) + `01006f8002326000` (hbloader) User Break
  report; the console can't cleanly reboot until power-cycled.

## CI

`packages/runtime/test/tcp-host.test.ts` covers the host-testable dispatch
properties (disconnect events surface to JS; benign unmatched poll events do
not kill ops). The sleep/wake path itself needs hardware — this protocol is
that test.
