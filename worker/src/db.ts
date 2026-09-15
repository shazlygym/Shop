import { PrismaClient } from '@prisma/client'
import { env } from './env.js'

process.env.DATABASE_URL ??= env.databaseUrl

export const prisma = new PrismaClient()
