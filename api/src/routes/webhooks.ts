import express from 'express'
import type { Express } from 'express'
import { PrismaClient } from '@prisma/client'
import { isCodOrder, normalizePhone, verifyShopifyHmac } from '@swc/shared'
import { prisma as defaultPrisma } from '../db.js'
import { env } from '../env.js'

interface Deps {
  prisma?: PrismaClient
  webhookSecret?: string
  defaultCountryCode?: string
}

export function registerWebhookRoutes(app: Express, deps: Deps = {}): void {
  const prisma = deps.prisma ?? defaultPrisma
  const secret = deps.webhookSecret ?? env.webhookSecret
  const countryCode = deps.defaultCountryCode ?? env.defaultCountryCode

  app.post('/webhooks/shopify/orders', express.raw({ type: '*/*' }), async (req, res) => {
    try {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ''))
      const hmac = String(req.header('x-shopify-hmac-sha256') ?? '')

      if (!verifyShopifyHmac(rawBody, hmac, secret)) {
        res.status(401).json({ error: 'invalid signature' })
        return
      }

      let body: any
      try {
        body = JSON.parse(rawBody.toString('utf8'))
      } catch {
        res.status(400).json({ error: 'invalid json' })
        return
      }

      const shopifyOrderId = String(body.id ?? '')
      if (!shopifyOrderId) {
        res.status(400).json({ error: 'missing order id' })
        return
      }

      const gateways: string[] = Array.isArray(body.payment_gateway_names) ? body.payment_gateway_names : []
      if (!isCodOrder(gateways)) {
        res.json({ skipped: 'not-cod' })
        return
      }

      const rawPhone = body.phone || body.shipping_address?.phone || body.customer?.phone || ''
      const phone = normalizePhone(String(rawPhone), countryCode)

      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.webhookEvent.findUnique({
          where: { topic_shopifyOrderId: { topic: 'orders/create', shopifyOrderId } }
        })
        if (existing) {
          return { skipped: 'duplicate' as const }
        }

        const order = await tx.order.upsert({
          where: { shopifyOrderId },
          create: {
            shopifyOrderId,
            orderNumber: String(body.name ?? shopifyOrderId),
            customerName: [body.customer?.first_name, body.customer?.last_name].filter(Boolean).join(' ') || 'Customer',
            phone: phone ?? '',
            total: String(body.total_price ?? '0'),
            currency: String(body.currency ?? ''),
            financialStatus: String(body.financial_status ?? ''),
            paymentGateway: gateways.join(', '),
            status: phone ? 'pending' : 'failed'
          },
          update: {}
        })

        await tx.webhookEvent.create({
          data: { topic: 'orders/create', shopifyOrderId }
        })

        if (phone) {
          await tx.messageJob.create({
            data: { orderId: order.id, type: 'confirmation', status: 'pending' }
          })
        }

        return { orderId: order.id }
      })

      if ('skipped' in result) {
        res.json({ skipped: result.skipped })
        return
      }

      res.json({ ok: true, orderId: result.orderId })
    } catch (error) {
      console.error(error)
      res.status(500).json({ error: 'internal' })
    }
  })
}
