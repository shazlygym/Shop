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
