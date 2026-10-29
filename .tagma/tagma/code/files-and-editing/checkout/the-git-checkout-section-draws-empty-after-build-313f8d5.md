---
id: 01a128d3-dc02-75fe-b55d-26f89d510fba
title: The Git (checkout) section draws empty after build 313f8d5
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a128d3-c584-73f4-9b4d-c20485fdb582",
    "status": "done"
  }
---
The `/runlith/checkout` page is empty: the area right of the left panel black, no errors in the console. Appeared after today's edits (optional/spread cleanup, JSON ingress through JSON codec, `toJson` on input/answer operations, `at` instead of `position`). Find which value is produced wrong, fix at the owner; proof is the section drawn on one's own `tagma:try` instance.
