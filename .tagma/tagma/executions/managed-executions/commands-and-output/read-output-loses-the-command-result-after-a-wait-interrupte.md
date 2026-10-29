---
id: 01a177d5-c8d8-766c-a1bd-23ffb2fa3632
title: read_output loses the command result after a wait interrupted by an operator message
ord: 24
tags: ["reflection"]
fields:
  {
    "actual": "The wait answered wait-ended and untouched; the next read_output reported ended, exit 0, and \"its output is no longer kept on this host\", showing not one result line.",
    "command": "read_output({\"execution\":\"4f3dd253-26ea-4186-900f-b9295e5bbacb\",\"incarnation\":167,\"wait\":180}), then read_output({\"execution\":\"4f3dd253-26ea-4186-900f-b9295e5bbacb\",\"incarnation\":167})",
    "expected": "A wait interrupted by an operator message keeps the command's not-yet-read result for the next read_output."
  }
---
Filed from project `runlith`.
