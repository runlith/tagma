---
id: 01a18816-519c-7c83-bdca-b990fc92b4ba
title: The single-flight token refresh moves from FileTokenStore into @runlith/credential-file as one primitive
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18816-aaa4-7368-89c5-9a5b0ddb6587",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a184c6-16dd-744f-b710-46e4142a1788
---
From [[142a1788]], Sign-in record → Refresh. The refresh of `FileTokenStore.getAccessToken` and `recoverAccessToken` — one refresh at a time per record, the result stored only if the grant is unchanged, an optional cross-process lock — becomes one primitive of `@runlith/credential-file`, and `FileTokenStore` moves onto it with no behaviour change. The MCP sign-in record uses it next.