---
id: 01a184fc-1a69-75b0-a196-c25e4bdcb1c0
title: React 19 keeps the JSX creation stack instead of a source-location field
ord: 22
tags: ["research"]
fields:
  {
    "source": {
      "name": "React and React DOM",
      "ref": "react@19.3.1 and react-dom@19.3.1, published npm tarballs"
    }
  }
---
In React and React DOM 19.3.1, a rendered DOM node's `__reactFiber$…` points to its host fiber. Development fibers copy `_debugOwner` and `_debugStack` from their element; the owner's type gives the component name, while the host fiber's Error stack gives that element's JSX call site. `_debugSource` is absent in the inspected React DOM 19.0.0–19.3.1 builds; `_debugStack` begins in 19.1.0. Production fibers omit these debug fields. The stack reports executed module coordinates, with no source-map mapping by React, and a capture budget can leave no user frame. Sources: [React 19.3.1](https://registry.npmjs.org/react/-/react-19.3.1.tgz), `cjs/react-jsx-dev-runtime.development.js`; [React DOM 19.3.1](https://registry.npmjs.org/react-dom/-/react-dom-19.3.1.tgz), `cjs/react-dom-client.development.js`. These are source readings, not a framework runtime experiment.