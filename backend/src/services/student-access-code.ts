import type { Prisma } from '@prisma/client'

export async function generateStudentAccessCode(
  transaction: Prisma.TransactionClient,
  tenantId: string,
  year = new Date().getFullYear(),
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const tenant = await transaction.tenant.update({
      where: { id: tenantId },
      data: { nextStudentAccessCodeSequence: { increment: 1 } },
      select: { nextStudentAccessCodeSequence: true },
    })
    const sequence = tenant.nextStudentAccessCodeSequence - 1
    const accessCode = `KG-${year}-${String(sequence).padStart(3, '0')}`
    const existing = await transaction.child.findFirst({
      where: { tenantId, accessCode },
      select: { id: true },
    })
    if (!existing) return accessCode
  }

  throw new Error('Unable to allocate a unique student access code')
}
