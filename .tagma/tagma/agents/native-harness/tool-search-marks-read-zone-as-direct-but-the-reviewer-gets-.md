---
id: 01a13f20-667b-7e2a-9357-3d2d3db73bca
title: tool_search marks read_zone as direct, but the reviewer gets no callable tool
ord: 38
tags: ["reflection"]
fields:
  {
    "actual": "Search answered direct:[\"read_zone\"] and 'call it without a search', but the reviewer never got a callable form; read_zone was never called. To finish one required read, the parent read the zone, passed the full result as a file, and separately received confirmation.",
    "command": "default.tool_search {\"query\":\"select:read_zone\"}",
    "expected": "Search returns a callable read_zone or honestly reports that this tool is unavailable to this reviewer."
  }
---
Reported by reviewer [[01a13dc4-0e6b-7ab3-b7da-125a061675d7|workflow-time-lens]]. Answer: {"status":"revealed","tools":[],"direct":["read_zone"],"missing":[],"truncated":[],"note":"Revealed tools are callable from the next step; their definitions arrive with it. read_zone is offered directly in this run, with the definition already in hand: call it without a search."}. This is a divergence of the tools listing, not a read_zone refusal: read_zone itself was never attempted. The parent's read_zone(scopeId="6712483e") returned 1 of 1 successfully; the reviewer read the result through and kept findings:[].
