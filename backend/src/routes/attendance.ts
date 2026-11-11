import { AttendanceStatus, UserRole } from '@prisma/client'
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { requireRoles } from '../middleware/auth.js'

export const attendanceRouter = Router()

async function teacherClassroomIds(req: import('express').Request) {
  if (req.auth!.role !== UserRole.TEACHER) return undefined
  const staff = await prisma.staff.findFirst({
    where: { tenantId: req.auth!.tenantId, email: req.auth!.email, role: 'TEACHER' },
    select: { classroomId: true, classroomAssignments: { select: { classroomId: true } } },
  })
  if (!staff) return []
  return [...new Set([
    ...staff.classroomAssignments.map(({ classroomId }) => classroomId),
    ...(staff.classroomId ? [staff.classroomId] : []),
  ])]
}

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const attendanceQuery = z.object({
  classroomId: z.string().min(1),
  date: dateString,
})
const attendanceUpdate = z.object({
  classroomId: z.string().min(1),
  date: dateString,
  records: z.array(z.object({
    childId: z.string().min(1),
    status: z.nativeEnum(AttendanceStatus),
  })).min(1).max(500),
})

function dayDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date
}

attendanceRouter.get('/', requireRoles(UserRole.ADMIN, UserRole.TEACHER), async (req, res, next) => {
  const parsed = attendanceQuery.safeParse(req.query)
  const date = parsed.success ? dayDate(parsed.data.date) : null
  if (!parsed.success || !date) return res.status(400).json({ error: 'A valid classroomId and date (YYYY-MM-DD) are required' })

  try {
    const workspaceId = req.auth!.tenantId
    const assignedClasses = await teacherClassroomIds(req)
    if (assignedClasses && !assignedClasses.includes(parsed.data.classroomId)) {
      return res.status(403).json({ error: 'You can only access your assigned classroom' })
    }
    const classroom = await prisma.classroom.findFirst({
      where: { id: parsed.data.classroomId, tenantId: workspaceId },
    })
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' })

    const [children, attendance] = await Promise.all([
      prisma.child.findMany({
        where: { tenantId: workspaceId, classId: classroom.id },
        select: { id: true, fullName: true },
        orderBy: { fullName: 'asc' },
      }),
      prisma.attendance.findMany({
        where: { tenantId: workspaceId, classroomId: classroom.id, date },
        select: { childId: true, status: true },
      }),
    ])
    const statusByChild = new Map(attendance.map((record) => [record.childId, record.status]))
    return res.json(children.map((child) => ({ ...child, status: statusByChild.get(child.id) ?? null })))
  } catch (error) {
    return next(error)
  }
})

attendanceRouter.put('/', requireRoles(UserRole.ADMIN, UserRole.TEACHER), async (req, res, next) => {
  const parsed = attendanceUpdate.safeParse(req.body)
  const date = parsed.success ? dayDate(parsed.data.date) : null
  if (!parsed.success || !date) return res.status(400).json({ error: 'Invalid attendance data' })
  if (new Set(parsed.data.records.map((record) => record.childId)).size !== parsed.data.records.length) {
    return res.status(400).json({ error: 'Each child can only be marked once per date' })
  }

  try {
    const workspaceId = req.auth!.tenantId
    const assignedClasses = await teacherClassroomIds(req)
    if (assignedClasses && !assignedClasses.includes(parsed.data.classroomId)) {
      return res.status(403).json({ error: 'You can only access your assigned classroom' })
    }
    const classroom = await prisma.classroom.findFirst({
      where: { id: parsed.data.classroomId, tenantId: workspaceId },
      select: { id: true },
    })
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' })

    const childIds = parsed.data.records.map((record) => record.childId)
    const children = await prisma.child.findMany({
      where: { id: { in: childIds }, tenantId: workspaceId, classId: classroom.id },
      select: { id: true },
    })
    if (children.length !== childIds.length) {
      return res.status(400).json({ error: 'Every child must belong to this classroom and workspace' })
    }

    await prisma.$transaction(parsed.data.records.map((record) => prisma.attendance.upsert({
      where: { tenantId_childId_date: { tenantId: workspaceId, childId: record.childId, date } },
      create: {
        tenantId: workspaceId,
        classroomId: classroom.id,
        childId: record.childId,
        date,
        status: record.status,
      },
      update: { classroomId: classroom.id, status: record.status },
    })))
    return res.json({ updated: childIds.length })
  } catch (error) {
    return next(error)
  }
})
