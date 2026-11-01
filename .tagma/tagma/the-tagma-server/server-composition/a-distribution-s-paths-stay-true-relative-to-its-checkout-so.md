---
id: 01a19527-a56d-7b80-817e-c7d3e8755e8d
title: A distribution's paths stay true relative to its checkout, so the installed dev surface finds the app under the origin checkout
ord: 44
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/composition/next.ts
    symbol: appOf
  - kind: file
    ref: apps/tagma/server/src/composition/sources.ts
---
A `Distribution` resolves its checkout from the file that declares it and builds every other path by joining onto that checkout. In a source run those paths are real. In an installed closure the declaring file is bundled, so `import.meta.url` names the bundle and the absolute paths point nowhere. Their layout relative to the checkout still holds, because every path was joined from the same base. The developer door therefore takes the app's place (`appOf`) as a path relative to the checkout and lays it onto the checkout the server answers to, which is the origin checkout of the installation when one is installed. A distribution that wrote one of its paths from another base, such as a `new URL(…, import.meta.url)` next to the declaring file, would send the installed dev surface to the wrong directory.