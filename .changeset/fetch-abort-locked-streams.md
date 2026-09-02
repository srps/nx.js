---
'@nx.js/runtime': patch
---

Aborting an in-flight `fetch()` no longer throws "Cannot abort/cancel a
stream that already has a writer/reader". The abort listener now guards
`readable.cancel()` / `writable.abort()` with lock checks (the response body
pipe holds the readable's lock for the life of the stream) and aborts the
body pipe via the `signal` option of `pipeThrough()`, so the `Response` body
errors with the abort reason and the socket closes cleanly.
