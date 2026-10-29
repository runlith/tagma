---
id: 01a14c37-8e34-792d-b629-eb63cf02611b
title: Fix wording and a minor defect in the Extensions area
ord: 22
tags: ["task"]
fields:
  {
    "status": "open"
  }
---
- Module d50acfdc promises an "on-duty agent every hour" schedule, but only plugins declare schedules, and `read_schedules` has no screen.
- The `skills.disabled` description says the key turns off built-in skills, while the UI calls them "Always offered".
- The link-copy button in Pages on the phone puts a loopback address into the clipboard; switching to the remote door only fires on click.
