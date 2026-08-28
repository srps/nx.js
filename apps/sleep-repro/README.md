# sleep-repro — console sleep/wake crash, minimal reproduction

**Upstream issue repro.** A stock-nx.js app holding **one idle WebSocket**
connection. Sleep the console for **any duration** (2 s or 2 h) while it
shows `connected`, then wake it — the console crashes, often hard enough
that no Atmosphère crash report is even written.

## What happens (stock runtime, e.g. v1.0.0-beta.6)

The bsdsocket sysmodule reports a disconnect-type poll event for the
wake-dead socket. nx.js's TCP poll dispatch drops events that don't match
the op's interest mask, so JS never observes the disconnect, and libuv
keeps polling the dead fd every frame until the sysmodule hits an internal
assertion:

- `User Break` in **bsdsocket** (`bsdsocket + 0xef0f0`, crashed-thread
  `X[4] = bsdsocket + 0xdeeb0`) — report `0100000000000012`
- paired `User Break` in **hbloader** (`hbl + 0x7544`) — report `01006f8002326000`

The sysmodule crash cascades: hbmenu, qlaunch and other socket-holding
processes die until the console is hard power-cycled. On short sleeps the
death can be so fast that neither report lands.

## Steps

1. **Peer server** (any LAN machine with Bun):
   ```
   bun server.mjs
   ```
2. **Point the app at it**: edit `src/main.ts` (`URL_`) to
   `ws://<that machine's IP>:8787/` and build the NRO
   (`pnpm install && pnpm run build && npx nxjs-nro`), or use the CI
   artifact from this branch.
3. **Stock runtime**: install upstream nx.js (e.g. the released
   `nxjs-v1.0.0-beta.6.nro`) — the crash is in the stock runtime, so do
   **not** use a wake-fix build for the reproduction.
4. Launch the app, wait for `connected`.
5. **Sleep the console (power button), any duration. Wake it.**

   - *Stock*: console crashes within seconds of wake.
   - *wake-fix branch (v1.0.0-beta.13+)*: survives; the app logs `close`
     (`sdmc:/switch/sleep-repro.log`) and shows `closed (no reconnect by
     design)`. Relaunching the app reconnects instantly and safely.

## Why no reconnect in the app

On stock runtime the crash comes purely from the dropped disconnect event
and the dead-fd poll spin — reconnect logic would only add variables. On
the fixed runtime, an in-process reconnect after wake is its own (separate,
also field-verified) sysmodule killer; the safe app pattern is hold +
relaunch, which is what this app demonstrates.
