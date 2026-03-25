# TraceLab - Request Flow Visualizer & Simulator

A real-time request flow visualization and simulation tool that helps you understand and debug API request flows across any server architecture (Rust, Node.js, Go, Python, etc.).

## Features

- **LLM-Powered Repo Scanning**: Automatically analyzes your codebase to extract routes, components, and data flows
- **Interactive Flow Visualization**: React Flow-based UI showing server architecture and request paths
- **Real Request Execution**: Actually hits your APIs (not just simulation)
- **Live Payload Tracking**: Watch data transform through each component
- **Mid-Flight Debugging**: Pause execution, edit payloads, and continue from any step
- **Language Agnostic**: Works with Rust, Node.js, Go, Python, Java - no instrumentation needed
- **Component-Level Insights**: See internal data transformations within your server

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      TraceLab UI (Next.js)                  │
│  ┌──────────────────┐         ┌─────────────────────────┐  │
│  │  FlowVisualizer  │         │   ExecutionPanel        │  │
│  │  (React Flow)    │◄────────┤   - Payload Editor      │  │
│  │                  │         │   - Step Controls       │  │
│  └──────────────────┘         │   - History Viewer      │  │
│           │                   └─────────────────────────┘  │
│           ▼                                                 │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           visualizer.json (Schema)                   │  │
│  │  - Routes, Components, Flow Steps, Transformations   │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼ HTTP Requests
┌─────────────────────────────────────────────────────────────┐
│                    Your Server (Any Language)               │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌─────────┐ │
│  │Validator │──▶│ Service  │──▶│Repository│──▶│External │ │
│  └──────────┘   └──────────┘   └──────────┘   └─────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Scan Your Repository

```bash
npm run scan /path/to/your/server YOUR_GEMINI_API_KEY
```

This generates `public/visualizer.json` with your server's architecture.

Get your Gemini API key from: https://aistudio.google.com/app/apikey

### 3. Start the Visualizer

```bash
npm run dev
```

Open http://localhost:3000

### 4. Start Your Server

Make sure your actual server is running on the port specified in `visualizer.json`.

## The visualizer.json Schema

The LLM scanner generates a JSON file describing your server architecture:

```typescript
{
  "servers": [{
    "id": "string",
    "name": "string",
    "port": number,
    "language": "rust|node|go|python|java",
    "routes": [{
      "id": "string",
      "path": "/api/users",
      "method": "POST",
      "handler": "create_user_handler",
      "examplePayload": { /* sample request */ },
      "flowSteps": [{
        "componentId": "validator",
        "functionName": "validate_input",
        "order": 0,
        "dataTransformation": {
          "input": "raw request",
          "output": "validated data",
          "description": "Validates email format"
        }
      }]
    }],
    "internalComponents": [{
      "id": "validator",
      "name": "Input Validator",
      "type": "middleware|service|repository|handler|util",
      "filePath": "src/middleware/validator.rs",
      "functions": [/* function signatures */]
    }],
    "externalCalls": [{
      "from": "notification-service",
      "to": "email-service",
      "method": "POST",
      "endpoint": "/send"
    }]
  }],
  "externalServices": [{
    "id": "email-service",
    "name": "SendGrid",
    "baseUrl": "https://api.sendgrid.com"
  }]
}
```

## Usage

### Visualizing Request Flow

1. Select a route from the dropdown
2. The flow diagram shows all components involved
3. Arrows indicate data flow between components
4. External service calls are shown in red

### Executing Requests

1. Edit the payload JSON in the right panel
2. Click "Execute" to send a real request
3. Watch the flow animate in real-time
4. Each step shows input/output transformations

### Debugging with Breakpoints

1. Execute a request to see the full flow
2. Click "Edit & Replay" on any step
3. Modify the payload at that point
4. See how downstream components handle the modified data

### Visual Indicators

- **Gray nodes**: Not yet executed
- **Yellow nodes**: Currently executing
- **Green nodes**: Successfully completed
- **Red nodes**: External service calls
- **Animated edges**: Active data flow

## Manual Schema Creation

If you prefer not to use LLM scanning, create `public/visualizer.json` manually:

```json
{
  "servers": [{
    "id": "my-api",
    "name": "My API Server",
    "port": 8080,
    "language": "rust",
    "routes": [/* define your routes */],
    "internalComponents": [/* define components */],
    "externalCalls": [/* define external calls */]
  }],
  "externalServices": []
}
```

## API Endpoints

### POST /api/scan

Scan a repository and generate visualizer.json

```json
{
  "repoPath": "/path/to/repo",
  "apiKey": "your-gemini-api-key"
}
```

### POST /api/execute

Execute a route with optional breakpoint

```json
{
  "routeId": "create-user",
  "payload": { "name": "John" },
  "breakpointStep": 2,  // optional
  "modifiedPayload": {} // optional
}
```

## How It Works

### 1. Repository Scanning

The `RepoScanner` class:
- Recursively reads source files (.rs, .ts, .js, .go, .py, .java)
- Sends code to Google Gemini 1.5 Pro with structured prompts
- Uses JSON mode for reliable structured output
- Extracts routes, handlers, components, and data flows
- Generates the visualizer.json schema

### 2. Request Execution

The `RequestExecutor` class:
- Makes actual HTTP requests to your running server
- Adds tracing headers (`X-Trace-Step`) for instrumentation
- Captures responses at each step
- Builds execution history with timing data

### 3. Flow Visualization

The `FlowVisualizer` component:
- Renders server as a container node
- Creates nodes for each component in the flow
- Draws edges showing data flow
- Animates active steps during execution
- Color-codes completion status

## Limitations & Future Work

- **No Server Instrumentation**: Currently relies on LLM analysis and external observation
- **Step Granularity**: Can't see internal function calls within components
- **Async Flows**: Doesn't track background jobs or message queues yet
- **Multi-Server**: Visualizes one server at a time (multi-server coming soon)

## Tech Stack

- **Frontend**: Next.js 16.2.1, React 19, React Flow
- **Scanning**: Google Gemini 1.5 Pro
- **Execution**: Axios for HTTP requests
- **Styling**: Tailwind CSS

## Contributing

This is a proof-of-concept. Areas for improvement:

1. Better LLM prompts for more accurate scanning
2. Server-side instrumentation SDKs (Rust, Node, etc.)
3. WebSocket support for real-time streaming
4. Distributed tracing integration (OpenTelemetry)
5. Performance profiling and bottleneck detection

## License

MIT
