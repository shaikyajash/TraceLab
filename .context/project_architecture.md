---
name: TraceLab Architecture
description: Complete architecture overview of TraceLab — 3-phase pipeline, simulation engine, key files, and known limitations
type: project
---

TraceLab is a visual code analysis and simulation tool for Rust microservices.

**3-Phase Pipeline** (src/lib/claude.ts):
- Phase 1: Structure extraction (nodes, edges) — chunked by file size, parallel
- Phase 2: Output cases + input schemas — per entry point, parallel
- Phase 3: Traces — per entry point, parallel
- Each phase persists artifacts (src/lib/artifacts.ts) for fault tolerance

**Simulation Engine** (src/lib/simulation.ts):
- adaptInput() transforms prev output to match next node's expected shape
- resolveNodeOutput() validates input_schema, then evaluates output_cases
- mergeInputIntoOutput() replaces template values with actual user values (including arrays)
- when conditions evaluated at RUNTIME per step, not pre-filtered at trace resolution

**Known Limitation**: output_cases are static templates — they can't count array elements, filter lists, or compute derived values dynamically. mergeInputIntoOutput handles value replacement but not computation.

**Why:** This is for investor demos — scanning repos selected by investors, so speed and correctness matter.
