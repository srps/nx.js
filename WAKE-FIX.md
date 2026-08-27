# wake-fix branch — console sleep/wake socket survival

This branch fixes a class of crashes where **any nx.js app holding a socket
across console sleep kills the console's `bsdsocket` sysmodule on wake**, and
with it the app's host process, hbmenu, qlaunch, and every other
socket-holding process — until a hard power cycle. It contains:

1. **`UV_DISCONNECT` dispatch** (`source/tcp.cc`) — disconnect-type poll
   events that don't match an op's interest mask were silently dropped, so
   JS never saw the socket die and libuv kept polling the dead fd every
   frame until the sysmodule asserted. Ops now complete with `ECONNRESET`.
2. **Wake reset** (`source/tcp.cc` + `source/main.cc`) — even with (1), the
   post-wake bsd service session is stale enough that reconnect-time socket
   operations re-trip the sysmodule assertion. The main loop now detects
   resume (≥60 s wall-clock gap between frames, checked **before** `uv_run`)
   and resets the entire socket layer: stop all polls → `socketExit()` +
   `socketInitialize()` (fresh bsd session) → fire pending ops with
   `ECONNRESET` → free stale handles. Apps observe a normal disconnect and
   reconnect on the fresh session ~1 s later.
3. **Runtime boot banner** — `nxjs-debug.log` now self-identifies
   (`[nxjs] runtime v<version> (libnx <version>)`), which makes on-device
   forensics unambiguous.

## Deploying

Grab the `runtime-nro` artifact from the latest **runtime-build** workflow run
(or build with devkitPro per the README), then drop it on the SD card:

```
sdmc:/nx.js/nxjs-v<version>.nro
```

The slim bootstrap launcher picks the **highest** installed version matching
its requirement, so no other changes are needed. Notes:

- This branch tracks upstream's beta line and is versioned accordingly
  (`1.0.0-beta.7` at the time of writing). If you previously deployed
  experimental `1.0.x` builds of this fix, **delete them from the SD** (via
  DBI's file browser on-console — never MTP): release versions outrank
  prereleases, so a leftover `nxjs-v1.0.x.nro` would keep winning the
  launcher's pick.
- **Never delete files on the SD via MTP** (it can wedge DBI's USB transfer
  session) — delete from DBI's own file browser on-console instead.

## Testing

- **Host (CI)**: `packages/runtime/test/tcp-host.test.ts` runs the runtime's
  real TCP dispatch code natively through public APIs (`fetch`) against a
  Node-hosted peer. Verified value (checked by injecting the bugs): it
  **fails** on the "complete ops on any unmatched event" regression (the
  kind that killed every healthy connection in the field), and it guards
  dispatch integrity + build/link breaks. The original wake bug itself —
  dropped `UV_DISCONNECT` events on wake-killed sockets — is specific to
  the Switch poll backend's event reporting and is **not reproducible on
  host**; the on-device protocol below is its guard.
- **On-device**: `apps/wake-test` + its
  [README](apps/wake-test/README.md) protocol — the 2-minute sleep/wake
  pass/fail procedure.

## Evidence / forensics

- Crash signature: paired Atmosphère reports, same second —
  `0100000000000012` (Process Name `bsdsocket`, User Break at
  `bsdsocket+0xef0ec`) + `01006f8002326000` (hbloader, User Break at
  `hbl+0x7540`).
- Heartbeat telemetry showed JS never seeing the socket die (no error/close
  events before death) and, post-fix, the death moving to reconnect time —
  which motivated the full session reset.
- Differential: native poll-based homebrew (ftpd) survives wake with
  `ECONNABORTED` errors and can create new sockets immediately after — only
  nx.js's dropped-event handling and stale-session usage tripped the
  sysmodule assert.

Commits: `0b07a47` (UV_DISCONNECT dispatch + breadcrumbs),
`f4e7e47` (wake reset), plus test/CI/docs on this branch.
