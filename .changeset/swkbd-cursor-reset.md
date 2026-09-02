---
"@nx.js/runtime": patch
---

Reset the inline software keyboard cursor before each `show()` and allow clearing its text with an empty `value`. Previously only the first keyboard session of a process delivered text; every later session reported an empty string for each keystroke because the applet kept the old cursor position after submit.
