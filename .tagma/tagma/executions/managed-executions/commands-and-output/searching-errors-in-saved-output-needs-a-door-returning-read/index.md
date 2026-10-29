---
id: 01a14a64-6989-7682-8526-c31f88e58c4b
title: Searching errors in saved output needs a door returning readable text
ord: 28
tags: ["reflection"]
fields:
  {
    "actual": "The tail correctly cut the earlier bytes; reading nine errors took positional base64 reads and two tagma op / node / rg pipelines, about 20 seconds of hand work.",
    "command": "read_output({execution:\"3d036180-3db4-63bb-88da-50272b67a032\",incarnation:167,wait:60,tail:100})",
    "expected": "After reading the bounded tail of tests, find the earlier error messages with one text-returning operation."
  }
---
Filed from project `<project>`.

Truncation was explicitly requested and didn't break the read_output contract. The whole output stayed in read_command_bytes, but that door returns base64 windows with no readable-text search: seeing the earlier errors took shell decoding and filtering.
