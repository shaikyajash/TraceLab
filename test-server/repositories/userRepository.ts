// User Repository - handles data persistence (file-based storage)

import { User } from '../services/userService';
import * as fs from 'fs';
import * as path from 'path';

export class UserRepository {
  private dbPath: string;

  constructor() {
    this.dbPath = path.join(process.cwd(), 'data', 'users.json');
    this.ensureDataFileExists();
  }

  private ensureDataFileExists() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.dbPath)) {
      fs.writeFileSync(this.dbPath, '[]', 'utf-8');
    }
  }

  private readData(): User[] {
    try {
      const data = fs.readFileSync(this.dbPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error reading users.json:', error);
      return [];
    }
  }

  private writeData(users: User[]): void {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(users, null, 2), 'utf-8');
      console.log(`Data written to ${this.dbPath}`);
    } catch (error) {
      console.error('Error writing users.json:', error);
    }
  }

  async save(user: User): Promise<User> {
    // Simulate database write delay
    await this.delay(20);
    
    const users = this.readData();
    const existingIndex = users.findIndex(u => u.id === user.id);
    
    if (existingIndex >= 0) {
      users[existingIndex] = user;
    } else {
      users.push(user);
    }
    
    this.writeData(users);
    console.log(`User saved to database: ${user.id}`);
    return user;
  }

  async findById(id: string): Promise<User | null> {
    await this.delay(10);
    const users = this.readData();
    return users.find(u => u.id === id) || null;
  }

  async findAll(): Promise<User[]> {
    await this.delay(15);
    return this.readData();
  }

  async update(id: string, user: User): Promise<User | null> {
    await this.delay(20);
    const users = this.readData();
    const index = users.findIndex(u => u.id === id);
    
    if (index === -1) return null;
    
    users[index] = user;
    this.writeData(users);
    return user;
  }

  async delete(id: string): Promise<boolean> {
    await this.delay(15);
    const users = this.readData();
    const index = users.findIndex(u => u.id === id);
    
    if (index === -1) return false;
    
    users.splice(index, 1);
    this.writeData(users);
    return true;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
