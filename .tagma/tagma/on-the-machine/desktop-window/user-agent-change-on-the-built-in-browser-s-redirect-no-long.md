---
id: 01a16419-c6c6-7e63-baa1-01d0bf0cf42f
title: User-Agent change on the built-in browser's redirect no longer destroys the active navigation
ord: 24
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16414-0ed5-7efb-a113-f0ade4cff1d8",
    "status": "done"
  }
---
Eliminate the Electron native crash on HTTP redirect through Google Sign-In. In Electron-2026-10-22-164245.ips (PID 44385, line 52) the Framework UUID 4C4C44EE55553144A10B83864755FFEE0 symbols give the chain DidRedirectNavigation (+46575400) → SetUserAgent (+46547336) → SetUserAgentOverride (+81986508) → Reload (+80574444) → NavigationRequest::~NavigationRequest (+22387488), CHECK(is_safe_to_delete_). A synthetic HTTPS redirect on the original HeldPage gave SIGTRAP/exit 133; after the fix the system test passes transitions into Google and back without repeated requests, and a separate HTTPS probe confirms Chrome→Firefox→Firefox→Chrome headers. Real OAuth was not run; an early script after redirect still sees the previous JS UA until loading completes.
