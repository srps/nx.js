---
'nxjs-runtime': patch
---

The sleep/wake socket reset now settles pending TLS operations. TLS
connections poll their own fds and were invisible to the tcp-level reset:
a fetch blocked on `tlsRead` when the bsd session was dropped kept waiting
on a dead fd forever (observed as an agent stuck on "Thinking" after a
spurious wake reset). The reset now walks a registry of live TLS contexts,
parks each poll handle, marks the fd dead, and rejects in-flight read/write
ops with ECONNRESET so the JS promise chain fails cleanly.
