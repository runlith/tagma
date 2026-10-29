---
id: 01a11803-2cb4-7688-8b5e-c4853d1329ab
title: File text is served without the BOM; the file verdict is passed on bytes, and the digest is computed over the same
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/files/src/content.ts
---
`contentOf(bytes)` separates three outcomes: `binary` (NUL in the first 8000 bytes, as in git), `undecodable` (not UTF-8: git counts such a file as text, the editor opens it read-only), and `text`, whose `text` holds no BOM — it rides the `bom` flag. The change journal, digests, and hunks are computed over the text where U+FEFF stayed a character (previously `TextDecoder` with `ignoreBOM` left it), so a place needing such text takes `withBom`; the file digest is computed over its bytes (`bytesDigest`), it equals the digest of the text with BOM and does not copy the text.

The file verdict is passed on bytes, on both sides of the comparison: Holdings and the landing tree read the HEAD side by bytes (`workingBlobFilesAt`, `workingFilesAt`), as the working side. The only consumer of a verdict over already-decoded text is `threadFiles/patch.ts`, whose sides (reference, `fileText`, replacement blob) go by rows; for it `looksBinaryText` looks at the first 8000 characters, not bytes, so in multibyte text a NUL between the 8000th character and the 8000th byte yields text where the byte branch would have said binary. The divergence will leave when `threadFiles` sides become bytes.

Every place decides for itself what to do with `undecodable`: Holdings and the landing tree do not weigh such a file; the line count counts it.
