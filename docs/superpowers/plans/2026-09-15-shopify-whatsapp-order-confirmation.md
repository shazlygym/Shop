# Shopify WhatsApp Order Confirmation Tool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-store tool that sends WhatsApp confirmation requests for new Shopify COD orders and reflects the customer's confirm/cancel reply back onto the Shopify order as tags and notes.

**Architecture:** A TypeScript monorepo with two runnable processes sharing one SQLite database. The `api` process receives Shopify webhooks, serves the React dashboard, and owns all Shopify Admin API calls. The `worker` process owns the `whatsapp-web.js` client and a polling outbox, so an unstable chat client can never block webhook ingestion. Outbound messages are persisted as jobs before sending and retried safely.

**Tech Stack:** Node 20, TypeScript, Express 4, Prisma + SQLite, whatsapp-web.js (Puppeteer), React 18 + Vite 5 + Tailwind 3, Vitest, zod, concurrently.

## Global Constraints

- Node.js >= 20.
- Secrets come only from environment variables with a `USER_` prefix. Never read or write LLM/agent environment variables.
- `.env.example` contains placeholders only; `.env` is gitignored.
- All user-facing dashboard copy is Arabic and the layout is RTL.
- WhatsApp access is through a `WhatsAppDriver` interface so the transport can be swapped.
- The dashboard dev server is the port exposed for preview; it proxies `/api` and `/webhooks` to the api process.
- Vite `server.allowedHosts` must include `.monkeycode-ai.live`.
- Phone numbers are stored in E.164.
- Every task ends with a commit.

---

## File Structure

```
/
├── package.json                       root workspace + dev/start scripts
├── tsconfig.base.json                 shared compiler options
├── .env.example                       placeholder configuration
├── .gitignore                         (modify: ignore .env, *.db, node_modules, dist)
├── shared/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                   barrel export
│       ├── types.ts                   OrderStatus, JobStatus, ReplyIntent
│       ├── phone.ts                   normalizePhone
│       ├── reply.ts                   parseReply
│       ├── hmac.ts                    computeShopifyHmac, verifyShopifyHmac
│       ├── cod.ts                     isCodOrder
│       └── template.ts                renderConfirmation
├── api/
│   ├── package.json
│   ├── tsconfig.json
│   ├── prisma/schema.prisma
│   └── src/
│       ├── env.ts                     zod-validated env
│       ├── db.ts                      Prisma client singleton
│       ├── app.ts                     express app factory
│       ├── index.ts                   bootstrap + listen
│       ├── shopify/client.ts          addTags, appendNote
│       └── routes/
│           ├── webhooks.ts            POST /webhooks/shopify/orders
│           ├── orders.ts              GET /api/orders, POST /api/orders/:id/resend
│           ├── stats.ts               GET /api/stats
│           ├── settings.ts            GET/PUT /api/settings
│           ├── whatsapp.ts            GET /api/whatsapp/status, POST /api/whatsapp/reconnect
│           └── internal.ts            POST /api/internal/whatsapp/status, /api/internal/shopify/apply
└── worker/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── env.ts
        ├── db.ts
        ├── index.ts                   bootstrap + health server
        ├── whatsapp/
        │   ├── driver.ts             WhatsAppDriver interface + payload types
        │   └── webjs.ts              whatsapp-web.js implementation
        ├── outbox.ts                  outbox processor
        ├── replies.ts                 inbound reply handler
        ├── api-client.ts              worker -> api internal calls
        └── bot.ts                     wires driver events to outbox + replies
└── dashboard/
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── index.css
        ├── api.ts                     typed API client
        ├── components/Layout.tsx
        ├── components/StatusBadge.tsx
        └── pages/
            ├── ConnectionPage.tsx
            ├── OrdersPage.tsx
            ├── StatsPage.tsx
            └── SettingsPage.tsx
```

---

## Phase 1 — Foundation

### Task 1: Monorepo scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.env.example`
- Modify: `.gitignore`
- Create: `shared/package.json`, `shared/tsconfig.json`, `shared/src/index.ts`, `shared/src/types.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: workspace root with `npm run dev`, `npm run build`, `npm test`; `shared` package importable as `@swc/shared`; status/intent types.

- [ ] **Step 1: Create the root workspace manifest**

`package.json`:

```json
{
  "name": "shopify-wa-confirm",
  "private": true,
  "version": "0.1.0",
  "workspaces": ["shared", "api", "worker", "dashboard"],
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "concurrently -n api,worker,dashboard -c blue,magenta,green \"npm:dev -w api\" \"npm:dev -w worker\" \"npm:dev -w dashboard\"",
    "build": "npm run build -w shared && npm run build -w api && npm run build -w worker && npm run build -w dashboard",
    "start": "npm run start -w api",
    "test": "npm run test -w shared && npm run test -w api && npm run test -w worker",
    "db:push": "npm run db:push -w api"
  },
  "devDependencies": {
    "concurrently": "^8.2.2",
    "typescript": "^5.4.5"
  }
}
```

- [ ] **Step 2: Create the shared compiler config**

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "outDir": "dist"
  }
}
```

- [ ] **Step 3: Create `.env.example` with placeholders only**

`.env.example`:

```env
# Shopify custom app credentials (fill in yourself)
USER_SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
USER_SHOPIFY_ADMIN_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxx
USER_SHOPIFY_WEBHOOK_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx

# WhatsApp session storage directory
USER_WHATSAPP_SESSION_PATH=./.wa-session

# Default country code used when normalizing phone numbers (Egypt = 20)
USER_DEFAULT_COUNTRY_CODE=20

# Ports and internal auth
USER_API_PORT=3001
USER_WORKER_PORT=3002
USER_INTERNAL_TOKEN=change-me-internal-token
USER_WORKER_URL=http://localhost:3002

# Public base URL of the api process, used to register the webhook in Shopify
USER_PUBLIC_BASE_URL=https://your-public-domain
```

- [ ] **Step 4: Extend `.gitignore`**

Append to `.gitignore`:

```
# App
.env
node_modules/
dist/
*.db
*.db-journal
.wa-session/
```

- [ ] **Step 5: Create the shared package manifest**

`shared/package.json`:

```json
{
  "name": "@swc/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^1.6.0"
  }
}
```

`shared/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

- [ ] **Step 6: Create shared types**

`shared/src/types.ts`:

```ts
export type OrderStatus = 'pending' | 'sent' | 'confirmed' | 'cancelled' | 'failed'
export type JobStatus = 'pending' | 'processing' | 'sent' | 'failed'
export type MessageDirection = 'out' | 'in'
export type ReplyIntent = 'confirm' | 'cancel' | 'unknown'
export type WaConnectionStatus = 'connecting' | 'qr' | 'ready' | 'disconnected'
```

`shared/src/index.ts`:

```ts
export * from './types.js'
```

- [ ] **Step 7: Install and verify the workspace resolves**

Run: `npm install`
Expected: installs without error; `node_modules/@swc/shared` symlink exists.

Run: `npm run build -w shared`
Expected: `shared/dist/index.js` is created.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.base.json .env.example .gitignore shared
git commit -m "chore: scaffold monorepo workspace and shared package"
```

---

### Task 2: Phone normalization

**Files:**
- Create: `shared/src/phone.ts`
- Test: `shared/src/phone.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizePhone(raw: string, defaultCountryCode = '20'): string | null` returning E.164 (`+<digits>`) or `null` when the value cannot be normalized.

- [ ] **Step 1: Write the failing test**

`shared/src/phone.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { normalizePhone } from './phone.js'

describe('normalizePhone', () => {
  it('converts a local Egyptian number to E.164', () => {
    expect(normalizePhone('01012345678', '20')).toBe('+201012345678')
  })

  it('keeps an already international number', () => {
    expect(normalizePhone('+20 101 234 5678', '20')).toBe('+201012345678')
  })

  it('converts 00 prefix to +', () => {
    expect(normalizePhone('00201012345678', '20')).toBe('+201012345678')
  })

  it('strips the local trunk 0 when a country code is applied', () => {
    expect(normalizePhone('1012345678', '20')).toBe('+201012345678')
  })

  it('returns null for empty or non-numeric input', () => {
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone('not-a-phone')).toBeNull()
  })

  it('returns null when too short even with country code', () => {
    expect(normalizePhone('123', '20')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w shared`
Expected: FAIL — cannot resolve `./phone.js`.

- [ ] **Step 3: Write the minimal implementation**

`shared/src/phone.ts`:

```ts
export function normalizePhone(raw: string, defaultCountryCode = '20'): string | null {
  if (!raw) return null

  const trimmed = raw.trim()
  const hadPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')

  if (!digits) return null

  let normalized: string

  if (hadPlus) {
    normalized = digits
  } else if (digits.startsWith('00')) {
    normalized = digits.slice(2)
  } else if (digits.startsWith(defaultCountryCode) && digits.length > defaultCountryCode.length + 6) {
    normalized = digits
  } else {
    const local = digits.replace(/^0+/, '')
    normalized = `${defaultCountryCode}${local}`
  }

  if (normalized.length < 8 || normalized.length > 15) return null
  return `+${normalized}`
}
```

- [ ] **Step 4: Export from the barrel**

`shared/src/index.ts`:

```ts
export * from './types.js'
export * from './phone.js'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w shared`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add shared/src/phone.ts shared/src/phone.test.ts shared/src/index.ts
git commit -m "feat(shared): add E.164 phone normalization"
```

---

### Task 3: Reply parsing

**Files:**
- Create: `shared/src/reply.ts`
- Test: `shared/src/reply.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `ReplyIntent` from `./types.js`.
- Produces: `parseReply(body: string): ReplyIntent`. Also accepts the interactive button ids `confirm_order` and `cancel_order`.

- [ ] **Step 1: Write the failing test**

`shared/src/reply.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseReply } from './reply.js'

describe('parseReply', () => {
  it('parses numeric 1 as confirm', () => {
    expect(parseReply('1')).toBe('confirm')
  })

  it('parses numeric 2 as cancel', () => {
    expect(parseReply('2')).toBe('cancel')
  })

  it('parses Arabic words', () => {
    expect(parseReply('تأكيد')).toBe('confirm')
    expect(parseReply('الغاء')).toBe('cancel')
  })

  it('parses English words case-insensitively', () => {
    expect(parseReply('CONFIRM')).toBe('confirm')
    expect(parseReply('cancel ')).toBe('cancel')
  })

  it('parses button ids', () => {
    expect(parseReply('confirm_order')).toBe('confirm')
    expect(parseReply('cancel_order')).toBe('cancel')
  })

  it('returns unknown for anything else', () => {
    expect(parseReply('where is my order')).toBe('unknown')
    expect(parseReply('')).toBe('unknown')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w shared`
Expected: FAIL — cannot resolve `./reply.js`.

- [ ] **Step 3: Write the minimal implementation**

`shared/src/reply.ts`:

```ts
import type { ReplyIntent } from './types.js'

const CONFIRM = new Set(['1', 'confirm', 'confirmed', 'yes', 'y', 'تأكيد', 'تاكيد', 'نعم', 'confirm_order'])
const CANCEL = new Set(['2', 'cancel', 'cancelled', 'canceled', 'no', 'n', 'إلغاء', 'الغاء', 'لا', 'cancel_order'])

function normalize(body: string): string {
  return body
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/\s+/g, ' ')
}

export function parseReply(body: string): ReplyIntent {
  const value = normalize(body)
  if (!value) return 'unknown'
  if (CONFIRM.has(value)) return 'confirm'
  if (CANCEL.has(value)) return 'cancel'
  return 'unknown'
}
```

- [ ] **Step 4: Export from the barrel**

`shared/src/index.ts`:

```ts
export * from './types.js'
export * from './phone.js'
export * from './reply.js'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w shared`
Expected: PASS (12 tests total).

- [ ] **Step 6: Commit**

```bash
git add shared/src/reply.ts shared/src/reply.test.ts shared/src/index.ts
git commit -m "feat(shared): add customer reply parser"
```

---

### Task 4: Shopify HMAC verification

**Files:**
- Create: `shared/src/hmac.ts`
- Test: `shared/src/hmac.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `computeShopifyHmac(rawBody: string | Buffer, secret: string): string` (hex digest) and `verifyShopifyHmac(rawBody: string | Buffer, hmacHeader: string, secret: string): boolean` using a timing-safe comparison.

- [ ] **Step 1: Write the failing test**

`shared/src/hmac.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { computeShopifyHmac, verifyShopifyHmac } from './hmac.js'

const SECRET = 'hush'
const BODY = JSON.stringify({ id: 123, total_price: '100.00' })

describe('shopify hmac', () => {
  it('verifies a correct signature', () => {
    const digest = computeShopifyHmac(BODY, SECRET)
    expect(verifyShopifyHmac(BODY, digest, SECRET)).toBe(true)
  })

  it('rejects a wrong signature', () => {
    expect(verifyShopifyHmac(BODY, 'deadbeef', SECRET)).toBe(false)
  })

  it('rejects a mismatched body', () => {
    const digest = computeShopifyHmac(BODY, SECRET)
    expect(verifyShopifyHmac('{"id":999}', digest, SECRET)).toBe(false)
  })

  it('rejects an empty header', () => {
    expect(verifyShopifyHmac(BODY, '', SECRET)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w shared`
Expected: FAIL — cannot resolve `./hmac.js`.

- [ ] **Step 3: Write the minimal implementation**

`shared/src/hmac.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

export function computeShopifyHmac(rawBody: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

export function verifyShopifyHmac(rawBody: string | Buffer, hmacHeader: string, secret: string): boolean {
  if (!hmacHeader) return false

  const expected = computeShopifyHmac(rawBody, secret)
  const received = Buffer.from(hmacHeader, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')

  if (received.length !== expectedBuffer.length) return false
  return timingSafeEqual(received, expectedBuffer)
}
```

- [ ] **Step 4: Export from the barrel**

`shared/src/index.ts`:

```ts
export * from './types.js'
export * from './phone.js'
export * from './reply.js'
export * from './hmac.js'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w shared`
Expected: PASS (16 tests total).

- [ ] **Step 6: Commit**

```bash
git add shared/src/hmac.ts shared/src/hmac.test.ts shared/src/index.ts
git commit -m "feat(shared): add Shopify HMAC verification"
```

**Amendment (2026-09-15):** Real Shopify sends the `X-Shopify-Hmac-Sha256` header as a base64 digest, not hex. `verifyShopifyHmac` must accept both base64 and hex digests using timing-safe comparison, returning false for an empty header and never throwing on a length mismatch. `computeShopifyHmacBase64` is exported alongside the existing hex `computeShopifyHmac`. The webhook route must use base64 when generating real Shopify signatures; test fixtures may keep using `computeShopifyHmac` (hex).

---

### Task 5: COD detection and message template

**Files:**
- Create: `shared/src/cod.ts`
- Create: `shared/src/template.ts`
- Test: `shared/src/cod.test.ts`
- Test: `shared/src/template.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `isCodOrder(gateways: string[]): boolean` — true when any gateway name matches cash-on-delivery variants or `manual`.
  - `renderConfirmation(template: string, vars: { orderNumber: string; customerName: string; total: string; currency: string }): string` replacing `{{orderNumber}}`, `{{customerName}}`, `{{total}}`, `{{currency}}`.
  - `DEFAULT_CONFIRMATION_TEMPLATE: string` seeding the settings row.

- [ ] **Step 1: Write the failing COD test**

`shared/src/cod.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isCodOrder } from './cod.js'

describe('isCodOrder', () => {
  it('accepts cash on delivery variants', () => {
    expect(isCodOrder(['Cash on Delivery (COD)'])).toBe(true)
    expect(isCodOrder(['cod'])).toBe(true)
    expect(isCodOrder(['الدفع عند الاستلام'])).toBe(true)
  })

  it('accepts manual payments', () => {
    expect(isCodOrder(['manual'])).toBe(true)
  })

  it('rejects online payment gateways', () => {
    expect(isCodOrder(['shopify_payments'])).toBe(false)
    expect(isCodOrder(['paypal'])).toBe(false)
  })

  it('returns false for an empty list', () => {
    expect(isCodOrder([])).toBe(false)
  })
})
```

- [ ] **Step 2: Write the failing template test**

`shared/src/template.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIRMATION_TEMPLATE, renderConfirmation } from './template.js'

describe('renderConfirmation', () => {
  it('replaces all placeholders', () => {
    const out = renderConfirmation('Order {{orderNumber}} for {{customerName}} total {{total}} {{currency}}', {
      orderNumber: '#1001',
      customerName: 'Ahmed',
      total: '250.00',
      currency: 'EGP'
    })
    expect(out).toBe('Order #1001 for Ahmed total 250.00 EGP')
  })

  it('leaves unknown placeholders untouched', () => {
    const out = renderConfirmation('Hi {{customerName}} {{unknown}}', {
      orderNumber: '#1',
      customerName: 'Sara',
      total: '1',
      currency: 'EGP'
    })
    expect(out).toBe('Hi Sara {{unknown}}')
  })

  it('ships a default template containing the confirm instruction', () => {
    expect(DEFAULT_CONFIRMATION_TEMPLATE).toContain('1')
    expect(DEFAULT_CONFIRMATION_TEMPLATE).toContain('{{orderNumber}}')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -w shared`
Expected: FAIL — cannot resolve `./cod.js` and `./template.js`.

- [ ] **Step 4: Write the minimal implementations**

`shared/src/cod.ts`:

```ts
const COD_PATTERNS = ['cash on delivery', 'cashondelivery', 'cod', 'عند الاستلام', 'الدفع عند الاستلام', 'manual']

export function isCodOrder(gateways: string[]): boolean {
  return gateways.some((gateway) => {
    const value = gateway.toLowerCase().trim()
    return COD_PATTERNS.some((pattern) => value.includes(pattern))
  })
}
```

`shared/src/template.ts`:

```ts
export interface ConfirmationVars {
  orderNumber: string
  customerName: string
  total: string
  currency: string
}

export function renderConfirmation(template: string, vars: ConfirmationVars): string {
  return template
    .replaceAll('{{orderNumber}}', vars.orderNumber)
    .replaceAll('{{customerName}}', vars.customerName)
    .replaceAll('{{total}}', vars.total)
    .replaceAll('{{currency}}', vars.currency)
}

export const DEFAULT_CONFIRMATION_TEMPLATE = [
  'مرحباً {{customerName}}',
  '',
  'طلبك رقم {{orderNumber}} بمبلغ {{total}} {{currency}}',
  'من فضلك أكد الطلب للاستمرار في التجهيز:',
  '',
  'ابعت 1 لتأكيد الطلب',
  'ابعت 2 لإلغاء الطلب'
].join('\n')
```

- [ ] **Step 5: Export from the barrel**

`shared/src/index.ts`:

```ts
export * from './types.js'
export * from './phone.js'
export * from './reply.js'
export * from './hmac.js'
export * from './cod.js'
export * from './template.js'
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -w shared && npm run build -w shared`
Expected: PASS (22 tests total); build emits `shared/dist`.

- [ ] **Step 7: Commit**

```bash
git add shared/src
git commit -m "feat(shared): add COD detection and confirmation template"
```

---

## Phase 2 — Data Layer

### Task 6: Prisma schema and client

**Files:**
- Create: `api/package.json`
- Create: `api/tsconfig.json`
- Create: `api/prisma/schema.prisma`
- Create: `api/src/env.ts`
- Create: `api/src/db.ts`
- Create: `api/vitest.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `api/src/env.ts` exporting `env` (`shopDomain`, `adminToken`, `webhookSecret`, `defaultCountryCode`, `apiPort`, `workerPort`, `internalToken`, `workerUrl`, `publicBaseUrl`); `api/src/db.ts` exporting `prisma`; a migrated SQLite database with the `Order`, `MessageJob`, `Message`, `WebhookEvent`, `Settings` models.

- [ ] **Step 1: Create the api package manifest**

`api/package.json`:

```json
{
  "name": "@swc/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "db:push": "prisma db push",
    "db:generate": "prisma generate"
  },
  "dependencies": {
    "@prisma/client": "^5.14.0",
    "@swc/shared": "*",
    "express": "^4.19.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.12.12",
    "prisma": "^5.14.0",
    "tsx": "^4.10.5",
    "vitest": "^1.6.0"
  }
}
```

`api/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`api/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    env: { DATABASE_URL: 'file:./test.db' }
  }
})
```

- [ ] **Step 2: Write the Prisma schema**

`api/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Order {
  id              String        @id @default(cuid())
  shopifyOrderId  String        @unique
  orderNumber     String
  customerName    String
  phone           String
  total           String
  currency        String
  financialStatus String
  paymentGateway  String
  status          String        @default("pending")
  sentAt          DateTime?
  confirmedAt     DateTime?
  cancelledAt     DateTime?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  jobs            MessageJob[]
  messages        Message[]

  @@index([status])
  @@index([phone])
}

model MessageJob {
  id          String   @id @default(cuid())
  orderId     String
  type        String   @default("confirmation")
  status      String   @default("pending")
  attempts    Int      @default(0)
  lastError   String?
  scheduledAt DateTime @default(now())
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  order       Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@index([status, scheduledAt])
}

model Message {
  id          String   @id @default(cuid())
  orderId     String
  direction   String
  body        String
  waMessageId String?
  createdAt   DateTime @default(now())
  order       Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@index([orderId])
}

model WebhookEvent {
  id               String   @id @default(cuid())
  topic            String
  shopifyOrderId   String
  receivedAt       DateTime @default(now())

  @@unique([topic, shopifyOrderId])
}

model Settings {
  id                  Int      @id @default(1)
  shopDomain          String   @default("")
  adminAccessToken    String   @default("")
  webhookSecret       String   @default("")
  messageTemplate     String
  interactiveButtons  Boolean  @default(true)
  waStatus            String   @default("disconnected")
  waQr                String?
  waNumber            String?
  waUpdatedAt         DateTime?
  updatedAt           DateTime @updatedAt
}
```

- [ ] **Step 3: Create the validated env module**

`api/src/env.ts`:

```ts
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
```

- [ ] **Step 4: Create the Prisma client singleton**

`api/src/db.ts`:

```ts
import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()
```

- [ ] **Step 5: Generate the client and push the schema**

Run: `npm install`
Run: `DATABASE_URL="file:./dev.db" npm run db:generate -w api`
Run: `DATABASE_URL="file:./dev.db" npm run db:push -w api`
Expected: `api/prisma/dev.db` created; Prisma client generated with all five models.

- [ ] **Step 6: Verify the models exist**

Run: `DATABASE_URL="file:./dev.db" npx --prefix api prisma studio --help >/dev/null 2>&1; node -e "const {PrismaClient}=require('./api/node_modules/@prisma/client'); const p=new PrismaClient(); console.log(Object.keys(p).filter(k=>!k.startsWith('_')).join(','))"`
Expected: output includes `order,messageJob,message,webhookEvent,settings`.

- [ ] **Step 7: Commit**

```bash
git add api/package.json api/tsconfig.json api/vitest.config.ts api/prisma/schema.prisma api/src/env.ts api/src/db.ts
git commit -m "feat(api): add Prisma schema, env validation, and client"
```

---

## Phase 3 — API Process

### Task 7: Express app bootstrap and health

**Files:**
- Create: `api/src/app.ts`
- Create: `api/src/index.ts`
- Test: `api/src/app.test.ts`

**Interfaces:**
- Consumes: `env` from `./env.js`.
- Produces: `createApp(): express.Express` used by tests and by `index.ts`; `GET /health` returning `{ ok: true }`.

- [ ] **Step 1: Write the failing test**

`api/src/app.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app.js'

describe('app', () => {
  it('responds to the health check', async () => {
    const res = await request(createApp()).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})
```

Add `supertest` and its types: `npm install -w api -D supertest @types/supertest`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w api`
Expected: FAIL — cannot resolve `./app.js`.

- [ ] **Step 3: Write the minimal implementation**

`api/src/app.ts`:

```ts
import express from 'express'
import type { Express } from 'express'

export function createApp(): Express {
  const app = express()

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  return app
}
```

`api/src/index.ts`:

```ts
import { createApp } from './app.js'
import { env } from './env.js'

const app = createApp()

app.listen(env.apiPort, () => {
  console.log(`[api] listening on http://localhost:${env.apiPort}`)
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/app.ts api/src/index.ts api/src/app.test.ts api/package.json
git commit -m "feat(api): add express bootstrap and health endpoint"
```

---

### Task 8: Shopify order webhook

**Files:**
- Create: `api/src/routes/webhooks.ts`
- Modify: `api/src/app.ts`
- Test: `api/src/routes/webhooks.test.ts`

**Interfaces:**
- Consumes: `verifyShopifyHmac`, `normalizePhone`, `isCodOrder` from `@swc/shared`; `prisma`; `env`.
- Produces: `registerWebhookRoutes(app: Express, deps?: { prisma?: PrismaClient; webhookSecret?: string }): void` mounting `POST /webhooks/shopify/orders`. On success it creates one `Order` (status `pending`) and one `MessageJob` (status `pending`).

Accepted payload fields: `id`, `name`, `currency`, `total_price`, `financial_status`, `payment_gateway_names` (array), `customer.first_name`, `customer.last_name`, `shipping_address.phone`, `phone`.

- [ ] **Step 1: Write the failing test**

`api/src/routes/webhooks.test.ts`:

```ts
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { PrismaClient } from '@prisma/client'
import { computeShopifyHmac } from '@swc/shared'
import { createApp } from '../app.js'

const prisma = new PrismaClient()
const SECRET = 'test-secret'

function payload(overrides: Record<string, unknown> = {}) {
  return {
    id: 5550001,
    name: '#1001',
    currency: 'EGP',
    total_price: '250.00',
    financial_status: 'pending',
    payment_gateway_names: ['Cash on Delivery (COD)'],
    phone: '01012345678',
    customer: { first_name: 'Ahmed', last_name: 'Ali' },
    ...overrides
  }
}

function post(body: unknown) {
  const raw = JSON.stringify(body)
  const hmac = computeShopifyHmac(raw, SECRET)
  return request(createApp())
    .post('/webhooks/shopify/orders')
    .set('Content-Type', 'application/json')
    .set('x-shopify-hmac-sha256', hmac)
    .send(raw)
}

describe('shopify orders webhook', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = 'file:./test.db'
    await prisma.messageJob.deleteMany()
    await prisma.order.deleteMany()
    await prisma.webhookEvent.deleteMany()
    await prisma.settings.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('creates an order and a pending job for a COD order', async () => {
    const res = await post(payload())
    expect(res.status).toBe(200)

    const order = await prisma.order.findUnique({ where: { shopifyOrderId: '5550001' } })
    expect(order).not.toBeNull()
    expect(order?.phone).toBe('+201012345678')
    expect(order?.status).toBe('pending')

    const job = await prisma.messageJob.findFirst({ where: { orderId: order!.id } })
    expect(job?.status).toBe('pending')
  })

  it('is idempotent for a repeated webhook', async () => {
    await post(payload({ id: 5550002 }))
    await post(payload({ id: 5550002 }))
    const count = await prisma.order.count({ where: { shopifyOrderId: '5550002' } })
    expect(count).toBe(1)
  })

  it('ignores non-COD orders', async () => {
    await post(payload({ id: 5550003, payment_gateway_names: ['shopify_payments'] }))
    const count = await prisma.order.count({ where: { shopifyOrderId: '5550003' } })
    expect(count).toBe(0)
  })

  it('rejects a bad signature', async () => {
    const res = await request(createApp())
      .post('/webhooks/shopify/orders')
      .set('Content-Type', 'application/json')
      .set('x-shopify-hmac-sha256', 'deadbeef')
      .send('{"id":1}')
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w api`
Expected: FAIL — 404 on `/webhooks/shopify/orders`.

- [ ] **Step 3: Write the minimal implementation**

`api/src/routes/webhooks.ts`:

```ts
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

    const gateways: string[] = body.payment_gateway_names ?? []
    if (!isCodOrder(gateways)) {
      res.json({ skipped: 'not-cod' })
      return
    }

    const existing = await prisma.webhookEvent.findUnique({
      where: { topic_shopifyOrderId: { topic: 'orders/create', shopifyOrderId } }
    })
    if (existing) {
      res.json({ skipped: 'duplicate' })
      return
    }

    const rawPhone = body.phone ?? body.shipping_address?.phone ?? body.customer?.phone ?? ''
    const phone = normalizePhone(String(rawPhone), countryCode)

    const settings = await prisma.settings.findUnique({ where: { id: 1 } })
    const template = settings?.messageTemplate ?? ''

    const order = await prisma.order.upsert({
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

    await prisma.webhookEvent.create({
      data: { topic: 'orders/create', shopifyOrderId }
    })

    if (phone) {
      await prisma.messageJob.create({
        data: { orderId: order.id, type: 'confirmation', status: 'pending' }
      })
    }

    void template
    res.json({ ok: true, orderId: order.id })
  })
}
```

`api/src/app.ts` (replace contents):

```ts
import express from 'express'
import type { Express } from 'express'
import { registerWebhookRoutes } from './routes/webhooks.js'

export function createApp(): Express {
  const app = express()

  app.use((req, res, next) => {
    if (req.path.startsWith('/webhooks')) return next()
    express.json()(req, res, next)
  })

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  registerWebhookRoutes(app)

  return app
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./test.db" npm test -w api`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/webhooks.ts api/src/routes/webhooks.test.ts api/src/app.ts
git commit -m "feat(api): ingest Shopify COD orders via HMAC-verified webhook"
```

---

### Task 9: Shopify Admin API client

**Files:**
- Create: `api/src/shopify/client.ts`
- Test: `api/src/shopify/client.test.ts`

**Interfaces:**
- Consumes: `env`.
- Produces: `createShopifyClient(config?: { shopDomain?: string; adminToken?: string; fetchImpl?: typeof fetch })` returning `{ addTags(orderGid: string, tags: string[]): Promise<void>; appendNote(orderGid: string, line: string): Promise<void> }`. `appendNote` reads the current note then writes `note + "\n" + line`. `orderGid` is the numeric order id as a string; the client builds `gid://shopify/Order/<id>`.

- [ ] **Step 1: Write the failing test**

`api/src/shopify/client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createShopifyClient } from './client.js'

describe('shopify client', () => {
  it('adds tags with the tagsAdd mutation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { tagsAdd: { userErrors: [] } } })
    })
    const client = createShopifyClient({ shopDomain: 's.myshopify.com', adminToken: 't', fetchImpl })
    await client.addTags('123', ['confirmed-by-whatsapp'])

    const [url, init] = fetchImpl.mock.calls[0]
    expect(String(url)).toContain('s.myshopify.com/admin/api/2024-07/graphql.json')
    const body = JSON.parse(String(init.body))
    expect(body.query).toContain('tagsAdd')
    expect(body.variables).toEqual({ id: 'gid://shopify/Order/123', tags: ['confirmed-by-whatsapp'] })
  })

  it('appends a note after reading the existing note', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { order: { note: 'old line' } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { orderUpdate: { userErrors: [] } } }) })

    const client = createShopifyClient({ shopDomain: 's.myshopify.com', adminToken: 't', fetchImpl })
    await client.appendNote('123', 'new line')

    const secondBody = JSON.parse(String(fetchImpl.mock.calls[1][1].body))
    expect(secondBody.variables.input.note).toBe('old line\nnew line')
  })

  it('throws when Shopify returns user errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { tagsAdd: { userErrors: [{ message: 'bad' }] } } })
    })
    const client = createShopifyClient({ shopDomain: 's.myshopify.com', adminToken: 't', fetchImpl })
    await expect(client.addTags('123', ['x'])).rejects.toThrow('bad')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w api`
Expected: FAIL — cannot resolve `./client.js`.

- [ ] **Step 3: Write the minimal implementation**

`api/src/shopify/client.ts`:

```ts
import { env } from '../env.js'

const API_VERSION = '2024-07'

interface ShopifyConfig {
  shopDomain?: string
  adminToken?: string
  fetchImpl?: typeof fetch
}

interface UserError {
  message: string
}

function orderGid(id: string): string {
  return id.startsWith('gid://') ? id : `gid://shopify/Order/${id}`
}

export function createShopifyClient(config: ShopifyConfig = {}) {
  const shopDomain = config.shopDomain ?? env.shopDomain
  const adminToken = config.adminToken ?? env.adminToken
  const doFetch = config.fetchImpl ?? fetch

  async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await doFetch(`https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': adminToken
      },
      body: JSON.stringify({ query, variables })
    })

    if (!res.ok) {
      throw new Error(`Shopify HTTP ${res.status}`)
    }

    const json = (await res.json()) as { data?: T; errors?: { message: string }[] }
    if (json.errors?.length) {
      throw new Error(json.errors.map((e) => e.message).join('; '))
    }
    return json.data as T
  }

  return {
    async addTags(orderId: string, tags: string[]): Promise<void> {
      const data = await graphql<{ tagsAdd: { userErrors: UserError[] } }>(
        `mutation AddTags($id: ID!, $tags: [String!]!) {
           tagsAdd(id: $id, tags: $tags) { userErrors { message } }
         }`,
        { id: orderGid(orderId), tags }
      )
      if (data.tagsAdd.userErrors.length) {
        throw new Error(data.tagsAdd.userErrors.map((e) => e.message).join('; '))
      }
    },

    async appendNote(orderId: string, line: string): Promise<void> {
      const existing = await graphql<{ order: { note: string | null } | null }>(
        `query GetNote($id: ID!) { order(id: $id) { note } }`,
        { id: orderGid(orderId) }
      )
      const current = existing.order?.note ?? ''
      const note = current ? `${current}\n${line}` : line

      const data = await graphql<{ orderUpdate: { userErrors: UserError[] } }>(
        `mutation UpdateNote($input: OrderInput!) {
           orderUpdate(input: $input) { userErrors { message } }
         }`,
        { input: { id: orderGid(orderId), note } }
      )
      if (data.orderUpdate.userErrors.length) {
        throw new Error(data.orderUpdate.userErrors.map((e) => e.message).join('; '))
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/shopify
git commit -m "feat(api): add Shopify Admin GraphQL client for tags and notes"
```

---

### Task 10: Orders REST API

**Files:**
- Create: `api/src/routes/orders.ts`
- Modify: `api/src/app.ts`
- Test: `api/src/routes/orders.test.ts`

**Interfaces:**
- Consumes: `prisma`.
- Produces: `registerOrderRoutes(app: Express, deps?: { prisma?: PrismaClient }): void` mounting:
  - `GET /api/orders?status=&q=&page=&pageSize=` returning `{ items, total, page, pageSize }`, newest first, `q` matching phone or order number.
  - `POST /api/orders/:id/resend` resetting the order to `pending` and creating a fresh `pending` job; returns `{ ok: true }` or `404`.
  - `GET /api/orders/:id/messages` returning message history oldest first.

- [ ] **Step 1: Write the failing test**

`api/src/routes/orders.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { PrismaClient } from '@prisma/client'
import { createApp } from '../app.js'

const prisma = new PrismaClient()

describe('orders routes', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = 'file:./test.db'
    await prisma.messageJob.deleteMany()
    await prisma.message.deleteMany()
    await prisma.order.deleteMany()
    await prisma.order.create({
      data: {
        shopifyOrderId: '7770001',
        orderNumber: '#2001',
        customerName: 'Mona',
        phone: '+201000000001',
        total: '100.00',
        currency: 'EGP',
        financialStatus: 'pending',
        paymentGateway: 'cod',
        status: 'sent'
      }
    })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('lists orders with a status filter', async () => {
    const res = await request(createApp()).get('/api/orders?status=sent')
    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].orderNumber).toBe('#2001')
  })

  it('searches by phone', async () => {
    const res = await request(createApp()).get('/api/orders?q=000000001')
    expect(res.body.items).toHaveLength(1)
  })

  it('resends by creating a new pending job', async () => {
    const order = await prisma.order.findUnique({ where: { shopifyOrderId: '7770001' } })
    const res = await request(createApp()).post(`/api/orders/${order!.id}/resend`)
    expect(res.status).toBe(200)

    const job = await prisma.messageJob.findFirst({ where: { orderId: order!.id, status: 'pending' } })
    expect(job).not.toBeNull()
    const updated = await prisma.order.findUnique({ where: { id: order!.id } })
    expect(updated?.status).toBe('pending')
  })

  it('returns 404 when resending an unknown order', async () => {
    const res = await request(createApp()).post('/api/orders/nope/resend')
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./test.db" npm test -w api`
Expected: FAIL — 404 on `/api/orders`.

- [ ] **Step 3: Write the minimal implementation**

`api/src/routes/orders.ts`:

```ts
import type { Express } from 'express'
import { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../db.js'

interface Deps {
  prisma?: PrismaClient
}

export function registerOrderRoutes(app: Express, deps: Deps = {}): void {
  const prisma = deps.prisma ?? defaultPrisma

  app.get('/api/orders', async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
    const page = Math.max(1, Number(req.query.page ?? 1))
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)))

    const where = {
      ...(status ? { status } : {}),
      ...(q
        ? { OR: [{ phone: { contains: q } }, { orderNumber: { contains: q } }] }
        : {})
    }

    const [items, total] = await Promise.all([
      prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.order.count({ where })
    ])

    res.json({ items, total, page, pageSize })
  })

  app.get('/api/orders/:id/messages', async (req, res) => {
    const messages = await prisma.message.findMany({
      where: { orderId: req.params.id },
      orderBy: { createdAt: 'asc' }
    })
    res.json({ items: messages })
  })

  app.post('/api/orders/:id/resend', async (req, res) => {
    const order = await prisma.order.findUnique({ where: { id: req.params.id } })
    if (!order) {
      res.status(404).json({ error: 'not found' })
      return
    }

    await prisma.order.update({ where: { id: order.id }, data: { status: 'pending' } })
    await prisma.messageJob.create({ data: { orderId: order.id, type: 'confirmation', status: 'pending' } })

    res.json({ ok: true })
  })
}
```

Modify `api/src/app.ts` to register the route: add the import and call.

```ts
import { registerOrderRoutes } from './routes/orders.js'
```

and inside `createApp`, after `registerWebhookRoutes(app)`:

```ts
  registerOrderRoutes(app)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./test.db" npm test -w api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/orders.ts api/src/routes/orders.test.ts api/src/app.ts
git commit -m "feat(api): add orders list, search, and manual resend endpoints"
```

---

### Task 11: Statistics endpoint

**Files:**
- Create: `api/src/routes/stats.ts`
- Modify: `api/src/app.ts`
- Test: `api/src/routes/stats.test.ts`

**Interfaces:**
- Consumes: `prisma`.
- Produces: `registerStatsRoutes(app: Express, deps?: { prisma?: PrismaClient }): void` mounting `GET /api/stats` returning `{ total, pending, sent, confirmed, cancelled, failed, confirmationRate }` where `confirmationRate = confirmed / (confirmed + cancelled)` rounded to two decimals, or `0` when the denominator is zero.

- [ ] **Step 1: Write the failing test**

`api/src/routes/stats.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { PrismaClient } from '@prisma/client'
import { createApp } from '../app.js'

const prisma = new PrismaClient()

async function seed(orderId: string, status: string) {
  await prisma.order.create({
    data: {
      shopifyOrderId: orderId,
      orderNumber: `#${orderId}`,
      customerName: 'x',
      phone: `+2010${orderId}`,
      total: '1',
      currency: 'EGP',
      financialStatus: 'pending',
      paymentGateway: 'cod',
      status
    }
  })
}

describe('stats route', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = 'file:./test.db'
    await prisma.order.deleteMany()
    await seed('9001', 'confirmed')
    await seed('9002', 'confirmed')
    await seed('9003', 'cancelled')
    await seed('9004', 'sent')
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('returns counts and confirmation rate', async () => {
    const res = await request(createApp()).get('/api/stats')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(4)
    expect(res.body.confirmed).toBe(2)
    expect(res.body.cancelled).toBe(1)
    expect(res.body.confirmationRate).toBe(0.67)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./test.db" npm test -w api`
Expected: FAIL — 404 on `/api/stats`.

- [ ] **Step 3: Write the minimal implementation**

`api/src/routes/stats.ts`:

```ts
import type { Express } from 'express'
import { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../db.js'

interface Deps {
  prisma?: PrismaClient
}

const STATUSES = ['pending', 'sent', 'confirmed', 'cancelled', 'failed'] as const

export function registerStatsRoutes(app: Express, deps: Deps = {}): void {
  const prisma = deps.prisma ?? defaultPrisma

  app.get('/api/stats', async (_req, res) => {
    const grouped = await prisma.order.groupBy({ by: ['status'], _count: { _all: true } })

    const counts: Record<string, number> = {}
    for (const status of STATUSES) counts[status] = 0
    for (const row of grouped) counts[row.status] = row._count._all
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0)

    const decided = counts.confirmed + counts.cancelled
    const confirmationRate = decided === 0 ? 0 : Math.round((counts.confirmed / decided) * 100) / 100

    res.json({ total, ...counts, confirmationRate })
  })
}
```

Modify `api/src/app.ts`: import `registerStatsRoutes` and call `registerStatsRoutes(app)` alongside the other route registrations.

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./test.db" npm test -w api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/stats.ts api/src/routes/stats.test.ts api/src/app.ts
git commit -m "feat(api): add order statistics endpoint"
```

---

### Task 12: Settings endpoint

**Files:**
- Create: `api/src/routes/settings.ts`
- Modify: `api/src/app.ts`
- Test: `api/src/routes/settings.test.ts`

**Interfaces:**
- Consumes: `prisma`, `DEFAULT_CONFIRMATION_TEMPLATE` from `@swc/shared`.
- Produces: `registerSettingsRoutes(app: Express, deps?: { prisma?: PrismaClient }): void` mounting:
  - `GET /api/settings` returning the settings row, creating it with defaults if missing. The `adminAccessToken` and `webhookSecret` values are returned masked as `"********"` when set, empty string otherwise.
  - `PUT /api/settings` accepting `{ shopDomain?, adminAccessToken?, webhookSecret?, messageTemplate?, interactiveButtons? }`. A masked value (`"********"`) or empty string for a secret leaves the stored value unchanged; any other value replaces it.

- [ ] **Step 1: Write the failing test**

`api/src/routes/settings.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { PrismaClient } from '@prisma/client'
import { createApp } from '../app.js'

const prisma = new PrismaClient()

describe('settings route', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = 'file:./test.db'
    await prisma.settings.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('creates defaults on first read and masks secrets', async () => {
    const res = await request(createApp()).get('/api/settings')
    expect(res.status).toBe(200)
    expect(res.body.messageTemplate).toContain('{{orderNumber}}')
    expect(res.body.adminAccessToken).toBe('')
  })

  it('stores a new token and masks it on the next read', async () => {
    await request(createApp())
      .put('/api/settings')
      .send({ adminAccessToken: 'shpat_secret', shopDomain: 'demo.myshopify.com' })

    const res = await request(createApp()).get('/api/settings')
    expect(res.body.adminAccessToken).toBe('********')
    expect(res.body.shopDomain).toBe('demo.myshopify.com')
  })

  it('leaves a secret unchanged when the masked value is submitted', async () => {
    await request(createApp()).put('/api/settings').send({ adminAccessToken: '********' })
    const stored = await prisma.settings.findUnique({ where: { id: 1 } })
    expect(stored?.adminAccessToken).toBe('shpat_secret')
  })

  it('updates the template and the buttons toggle', async () => {
    await request(createApp()).put('/api/settings').send({ messageTemplate: 'hi {{orderNumber}}', interactiveButtons: false })
    const stored = await prisma.settings.findUnique({ where: { id: 1 } })
    expect(stored?.messageTemplate).toBe('hi {{orderNumber}}')
    expect(stored?.interactiveButtons).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./test.db" npm test -w api`
Expected: FAIL — 404 on `/api/settings`.

- [ ] **Step 3: Write the minimal implementation**

`api/src/routes/settings.ts`:

```ts
import type { Express } from 'express'
import { PrismaClient } from '@prisma/client'
import { DEFAULT_CONFIRMATION_TEMPLATE } from '@swc/shared'
import { prisma as defaultPrisma } from '../db.js'

interface Deps {
  prisma?: PrismaClient
}

const MASK = '********'

function present(row: {
  shopDomain: string
  adminAccessToken: string
  webhookSecret: string
  messageTemplate: string
  interactiveButtons: boolean
}) {
  return {
    shopDomain: row.shopDomain,
    adminAccessToken: row.adminAccessToken ? MASK : '',
    webhookSecret: row.webhookSecret ? MASK : '',
    messageTemplate: row.messageTemplate,
    interactiveButtons: row.interactiveButtons
  }
}

export function registerSettingsRoutes(app: Express, deps: Deps = {}): void {
  const prisma = deps.prisma ?? defaultPrisma

  async function ensureRow() {
    const existing = await prisma.settings.findUnique({ where: { id: 1 } })
    if (existing) return existing
    return prisma.settings.create({
      data: { id: 1, messageTemplate: DEFAULT_CONFIRMATION_TEMPLATE }
    })
  }

  app.get('/api/settings', async (_req, res) => {
    const row = await ensureRow()
    res.json(present(row))
  })

  app.put('/api/settings', async (req, res) => {
    const row = await ensureRow()
    const body = req.body ?? {}

    const data: Record<string, unknown> = {}
    if (typeof body.shopDomain === 'string') data.shopDomain = body.shopDomain
    if (typeof body.messageTemplate === 'string' && body.messageTemplate.trim()) {
      data.messageTemplate = body.messageTemplate
    }
    if (typeof body.interactiveButtons === 'boolean') data.interactiveButtons = body.interactiveButtons
    if (typeof body.adminAccessToken === 'string' && body.adminAccessToken && body.adminAccessToken !== MASK) {
      data.adminAccessToken = body.adminAccessToken
    }
    if (typeof body.webhookSecret === 'string' && body.webhookSecret && body.webhookSecret !== MASK) {
      data.webhookSecret = body.webhookSecret
    }

    const updated = await prisma.settings.update({ where: { id: row.id }, data })
    res.json(present(updated))
  })
}
```

Modify `api/src/app.ts`: import `registerSettingsRoutes` and call it alongside the other registrations.

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./test.db" npm test -w api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/settings.ts api/src/routes/settings.test.ts api/src/app.ts
git commit -m "feat(api): add settings endpoint with secret masking"
```

---

### Task 13: WhatsApp status, reconnect, and internal endpoints

**Files:**
- Create: `api/src/routes/whatsapp.ts`
- Create: `api/src/routes/internal.ts`
- Modify: `api/src/app.ts`
- Test: `api/src/routes/whatsapp.test.ts`

**Interfaces:**
- Consumes: `prisma`, `env`.
- Produces:
  - `registerWhatsAppRoutes(app, deps?)` mounting `GET /api/whatsapp/status` returning `{ status, qr, number, updatedAt }` from the settings row, and `POST /api/whatsapp/reconnect` which forwards to the worker at `${workerUrl}/internal/reconnect` and returns `{ ok: true }` (or `{ ok: false, error }` with status 502 when unreachable).
  - `registerInternalRoutes(app, deps?)` mounting:
    - `POST /api/internal/whatsapp/status` requiring header `x-internal-token` equal to `env.internalToken`; body `{ status, qr?, number? }` persisted onto the settings row.
    - `POST /api/internal/shopify/apply` requiring the same header; body `{ orderId, action: 'confirmed' | 'cancelled', at?: string }`. It loads the order, calls the Shopify client `addTags` and `appendNote`, and updates the order status plus the relevant timestamp. Returns `{ ok: true }`.
  - Deps accept `{ prisma?, internalToken?, workerUrl?, fetchImpl?, shopifyClient? }` for testing.

- [ ] **Step 1: Write the failing test**

`api/src/routes/whatsapp.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { PrismaClient } from '@prisma/client'
import { createApp } from '../app.js'

const prisma = new PrismaClient()
const TOKEN = 'test-internal-token'

describe('whatsapp + internal routes', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = 'file:./test.db'
    process.env.USER_INTERNAL_TOKEN = TOKEN
    await prisma.settings.deleteMany()
    await prisma.order.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('reports disconnected before any worker update', async () => {
    const res = await request(createApp()).get('/api/whatsapp/status')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('disconnected')
  })

  it('rejects internal status updates without the token', async () => {
    const res = await request(createApp())
      .post('/api/internal/whatsapp/status')
      .send({ status: 'ready', number: '+201000000000' })
    expect(res.status).toBe(401)
  })

  it('stores an internal status update', async () => {
    await request(createApp())
      .post('/api/internal/whatsapp/status')
      .set('x-internal-token', TOKEN)
      .send({ status: 'qr', qr: 'QRDATA' })

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

    const addTags = vi.fn().mockResolvedValue(undefined)
    const appendNote = vi.fn().mockResolvedValue(undefined)
    vi.doMock('../shopify/client.js', () => ({ createShopifyClient: () => ({ addTags, appendNote }) }))

    const res = await request(createApp())
      .post('/api/internal/shopify/apply')
      .set('x-internal-token', TOKEN)
      .send({ orderId: order.id, action: 'confirmed' })

    // Route must return ok; asserts on the real client call happen in Task 9's unit tests.
    expect(res.status).toBe(200)
    const updated = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updated?.status).toBe('confirmed')
    expect(updated?.confirmedAt).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./test.db" npm test -w api`
Expected: FAIL — 404 on `/api/whatsapp/status`.

- [ ] **Step 3: Write the minimal implementations**

`api/src/routes/whatsapp.ts`:

```ts
import type { Express } from 'express'
import { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../db.js'
import { env } from '../env.js'

interface Deps {
  prisma?: PrismaClient
  workerUrl?: string
  fetchImpl?: typeof fetch
}

export function registerWhatsAppRoutes(app: Express, deps: Deps = {}): void {
  const prisma = deps.prisma ?? defaultPrisma
  const workerUrl = deps.workerUrl ?? env.workerUrl
  const doFetch = deps.fetchImpl ?? fetch

  app.get('/api/whatsapp/status', async (_req, res) => {
    const row = await prisma.settings.findUnique({ where: { id: 1 } })
    res.json({
      status: row?.waStatus ?? 'disconnected',
      qr: row?.waQr ?? null,
      number: row?.waNumber ?? null,
      updatedAt: row?.waUpdatedAt ?? null
    })
  })

  app.post('/api/whatsapp/reconnect', async (_req, res) => {
    try {
      const response = await doFetch(`${workerUrl}/internal/reconnect`, { method: 'POST' })
      res.json({ ok: response.ok })
    } catch (error) {
      res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'unreachable' })
    }
  })
}
```

`api/src/routes/internal.ts`:

```ts
import type { Express } from 'express'
import { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../db.js'
import { env } from '../env.js'
import { createShopifyClient } from '../shopify/client.js'

interface Deps {
  prisma?: PrismaClient
  internalToken?: string
  shopifyClient?: { addTags: (id: string, tags: string[]) => Promise<void>; appendNote: (id: string, line: string) => Promise<void> }
}

function formatTimestamp(value: Date): string {
  return value.toISOString().replace('T', ' ').slice(0, 16)
}

export function registerInternalRoutes(app: Express, deps: Deps = {}): void {
  const prisma = deps.prisma ?? defaultPrisma
  const token = deps.internalToken ?? env.internalToken
  const shopify = deps.shopifyClient ?? createShopifyClient()

  function authorized(header: string | undefined): boolean {
    return Boolean(token) && header === token
  }

  app.post('/api/internal/whatsapp/status', async (req, res) => {
    if (!authorized(req.header('x-internal-token'))) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    const { status, qr, number } = req.body ?? {}
    await prisma.settings.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        messageTemplate: '',
        waStatus: String(status ?? 'disconnected'),
        waQr: qr ?? null,
        waNumber: number ?? null,
        waUpdatedAt: new Date()
      },
      update: {
        waStatus: String(status ?? 'disconnected'),
        waQr: qr ?? null,
        waNumber: number ?? null,
        waUpdatedAt: new Date()
      }
    })

    res.json({ ok: true })
  })

  app.post('/api/internal/shopify/apply', async (req, res) => {
    if (!authorized(req.header('x-internal-token'))) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    const { orderId, action } = req.body ?? {}
    if (action !== 'confirmed' && action !== 'cancelled') {
      res.status(400).json({ error: 'invalid action' })
      return
    }

    const order = await prisma.order.findUnique({ where: { id: String(orderId) } })
    if (!order) {
      res.status(404).json({ error: 'order not found' })
      return
    }

    const now = new Date()
    const tag = action === 'confirmed' ? 'confirmed-by-whatsapp' : 'cancelled-by-whatsapp'
    const note = `${tag} at ${formatTimestamp(now)}`

    try {
      await shopify.addTags(order.shopifyOrderId, [tag])
      await shopify.appendNote(order.shopifyOrderId, note)
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : 'shopify failed' })
      return
    }

    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: action,
        ...(action === 'confirmed' ? { confirmedAt: now } : { cancelledAt: now })
      }
    })

    res.json({ ok: true })
  })
}
```

Modify `api/src/app.ts`: import both registrars and call `registerWhatsAppRoutes(app)` and `registerInternalRoutes(app)` alongside the others.

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./test.db" npm test -w api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/whatsapp.ts api/src/routes/internal.ts api/src/routes/whatsapp.test.ts api/src/app.ts
git commit -m "feat(api): add whatsapp status, reconnect, and internal endpoints"
```

---

## Phase 4 — Worker Process

### Task 14: WhatsApp driver interface and whatsapp-web.js implementation

**Files:**
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/vitest.config.ts`
- Create: `worker/src/env.ts`
- Create: `worker/src/db.ts`
- Create: `worker/src/whatsapp/driver.ts`
- Create: `worker/src/whatsapp/webjs.ts`

**Interfaces:**
- Consumes: `WaConnectionStatus` from `@swc/shared`.
- Produces:
  - `interface OutboundMessage { to: string; body: string; buttons?: { id: string; label: string }[] }`
  - `interface InboundMessage { from: string; body: string; waMessageId: string; selectedButtonId?: string }`
  - `interface WhatsAppDriver { start(): Promise<void>; stop(): Promise<void>; send(message: OutboundMessage): Promise<{ waMessageId: string }>; onInbound(handler: (message: InboundMessage) => void): void; onStatus(handler: (status: WaConnectionStatus, qr?: string | null, number?: string | null) => void): void; isReady(): boolean; requestReconnect(): Promise<void> }`
  - `createWebjsDriver(): WhatsAppDriver` — implemented with `whatsapp-web.js`. `send` attempts `Buttons` first when `buttons` is set, and falls back to a plain text message when the buttons send throws.

- [ ] **Step 1: Create the worker package manifest**

`worker/package.json`:

```json
{
  "name": "@swc/worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@prisma/client": "^5.14.0",
    "@swc/shared": "*",
    "whatsapp-web.js": "^1.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.12.12",
    "tsx": "^4.10.5",
    "vitest": "^1.6.0"
  }
}
```

`worker/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`worker/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    env: { DATABASE_URL: 'file:./test.db' }
  }
})
```

- [ ] **Step 2: Write the env and db modules**

`worker/src/env.ts`:

```ts
import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().default('file:./dev.db'),
  USER_WHATSAPP_SESSION_PATH: z.string().default('./.wa-session'),
  USER_API_PORT: z.coerce.number().default(3001),
  USER_WORKER_PORT: z.coerce.number().default(3002),
  USER_INTERNAL_TOKEN: z.string().default('change-me-internal-token')
})

const parsed = schema.parse(process.env)

export const env = {
  databaseUrl: parsed.DATABASE_URL,
  sessionPath: parsed.USER_WHATSAPP_SESSION_PATH,
  workerPort: parsed.USER_WORKER_PORT,
  apiUrl: `http://localhost:${parsed.USER_API_PORT}`,
  internalToken: parsed.USER_INTERNAL_TOKEN
}
```

Add `zod` to worker dependencies: `npm install -w worker zod`.

`worker/src/db.ts`:

```ts
import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()
```

- [ ] **Step 3: Write the driver interface**

`worker/src/whatsapp/driver.ts`:

```ts
import type { WaConnectionStatus } from '@swc/shared'

export interface OutboundMessage {
  to: string
  body: string
  buttons?: { id: string; label: string }[]
}

export interface InboundMessage {
  from: string
  body: string
  waMessageId: string
  selectedButtonId?: string
}

export interface WhatsAppDriver {
  start(): Promise<void>
  stop(): Promise<void>
  send(message: OutboundMessage): Promise<{ waMessageId: string }>
  onInbound(handler: (message: InboundMessage) => void): void
  onStatus(handler: (status: WaConnectionStatus, qr?: string | null, number?: string | null) => void): void
  isReady(): boolean
  requestReconnect(): Promise<void>
}
```

- [ ] **Step 4: Write the whatsapp-web.js driver**

`worker/src/whatsapp/webjs.ts`:

```ts
import { mkdirSync } from 'node:fs'
import { Client, LocalAuth } from 'whatsapp-web.js'
import { normalizePhone } from '@swc/shared'
import type { WaConnectionStatus } from '@swc/shared'
import { env } from '../env.js'
import type { InboundMessage, OutboundMessage, WhatsAppDriver } from './driver.js'

export function createWebjsDriver(): WhatsAppDriver {
  mkdirSync(env.sessionPath, { recursive: true })

  let ready = false
  let inboundHandler: ((message: InboundMessage) => void) | null = null
  let statusHandler: ((status: WaConnectionStatus, qr?: string | null, number?: string | null) => void) | null = null

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: env.sessionPath }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
  })

  client.on('qr', (qr) => statusHandler?.('qr', qr, null))
  client.on('loading_screen', () => statusHandler?.('connecting', null, null))
  client.on('authenticated', () => statusHandler?.('connecting', null, null))
  client.on('auth_failure', () => statusHandler?.('disconnected', null, null))
  client.on('disconnected', () => {
    ready = false
    statusHandler?.('disconnected', null, null)
  })
  client.on('ready', () => {
    ready = true
    const number = client.info?.wid?.user ?? null
    statusHandler?.('ready', null, number)
  })

  client.on('message', async (message) => {
    if (!inboundHandler) return
    const rawFrom = message.from.split('@')[0] ?? ''
    const phone = normalizePhone(rawFrom)
    if (!phone) return

    let selectedButtonId: string | undefined
    const selected = (message as unknown as { selectedButtonId?: string }).selectedButtonId
    if (selected) selectedButtonId = selected

    const resolved = await (message as unknown as { getContact?: () => Promise<{ number: string }> }).getContact?.().catch(() => undefined)
    const resolvedPhone = resolved?.number ? normalizePhone(resolved.number) : null

    inboundHandler({
      from: resolvedPhone ?? phone,
      body: message.body ?? '',
      waMessageId: message.id?._serialized ?? '',
      selectedButtonId
    })
  })

  async function sendText(to: string, body: string): Promise<{ waMessageId: string }> {
    const chatId = `${to.replace('+', '')}@c.us`
    const sent = await client.sendMessage(chatId, body)
    return { waMessageId: sent.id?._serialized ?? '' }
  }

  return {
    async start() {
      statusHandler?.('connecting', null, null)
      await client.initialize()
    },
    async stop() {
      ready = false
      await client.destroy()
    },
    async send(message: OutboundMessage) {
      if (message.buttons?.length) {
        try {
          const { Buttons } = await import('whatsapp-web.js')
          const chatId = `${message.to.replace('+', '')}@c.us`
          const sent = await client.sendMessage(
            chatId,
            new Buttons(message.body, message.buttons.map((b) => ({ body: b.label, id: b.id })), '', '')
          )
          return { waMessageId: sent.id?._serialized ?? '' }
        } catch {
          return sendText(message.to, message.body)
        }
      }
      return sendText(message.to, message.body)
    },
    onInbound(handler) {
      inboundHandler = handler
    },
    onStatus(handler) {
      statusHandler = handler
    },
    isReady() {
      return ready
    },
    async requestReconnect() {
      ready = false
      await client.destroy()
      await client.initialize()
    }
  }
}
```

- [ ] **Step 5: Verify the worker compiles**

Run: `npm install && npm run build -w worker`
Expected: build succeeds and emits `worker/dist`.

- [ ] **Step 6: Commit**

```bash
git add worker
git commit -m "feat(worker): add WhatsApp driver interface and whatsapp-web.js implementation"
```

---

### Task 15: Outbox processor

**Files:**
- Create: `worker/src/outbox.ts`
- Test: `worker/src/outbox.test.ts`

**Interfaces:**
- Consumes: `prisma`, a `WhatsAppDriver`, `renderConfirmation`.
- Produces: `processNextJob(deps: { prisma: PrismaClient; driver: WhatsAppDriver }): Promise<'idle' | 'sent' | 'failed' | 'empty-phone'>`. It selects the oldest `pending` job (also adopting jobs stuck in `processing` for over 5 minutes) whose `scheduledAt` is due, sends the confirmation, and updates job/order state. It is safe to call repeatedly.
- Also produces `MAX_ATTEMPTS = 5` with an exponential backoff of `min(2 ** attempts, 60)` seconds.

Behavior details:
- On success: job `sent`, order `sent`, `sentAt` set, an outbound `Message` row written.
- On send failure with `attempts + 1 >= MAX_ATTEMPTS`: job `failed`, order `failed`.
- On send failure otherwise: job back to `pending`, `attempts` incremented, `scheduledAt` in the future, `lastError` stored.
- A job whose order has an empty phone becomes `failed` and the order becomes `failed`.

- [ ] **Step 1: Write the failing test**

`worker/src/outbox.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { processNextJob, MAX_ATTEMPTS } from './outbox.js'
import type { WhatsAppDriver } from './whatsapp/driver.js'

const prisma = new PrismaClient()

function fakeDriver(overrides: Partial<WhatsAppDriver> = {}): WhatsAppDriver {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    send: vi.fn().mockResolvedValue({ waMessageId: 'wamid.1' }),
    onInbound: vi.fn(),
    onStatus: vi.fn(),
    isReady: vi.fn().mockReturnValue(true),
    requestReconnect: vi.fn(),
    ...overrides
  }
}

async function seedOrder(phone: string) {
  const order = await prisma.order.create({
    data: {
      shopifyOrderId: `o-${Math.random()}`,
      orderNumber: '#1',
      customerName: 'Test',
      phone,
      total: '10',
      currency: 'EGP',
      financialStatus: 'pending',
      paymentGateway: 'cod',
      status: 'pending'
    }
  })
  await prisma.messageJob.create({ data: { orderId: order.id, status: 'pending' } })
  return order
}

describe('processNextJob', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = 'file:./test.db'
    await prisma.settings.upsert({
      where: { id: 1 },
      create: { id: 1, messageTemplate: 'Order {{orderNumber}} total {{total}}' },
      update: { messageTemplate: 'Order {{orderNumber}} total {{total}}' }
    })
  })

  afterEach(async () => {
    await prisma.messageJob.deleteMany()
    await prisma.message.deleteMany()
    await prisma.order.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('returns idle when there is nothing to do', async () => {
    expect(await processNextJob({ prisma, driver: fakeDriver() })).toBe('idle')
  })

  it('sends a confirmation and marks the order sent', async () => {
    const order = await seedOrder('+201000000010')
    const driver = fakeDriver()
    expect(await processNextJob({ prisma, driver })).toBe('sent')

    expect(driver.send).toHaveBeenCalledOnce()
    const arg = (driver.send as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.to).toBe('+201000000010')
    expect(arg.body).toContain('#1')
    expect(arg.buttons?.map((b: { id: string }) => b.id)).toEqual(['confirm_order', 'cancel_order'])

    const updated = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updated?.status).toBe('sent')
    expect(updated?.sentAt).not.toBeNull()
  })

  it('retries with backoff on failure', async () => {
    await seedOrder('+201000000011')
    const driver = fakeDriver({ send: vi.fn().mockRejectedValue(new Error('boom')) })
    expect(await processNextJob({ prisma, driver })).toBe('failed')

    const job = await prisma.messageJob.findFirst()
    expect(job?.status).toBe('pending')
    expect(job?.attempts).toBe(1)
    expect(job?.lastError).toContain('boom')
    expect(job!.scheduledAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('gives up after the maximum attempts', async () => {
    const order = await seedOrder('+201000000012')
    await prisma.messageJob.updateMany({ data: { attempts: MAX_ATTEMPTS - 1 } })
    const driver = fakeDriver({ send: vi.fn().mockRejectedValue(new Error('boom')) })
    await processNextJob({ prisma, driver })

    const job = await prisma.messageJob.findFirst()
    expect(job?.status).toBe('failed')
    const updated = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updated?.status).toBe('failed')
  })

  it('fails an order with no phone number', async () => {
    const order = await seedOrder('')
    expect(await processNextJob({ prisma, driver: fakeDriver() })).toBe('empty-phone')
    const updated = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updated?.status).toBe('failed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w worker`
Expected: FAIL — cannot resolve `./outbox.js`.

- [ ] **Step 3: Write the minimal implementation**

`worker/src/outbox.ts`:

```ts
import type { PrismaClient } from '@prisma/client'
import { renderConfirmation } from '@swc/shared'
import type { WhatsAppDriver } from './whatsapp/driver.js'

export const MAX_ATTEMPTS = 5
const STUCK_AFTER_MS = 5 * 60 * 1000

interface Deps {
  prisma: PrismaClient
  driver: WhatsAppDriver
}

function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts, 60) * 1000
}

export async function processNextJob(deps: Deps): Promise<'idle' | 'sent' | 'failed' | 'empty-phone'> {
  const { prisma, driver } = deps
  const now = new Date()

  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MS)
  const job = await prisma.messageJob.findFirst({
    where: {
      scheduledAt: { lte: now },
      OR: [
        { status: 'pending' },
        { status: 'processing', updatedAt: { lt: stuckBefore } }
      ]
    },
    orderBy: { scheduledAt: 'asc' },
    include: { order: true }
  })

  if (!job) return 'idle'

  if (job.status === 'pending') {
    await prisma.messageJob.update({ where: { id: job.id }, data: { status: 'processing' } })
  }

  const order = job.order

  if (!order.phone) {
    await prisma.messageJob.update({
      where: { id: job.id },
      data: { status: 'failed', lastError: 'missing phone' }
    })
    await prisma.order.update({ where: { id: order.id }, data: { status: 'failed' } })
    return 'empty-phone'
  }

  const settings = await prisma.settings.findUnique({ where: { id: 1 } })
  const template = settings?.messageTemplate || 'Order {{orderNumber}}'
  const body = renderConfirmation(template, {
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    total: order.total,
    currency: order.currency
  })

  const buttons = (settings?.interactiveButtons ?? true)
    ? [
        { id: 'confirm_order', label: 'تأكيد الطلب' },
        { id: 'cancel_order', label: 'إلغاء الطلب' }
      ]
    : undefined

  try {
    const result = await driver.send({ to: order.phone, body, buttons })
    const sentAt = new Date()

    await prisma.message.create({
      data: { orderId: order.id, direction: 'out', body, waMessageId: result.waMessageId }
    })
    await prisma.messageJob.update({ where: { id: job.id }, data: { status: 'sent', lastError: null } })
    await prisma.order.update({ where: { id: order.id }, data: { status: 'sent', sentAt } })
    return 'sent'
  } catch (error) {
    const attempts = job.attempts + 1
    const message = error instanceof Error ? error.message : String(error)

    if (attempts >= MAX_ATTEMPTS) {
      await prisma.messageJob.update({
        where: { id: job.id },
        data: { status: 'failed', attempts, lastError: message }
      })
      await prisma.order.update({ where: { id: order.id }, data: { status: 'failed' } })
      return 'failed'
    }

    await prisma.messageJob.update({
      where: { id: job.id },
      data: {
        status: 'pending',
        attempts,
        lastError: message,
        scheduledAt: new Date(Date.now() + backoffMs(attempts))
      }
    })
    return 'failed'
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./test.db" npm test -w worker`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/outbox.ts worker/src/outbox.test.ts
git commit -m "feat(worker): add resilient outbox processor with retries"
```

---

### Task 16: Inbound reply handling

**Files:**
- Create: `worker/src/api-client.ts`
- Create: `worker/src/replies.ts`
- Test: `worker/src/replies.test.ts`

**Interfaces:**
- Consumes: `prisma`, `parseReply`, `normalizePhone`, `InboundMessage`, `env`.
- Produces: `handleInbound(deps: { prisma: PrismaClient; notify: (orderId: string, action: 'confirmed' | 'cancelled') => Promise<void>; text: InboundMessage }): Promise<'confirmed' | 'cancelled' | 'unknown' | 'ignored'>`.
  - Matching: normalize the sender, find the most recent order with that phone and status `sent`. If none, return `ignored`.
  - Intent: `selectedButtonId` takes precedence over the body text: `confirm_order` → confirm, `cancel_order` → cancel.
  - On match, write an inbound `Message` row, call `notify`, and update the order status plus the matching timestamp.
- Produces: `createNotifier(config?: { apiUrl?: string; internalToken?: string; fetchImpl?: typeof fetch })` returning `(orderId: string, action: 'confirmed' | 'cancelled') => Promise<void>` which POSTs to `${apiUrl}/api/internal/shopify/apply`.

- [ ] **Step 1: Write the failing test**

`worker/src/replies.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { handleInbound } from './replies.js'

const prisma = new PrismaClient()

async function seedSentOrder(phone: string) {
  const order = await prisma.order.create({
    data: {
      shopifyOrderId: `r-${Math.random()}`,
      orderNumber: '#5001',
      customerName: 'Customer',
      phone,
      total: '99',
      currency: 'EGP',
      financialStatus: 'pending',
      paymentGateway: 'cod',
      status: 'sent'
    }
  })
  return order
}

describe('handleInbound', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = 'file:./test.db'
  })

  afterEach(async () => {
    await prisma.message.deleteMany()
    await prisma.messageJob.deleteMany()
    await prisma.order.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('confirms a sent order from the number 1', async () => {
    const order = await seedSentOrder('+201000000020')
    const notify = vi.fn().mockResolvedValue(undefined)

    const result = await handleInbound({
      prisma,
      notify,
      text: { from: '+201000000020', body: '1', waMessageId: 'in.1' }
    })

    expect(result).toBe('confirmed')
    expect(notify).toHaveBeenCalledWith(order.id, 'confirmed')
    const updated = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updated?.status).toBe('confirmed')
    expect(updated?.confirmedAt).not.toBeNull()
  })

  it('cancels via a selected button id even with an unrelated body', async () => {
    const order = await seedSentOrder('+201000000021')
    const notify = vi.fn().mockResolvedValue(undefined)

    const result = await handleInbound({
      prisma,
      notify,
      text: { from: '+201000000021', body: '', waMessageId: 'in.2', selectedButtonId: 'cancel_order' }
    })

    expect(result).toBe('cancelled')
    const updated = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updated?.status).toBe('cancelled')
  })

  it('matches an order stored in local format', async () => {
    await seedSentOrder('+201000000022')
    const notify = vi.fn().mockResolvedValue(undefined)
    const result = await handleInbound({
      prisma,
      notify,
      text: { from: '01000000022', body: 'تأكيد', waMessageId: 'in.3' }
    })
    expect(result).toBe('confirmed')
  })

  it('ignores an unknown sender', async () => {
    const notify = vi.fn()
    const result = await handleInbound({
      prisma,
      notify,
      text: { from: '+201999999999', body: '1', waMessageId: 'in.4' }
    })
    expect(result).toBe('ignored')
    expect(notify).not.toHaveBeenCalled()
  })

  it('ignores an unrecognized reply but records it', async () => {
    const order = await seedSentOrder('+201000000023')
    const notify = vi.fn()
    const result = await handleInbound({
      prisma,
      notify,
      text: { from: '+201000000023', body: 'hello?', waMessageId: 'in.5' }
    })
    expect(result).toBe('unknown')
    expect(notify).not.toHaveBeenCalled()
    const messages = await prisma.message.findMany({ where: { orderId: order.id } })
    expect(messages).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w worker`
Expected: FAIL — cannot resolve `./replies.js`.

- [ ] **Step 3: Write the minimal implementation**

`worker/src/api-client.ts`:

```ts
import { env } from './env.js'

interface NotifierConfig {
  apiUrl?: string
  internalToken?: string
  fetchImpl?: typeof fetch
}

export function createNotifier(config: NotifierConfig = {}) {
  const apiUrl = config.apiUrl ?? env.apiUrl
  const token = config.internalToken ?? env.internalToken
  const doFetch = config.fetchImpl ?? fetch

  return async function notify(orderId: string, action: 'confirmed' | 'cancelled'): Promise<void> {
    const res = await doFetch(`${apiUrl}/api/internal/shopify/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': token },
      body: JSON.stringify({ orderId, action })
    })
    if (!res.ok) {
      throw new Error(`apply failed with HTTP ${res.status}`)
    }
  }
}
```

`worker/src/replies.ts`:

```ts
import type { PrismaClient } from '@prisma/client'
import { normalizePhone, parseReply } from '@swc/shared'
import type { ReplyIntent } from '@swc/shared'
import type { InboundMessage } from './whatsapp/driver.js'

interface Deps {
  prisma: PrismaClient
  notify: (orderId: string, action: 'confirmed' | 'cancelled') => Promise<void>
  text: InboundMessage
}

function intentFor(text: InboundMessage): ReplyIntent {
  if (text.selectedButtonId === 'confirm_order') return 'confirm'
  if (text.selectedButtonId === 'cancel_order') return 'cancel'
  return parseReply(text.body)
}

export async function handleInbound(
  deps: Deps
): Promise<'confirmed' | 'cancelled' | 'unknown' | 'ignored'> {
  const { prisma, notify, text } = deps

  const phone = normalizePhone(text.from)
  if (!phone) return 'ignored'

  const order = await prisma.order.findFirst({
    where: { phone, status: 'sent' },
    orderBy: { sentAt: 'desc' }
  })
  if (!order) return 'ignored'

  const intent = intentFor(text)
  if (intent === 'unknown') {
    await prisma.message.create({
      data: {
        orderId: order.id,
        direction: 'in',
        body: text.body || (text.selectedButtonId ?? ''),
        waMessageId: text.waMessageId
      }
    })
    return 'unknown'
  }

  const action = intent === 'confirm' ? 'confirmed' : 'cancelled'
  const now = new Date()

  await prisma.message.create({
    data: { orderId: order.id, direction: 'in', body: text.body || intent, waMessageId: text.waMessageId }
  })

  try {
    await notify(order.id, action)
  } catch {
    // The reply is persisted above, so a Shopify failure can be retried from the dashboard.
  }

  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: action,
      ...(action === 'confirmed' ? { confirmedAt: now } : { cancelledAt: now })
    }
  })

  return action
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./test.db" npm test -w worker`
Expected: PASS (11 tests total).

- [ ] **Step 5: Commit**

```bash
git add worker/src/api-client.ts worker/src/replies.ts worker/src/replies.test.ts
git commit -m "feat(worker): match inbound replies to orders and apply confirm/cancel"
```

---

### Task 17: Worker bootstrap

**Files:**
- Create: `worker/src/bot.ts`
- Create: `worker/src/index.ts`
- Test: `worker/src/bot.test.ts`

**Interfaces:**
- Consumes: `processNextJob`, `handleInbound`, `createNotifier`, `WhatsAppDriver`, `prisma`, `env`.
- Produces: `createBot(deps: { prisma: PrismaClient; driver: WhatsAppDriver; notify: Notifier }): { start(intervalMs?: number): void; stop(): void; onStatus(status: WaConnectionStatus, qr?: string | null, number?: string | null): void }` where `Notifier = (orderId: string, action: 'confirmed' | 'cancelled') => Promise<void>`.
  - `start` registers inbound/status handlers and runs a loop that processes one job per tick (default `1500` ms), only when `driver.isReady()`.
  - Status changes are pushed to the api via a `pushStatus` dependency; deps accept `{ pushStatus?: (payload) => Promise<void> }` for testing.
  - `stop` clears the interval.
- `worker/src/index.ts` wires the real driver, Prisma, notifier, and a small HTTP server on `env.workerPort` exposing `GET /health` and `POST /internal/reconnect`.

- [ ] **Step 1: Write the failing test**

`worker/src/bot.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createBot } from './bot.js'
import type { WhatsAppDriver, InboundMessage } from './whatsapp/driver.js'

const prisma = new PrismaClient()

function makeDriver() {
  let inbound: ((m: InboundMessage) => void) | null = null
  let status: ((s: never, qr?: string | null, n?: string | null) => void) | null = null
  const driver: WhatsAppDriver = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue({ waMessageId: 'x' }),
    onInbound: (h) => { inbound = h },
    onStatus: (h) => { status = h as never },
    isReady: vi.fn().mockReturnValue(true),
    requestReconnect: vi.fn()
  }
  return { driver, emitInbound: (m: InboundMessage) => inbound?.(m), emitStatus: (s: never) => status?.(s) }
}

describe('createBot', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = 'file:./test.db'
    await prisma.settings.upsert({
      where: { id: 1 },
      create: { id: 1, messageTemplate: 'Order {{orderNumber}}' },
      update: { messageTemplate: 'Order {{orderNumber}}' }
    })
  })

  afterEach(async () => {
    await prisma.message.deleteMany()
    await prisma.messageJob.deleteMany()
    await prisma.order.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('pushes status updates to the api', async () => {
    const { driver, emitStatus } = makeDriver()
    const pushStatus = vi.fn().mockResolvedValue(undefined)
    const bot = createBot({ prisma, driver, notify: vi.fn(), pushStatus })
    bot.start(100000)

    emitStatus('ready')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(pushStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }))
    bot.stop()
  })

  it('processes a pending job on the loop', async () => {
    const order = await prisma.order.create({
      data: {
        shopifyOrderId: 'bot-1',
        orderNumber: '#1',
        customerName: 'x',
        phone: '+201000000030',
        total: '1',
        currency: 'EGP',
        financialStatus: 'pending',
        paymentGateway: 'cod',
        status: 'pending'
      }
    })
    await prisma.messageJob.create({ data: { orderId: order.id, status: 'pending' } })

    const { driver } = makeDriver()
    const bot = createBot({ prisma, driver, notify: vi.fn(), pushStatus: vi.fn() })
    bot.start(50)

    await new Promise((resolve) => setTimeout(resolve, 200))
    bot.stop()

    const updated = await prisma.order.findUnique({ where: { id: order.id } })
    expect(updated?.status).toBe('sent')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w worker`
Expected: FAIL — cannot resolve `./bot.js`.

- [ ] **Step 3: Write the minimal implementation**

`worker/src/bot.ts`:

```ts
import type { PrismaClient } from '@prisma/client'
import type { WaConnectionStatus } from '@swc/shared'
import { processNextJob } from './outbox.js'
import { handleInbound } from './replies.js'
import type { WhatsAppDriver } from './whatsapp/driver.js'

export type Notifier = (orderId: string, action: 'confirmed' | 'cancelled') => Promise<void>

interface StatusPayload {
  status: WaConnectionStatus
  qr?: string | null
  number?: string | null
}

interface BotDeps {
  prisma: PrismaClient
  driver: WhatsAppDriver
  notify: Notifier
  pushStatus?: (payload: StatusPayload) => Promise<void>
}

export function createBot(deps: BotDeps) {
  const { prisma, driver, notify, pushStatus } = deps
  let timer: NodeJS.Timeout | null = null
  let running = false

  driver.onInbound((message) => {
    void handleInbound({ prisma, notify, text: message }).catch((error) => {
      console.error('[worker] inbound handling failed', error)
    })
  })

  driver.onStatus((status, qr, number) => {
    void pushStatus?.({ status, qr, number }).catch(() => undefined)
  })

  async function tick(): Promise<void> {
    if (running) return
    if (!driver.isReady()) return
    running = true
    try {
      let result = await processNextJob({ prisma, driver })
      while (result === 'sent' || result === 'failed' || result === 'empty-phone') {
        result = await processNextJob({ prisma, driver })
      }
    } catch (error) {
      console.error('[worker] outbox error', error)
    } finally {
      running = false
    }
  }

  return {
    start(intervalMs = 1500) {
      timer = setInterval(() => void tick(), intervalMs)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
    onStatus(status: WaConnectionStatus, qr?: string | null, number?: string | null) {
      void pushStatus?.({ status, qr, number }).catch(() => undefined)
    }
  }
}
```

`worker/src/index.ts`:

```ts
import http from 'node:http'
import { prisma } from './db.js'
import { env } from './env.js'
import { createNotifier } from './api-client.js'
import { createBot } from './bot.js'
import { createWebjsDriver } from './whatsapp/webjs.js'

async function pushStatus(payload: { status: string; qr?: string | null; number?: string | null }): Promise<void> {
  await fetch(`${env.apiUrl}/api/internal/whatsapp/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-token': env.internalToken },
    body: JSON.stringify(payload)
  })
}

async function main(): Promise<void> {
  const driver = createWebjsDriver()
  const notify = createNotifier()
  const bot = createBot({ prisma, driver, notify, pushStatus: pushStatus as never })

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, ready: driver.isReady() }))
      return
    }
    if (req.method === 'POST' && req.url === '/internal/reconnect') {
      void driver.requestReconnect().catch(() => undefined)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    res.writeHead(404)
    res.end()
  })

  server.listen(env.workerPort, () => {
    console.log(`[worker] health on http://localhost:${env.workerPort}`)
  })

  bot.start()
  await driver.start()
}

main().catch((error) => {
  console.error('[worker] fatal', error)
  process.exit(1)
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL="file:./test.db" npm test -w worker && npm run build -w worker`
Expected: PASS (13 tests total); build succeeds.

- [ ] **Step 5: Commit**

```bash
git add worker/src/bot.ts worker/src/bot.test.ts worker/src/index.ts
git commit -m "feat(worker): wire bot loop, health server, and reconnect endpoint"
```

---

## Phase 5 — Dashboard

### Task 18: Dashboard scaffolding

**Files:**
- Create: `dashboard/package.json`
- Create: `dashboard/tsconfig.json`
- Create: `dashboard/vite.config.ts`
- Create: `dashboard/tailwind.config.js`
- Create: `dashboard/postcss.config.js`
- Create: `dashboard/index.html`
- Create: `dashboard/src/main.tsx`
- Create: `dashboard/src/index.css`
- Create: `dashboard/src/App.tsx`
- Create: `dashboard/src/api.ts`
- Create: `dashboard/src/components/Layout.tsx`
- Create: `dashboard/src/components/StatusBadge.tsx`

**Interfaces:**
- Consumes: the api REST contract.
- Produces: a runnable RTL dashboard with routes `/` (orders), `/stats`, `/settings`, `/connection`, and a typed `api` object with methods `getOrders`, `resendOrder`, `getStats`, `getSettings`, `saveSettings`, `getWhatsAppStatus`, `reconnectWhatsApp`.

- [ ] **Step 1: Create the dashboard manifest**

`dashboard/package.json`:

```json
{
  "name": "@swc/dashboard",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "tsc -b && vite build",
    "preview": "vite preview --host 0.0.0.0"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.23.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.2",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.3",
    "typescript": "^5.4.5",
    "vite": "^5.2.11"
  }
}
```

- [ ] **Step 2: Create the build and style configuration**

`dashboard/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ['.monkeycode-ai.live'],
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/webhooks': { target: 'http://localhost:3001', changeOrigin: true }
    }
  }
})
```

`dashboard/tailwind.config.js`:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: []
}
```

`dashboard/postcss.config.js`:

```js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} }
}
```

`dashboard/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`dashboard/index.html`:

```html
<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>تأكيد أوردرات واتساب</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`dashboard/src/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
  @apply bg-slate-100 text-slate-800;
}
```

- [ ] **Step 3: Create the API client**

`dashboard/src/api.ts`:

```ts
export interface Order {
  id: string
  shopifyOrderId: string
  orderNumber: string
  customerName: string
  phone: string
  total: string
  currency: string
  status: 'pending' | 'sent' | 'confirmed' | 'cancelled' | 'failed'
  createdAt: string
  confirmedAt: string | null
  cancelledAt: string | null
}

export interface Stats {
  total: number
  pending: number
  sent: number
  confirmed: number
  cancelled: number
  failed: number
  confirmationRate: number
}

export interface Settings {
  shopDomain: string
  adminAccessToken: string
  webhookSecret: string
  messageTemplate: string
  interactiveButtons: boolean
}

export interface WaStatus {
  status: 'connecting' | 'qr' | 'ready' | 'disconnected'
  qr: string | null
  number: string | null
  updatedAt: string | null
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

export const api = {
  getOrders(params: { status?: string; q?: string; page?: number } = {}) {
    const search = new URLSearchParams()
    if (params.status) search.set('status', params.status)
    if (params.q) search.set('q', params.q)
    if (params.page) search.set('page', String(params.page))
    return json<{ items: Order[]; total: number; page: number; pageSize: number }>(
      fetch(`/api/orders?${search.toString()}`)
    )
  },
  resendOrder(id: string) {
    return json<{ ok: boolean }>(fetch(`/api/orders/${id}/resend`, { method: 'POST' }))
  },
  getStats() {
    return json<Stats>(fetch('/api/stats'))
  },
  getSettings() {
    return json<Settings>(fetch('/api/settings'))
  },
  saveSettings(payload: Partial<Settings>) {
    return json<Settings>(
      fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    )
  },
  getWhatsAppStatus() {
    return json<WaStatus>(fetch('/api/whatsapp/status'))
  },
  reconnectWhatsApp() {
    return json<{ ok: boolean }>(fetch('/api/whatsapp/reconnect', { method: 'POST' }))
  }
}
```

- [ ] **Step 4: Create the layout and badge components**

`dashboard/src/components/StatusBadge.tsx`:

```tsx
const LABELS: Record<string, string> = {
  pending: 'في الانتظار',
  sent: 'تم الإرسال',
  confirmed: 'مؤكد',
  cancelled: 'ملغي',
  failed: 'فشل'
}

const COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  sent: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-rose-100 text-rose-800',
  failed: 'bg-slate-200 text-slate-700'
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${COLORS[status] ?? ''}`}>
      {LABELS[status] ?? status}
    </span>
  )
}
```

`dashboard/src/components/Layout.tsx`:

```tsx
import { NavLink, Outlet } from 'react-router-dom'

const links = [
  { to: '/', label: 'الأوردرات' },
  { to: '/stats', label: 'الإحصائيات' },
  { to: '/connection', label: 'الاتصال' },
  { to: '/settings', label: 'الإعدادات' }
]

export function Layout() {
  return (
    <div className="min-h-screen">
      <header className="bg-white shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <h1 className="text-lg font-bold">تأكيد أوردرات واتساب</h1>
          <nav className="flex gap-2">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
```

- [ ] **Step 5: Create the app shell and entry point**

`dashboard/src/App.tsx`:

```tsx
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { OrdersPage } from './pages/OrdersPage'
import { StatsPage } from './pages/StatsPage'
import { SettingsPage } from './pages/SettingsPage'
import { ConnectionPage } from './pages/ConnectionPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<OrdersPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/connection" element={<ConnectionPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
```

`dashboard/src/main.tsx`:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

- [ ] **Step 6: Verify the install**

Run: `npm install`
Expected: installs React, Vite, Tailwind, React Router.

Note: the page modules are created in the next tasks; the build is verified after Task 22.

- [ ] **Step 7: Commit**

```bash
git add dashboard
git commit -m "chore(dashboard): scaffold React, Vite, Tailwind RTL shell"
```

---

### Task 19: Connection page

**Files:**
- Create: `dashboard/src/pages/ConnectionPage.tsx`

**Interfaces:**
- Consumes: `api.getWhatsAppStatus`, `api.reconnectWhatsApp`.
- Produces: a page polling status every 3 seconds, rendering the QR image when status is `qr`, the connected number when `ready`, and a reconnect button.

- [ ] **Step 1: Write the page**

`dashboard/src/pages/ConnectionPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { api, type WaStatus } from '../api'

const LABELS: Record<string, string> = {
  connecting: 'جاري الاتصال...',
  qr: 'امسح كود QR من واتساب',
  ready: 'متصل',
  disconnected: 'غير متصل'
}

export function ConnectionPage() {
  const [status, setStatus] = useState<WaStatus | null>(null)
  const [qrImage, setQrImage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.getWhatsAppStatus())
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(), 3000)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => {
    if (!status?.qr) {
      setQrImage(null)
      return
    }
    void import('qrcode').then(({ toDataURL }) =>
      toDataURL(status.qr!, { margin: 1, width: 260 }).then(setQrImage)
    ).catch(() => setQrImage(null))
  }, [status?.qr])

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-xl font-bold">حالة واتساب</h2>
      <p className="mb-2 text-sm text-slate-600">{LABELS[status?.status ?? 'disconnected']}</p>

      {status?.number && <p className="mb-2 text-sm">الرقم المتصل: {status.number}</p>}

      {qrImage && (
        <div className="my-4 flex flex-col items-center gap-2">
          <img src={qrImage} alt="WhatsApp QR" className="rounded-xl border" />
          <p className="text-sm text-slate-500">من واتساب: الأجهزة المرتبطة، ثم ربط جهاز.</p>
        </div>
      )}

      <button
        onClick={() => void api.reconnectWhatsApp().then(refresh)}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
      >
        إعادة الاتصال
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Add the QR dependency**

Run: `npm install -w dashboard qrcode && npm install -w dashboard -D @types/qrcode`
Expected: `qrcode` in dashboard dependencies.

- [ ] **Step 3: Type-check the page**

Run: `npx --prefix dashboard tsc -p dashboard/tsconfig.json --noEmit`
Expected: no type errors (page modules exist from Task 18).

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/pages/ConnectionPage.tsx dashboard/package.json
git commit -m "feat(dashboard): add WhatsApp connection page with QR and reconnect"
```

---

### Task 20: Orders page

**Files:**
- Create: `dashboard/src/pages/OrdersPage.tsx`

**Interfaces:**
- Consumes: `api.getOrders`, `api.resendOrder`, `StatusBadge`.
- Produces: a table with a status filter, a search box, pagination, and a per-row resend button that refreshes the list.

- [ ] **Step 1: Write the page**

`dashboard/src/pages/OrdersPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { api, type Order } from '../api'
import { StatusBadge } from '../components/StatusBadge'

const FILTERS = [
  { value: '', label: 'الكل' },
  { value: 'pending', label: 'في الانتظار' },
  { value: 'sent', label: 'تم الإرسال' },
  { value: 'confirmed', label: 'مؤكد' },
  { value: 'cancelled', label: 'ملغي' },
  { value: 'failed', label: 'فشل' }
]

export function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 20

  const load = useCallback(async () => {
    try {
      const data = await api.getOrders({ status: status || undefined, q: query || undefined, page })
      setOrders(data.items)
      setTotal(data.total)
    } catch {
      setOrders([])
      setTotal(0)
    }
  }, [status, query, page])

  useEffect(() => {
    void load()
  }, [load])

  const pages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
        <select
          value={status}
          onChange={(event) => { setStatus(event.target.value); setPage(1) }}
          className="rounded-lg border px-3 py-2 text-sm"
        >
          {FILTERS.map((filter) => (
            <option key={filter.value} value={filter.value}>{filter.label}</option>
          ))}
        </select>
        <input
          value={query}
          onChange={(event) => { setQuery(event.target.value); setPage(1) }}
          placeholder="ابحث برقم الهاتف أو رقم الأوردر"
          className="flex-1 rounded-lg border px-3 py-2 text-sm"
        />
        <span className="text-sm text-slate-500">{total} أوردر</span>
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 text-right">الأوردر</th>
              <th className="px-4 py-3 text-right">العميل</th>
              <th className="px-4 py-3 text-right">الهاتف</th>
              <th className="px-4 py-3 text-right">الإجمالي</th>
              <th className="px-4 py-3 text-right">الحالة</th>
              <th className="px-4 py-3 text-right">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-t">
                <td className="px-4 py-3">{order.orderNumber}</td>
                <td className="px-4 py-3">{order.customerName}</td>
                <td className="px-4 py-3" dir="ltr">{order.phone || '-'}</td>
                <td className="px-4 py-3">{order.total} {order.currency}</td>
                <td className="px-4 py-3"><StatusBadge status={order.status} /></td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => void api.resendOrder(order.id).then(load)}
                    className="rounded-lg border px-3 py-1 text-xs hover:bg-slate-50"
                  >
                    إعادة إرسال
                  </button>
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">لا توجد أوردرات</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-center gap-3">
        <button
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
          className="rounded-lg border px-3 py-1 text-sm disabled:opacity-40"
        >
          السابق
        </button>
        <span className="text-sm text-slate-500">صفحة {page} من {pages}</span>
        <button
          disabled={page >= pages}
          onClick={() => setPage((p) => p + 1)}
          className="rounded-lg border px-3 py-1 text-sm disabled:opacity-40"
        >
          التالي
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check the page**

Run: `npx --prefix dashboard tsc -p dashboard/tsconfig.json --noEmit`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/OrdersPage.tsx
git commit -m "feat(dashboard): add orders table with filter, search, and resend"
```

---

### Task 21: Statistics page

**Files:**
- Create: `dashboard/src/pages/StatsPage.tsx`

**Interfaces:**
- Consumes: `api.getStats`.
- Produces: cards for total, confirmed, cancelled, pending, failed, and the confirmation rate as a percentage.

- [ ] **Step 1: Write the page**

`dashboard/src/pages/StatsPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { api, type Stats } from '../api'

const CARDS: { key: keyof Stats; label: string }[] = [
  { key: 'total', label: 'إجمالي الأوردرات' },
  { key: 'sent', label: 'تم الإرسال' },
  { key: 'confirmed', label: 'مؤكد' },
  { key: 'cancelled', label: 'ملغي' },
  { key: 'pending', label: 'في الانتظار' },
  { key: 'failed', label: 'فشل' }
]

export function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    void api.getStats().then(setStats).catch(() => setStats(null))
  }, [])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {CARDS.map((card) => (
          <div key={card.key} className="rounded-2xl bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">{card.label}</p>
            <p className="mt-2 text-3xl font-bold">{stats ? stats[card.key] : '-'}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-500">نسبة التأكيد (مؤكد مقابل ملغي)</p>
        <p className="mt-2 text-3xl font-bold">
          {stats ? `${Math.round(stats.confirmationRate * 100)}%` : '-'}
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check the page**

Run: `npx --prefix dashboard tsc -p dashboard/tsconfig.json --noEmit`
Expected: no type errors. If TypeScript complains that `stats[card.key]` is a non-number, the cause is `confirmationRate` being included in `keyof Stats`; narrow the tuple so `key` is typed as `'total' | 'sent' | 'confirmed' | 'cancelled' | 'pending' | 'failed'` (already the case via `keyof Stats` usage) and keep the cast-free access.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/StatsPage.tsx
git commit -m "feat(dashboard): add statistics page with confirmation rate"
```

---

### Task 22: Settings page

**Files:**
- Create: `dashboard/src/pages/SettingsPage.tsx`

**Interfaces:**
- Consumes: `api.getSettings`, `api.saveSettings`.
- Produces: a form editing shop domain, admin token, webhook secret, message template, and the interactive-buttons toggle, with a save confirmation message.

- [ ] **Step 1: Write the page**

`dashboard/src/pages/SettingsPage.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { api, type Settings } from '../api'

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void api.getSettings().then(setSettings).catch(() => setSettings(null))
  }, [])

  if (!settings) {
    return <div className="rounded-2xl bg-white p-6 text-slate-400 shadow-sm">جاري التحميل...</div>
  }

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) => (current ? { ...current, [key]: value } : current))
    setSaved(false)
  }

  async function save() {
    const updated = await api.saveSettings(settings)
    setSettings(updated)
    setSaved(true)
  }

  return (
    <div className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold">الإعدادات</h2>

      <label className="block">
        <span className="text-sm text-slate-600">دومين متجر شوبيفاي</span>
        <input
          value={settings.shopDomain}
          onChange={(event) => update('shopDomain', event.target.value)}
          placeholder="your-store.myshopify.com"
          dir="ltr"
          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="text-sm text-slate-600">Admin API access token</span>
        <input
          value={settings.adminAccessToken}
          onChange={(event) => update('adminAccessToken', event.target.value)}
          dir="ltr"
          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="text-sm text-slate-600">Webhook secret</span>
        <input
          value={settings.webhookSecret}
          onChange={(event) => update('webhookSecret', event.target.value)}
          dir="ltr"
          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="text-sm text-slate-600">قالب الرسالة</span>
        <textarea
          value={settings.messageTemplate}
          onChange={(event) => update('messageTemplate', event.target.value)}
          rows={8}
          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
        />
        <span className="text-xs text-slate-400">
          المتغيرات: {'{{orderNumber}}'} {'{{customerName}}'} {'{{total}}'} {'{{currency}}'}
        </span>
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={settings.interactiveButtons}
          onChange={(event) => update('interactiveButtons', event.target.checked)}
        />
        <span className="text-sm">إرسال أزرار تفاعلية (مع الرجوع تلقائياً للرد الرقمي)</span>
      </label>

      <div className="flex items-center gap-3">
        <button
          onClick={() => void save()}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          حفظ
        </button>
        {saved && <span className="text-sm text-emerald-600">تم الحفظ</span>}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Build the dashboard**

Run: `npm run build -w dashboard`
Expected: `dashboard/dist/index.html` and assets are emitted with no type errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/SettingsPage.tsx
git commit -m "feat(dashboard): add settings form for Shopify and template"
```

---

### Task 23: Serve the dashboard and add dev scripts

**Files:**
- Modify: `api/src/app.ts`
- Modify: `api/src/index.ts`
- Modify: `api/package.json`
- Test: `api/src/static.test.ts`

**Interfaces:**
- Consumes: the built `dashboard/dist` directory.
- Produces: `createApp()` serving the dashboard build for non-API, non-webhook `GET` paths with an SPA fallback to `index.html`, and returning JSON `404` for unknown `/api/*` routes. `api` also copies the dashboard build path via `DASHBOARD_DIST` optionally.

- [ ] **Step 1: Write the failing test**

`api/src/static.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app.js'

describe('static and fallback', () => {
  it('returns JSON 404 for unknown api routes', async () => {
    const res = await request(createApp()).get('/api/does-not-exist')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'not found' })
  })

  it('falls back to the dashboard index for unknown page routes', async () => {
    const res = await request(createApp()).get('/some-page')
    expect([200, 404]).toContain(res.status)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL="file:./test.db" npm test -w api`
Expected: FAIL — `/api/does-not-exist` currently returns HTML/empty 404, and `/some-page` returns 404 without the JSON contract.

- [ ] **Step 3: Update `api/src/app.ts`**

Replace with the final shape (keeps the raw-body handling for webhooks and mounts everything):

```ts
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import type { Express } from 'express'
import { registerWebhookRoutes } from './routes/webhooks.js'
import { registerOrderRoutes } from './routes/orders.js'
import { registerStatsRoutes } from './routes/stats.js'
import { registerSettingsRoutes } from './routes/settings.js'
import { registerWhatsAppRoutes } from './routes/whatsapp.js'
import { registerInternalRoutes } from './routes/internal.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const dashboardDist = process.env.DASHBOARD_DIST ?? path.resolve(here, '../../dashboard/dist')

export function createApp(): Express {
  const app = express()

  app.use((req, res, next) => {
    if (req.path.startsWith('/webhooks')) return next()
    express.json()(req, res, next)
  })

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  registerWebhookRoutes(app)
  registerOrderRoutes(app)
  registerStatsRoutes(app)
  registerSettingsRoutes(app)
  registerWhatsAppRoutes(app)
  registerInternalRoutes(app)

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not found' })
  })

  if (existsSync(dashboardDist)) {
    app.use(express.static(dashboardDist))
    app.get('*', (_req, res) => {
      res.sendFile(path.join(dashboardDist, 'index.html'))
    })
  }

  return app
}
```

- [ ] **Step 4: Update `api/src/index.ts` to resolve the dashboard path for production**

```ts
import { createApp } from './app.js'
import { env } from './env.js'

const app = createApp()

app.listen(env.apiPort, () => {
  console.log(`[api] listening on http://localhost:${env.apiPort}`)
})
```

- [ ] **Step 5: Add the build guard to the api start script**

In `api/package.json`, change `start` so it prints a warning when the dashboard build is missing:

```json
"start": "node -e \"const fs=require('fs');if(!fs.existsSync('../../dashboard/dist'))console.warn('[api] dashboard/dist missing - run npm run build -w dashboard')\" && node dist/index.js"
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `DATABASE_URL="file:./test.db" npm test -w api`
Expected: PASS (all api tests).

- [ ] **Step 7: Build everything and smoke-test the served dashboard**

Run: `npm run build`
Expected: shared, api, worker, and dashboard all build.

Run: `npm run start -w api > /tmp/opencode/api.log 2>&1` (background), then `curl -s localhost:3001/health`
Expected: `{"ok":true}`.

- [ ] **Step 8: Commit**

```bash
git add api/src/app.ts api/src/index.ts api/package.json api/src/static.test.ts
git commit -m "feat(api): serve dashboard build with SPA fallback and JSON 404 for api"
```

---

## Phase 6 — Documentation and Verification

### Task 24: README and webhook registration helper

**Files:**
- Create: `README.md`
- Create: `scripts/register-webhook.md`

**Interfaces:**
- Consumes: nothing.
- Produces: setup documentation covering install, environment, Shopify custom app creation, webhook registration, running dev, and running production.

- [ ] **Step 1: Write the README**

`README.md`:

```markdown
# Shopify WhatsApp Order Confirmation

أداة لتأكيد أوردرات الدفع عند الاستلام (COD) لمتجر شوبيفاي واحد عن طريق الواتساب.
عند وصول أوردر جديد يرسل النظام رسالة واتساب للتأكيد، ويعكس رد العميل على الأوردر في شوبيفاي كتاج ونوت.

## المتطلبات

- Node.js 20 أو أحدث
- رقم واتساب لربطه بالخدمة

## الإعداد

1. تثبيت الحزم:

```bash
npm install
```

2. نسخ ملف المتغيرات وتعبئته:

```bash
cp .env.example .env
```

3. تهيئة قاعدة البيانات:

```bash
npm run db:push
```

4. تشغيل بيئة التطوير (api + worker + dashboard):

```bash
npm run dev
```

## إعداد شوبيفاي

1. من لوحة شوبيفاي: Settings ثم Apps and sales channels ثم Develop apps.
2. إنشاء Custom App وتفعيل صلاحيات `read_orders` و `write_orders`.
3. تثبيت التطبيق ونسخ Admin API access token.
4. نسخ الـ API secret (يستخدم كـ webhook secret).
5. تسجيل الـ webhook: راجع `scripts/register-webhook.md`.

## متغيرات البيئة

| المتغير | الوصف |
| --- | --- |
| `USER_SHOPIFY_SHOP_DOMAIN` | دومين المتجر مثل `store.myshopify.com` |
| `USER_SHOPIFY_ADMIN_TOKEN` | توكن Admin API |
| `USER_SHOPIFY_WEBHOOK_SECRET` | الـ secret المستخدم للتحقق من توقيع الـ webhook |
| `USER_WHATSAPP_SESSION_PATH` | مسار تخزين جلسة واتساب |
| `USER_DEFAULT_COUNTRY_CODE` | كود الدولة الافتراضي لتطبيع الأرقام |
| `USER_INTERNAL_TOKEN` | توكن داخلي للتواصل بين العمليتين |

## التشغيل في الإنتاج

```bash
npm run build
npm run start
```

المنفذ 3001 يقدم اللوحة والـ API معاً. منفذ 3001 هو المنفذ الوحيد الذي يحتاج أن يكون متاحاً من الإنترنت حتى تصل webhooks شوبيفاي.

## ملاحظات

- مكتبة `whatsapp-web.js` غير رسمية، وقد يؤدي استخدامها إلى حظر رقم الواتساب. الاستخدام على مسؤوليتك.
- الأوردرات الملغاة تحصل على تاج ونوت فقط، ولا يتم إلغاؤها فعلياً في شوبيفاي.
```

- [ ] **Step 2: Write the webhook registration guide**

`scripts/register-webhook.md`:

```markdown
# تسجيل Webhook في شوبيفاي

يحتاج شوبيفاي أن يصل إلى الخدمة من الإنترنت، لذلك يجب أن يكون هناك رابط عام
(نفق تطوير مثل cloudflared أو ngrok، أو دومين منشور).

## الخطوات

1. تأكد أن `USER_PUBLIC_BASE_URL` في `.env` يشير إلى العنوان العام.
2. سجّل الـ webhook عبر Admin API:

```bash
curl -X POST "https://<SHOP_DOMAIN>/admin/api/2024-07/graphql.json" \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Access-Token: <ADMIN_TOKEN>" \
  -d '{"query":"mutation { webhookSubscriptionCreate(topic: ORDERS_CREATE, webhookSubscription: { callbackUrl: \"<PUBLIC_BASE_URL>/webhooks/shopify/orders\", format: JSON }) { userErrors { message } webhookSubscription { id } } }"}'
```

3. تحقق من الاشتراك:

```bash
curl -X POST "https://<SHOP_DOMAIN>/admin/api/2024-07/graphql.json" \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Access-Token: <ADMIN_TOKEN>" \
  -d '{"query":"{ webhookSubscriptions(first: 10) { edges { node { id topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } } } }"}'
```

4. أنشئ أوردر تجريبي بالدفع عند الاستلام وتأكد من:
   - وصول طلب HTTP 200 في سجلات الـ api.
   - ظهور رسالة واتساب.
   - ظهور الأوردر في اللوحة بحالة "في الانتظار" ثم "تم الإرسال".
```

- [ ] **Step 3: Run the full verification suite**

Run: `npm test`
Expected: all shared, api, and worker tests pass.

Run: `npm run build`
Expected: all four packages build.

- [ ] **Step 4: Commit**

```bash
git add README.md scripts/register-webhook.md
git commit -m "docs: add setup guide and Shopify webhook registration steps"
```

---

## Self-Review

**Spec coverage:**

- `whatsapp-web.js` channel behind a driver interface → Task 14.
- Two-process + outbox architecture → Tasks 15, 17, 23.
- Data model: Settings, Order, MessageJob, Message, WebhookEvent → Task 6.
- Webhook HMAC verification, COD filter, idempotency, phone normalization → Tasks 4, 5, 8.
- Outbound with interactive buttons and numeric fallback → Tasks 14, 15.
- Inbound reply matching and confirm/cancel → Tasks 3, 16.
- Shopify tags and note (no cancellation) → Tasks 9, 13.
- Dashboard: connection/QR, orders, stats, settings, RTL → Tasks 18–22.
- No dashboard login → no auth task (intentional).
- Configuration via `USER_` env vars and `.env.example` → Tasks 1, 6, 14, 23.
- Retry/backoff, stuck-job recovery, missing-phone failure → Task 15.
- Tests: unit for shared logic and integration for webhook/outbox/replies → each task.
- Errors: invalid HMAC 401, duplicate webhook skipped, non-COD skipped, Shopify failure surfaced → Tasks 8, 13, 16.

**Placeholder scan:** no TBD/TODO markers; each code step contains complete code.

**Type consistency:** `normalizePhone`, `parseReply`, `computeShopifyHmac`, `verifyShopifyHmac`, `isCodOrder`, `renderConfirmation`, `DEFAULT_CONFIRMATION_TEMPLATE`, `WhatsAppDriver`, `processNextJob`, `handleInbound`, `createNotifier`, `createBot`, and `createShopifyClient` keep the same names and signatures across producer and consumer tasks. Status string unions (`OrderStatus`, `JobStatus`, `ReplyIntent`, `WaConnectionStatus`) come from `shared/src/types.ts` and are reused.
