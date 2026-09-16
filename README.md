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
| `USER_API_PORT` | منفذ الـ api (افتراضي 3001) |
| `USER_WORKER_PORT` | منفذ الـ worker (افتراضي 3002) |
| `USER_INTERNAL_TOKEN` | توكن داخلي للتواصل بين العمليتين |
| `USER_WORKER_URL` | عنوان الـ worker الذي يستدعيه الـ api |
| `USER_PUBLIC_BASE_URL` | العنوان العام للـ api المستخدم لتسجيل الـ webhook |

## التشغيل في الإنتاج

```bash
npm run build

# تشغيل الـ api
npm run start

# تشغيل الـ worker في طرفية أخرى
npm run start -w worker
```

يجب تشغيل العمليتين معاً في الإنتاج: الـ api والـ worker. يمكن تشغيلهما بأمر واحد عبر
`concurrently "npm run start" "npm run start -w worker"` أو في طرفيتين منفصلتين كما هو موضح أعلاه.

المنفذ 3001 يقدم اللوحة والـ API معاً. منفذ 3001 هو المنفذ الوحيد الذي يحتاج أن يكون متاحاً من الإنترنت حتى تصل webhooks شوبيفاي.

## النشر على Fly.io

ملفات النشر: `Dockerfile` و`.dockerignore` و`fly.toml` و`scripts/docker-start.sh`.

يتم تشغيل الـ api والـ worker معاً داخل جهاز واحد، مع Fly Volume على المسار `/data`
يخزّن قاعدة SQLite وجلسة واتساب. سبب استخدام Docker أن مكتبة `whatsapp-web.js`
تحتاج Chromium ومكتبات نظام غير متوفرة في بيئات التشغيل المعزولة.

### المتطلبات

- حساب على Fly.io و`flyctl` مثبّت.
- بطاقة دفع (الـ Volume والجهاز الدائم يتطلبان حساباً مدفوعاً).

### الخطوات

1. تسجيل الدخول:

```bash
fly auth login
```

2. إنشاء التطبيق. غيّر `app` في `fly.toml` إن كان الاسم محجوزاً:

```bash
fly apps create shopify-wa-confirm
```

3. إنشاء الـ Volume في نفس المنطقة الموجودة في `fly.toml`:

```bash
fly volumes create app_data --region fra --size 1
```

4. ضبط المتغيرات السرية:

```bash
fly secrets set USER_SHOPIFY_SHOP_DOMAIN="your-store.myshopify.com" USER_SHOPIFY_ADMIN_TOKEN="shpat_xxx" USER_SHOPIFY_WEBHOOK_SECRET="xxx" USER_INTERNAL_TOKEN="$(openssl rand -hex 32)"
```

5. النشر:

```bash
fly deploy
```

6. تأكد أن جهازاً واحداً فقط يعمل، لأن رقم واتساب واحد يتحمل جلسة واحدة:

```bash
fly scale count 1
```

7. بعد نجاح النشر سيظهر رابط مثل `https://shopify-wa-confirm.fly.dev`. اضبطه كعنوان عام:

```bash
fly secrets set USER_PUBLIC_BASE_URL="https://shopify-wa-confirm.fly.dev"
```

8. افتح الرابط، ومن صفحة الاتصال امسح رمز QR بواتساب. الجلسة تُحفظ على الـ Volume.
9. سجّل الـ webhook على الرابط العام: راجع `scripts/register-webhook.md`.
10. أرسل أوردر تجريبي بالدفع عند الاستلام للتأكد من وصول الرسالة.

### ملاحظات التشغيل

- الجهاز يعمل باستمرار (`auto_stop_machines = false`) لأن واتساب يحتاج اتصالاً دائماً. إيقاف الجهاز يفصل الجلسة.
- الذاكرة الافتراضية في `fly.toml` هي 1GB. لو ظهر خطأ نفاد ذاكرة بسبب Chromium، ارفعها إلى 2GB من قسم `[[vm]]`.
- المنفذ العام الوحيد هو 3001؛ الـ worker يعمل على منفذ داخلي منفصل.
- عند إعادة النشر تُحفظ قاعدة البيانات وجلسة واتساب على الـ Volume.
- جداول قاعدة البيانات تُنشأ تلقائياً عند كل تشغيل عبر `prisma db push` داخل `scripts/docker-start.sh`.
- لمراجعة السجلات:

```bash
fly logs
```

## ملاحظات

- مكتبة `whatsapp-web.js` غير رسمية، وقد يؤدي استخدامها إلى حظر رقم الواتساب. الاستخدام على مسؤوليتك.
- الأوردرات الملغاة تحصل على تاج ونوت فقط، ولا يتم إلغاؤها فعلياً في شوبيفاي.
