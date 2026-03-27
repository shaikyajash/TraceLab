---
name: TraceLab Next Steps
description: Open issues and planned work as of 2026-03-27
type: project
---

**Critical open issue: Static output_cases can't compute dynamic values.**
When filter_orders receives 3 orders (2 blacklisted, 1 valid), the output should show `skipped_blacklisted: 2` and only pass through the 1 valid order. But output_cases are static templates — they always return `skipped_blacklisted: 1` regardless of input.

**Planned fix:** Add a `compute` capability to nodes — small JavaScript expressions or filter/map/reduce operations that run on the input at simulation time. This would allow:
- Filtering arrays (remove blacklisted orders)
- Counting elements (how many were skipped)
- Computing derived values (total amount, elapsed time)

**Other open items:**
- Local path scanning (user wants `{"path": "/Users/lohit/Desktop/office/order-monitor"}` in addition to git URLs)
- The order-monitor.tracelab.json still has ~46 validation errors from the LLM generation
- Retry on Phase 2 connection errors (output_cases generation failed with "Connection error")
- Traces need redesign — each distinct order state (HardFail, UserInitiated, CobiInitiated, etc.) should be a separate trace, not one mega-trace with all states
