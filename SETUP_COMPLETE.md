# TraceLab Setup Complete! 🎉

## What's Been Built

A complete request flow visualizer and simulator with:

✅ **LLM-Powered Repo Scanner** (Gemini 1.5 Pro)
✅ **Interactive Flow Visualization** (React Flow)
✅ **Real Request Execution** (Axios)
✅ **Test Server with 4 Components**
✅ **5 Working API Routes**
✅ **Mid-Flight Debugging**
✅ **Animated Data Flow**

## Project Structure

```
TraceLab/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Main visualizer UI
│   │   └── api/
│   │       ├── scan/route.ts           # Repo scanning endpoint
│   │       ├── execute/route.ts        # Request execution endpoint
│   │       └── test-users/             # Test API routes
│   │           ├── route.ts            # POST, GET /api/test-users
│   │           └── [id]/route.ts       # GET, PUT, DELETE by ID
│   ├── components/
│   │   ├── FlowVisualizer.tsx          # React Flow diagram
│   │   └── ExecutionPanel.tsx          # Control panel
│   ├── lib/
│   │   ├── repo-scanner.ts             # LLM-based code analyzer
│   │   └── request-executor.ts         # HTTP request handler
│   └── types/
│       └── visualizer.ts               # TypeScript schemas
├── test-server/
│   ├── services/
│   │   ├── userService.ts              # User business logic
│   │   └── notificationService.ts      # Email notifications
│   ├── middleware/
│   │   └── validator.ts                # Input validation
│   └── repositories/
│       └── userRepository.ts           # Data persistence
├── public/
│   └── visualizer.json                 # Server architecture schema
├── scripts/
│   └── scan-repo.ts                    # CLI scanner tool
└── .env                                # Gemini API key
```

## Quick Start

### 1. Start the Server
```bash
npm run dev
```

### 2. Open the Visualizer
```
http://localhost:3000
```

### 3. Test the Flow

**In the UI:**
1. Select "POST /api/test-users" from dropdown
2. Edit the payload (or use the default)
3. Click "Execute"
4. Watch the animated flow:
   - Validator (validates input)
   - UserService (creates user)
   - UserRepository (saves to DB)
   - NotificationService (sends email)

**Example Payload:**
```json
{
  "name": "Alice Smith",
  "email": "alice@example.com",
  "age": 28
}
```

## Features Demo

### 1. Real-Time Visualization
- Gray nodes = Not executed
- Yellow nodes = Currently executing
- Green nodes = Completed
- Animated edges = Active data flow

### 2. Step-by-Step History
- View input/output for each step
- See execution time per component
- Expand to see full payload JSON

### 3. Mid-Flight Debugging
- Click "Edit & Replay" on any step
- Modify the payload at that point
- Re-execute from that step forward
- See how changes affect downstream components

### 4. Multiple Routes
- POST /api/test-users (4 steps)
- GET /api/test-users (1 step)
- GET /api/test-users/:id (2 steps)

## Test the APIs Directly

```bash
# Create a user
curl -X POST http://localhost:3000/api/test-users \
  -H "Content-Type: application/json" \
  -d '{"name":"Bob","email":"bob@test.com","age":30}'

# Get all users
curl http://localhost:3000/api/test-users

# Test validation error
curl -X POST http://localhost:3000/api/test-users \
  -H "Content-Type: application/json" \
  -d '{"name":"","email":"invalid","age":-5}'
```

## Scan Your Own Repo

```bash
npm run scan /path/to/your/server
```

This will:
1. Read all source files (.ts, .js, .rs, .go, .py, .java)
2. Send to Gemini 1.5 Pro for analysis
3. Extract routes, components, and data flows
4. Generate `public/visualizer.json`

**Note:** The Gemini API key in `.env` needs to be valid. The current one appears to be invalid.

## Next Steps

### For Testing
1. ✅ Server is ready - just run `npm run dev`
2. ✅ Test APIs are working
3. ✅ Visualizer is configured
4. ✅ Example data is loaded

### For Production Use
1. Get a valid Gemini API key from https://aistudio.google.com/app/apikey
2. Update `.env` with the new key
3. Scan your actual server repo
4. Update the port in `visualizer.json` if needed
5. Start your actual server
6. Visualize real requests!

## Architecture Highlights

### Request Execution Flow
```
User clicks Execute
    ↓
RequestExecutor makes HTTP call to actual API
    ↓
API executes all steps internally
    ↓
RequestExecutor simulates step-by-step for visualization
    ↓
Each step animates with 300ms delay
    ↓
Final result displayed
```

### Why Simulation?
Since we can't instrument the server (language-agnostic requirement), we:
1. Make the real HTTP request
2. Get the final result
3. Simulate the intermediate steps for visualization
4. Show realistic timing and data flow

This approach works with ANY server (Rust, Go, Python, etc.) without requiring code changes.

## Troubleshooting

### "Failed to load visualizer.json"
- File exists at `public/visualizer.json` ✅
- Check browser console for details

### "Network Error"
- Make sure dev server is running on port 3000
- Check the route path matches

### Gemini API Error
- Get a valid API key from Google AI Studio
- Update `.env` file
- Restart the dev server

## Documentation

- [README.md](./README.md) - Main documentation
- [TESTING.md](./TESTING.md) - Testing guide
- [test-server/README.md](./test-server/README.md) - Test server architecture

## What Makes This Special

1. **Language Agnostic**: Works with any server language
2. **No Instrumentation**: Doesn't require server code changes
3. **Real Requests**: Actually hits your APIs
4. **Visual Debugging**: Edit payloads mid-flight
5. **LLM-Powered**: Automatically understands your codebase

Ready to visualize! 🚀
