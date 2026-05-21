export type UserRole = 'client' | 'employee' | 'receptionist' | 'manager' | 'admin' | 'owner';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        name?: string;
        role: UserRole;
        organizationId: string;
      };
    }
  }
}
