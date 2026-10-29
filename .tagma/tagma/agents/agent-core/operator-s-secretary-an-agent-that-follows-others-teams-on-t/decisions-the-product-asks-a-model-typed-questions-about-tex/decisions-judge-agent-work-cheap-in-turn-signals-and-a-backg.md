---
id: 01a16503-2038-72ab-9b6b-2a48f9cb59ed
title: "Decisions judge agent work: cheap in-turn signals and a background judge with recommendations"
ord: 3
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
Decisions ([[8105540f]]) make a cheap model question about text a shared product capability. So far only the "addresses a human" event uses it. The operator asked whether the agents' own work could be judged the same way.

Idea — two different things.
- **In-turn signals.** Narrow yes/no questions on an agent's last turn: whether it loops, whether the turn should go to review, what kind of failure. They fit decisions directly. Cost is one cheap call per turn, on subscription or via OpenRouter.
- **Background judge with recommendations.** A model looks at an agent's turns and suggests how to fix the work. The payoff is unproven, yet it would charge on every step. Decision models take 32–64k input tokens — they see the last step, not the whole job.

What would help decide. An experiment with measurements on matched tasks with and without the judge: turns to result, rework share, spend. For signals: label real turns and compare against the model answer. For a per-turn judge, price and speed matter; subscription-light models or decision models (Jev, Mercury) may fit better than a light subscription model.
