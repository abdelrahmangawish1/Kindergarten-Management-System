import { createOpenAI } from '@ai-sdk/openai'
import { pipeTextStreamToResponse, streamText, type ModelMessage } from 'ai'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { env } from '../config/env.js'
import { requireRoles } from '../middleware/auth.js'
import { UserRole } from '@prisma/client'

export const aiRouter = Router()

const requestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(5000),
  })).min(1).max(30),
}).superRefine(({ messages }, context) => {
  const totalCharacters = messages.reduce((total, message) => total + message.content.length, 0)
  if (totalCharacters > 20000) {
    context.addIssue({ code: 'custom', message: 'Chat history is too long', path: ['messages'] })
  }
  if (messages[messages.length - 1]?.role !== 'user') {
    context.addIssue({ code: 'custom', message: 'The latest message must be from the user', path: ['messages'] })
  }
})

const assistantInstruction = [
  'You are the Kindergarten Management Assistant inside a kindergarten operations platform.',
  'Help administrators and teachers with practical, age-appropriate classroom ideas, homework prompts,',
  'lesson activities, parent communication, and explanations of the workspace summary data provided below.',
  'Be concise, supportive, inclusive, and safety-conscious. Do not provide medical diagnoses or claim to',
  'have changed records. Never ask for or disclose sensitive child information. Use only the aggregate',
  'workspace context below for statistics; if a requested detail is not available, say so.',
].join(' ')

async function workspaceContext(tenantId: string, email: string, role: UserRole) {
  if (role === UserRole.ADMIN) {
    const [children, classrooms, activeEnrollments, teachers] = await Promise.all([
      prisma.child.count({ where: { tenantId } }),
      prisma.classroom.count({ where: { tenantId } }),
      prisma.enrollment.count({ where: { tenantId, status: 'ACTIVE' } }),
      prisma.user.count({ where: { tenantId, role: UserRole.TEACHER, status: 'ACTIVE' } }),
    ])
    return `User role: administrator. Workspace aggregate: ${children} children, ${classrooms} classrooms, ${activeEnrollments} active enrollments, ${teachers} active teachers.`
  }

  const staff = await prisma.staff.findFirst({
    where: { tenantId, email, role: 'TEACHER' },
    select: {
      classroomId: true,
      classroomAssignments: { select: { classroomId: true } },
    },
  })
  if (!staff) return 'User role: teacher. No classroom assignment is configured for this teacher.'

  const classroomIds = [...new Set([
    ...staff.classroomAssignments.map(({ classroomId }) => classroomId),
    ...(staff.classroomId ? [staff.classroomId] : []),
  ])]
  if (!classroomIds.length) return 'User role: teacher. No classroom assignment is configured for this teacher.'

  const classrooms = await prisma.classroom.findMany({
    where: { tenantId, id: { in: classroomIds } },
    select: { name: true, _count: { select: { children: true, homework: true } } },
    orderBy: { name: 'asc' },
  })
  const children = classrooms.reduce((total, classroom) => total + classroom._count.children, 0)
  const assignments = classrooms.reduce((total, classroom) => total + classroom._count.homework, 0)
  return `User role: teacher. Assigned classroom summary: ${classrooms.map(({ name, _count }) => `${name} (${_count.children} children, ${_count.homework} homework assignments)`).join('; ')}. Total assigned children: ${children}. Total assigned homework assignments: ${assignments}.`
}

function mockResponse(latestMessage: string, context: string) {
  const lowerMessage = latestMessage.toLowerCase()
  if (lowerMessage.includes('stat') || lowerMessage.includes('summar')) {
    return `Here is the available workspace summary:\n${context}\n\nI can also help turn these numbers into an action plan or classroom activity.`
  }
  return `Here are a few kindergarten-friendly ideas:\n\n- Use a short story, picture prompt, or hands-on sorting activity to introduce the topic.\n- Offer a simple drawing or verbal explanation as a way to show understanding.\n- Keep the activity brief and adapt it to each child's interests and abilities.\n\n${context}\n\nThis is a demo response. Add OPENAI_API_KEY to the backend environment to enable generated answers.`
}

aiRouter.post(
  '/chat',
  requireRoles(UserRole.ADMIN, UserRole.TEACHER),
  rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false }),
  async (req, res, next) => {
    const parsed = requestSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid assistant chat request', details: parsed.error.flatten() })
    }

    try {
      const context = await workspaceContext(
        req.auth!.tenantId,
        req.auth!.email,
        req.auth!.role,
      )
      const system = `${assistantInstruction}\n\nCurrent role-scoped workspace context:\n${context}`
      const messages: ModelMessage[] = parsed.data.messages.map(({ role, content }) => ({ role, content }))
      const apiKey = env.openAiApiKey

      if (!apiKey) {
        const answer = mockResponse(parsed.data.messages.at(-1)!.content, context)
        const chunks = answer.match(/.{1,24}(?:\s|$)/gs) ?? [answer]
        const stream = new ReadableStream<string>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk)
            controller.close()
          },
        })
        res.setHeader('X-AI-Mode', 'mock')
        await pipeTextStreamToResponse({ response: res, stream })
        return
      }

      const result = streamText({
        model: createOpenAI({ apiKey })('gpt-4o-mini'),
        system,
        messages,
        maxOutputTokens: 700,
      })
      res.setHeader('X-AI-Mode', 'openai')
      await result.pipeTextStreamToResponse(res)
    } catch (error) {
      if (res.headersSent) {
        console.error('AI assistant stream failed', error)
        res.destroy(error instanceof Error ? error : new Error('AI assistant stream failed'))
        return
      }
      return next(error)
    }
  },
)
