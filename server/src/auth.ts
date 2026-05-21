import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { UserRole } from './types';

export type AuthUser = {
  id: string;
  name?: string;
  role: UserRole;
  organizationId: string;
};

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET es obligatorio en produccion.');
  }
  return secret || 'dev-secret-change-me';
}

export function signToken(user: AuthUser) {
  return jwt.sign(user, jwtSecret(), { expiresIn: '14d' });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    res.status(401).json({ message: 'Sesion requerida.' });
    return;
  }

  try {
    req.user = jwt.verify(token, jwtSecret()) as AuthUser;
    next();
  } catch {
    res.status(401).json({ message: 'Sesion invalida.' });
  }
}
