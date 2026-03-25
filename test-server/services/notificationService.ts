// Notification Service - handles sending notifications

export interface EmailPayload {
  to: string;
  subject: string;
  body: string;
}

export class NotificationService {
  async sendWelcomeEmail(email: string, name: string): Promise<void> {
    console.log(`Sending welcome email to ${email}`);
    
    // Simulate external API call
    await this.delay(100);
    
    const payload: EmailPayload = {
      to: email,
      subject: 'Welcome!',
      body: `Hello ${name}, welcome to our platform!`,
    };

    console.log('Email sent:', payload);
  }

  async sendNotification(userId: string, message: string): Promise<void> {
    console.log(`Sending notification to user ${userId}: ${message}`);
    await this.delay(50);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
