import { NextRequest } from 'next/server';
import { UserService } from '../../../../../test-server/services/userService';
import { Validator } from '../../../../../test-server/middleware/validator';
import { UserRepository } from '../../../../../test-server/repositories/userRepository';
import { NotificationService } from '../../../../../test-server/services/notificationService';

const userService = new UserService();
const validator = new Validator();
const userRepository = new UserRepository();
const notificationService = new NotificationService();

type RouteContext = {
  params: Promise<{ id: string }>;
};

// GET /api/test-users/[id] - Get user by ID
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    // Step 1: Validate ID
    if (!validator.validateUserId(id)) {
      return Response.json(
        { success: false, error: 'Invalid user ID' },
        { status: 400 }
      );
    }

    // Step 2: Fetch from repository
    const user = await userRepository.findById(id);

    if (!user) {
      return Response.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    return Response.json({ success: true, data: user });
  } catch (error: any) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// PUT /api/test-users/[id] - Update user
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();

    // Step 1: Validate ID
    if (!validator.validateUserId(id)) {
      return Response.json(
        { success: false, error: 'Invalid user ID' },
        { status: 400 }
      );
    }

    // Step 2: Validate input
    const validationResult = validator.validateUserInput(body);
    if (!validationResult.valid) {
      return Response.json(
        { success: false, errors: validationResult.errors },
        { status: 400 }
      );
    }

    // Step 3: Update via service
    const updatedUser = await userService.updateUser(id, body);

    if (!updatedUser) {
      return Response.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // Step 4: Save to repository
    await userRepository.update(id, updatedUser);

    // Step 5: Send notification
    await notificationService.sendNotification(id, 'Your profile has been updated');

    return Response.json({ success: true, data: updatedUser });
  } catch (error: any) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// DELETE /api/test-users/[id] - Delete user
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;

    // Step 1: Validate ID
    if (!validator.validateUserId(id)) {
      return Response.json(
        { success: false, error: 'Invalid user ID' },
        { status: 400 }
      );
    }

    // Step 2: Delete from repository
    const deleted = await userRepository.delete(id);

    if (!deleted) {
      return Response.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // Step 3: Delete from service
    await userService.deleteUser(id);

    return Response.json({ success: true, message: 'User deleted' });
  } catch (error: any) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
