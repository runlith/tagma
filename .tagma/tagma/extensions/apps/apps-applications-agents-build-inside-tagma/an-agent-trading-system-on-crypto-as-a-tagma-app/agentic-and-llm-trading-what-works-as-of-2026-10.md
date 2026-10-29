---
id: 01a11df3-740a-7b6d-90cc-529c7a91ed06
title: "Agentic and LLM trading: what works as of 2026-10"
ord: 1
tags: ["research"]
fields:
  {
    "source": {
      "name": "arXiv/SSRN (TradingAgents, Profit Mirage, Alpha Illusion, StockBench and others), nof1 Alpha Arena, GitHub, Man Group, Two Sigma, Bridgewater, Bybit, Binance, OKX, Alpaca, CoinDesk and Bloomberg blogs; read 2026-10-08",
      "ref": "https://arxiv.org/abs/2510.07920"
    }
  }
---
Read 2026-10-08. Ten research agents (Muse) read arXiv and conference papers, GitHub, official firm and exchange blogs, and the press. Return figures are self-reported by the authors unless stated otherwise. No product was run by hand.

## Bottom line
There is no verifiably profitable autonomous LLM trader on live money — not in research, open source, crypto projects, or funds. What works is the pairing "LLM researches and debates — deterministic code executes and cuts risk".

## Research
- TradingAgents (arXiv:2412.20138): analysts, bull/bear debates, trader, risk team. Claimed around +24% over 3 months of 2024 on three stocks, no costs, 11 LLM calls per decision. An independent rerun on the same AAPL window gave −25% (GitHub issue #119, 2025-07-08).
- Profit Mirage (arXiv:2510.07920): 5 frameworks lose 51–62% of Sharpe past the model training date. Models remember 2022–2023 prices with 85–93% accuracy.
- Alpha Illusion (arXiv:2605.16895): a year of data with all costs — TradingAgents and QuantAgent underperform buy-and-hold. Debates win in fewer than 20% of setups.
- Audit of 77 papers (arXiv:2605.19337): of 19 with trading, one has a cost model, none are reproducible.
- Ablations show tools with external data and reflection help (CryptoTrade without reflection −11 pp). A persuasion attack breaks the researcher in 42–53% of cases, a risk-manager jailbreak in the prompt in 96–99% (arXiv:2608.24069).
- Instability: 360 runs of one prompt produced 13 different trades. Decision determinism 71–86%, tool-chain overlap 20–58% (arXiv:2601.15322).

## Live money and arenas
- Alpha Arena, season 1 (nof1, 2025-10-17 — 11-03, $10,000 per model, Hyperliquid crypto perps): Qwen 3 Max +22%, DeepSeek V3.1 +5%, the rest −31% to −63%. Gemini made 238 trades and gave about 13% of capital to fees, Qwen made 43 trades. Grok 4.20 won season 1.5 on stocks. There is no lasting champion; nof1 itself concluded "LLM shockingly bad at markets".
- StockBench (no leakage, 82 days of 2025): best models +1.9% to +2.4%, worse than holding on a falling market. FINSABER (20 years of data): in rallies LLMs are too cautious, in sell-offs too aggressive.
- Agent architecture matters more than swapping the model (Agent Market Arena, arXiv:2510.11695).

## Open source and commercial products
- ai-hedge-fund (64k stars) and TradingAgents (about 110k) are teaching scaffolds that place no trades. FinRobot: "code counts the numbers, the LLM reasons". Freqtrade (FreqAI is classic ML) and Hummingbot with Condor (LLM decides, execution is deterministic) are mature execution with no edge.
- Exchanges and brokers gave agents MCP and APIs: Bybit AI Hub with an isolated subaccount (5,000 USDT limit, withdrawals forbidden), Binance Agent Skills and Agent OS, OKX OnchainOS, Coinbase AgentKit, Alpaca MCP v2 (61 tools, paper trading). 3Commas, Cryptohopper and Pionex sell bots and LLM builders. Nobody publishes verified P&L; it can only be checked on-chain, for example on Hyperliquid.

## Crypto agents and tokens
ai16z/ElizaOS (peak about $2.5B, shut down 2026-08, lawsuit over an insider-controlled fund), aixbt, Virtuals, Spectral, Almanak, Theoriq, Fetch — tokens down 88–99.9%. Giza (about $20M under agents at the peak) switched its agents off in 2026-02. The real benefit is narrow DeFi automation with limits and confirmations.

## Institutions
Man Group AlphaGPT generates and backtests signals, some in production with human checkpoints. Two Sigma, Citadel, JPMorgan and Bridgewater: the human decides; Ken Griffin — "GenAI is insufficient for alpha". At Bridgewater (2026-06) frontier models scored under 80% on expert tasks, a fine-tuned Qwen3-235B scored 84.7% at 14x cheaper inference.

## Where a small player has an edge
- Token unlocks: 88.5% of large ones on Binance are down within 72 hours, averaging −17% (SSRN, 2026); data is free (Tokenomist, DefiLlama).
- First listings average −5% to −19% over 7 days; the exception is Korean KRW listings.
- Funding carry is 10–20% annually with automation.
- Eaten: cross-exchange arbitrage (top-3 players take 73–90%), fast Polymarket markets. On-chain and sentiment are filters, not signals. Narrative rotation works only with diversification.
- A small player's data costs $150–400 a month.

## Failures and economics
- Freysa gave away $47k after its transfer function was redefined in conversation; aixbt lost 55 ETH through the dashboard; the Lobster agent sent 5% of a token's supply over a decimals confusion.
- Realistic costs turn Sharpe 2.0 into 0.6. A retail bot on flagship models with a 5-minute loop spends about $10 a day for about $2 of profit. An unsupervised live LLM trader made +0.32% over 46 days and went negative after paying for the models.

## Market and law, autumn 2026
- BTC around $83.5k, −34% from the top, moving sideways.
- A private person needs no license to trade their own money with their own bots in the EU, the US and Serbia. In Russia from 2027-07-01 residents trade only through licensed intermediaries; for the unqualified under the central-bank draft — a liquid list and ₽300k a year.
- Taxes: Serbia 15% on the difference, Russia 13–15%, Germany 0% when held longer than a year.

## What is not established
Audited P&L of any agentic crypto fund for 2025–2026; which model is better for which role; signal accuracy of aixbt-like systems.
