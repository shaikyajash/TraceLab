# Migration Guide: new.json → new2.json

## Overview
The new2.json represents a **major simplification** of the order monitoring system. The complex transaction-based state machine has been replaced with a simpler status-based classification system.

---

## Key Changes

### 1. **Order Model Simplification**

#### OLD (new.json):
```json
{
  "create_order": {
    "create_id": "order-1",
    "additional_data": {
      "is_blacklisted": false,
      "deadline": 1735689600,
      "instant_refund_tx_bytes": "0xabc"
    }
  },
  "source_swap": {
    "chain": "ethereum",
    "amount": "100",
    "filled_amount": "100",
    "initiate_tx_hash": "0xinit",
    "initiate_block_number": "10",
    "redeem_tx_hash": null,
    "refund_tx_hash": "0xrefund",
    "required_confirmations": 2,
    "current_confirmations": 2,
    "secret": null
  },
  "destination_swap": {
    "chain": "bitcoin",
    "amount": "1",
    "filled_amount": "0",
    "initiate_tx_hash": null,
    "initiate_block_number": null,
    "redeem_tx_hash": null,
    "refund_tx_hash": null,
    "required_confirmations": 1,
    "current_confirmations": 0,
    "secret": null
  }
}
```

#### NEW (new2.json):
```json
{
  "order_id": "0x8f4c2a7b1e9d4c6f0a1234567890abcdef1234567890abcdef1234567890abcd",
  "status": "New",
  "swap": {
    "swap_id": "6b4f9d2e-7c1a-4c3f-a9a1-1a2b3c4d5e6f",
    "status": "pending"
  }
}
```

**Impact:** 
- Removed: `create_order`, `additional_data`, `is_blacklisted`, `deadline`, `instant_refund_tx_bytes`
- Removed: `source_swap`, `destination_swap` with all transaction details
- Removed: Transaction hashes, block numbers, confirmations, amounts, chains
- Added: Simple `status` field that directly indicates order state
- Added: Simplified `swap` object with just `swap_id` and `status`

---

### 2. **Order State Classification**

#### OLD (new.json):
Order state was **computed** from complex transaction logic:
- Analyzed `initiate_tx_hash`, `redeem_tx_hash`, `refund_tx_hash` presence
- Compared `filled_amount` vs `amount`
- Checked confirmation counts
- Result: 7 possible states (UserInitiated, CobiInitiated, UserRedeemed, CobiRedeemed, ImproperFill, New, HardFail)

#### NEW (new2.json):
Order state is **directly provided** in the `status` field:
- No computation needed
- Status values: "New", "UserInitiated", "CobiInitiated", "UserRedeemed", "CobiRedeemed", "HardFail", "ImproperFill"
- Same 7 states, but now explicit instead of derived

**Impact:**
- `check_order_state()` function now does simple string matching instead of complex logic
- No need to analyze transaction hashes or amounts
- Faster classification, easier to test

---

### 3. **Filtering Logic**

#### OLD (new.json):
```
For each order:
  1. Check if blacklisted → skip
  2. Compute order state from transactions
  3. Based on state, update caches (non_init, non_redeemed, managed_secret, invalid, improper_fill, hard_fail)
  4. Validate pending orders
```

#### NEW (new2.json):
```
For each order:
  1. Check if status is "HardFail" or "ImproperFill" → filter out
  2. Keep all other statuses for processing
  3. Classify order state from status field
  4. Validate pending orders (exclude UserRedeemed, CobiRedeemed)
```

**Impact:**
- Simpler filtering: just check status string
- No blacklist logic needed
- No complex state computation
- Faster processing

---

### 4. **Validation Rules**

#### OLD (new.json):
```
is_valid_pending_order():
  - Check transaction state
  - Verify amounts match
  - Check confirmations
  - Complex business logic
```

#### NEW (new2.json):
```
is_valid_pending_order():
  - status != "HardFail"
  - status != "ImproperFill"
  - status != "UserRedeemed"
  - status != "CobiRedeemed"
  - swap.status is not empty
```

**Impact:**
- Validation is now simple string checks
- No transaction analysis needed
- Easier to understand and test

---

### 5. **API Response Structure**

#### OLD (new.json):
```json
{
  "status": "success",
  "result": [
    {
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z",
      "source_swap": { ... },
      "destination_swap": { ... },
      ...
    }
  ]
}
```

#### NEW (new2.json):
```json
{
  "status": "success",
  "result": [
    {
      "order_id": "0x...",
      "status": "New",
      "swap": {
        "swap_id": "...",
        "status": "pending"
      }
    }
  ]
}
```

**Impact:**
- Much smaller payload
- Faster parsing
- Easier to test

---

## Testing Impact

### OLD Testing (new.json):
To test different order states, you had to:
1. Modify multiple transaction hash fields
2. Set correct block numbers and confirmations
3. Adjust filled_amount vs amount
4. Ensure consistency across source and destination swaps

### NEW Testing (new2.json):
To test different order states, you just:
1. Change the `status` field to the desired state
2. Done!

**Example:**
```json
// Test HardFail state
{ "order_id": "0x...", "status": "HardFail", "swap": {...} }

// Test New state
{ "order_id": "0x...", "status": "New", "swap": {...} }

// Test UserInitiated state
{ "order_id": "0x...", "status": "UserInitiated", "swap": {...} }
```

---

## Removed Features

1. **Blacklist checking** - No longer needed
2. **Transaction hash analysis** - Replaced by status field
3. **Confirmation counting** - Replaced by status field
4. **Amount validation** - Replaced by status field
5. **Chain-specific logic** - Removed
6. **Timestamp tracking** - Simplified
7. **Deadline-based alerts** - Removed

---

## New Simplifications

1. **Direct status field** - No computation needed
2. **Simpler swap object** - Just ID and status
3. **Faster filtering** - String matching instead of complex logic
4. **Easier validation** - Simple status checks
5. **Smaller payloads** - Less data to process
6. **Clearer test cases** - Just modify status field

---

## Migration Checklist

- [ ] Update order parsing to use `order_id` instead of `create_order.create_id`
- [ ] Update order state classification to read `status` field directly
- [ ] Remove blacklist checking logic
- [ ] Remove transaction hash analysis
- [ ] Remove confirmation counting
- [ ] Simplify validation to status-based checks
- [ ] Update test cases to use new order structure
- [ ] Update test breakpoints to modify `status` field
- [ ] Remove cache tracking for complex states
- [ ] Simplify cleanup logic

---

## Benefits of new2.json

1. **Simpler Code** - Less logic to maintain
2. **Faster Processing** - No complex state computation
3. **Easier Testing** - Just change status field
4. **Smaller Payloads** - Less data to transfer
5. **Clearer Intent** - Status is explicit, not derived
6. **Fewer Bugs** - Less complex logic = fewer edge cases
7. **Better Performance** - String matching vs transaction analysis

