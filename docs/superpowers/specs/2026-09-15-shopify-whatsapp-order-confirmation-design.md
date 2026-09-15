# Shopify WhatsApp Order Confirmation — Design

Date: 2026-09-15
Status: Approved (pending implementation plan)

## 1. Purpose

An internal tool for a single Shopify store that automatically confirms
Cash-on-Delivery (COD) orders over WhatsApp. When a COD order is created,
the customer receives a WhatsApp message with the order details and a
request to confirm or cancel. The customer's reply is reflected back on
the Shopify order as tags and notes.

Success criteria:

- Every new COD order produces exactly one outbound confirmation message.
- A reply of `1` / `confirm` / "تأكيد" marks the order confirmed; a reply of
  `2` / `cancel` / "إلغاء" marks it cancelled.
- Confirmation state is visible on the Shopify order as a tag plus a note.
- No message is lost if WhatsApp disconnects or the process restarts.

## 2. Non-Goals (MVP)

- Multi-tenant / multiple stores.
- Reminder and follow-up message sequences.
- Address or delivery-time changes.
- Automatic order cancellation or fulfillment.
- Dashboard authentication.
- Categories of orders other than COD.

## 3. Delivery / Messaging Channel

WhatsApp via the unofficial library `whatsapp-web.js` (Puppeteer + headless
Chromium), authenticated by scanning a QR code with a phone number.

Accepted risk: unofficial libraries violate Meta's terms of service and the
number can be banned. This is an accepted trade-off for the MVP and a
WhatsApp Cloud API driver may replace it later.

The messaging layer is defined behind a `WhatsAppDriver` interface so a
future official-API driver can be added without touching order logic.

## 4. Architecture

Monorepo with two runnable processes and one shared package.

```
shopify-wa-confirm/
├── api/          Express + Prisma (Shopify webhooks + REST + serves dashboard build)
├── worker/       whatsapp-web.js (Puppeteer) + outbox processor + reply listener
├── dashboard/    React + Vite + Tailwind (Arabic RTL)
├── shared/       Types + shared logic (phone normalization, reply parsing, HMAC)
└── .env.example
```

### Processes

- `api` listens on port 3001. Handles HTTP: Shopify webhooks, dashboard REST
  API, and serves the built dashboard. It is the port exposed for preview.
- `worker` has no public port (internal health endpoint on 3002). Owns the
  WhatsApp client, the outbox loop, and the inbound reply handler.

### Why two processes + an outbox

The chat client (Puppeteer/Chromium) is the least stable part of the system.
Separating it from the HTTP process means:

- A paused QR session, a Chromium crash, or a re-login never blocks webhook
  ingestion or the dashboard.
- Every outbound message is persisted before being sent, so a restart while
  offline cannot lose an order confirmation.
- Retries are explicit and observable.

Both processes are launched by a single `npm run dev` (concurrently) and by a
single `npm start` in production.

## 5. Data Model (SQLite via Prisma)

- `Settings` — single row. `shopDomain`, `adminAccessToken`,
  `webhookSecret`, `messageTemplate`, `interactiveButtonsEnabled`,
  `reminderEnabled` (reserved, unused in MVP).
- `Order` — `shopifyOrderId` (unique), `orderNumber`, `customerName`,
  `phone` (E.164), `total`, `currency`, `financialStatus`,
  `paymentGateway`, `status` (`pending | sent | confirmed | cancelled | failed`),
  `sentAt`, `confirmedAt`, `cancelledAt`, `createdAt`.
- `MessageJob` — `orderId`, `type` (`confirmation`), `status`
  (`pending | processing | sent | failed`), `attempts`, `lastError`,
  `scheduledAt`, `createdAt`, `updatedAt`.
- `Message` — `orderId`, `direction` (`out | in`), `body`,
  `waMessageId`, `createdAt`.
- `WebhookEvent` — `topic`, `shopifyOrderId`, `receivedAt`. Used for
  idempotency so a retried Shopify webhook does not create a duplicate order
  or a second message.

Phone numbers are normalized to E.164 before storage and matching.

## 6. Flow

### 6.1 Inbound order webhook

1. Shopify sends `orders/create` to `POST /webhooks/shopify/orders`.
2. `api` verifies the HMAC-SHA256 signature using `webhookSecret`.
3. If the order is not COD (payment gateway is not cash-on-delivery /
   manual), it is ignored.
4. `api` writes a `WebhookEvent` to deduplicate by order id.
5. `api` normalizes the phone number and upserts the `Order` with
   `status = pending`.
6. `api` creates a `MessageJob` with `status = pending`.

### 6.2 Outbound confirmation

1. The worker polls the outbox for the oldest `pending` job whose
   `scheduledAt` is due.
2. It marks the job `processing`, renders the message from the template
   (order number, name, total), and sends via the driver.
3. If interactive buttons are enabled, it first attempts an
   interactive button message (Confirm / Cancel). If that send fails, it
   falls back to a plain text message that asks the customer to reply with
   `1` for confirm or `2` for cancel.
4. On success: job becomes `sent`, the order becomes `sent`, and a `Message`
   row is recorded.
5. On failure: attempts increment, `lastError` is stored, and the job is
   rescheduled with backoff until a max attempt count, then becomes `failed`.

### 6.3 Inbound reply

1. The worker listens for incoming WhatsApp messages.
2. The sender number is normalized and matched to the most recent order with
   status `sent`.
3. The body is parsed using the shared reply parser: `1` / `confirm` / `تأكيد`
   → confirmed; `2` / `cancel` / `إلغاء` → cancelled. Unrecognized replies
   are recorded and ignored.
4. Confirmed: order becomes `confirmed`, Shopify gets tag
   `confirmed-by-whatsapp` and a note with the timestamp.
5. Cancelled: order becomes `cancelled`, Shopify gets tag
   `cancelled-by-whatsapp` and a note with the timestamp. The order is not
   actually cancelled.

### 6.4 Shopify update

`api` exposes the only Shopify Admin API client (GraphQL). The worker calls
`api`'s internal endpoint to apply the tag and note, so the access token
lives in one process and one place.

## 7. Dashboard

React + Vite + Tailwind, Arabic RTL, served under `/` by `api` with the REST
API under `/api`. Vite dev server proxies `/api` to `api:3001` so a single
exposed port works.

Screens:

- **Connection** — live WhatsApp status, QR code when disconnected, number
  once connected, reconnect action.
- **Orders** — table with status, customer, phone, total, timestamps;
  filter by status, search by phone or order number; manual "resend" action
  per row.
- **Statistics** — totals (all / sent / confirmed / cancelled / failed) and
  a confirmation rate.
- **Settings** — Shopify domain, access token, webhook secret, message
  template, interactive-buttons toggle.

No login.

## 8. Configuration

All secrets and environment-specific values come from `.env`
(`.env.example` ships placeholders). Variable names use a `USER_` prefix and
are never populated by the agent from the execution environment:

- `USER_SHOPIFY_SHOP_DOMAIN`
- `USER_SHOPIFY_ADMIN_TOKEN`
- `USER_SHOPIFY_WEBHOOK_SECRET`
- `USER_WHATSAPP_SESSION_PATH`
- `USER_API_PORT`, `USER_WORKER_PORT`

The dashboard-only settings (template, buttons toggle) are stored in the
`Settings` table and editable from the UI.

## 9. Error Handling

- Invalid HMAC → `401`, logged, no processing.
- Duplicate webhook → ignored via `WebhookEvent`.
- Missing/invalid phone → order stored as `failed`, visible in the dashboard.
- WhatsApp disconnected → jobs stay `pending`; the outbox pauses and resumes
  automatically after reconnect.
- Send failure → bounded retries with backoff, then `failed`.
- Shopify API failure when applying the tag/note → retried; the reply is kept
  in the dashboard so no data is lost.

## 10. Testing

- Unit: phone normalization, reply parsing, HMAC verification, template
  rendering, COD detection.
- Integration: webhook endpoint with a signed fake payload → order + job
  created; idempotent replay creates nothing new.
- Worker: a fake `WhatsAppDriver` asserts outbound content and drives a
  simulated reply end to end against a test database.
- No live WhatsApp or live Shopify calls in tests.
