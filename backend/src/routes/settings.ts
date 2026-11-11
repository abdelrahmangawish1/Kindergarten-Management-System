import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { readFile, unlink } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Router } from 'express'
import { UserRole } from '@prisma/client'
import multer from 'multer'
import { prisma } from '../config/prisma.js'
import { requireRoles } from '../middleware/auth.js'

export const settingsRouter = Router()

const logoDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../uploads/logos')
mkdirSync(logoDirectory, { recursive: true })

const allowedLogoTypes = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
])

const uploadLogo = multer({
  storage: multer.diskStorage({
    destination: logoDirectory,
    filename: (req, file, callback) => {
      const extension = allowedLogoTypes.get(file.mimetype) ?? ''
      callback(null, `${req.auth!.tenantId}-${randomUUID()}${extension}`)
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, allowedLogoTypes.has(file.mimetype)),
})

async function removePreviousLogo(logoUrl: string | null | undefined, tenantId: string) {
  if (!logoUrl?.startsWith('/uploads/logos/')) return
  const filename = logoUrl.slice('/uploads/logos/'.length)
  if (
    filename !== basename(filename) ||
    !filename.startsWith(`${tenantId}-`) ||
    !['.png', '.jpg', '.webp'].includes(extname(filename))
  ) return

  try {
    await unlink(join(logoDirectory, filename))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
}

function isValidImageSignature(mimeType: string, buffer: Buffer) {
  if (mimeType === 'image/png') {
    return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  }
  if (mimeType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  }
  if (mimeType === 'image/webp') {
    return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
  }
  return false
}

settingsRouter.put(
  '/logo',
  requireRoles(UserRole.ADMIN),
  uploadLogo.single('logo'),
  async (req, res, next) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Choose a PNG, JPEG, or WebP logo no larger than 2 MB' })
    }

    let logoSaved = false
    try {
      const signature = await readFile(req.file.path)
      if (!isValidImageSignature(req.file.mimetype, signature)) {
        await unlink(req.file.path)
        return res.status(400).json({ error: 'The uploaded file is not a valid PNG, JPEG, or WebP image' })
      }

      const [oldSettings, tenant] = await Promise.all([
        prisma.tenantSettings.findUnique({
          where: { tenantId: req.auth!.tenantId },
          select: { logoUrl: true },
        }),
        prisma.tenant.findUniqueOrThrow({
          where: { id: req.auth!.tenantId },
          select: { name: true },
        }),
      ])

      const settings = await prisma.tenantSettings.upsert({
        where: { tenantId: req.auth!.tenantId },
        create: {
          tenantId: req.auth!.tenantId,
          kindergartenName: tenant.name,
          logoUrl: `/uploads/logos/${req.file.filename}`,
        },
        update: { logoUrl: `/uploads/logos/${req.file.filename}` },
        select: { logoUrl: true },
      })
      logoSaved = true
      await removePreviousLogo(oldSettings?.logoUrl, req.auth!.tenantId).catch((error: unknown) => {
        console.error('Could not remove the previous workspace logo', error)
      })

      return res.json({ logoUrl: settings.logoUrl })
    } catch (error) {
      if (!logoSaved) {
        await unlink(req.file.path).catch((cleanupError: unknown) => {
          if (!(cleanupError instanceof Error && 'code' in cleanupError && cleanupError.code === 'ENOENT')) {
            console.error('Could not clean up an incomplete logo upload', cleanupError)
          }
        })
      }
      return next(error)
    }
  },
)

settingsRouter.delete('/logo', requireRoles(UserRole.ADMIN), async (req, res, next) => {
  try {
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId: req.auth!.tenantId },
      select: { logoUrl: true },
    })
    if (!settings) return res.json({ logoUrl: null })

    await prisma.tenantSettings.update({
      where: { tenantId: req.auth!.tenantId },
      data: { logoUrl: null },
    })
    await removePreviousLogo(settings.logoUrl, req.auth!.tenantId)
    return res.json({ logoUrl: null })
  } catch (error) {
    return next(error)
  }
})
