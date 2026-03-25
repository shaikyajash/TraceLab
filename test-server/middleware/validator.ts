// Validator Middleware - validates incoming requests

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export class Validator {
  validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  validateUserInput(data: any): ValidationResult {
    const errors: string[] = [];

    if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
      errors.push('Name is required and must be a non-empty string');
    }

    if (!data.email || !this.validateEmail(data.email)) {
      errors.push('Valid email is required');
    }

    if (data.age === undefined || typeof data.age !== 'number' || data.age < 0 || data.age > 150) {
      errors.push('Age must be a number between 0 and 150');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  validateUserId(id: string): boolean {
    return typeof id === 'string' && id.length > 0;
  }
}
