---
id: 01a189d1-58cf-7a28-b84e-4bb4320bb563
title: Every language-model call in Tagma is a thread run through the one thread mechanism; no second way of calling a model exists
ord: 1222
tags: ["rule"]
---
A title, a recap, a decision, a summary, a translation or any other model call runs as a thread: one the operator sees, a child, or a background thread nobody sees, born and run the way every thread is, through one entry point. Such threads differ only in the arguments of that entry: shown or not, a title or none, the agent's full prompt, a short one or none, tools or none. They never differ in the mechanism. So any provider and transport the model picker offers serves it, chosen with that same picker: an API key, Claude Code, the Claude SDK, any other harness. Never a separate one-shot call, a wire call beside the thread engine, or a second list of models that can be called.