// User Service - handles business logic for user operations

export interface User {
  id: string;
  name: string;
  email: string;
  age: number;
  createdAt: Date;
}

export interface CreateUserInput {
  name: string;
  email: string;
  age: number;
}

export class UserService {
  private users: User[] = [];

  async createUser(input: CreateUserInput): Promise<User> {
    // Generate ID and timestamp
    const user: User = {
      id: `user_${Date.now()}`,
      name: input.name,
      email: input.email,
      age: input.age,
      createdAt: new Date(),
    };

    this.users.push(user);
    return user;
  }

  async getUserById(id: string): Promise<User | null> {
    return this.users.find(u => u.id === id) || null;
  }

  async getAllUsers(): Promise<User[]> {
    return this.users;
  }

  async updateUser(id: string, updates: Partial<CreateUserInput>): Promise<User | null> {
    const user = this.users.find(u => u.id === id);
    if (!user) return null;

    Object.assign(user, updates);
    return user;
  }

  async deleteUser(id: string): Promise<boolean> {
    const index = this.users.findIndex(u => u.id === id);
    if (index === -1) return false;

    this.users.splice(index, 1);
    return true;
  }
}
