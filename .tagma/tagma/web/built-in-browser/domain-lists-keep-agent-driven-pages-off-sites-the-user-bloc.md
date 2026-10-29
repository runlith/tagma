---
id: 01a184ec-d6e7-704a-aca7-fdeb14dc7d30
title: Domain lists keep agent-driven pages off sites the user blocked or did not allow
ord: 21
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18433-d315-73f4-812d-a71e5c06e846",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-04644096201b
---
The operator accepted (2026-10-29). Every large competitor limits where an agent's browser may go (Codex, Claude, Antigravity, Gemini CLI, VS Code, Cursor, Kiro); Tagma has nothing, so a page an agent reads can steer it anywhere — prompt injection is the threat it answers. Product shape fixed by the operator's decision:
- Settings per user and per project, project over user: a list of blocked domains and a list of allowed domains, patterns covering subdomains. Both empty — the default — means no limit, so nothing changes for anyone who does not set them. A non-empty allowed list means only those.
- They bind HTTP(S) Document navigation of a page while an agent acts on it — `open_page`, `navigate_page`, and a navigation or popup an agent action causes — in the main frame and in frames. Policy persists until operator input/navigation or a new agent policy; a late blocked navigation is surfaced once at the next agent action. The operator's own navigation is never limited. Non-network documents (`blob:`, `data:`, `about:`) and page fetches/subresources are outside the lists.
- A blocked navigation is a typed refusal naming the domain and the setting that blocked it; nothing is loaded. No per-site prompt.
Decide where enforcement lives so both hosts and every path that starts a navigation are covered without a race (a check before the call is not enough for a click that navigates), and say what the lists do not cover (requests a page makes on its own). Record the capability as a #feature under the Page automation note ab519f0b.