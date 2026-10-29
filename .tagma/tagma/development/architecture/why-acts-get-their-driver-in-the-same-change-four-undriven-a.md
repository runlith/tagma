---
id: 01a0d095-15fd-7c10-a11d-4c3f8850bfb8
title: "Why acts get their driver in the same change: four undriven acts measured on 2026-09-22"
ord: 20
---
On 2026-09-22 four maintenance acts were each written correctly and documented with the cadence they expected, and none of them was ever called: the sandbox release cleanup, both engine reconciliations, and the registry's retirement of dead roots. The cost:
- release intents stood for nine days, with their containers and volumes still on the machine;
- partial exports accumulated to 627 MB;
- 21 of 43 registrations pointed at directories that no longer existed, which inflated a walk that ran 358 times in six minutes.

The failure is invisible in review, because each half looks finished. That is why the obligation sits on the act's author.