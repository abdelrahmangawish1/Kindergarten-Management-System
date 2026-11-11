import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'

export const notificationsRouter = Router()

const idSchema = z.string().min(1)

notificationsRouter.get('/', async (req, res, next) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: {
        tenantId: req.auth!.tenantId,
        OR: [{ userId: null }, { userId: req.auth!.userId }],
      },
      orderBy: { date: 'desc' },
      take: 50,
    })
    return res.json(notifications)
  } catch (error) {
    return next(error)
  }
})

notificationsRouter.patch('/:id/read', async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id)
  if (!id.success) return res.status(400).json({ error: 'Invalid notification id' })
  try {
    const result = await prisma.notification.updateMany({
      where: {
        id: id.data,
        tenantId: req.auth!.tenantId,
        OR: [{ userId: null }, { userId: req.auth!.userId }],
      },
      data: { isRead: true },
    })
    return result.count
      ? res.json(await prisma.notification.findFirst({ where: { id: id.data, tenantId: req.auth!.tenantId } }))
      : res.status(404).json({ error: 'Notification not found' })
  } catch (error) {
    return next(error)
  }
})

notificationsRouter.post('/read-all', async (req, res, next) => {
  try {
    const result = await prisma.notification.updateMany({
      where: {
        tenantId: req.auth!.tenantId,
        isRead: false,
        OR: [{ userId: null }, { userId: req.auth!.userId }],
      },
      data: { isRead: true },
    })
    return res.json({ updated: result.count })
  } catch (error) {
    return next(error)
  }
})
