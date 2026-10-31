---
id: 01a13235-8df2-723d-ae81-1ea142e8ab57
title: A Holdings request is only answered by a judge that started reading inputs after that request
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/judge.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/requests.ts
---
A Holdings request is only answered by a judge that started reading inputs after that request.

A batch collects its waiters before reading inputs. A request arriving while its fold runs stays for the next batch: the previous judge may already have read old bytes or the old digest of a glued record. Finishing the old batch never releases the new request's wait. On a drain defect both queues are dropped before their waiters resolve: an arrival during resolution stays in the new queue.
