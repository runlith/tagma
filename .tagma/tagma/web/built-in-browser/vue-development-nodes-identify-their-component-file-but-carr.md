---
id: 01a184fc-2b2f-7bf9-9a8b-8c04f022acb2
title: Vue development nodes identify their component file but carry no template line
ord: 24
tags: ["research"]
fields:
  {
    "source": {
      "name": "Vue and Vite's Vue plugin",
      "ref": "vue@3.5.44 and @vitejs/plugin-vue@6.0.10"
    }
  }
---
Vue 3.5.44 attaches `__vueParentComponent` to DOM elements in development and in production builds that enable production devtools. Its internal instance's type carries `name` or `__name`; Vite Vue plugin 6.0.10 supplies `__file`, with the full filename in development and only a basename for production devtools. Neither that instance metadata nor its vnode gives an element source line. Development instance contexts define `_` as an accessor through `createDevRenderContext`, whereas production contexts hold `_` as a data property; a reader can distinguish these without invoking it. Sources: [renderer](https://raw.githubusercontent.com/vuejs/core/v3.5.44/packages/runtime-core/src/renderer.ts), [instance construction](https://raw.githubusercontent.com/vuejs/core/v3.5.44/packages/runtime-core/src/component.ts), [development context](https://raw.githubusercontent.com/vuejs/core/v3.5.44/packages/runtime-core/src/componentPublicInstance.ts), [Vite Vue plugin](https://registry.npmjs.org/@vitejs/plugin-vue/-/plugin-vue-6.0.10.tgz). This is a source reading.