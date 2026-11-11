import { UserRole } from '@prisma/client'
import { Router } from 'express'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { requireRoles } from '../middleware/auth.js'

export const homeworkRouter = Router()
const homeworkDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../uploads/homework')

const homeworkSchema = z.object({
  classroomId: z.string().min(1),
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(4000).default(''),
  instructions: z.string().trim().max(8000).default(''),
  dueDate: z.coerce.date(),
  attachments: z.array(z.object({
    label: z.string().trim().min(1).max(120),
    url: z.string().url().max(2048).refine((value) => ['http:', 'https:'].includes(new URL(value).protocol)),
  })).max(10).default([]),
})

const gradingSchema = z.object({
  grade: z.coerce.number().min(0).max(100),
  feedback: z.string().trim().max(4000).default(''),
})

function isSubmissionFile(value: unknown): value is { fileName: string; originalName: string; mimeType: string; size: number } {
  if (!value || typeof value !== 'object') return false
  const file = value as Record<string, unknown>
  return typeof file.fileName === 'string'
    && basename(file.fileName) === file.fileName
    && typeof file.originalName === 'string'
    && typeof file.mimeType === 'string'
    && typeof file.size === 'number'
}

async function assignedStaff(tenantId: string, email: string) {
  const staff = await prisma.staff.findFirst({
    where: { tenantId, email, role: 'TEACHER' },
    select: {
      id: true,
      classroomId: true,
      classroom: { select: { id: true, name: true } },
      classroomAssignments: { select: { classroom: { select: { id: true, name: true } } } },
    },
  })
  if (!staff) return null
  const classrooms = new Map<string, { id: string; name: string }>()
  for (const assignment of staff.classroomAssignments) classrooms.set(assignment.classroom.id, assignment.classroom)
  if (staff.classroom) classrooms.set(staff.classroom.id, staff.classroom)
  return { id: staff.id, classrooms: [...classrooms.values()] }
}

homeworkRouter.get('/', requireRoles(UserRole.TEACHER), async (req, res, next) => {
  try {
    const staff = await assignedStaff(req.auth!.tenantId, req.auth!.email)
    if (!staff?.classrooms.length) return res.json({ classrooms: [], students: [], homework: [] })
    const classroomIds = staff.classrooms.map(({ id }) => id)
    const [homework, students] = await Promise.all([
      prisma.homework.findMany({
        where: { tenantId: req.auth!.tenantId, classroomId: { in: classroomIds } },
        include: {
          classroom: { select: { id: true, name: true } },
          submissions: {
            include: { child: { select: { id: true, fullName: true } } },
            orderBy: { submittedAt: 'desc' },
          },
        },
        orderBy: { dueDate: 'desc' },
      }),
      prisma.child.findMany({
        where: { tenantId: req.auth!.tenantId, classId: { in: classroomIds } },
        select: { id: true, fullName: true },
        orderBy: { fullName: 'asc' },
      }),
    ])
    return res.json({ classrooms: staff.classrooms, students, homework })
  } catch (error) {
    return next(error)
  }
})

homeworkRouter.post('/', requireRoles(UserRole.TEACHER), async (req, res, next) => {
  const parsed = homeworkSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid homework data', details: parsed.error.flatten() })
  try {
    const staff = await assignedStaff(req.auth!.tenantId, req.auth!.email)
    if (!staff?.classrooms.some(({ id }) => id === parsed.data.classroomId)) {
      return res.status(403).json({ error: 'You can only assign homework to your assigned classroom' })
    }
    const { attachments, ...data } = parsed.data
    const homework = await prisma.homework.create({
      data: {
        ...data,
        tenantId: req.auth!.tenantId,
        createdByStaffId: staff.id,
        attachments,
      },
      include: { classroom: { select: { id: true, name: true } } },
    })
    return res.status(201).json(homework)
  } catch (error) {
    return next(error)
  }
})

homeworkRouter.patch('/submissions/:id', requireRoles(UserRole.TEACHER), async (req, res, next) => {
  const id = z.string().min(1).safeParse(req.params.id)
  const parsed = gradingSchema.safeParse(req.body)
  if (!id.success || !parsed.success) return res.status(400).json({ error: 'Invalid grading data' })
  try {
    const staff = await assignedStaff(req.auth!.tenantId, req.auth!.email)
    if (!staff?.classrooms.length) return res.status(403).json({ error: 'No classroom is assigned to this teacher' })
    const classroomIds = staff.classrooms.map(({ id }) => id)
    const submission = await prisma.homeworkSubmission.findFirst({
      where: {
        id: id.data,
        tenantId: req.auth!.tenantId,
        homework: { classroomId: { in: classroomIds } },
      },
      select: { id: true },
    })
    if (!submission) return res.status(404).json({ error: 'Submission not found' })
    const updated = await prisma.homeworkSubmission.update({
      where: { id: submission.id },
      data: {
        grade: parsed.data.grade.toFixed(2),
        feedback: parsed.data.feedback || null,
        status: 'GRADED',
        gradedAt: new Date(),
        gradedByStaffId: staff.id,
      },
      include: { child: { select: { id: true, fullName: true } } },
    })
    return res.json(updated)
  } catch (error) {
    return next(error)
  }
})

homeworkRouter.get('/submissions/:id/files/:fileName', requireRoles(UserRole.TEACHER), async (req, res, next) => {
  const id = z.string().min(1).safeParse(req.params.id)
  const fileName = z.string().min(1).refine((value) => basename(value) === value).safeParse(req.params.fileName)
  if (!id.success || !fileName.success) return res.status(400).json({ error: 'Invalid homework file path' })
  try {
    const staff = await assignedStaff(req.auth!.tenantId, req.auth!.email)
    if (!staff?.classrooms.length) return res.status(403).json({ error: 'No classroom is assigned to this teacher' })
    const classroomIds = staff.classrooms.map(({ id }) => id)
    const submission = await prisma.homeworkSubmission.findFirst({
      where: { id: id.data, tenantId: req.auth!.tenantId, homework: { classroomId: { in: classroomIds } } },
      select: { attachments: true },
    })
    const file = Array.isArray(submission?.attachments)
      ? submission.attachments.find((entry) => isSubmissionFile(entry) && entry.fileName === fileName.data)
      : undefined
    if (!file || !isSubmissionFile(file)) return res.status(404).json({ error: 'Homework file not found' })
    res.setHeader('Content-Type', file.mimeType)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.originalName)}"`)
    return res.sendFile(join(homeworkDirectory, file.fileName))
  } catch (error) {
    return next(error)
  }
})
