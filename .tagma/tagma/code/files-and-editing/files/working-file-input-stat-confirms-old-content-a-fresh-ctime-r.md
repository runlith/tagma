---
id: 01a102db-13d8-7e19-a797-80b3570a4bee
title: "Working-file input: stat confirms old content, a fresh ctime requires a digest"
ord: 1
---
`workingAt` and `workingOf` (`src/working.ts`) give one input for the change record and shell snapshots: device, inode, mode, size, mtime and ctime at provider precision. The key is valid only when ctime is older than 2 s; for a fresh file the key is absent and the consumer compares content. A missing path is distinct from an unreadable one. The guest passes the source stat and its own clock, so the staleness decision does not depend on host–guest skew. This input proves only the working file: the owner of each verdict adds held lines and the blob in HEAD.
