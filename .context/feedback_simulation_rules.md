---
name: Simulation Rules & Feedback
description: Critical rules learned from debugging — chain awareness, struct parity, when conditions, array merging, non-server support
type: feedback
---

1. output_cases match conditions must reference UPSTREAM output fields, never original request body or config values (client, timeout, settings, interval, cache).
**Why:** The simulation chain passes output→input between steps. If step N checks "settings.timeout" but step N-1 outputs "ok, orders", the condition never matches.
**How to apply:** Always verify match fields exist in the previous step's output.

2. Never flatten Rust struct nesting in output_cases. If code accesses order.create_order.create_id, output must have {"create_order": {"create_id": "x"}}, NOT {"create_id": "x"}.
**Why:** User hit this repeatedly — filter_orders output had flattened fields, check_order_state couldn't find create_order.
**How to apply:** Look at source_code field access patterns.

3. Arrays from user input must REPLACE template arrays in mergeInputIntoOutput.
**Why:** Bug where template's hardcoded array was kept and user's edited array was thrown away. is_blacklisted changes had no effect.
**How to apply:** When both template and input have arrays for the same key, use the input array.

4. `when` conditions must be evaluated at RUNTIME against CURRENT payload, not pre-filtered at trace resolution.
**Why:** User edited is_blacklisted at step N but the when condition was pre-evaluated against the original request.
**How to apply:** trace-resolver returns ALL steps, simulation loop evaluates when per step.

5. input_mapping is needed when function A's output shape ≠ function B's input shape. But adaptInput() with deepFind provides automatic fallback.
**Why:** filter_orders outputs {orders: [...]} but check_order_state expects a single {create_order, source_swap}.
**How to apply:** Use input_mapping for explicit extraction, adaptInput for automatic.

6. Blacklisted orders in real code are silently skipped (continue), NOT rejected. The function returns Ok(()). The chain should continue with empty orders, not terminate.
**Why:** User pointed out that filter_orders doesn't error on blacklisted — it just skips them.

7. Entry points are NOT just HTTP route_handlers. CLI tools, cron jobs, background processes, message consumers all need traces.
**Why:** User has order-monitor (background worker), not an HTTP server.
**How to apply:** Check all node kinds as potential entry points.

8. The system is for investor demos — repos are selected by investors. Speed and correctness are critical. The scan was taking 6+ minutes which is too slow.
**Why:** Added parallel processing and artifact persistence to handle this.
