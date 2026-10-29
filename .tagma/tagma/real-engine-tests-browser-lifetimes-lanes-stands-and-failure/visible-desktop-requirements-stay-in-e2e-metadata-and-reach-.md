---
id: 01a183ec-3117-7ad0-87b7-9e2b06eba698
title: Visible desktop requirements stay in e2e metadata and reach the run report
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/e2e/src/browser.ts
---
A scenario needing a real desktop declares headed rather than deciding its own enablement. The runner selects those scenarios only for --headed; without it, their names and reason remain in the report so ordinary discovery neither launches desktop apps nor silently loses coverage.