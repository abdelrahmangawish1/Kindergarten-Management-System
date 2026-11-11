import 'dotenv/config'

const nodeEnv = process.env.NODE_ENV ?? 'development'
const jwtSecret = process.env.JWT_SECRET ?? 'local-only-development-secret-change-me'

if (nodeEnv === 'production' && (!process.env.JWT_SECRET || jwtSecret.length < 32)) {
  throw new Error('JWT_SECRET must be configured with at least 32 characters in production')
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv,
  jwtSecret,
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  openAiApiKey: process.env.OPENAI_API_KEY,
}
