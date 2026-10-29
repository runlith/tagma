---
id: 01a135f9-6939-76fb-8f06-2df3e95c70f1
title: "write_setting has no project: a thread cannot set another project's setting, and the CLI from that project's cwd writes the thread's home instead"
ord: 10
tags: ["reflection"]
fields:
  {
    "actual": "The MCP door offers no project; the CLI refuses `project` as unknown; the CLI from polygon's cwd answered ok but wrote enforcement.programs=tools into runlith (the thread's home), silently — the answer named no project. Undone by hand with a second write_setting.",
    "command": "write_setting {key:\"enforcement.programs\", value:\"tools\"} for project polygon from a thread homed in runlith: MCP door has no `project`; `tagma op write_setting --json '{...,\"project\":\"polygon\"}'` → body-shape; same CLI call with cwd /opt/workspaces/polygon",
    "expected": "write_setting takes `project` like other place-carrying operations (any-project spec 1013e071), or the CLI call from polygon's checkout writes polygon's scope"
  }
---
Filed from project `runlith`.

Cost: one wrong durable write into runlith settings, discovered only by reading both projects' settings back. The settings door is outside the place-carrying set the any-project work made (`Operation.place`), so the CLI call is attributed by the session grant to the home project while its cwd says otherwise, and the answer does not name which project it wrote.