---
id: 01a14825-e0f8-742d-990d-0527fc414708
title: Inline Swift source is misdetected as a file path
ord: 6
tags: ["reflection"]
fields:
  {
    "actual": "The command successfully printed two arrays of numbers, but the tool added Unknown FileSystem.stat for /opt/workspaces/<project>/import Foundation; let data = ... and reported that the printed files cannot be told apart, although the output contained no files.",
    "command": "bash({command: \"swift -e 'import Foundation; let data = Data(#\\\"{\\\"value\\\":\\\"\\\\ufeff Trim \\\\ufeff\\\"}\\\"#.utf8); let object = try JSONSerialization.jsonObject(with: data) as! [String: Any]; let text = object[\\\"value\\\"] as! String; print(Array(text.unicodeScalars.map(\\\\.value))); struct Element: Decodable { let value: String }; let model = try JSONDecoder().decode(Element.self, from: JSONSerialization.data(withJSONObject: object)); print(Array(model.value.unicodeScalars.map(\\\\.value)))'\", description: \"Localize the BOM loss in Foundation decoding\"})",
    "expected": "Return the output of the inline Swift process without treating the source-code argument as a file path."
  }
---
Filed from another project.
