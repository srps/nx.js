---
"@nx.js/runtime": patch
---

Close the inline software keyboard applet at runtime teardown. It was only closed by the V8 finalizer, which never runs on exit; because hbloader reuses the process for the next NRO, a leaked keyboard session left every later app without a keyboard until hbmenu was relaunched.
