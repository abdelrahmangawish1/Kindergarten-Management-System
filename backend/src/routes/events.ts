import { EventAudience, UserRole } from '@prisma/client'
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { requireRoles } from '../middleware/auth.js'

export const eventsRouter = Router()

const eventSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).nullable().optional(),
  date: z.coerce.date(),
  targetAudience: z.nativeEnum(EventAudience).default(EventAudience.ALL),
})
const idSchema = z.string().min(1)

eventsRouter.get('/', async (req, res, next) => {
  try {
    const audience = req.auth!.role === UserRole.PARENT
      ? [EventAudience.ALL, EventAudience.PARENTS]
      : req.auth!.role === UserRole.TEACHER
        ? [EventAudience.ALL, EventAudience.TEACHERS]
        : Object.values(EventAudience)
    return res.json(await prisma.event.findMany({
      where: { workspaceId: req.auth!.tenantId, targetAudience: { in: audience } },
      orderBy: { date: 'asc' },
    }))
  } catch (error) {
    return next(error)
  }
})

eventsRouter.post('/', requireRoles(UserRole.ADMIN, UserRole.TEACHER), async (req, res, next) => {
  const parsed = eventSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid event data', details: parsed.error.flatten() })
  try {
    const [event] = await prisma.$transaction([
      prisma.event.create({ data: { ...parsed.data, workspaceId: req.auth!.tenantId } }),
      prisma.notification.create({
        data: {
          tenantId: req.auth!.tenantId,
          title: 'New kindergarten event',
          message: parsed.data.title,
        },
      }),
    ])
    return res.status(201).json(event)
  } catch (error) {
    return next(error)
  }
})

eventsRouter.patch('/:id', requireRoles(UserRole.ADMIN, UserRole.TEACHER), async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id)
  const parsed = eventSchema.partial().safeParse(req.body)
  if (!id.success || !parsed.success || !Object.keys(parsed.data).length) {
    return res.status(400).json({ error: 'Invalid event update' })
  }
  try {
    const result = await prisma.event.updateMany({
      where: { id: id.data, workspaceId: req.auth!.tenantId },
      data: parsed.data,
    })
    if (!result.count) return res.status(404).json({ error: 'Event not found' })
    return res.json(await prisma.event.findFirst({
      where: { id: id.data, workspaceId: req.auth!.tenantId },
    }))
  } catch (error) {
    return next(error)
  }
})

eventsRouter.delete('/:id', requireRoles(UserRole.ADMIN, UserRole.TEACHER), async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id)
  if (!id.success) return res.status(400).json({ error: 'Invalid event id' })
  try {
    const result = await prisma.event.deleteMany({
      where: { id: id.data, workspaceId: req.auth!.tenantId },
    })
    return result.count ? res.status(204).send() : res.status(404).json({ error: 'Event not found' })
  } catch (error) {
    return next(error)
  }
})
