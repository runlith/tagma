---
id: 01a14035-06ac-7cb1-aa6a-177d7c7984de
title: Performance reading does not accept the saved ring of a detached test host
ord: 6
tags: ["reflection"]
fields:
  {
    "actual": "read_host_performance only selects HostManagement.connection.address.state; there is no input parameter for a saved state/ring. Inspecting test artifacts requires reaching for the public performance reader from sources.",
    "command": "tool_search({\"query\":\"select:read_host_performance,read_performance\",\"max_results\":2})",
    "expected": "Read the saved ring of the test execution host by path with the same bounded query, without launching the host or its own driver."
  }
---
Filed from project `runlith`.
