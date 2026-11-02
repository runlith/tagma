---
id: 01a1469b-81c6-7c1d-88ed-8307ae7bdefc
title: Swift -e expression wrongly recognized as a file path
ord: 11
tags: ["reflection"]
fields:
  {
    "actual": "The probe completed, but Tagma added Unknown: FileSystem.stat for /opt/workspaces/<project>/import Foundation; let regex = ... and a message that the printed files could not be told apart. The -e operand requests no file.",
    "command": "bash({command: \"swift -e 'import Foundation; let regex = try NSRegularExpression(pattern: #\\\"^gpt-([0-9]+)(?:\\\\.([0-9]+))?(?:-([^\\\\n\\\\r\\\\u2028\\\\u2029]+))?\\\\z\\\"#); for value in [\\\"gpt-5\\\\n\\\", \\\"gpt-5.٦\\\", \\\"gpt-5-a\\\\u{0085}\\\", \\\"gpt-5-chat\\\\u{0301}\\\", \\\"gpt-18446744073709551616\\\"] { let match = regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)); print(value.debugDescription, match != nil) }; print(\\\"overflow\\\", Double(String(repeating: \\\"9\\\", count: 400)) as Any); print(\\\"ASCII prefix\\\", \\\"gpt-4\\\\u{0301}\\\".utf8.starts(with: \\\"gpt-4\\\".utf8))'\", waitMs: 120000, description: \"Probe corrected regex numeric and ASCII semantics\"})",
    "expected": "The argument after Swift -e is recognized as source code; a successful probe answers without trying to treat inline code as a filesystem path."
  }
---
Filed from another project.
