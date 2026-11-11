import { Router } from 'express'
import { PaymentStatus, RecordStatus, UserRole } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { requireRoles } from '../middleware/auth.js'
import { generateStudentAccessCode } from '../services/student-access-code.js'

export const coreRouter = Router()

const idParams = z.object({ id: z.string().min(1) })
const dateValue = z.coerce.date()
const nullableText = z.string().trim().max(500).nullable().optional()

const userCreateSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(72),
  role: z.nativeEnum(UserRole),
})
const userUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()).optional(),
  password: z.string().min(10).max(72).optional(),
  role: z.nativeEnum(UserRole).optional(),
  status: z.nativeEnum(RecordStatus).optional(),
})

const childCreateSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  dateOfBirth: dateValue,
  gender: z.string().trim().max(40).optional(),
  classId: z.string().min(1).nullable().optional(),
  parentUserIds: z.array(z.string().min(1)).max(10).optional(),
})
const childUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  dateOfBirth: dateValue.optional(),
  gender: z.string().trim().max(40).nullable().optional(),
  classId: z.string().min(1).nullable().optional(),
})
const classroomCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  ageGroup: nullableText,
  capacity: z.number().int().positive().max(500).default(20),
})
const classroomUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  ageGroup: nullableText,
  capacity: z.number().int().positive().max(500).optional(),
})
const enrollmentCreateSchema = z.object({
  childId: z.string().min(1),
  status: z.enum(['ACTIVE', 'INACTIVE', 'COMPLETED']).default('ACTIVE'),
  startDate: dateValue,
  endDate: dateValue.optional(),
  monthlyFee: z.coerce.number().min(0).max(1000000).default(0),
})
const enrollmentUpdateSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE', 'COMPLETED']).optional(),
  startDate: dateValue.optional(),
  endDate: dateValue.nullable().optional(),
  monthlyFee: z.coerce.number().min(0).max(1000000).optional(),
})
const paymentCreateSchema = z.object({
  childId: z.string().min(1).nullable().optional(),
  amount: z.coerce.number().positive().max(10000000),
  currency: z.string().trim().length(3).default('USD'),
  paymentMethod: z.string().trim().min(2).max(40),
  status: z.nativeEnum(PaymentStatus).default(PaymentStatus.PAID),
  date: dateValue.optional(),
  reference: z.string().trim().max(120).optional(),
  paidAt: dateValue.optional(),
})
const paymentUpdateSchema = z.object({
  childId: z.string().min(1).nullable().optional(),
  amount: z.coerce.number().positive().max(10000000).optional(),
  currency: z.string().trim().length(3).optional(),
  paymentMethod: z.string().trim().min(2).max(40).optional(),
  status: z.nativeEnum(PaymentStatus).optional(),
  date: dateValue.optional(),
  reference: z.string().trim().max(120).nullable().optional(),
  paidAt: dateValue.nullable().optional(),
})

function tenantId(req: Parameters<Parameters<typeof coreRouter.get>[1]>[0]) {
  return req.auth!.tenantId
}

async function teacherClassroomIds(req: Parameters<Parameters<typeof coreRouter.get>[1]>[0]) {
  if (req.auth!.role !== UserRole.TEACHER) return undefined
  const staff = await prisma.staff.findFirst({
    where: { tenantId: tenantId(req), email: req.auth!.email, role: 'TEACHER' },
    select: { classroomId: true, classroomAssignments: { select: { classroomId: true } } },
  })
  if (!staff) return []
  return [...new Set([
    ...staff.classroomAssignments.map(({ classroomId }) => classroomId),
    ...(staff.classroomId ? [staff.classroomId] : []),
  ])]
}

function routeId(value: unknown) {
  const parsed = idParams.safeParse(value)
  return parsed.success ? parsed.data.id : undefined
}

async function validateClassroom(tenant: string, classId: string | null | undefined) {
  if (!classId) return
  const classroom = await prisma.classroom.findFirst({ where: { id: classId, tenantId: tenant } })
  if (!classroom) throw new Error('CLASSROOM_NOT_FOUND')
}

async function validateChild(tenant: string, childId: string | null | undefined) {
  if (!childId) return
  const child = await prisma.child.findFirst({ where: { id: childId, tenantId: tenant } })
  if (!child) throw new Error('CHILD_NOT_FOUND')
}

function handleValidationError(error: unknown, res: Parameters<Parameters<typeof coreRouter.get>[1]>[1]) {
  if (error instanceof Error && error.message === 'CLASSROOM_NOT_FOUND') {
    return res.status(400).json({ error: 'Classroom does not belong to this kindergarten' })
  }
  if (error instanceof Error && error.message === 'CHILD_NOT_FOUND') {
    return res.status(400).json({ error: 'Child does not belong to this kindergarten' })
  }
  return undefined
}

coreRouter.get('/users', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { tenantId: tenantId(req) },
      select: { id: true, fullName: true, email: true, role: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
    return res.json(users)
  } catch (error) {
    return next(error)
  }
})

coreRouter.post('/users', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  const parsed = userCreateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid user data', details: parsed.error.flatten() })

  try {
    const { password, ...userData } = parsed.data
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          ...userData,
          tenantId: tenantId(req),
          passwordHash: await bcrypt.hash(password, 12),
        },
        select: { id: true, fullName: true, email: true, role: true, status: true, createdAt: true },
      })
      if (created.role === UserRole.PARENT) {
        await tx.parentProfile.create({ data: { tenantId: tenantId(req), userId: created.id } })
      }
      return created
    })
    return res.status(201).json(user)
  } catch (error) {
    return next(error)
  }
})

coreRouter.patch('/users/:id', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  const id = routeId(req.params)
  const parsed = userUpdateSchema.safeParse(req.body)
  if (!id || !parsed.success) return res.status(400).json({ error: 'Invalid user update' })
  if (id === req.auth!.userId && parsed.data.status === RecordStatus.INACTIVE) {
    return res.status(400).json({ error: 'You cannot deactivate your own account' })
  }

  try {
    const { password, role, ...data } = parsed.data
    const existing = await prisma.user.findFirst({ where: { id, tenantId: tenantId(req) } })
    if (!existing) return res.status(404).json({ error: 'User not found' })

    const newRole = role ?? existing.role
    const disablingLastAdmin = existing.status === RecordStatus.ACTIVE
      && existing.role === UserRole.ADMIN
      && (newRole !== UserRole.ADMIN || parsed.data.status === RecordStatus.INACTIVE)
    if (disablingLastAdmin) {
      const activeAdmins = await prisma.user.count({
        where: { tenantId: tenantId(req), role: UserRole.ADMIN, status: RecordStatus.ACTIVE },
      })
      if (activeAdmins <= 1) return res.status(409).json({ error: 'A kindergarten must have at least one active administrator' })
    }

    const user = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: {
          ...data,
          ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}),
          ...(role ? { role } : {}),
        },
        select: { id: true, fullName: true, email: true, role: true, status: true, createdAt: true },
      })
      if (newRole === UserRole.PARENT) {
        await tx.parentProfile.upsert({
          where: { tenantId_userId: { tenantId: tenantId(req), userId: id } },
          create: { tenantId: tenantId(req), userId: id },
          update: {},
        })
      } else {
        await tx.parentProfile.deleteMany({ where: { tenantId: tenantId(req), userId: id } })
      }
      return updated
    })
    return res.json(user)
  } catch (error) {
    return next(error)
  }
})

coreRouter.delete('/users/:id', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  const id = routeId(req.params)
  if (!id) return res.status(400).json({ error: 'Invalid user id' })
  if (id === req.auth!.userId) return res.status(400).json({ error: 'You cannot delete your own account' })
  try {
    const target = await prisma.user.findFirst({ where: { id, tenantId: tenantId(req) } })
    if (!target) return res.status(404).json({ error: 'User not found' })
    if (target.role === UserRole.ADMIN && target.status === RecordStatus.ACTIVE) {
      const activeAdmins = await prisma.user.count({
        where: { tenantId: tenantId(req), role: UserRole.ADMIN, status: RecordStatus.ACTIVE },
      })
      if (activeAdmins <= 1) return res.status(409).json({ error: 'A kindergarten must have at least one active administrator' })
    }
    const result = await prisma.user.deleteMany({ where: { id, tenantId: tenantId(req) } })
    return result.count ? res.status(204).send() : res.status(404).json({ error: 'User not found' })
  } catch (error) {
    return next(error)
  }
})

coreRouter.get('/children', requireRoles(UserRole.ADMIN, UserRole.TEACHER), async (req, res, next) => {
  try {
    const assignedClasses = await teacherClassroomIds(req)
    if (assignedClasses && !assignedClasses.length) return res.json([])
    const rows = await prisma.child.findMany({
      where: { tenantId: tenantId(req), ...(assignedClasses ? { classId: { in: assignedClasses } } : {}) },
      include: { classroom: { select: { id: true, name: true } }, parents: { include: { parent: { include: { user: { select: { id: true, fullName: true, email: true } } } } } } },
      orderBy: { fullName: 'asc' },
    })
    return res.json(rows.map(({ accessCode, ...child }) => (
      req.auth!.role === UserRole.ADMIN ? { ...child, accessCode } : child
    )))
  } catch (error) {
    return next(error)
  }
})

coreRouter.post('/children', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  const parsed = childCreateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid child data', details: parsed.error.flatten() })
  try {
    const { parentUserIds = [], ...data } = parsed.data
    await validateClassroom(tenantId(req), data.classId)
    const parentUsers = parentUserIds.length
      ? await prisma.user.findMany({
          where: { id: { in: parentUserIds }, tenantId: tenantId(req), role: UserRole.PARENT, status: RecordStatus.ACTIVE },
          select: { id: true },
        })
      : []
    if (parentUsers.length !== new Set(parentUserIds).size) {
      return res.status(400).json({ error: 'One or more parent accounts are invalid for this kindergarten' })
    }

    const child = await prisma.$transaction(async (tx) => {
      const created = await tx.child.create({
        data: {
          ...data,
          tenantId: tenantId(req),
          accessCode: await generateStudentAccessCode(tx, tenantId(req)),
        },
      })
      if (parentUserIds.length) {
        const profiles = await tx.parentProfile.findMany({
          where: { tenantId: tenantId(req), userId: { in: parentUserIds } },
          select: { id: true },
        })
        await tx.childParent.createMany({
          data: profiles.map((profile) => ({ tenantId: tenantId(req), parentId: profile.id, childId: created.id })),
        })
      }
      return created
    })
    return res.status(201).json(child)
  } catch (error) {
    const handled = handleValidationError(error, res)
    return handled ?? next(error)
  }
})

coreRouter.patch('/children/:id', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  const id = routeId(req.params)
  const parsed = childUpdateSchema.safeParse(req.body)
  if (!id || !parsed.success) return res.status(400).json({ error: 'Invalid child update' })
  try {
    const data = parsed.data
    await validateClassroom(tenantId(req), data.classId)
    const result = await prisma.child.updateMany({
      where: { id, tenantId: tenantId(req) },
      data,
    })
    if (!result.count) return res.status(404).json({ error: 'Child not found' })
    return res.json(await prisma.child.findFirst({ where: { id, tenantId: tenantId(req) }, include: { classroom: true } }))
  } catch (error) {
    const handled = handleValidationError(error, res)
    return handled ?? next(error)
  }
})

coreRouter.delete('/children/:id', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  const id = routeId(req.params)
  if (!id) return res.status(400).json({ error: 'Invalid child id' })
  try {
    const result = await prisma.child.deleteMany({ where: { id, tenantId: tenantId(req) } })
    return result.count ? res.status(204).send() : res.status(404).json({ error: 'Child not found' })
  } catch (error) {
    return next(error)
  }
})

coreRouter.get('/classrooms', requireRoles(UserRole.ADMIN, UserRole.TEACHER), async (req, res, next) => {
  try {
    const assignedClasses = await teacherClassroomIds(req)
    if (assignedClasses && !assignedClasses.length) return res.json([])
    const rows = await prisma.classroom.findMany({
      where: { tenantId: tenantId(req), ...(assignedClasses ? { id: { in: assignedClasses } } : {}) },
      include: { _count: { select: { children: true } } },
      orderBy: { name: 'asc' },
    })
    return res.json(rows)
  } catch (error) {
    return next(error)
  }
})

coreRouter.post('/classrooms', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  const parsed = classroomCreateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid classroom data', details: parsed.error.flatten() })
  try {
    return res.status(201).json(await prisma.classroom.create({
      data: { ...parsed.data, tenantId: tenantId(req) },
    }))
  } catch (error) {
    return next(error)
  }
})

coreRouter.patch('/classrooms/:id', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  const id = routeId(req.params)
  const parsed = classroomUpdateSchema.safeParse(req.body)
  if (!id || !parsed.success) return res.status(400).json({ error: 'Invalid classroom update' })
  try {
    const result = await prisma.classroom.updateMany({ where: { id, tenantId: tenantId(req) }, data: parsed.data })
    return result.count
      ? res.json(await prisma.classroom.findFirst({ where: { id, tenantId: tenantId(req) } }))
      : res.status(404).json({ error: 'Classroom not found' })
  } catch (error) {
    return next(error)
  }
})

coreRouter.delete('/classrooms/:id', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  const id = routeId(req.params)
  if (!id) return res.status(400).json({ error: 'Invalid classroom id' })
  try {
    const result = await prisma.classroom.deleteMany({ where: { id, tenantId: tenantId(req) } })
    return result.count ? res.status(204).send() : res.status(404).json({ error: 'Classroom not found' })
  } catch (error) {
    return next(error)
  }
})

coreRouter.get('/enrollments', requireRoles(UserRole.ADMIN, UserRole.TEACHER), async (req, res, next) => {
  try {
    const assignedClasses = await teacherClassroomIds(req)
    if (assignedClasses && !assignedClasses.length) return res.json([])
    return res.json(await prisma.enrollment.findMany({
      where: {
        tenantId: tenantId(req),
        ...(assignedClasses ? { child: { classId: { in: assignedClasses } } } : {}),
      },
      include: { child: { select: { id: true, fullName: true } } },
      orderBy: { startDate: 'desc' },
    }))
  } catch (error) {
    return next(error)
  }
})

coreRouter.post('/enrollments', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  const parsed = enrollmentCreateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid enrollment data', details: parsed.error.flatten() })
  try {
    await validateChild(tenantId(req), parsed.data.childId)
    return res.status(201).json(await prisma.enrollment.create({
      data: { ...parsed.data, monthlyFee: parsed.data.monthlyFee.toFixed(2), tenantId: tenantId(req) },
      include: { child: { select: { id: true, fullName: true } } },
    }))
  } catch (error) {
    const handled = handleValidationError(error, res)
    return handled ?? next(error)
  }
})

coreRouter.patch('/enrollments/:id', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  const id = routeId(req.params)
  const parsed = enrollmentUpdateSchema.safeParse(req.body)
  if (!id || !parsed.success) return res.status(400).json({ error: 'Invalid enrollment update' })
  try {
    const data = {
      ...parsed.data,
      ...(parsed.data.monthlyFee !== undefined ? { monthlyFee: parsed.data.monthlyFee.toFixed(2) } : {}),
    }
    const result = await prisma.enrollment.updateMany({ where: { id, tenantId: tenantId(req) }, data })
    return result.count
      ? res.json(await prisma.enrollment.findFirst({ where: { id, tenantId: tenantId(req) }, include: { child: true } }))
      : res.status(404).json({ error: 'Enrollment not found' })
  } catch (error) {
    return next(error)
  }
})

coreRouter.delete('/enrollments/:id', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  const id = routeId(req.params)
  if (!id) return res.status(400).json({ error: 'Invalid enrollment id' })
  try {
    const result = await prisma.enrollment.deleteMany({ where: { id, tenantId: tenantId(req) } })
    return result.count ? res.status(204).send() : res.status(404).json({ error: 'Enrollment not found' })
  } catch (error) {
    return next(error)
  }
})

coreRouter.get('/payments', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  try {
    return res.json(await prisma.payment.findMany({
      where: { tenantId: tenantId(req) },
      include: { child: { select: { id: true, fullName: true } } },
      orderBy: { date: 'desc' },
    }))
  } catch (error) {
    return next(error)
  }
})

coreRouter.post('/payments', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  const parsed = paymentCreateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payment data', details: parsed.error.flatten() })
  try {
    await validateChild(tenantId(req), parsed.data.childId)
    return res.status(201).json(await prisma.payment.create({
      data: { ...parsed.data, amount: parsed.data.amount.toFixed(2), tenantId: tenantId(req) },
      include: { child: { select: { id: true, fullName: true } } },
    }))
  } catch (error) {
    const handled = handleValidationError(error, res)
    return handled ?? next(error)
  }
})

coreRouter.patch('/payments/:id', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  const id = routeId(req.params)
  const parsed = paymentUpdateSchema.safeParse(req.body)
  if (!id || !parsed.success) return res.status(400).json({ error: 'Invalid payment update' })
  try {
    await validateChild(tenantId(req), parsed.data.childId)
    const data = {
      ...parsed.data,
      ...(parsed.data.amount !== undefined ? { amount: parsed.data.amount.toFixed(2) } : {}),
    }
    const result = await prisma.payment.updateMany({ where: { id, tenantId: tenantId(req) }, data })
    return result.count
      ? res.json(await prisma.payment.findFirst({ where: { id, tenantId: tenantId(req) }, include: { child: true } }))
      : res.status(404).json({ error: 'Payment not found' })
  } catch (error) {
    const handled = handleValidationError(error, res)
    return handled ?? next(error)
  }
})

coreRouter.delete('/payments/:id', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  const id = routeId(req.params)
  if (!id) return res.status(400).json({ error: 'Invalid payment id' })
  try {
    const result = await prisma.payment.deleteMany({ where: { id, tenantId: tenantId(req) } })
    return result.count ? res.status(204).send() : res.status(404).json({ error: 'Payment not found' })
  } catch (error) {
    return next(error)
  }
})

coreRouter.get('/parent/children', requireRoles(UserRole.PARENT), async (req, res, next) => {
  try {
    return res.json(await prisma.child.findMany({
      where: {
        tenantId: tenantId(req),
        parents: { some: { tenantId: tenantId(req), parent: { userId: req.auth!.userId } } },
      },
      include: { classroom: { select: { id: true, name: true } }, enrollments: true },
      orderBy: { fullName: 'asc' },
    }))
  } catch (error) {
    return next(error)
  }
})

coreRouter.get('/parent/payments', requireRoles(UserRole.PARENT), async (req, res, next) => {
  try {
    return res.json(await prisma.payment.findMany({
      where: {
        tenantId: tenantId(req),
        child: { parents: { some: { tenantId: tenantId(req), parent: { userId: req.auth!.userId } } } },
      },
      include: { child: { select: { id: true, fullName: true } } },
      orderBy: { date: 'desc' },
    }))
  } catch (error) {
    return next(error)
  }
})
