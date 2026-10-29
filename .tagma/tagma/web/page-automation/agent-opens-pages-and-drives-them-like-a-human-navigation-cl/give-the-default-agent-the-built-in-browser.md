---
id: 01a14c37-8e6a-7661-a5b2-594749d0c505
title: Give the default agent the built-in browser
ord: 1
tags: ["idea"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-04644096201b
---
The `tagma` agent does not hold the `browser` capability, and `extends` cannot add it; browser tools exist only for file-defined agents, foreign CLIs, and plugins. Because of this, five browser features stand at partial while spec f3ea399e promises the opposite. Deferred tools would barely grow thread startup. Decide: all `tagma` agents or a separate type.
