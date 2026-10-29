---
id: 01a14732-8753-74a0-9b53-956604f3d109
title: Saved command stdout is unsearchable without hand-decoding base64 pages
ord: 23
tags: ["reflection"]
fields:
  {
    "actual": "read_output returned only the last 50 KB tail with the totals and no failed test name. All 765,101 bytes of stdout were saved with no gap, but read_command_bytes capped the request at 800,000 bytes in 65,536-byte base64 pages. Several reads produced no full-text path for grep; diagnosing it took rerunning the whole suite with rg.",
    "command": "read_output({\"execution\":\"4b833b2b-6a0d-4ca9-abbf-581baf8aeba5\",\"incarnation\":167,\"tail\":20000})",
    "expected": "Find the single failure of the full test run in the saved stdout without running the suite again."
  }
---
The suite reported 3913 tests in 507 suites and one issue. A bounded search over the saved stdout, or an available grep path to the full text, would have avoided decoding about twelve base64 pages and rerunning the process.
