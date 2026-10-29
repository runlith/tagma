---
id: 01a16531-a125-7327-bb37-305363789e12
title: "A new team/stealth project is not created: HolderStandings is missing from the context"
ord: 10
tags: ["reflection"]
fields:
  {
    "actual": "add_project answered HTTP 500: Service not found: tagma/graph/HolderStandings; the stand fell in world.stealthProject before reproducing the merge (HEAD bbad2681e4e8e8f224c8f26687508dfd5b7458ee32).",
    "command": "bun test ./src/composition/testing/enforcement/absorbCheckout.stest.ts --parallel=1",
    "expected": "The system stand creates the home project through public add_project and proceeds to the merge scenario."
  }
---
Filed from project `runlith`.