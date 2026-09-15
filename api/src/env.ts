import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().default('file:./dev.db'),
  USER_SHOPIFY_SHOP_DOMAIN: z.string().default(''),
  USER_SHOPIFY_ADMIN_TOKEN: z.string().default(''),
  USER_SHOPIFY_WEBHOOK_SECRET: z.string().default(''),
  USER_DEFAULT_COUNTRY_CODE: z.string().default('20'),
  USER_API_PORT: z.coerce.number().default(3001),
  USER_WORKER_PORT: z.coerce.number().default(3002),
  USER_INTERNAL_TOKEN: z.string().default('change-me-internal-token'),
  USER_WORKER_URL: z.string().default('http://localhost:3002'),
  USER_PUBLIC_BASE_URL: z.string().default('')
})

const parsed = schema.parse(process.env)

export const env = {
  databaseUrl: parsed.DATABASE_URL,
  shopDomain: parsed.USER_SHOPIFY_SHOP_DOMAIN,
  adminToken: parsed.USER_SHOPIFY_ADMIN_TOKEN,
  webhookSecret: parsed.USER_SHOPIFY_WEBHOOK_SECRET,
  defaultCountryCode: parsed.USER_DEFAULT_COUNTRY_CODE,
  apiPort: parsed.USER_API_PORT,
  workerPort: parsed.USER_WORKER_PORT,
  internalToken: parsed.USER_INTERNAL_TOKEN,
  workerUrl: parsed.USER_WORKER_URL,
  publicBaseUrl: parsed.USER_PUBLIC_BASE_URL
}
