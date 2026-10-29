---
id: 01a13f7e-5c19-78a5-9ae4-e3f9cf08200a
title: submit_work takes minutes and refuses landing-busy on parallel commits
ord: 18
tags: ["reflection"]
fields:
  {
    "actual": "After several minutes the background call refused landing-busy: the branch changed on each of three attempts, nothing committed. unblock says to wait for a calm checkout, which the agent does not coordinate under the independent-work rule.",
    "command": "submit_work({subject:\"Preserve returned tool refusals and bound heavy telemetry pages\",paths:[\"packages/agent/src/agent/door/AgentToolDoor.ts\",\"packages/agent/src/agent/door/ToolActivity.test.ts\",\"packages/performance/src/protocol/queries.ts\",\"packages/performance/src/protocol/queries.test.ts\",\"packages/performance/src/protocol/reports.ts\",\"packages/performance/src/reports/spans.ts\",\"packages/performance/src/reports/overview.ts\",\"packages/performance/src/ReportPaging.itest.ts\",\".agents/skills/performance/SKILL.md\"],background:true})",
    "expected": "Land own independent lines in the shared checkout during parallel work without repeating the whole heavy judgement when unrelated HEAD files change."
  }
---
