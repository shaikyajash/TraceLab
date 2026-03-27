---
name: LLM Provider - OpenAI Only
description: TraceLab uses OpenAI (GPT-5.4) exclusively for all LLM calls — scanning, output_cases, traces, repair
type: reference
---

TraceLab uses **OpenAI only** (GPT-5.4-2026-03-05) as the LLM provider.

**Configuration:** Set via `setProvider('openai')` in `src/lib/llm.ts`
**Token limits:** `SOURCE_CHAR_LIMITS.openai = 1_600_000` chars (~400k tokens) per chunk
**Model:** gpt-5.4 with 1M context, 128k output

All 3 phases (structure, output_cases, traces) and all repair loops use this same provider.

**Why:** This is the production setup for investor demos. Do not suggest switching to Claude or Gemini.
