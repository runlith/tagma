---
id: 01a132c3-00df-762e-9f7a-610b8fcce3ab
title: In tagma:try, workload spans persist but metrics and overview over its window are empty
ord: 12
tags: ["reflection"]
fields:
  {
    "actual": "overview answered observed:null, samplesRead:0, series:[]; metrics of both names also hours:[] , although slow kept CheckoutStatus.reading of the same instance 605c989a-0f9a-46b7-a187-ce114fbd9450 inside the window. Re-reading after several 60-second cadences stayed empty.",
    "command": "POST http://127.0.0.1:19557/api/op/read_performance {\"type\":\"overview\",\"since\":1791852644630,\"until\":1791852654546,\"limit\":100}",
    "expected": "The count of completed Git.spawn/CheckoutStatus.reading for the controlled workload, or an explicit reason why histogram evidence misses the window."
  }
---
Filed from project `runlith`.

A separate tagma:try e5c03f441f-dirty 20261013T004720955Z, root /var/folders/87/cmcr9wbs5yqcbthnzgqp7lh80000gn/T/tmp.xFKamp4C3c. Workload: four checkouts, twelve new commits into busy in ~9.9 s, worktrees.subscribe and checkout.subscribe held. Span a33024ca40efc: wallTime 1791852650941, checkout.reason refs, ~366 ms. In a neighboring wider metrics since 1791852000000 a count of 59 exists, but whether these snapshots belong to the workload is undetermined. The reason for missing metrics is undetermined so far; paired counts need full span persistence on the try instance.
