---
name: User Profile - Developer
description: Developer role, preferences, and working style for TraceLab project
type: user
---

The developer is building TraceLab for investor demos of Rust microservice repositories. They work with multiple repos in a shared ecosystem (order monitoring, solver engines, credential managers, API key services).

**Working style:**
- Highly direct — expects actionable fixes, not explanations
- Tests changes immediately in a local environment (e.g., localhost)
- Identifies issues using concrete evidence (e.g., screenshots, outputs)
- Rejects placeholder or mocked behavior — expects outputs to reflect real Rust source logic
- Sensitive to repeated failure patterns (e.g., static outputs, broken execution chains)
- Will manually edit JSON artifacts when full rescans are too slow
- Uses a modern LLM stack for code scanning and analysis

**Key preferences:**
- Simulation must be deterministic and input-driven — changes in input must produce observable differences
- Errors must originate from actual source logic, not generic templates
- Non-server repositories (scripts, monitors) must behave with parity to HTTP services
- Performance is critical — long pipelines must be optimized (parallelization preferred)