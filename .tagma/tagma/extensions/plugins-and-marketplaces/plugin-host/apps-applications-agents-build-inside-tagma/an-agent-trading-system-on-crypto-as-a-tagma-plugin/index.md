---
id: 01a11df3-5c56-7be9-97bc-f26bad354a78
title: An agent trading system on crypto as a Tagma plugin
ord: 3
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
Question: build an agent trading system, crypto first, on horizons from hours to weeks. A team of agents studies the market, argues, offers trades, and reflects on results through testable hypotheses. A real user case for a plugin in Tagma's format: it needs all five parts at once — its own database, scheduled background, narrow agents, in-thread UI, and hard rights.

What works without a plugin: an agent team, a broker via the project's MCP server (MCP is standard at brokers and exchanges), the operator's approval of each order in review mode, a data collector as a held process, a decision journal in the graph. What is missing is what a plugin gives: a positions and PnL database, scheduling with no open thread, a narrow “trader” agent inside the package, a dashboard beside the ribbon.

The design following from the market survey (child research):
- a core of simple testable strategies — token-unlock calendar (short or no long), fading fresh listings, delta-neutral funding carry; the agent superstructure must beat that core after all costs;
- agents research and write hypotheses and strategy code but never press buy/sell themselves; news parsing, narratives, and contrarian sentiment are their work;
- a skeptic with veto power, or rhetoric wins the argument;
- risk only in the tool's code: position and daily-loss limits, a mandatory stop, loop halt on drawdown, a kill switch, keys with no withdrawal and a separate subaccount, reconciliation against the broker's data, not the agent's claim;
- grading: a registry of all attempts (in the graph), Deflated Sharpe and PBO, walk-forward with frozen parameters, data only after the model's training date, paper trading for months, then small money;
- economics: rare loops, cheap models for routine, a capital-size breakeven.

Unknown: whether the superstructure beats the simple core after costs — only paper trading decides. No public verifiable P&L of an autonomous LLM trader on live money was found by anyone as of 2026-10.
