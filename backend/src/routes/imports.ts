import { parse as parseCsv } from 'csv-parse/sync'
import { StaffRole, UserRole } from '@prisma/client'
import ExcelJS from 'exceljs'
import { Router, type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { requireRoles } from '../middleware/auth.js'
import { generateStudentAccessCode } from '../services/student-access-code.js'

export const importsRouter = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
})

const childRowSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  dateOfBirth: z.coerce.date(),
  gender: z.string().trim().max(40).optional().transform((value) => value || null),
  classroom: z.string().trim().max(100).optional().transform((value) => value || null),
})

const staffRowSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  phone: z.string().trim().max(40).optional().transform((value) => value || null),
  role: z.nativeEnum(StaffRole),
  specialization: z.string().trim().max(120).optional().transform((value) => value || null),
  salary: z.union([z.literal(''), z.coerce.number().min(0).max(100000000)]).optional(),
  hireDate: z.coerce.date(),
})

function cellValue(value: ExcelJS.CellValue | undefined) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  throw new Error('Spreadsheet formulas and rich-text values are not accepted')
}

async function parseFile(file: Express.Multer.File) {
  const extension = file.originalname.toLowerCase().split('.').pop()
  if (extension === 'csv') {
    try {
      return parseCsv(file.buffer, {
        bom: true,
        columns: (headers: string[]) => headers.map((header) => header.trim().toLowerCase().replace(/[\s_-]+/g, '')),
        skip_empty_lines: true,
        trim: true,
        max_record_size: 16_384,
        to: 1001,
      }) as Record<string, string>[]
    } catch (error) {
      throw new Error(`Invalid import file: ${error instanceof Error ? error.message : 'CSV parsing failed'}`)
    }
  }
  if (extension !== 'xlsx') throw new Error('Invalid import file: upload a .csv or .xlsx file')

  try {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(new Uint8Array(file.buffer).buffer)
    const worksheet = workbook.worksheets[0]
    if (!worksheet) throw new Error('The spreadsheet has no worksheets')
    if (worksheet.rowCount > 1002 || worksheet.columnCount > 32) throw new Error('The spreadsheet exceeds the allowed size')
    const headerValues = worksheet.getRow(1).values
    const headers = (Array.isArray(headerValues) ? headerValues.slice(1) : Object.values(headerValues))
      .map((value) => cellValue(value).trim().toLowerCase().replace(/[\s_-]+/g, ''))
    const records: Record<string, string>[] = []
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return
      const record = Object.fromEntries(headers.map((header, index) => [header, cellValue(row.getCell(index + 1).value)]))
      if (Object.values(record).some((value) => value.trim())) records.push(record)
    })
    return records
  } catch (error) {
    throw new Error(`Invalid import file: ${error instanceof Error ? error.message : 'Spreadsheet parsing failed'}`)
  }
}

function field(record: Record<string, string>, ...aliases: string[]) {
  for (const alias of aliases) {
    const value = record[alias.replace(/[\s_-]+/g, '').toLowerCase()]
    if (value !== undefined) return value
  }
  return ''
}

function fileMiddleware(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (error: unknown) => {
    if (error) return next(error)
    if (!req.file) return res.status(400).json({ error: 'Choose a CSV or Excel file to import' })
    return next()
  })
}

importsRouter.post('/children', requireRoles(UserRole.ADMIN), fileMiddleware, async (req, res, next) => {
  try {
    const workspaceId = req.auth!.tenantId
    const records = await parseFile(req.file!)
    if (!records.length || records.length > 1000) return res.status(400).json({ error: 'The file must contain between 1 and 1000 data rows' })
    const parsedRows = records.map((record, index) => {
      const parsed = childRowSchema.safeParse({
        fullName: field(record, 'fullName', 'name', 'childName'),
        dateOfBirth: field(record, 'dateOfBirth', 'dob', 'birthDate'),
        gender: field(record, 'gender'),
        classroom: field(record, 'classroom', 'classroomName'),
      })
      if (!parsed.success) throw new Error(`Row ${index + 2}: invalid child data`)
      return parsed.data
    })
    const classroomNames = [...new Set(parsedRows.map((row) => row.classroom).filter((name): name is string => Boolean(name)))]
    const classrooms = classroomNames.length
      ? await prisma.classroom.findMany({
          where: { tenantId: workspaceId, name: { in: classroomNames } },
          select: { id: true, name: true },
        })
      : []
    const classroomByName = new Map(classrooms.map((classroom) => [classroom.name.toLowerCase(), classroom.id]))
    const unknownClassroom = classroomNames.find((name) => !classroomByName.has(name.toLowerCase()))
    if (unknownClassroom) return res.status(400).json({ error: `Classroom "${unknownClassroom}" was not found in this workspace` })

    await prisma.$transaction(async (tx) => {
      for (const row of parsedRows) {
        await tx.child.create({
          data: {
            tenantId: workspaceId,
            fullName: row.fullName,
            dateOfBirth: row.dateOfBirth,
            gender: row.gender,
            classId: row.classroom ? classroomByName.get(row.classroom.toLowerCase()) : null,
            accessCode: await generateStudentAccessCode(tx, workspaceId),
          },
        })
      }
      await tx.notification.create({
        data: {
          tenantId: workspaceId,
          userId: req.auth!.userId,
          title: 'Children import completed',
          message: `${parsedRows.length} children were imported.`,
        },
      })
    })
    return res.status(201).json({ imported: parsedRows.length })
  } catch (error) {
    if (error instanceof Error && (
      error.message.startsWith('Row ')
      || error.message.startsWith('Invalid import file:')
    )) return res.status(400).json({ error: error.message })
    return next(error)
  }
})

importsRouter.post('/staff', requireRoles(UserRole.ADMIN), fileMiddleware, async (req, res, next) => {
  try {
    const workspaceId = req.auth!.tenantId
    const records = await parseFile(req.file!)
    if (!records.length || records.length > 1000) return res.status(400).json({ error: 'The file must contain between 1 and 1000 data rows' })
    const parsedRows = records.map((record, index) => {
      const parsed = staffRowSchema.safeParse({
        name: field(record, 'name', 'fullName'),
        email: field(record, 'email'),
        phone: field(record, 'phone'),
        role: field(record, 'role').toUpperCase(),
        specialization: field(record, 'specialization'),
        salary: field(record, 'salary'),
        hireDate: field(record, 'hireDate', 'startDate'),
      })
      if (!parsed.success) throw new Error(`Row ${index + 2}: invalid staff data`)
      return parsed.data
    })
    await prisma.$transaction(async (tx) => {
      for (const row of parsedRows) {
        await tx.staff.create({
          data: {
            tenantId: workspaceId,
            name: row.name,
            email: row.email,
            phone: row.phone,
            role: row.role,
            specialization: row.specialization,
            salary: typeof row.salary === 'number' ? row.salary.toFixed(2) : null,
            hireDate: row.hireDate,
          },
        })
      }
      await tx.notification.create({
        data: {
          tenantId: workspaceId,
          userId: req.auth!.userId,
          title: 'Staff import completed',
          message: `${parsedRows.length} staff records were imported.`,
        },
      })
    })
    return res.status(201).json({ imported: parsedRows.length })
  } catch (error) {
    if (error instanceof Error && (
      error.message.startsWith('Row ')
      || error.message.startsWith('Invalid import file:')
    )) return res.status(400).json({ error: error.message })
    return next(error)
  }
})
