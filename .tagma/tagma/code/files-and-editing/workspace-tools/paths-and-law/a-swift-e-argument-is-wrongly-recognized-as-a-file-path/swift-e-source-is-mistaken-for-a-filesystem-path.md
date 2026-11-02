---
id: 01a14829-1a87-774f-90f1-c06d1156c84e
title: swift -e source is mistaken for a filesystem path
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "The command succeeded, but the footer attempted FileSystem.stat on the whole Swift expression under /opt/workspaces/<project> and reported that printed files could not be told apart.",
    "command": "swift -j 3 -e 'import Foundation; let data = Data(\"{\\\"a\\\":\\\"first\\\",\\\"a\\\":\\\"last\\\",\\\"n\\\":9007199254740993}\".utf8); struct Payload: Decodable { let a: String; let n: Double }; let value = try JSONDecoder().decode(Payload.self, from: data); print(value.a, value.n); let dictionary = try JSONDecoder().decode([String: String].self, from: Data(\"{\\\"a\\\":\\\"first\\\",\\\"a\\\":\\\"last\\\"}\".utf8)); print(dictionary)'",
    "expected": "Run the Swift expression and report its stdout without treating program source as a file path."
  }
---
Filed from another project.