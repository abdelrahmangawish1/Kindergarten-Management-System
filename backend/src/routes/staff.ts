import { StaffRole, UserRole } from '@prisma/client'
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { requireRoles } from '../middleware/auth.js'

export const staffRouter = Router()

const staffSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  classroomId: z.string().min(1).nullable().optional(),
  classroomIds: z.array(z.string().min(1)).max(20).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  role: z.nativeEnum(StaffRole),
  specialization: z.string().trim().max(120).nullable().optional(),
  salary: z.coerce.number().min(0).max(100000000).nullable().optional(),
  hireDate: z.coerce.date(),
})
const idSchema = z.string().min(1)

staffRouter.get('/', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  try {
    return res.json(await prisma.staff.findMany({
      where: { tenantId: req.auth!.tenantId },
      include: { classroom: { select: { id: true, name: true } }, classroomAssignments: { include: { classroom: { select: { id: true, name: true } } } } },
      orderBy: { name: 'asc' },
    }))
  } catch (error) {
    return next(error)
  }
})

staffRouter.post('/', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  const parsed = staffSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid staff data', details: parsed.error.flatten() })
  try {
    const assignedClassroomIds = parsed.data.classroomIds
      ?? (parsed.data.classroomId ? [parsed.data.classroomId] : [])
    const classrooms = assignedClassroomIds.length
      ? await prisma.classroom.findMany({
          where: { id: { in: assignedClassroomIds }, tenantId: req.auth!.tenantId },
          select: { id: true },
        })
      : []
    if (classrooms.length !== assignedClassroomIds.length || classrooms.length !== new Set(assignedClassroomIds).size) {
      return res.status(400).json({ error: 'One or more classrooms do not belong to this kindergarten' })
    }
    const { classroomId: _classroomId, classroomIds: _classroomIds, ...staffData } = parsed.data
    const created = await prisma.$transaction(async (tx) => {
      const record = await tx.staff.create({
        data: {
          ...staffData,
          classroomId: assignedClassroomIds[0] ?? null,
          ...(parsed.data.salary !== undefined && parsed.data.salary !== null
            ? { salary: parsed.data.salary.toFixed(2) }
            : {}),
          tenantId: req.auth!.tenantId,
        },
      })
      if (assignedClassroomIds.length) {
        await tx.staffClassroom.createMany({
          data: assignedClassroomIds.map((id) => ({ tenantId: req.auth!.tenantId, staffId: record.id, classroomId: id })),
        })
      }
      return tx.staff.findUniqueOrThrow({
        where: { id: record.id },
        include: { classroom: { select: { id: true, name: true } }, classroomAssignments: { include: { classroom: { select: { id: true, name: true } } } } },
      })
    })
    return res.status(201).json(created)
  } catch (error) {
    return next(error)
  }
})

staffRouter.patch('/:id', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id)
  const parsed = staffSchema.partial().safeParse(req.body)
  if (!id.success || !parsed.success || !Object.keys(parsed.data).length) {
    return res.status(400).json({ error: 'Invalid staff update' })
  }
  try {
    const assignedClassroomIds = parsed.data.classroomIds !== undefined
      ? parsed.data.classroomIds
      : parsed.data.classroomId !== undefined
        ? parsed.data.classroomId ? [parsed.data.classroomId] : []
        : undefined
    const classrooms = assignedClassroomIds?.length
      ? await prisma.classroom.findMany({
          where: { id: { in: assignedClassroomIds }, tenantId: req.auth!.tenantId },
          select: { id: true },
        })
      : []
    if (assignedClassroomIds && (classrooms.length !== assignedClassroomIds.length || classrooms.length !== new Set(assignedClassroomIds).size)) {
      return res.status(400).json({ error: 'One or more classrooms do not belong to this kindergarten' })
    }
    const { classroomId: _classroomId, classroomIds: _classroomIds, ...staffData } = parsed.data
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.staff.updateMany({
        where: { id: id.data, tenantId: req.auth!.tenantId },
        data: {
          ...staffData,
          ...(assignedClassroomIds ? { classroomId: assignedClassroomIds[0] ?? null } : {}),
          ...(parsed.data.salary !== undefined && parsed.data.salary !== null
            ? { salary: parsed.data.salary.toFixed(2) }
            : {}),
        },
      })
      if (!updated.count || !assignedClassroomIds) return updated
      await tx.staffClassroom.deleteMany({ where: { tenantId: req.auth!.tenantId, staffId: id.data } })
      if (assignedClassroomIds.length) {
        await tx.staffClassroom.createMany({
          data: assignedClassroomIds.map((classroomId) => ({ tenantId: req.auth!.tenantId, staffId: id.data, classroomId })),
        })
      }
      return updated
    })
    return result.count
      ? res.json(await prisma.staff.findFirst({
          where: { id: id.data, tenantId: req.auth!.tenantId },
          include: { classroom: { select: { id: true, name: true } }, classroomAssignments: { include: { classroom: { select: { id: true, name: true } } } } },
        }))
      : res.status(404).json({ error: 'Staff record not found' })
  } catch (error) {
    return next(error)
  }
})

staffRouter.delete('/:id', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id)
  if (!id.success) return res.status(400).json({ error: 'Invalid staff id' })
  try {
    const result = await prisma.staff.deleteMany({ where: { id: id.data, tenantId: req.auth!.tenantId } })
    return result.count ? res.status(204).send() : res.status(404).json({ error: 'Staff record not found' })
  } catch (error) {
    return next(error)
  }
})
