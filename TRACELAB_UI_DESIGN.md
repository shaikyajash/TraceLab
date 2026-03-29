# TraceLab - Pure UI/Visual Specification

## Overview
Dark-themed graph visualization tool with landing page, resizable sidebar, and infinite canvas for node graphs with animated traces.

---

## Tech Stack
- **Framework**: Next.js 16.2.1 + React 19.2.4 + TypeScript
- **Styling**: Tailwind CSS 4
- **UI Components**: Radix UI (shadcn/ui pattern)
- **Font**: Custom "Haffer" (weights 100-900)

---

## Color Palette

### Base Colors
```
Background:     #0d0d0f (main), #0a0a0c (secondary), #111114 (cards)
Borders:        #2a2a2e (default), #378ADD (primary/focus)
Text:           #ddd (primary), #888 (secondary), #666 (tertiary), #555 (muted)
Primary Blue:   #378ADD (brand), #4a9bef (hover)
Success:        #639922 (text), #27500A (border), #0d1f0d (bg)
Error:          #ef4444 (text), #6b1a1a (border), #1f0d0d (bg)
Warning:        #f59e0b (breakpoints), #EF9F27 (mutations)
```

### Node Type Colors
Each node kind has: `bg`, `border`, `badgeBg`, `badgeText`

```typescript
route_handler:       bg: #0e1e30, border: #185FA5, badgeBg: #B5D4F4, badgeText: #0C447C
middleware:          bg: #1a0e2e, border: #534AB7, badgeBg: #CECBF6, badgeText: #3C3489
business_logic:      bg: #0e1e0e, border: #3B6D11, badgeBg: #C0DD97, badgeText: #27500A
transformer:         bg: #1e1200, border: #854F0B, badgeBg: #FAC775, badgeText: #633806
validator:           bg: #1e0e00, border: #993C1D, badgeBg: #F5C4B3, badgeText: #712B13
db_call:             bg: #001e18, border: #0F6E56, badgeBg: #9FE1CB, badgeText: #085041
external_http_call:  bg: #1a1000, border: #B37F00, badgeBg: #FFE28A, badgeText: #7A5500
function:            bg: #111118, border: #4A5568, badgeBg: #CBD5E0, badgeText: #2D3748
background_process:  bg: #1a0d14, border: #9B3060, badgeBg: #F0A0C0, badgeText: #72164A
```

### HTTP Method Colors
```
GET:     #3B6D11
POST:    #854F0B
DELETE:  #993C1D
PUT:     #534AB7
```

---

## Landing Page Layout

### Logo Section (Centered)
```
┌─────────────────────────────────────┐
│                                     │
│         TRACE[LAB]                  │  ← 5xl, bold, 4px spacing
│                                     │     LAB in #378ADD
│   Visualize and trace your          │  ← sm, #666
│   codebase architecture             │
│                                     │
└─────────────────────────────────────┘
```

### Main Card (max-w-2xl, centered)
```
┌─────────────────────────────────────────────────────────┐
│  Paste a Git repository URL or local system path...    │ ← xs, #888
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ Paste git clone command, repository URL...       │ │ ← Input
│  └───────────────────────────────────────────────────┘ │   bg: #0a0a0c
│                                                         │   border: #2a2a2e
│  Branch: main                                          │ ← If detected
│                                                         │   #378ADD, mono
│  ☐ Force rescan (ignore cache)                        │
│                                                         │
│  ┌─────────────────────┐                              │
│  │  Scan & Visualize   │                              │ ← Button
│  └─────────────────────┘                              │   bg: #378ADD
│                                                         │
│  ─────────────── or ───────────────                   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐  │
│  │         ☁↑                                      │  │ ← Upload area
│  │   import existing scan result                   │  │   Dashed border
│  │   Drop .tracelab.json or click to browse        │  │   Hover: #378ADD
│  └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Scan Progress (appears during scan)
```
┌─────────────────────────────────────────────────────────┐
│  ● ANALYZING                                            │ ← Pulse dot
│                                                         │   #378ADD
│  ┌─────────────────────────────────────────────────┐  │
│  │ Analyzing service: order_monitor                │  │ ← Scrollable logs
│  │ Found 15 nodes...                               │  │   font-mono, #888
│  │ Processing routes...                            │  │   max-h-48
│  └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## Graph Visualizer Layout


```
┌──────────────────────────────────────────────────────────────────┐
│  Sidebar (300px)  │ │  Canvas (infinite, pannable)              │
│  Resizable        │▓│                                            │
│  200-600px        │ │  ┌──────────────────────────────────────┐ │
│                   │ │  │ Toolbar (top-left)                   │ │
│  ┌─────────────┐  │ │  │ >> | fit view | reset | +/- zoom    │ │
│  │ SIMULATE    │  │ │  └──────────────────────────────────────┘ │
│  │         << │  │ │                                            │
│  └─────────────┘  │ │  ┌────┐         ┌────┐                   │
│                   │ │  │ N1 │────────>│ N2 │                   │
│  [GET] ▼          │ │  └────┘         └────┘                   │
│  [/api/orders]    │ │     │              │                      │
│                   │ │     └──────┬───────┘                      │
│  [Simulate]       │ │            ▼                              │
│  [Clear]          │ │         ┌────┐                            │
│                   │ │         │ N3 │                            │
│  ▼ PARAMS         │ │         └────┘                            │
│  ▼ BODY           │ │                                            │
│  ▼ INSPECTOR      │ │  Grid background (#0a0a0c)                │
│  ▼ TRACE FLOW     │ │  20px grid, rgba(42,74,122,0.15)          │
│                   │ │                                            │
│  [← Scan diff]    │ │                                            │
└──────────────────────────────────────────────────────────────────┘
```

---

## Sidebar Components

### Header (hidden when paused at breakpoint)
```
┌─────────────────────────────┐
│ SIMULATE              <<    │  ← 10px, #666, tracking 1.2px
└─────────────────────────────┘
```

### Route Selection
```
┌─────────────────────────────┐
│ [GET] [/api/users/:id    ▼] │  ← Method badge (48px) + dropdown
└─────────────────────────────┘
   │
   └─ Colors: GET=#3B6D11, POST=#854F0B, DELETE=#993C1D
      FN=#378ADD, BIZ=#1D9E75, BG=#9333EA, MQ=#EC4899
```

### Buttons
```
┌─────────────────────────────┐
│      Simulate               │  ← bg: #378ADD, hover: #4a9bef
└─────────────────────────────┘

┌─────────────────────────────┐
│   Clear Simulation          │  ← border: #2a2a2e, hover: #ef4444
└─────────────────────────────┘
```

### Collapsible Sections
```
▼ PARAMS (2)                    ← Chevron rotates, badge in #854F0B
  :userId
  ┌─────────────────────────┐
  │ value for :userId       │
  └─────────────────────────┘

▼ BODY
  ┌─────────────────────────┐
  │ {                       │  ← Textarea, min-h-120px
  │   "action": "Generate"  │     bg: #111114, border: #2a2a2e
  │ }                       │     font: 11px, resizable
  └─────────────────────────┘

▼ INSPECTOR
  OrderMonitor::run
  
  KIND        [WORKER]          ← Colored badge per node type
  DEFINED IN  src/monitor.rs
  MUTATES     [YES]             ← Green/orange badge
  
  DESCRIPTION
  ┌─────────────────────────┐
  │ Infinite polling loop...│
  └─────────────────────────┘
  
  INPUT (when paused)
  ┌─────────────────────────┐
  │ {                       │  ← Editable textarea
  │   "monitor": {...}      │
  │ }                       │
  └─────────────────────────┘
  [Save & Check]              ← #378ADD button
  
  ✓ VALID                     ← Green success banner
  Matched: successful fetch
  
  OUTPUT
  ┌─────────────────────────┐
  │ {                       │
  │   "ok": true,           │
  │   "orders": [...]       │
  │ }                       │
  └─────────────────────────┘
  
  RECEIVES FROM (2)
  • Settings::try_from_toml
  • OrderMonitor::new
  
  SENDS TO (1)
  • fetch_and_filter_orders

▼ TRACE FLOW (3 / 5)
  
      ①                       ← Step number badge
  ┌─────────────────────────┐   #378ADD circle
  │ [FUNC] main             │
  │ Loads settings...       │
  └─────────────────────────┘
       │
       │ via settings
       ▼
      ②
  ┌─────────────────────────┐
  │ [WORKER] run            │
  │ Starts polling...       │
  └─────────────────────────┘
       │
       ▼
      ③
  ┌─────────────────────────┐
  │ [HANDLER] fetch         │ ← Orange if terminated
  │ Fetches orders...       │
  └─────────────────────────┘
```

### Back Button (bottom)
```
┌─────────────────────────────┐
│  ← Scan different file      │  ← border: #2a2a2e
└─────────────────────────────┘   hover: #378ADD
```

---

## Node Visual Design

### Node Dimensions
```
Width:  190px
Height: 80px (minimum)
Gap:    20px horizontal, 110px vertical
```

### Node Structure
```
┌────────────────────────────────┐
│████████████████████████████████│ ← 1.5px colored strip
│                            ●   │ ← Breakpoint (top-right, -2px)
│ ①②                             │ ← Step badges (top-left, -2px)
│                                │
│ [ROUTE] [MUT]  ●               │ ← Badges + indicators
│                                │
│ OrderMonitor::run              │ ← 13px, #f5f5f5, semibold
│                                │
│ Infinite polling loop that     │ ← 9px, #888, truncated
│ fetches and classifies...      │
│                                │
└────────────────────────────────┘
```

### Node States

**Default:**
```
Border: 1px #2a2a2e
Background: gradient #1a1a1f → #111114
Shadow: 0 2px 6px rgba(0,0,0,0.2)
```

**Selected:**
```
Border: 2px #378ADD
```

**Trace Active:**
```
Border: 2px {kind-color}40  (40% opacity)
```

**Trace Head (current step):**
```
Border: 2px {kind-color}
Pulse dot: 2px, #378ADD, animated
```

**Breakpoint Set:**
```
Border: 2px #f59e0b
Orange dot: 5px circle, top-right
```

**Paused at Breakpoint:**
```
Border: 3px #f59e0b
Orange strip at top
Pause icon in badges row
```

**Greyed Out (not in active trace):**
```
Opacity: 25%
Cursor: not-allowed
```

**Dragging:**
```
Shadow: 0 8px 20px rgba(0,0,0,0.4)
Cursor: grabbing
z-index: 100
```

### Badges
```
[ROUTE]     ← 8px, uppercase, colored bg/text per kind
[MUT]       ← 7px, #2d1a0a bg, #EF9F27 text, border #633806
```

### Step Number Badges
```
 ①②③        ← 6px circles, #378ADD bg, white text
            Multiple if node appears multiple times
```

### Breakpoint Indicator
```
    ●       ← 5px circle, #f59e0b bg
   ⚫       White dot inside, 2px
            2px border #0d0d0f
```

---

## Edge Visual Design

### Default Edge
```
Color:      #2a4a7a
Width:      1.5px
Style:      Dashed (5 4)
Arrow:      Triangle marker at end
Path:       Cubic bezier (vertical control points)
```

### Active Trace Edge
```
Color:      #378ADD
Width:      2px
Style:      Dashed (5 4) + animated
Animation:  dash 1.5s linear infinite
Arrow:      Blue triangle marker
```

### Function Bubbles on Edges
```
    ●       ← 6px circle at edge midpoint
   ⑤        #854F0B bg, shows function count
            2px border #0d0d0f
            Shadow: 0 2px 8px rgba(133,79,11,0.4)
            Hover: scale 1.1, tooltip with names
```

---

## Canvas Toolbar

### Row 1: View Controls
```
┌────┬──────────┬──────────┬────────┬────────┬─────────────┐
│ >> │ fit view │ reset    │ + zoom │ – zoom │ Export JSON │
└────┴──────────┴──────────┴────────┴────────┴─────────────┘
  │
  └─ bg: #111114, border: #2a2a2e, 10px text
     hover: border #378ADD
```

### Row 2: Info Banner
```
┌──────────────────────────────────────────────────────┐
│ ⓘ Right-click on any node to add breakpoints        │
└──────────────────────────────────────────────────────┘
  │
  └─ bg: #111114/90, border: #f59e0b, backdrop-blur
```

### Row 3: Breakpoint Controls (when breakpoints exist)
```
┌────────────┬──────────┬──────┬───────────┐
│ ● 3 break  │ Resume   │ Skip │ Clear All │
└────────────┴──────────┴──────┴───────────┘
  │            │          │      │
  │            │          │      └─ border: #ef4444
  │            │          └─ border: #f59e0b
  │            └─ bg: #378ADD
  └─ border: #f59e0b, orange dot
```

---

## Animations

### Keyframes
```css
@keyframes dash {
  to { stroke-dashoffset: -18; }
}

@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.8); opacity: 0.4; }
}

@keyframes fadeInBlur {
  0% { opacity: 0; filter: blur(8px); transform: scale(0.98); }
  100% { opacity: 1; filter: blur(0px); transform: scale(1); }
}

@keyframes fadeOutBlur {
  0% { opacity: 1; filter: blur(0px); transform: scale(1); }
  100% { opacity: 0; filter: blur(8px); transform: scale(0.98); }
}
```

### Applied Animations
- Graph load: fadeInBlur 0.6s
- Graph unload: fadeOutBlur 0.4s
- Trace edges: dash 1.5s infinite
- Trace head dot: pulse
- Trace steps: fadeInBlur 0.4s
- Sidebar: width 0.3s cubic-bezier
- Canvas pan: transform 0.25s cubic-bezier

---

## Typography

### Font: Haffer
Weights: 100, 300, 400, 500, 600, 700, 800, 900

### Sizes
```
5xl (48px):  Logo
13px:        Node names, inspector titles
11px:        Sidebar inputs, field values
10px:        Buttons, badges, trace names
9px:         Descriptions, labels
8px:         Small badges
7px:         MUT badge
```

### Weights
```
Bold (700):     Badges, buttons
Semibold (600): Titles, node names
Medium (500):   Body text
Regular (400):  Descriptions
```

---

## Component Styling Patterns

### Card
```css
bg: #111114
border: #2a2a2e
rounded: lg (12px)
padding: 8 (32px)
```

### Input/Textarea
```css
bg: #111114
border: 0.5px #2a2a2e
rounded: md
padding: 2.5 (10px)
text: 11px #ddd
outline: none
focus: border #378ADD + ring
```

### Button Primary
```css
bg: #378ADD
hover: #4a9bef
text: white
rounded: md
padding: 2 (8px)
```

### Button Secondary
```css
bg: transparent
border: #2a2a2e
hover-border: #378ADD
text: #888
hover-text: #aaa
```

### Button Destructive
```css
border: #ef4444
hover-bg: #ef4444
text: #ef4444
hover-text: white
```

### Badge
```css
text: 8px uppercase
padding: 2.5 1 (10px 4px)
rounded: md
font: bold
tracking: wider
bg: {kind.badgeBg}
color: {kind.badgeText}
```

### Field Label
```css
text: 9px #666
margin-bottom: 1 (4px)
tracking: wide
font: medium
```

### Field Value Box
```css
bg: #0d0d0f
border: 0.5px #2a2a2e
rounded: md
padding: 2.5 (10px)
text: 11px #bbb
leading: relaxed
```

---

## Grid Background
```css
background: #0a0a0c
background-image:
  linear-gradient(rgba(42,74,122,0.15) 1px, transparent 1px),
  linear-gradient(90deg, rgba(42,74,122,0.15) 1px, transparent 1px)
background-size: 20px 20px
background-position: {tx}px {ty}px  /* Moves with pan */
```

---

## Scrollbar Styling

### Webkit (Chrome/Safari)
```css
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: #444;
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: #555;
}
```

### Firefox
```css
* {
  scrollbar-width: thin;
  scrollbar-color: #444 transparent;
}
```

### Scan Logs (custom)
```css
scrollbar-thumb: #378ADD
scrollbar-track: #1a1a1c
```

---

## Icons

### Spinner (Scanning)
```
Rotating circle with arc
Size: 4 (16px)
Color: currentColor
Animation: spin
```

### Info
```
Circle with 'i'
Size: 4 (16px)
Stroke: currentColor
```

### Warning
```
Circle with '!'
Size: 5 (20px)
Stroke: currentColor
```

### Upload
```
Cloud with up arrow
Size: 10 (40px)
Stroke: currentColor
```

### Lightning (Trace)
```
Bolt icon
Size: 4 (16px)
Stroke: currentColor
```

### Pause
```
Two vertical bars
Size: 3 (12px)
Fill: currentColor
```

### Chevron (Collapsible)
```
Down arrow
Size: 3 (12px)
Stroke: currentColor
Rotate: 180deg when open
Transition: 300ms
```

---

## Validation Result Banners

### Success
```
┌─────────────────────────────────────────┐
│ ✓ VALID  Matched: successful fetch     │
└─────────────────────────────────────────┘
bg: #0d1f0d
border: #27500A
text: #639922
```

### Error
```
┌─────────────────────────────────────────┐
│ ✗ VALIDATION FAILED              [400] │
│                                         │
│ field: monitor.solver_orders_url        │
│ Failed to send request to solver API    │
└─────────────────────────────────────────┘
bg: #1f0d0d
border: #6b1a1a
text: #ef4444
details: #ffb3b3
```

---

## Responsive Breakpoints

### Sidebar
```
Min width:     200px
Default width: 300px
Max width:     600px
Collapsible:   Yes (animates to 0)
```

### Canvas
```
Virtual size:  4000x4000px
Viewport:      window - sidebar
Min scale:     0.3
Default scale: 0.72
Max scale:     2.0
```

---

## Special States

### Loading State
```
Spinner icon + "Scanning..." text
Button disabled (40% opacity)
Input disabled
```

### Empty State
```
"No node selected" in inspector
"No route selected" in params
Centered, #555 text, 11px
```

### Error State
```
Red alert banner
Icon + message
#ef4444 text on #2a1515 bg
```

### Paused State
```
Orange borders and indicators
"Resume" and "Skip" buttons enabled
Input editable in inspector
Pause icon visible
```

---

## Interaction Feedback

### Hover States
```
Buttons:        Border color change
Nodes:          Slight bg change
Upload area:    Border #378ADD
Resize handle:  bg #333
Toolbar items:  Border #378ADD
```

### Active States
```
Buttons:        translateY(1px)
Dragging node:  grabbing cursor, shadow
Panning:        grabbing cursor
Resizing:       col-resize cursor, #378ADD handle
```

### Focus States
```
Inputs:         Border #378ADD + ring-3 #378ADD/50
Buttons:        Ring-3 #378ADD/50
Selects:        Border #378ADD + ring-3
```

### Disabled States
```
Opacity:        50%
Cursor:         not-allowed
Pointer events: none
```

---

## Z-Index Layers
```
1:   Base canvas
5:   Function bubbles
10:  Node badges/indicators
20:  Resize handle
50:  Floating trace card
100: Dragging node
```

---

## Transitions
```
Sidebar width:      0.3s cubic-bezier(0.4, 0, 0.2, 1)
Canvas transform:   0.25s cubic-bezier(0.4, 0, 0.2, 1)
Button hover:       colors 150ms
Border hover:       colors 150ms
Chevron rotation:   300ms ease-in-out
Collapsible:        300ms ease-in-out
Graph fade:         400-600ms ease-out
```

---

## Summary: Key Visual Elements

1. **Dark theme** with blue accents (#378ADD)
2. **Node cards** with colored top strips and badges
3. **Animated edges** with dashed lines and arrows
4. **Resizable sidebar** with collapsible sections
5. **Grid background** that moves with pan
6. **Step number badges** on nodes during trace
7. **Breakpoint indicators** (orange dots and borders)
8. **Function bubbles** on edges between nodes
9. **Validation banners** (green success, red error)
10. **Smooth animations** for all state changes

---

## Your JSON Data
Just provide a JSON file matching the ComponentsGraph structure with:
- `nodes[]` with id, name, kind, description, etc.
- `edges[]` with from, to, payload
- `traces[]` (optional) with route_id and steps

The UI will automatically visualize it with all these styles and interactions!
