---
"@nx.js/runtime": minor
---

feat: expose `Switch.commitDeviceSync(device)` as an explicit durability
boundary for mounted filesystems, backed by libnx `fsdevCommitDevice()`.
