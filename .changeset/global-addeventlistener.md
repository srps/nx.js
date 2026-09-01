---
"@nx.js/runtime": patch
---

Install the global `addEventListener` wrapper. The wrapper lazily calls
`initKeyboard()` on the first `keydown`/`keyup` listener, but it was never
registered on the global object, so calls resolved to the inherited
`EventTarget.prototype.addEventListener` and physical (USB/Bluetooth)
keyboards produced no events in any application.
