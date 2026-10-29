---
id: 01a184f6-7e28-76a9-ac9f-1320bda7c3b4
title: Managed geolocation grants share an origin in one profile and restore it after the last lease
ord: 9
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/managed-browser/permissions.ts
---
CDP grants geolocation at the browser's origin boundary, so a page's scoped override also grants same-origin pages in its profile. Overlapping leases share the grant and retain the permission state read before the first lease; a navigation moves its lease to the new origin. Host-initiated navigation synchronizes its active leases before answering, so its answer includes permission readiness for the committed origin; page-initiated navigation is followed in the background. The final release restores that state rather than resetting all permissions, which would erase unrelated choices.