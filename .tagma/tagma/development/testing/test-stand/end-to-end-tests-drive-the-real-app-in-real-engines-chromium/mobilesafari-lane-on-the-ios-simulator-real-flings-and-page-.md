---
id: 01a18353-faf9-7ec5-8d39-1590cc47fdde
title: "MobileSafari lane on the iOS Simulator: real flings and page-side recording under testbed"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18358-6882-7146-96af-279f8f0fbb3e",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a18353-4910-704e-8b7d-d7f17111dc21
---
Part 5 of [[7111dc21]]: drive MobileSafari on the iOS Simulator, iOS 26 and iOS 27 runtimes, with gestures that produce real momentum and a page-side per-frame recorder whose results reach the test. The tooling is chosen from the e2e research report. The operator allowed the Simulator runs and installing the iOS 27 runtime (2026-10-28). Delivery is the measured iOS 26 lane with the runtime parameter selecting any installed iOS runtime. Safari onboarding uses real taps on accessibility-named controls, once per runtime and run; the shutdown template is published as run-world data, while its private device set and run-identity ledger live beside the pinned tool cache so testbed cannot sweep them before CoreSimulator retires them. Scenarios clone it and shut down/delete their clone in scope. Before preparing a template, the next iOS lane start retires private sets of runs testbed identifies as dead through CoreSimulator shutdown/delete; it never recovers a live run's set or the default set. Delivery proved killed-worker recovery through that path; the final native sample cloned in 5.45 s and booted in 11.10 s. After one independent review, the serial Simulator lane passed 11 assertions covering fragment navigation, native momentum/write interruption, mapped taps and keyboard geometry; its registrar conformance proved startup Error and unhandled Error-rejection failures. Desktop verification preserved both Error failures and ordinary non-fatal diagnostics. iOS 27 is unproved: the installed Xcode 26.0.1 on macOS 26.0.1 offers no iOS 27 runtime download; no host upgrade is authorized.