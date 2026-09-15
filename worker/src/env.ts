import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().default('file:./dev.db'),
  USER_WHATSAPP_SESSION_PATH: z.string().default('./.wa-session'),
  USER_API_PORT: z.coerce.number().default(3001),
  USER_WORKER_PORT: z.coerce.number().default(3002),
  USER_INTERNAL_TOKEN: z.string().default('change-me-internal-token'),
  USER_DEFAULT_COUNTRY_CODE: z.string().default('20')
})

const parsed = schema.parse(process.env)

export const env = {
  databaseUrl: parsed.DATABASE_URL,
  sessionPath: parsed.USER_WHATSAPP_SESSION_PATH,
  workerPort: parsed.USER_WORKER_PORT,
  apiUrl: `http://localhost:${parsed.USER_API_PORT}`,
  internalToken: parsed.USER_INTERNAL_TOKEN,
  defaultCountryCode: parsed.USER_DEFAULT_COUNTRY_CODE
}
