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

## النشر على Render

الملفات الجاهزة للنشر: `Dockerfile` و`.dockerignore` و`render.yaml` و`scripts/render-start.sh`.

يتم تشغيل الـ api والـ worker معاً داخل خدمة واحدة (Docker Web Service)، مع قرص دائم
على المسار `/data` يخزّن قاعدة SQLite وجلسة واتساب. سبب استخدام Docker أن مكتبة
`whatsapp-web.js` تحتاج Chromium ومكتبات نظام لا يمكن تثبيتها على بيئة Node الأصلية في Render.

### الخطوات

1. ارفع المستودع إلى GitHub أو GitLab، ثم من Render اختر New ثم Blueprint وحدّد المستودع.
2. سيقوم Render بقراءة `render.yaml` وإنشاء الخدمة والقرص. القرص يتطلب خطة مدفوعة.
3. املأ المتغيرات السرية عند الطلب:

| المتغير | القيمة |
| --- | --- |
| `USER_SHOPIFY_SHOP_DOMAIN` | دومين المتجر |
| `USER_SHOPIFY_ADMIN_TOKEN` | توكن Admin API |
| `USER_SHOPIFY_WEBHOOK_SECRET` | الـ API secret |
| `USER_PUBLIC_BASE_URL` | `https://<service-name>.onrender.com` بعد أول نشر |

المتغيرات `DATABASE_URL` و`USER_WHATSAPP_SESSION_PATH` و`USER_DEFAULT_COUNTRY_CODE`
و`USER_WORKER_PORT` و`PUPPETEER_EXECUTABLE_PATH` مضبوطة مسبقاً في `render.yaml`،
والـ `USER_INTERNAL_TOKEN` يتم توليده تلقائياً.

4. بعد أول نشر انسخ رابط الخدمة من لوحة Render وضعه في `USER_PUBLIC_BASE_URL`.
5. سجّل الـ webhook على الرابط العام: راجع `scripts/register-webhook.md`.
6. افتح رابط الخدمة، ومن صفحة الاتصال امسح رمز QR بواتساب. الجلسة تُحفظ على القرص فلا تحتاج لمسحه مرة أخرى.
7. أرسل أوردر تجريبي بالدفع عند الاستلام للتأكد من وصول الرسالة.

### ملاحظات التشغيل

- الخطة الافتراضية في `render.yaml` هي `standard` لأن Chromium يحتاج ذاكرة كافية. الخطة `starter` قد تنفد ذاكرتها أثناء التشغيل.
- المنفذ الوحيد المطلوب للإنترنت هو منفذ الخدمة؛ يعمل الـ worker على منفذ داخلي منفصل.
- عند إعادة النشر تُحفظ قاعدة البيانات والجلسة على القرص، لذا لا تفقد البيانات.
- عند أول تشغيل يتم إنشاء جداول قاعدة البيانات تلقائياً عبر `prisma db push` داخل سكربت البدء.

## ملاحظات

- مكتبة `whatsapp-web.js` غير رسمية، وقد يؤدي استخدامها إلى حظر رقم الواتساب. الاستخدام على مسؤوليتك.
- الأوردرات الملغاة تحصل على تاج ونوت فقط، ولا يتم إلغاؤها فعلياً في شوبيفاي.
