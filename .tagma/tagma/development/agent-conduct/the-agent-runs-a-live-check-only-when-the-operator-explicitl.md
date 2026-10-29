---
id: 01a1702a-d36c-7ded-95b9-0825c6569513
title: The agent runs a live check only when the operator explicitly asked for it in the task or allowed it on an explicit question
ord: 11
tags: ["rule"]
---
A live check is any launch of the product or a browser for verification:
- Chrome, Chromium and headless browsers outside testbed;
- Playwright and home-made e2e outside testbed;
- the iOS Simulator and a headed browser;
- chrome-devtools;
- `tagma:try`;
- its own dev server for capture or inspection.

Without it in the task, the agent verifies code without launching, or asks permission.

A headless e2e or stand file under testbed (`*.e2e.ts`, run by `test:e2e`, with its own profile and the mock keychain, no window and no system dialog) is a test, not a live check: the agent runs the e2e files it wrote or its change affected, like itests.
