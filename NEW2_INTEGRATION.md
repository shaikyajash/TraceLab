# new2.json Integration

## What Changed

The app now supports **new2.json format** (simplified status-based order classification) in addition to the original new.json format.

## How It Works

### Automatic Conversion

When you upload or load a new2.json file, the app automatically converts it to the internal format:

1. **Nodes**: Converted from object map to array
   - `nodes: { "check_order_state": {...} }` → `nodes: [{ id: "check_order_state", ... }]`

2. **Edges**: Converted from new format to PayloadEdge format
   - `edges: [{ from: "A", to: "B", kind: "call" }]` → `edges: [{ from: "A", to: "B", payload: "A_to_B", ... }]`

3. **Traces**: Converted from object map to array
   - `traces: { "OrderMonitor::run": [...] }` → `traces: [{ route_id: "OrderMonitor::run", ... }]`

### Key Files

- **`src/lib/convert-graph.ts`** - Handles conversion from new2.json to app format
- **`src/app/page.tsx`** - Updated to use converter on upload/load
- **`src/lib/schema.ts`** - Updated type definitions to support both formats

## Usage

### Upload new2.json

1. Click "Upload JSON" button
2. Select your new2.json file
3. App automatically converts and displays it

### Load from API

When scanning a repository that generates new2.json, the app automatically converts it before displaying.

## Order Status Values (new2.json)

The new format uses direct status fields instead of complex transaction analysis:

- **`New`** - Valid pending order
- **`UserInitiated`** - Valid pending order
- **`CobiInitiated`** - Valid pending order
- **`UserRedeemed`** - Terminal state (fails validation)
- **`CobiRedeemed`** - Terminal state (fails validation)
- **`HardFail`** - Terminal state (filtered out)
- **`ImproperFill`** - Terminal state (filtered out)

## Testing

To test with new2.json:

1. Upload `scans/new2.json` file
2. Select an entry point (e.g., "OrderMonitor::run")
3. Click "Simulate" to trace through the flow
4. The app will display the converted graph and trace

## Backward Compatibility

The app still supports the original new.json format. Both formats work seamlessly:

- **new.json** - Complex transaction-based classification
- **new2.json** - Simple status-based classification

Both are automatically detected and converted to the internal format.

## Implementation Details

### Conversion Process

```typescript
// Input: new2.json
{
  "nodes": {
    "check_order_state": { "id": "check_order_state", "kind": "classifier", ... }
  },
  "edges": [{ "from": "A", "to": "B", "kind": "call" }],
  "traces": { "OrderMonitor::run": [{ "id": "...", "steps": [...] }] }
}

// Output: Internal format
{
  "nodes": [{ "id": "check_order_state", "service": "order_monitor", "kind": "classifier", ... }],
  "edges": [{ "from": "A", "to": "B", "payload": "A_to_B", "from_service": "order_monitor", ... }],
  "traces": [{ "route_id": "OrderMonitor::run", "steps": [...] }]
}
```

### No Breaking Changes

- Existing new.json files work as before
- UI/UX unchanged
- All features work with both formats
- Conversion is transparent to the user

## Future Enhancements

Potential improvements:

1. Add order status filter in sidebar
2. Show order classification details in inspector
3. Add order batch analysis
4. Highlight terminal vs valid orders in trace flow
5. Add order-specific test payload builder

