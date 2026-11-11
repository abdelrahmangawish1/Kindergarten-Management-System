import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { env } from '../config/env.js'
import { authenticate } from '../middleware/auth.js'

export const authRouter = Router()

const registerSchema = z.object({
  kindergartenName: z.string().trim().min(2).max(120),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(72),
})

const loginSchema = z.object({
  tenantSlug: z.string().trim().min(2).max(160).transform((value) => value.toLowerCase()),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(72),
})

function issueToken(user: { id: string; tenantId: string }) {
  return jwt.sign({ tenantId: user.tenantId }, env.jwtSecret, {
    subject: user.id,
    expiresIn: '8h',
    issuer: 'kindergarten-management-system',
    audience: 'kindergarten-management-system-client',
  })
}

function safeUser(user: {
  id: string
  tenantId: string
  fullName: string
  email: string
  role: UserRole
}) {
  return {
    id: user.id,
    tenantId: user.tenantId,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
  }
}

authRouter.post('/register', async (req, res, next) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid registration data', details: parsed.error.flatten() })
  }

  try {
    const { kindergartenName, fullName, email, password } = parsed.data
    const passwordHash = await bcrypt.hash(password, 12)
    const baseSlug =
      kindergartenName
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 100) || 'kindergarten'
    const slug = `${baseSlug}-${randomBytes(3).toString('hex')}`

    const user = await prisma.$transaction(async (transaction) => {
      const tenant = await transaction.tenant.create({
        data: {
          name: kindergartenName,
          slug,
          settings: { create: { kindergartenName } },
        },
      })

      return transaction.user.create({
        data: {
          tenantId: tenant.id,
          fullName,
          email,
          passwordHash,
          role: UserRole.ADMIN,
        },
      })
    })

    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { id: user.tenantId },
      select: { id: true, name: true, slug: true, settings: true },
    })

    return res.status(201).json({
      token: issueToken(user),
      user: safeUser(user),
      tenant,
    })
  } catch (error) {
    return next(error)
  }
})

authRouter.post('/login', async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid login data', details: parsed.error.flatten() })
  }

  try {
    const { tenantSlug, email, password } = parsed.data
    const user = await prisma.user.findFirst({
      where: {
        email,
        status: 'ACTIVE',
        tenant: { slug: tenantSlug, status: 'ACTIVE' },
      },
      include: { tenant: { select: { id: true, name: true, slug: true, settings: true } } },
    })

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid kindergarten, email, or password' })
    }

    return res.json({
      token: issueToken(user),
      user: safeUser(user),
      tenant: user.tenant,
    })
  } catch (error) {
    return next(error)
  }
})

authRouter.get('/workspace', async (req, res, next) => {
  const parsed = z.string().trim().min(2).max(160).safeParse(req.query.slug)
  if (!parsed.success) return res.status(400).json({ error: 'A valid workspace slug is required' })

  try {
    const tenant = await prisma.tenant.findFirst({
      where: { slug: parsed.data.toLowerCase(), status: 'ACTIVE' },
      select: {
        name: true,
        slug: true,
        settings: { select: { kindergartenName: true, logoUrl: true } },
      },
    })
    if (!tenant) return res.status(404).json({ error: 'Workspace not found' })
    return res.json({ tenant })
  } catch (error) {
    return next(error)
  }
})

authRouter.get('/me', authenticate, async (req, res, next) => {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.auth!.tenantId },
      select: { id: true, name: true, slug: true, settings: true },
    })
    return res.json({
      user: {
        id: req.auth!.userId,
        tenantId: req.auth!.tenantId,
        fullName: req.auth!.fullName,
        email: req.auth!.email,
        role: req.auth!.role,
      },
      tenant,
    })
  } catch (error) {
    return next(error)
  }
})
