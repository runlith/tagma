---
id: 01a193d9-9a1f-79e8-9f71-7a9a3db51a62
title: The cut takes source roots, channel, brand, signing, client config, feed address and publisher from the descriptor
ord: 4
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a19371-d3c3-70d3-886f-04320ac072c1
  - kind: waits-on
    to: 01a193d9-9a1f-79e8-9f71-7a97bd02efd7
---
Item 10 of [[0ac072c1]]. `checkoutOf`, the channel constants and `FEED_REPOSITORY` stop being constants; notarization stays in the cut; publishing becomes the descriptor's publisher. A cut whose descriptor names no feed reads only `release.feed`.