import type { UserRole } from '@prisma/client'

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string
        tenantId: string
        role: UserRole
        fullName: string
        email: string
      }
    }
  }
}

export {}
