---
id: 01a123d2-9480-7277-ae47-3c985a6bfa35
title: "Plugins, stage 3: the “CRM” acceptance — a section, a card panel, agent and view tools, a resource with a subscription; a section in the native window and in the mobile shell"
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a123b1-e4fa-70e2-a55d-2416fa22ef2f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
sources:
  - kind: dir
    ref: .plugins/crm
---
Stage-3 spec acceptance: the “CRM” plugin is assembled with changes to its own `.plugins/crm/` package only; when Tagma is needed, work returns to its owner.

What the plugin must show: a process with its own database in `TAGMA_PLUGIN_DATA`, data split by the caller's `projectId`; a section with a direct URL `/[project]/p/crm/crm` (contacts, deals, notes); a contact-card panel; `agents`-audience tools (an agent finds and adds contacts, deferred) and `view`; a resource with a subscription through which a contact an agent adds on “add contact X” appears in the open section with no reload; section and panel recovery after page reload.

Also close the unverified after [[e2355ba2]]: a section from the desktop native window and a rail item in the mobile shell. Checked on its own instance, not the main checkout.

Check result. Native window: a click in the card window moved the main window to the CRM section. Mobile shell: no rail, the plugin's section answers “Open Tagma on your computer”, like any non-home section. A live agent: Muse, asked to “add contact Grace Hopper”, called `tool_search`, then `plugin__crm__search_contacts` and `plugin__crm__add_contact`, and the contact appeared in the open section with no reload. The live run caught a defect: a plugin's agent with `capabilities: []` received no `agents`-audience tools (answered “tools are not available”); they need the `plugins` capability, fixed in `agents/assistant.md`. Unverified on a real model: the section and panel in the runlith project on desktop; the host does not cut off another project's view resource reads ([[b2c7cbe2]]).

Done when: the plugin is installed and enabled in a trial project, everything listed verified live (web, Electron Tagma Dev over CDP, mobile widths), the package's tests pass, the Sol xhigh review taken apart; what is unproved named in the finish.
