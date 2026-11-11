import { PaymentStatus, UserRole } from '@prisma/client'
import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { requireRoles } from '../middleware/auth.js'

export const financeRouter = Router()

const expenseSchema = z.object({
  title: z.string().trim().min(1).max(160),
  amount: z.coerce.number().positive().max(100000000),
  category: z.string().trim().min(1).max(80),
  date: z.coerce.date(),
  notes: z.string().trim().max(1000).nullable().optional(),
})
const idSchema = z.string().min(1)

financeRouter.get('/summary', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  try {
    const workspaceId = req.auth!.tenantId
    const [payments, expenses, pendingPayments] = await Promise.all([
      prisma.payment.findMany({ where: { tenantId: workspaceId, status: PaymentStatus.PAID }, select: { amount: true } }),
      prisma.expense.findMany({ where: { tenantId: workspaceId }, select: { amount: true } }),
      prisma.payment.findMany({
        where: { tenantId: workspaceId, status: { in: [PaymentStatus.PENDING, PaymentStatus.OVERDUE] } },
        select: { amount: true },
      }),
    ])
    const totalRevenue = payments.reduce((sum, payment) => sum + Number(payment.amount), 0)
    const totalExpenses = expenses.reduce((sum, expense) => sum + Number(expense.amount), 0)
    const pendingAmount = pendingPayments.reduce((sum, payment) => sum + Number(payment.amount), 0)
    return res.json({
      totalRevenue,
      totalExpenses,
      netBalance: totalRevenue - totalExpenses,
      pendingPayments: pendingAmount,
    })
  } catch (error) {
    return next(error)
  }
})

financeRouter.get('/expenses', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  try {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined
    return res.json(await prisma.expense.findMany({
      where: { tenantId: req.auth!.tenantId, ...(category ? { category } : {}) },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    }))
  } catch (error) {
    return next(error)
  }
})

financeRouter.post('/expenses', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  const parsed = expenseSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid expense data', details: parsed.error.flatten() })
  try {
    return res.status(201).json(await prisma.expense.create({
      data: { ...parsed.data, amount: parsed.data.amount.toFixed(2), tenantId: req.auth!.tenantId },
    }))
  } catch (error) {
    return next(error)
  }
})

financeRouter.patch('/expenses/:id', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id)
  const parsed = expenseSchema.partial().safeParse(req.body)
  if (!id.success || !parsed.success || !Object.keys(parsed.data).length) {
    return res.status(400).json({ error: 'Invalid expense update' })
  }
  try {
    const data = {
      ...parsed.data,
      ...(parsed.data.amount !== undefined ? { amount: parsed.data.amount.toFixed(2) } : {}),
    }
    const result = await prisma.expense.updateMany({
      where: { id: id.data, tenantId: req.auth!.tenantId },
      data,
    })
    return result.count
      ? res.json(await prisma.expense.findFirst({ where: { id: id.data, tenantId: req.auth!.tenantId } }))
      : res.status(404).json({ error: 'Expense not found' })
  } catch (error) {
    return next(error)
  }
})

financeRouter.delete('/expenses/:id', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  const id = idSchema.safeParse(req.params.id)
  if (!id.success) return res.status(400).json({ error: 'Invalid expense id' })
  try {
    const result = await prisma.expense.deleteMany({ where: { id: id.data, tenantId: req.auth!.tenantId } })
    return result.count ? res.status(204).send() : res.status(404).json({ error: 'Expense not found' })
  } catch (error) {
    return next(error)
  }
})
