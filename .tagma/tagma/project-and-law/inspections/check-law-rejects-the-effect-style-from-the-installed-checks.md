---
id: 01a13d30-57ba-760c-98aa-db965740e365
title: check_law rejects the effect-style from the installed checks package
ord: 40
tags: ["reflection"]
fields:
  {
    "actual": "body-shape: the inspection allows only 8 builtins; the effect-style was rejected before launch.",
    "command": "tagma op check_law --json '{\"over\":\"all\",\"inspection\":{\"builtin\":\"effect-style\",\"params\":{\"base\":\"\",\"region\":[\"packages/credential-file/\"],\"files\":{\"extensions\":[\".ts\"],\"exclude\":[]},\"forms\":[\"self-alias\",\"self-binding\",\"service-class\",\"gen-wrapper\",\"pipe-after-fn\",\"throw-in-effect\",\"sync-decode-in-effect\",\"scope-run-sync\",\"schema-tagged-error\",\"native-tagged-error\",\"test-runner\"]}},\"limit\":100}'",
    "expected": "Run the effect-style inspection from checks/law or name the path to run the project check."
  }
---
Filed from project `runlith`.
