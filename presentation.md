# TraceLab

## Interactive Code Architecture Visualization & Simulation

---

# The Problem

- Large codebases are **impossible to mentally map**
- New developers spend weeks just understanding existing systems
- Debugging requires manually tracing through hundreds of files
- Architecture diagrams get outdated the moment code changes
- No easy way to know _exactly_ what happens when a request hits an API

---

# Introducing TraceLab

**TraceLab transforms any GitHub repository into a living, interactive architecture map — and lets you simulate real requests flowing through your code.**

> _See your codebase. Trace your requests. Understand your system._

---

# How It Works

## Three Simple Steps

1. **Paste** a GitHub URL (or upload an existing scan)
2. **Explore** the auto-generated interactive graph of your entire codebase
3. **Simulate** a real API request and watch it flow through every component

---

# Step 1 — Scan Your Repo

- Paste any GitHub URL into TraceLab
- It automatically clones and analyzes the entire codebase through multiple phases:
  - Discovering services & packages
  - Parsing source files
  - Resolving types & interfaces
  - Analyzing component graph
  - Detecting cross-service calls
- Real-time progress shown for every phase
- Results are **cached** — rescans are instant
- Export/import the graph as a `.tracelab.json` file for sharing

---

# Step 2 — Explore the Graph

- Your entire codebase rendered as an **interactive 4000×4000 canvas**
- Components are automatically laid out in execution-depth layers
- Pan, zoom, and click to explore any component
- Each node shows:
  - What it does (description)
  - Input & output type signatures
  - Whether it mutates state
  - Where it's defined in the codebase
  - All incoming and outgoing connections

---

# Node Types — Your Architecture Decoded

| Type           | Color  | What It Represents               |
| -------------- | ------ | -------------------------------- |
| **ROUTE**      | Blue   | API endpoint / HTTP handler      |
| **MIDDLEWARE** | Purple | Auth, logging, validation        |
| **HANDLER**    | Green  | Core business logic              |
| **TRANSFORM**  | Orange | Data transformation / mapping    |
| **VALIDATOR**  | Red    | Input validation / schema checks |
| **DB**         | Teal   | Database queries / operations    |

Nodes tagged **MUT** indicate state mutations — side effects made visible.

---

# Step 3 — Simulate a Request

- Pick any **API route** from the dropdown
- Select the **HTTP method** (GET, POST, PUT, DELETE, PATCH)
- Fill in **path parameters** and a **JSON body**
- Hit **Simulate**

TraceLab traces the exact execution path through your codebase — step by step, in real time.

---

# Watch Your Request Come Alive

- **Canvas highlights** the active execution path with glowing blue edges
- **Sidebar shows** a step-by-step breakdown of every component touched
- Each step reveals:
  - Component name & type
  - Description of what it does
  - Input data flowing in
  - Output data flowing out
- Inactive components **fade out** so you can focus on the path
- **Smart path detection** automatically picks the right branch for conditional logic

---

# Intelligent Features

### AI-Powered Analysis

TraceLab uses large language models to understand your code semantics — not just structure. It extracts meaningful descriptions, infers types, and detects patterns automatically.

### Smart Conditional Tracing

Multiple execution paths for one route? TraceLab scores each path against your request payload and picks the most likely one automatically.

### Cross-Service Awareness

Works with **monorepos and microservices** — tracks calls across service boundaries and maps external package dependencies.

### State Mutation Tracking

Instantly see which components write to your database, update cache, or produce side effects.

---

# Real Use Cases

### Onboarding New Developers

Upload the `.tracelab.json` once. New team members can visually explore the entire architecture without reading 10,000+ lines of code.

### Debugging a Live Issue

Simulate the failing request. Follow the exact execution path. Find the broken step immediately.

### Architecture Review

Audit state mutations, cross-service dependencies, and separation of concerns — all in one view.

### Documentation That Stays Fresh

The graph is generated from code — it's always accurate, never stale.

---

# Tech Stack

| Layer         | Technology                       |
| ------------- | -------------------------------- |
| Framework     | Next.js + React 19               |
| Language      | TypeScript                       |
| Styling       | TailwindCSS + shadcn/ui          |
| Icons         | Lucide React                     |
| Graph Layout  | Dagre (auto hierarchical layout) |
| Visualization | Custom SVG canvas engine         |
| AI Analysis   | Claude / OpenAI / Google GenAI   |
| Export Format | `.tracelab.json`                 |

---

# What Makes TraceLab Different

- **No manual work** — no annotations, no config files, no diagram tools
- **Always in sync** — generated directly from your live code
- **Interactive, not static** — click, zoom, simulate, inspect
- **Type-aware** — shows TypeScript signatures, not just node names
- **AI-powered semantics** — understands _what_ your code does, not just _how_ it's structured
- **Sharable** — export the graph and share with your team instantly

---

# Demo

1. Open TraceLab landing page
2. Paste a GitHub repository URL
3. Watch real-time scanning progress
4. Explore the generated architecture graph
5. Select a route → set params & body → click Simulate
6. Watch the request trace through the system live
7. Inspect each step for input/output details

---

# Summary

**TraceLab is the missing tool for understanding modern codebases.**

- Paste a GitHub URL → get an interactive architecture map
- Simulate any API request → trace it through every component
- Built for developers, architects, and teams working on complex systems
- Fast, accurate, and always up to date

---

# Thank You

**TraceLab** — _See your codebase differently._
