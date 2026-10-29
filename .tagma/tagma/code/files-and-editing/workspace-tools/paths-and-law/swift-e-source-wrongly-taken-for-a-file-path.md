---
id: 01a14780-c7de-7314-ab8e-a02f37a829c5
title: Swift -e source wrongly taken for a file path
ord: 12
tags: ["reflection"]
fields:
  {
    "actual": "Both experiments completed, but the answer appended Unknown: FileSystem.stat for /opt/workspaces/<project>/import Foundation; for point: UInt32 ... — the full Swift -e source argument wrongly taken for a file path.",
    "command": "bash: swift -j 3 -e 'import Foundation; for point: UInt32 in [0xFEFF, 0x0085] { let edge = String(UnicodeScalar(point)!); let value = edge + \"{}\" + edge; print(String(format: \"Swift U+%04X:\", point), value.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars.map { $0.value }) }'; node -e 'for (const point of [0xFEFF, 0x0085]) { const edge = String.fromCodePoint(point); console.log(`JS U+${point.toString(16).toUpperCase()}:`, Array.from((edge + \"{}\" + edge).trim(), c => c.codePointAt(0))); }'",
    "expected": "Run both inline-source experiments and return the result without interpreting source arguments as filesystem paths."
  }
---
Filed from project `<project>`.
