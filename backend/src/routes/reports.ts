import { UserRole } from '@prisma/client'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { Router, type Response } from 'express'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { requireRoles } from '../middleware/auth.js'

export const reportsRouter = Router()

async function teacherClassroomFilter(req: import('express').Request) {
  if (req.auth!.role !== UserRole.TEACHER) return {}
  const staff = await prisma.staff.findFirst({
    where: { tenantId: req.auth!.tenantId, email: req.auth!.email, role: 'TEACHER' },
    select: { classroomId: true, classroomAssignments: { select: { classroomId: true } } },
  })
  const classroomIds = staff
    ? [...new Set([
        ...staff.classroomAssignments.map(({ classroomId }) => classroomId),
        ...(staff.classroomId ? [staff.classroomId] : []),
      ])]
    : []
  return { classroomId: { in: classroomIds } }
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

function parseDate(value: string | undefined, endOfDay = false) {
  if (!value) return undefined
  const parsed = dateSchema.safeParse(value)
  if (!parsed.success) return null
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date
}

function sendWorkbook(workbook: ExcelJS.Workbook, filename: string, res: Response) {
  return workbook.xlsx.writeBuffer().then((buffer) => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.send(Buffer.from(buffer))
  })
}

function sendPdf(title: string, rows: string[][], filename: string, res: Response) {
  return new Promise<void>((resolve, reject) => {
    const document = new PDFDocument({ margin: 40, size: 'A4' })
    const chunks: Buffer[] = []
    document.on('data', (chunk: Buffer) => chunks.push(chunk))
    document.on('error', reject)
    document.on('end', () => {
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      res.send(Buffer.concat(chunks))
      resolve()
    })
    document.fontSize(18).text(title, { continued: false }).moveDown()
    document.fontSize(9)
    for (const row of rows) {
      document.text(row.map((cell) => cell.replace(/\s+/g, ' ').slice(0, 80)).join('  |  '))
      if (document.y > 740) document.addPage()
    }
    document.end()
  })
}

reportsRouter.get('/finance.xlsx', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  try {
    const tenantId = req.auth!.tenantId
    const [payments, expenses] = await Promise.all([
      prisma.payment.findMany({
        where: { tenantId },
        include: { child: { select: { fullName: true } } },
        orderBy: { date: 'desc' },
      }),
      prisma.expense.findMany({ where: { tenantId }, orderBy: { date: 'desc' } }),
    ])
    const workbook = new ExcelJS.Workbook()
    const summary = workbook.addWorksheet('Summary')
    const totalRevenue = payments
      .filter((payment) => payment.status === 'PAID')
      .reduce((sum, payment) => sum + Number(payment.amount), 0)
    const totalExpenses = expenses.reduce((sum, expense) => sum + Number(expense.amount), 0)
    const pending = payments
      .filter((payment) => payment.status === 'PENDING' || payment.status === 'OVERDUE')
      .reduce((sum, payment) => sum + Number(payment.amount), 0)
    summary.addRows([
      ['Metric', 'Amount'],
      ['Total revenue', totalRevenue],
      ['Total expenses', totalExpenses],
      ['Net balance', totalRevenue - totalExpenses],
      ['Pending payments', pending],
    ])
    const income = workbook.addWorksheet('Payments')
    income.addRow(['Student', 'Amount', 'Currency', 'Status', 'Method', 'Date', 'Reference'])
    payments.forEach((payment) => income.addRow([
      payment.child?.fullName ?? 'General payment',
      Number(payment.amount),
      payment.currency,
      payment.status,
      payment.paymentMethod,
      payment.date,
      payment.reference ?? '',
    ]))
    const expenseSheet = workbook.addWorksheet('Expenses')
    expenseSheet.addRow(['Title', 'Amount', 'Category', 'Date', 'Notes'])
    expenses.forEach((expense) => expenseSheet.addRow([
      expense.title,
      Number(expense.amount),
      expense.category,
      expense.date,
      expense.notes ?? '',
    ]))
    return await sendWorkbook(workbook, 'finance-report.xlsx', res)
  } catch (error) {
    return next(error)
  }
})

reportsRouter.get('/finance.pdf', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  try {
    const tenantId = req.auth!.tenantId
    const [payments, expenses] = await Promise.all([
      prisma.payment.findMany({ where: { tenantId }, include: { child: { select: { fullName: true } } }, orderBy: { date: 'desc' } }),
      prisma.expense.findMany({ where: { tenantId }, orderBy: { date: 'desc' } }),
    ])
    const totalRevenue = payments
      .filter((payment) => payment.status === 'PAID')
      .reduce((sum, payment) => sum + Number(payment.amount), 0)
    const totalExpenses = expenses.reduce((sum, expense) => sum + Number(expense.amount), 0)
    const pending = payments
      .filter((payment) => payment.status === 'PENDING' || payment.status === 'OVERDUE')
      .reduce((sum, payment) => sum + Number(payment.amount), 0)
    const rows = [
      ['SUMMARY', 'AMOUNT'],
      ['Total revenue', totalRevenue.toFixed(2)],
      ['Total expenses', totalExpenses.toFixed(2)],
      ['Net balance', (totalRevenue - totalExpenses).toFixed(2)],
      ['Pending payments', pending.toFixed(2)],
      ['PAYMENTS', 'STUDENT', 'AMOUNT', 'STATUS', 'DATE'],
      ...payments.map((payment) => [
        'Payment',
        payment.child?.fullName ?? 'General payment',
        `${payment.currency} ${Number(payment.amount).toFixed(2)}`,
        payment.status,
        payment.date.toISOString().slice(0, 10),
      ]),
      ['EXPENSES', 'TITLE', 'AMOUNT', 'CATEGORY', 'DATE'],
      ...expenses.map((expense) => [
        'Expense',
        expense.title,
        Number(expense.amount).toFixed(2),
        expense.category,
        expense.date.toISOString().slice(0, 10),
      ]),
    ]
    await sendPdf('Finance report', rows, 'finance-report.pdf', res)
  } catch (error) {
    return next(error)
  }
})

reportsRouter.get('/attendance.xlsx', requireRoles(UserRole.ADMIN, UserRole.TEACHER), async (req, res, next) => {
  const from = parseDate(typeof req.query.from === 'string' ? req.query.from : undefined)
  const to = parseDate(typeof req.query.to === 'string' ? req.query.to : undefined, true)
  if (from === null || to === null || (from && to && from > to)) {
    return res.status(400).json({ error: 'Use a valid date range (YYYY-MM-DD)' })
  }
  try {
    const classroomFilter = await teacherClassroomFilter(req)
    const attendance = await prisma.attendance.findMany({
      where: {
        tenantId: req.auth!.tenantId,
        ...classroomFilter,
        ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      include: {
        child: { select: { fullName: true } },
        classroom: { select: { name: true } },
      },
      orderBy: [{ date: 'desc' }, { classroom: { name: 'asc' } }],
    })
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Attendance')
    sheet.addRow(['Date', 'Classroom', 'Child', 'Status'])
    attendance.forEach((record) => sheet.addRow([
      record.date,
      record.classroom.name,
      record.child.fullName,
      record.status,
    ]))
    return await sendWorkbook(workbook, 'attendance-report.xlsx', res)
  } catch (error) {
    return next(error)
  }
})

reportsRouter.get('/attendance.pdf', requireRoles(UserRole.ADMIN, UserRole.TEACHER), async (req, res, next) => {
  const from = parseDate(typeof req.query.from === 'string' ? req.query.from : undefined)
  const to = parseDate(typeof req.query.to === 'string' ? req.query.to : undefined, true)
  if (from === null || to === null || (from && to && from > to)) {
    return res.status(400).json({ error: 'Use a valid date range (YYYY-MM-DD)' })
  }
  try {
    const classroomFilter = await teacherClassroomFilter(req)
    const attendance = await prisma.attendance.findMany({
      where: {
        tenantId: req.auth!.tenantId,
        ...classroomFilter,
        ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      include: { child: { select: { fullName: true } }, classroom: { select: { name: true } } },
      orderBy: [{ date: 'desc' }, { classroom: { name: 'asc' } }],
    })
    const rows = [
      ['DATE', 'CLASSROOM', 'CHILD', 'STATUS'],
      ...attendance.map((record) => [
        record.date.toISOString().slice(0, 10),
        record.classroom.name,
        record.child.fullName,
        record.status,
      ]),
    ]
    await sendPdf('Attendance report', rows, 'attendance-report.pdf', res)
  } catch (error) {
    return next(error)
  }
})
