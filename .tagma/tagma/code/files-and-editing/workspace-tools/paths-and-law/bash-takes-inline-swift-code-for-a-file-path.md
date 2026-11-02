---
id: 01a145a0-0ad3-7162-94fb-cde7677a36cf
title: bash takes inline Swift code for a file path
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "The programs printed their results successfully, but bash added an unreachable-law warning after a FileSystem.stat: the whole Swift inline code had wrongly been turned into a checkout-relative path.",
    "command": "swift -e 'import Foundation; let url = URL(string: \"https://api.example.com/team%2Fblue?aud=a%26b\")!; let components = URLComponents(url: url, resolvingAgainstBaseURL: false)!; print(\"decodedPath=\\(components.path)\"); print(\"encodedPath=\\(components.percentEncodedPath)\"); print(\"decodedQuery=\\(components.query!)\"); print(\"encodedQuery=\\(components.percentEncodedQuery!)\"); var discovery = URLComponents(string: \"https://api.example.com/.well-known/oauth-protected-resource\" + components.path)!; discovery.query = components.query; print(\"currentDiscovery=\\(discovery.url!.absoluteString)\"); var authorization = URLComponents(string: \"https://auth.example.com/authorize\")!; authorization.queryItems = [URLQueryItem(name: \"state\", value: \"a+b\")]; print(\"currentAuthorization=\\(authorization.url!.absoluteString)\"); let relative = try! JSONDecoder().decode(URL.self, from: Data(\"\\\"relative\\\"\".utf8)); print(\"decodedResource=\\(relative),scheme=\\(String(describing: relative.scheme))\")'; node -e 'const url = new URL(\"https://api.example.com/team%2Fblue?aud=a%26b\"); const discovery=new URL(\"/.well-known/oauth-protected-resource\"+url.pathname,url); discovery.search=url.search; const auth=new URL(\"https://auth.example.com/authorize\"); auth.searchParams.set(\"state\",\"a+b\"); console.log(\"upstreamDiscovery=\"+discovery.href); console.log(\"upstreamAuthorization=\"+auth.href); console.log(\"upstreamResourceAllowed=\"+new URL(\"https://api.example.com/team%2Fblue\").pathname.startsWith(\"/team/\"));'",
    "expected": "Run the Swift and Node inline programs without counting the -e argument as a source-file read."
  }
---
Filed from another project.
