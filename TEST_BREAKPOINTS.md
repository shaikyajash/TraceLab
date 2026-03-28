# Order Monitor - Test Input Breakpoints (Updated for new2.json)

Based on the `scans/new2.json` file, here are the key input fields you can modify to test different scenarios and breakpoints in the order monitoring system.

## MAJOR CHANGES FROM new.json to new2.json

### Key Structural Changes:
1. **Simplified Order Model**: Orders now use a `status` field directly instead of complex swap state logic
2. **Removed Complex Swap Fields**: No more `source_swap`, `destination_swap`, transaction hashes, confirmations
3. **New Field Structure**: Orders now have `order_id`, `status`, and `swap` (with `swap_id` and `status`)
4. **Status-Based Classification**: Order state is determined by the `status` field directly (e.g., "HardFail", "New", "UserInitiated")
5. **Simplified Validation**: Uses string matching on status instead of complex transaction state analysis

---

## Main Testing Areas

### 1. **Order Status Field** (Most Important - Replaces Complex Logic)
**Field:** `status`

**Test Cases:**
- `"HardFail"` → Order is filtered out (terminal state)
- `"ImproperFill"` → Order is filtered out (terminal state)
- `"New"` → Order passes filtering, valid pending order
- `"UserInitiated"` → Order passes filtering, valid pending order
- `"CobiInitiated"` → Order passes filtering, valid pending order
- `"UserRedeemed"` → Order fails validation (terminal state)
- `"CobiRedeemed"` → Order fails validation (terminal state)

**Example:**
```json
{
  "order_id": "0x8f4c2a7b1e9d4c6f0a1234567890abcdef1234567890abcdef1234567890abcd",
  "status": "New",  // ← Change this to test different states
  "swap": {
    "swap_id": "6b4f9d2e-7c1a-4c3f-a9a1-1a2b3c4d5e6f",
    "status": "pending"
  }
}
```

---

### 2. **Order State Classification** (Simplified - Now Status-Based)

#### **HardFail State** (Terminal - Filtered Out)
**Condition:** `status: "HardFail"`

**Test Input:**
```json
{
  "order_id": "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  "status": "HardFail",  // ← Key: terminal state
  "swap": {
    "swap_id": "22222222-3333-4444-5555-666666666666",
    "status": "failed"
  }
}
```

**Expected Output:** Order is FILTERED OUT (not passed to downstream processing)

---

#### **ImproperFill State** (Terminal - Filtered Out)
**Condition:** `status: "ImproperFill"`

**Test Input:**
```json
{
  "order_id": "0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd",
  "status": "ImproperFill",  // ← Key: terminal state
  "swap": {
    "swap_id": "123e4567-e89b-12d3-a456-426614174000",
    "status": "filled"
  }
}
```

**Expected Output:** Order is FILTERED OUT (not passed to downstream processing)

---

#### **New State** (Valid Pending)
**Condition:** `status: "New"`

**Test Input:**
```json
{
  "order_id": "0x8f4c2a7b1e9d4c6f0a1234567890abcdef1234567890abcdef1234567890abcd",
  "status": "New",  // ← Key: valid pending
  "swap": {
    "swap_id": "6b4f9d2e-7c1a-4c3f-a9a1-1a2b3c4d5e6f",
    "status": "pending"
  }
}
```

**Expected Output:** Order passes filtering, considered valid pending order

---

#### **UserInitiated State** (Valid Pending)
**Condition:** `status: "UserInitiated"`

**Test Input:**
```json
{
  "order_id": "0x111122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000",
  "status": "UserInitiated",  // ← Key: valid pending
  "swap": {
    "swap_id": "11111111-2222-3333-4444-555555555555",
    "status": "executing"
  }
}
```

**Expected Output:** Order passes filtering, considered valid pending order

---

#### **CobiInitiated State** (Valid Pending)
**Condition:** `status: "CobiInitiated"`

**Test Input:**
```json
{
  "order_id": "0xbeadbeadbeadbeadbeadbeadbeadbeadbeadbeadbeadbeadbeadbeadbeadbead",
  "status": "CobiInitiated",  // ← Key: valid pending
  "swap": {
    "swap_id": "77777777-8888-9999-aaaa-bbbbbbbbbbbb",
    "status": "processing"
  }
}
```

**Expected Output:** Order passes filtering, considered valid pending order

---

#### **UserRedeemed State** (Invalid - Fails Validation)
**Condition:** `status: "UserRedeemed"`

**Test Input:**
```json
{
  "order_id": "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "status": "UserRedeemed",  // ← Key: fails validation
  "swap": {
    "swap_id": "ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb",
    "status": "redeemed"
  }
}
```

**Expected Output:** Order fails `is_valid_pending_order()` check

---

#### **CobiRedeemed State** (Invalid - Fails Validation)
**Condition:** `status: "CobiRedeemed"`

**Test Input:**
```json
{
  "order_id": "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "status": "CobiRedeemed",  // ← Key: fails validation
  "swap": {
    "swap_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    "status": "completed"
  }
}
```

**Expected Output:** Order fails `is_valid_pending_order()` check

---

### 3. **API Response Status** (Request-Level)
**Field:** `status` (at response level, not order level)

**Test Cases:**
- `"success"` → Request succeeds, orders are processed
- `"error"` → Request fails, error message is formatted

**Example:**
```json
{
  "status": "success",  // ← Change this
  "result": [
    { "order_id": "0x...", "status": "New", ... }
  ]
}
```

---

### 4. **Swap Status Validation**
**Field:** `swap.status`

**Test Cases:**
- Non-empty string (e.g., "pending", "executing", "failed") → Valid swap
- Empty string or null → Invalid swap

**Example:**
```json
{
  "swap": {
    "swap_id": "6b4f9d2e-7c1a-4c3f-a9a1-1a2b3c4d5e6f",
    "status": "pending"  // ← Must be non-empty
  }
}
```

---

### 5. **Stale Entry Cleanup**
**Scenario:** Orders that disappear from API response

**Test:** 
1. First poll: Order exists in cache
2. Second poll: Order NOT in API response
3. Expected: Order removed from all caches

**Input Modification:**
```json
// First poll - order present
"result": [
  { "order_id": "0x...", "status": "New" }
]

// Second poll - order missing
"result": []  // ← Order removed from API
```

---

## Quick Reference: Key Fields to Modify

| Field | Values | Effect |
|-------|--------|--------|
| `status` (order) | "New", "UserInitiated", "CobiInitiated", "UserRedeemed", "CobiRedeemed", "HardFail", "ImproperFill" | Determines order classification |
| `status` (response) | "success", "error" | Request success/failure |
| `swap.status` | Non-empty string or empty | Swap validation |
| `order_id` | Any hex string | Order identifier |
| `swap_id` | Any UUID | Swap identifier |

---

## Testing Strategy

1. **Start with status field:** Test each order status value to see filtering behavior
2. **Test API response status:** Change between "success" and "error"
3. **Test swap validation:** Empty vs non-empty swap.status
4. **Test filtering logic:** Mix terminal (HardFail, ImproperFill) with valid orders
5. **Test cleanup:** Remove orders from API response between polls
6. **Test validation:** Verify UserRedeemed and CobiRedeemed fail validation

---

## Example Test Scenarios

### Scenario 1: Mixed Orders with Terminal States
```json
{
  "status": "success",
  "result": [
    {
      "order_id": "0x111...",
      "status": "New",
      "swap": { "swap_id": "uuid1", "status": "pending" }
    },
    {
      "order_id": "0x222...",
      "status": "HardFail",  // ← Filtered out
      "swap": { "swap_id": "uuid2", "status": "failed" }
    },
    {
      "order_id": "0x333...",
      "status": "ImproperFill",  // ← Filtered out
      "swap": { "swap_id": "uuid3", "status": "filled" }
    }
  ]
}
```

**Expected:** Only order 0x111 passes filtering

---

### Scenario 2: API Request Failure
```json
{
  "status": "error",  // ← Request failed
  "result": [
    {
      "order_id": "0x444...",
      "status": "New",
      "swap": { "swap_id": "uuid4", "status": "pending" }
    }
  ]
}
```

**Expected:** Error message formatted, orders still filtered but request marked as failed

---

### Scenario 3: Invalid Swap Status
```json
{
  "order_id": "0x555...",
  "status": "New",
  "swap": {
    "swap_id": "uuid5",
    "status": ""  // ← Empty - invalid swap
  }
}
```

**Expected:** Swap validation fails, order marked invalid

