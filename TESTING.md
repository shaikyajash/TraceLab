# Testing TraceLab

## Quick Start

1. **Start the dev server:**
```bash
npm run dev
```

2. **Open the visualizer:**
```
http://localhost:3000
```

3. **Test the flow:**
   - Select "POST /api/test-users" from the dropdown
   - Click "Execute" to create a user
   - Watch the flow animate through:
     - Validator → UserService → UserRepository → NotificationService

## Test Server Architecture

The test server includes:

### Services
- **UserService** (`test-server/services/userService.ts`)
  - Creates, reads, updates, deletes users
  - Manages in-memory user data

- **NotificationService** (`test-server/services/notificationService.ts`)
  - Sends welcome emails
  - Simulates external API calls

### Middleware
- **Validator** (`test-server/middleware/validator.ts`)
  - Validates email format
  - Checks required fields
  - Returns validation errors

### Repository
- **UserRepository** (`test-server/repositories/userRepository.ts`)
  - Simulates database operations
  - Adds realistic delays

## Available API Routes

### POST /api/test-users
Create a new user

**Example Payload:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "age": 30
}
```

**Flow:**
1. Validator validates input
2. UserService creates user with ID
3. UserRepository saves to "database"
4. NotificationService sends welcome email

### GET /api/test-users
Get all users

**Flow:**
1. UserService fetches all users

### GET /api/test-users/[id]
Get user by ID

**Flow:**
1. Validator validates ID format
2. UserRepository fetches from "database"

### PUT /api/test-users/[id]
Update user

**Flow:**
1. Validator validates ID
2. Validator validates input
3. UserService updates user
4. UserRepository saves changes
5. NotificationService sends update notification

### DELETE /api/test-users/[id]
Delete user

**Flow:**
1. Validator validates ID
2. UserRepository deletes from "database"
3. UserService removes from memory

## Testing with cURL

```bash
# Create a user
curl -X POST http://localhost:3000/api/test-users \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com","age":28}'

# Get all users
curl http://localhost:3000/api/test-users

# Test validation error
curl -X POST http://localhost:3000/api/test-users \
  -H "Content-Type: application/json" \
  -d '{"name":"","email":"invalid","age":-5}'
```

## Using the Visualizer

### 1. Execute a Request
- Edit the JSON payload in the right panel
- Click "Execute"
- Watch the flow diagram animate

### 2. View Step Details
- Each completed step shows green
- Click "View Payload" to see input/output
- Check execution time for each step

### 3. Debug with Breakpoints
- Execute a request first
- Click "Edit & Replay" on any step
- Modify the payload at that point
- See how downstream components handle it

### 4. Visual Indicators
- **Gray**: Not executed yet
- **Yellow**: Currently executing
- **Green**: Successfully completed
- **Red**: External service calls

## Troubleshooting

### "Failed to load visualizer.json"
- Make sure `public/visualizer.json` exists
- Check the JSON is valid

### "Network Error" when executing
- Ensure dev server is running on port 3000
- Check the route path matches the API

### No animation
- Check browser console for errors
- Verify the route has flowSteps defined

## Next Steps

1. **Scan your own repo:**
```bash
npm run scan /path/to/your/server
```

2. **Customize visualizer.json** to match your architecture

3. **Add more test routes** in `src/app/api/`

4. **Integrate with real servers** by updating the port in visualizer.json
