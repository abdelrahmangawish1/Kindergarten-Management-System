import { EventAudience } from '@prisma/client'
import { Router, type NextFunction, type Request, type Response } from 'express'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { basename, join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import rateLimit from 'express-rate-limit'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import { z } from 'zod'
import { env } from '../config/env.js'
import { prisma } from '../config/prisma.js'

export const parentPortalRouter = Router()
const homeworkDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../uploads/homework')
const homeworkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
})
const submissionFileTypes = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
  ['application/pdf', '.pdf'],
])

function isValidSubmissionFile(mimeType: string, buffer: Buffer) {
  if (mimeType === 'image/png') {
    return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  }
  if (mimeType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  if (mimeType === 'image/webp') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
  if (mimeType === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-'
  return false
}

function isStoredSubmissionFile(value: unknown): value is {
  fileName: string
  originalName: string
  mimeType: string
  size: number
} {
  if (!value || typeof value !== 'object') return false
  const file = value as Record<string, unknown>
  return typeof file.fileName === 'string'
    && basename(file.fileName) === file.fileName
    && typeof file.originalName === 'string'
    && typeof file.mimeType === 'string'
    && typeof file.size === 'number'
}

const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(72),
  accessCode: z.string().trim().min(8).max(40).transform((value) => value.toUpperCase()),
})
const parentTokenSchema = z.object({
  sub: z.string().min(1),
  tenantId: z.string().min(1),
  parentUserId: z.string().min(1),
  scope: z.literal('parent-portal'),
})

const parentPortalAuthenticate = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : undefined
  if (!token) return res.status(401).json({ error: 'Parent portal sign-in required' })
  let claims: z.infer<typeof parentTokenSchema>
  try {
    const payload = jwt.verify(token, env.jwtSecret, {
      issuer: 'kindergarten-management-system',
      audience: 'kindergarten-management-system-parent-portal',
    })
    const parsedClaims = typeof payload === 'string' ? null : parentTokenSchema.safeParse(payload)
    if (!parsedClaims?.success) {
      return res.status(401).json({ error: 'Invalid parent portal session' })
    }
    claims = parsedClaims.data
  } catch {
    return res.status(401).json({ error: 'Invalid or expired parent portal session' })
  }

  try {
    const activeLink = await prisma.child.findFirst({
      where: {
        id: claims.sub,
        tenantId: claims.tenantId,
        tenant: { status: 'ACTIVE' },
        parents: {
          some: {
            parent: {
              user: {
                id: claims.parentUserId,
                tenantId: claims.tenantId,
                role: 'PARENT',
                status: 'ACTIVE',
              },
            },
          },
        },
      },
      select: { id: true },
    })
    if (!activeLink) return res.status(401).json({ error: 'Parent portal session is no longer valid' })
    req.parentPortal = {
      childId: claims.sub,
      tenantId: claims.tenantId,
      parentUserId: claims.parentUserId,
    }
    return next()
  } catch (error) {
    return next(error)
  }
}

parentPortalRouter.post('/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
}), async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) return res.status(401).json({ error: 'Invalid parent credentials or student access code' })
  try {
    const candidates = await prisma.child.findMany({
      where: {
        accessCode: parsed.data.accessCode,
        tenant: { status: 'ACTIVE' },
        parents: {
          some: {
            parent: {
              user: {
                email: parsed.data.email,
                role: 'PARENT',
                status: 'ACTIVE',
                tenant: { status: 'ACTIVE' },
              },
            },
          },
        },
      },
      select: {
        id: true,
        tenantId: true,
        fullName: true,
        dateOfBirth: true,
        classroom: { select: { name: true } },
        tenant: { select: { name: true, status: true } },
        parents: {
          where: {
            parent: {
              user: { email: parsed.data.email, role: 'PARENT', status: 'ACTIVE' },
            },
          },
          select: {
            parent: {
              select: {
                user: { select: { id: true, passwordHash: true } },
              },
            },
          },
        },
      },
    })

    let authenticatedChild: (typeof candidates)[number] | undefined
    let authenticatedParentUserId: string | undefined
    for (const child of candidates) {
      for (const link of child.parents) {
        if (await bcrypt.compare(parsed.data.password, link.parent.user.passwordHash)) {
          authenticatedChild = child
          authenticatedParentUserId = link.parent.user.id
          break
        }
      }
      if (authenticatedChild) break
    }

    if (!authenticatedChild || !authenticatedParentUserId || authenticatedChild.tenant.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'Invalid parent credentials or student access code' })
    }
    const token = jwt.sign(
      {
        tenantId: authenticatedChild.tenantId,
        parentUserId: authenticatedParentUserId,
        scope: 'parent-portal',
      },
      env.jwtSecret,
      {
        subject: authenticatedChild.id,
        expiresIn: '4h',
        issuer: 'kindergarten-management-system',
        audience: 'kindergarten-management-system-parent-portal',
      },
    )
    return res.json({
      token,
      child: {
        fullName: authenticatedChild.fullName,
        dateOfBirth: authenticatedChild.dateOfBirth,
        classroom: authenticatedChild.classroom,
        tenant: authenticatedChild.tenant.name,
      },
    })
  } catch (error) {
    return next(error)
  }
})

parentPortalRouter.get('/portal', parentPortalAuthenticate, async (req, res, next) => {
  try {
    const childId = req.parentPortal!.childId
    const tenantId = req.parentPortal!.tenantId
    const [child, attendance, payments, events] = await Promise.all([
      prisma.child.findFirst({
        where: { id: childId, tenantId },
        select: {
          id: true,
          fullName: true,
          dateOfBirth: true,
          classId: true,
          classroom: { select: { name: true } },
          tenant: { select: { name: true, settings: { select: { currency: true } } } },
        },
      }),
      prisma.attendance.findMany({
        where: { childId, tenantId },
        select: { date: true, status: true },
        orderBy: { date: 'desc' },
        take: 100,
      }),
      prisma.payment.findMany({
        where: { childId, tenantId },
        select: { amount: true, currency: true, status: true, date: true, paymentMethod: true },
        orderBy: { date: 'desc' },
        take: 100,
      }),
      prisma.event.findMany({
        where: {
          workspaceId: tenantId,
          targetAudience: { in: [EventAudience.ALL, EventAudience.PARENTS] },
          date: { gte: new Date() },
        },
        select: { title: true, description: true, date: true },
        orderBy: { date: 'asc' },
        take: 50,
      }),
    ])
    if (!child) return res.status(401).json({ error: 'Parent portal session is no longer valid' })
    const homework = child.classId
      ? await prisma.homework.findMany({
          where: { tenantId, classroomId: child.classId },
          include: {
            classroom: { select: { name: true } },
            submissions: {
              where: { childId },
              select: {
                id: true,
                status: true,
                submittedAt: true,
                submissionText: true,
                attachments: true,
                grade: true,
                feedback: true,
              },
            },
          },
          orderBy: { dueDate: 'asc' },
        })
      : []
    return res.json({ child, attendance, payments, events, homework })
  } catch (error) {
    return next(error)
  }
})

parentPortalRouter.post('/homework/:id/submission', parentPortalAuthenticate, homeworkUpload.single('file'), async (req, res, next) => {
  const homeworkId = z.string().min(1).safeParse(req.params.id)
  const submissionText = z.string().trim().max(8000).optional().safeParse(req.body.text ?? '')
  if (!homeworkId.success || !submissionText.success) {
    return res.status(400).json({ error: 'Invalid homework submission' })
  }
  const file = req.file
  if (!submissionText.data && !file) {
    return res.status(400).json({ error: 'Add a written response or attach a file' })
  }
  if (file && (!submissionFileTypes.has(file.mimetype) || !isValidSubmissionFile(file.mimetype, file.buffer))) {
    return res.status(400).json({ error: 'Upload a valid PNG, JPEG, WebP, or PDF file' })
  }

  let savedFileName: string | undefined
  try {
    const { childId, tenantId } = req.parentPortal!
    const [child, homework] = await Promise.all([
      prisma.child.findFirst({ where: { id: childId, tenantId }, select: { classId: true } }),
      prisma.homework.findFirst({
        where: { id: homeworkId.data, tenantId },
        select: { id: true, classroomId: true },
      }),
    ])
    if (!child || !homework || child.classId !== homework.classroomId) {
      return res.status(404).json({ error: 'Homework not found for this child' })
    }

    const existing = await prisma.homeworkSubmission.findUnique({
      where: { tenantId_homeworkId_childId: { tenantId, homeworkId: homework.id, childId } },
      select: { id: true, status: true, attachments: true },
    })
    if (existing?.status === 'GRADED') {
      return res.status(409).json({ error: 'This homework has already been graded' })
    }

    const previousFiles = Array.isArray(existing?.attachments)
      ? existing.attachments.filter(isStoredSubmissionFile)
      : []
    let attachments: Array<{ fileName: string; originalName: string; mimeType: string; size: number }> = []
    if (file) {
      await mkdir(homeworkDirectory, { recursive: true })
      const extension = submissionFileTypes.get(file.mimetype)
      if (!extension) return res.status(400).json({ error: 'Upload a valid PNG, JPEG, WebP, or PDF file' })
      savedFileName = `${randomUUID()}${extension}`
      await writeFile(join(homeworkDirectory, savedFileName), file.buffer, { flag: 'wx' })
      attachments = [{
        fileName: savedFileName,
        originalName: basename(file.originalname).slice(0, 180),
        mimeType: file.mimetype,
        size: file.size,
      }]
    }

    const submission = await prisma.homeworkSubmission.upsert({
      where: { tenantId_homeworkId_childId: { tenantId, homeworkId: homework.id, childId } },
      create: {
        tenantId,
        homeworkId: homework.id,
        childId,
        submissionText: submissionText.data || null,
        attachments,
      },
      update: {
        submissionText: submissionText.data || null,
        attachments,
        status: 'SUBMITTED',
        grade: null,
        feedback: null,
        gradedAt: null,
        gradedByStaffId: null,
        submittedAt: new Date(),
      },
      select: { id: true, status: true, submittedAt: true, submissionText: true, attachments: true },
    })

    await Promise.all(previousFiles.map(async (previous) => {
      try {
        await unlink(join(homeworkDirectory, previous.fileName))
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
          console.error('Could not remove replaced homework submission file', error)
        }
      }
    }))
    return res.status(201).json(submission)
  } catch (error) {
    if (savedFileName) {
      await unlink(join(homeworkDirectory, savedFileName)).catch((cleanupError: unknown) => {
        if (!(cleanupError instanceof Error && 'code' in cleanupError && cleanupError.code === 'ENOENT')) {
          console.error('Could not clean up an incomplete homework submission', cleanupError)
        }
      })
    }
    return next(error)
  }
})

parentPortalRouter.get('/homework/submissions/:id/files/:fileName', parentPortalAuthenticate, async (req, res, next) => {
  const id = z.string().min(1).safeParse(req.params.id)
  const fileName = z.string().min(1).refine((value) => basename(value) === value).safeParse(req.params.fileName)
  if (!id.success || !fileName.success) return res.status(400).json({ error: 'Invalid homework file path' })
  try {
    const submission = await prisma.homeworkSubmission.findFirst({
      where: {
        id: id.data,
        tenantId: req.parentPortal!.tenantId,
        childId: req.parentPortal!.childId,
      },
      select: { attachments: true },
    })
    const storedFile = Array.isArray(submission?.attachments)
      ? submission.attachments.find((entry) => isStoredSubmissionFile(entry) && entry.fileName === fileName.data)
      : undefined
    if (!storedFile || !isStoredSubmissionFile(storedFile)) {
      return res.status(404).json({ error: 'Homework file not found' })
    }
    res.setHeader('Content-Type', storedFile.mimeType)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(storedFile.originalName)}"`)
    return res.sendFile(join(homeworkDirectory, storedFile.fileName))
  } catch (error) {
    return next(error)
  }
})

export type ParentPortalSession = { childId: string; tenantId: string; parentUserId: string }

declare global {
  namespace Express {
    interface Request {
      parentPortal?: ParentPortalSession
    }
  }
}
