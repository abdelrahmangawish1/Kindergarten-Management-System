import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import morgan from 'morgan'
import { UserRole } from '@prisma/client'
import { ZodError } from 'zod'
import { env } from './config/env.js'
import { prisma } from './config/prisma.js'
import { authenticate, requireRoles } from './middleware/auth.js'
import { authRouter } from './routes/auth.js'
import { attendanceRouter } from './routes/attendance.js'
import { coreRouter } from './routes/core.js'
import { eventsRouter } from './routes/events.js'
import { financeRouter } from './routes/finance.js'
import { importsRouter } from './routes/imports.js'
import { notificationsRouter } from './routes/notifications.js'
import { parentPortalRouter } from './routes/parent-portal.js'
import { reportsRouter } from './routes/reports.js'
import { staffRouter } from './routes/staff.js'
import { settingsRouter } from './routes/settings.js'
import { homeworkRouter } from './routes/homework.js'
import { aiRouter } from './routes/ai.js'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = express()

app.use(helmet())
app.use(cors({ origin: env.corsOrigin, credentials: true, exposedHeaders: ['X-AI-Mode'] }))
app.use(express.json({ limit: '1mb' }))
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'))
app.use(
  '/uploads/logos',
  express.static(resolve(dirname(fileURLToPath(import.meta.url)), '../uploads/logos'), {
    immutable: true,
    maxAge: '1y',
  }),
)
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  }),
)
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 }))

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'kindergarten-backend',
    mode: 'multi-tenant',
    timestamp: new Date().toISOString(),
  })
})

app.use('/api/auth', authRouter)
app.use('/api/parent', parentPortalRouter)
app.use('/api', authenticate)
app.use('/api/settings', settingsRouter)
app.use('/api/homework', homeworkRouter)
app.use('/api/ai', aiRouter)
app.use('/api/attendance', attendanceRouter)
app.use('/api/events', eventsRouter)
app.use('/api/finance', financeRouter)
app.use('/api/staff', staffRouter)
app.use('/api/imports', importsRouter)
app.use('/api/notifications', notificationsRouter)
app.use('/api/reports', reportsRouter)
app.use('/api', coreRouter)

app.get('/api/dashboard', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  try {
    const tenantId = req.auth!.tenantId
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const [totalChildren, activeEnrollments, classrooms, teachers, payments, tenant] = await Promise.all([
      prisma.child.count({ where: { tenantId } }),
      prisma.enrollment.count({ where: { tenantId, status: 'ACTIVE' } }),
      prisma.classroom.count({ where: { tenantId } }),
      prisma.user.count({ where: { tenantId, role: 'TEACHER', status: 'ACTIVE' } }),
      prisma.payment.findMany({
        where: { tenantId, createdAt: { gte: monthStart }, status: 'PAID' },
        select: { amount: true },
      }),
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, settings: true },
      }),
    ])
    const monthlyRevenue = payments.reduce((sum, payment) => sum + Number(payment.amount), 0)
    return res.json({
      tenant,
      summary: { totalChildren, activeEnrollments, classrooms, teachers, monthlyRevenue },
    })
  } catch (error) {
    return next(error)
  }
})

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err)
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Invalid request data', details: err.flatten() })
  }
  if (err instanceof SyntaxError && 'status' in err && err.status === 400) {
    return res.status(400).json({ error: 'Malformed JSON request body' })
  }
  if ('code' in err && err.code === 'P2002') {
    return res.status(409).json({ error: 'A record with the same unique value already exists' })
  }
  if ('code' in err && err.code === 'P2003') {
    return res.status(409).json({ error: 'This record is still referenced by other records' })
  }
  if ('code' in err && typeof err.code === 'string' && err.code.startsWith('LIMIT_')) {
    return res.status(413).json({ error: 'The uploaded file exceeds the allowed size limit' })
  }
  return res.status(500).json({ error: 'Internal server error' })
})

const server = app.listen(env.port, () => {
  console.log(`Kindergarten backend running on http://localhost:${env.port}`)
})

async function shutdown() {
  server.close(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
