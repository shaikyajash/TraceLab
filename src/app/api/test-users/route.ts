import { NextRequest } from 'next/server';
import { UserService } from '../../../../test-server/services/userService';
import { Validator } from '../../../../test-server/middleware/validator';
import { UserRepository } from '../../../../test-server/repositories/userRepository';
import { NotificationService } from '../../../../test-server/services/notificationService';

// Initialize services
const userService = new UserService();
const validator = new Validator();
const userRepository = new UserRepository();
const notificationService = new NotificationService();

// GET /api/test-users - Get all users
export async function GET(request: NextRequest) {
  try {
    const users = await userService.getAllUsers();
    return Response.json({ success: true, data: users });
  } catch (error: any) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// POST /api/test-users - Create a new user
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Step 1: Validate input
    const validationResult = validator.validateUserInput(body);
    if (!validationResult.valid) {
      return Response.json(
        { success: false, errors: validationResult.errors },
        { status: 400 }
      );
    }

    // Step 2: Create user via service
    const user = await userService.createUser({
      name: body.name,
      email: body.email,
      age: body.age,
    });

    // Step 3: Save to repository (database)
    await userRepository.save(user);

    // Step 4: Send welcome notification
    await notificationService.sendWelcomeEmail(user.email, user.name);

    return Response.json({ success: true, data: user }, { status: 201 });
  } catch (error: any) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
