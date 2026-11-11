import type { NextFunction, Request, Response } from 'express'
import jwt, { type JwtPayload } from 'jsonwebtoken'
import { prisma } from '../config/prisma.js'
import { env } from '../config/env.js'

type TokenPayload = JwtPayload & { sub: string; tenantId: string }

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const authorization = req.headers.authorization
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  let payload: TokenPayload
  try {
    payload = jwt.verify(token, env.jwtSecret, {
      issuer: 'kindergarten-management-system',
      audience: 'kindergarten-management-system-client',
    }) as TokenPayload
  } catch {
    return res.status(401).json({ error: 'Invalid or expired authentication token' })
  }

  if (typeof payload.sub !== 'string' || typeof payload.tenantId !== 'string') {
    return res.status(401).json({ error: 'Invalid authentication token' })
  }

  try {
    const user = await prisma.user.findFirst({
      where: {
        id: payload.sub,
        tenantId: payload.tenantId,
        status: 'ACTIVE',
        tenant: { status: 'ACTIVE' },
      },
      select: {
        id: true,
        tenantId: true,
        role: true,
        fullName: true,
        email: true,
      },
    })

    if (!user) {
      return res.status(401).json({ error: 'Account is inactive or no longer exists' })
    }

    req.auth = {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      fullName: user.fullName,
      email: user.email,
    }
    return next()
  } catch (error) {
    return next(error)
  }
}

export function requireRoles(...roles: NonNullable<Request['auth']>['role'][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'Authentication required' })
    }
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action' })
    }
    return next()
  }
}
