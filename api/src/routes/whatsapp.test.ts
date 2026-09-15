import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import express from 'express'
import request from 'supertest'
import { PrismaClient } from '@prisma/client'
import { createApp } from '../app.js'
import { env } from '../env.js'
import { registerWhatsAppRoutes } from './whatsapp.js'
import { registerInternalRoutes } from './internal.js'

const prisma = new PrismaClient()
const TOKEN = 'test-internal-token'

interface FakeShopify {
  addTags: Mock<[string, string[]], Promise<void>>
  appendNote: Mock<[string, string], Promise<void>>
}

function fakeShopify(): FakeShopify {
  return {
    addTags: vi.fn<[string, string[]], Promise<void>>().mockResolvedValue(undefined),
    appendNote: vi.fn<[string, string], Promise<void>>().mockResolvedValue(undefined)
  }
}

function buildInternalApp(shopifyClient: FakeShopify, fetchImpl?: typeof fetch) {
  const app = express()
  app.use(express.json())
  registerWhatsAppRoutes(app, { prisma, workerUrl: 'http://worker.test', fetchImpl })
  registerInternalRoutes(app, { prisma, internalToken: TOKEN, shopifyClient })
  return app
}

describe('whatsapp + internal routes', () => {
  beforeAll(async () => {
    await prisma.messageJob.deleteMany()
    await prisma.message.deleteMany()
    await prisma.order.deleteMany()
    await prisma.settings.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('reports disconnected before any worker update', async () => {
    const res = await request(createApp()).get('/api/whatsapp/status')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('disconnected')
    expect(res.body.qr).toBeNull()
    expect(res.body.number).toBeNull()
  })

  it('rejects internal status updates without the token', async () => {
    const res = await request(buildInternalApp(fakeShopify()))
      .post('/api/internal/whatsapp/status')
      .send({ status: 'ready', number: '+201000000000' })
    expect(res.status).toBe(401)
  })

  it('stores an internal status update that the status route reads back', async () => {
    const write = await request(buildInternalApp(fakeShopify()))
      .post('/api/internal/whatsapp/status')
      .set('x-internal-token', TOKEN)
      .send({ status: 'qr', qr: 'QRDATA' })
    expect(write.status).toBe(200)
    expect(write.body.ok).toBe(true)

    const res = await request(createApp()).get('/api/whatsapp/status')
    expect(res.body.status).toBe('qr')
    expect(res.body.qr).toBe('QRDATA')
  })

  it('applies a confirmation to Shopify and the order row', async () => {
    const order = await prisma.order.create({
      data: {
        shopifyOrderId: '8880001',
        orderNumber: '#3001',
        customerName: 'Sara',
        phone: '+201000000002',
        total: '50',
        currency: 'EGP',
        financialStatus: 'pending',
        paymentGateway: 'cod',
        status: 'sent'
      }
    })

    const shopify = fakeShopify()

    const res = await request(buildInternalApp(shopify))
      .post('/api/internal/shopify/apply')
      .set('x-internal-token', TOKEN)
      .send({ orderId: order.id, action: 'confirmed' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(shopify.addTags).toHaveBeenCalledWith(order.shopifyOrderId, ['confirmed-by-whatsapp'])
    expect(shopify.appendNote).toHaveBeenCalledWith(
      order.shopifyOrderId,
      expect.stringContaining('confirmed-by-whatsapp')
    )

    const updated = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updated?.status).toBe('confirmed')
    expect(updated?.confirmedAt).not.toBeNull()
  })

  it('applies a cancellation to Shopify and the order row', async () => {
    const order = await prisma.order.create({
      data: {
        shopifyOrderId: '8880002',
        orderNumber: '#3002',
        customerName: 'Ali',
        phone: '+201000000003',
        total: '75',
        currency: 'EGP',
        financialStatus: 'pending',
        paymentGateway: 'cod',
        status: 'sent'
      }
    })

    const shopify = fakeShopify()

    const res = await request(buildInternalApp(shopify))
      .post('/api/internal/shopify/apply')
      .set('x-internal-token', TOKEN)
      .send({ orderId: order.id, action: 'cancelled' })

    expect(res.status).toBe(200)
    expect(shopify.addTags).toHaveBeenCalledWith(order.shopifyOrderId, ['cancelled-by-whatsapp'])

    const updated = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updated?.status).toBe('cancelled')
    expect(updated?.cancelledAt).not.toBeNull()
  })

  it('rejects shopify applies without the token', async () => {
    const res = await request(buildInternalApp(fakeShopify()))
      .post('/api/internal/shopify/apply')
      .send({ orderId: 'nope', action: 'confirmed' })
    expect(res.status).toBe(401)
  })

  it('forwards reconnect to the worker', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch
    const res = await request(buildInternalApp(fakeShopify(), fetchImpl)).post('/api/whatsapp/reconnect')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith('http://worker.test/internal/reconnect', {
      method: 'POST',
      headers: { 'x-internal-token': env.internalToken }
    })
  })

  it('reports a 502 when the worker is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('unreachable')) as unknown as typeof fetch
    const res = await request(buildInternalApp(fakeShopify(), fetchImpl)).post('/api/whatsapp/reconnect')
    expect(res.status).toBe(502)
    expect(res.body.ok).toBe(false)
  })
})
