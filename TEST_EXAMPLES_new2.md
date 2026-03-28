# Test Examples for new2.json

Complete test scenarios with input/output examples for the simplified order monitor.

---

## Test 1: Successful Fetch with Mixed Orders

**Scenario:** API returns success with mix of valid and terminal orders

**Input:**
```json
{
  "status": "success",
  "result": [
    {
      "order_id": "0x8f4c2a7b1e9d4c6f0a1234567890abcdef1234567890abcdef1234567890abcd",
      "status": "New",
      "swap": {
        "swap_id": "6b4f9d2e-7c1a-4c3f-a9a1-1a2b3c4d5e6f",
        "status": "pending"
      }
    },
    {
      "order_id": "0x111122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000",
      "status": "UserInitiated",
      "swap": {
        "swap_id": "11111111-2222-3333-4444-555555555555",
        "status": "executing"
      }
    },
    {
      "order_id": "0x9999888877776666555544443333222211110000aaaabbbbccccddddeeeeffff",
      "status": "HardFail",
      "swap": {
        "swap_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "status": "failed"
      }
    },
    {
      "order_id": "0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd",
      "status": "ImproperFill",
      "swap": {
        "swap_id": "123e4567-e89b-12d3-a456-426614174000",
        "status": "filled"
      }
    }
  ]
}
```

**Expected Processing:**
1. ✅ Request status: "success" → request_ok = true
2. ✅ Filter orders:
   - Keep: 0x8f4c... (New)
   - Keep: 0x1111... (UserInitiated)
   - Remove: 0x9999... (HardFail - terminal)
   - Remove: 0xabcd... (ImproperFill - terminal)
3. ✅ Filtered count: 2
4. ✅ Classify remaining orders:
   - 0x8f4c... → OrderState::New
   - 0x1111... → OrderState::UserInitiated
5. ✅ Validate:
   - 0x8f4c... → valid_pending_order = true
   - 0x1111... → valid_pending_order = true
6. ✅ Cleanup: Remove any cached orders not in current batch

---

## Test 2: API Request Failure

**Scenario:** API returns error status

**Input:**
```json
{
  "status": "error",
  "result": [
    {
      "order_id": "0x22223333444455556666777788889999aaaabbbbccccddddeeeeffff00001111",
      "status": "New",
      "swap": {
        "swap_id": "9f8e7d6c-5b4a-3210-1234-56789abcdef0",
        "status": "pending"
      }
    },
    {
      "order_id": "0x3333444455556666777788889999aaaabbbbccccddddeeeeffff000011112222",
      "status": "HardFail",
      "swap": {
        "swap_id": "0fedcba9-8765-4321-0000-111122223333",
        "status": "failed"
      }
    }
  ]
}
```

**Expected Processing:**
1. ✅ Request status: "error" → request_ok = false
2. ✅ Error message: "API request failed with status"
3. ✅ Still filter orders:
   - Keep: 0x2222... (New)
   - Remove: 0x3333... (HardFail)
4. ✅ Filtered count: 1
5. ✅ Format error report with remaining orders

---

## Test 3: Hard Fail Order Classification

**Scenario:** Order with HardFail status is classified and filtered

**Input:**
```json
{
  "status": "success",
  "result": [
    {
      "order_id": "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      "status": "HardFail",
      "swap": {
        "swap_id": "22222222-3333-4444-5555-666666666666",
        "status": "failed"
      }
    },
    {
      "order_id": "0xbeadbeadbeadbeadbeadbeadbeadbeadbeadbeadbeadbeadbeadbeadbeadbead",
      "status": "CobiInitiated",
      "swap": {
        "swap_id": "77777777-8888-9999-aaaa-bbbbbbbbbbbb",
        "status": "processing"
      }
    }
  ]
}
```

**Expected Processing:**
1. ✅ Filter:
   - Remove: 0xdead... (HardFail - terminal)
   - Keep: 0xbead... (CobiInitiated)
2. ✅ Classify 0xdead... (raw order):
   - check_order_state() → OrderState::HardFail
   - check_hard_fail_cases() → is_hard_fail = true
3. ✅ Cleanup with only 0xbead... remaining

---

## Test 4: Invalid Swap Status

**Scenario:** Order with empty swap status fails validation

**Input:**
```json
{
  "order_id": "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "status": "New",
  "swap": {
    "swap_id": "ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb",
    "status": ""  // ← Empty - invalid
  }
}
```

**Expected Processing:**
1. ✅ Order passes filtering (status = "New")
2. ✅ Classify: OrderState::New
3. ❌ Validate: is_valid_pending_order() → false (swap.status is empty)
4. ✅ is_valid_swap() → false

---

## Test 5: Terminal State - UserRedeemed

**Scenario:** Order with UserRedeemed status fails validation

**Input:**
```json
{
  "order_id": "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "status": "UserRedeemed",
  "swap": {
    "swap_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    "status": "redeemed"
  }
}
```

**Expected Processing:**
1. ✅ Order passes filtering (not HardFail or ImproperFill)
2. ✅ Classify: OrderState::UserRedeemed
3. ❌ Validate: is_valid_pending_order() → false (UserRedeemed is terminal)

---

## Test 6: Terminal State - CobiRedeemed

**Scenario:** Order with CobiRedeemed status fails validation

**Input:**
```json
{
  "order_id": "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "status": "CobiRedeemed",
  "swap": {
    "swap_id": "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
    "status": "completed"
  }
}
```

**Expected Processing:**
1. ✅ Order passes filtering (not HardFail or ImproperFill)
2. ✅ Classify: OrderState::CobiRedeemed
3. ❌ Validate: is_valid_pending_order() → false (CobiRedeemed is terminal)

---

## Test 7: Stale Entry Cleanup

**Scenario:** Order disappears from API response between polls

**Poll 1 Input:**
```json
{
  "status": "success",
  "result": [
    {
      "order_id": "0x111111111111111111111111111111111111111111111111111111111111111",
      "status": "New",
      "swap": { "swap_id": "uuid-1", "status": "pending" }
    },
    {
      "order_id": "0x222222222222222222222222222222222222222222222222222222222222222",
      "status": "UserInitiated",
      "swap": { "swap_id": "uuid-2", "status": "executing" }
    }
  ]
}
```

**Poll 1 Processing:**
- Both orders cached
- Cleanup: current_order_ids = [0x111..., 0x222...]

**Poll 2 Input:**
```json
{
  "status": "success",
  "result": [
    {
      "order_id": "0x111111111111111111111111111111111111111111111111111111111111111",
      "status": "New",
      "swap": { "swap_id": "uuid-1", "status": "pending" }
    }
  ]
}
```

**Poll 2 Processing:**
- Cleanup: current_order_ids = [0x111...]
- Remove 0x222... from all caches (no longer in API response)

---

## Test 8: All Terminal Orders

**Scenario:** API returns only terminal orders

**Input:**
```json
{
  "status": "success",
  "result": [
    {
      "order_id": "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0001",
      "status": "HardFail",
      "swap": { "swap_id": "uuid-hf1", "status": "failed" }
    },
    {
      "order_id": "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0002",
      "status": "ImproperFill",
      "swap": { "swap_id": "uuid-if1", "status": "filled" }
    }
  ]
}
```

**Expected Processing:**
1. ✅ Request status: "success" → request_ok = true
2. ✅ Filter: Remove both (both terminal)
3. ✅ Filtered count: 0
4. ✅ No orders to classify or validate
5. ✅ Cleanup with empty result

---

## Test 9: All Valid Pending Orders

**Scenario:** API returns only valid pending orders

**Input:**
```json
{
  "status": "success",
  "result": [
    {
      "order_id": "0x1111111111111111111111111111111111111111111111111111111111111111",
      "status": "New",
      "swap": { "swap_id": "uuid-new", "status": "pending" }
    },
    {
      "order_id": "0x2222222222222222222222222222222222222222222222222222222222222222",
      "status": "UserInitiated",
      "swap": { "swap_id": "uuid-ui", "status": "executing" }
    },
    {
      "order_id": "0x3333333333333333333333333333333333333333333333333333333333333333",
      "status": "CobiInitiated",
      "swap": { "swap_id": "uuid-ci", "status": "processing" }
    }
  ]
}
```

**Expected Processing:**
1. ✅ Request status: "success" → request_ok = true
2. ✅ Filter: Keep all 3 (none are terminal)
3. ✅ Filtered count: 3
4. ✅ Classify all:
   - 0x111... → OrderState::New
   - 0x222... → OrderState::UserInitiated
   - 0x333... → OrderState::CobiInitiated
5. ✅ Validate all: all return true
6. ✅ Cleanup with all 3 orders

---

## Test 10: Settings with Discord Webhook

**Scenario:** Monitor initialized with Discord webhook

**Input:**
```json
{
  "settings": {
    "solver_orders_url": "https://solver.example.com/api/v1/orders",
    "polling_interval": 30,
    "discord_webhook_url": "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz"
  }
}
```

**Expected Processing:**
1. ✅ OrderMonitor::new():
   - $solver_orders_url = "https://solver.example.com/api/v1/orders"
   - $polling_interval = 30
   - $has_discord_webhook = true
2. ✅ Tracing configured with webhook

---

## Test 11: Settings without Discord Webhook

**Scenario:** Monitor initialized without Discord webhook

**Input:**
```json
{
  "settings": {
    "solver_orders_url": "https://solver.example.com/api/v1/orders",
    "polling_interval": 15,
    "discord_webhook_url": null
  }
}
```

**Expected Processing:**
1. ✅ OrderMonitor::new():
   - $solver_orders_url = "https://solver.example.com/api/v1/orders"
   - $polling_interval = 15
   - $has_discord_webhook = false
2. ✅ Tracing configured without webhook

---

## Quick Test Modifications

To test different scenarios, modify these fields:

| Test | Modify | Value | Expected |
|------|--------|-------|----------|
| HardFail filtering | `status` | "HardFail" | Filtered out |
| ImproperFill filtering | `status` | "ImproperFill" | Filtered out |
| New order | `status` | "New" | Passes filtering & validation |
| UserInitiated | `status` | "UserInitiated" | Passes filtering & validation |
| CobiInitiated | `status` | "CobiInitiated" | Passes filtering & validation |
| UserRedeemed | `status` | "UserRedeemed" | Fails validation |
| CobiRedeemed | `status` | "CobiRedeemed" | Fails validation |
| Invalid swap | `swap.status` | "" | Fails validation |
| API error | `status` (response) | "error" | Error formatted |
| Empty result | `result` | [] | No orders processed |

