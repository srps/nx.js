# wake-fix branch — console sleep/wake socket survival

This branch fixes a class of crashes where **any nx.js app holding a socket
across console sleep kills the console's `bsdsocket` sysmodule on wake**, and
with it the app's host process, hbmenu, qlaunch, and every other
socket-holding process — until a hard power cycle. Field-verified across
18 on-device incidents (see `fx-switch/docs/TEST-LOG.md` for the full
matrix; evidence in per-boot logs + Atmosphère crash reports).

## The failure, in four layers

Each layer was isolated on-device; each has its own fix or policy:

1. **Dropped `UV_DISCONNECT`** (`source/tcp.cc`) — disconnect-type poll
   events that don't match an op's interest mask were silently dropped, so
   JS never saw the socket die and libuv kept polling the dead fd every
   frame until the sysmodule asserted (`User Break` at `bsdsocket+0xef0f0`,
   paired `hbl+0x7544`). Fix: complete the op with `ECONNRESET`. Only
   `UV_DISCONNECT` is treated as fatal — completing ops on other unmatched
   bits (e.g. writability) kills healthy connections (field-verified
   regression during development).
2. **Stale bsd session** — after ANY wake, the first poll on the old bsd
   service session asserts the sysmodule, **with or without user sockets**
   (libuv polls its own internal fds on that session every frame). Fix:
   detect resume (wall-clock gap ≥ 2 s between frames, checked **before**
   `uv_run`) and reset the session: stop all polls → dead-mark fds →
   `socketExit()` + `socketInitialize()` → fire pending ops with
   `ECONNRESET` → free stale handles without `close()`.
3. **Post-wake `connect()`** — reconnecting on the fresh session trips the
   same assert if attempted within ~a minute (+1 s and +8 s both
   field-fatal; +60 s succeeds). No runtime fix; apps must wait.
4. **Delayed bomb** — even a *successful* post-wake reconnect (+60 s,
   working socket, live traffic) was followed by a sysmodule crash 1–2
   minutes later, twice. No userspace workaround found. **Apps must not
   reconnect in-process after a wake** — see the app contract below.

## The app contract (ships in this branch)

- At wake, every pending socket op completes with `ECONNRESET` and the fd
  dies with the session — apps observe a normal disconnect.
- **`Switch.lastWakeAt`** (wall-clock ms, set natively at the wake reset) —
  the deterministic wake signal. A timer-gap heuristic cannot detect wakes
  (sleeps shorter than one tick period are invisible, and the wake
  disconnect outraces the first post-wake tick — both field-verified).
- App policy, proven across all sleep durations: **observe the disconnect,
  hold, and let the user relaunch** — a fresh process/session connects
  instantly and safely. Never reconnect in-process after a wake.

## Forensics built in

- **Per-boot debug log** `sdmc:/nx.js/nxjs-debug-<version>-<epoch>.log` —
  unique names defeat the MTP/DBI read cache, which serves stale contents
  for a fixed filename indefinitely (two incidents were blind because of
  it). Crash-path lines land: stderr is unbuffered.
- Boot banner (`[nxjs] runtime v… (libnx …)`) — ground truth for which
  runtime NRO actually booted; MTP metadata lies.
- Step breadcrumbs through the wake reset (`polls stopped` → `bsd session
  reset` → `ops fired` → `complete` → `returned` → `lastWakeAt set: yes`).

## Reproducing (stock runtime)

See `apps/sleep-repro/` — a minimal app (one idle WebSocket, no reconnect,
no traffic) plus a zero-dependency Bun WS peer. Stock nx.js + any sleep
duration = console crash, usually with the report pair above; short sleeps
often die too hard for reports to land.

## Testing

- **Host**: `packages/runtime/test/tcp-host.test.ts` proves the dispatch
  change doesn't break healthy connections (it catches the
  complete-on-benign-writability regression class). The wake reset itself
  is Switch-backend-specific and cannot be exercised on the host — the
  on-device protocol above is its guard.
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
