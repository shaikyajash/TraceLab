# Quick Start Guide

## 30 Second Demo

```bash
# 1. Start the server
npm run dev

# 2. Open browser
# http://localhost:3000

# 3. Click "Execute" button
# Watch the flow animate!
```

## What You'll See

A visual flow diagram showing:
```
Validator → UserService → UserRepository → NotificationService
```

Each component lights up as the request flows through, with animated arrows showing data movement.

## Try These

### 1. Execute a Request
- The default payload is already loaded
- Just click "Execute"
- Watch it flow!

### 2. Edit the Payload
```json
{
  "name": "Your Name",
  "email": "your@email.com",
  "age": 25
}
```

### 3. Test Validation
Try invalid data:
```json
{
  "name": "",
  "email": "not-an-email",
  "age": -5
}
```

### 4. Debug Mid-Flight
- Execute a request first
- Click "Edit & Replay" on any step
- Change the payload
- See how it affects downstream components

## Understanding the Visualization

### Colors
- 🔘 Gray = Not executed yet
- 🟡 Yellow = Currently executing
- 🟢 Green = Completed successfully
- 🔴 Red = External service calls

### Components
- **Validator**: Checks if data is valid
- **UserService**: Creates user with ID
- **UserRepository**: Saves to database
- **NotificationService**: Sends welcome email

### Arrows
- Solid arrows = Internal flow
- Dashed arrows = External API calls
- Animated = Active data transfer

## Next Steps

See [TESTING.md](./TESTING.md) for more advanced testing scenarios.

See [SETUP_COMPLETE.md](./SETUP_COMPLETE.md) for full documentation.
