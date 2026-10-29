---
id: 01a1878d-aaae-71b3-8f4a-006dfdad616c
title: import_cookies copies a whole browser profile when only one site's sign-in is needed
ord: 49
tags: ["reflection"]
fields:
  {
    "actual": "The import has no domain selection: it wrote 5184 cookies of about 700 domains, the operator's mail, banking, social and work sessions among them, into the agent profile for one npm form",
    "command": "import_cookies {profile: \"agent\", browser: \"chrome\", browserProfile: \"Default\"} to sign in to npmjs.com",
    "expected": "A way to import the sign-in of the one site the work needs (npmjs.com), leaving every other site's cookies in the browser"
  }
---
Filed from project `dromon`.

The operator asked to create an npm organization, a website-only act. Nothing in import_cookies' input narrows the copy to a domain, so an agent that needs one sign-in either copies everything or asks the operator to sign in by hand inside Tagma. A `domains` filter (the site and its parents, as the replace rule already computes) would make the narrow import the natural call.