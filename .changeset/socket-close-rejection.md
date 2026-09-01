---
"@nx.js/runtime": patch
---

`Socket#close()` no longer surfaces an "Uncaught (in promise)" when closing
an already-errored socket. On an errored stream, `readable.cancel()` and
`writable.abort()` return promises rejected with the stream's stored error;
nothing awaits them in `close()`, so each close of a failed socket logged a
duplicate unhandled rejection for an error that had already been delivered
through the reader or writer.
