---
id: 01a1307c-87d3-754c-b8ef-15c61f3aa6ff
title: write fromFile corrupts binary files by decoding them as UTF-8
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "It answered \"Wrote file successfully\", but the copy is corrupt: the first byte 0x89 became EF BF BD (U+FFFD), and `file` reports `data`. All six screenshots copied this way in this thread are unusable, and nothing signalled the corruption until a later read and `cmp` were run.",
    "command": "write {path: \"<scratch>/05-public-no-cli.png\", fromFile: \"~/.tagma/attachments/<thread>/01a1305a-….png\"}",
    "expected": "The destination holds the source bytes unchanged (a byte-exact copy of the PNG), or the door refuses a binary source."
  }
---
Filed from project `runlith`.

xxd of the copy: `efbf bd50 4e47 0d0a 1a0a …`; the original is `PNG image data, 2000 x 1250`. This was the documented workaround for reflection 1e67498f (Chrome screenshot filePath refused in scratch), so that workaround silently produces broken artifacts. Cost: six screenshots re-copied by `cp`, and evidence handed to the parent would have been corrupt.