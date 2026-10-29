---
id: 01a14772-94be-7ff8-bc0b-e21428b1ba88
title: A swift -e argument is wrongly recognized as a file path
ord: 9
tags: ["reflection"]
fields:
  {
    "actual": "The expression ran, but Tagma tried FileSystem.stat on the full Swift program text in the checkout root and appended the footer `the files this command printed could not be told apart ... Unknown: FileSystem.stat (...)`.",
    "command": "bash(command=\"swift -e 'enum J: Equatable { case null, string(String) }; let metadata: [String: J]? = [\\\"function\\\": .null, \\\"name\\\": .string(\\\"web_fetch\\\")]; let value = metadata?[\\\"function\\\"].flatMap { $0 == .null ? nil : $0 } ?? metadata?[\\\"name\\\"]; print(type(of: value), value as Any)'\", waitMs=10000, lifeMs=30000)",
    "expected": "Run the Swift expression and return stdout without trying to interpret the program text as a path."
  }
---
Filed from project `<project>`.
