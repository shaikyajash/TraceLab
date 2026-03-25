# Test Server

This is a sample server implementation used to demonstrate TraceLab's visualization capabilities.

## Architecture

```
┌─────────────────────────────────────────────────┐
│              API Routes                         │
│  /api/test-users (POST, GET)                   │
│  /api/test-users/[id] (GET, PUT, DELETE)       │
└─────────────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
┌──────────────┐        ┌──────────────┐
│  Validator   │        │ UserService  │
│  Middleware  │───────▶│   (Logic)    │
└──────────────┘        └──────────────┘
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
            ┌──────────────┐      ┌──────────────┐
            │UserRepository│      │Notification  │
            │  (Database)  │      │   Service    │
            └──────────────┘      └──────────────┘
```

## Components

### Services
- **UserService**: Business logic for user operations
- **NotificationService**: Handles email notifications

### Middleware
- **Validator**: Input validation and sanitization

### Repository
- **UserRepository**: Data persistence layer (in-memory)

## Request Flow Example

**POST /api/test-users**

1. **Validator.validateUserInput()**
   - Input: `{ name, email, age }`
   - Output: `ValidationResult`
   - Validates email format, required fields

2. **UserService.createUser()**
   - Input: Validated data
   - Output: `User` with generated ID
   - Adds timestamps and unique ID

3. **UserRepository.save()**
   - Input: User object
   - Output: Persisted user
   - Simulates database write (20ms delay)

4. **NotificationService.sendWelcomeEmail()**
   - Input: User email and name
   - Output: void
   - Simulates external API call (100ms delay)

## Data Models

```typescript
interface User {
  id: string;
  name: string;
  email: string;
  age: number;
  createdAt: Date;
}

interface CreateUserInput {
  name: string;
  email: string;
  age: number;
}
```

## Testing

See [TESTING.md](../TESTING.md) for API testing instructions.
