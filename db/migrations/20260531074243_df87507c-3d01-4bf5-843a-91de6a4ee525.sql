WITH page AS (
  SELECT id FROM public.cms_pages WHERE slug = 'documentation'
)
INSERT INTO public.cms_page_blocks (page_id, block_type, sort_order, is_visible, config, translations)
SELECT page.id, 'text', 70, true,
  jsonb_build_object(
    'anchor', 'online-ordering-storefront',
    'subtitle', 'User Guides · Online Ordering',
    'title', 'Online Ordering Storefront',
    'body',
'Every restaurant gets a hosted ordering page at **/order/<restaurant_id>** with your branding.

## What customers see
- Live menu pulled directly from your catalogue — sold-out items are dimmed automatically.
- Delivery or pickup selection.
- Live delivery fee based on subtotal (see Tiered Delivery Fees).
- Prep time and minimum order amount.

## What you control
All controls live in **Online Orders → Settings** (`/online-order-settings`):
- **Accepting orders** master toggle.
- **Storefront message** shown when paused.
- **Prep time** in minutes.
- **Minimum order amount**.
- **Delivery fee** (flat fallback) and **delivery fee tiers**.
- **Rider commission %** (internal).

Changes apply instantly — no redeploy needed.'
  ),
  jsonb_build_object(
    'ar', jsonb_build_object(
      'subtitle', 'أدلة الاستخدام · الطلب الإلكتروني',
      'title', 'واجهة الطلب الإلكتروني',
      'body',
'يحصل كل مطعم على صفحة طلب مستضافة على **/order/<restaurant_id>** بهويتك البصرية.

## ما يراه العملاء
- قائمة حية مأخوذة مباشرة من قائمتك — الأصناف غير المتوفرة تظهر معتمة تلقائياً.
- اختيار التوصيل أو الاستلام.
- رسوم توصيل مباشرة حسب المجموع (انظر رسوم التوصيل المتدرجة).
- وقت التحضير والحد الأدنى للطلب.

## ما تتحكم به أنت
كل الإعدادات في **الطلبات الإلكترونية ← الإعدادات** (`/online-order-settings`):
- زر **استقبال الطلبات** الرئيسي.
- **رسالة الواجهة** عند الإيقاف المؤقت.
- **وقت التحضير** بالدقائق.
- **الحد الأدنى للطلب**.
- **رسوم التوصيل** (الاحتياطية الثابتة) و**شرائح رسوم التوصيل**.
- **نسبة عمولة السائق** (داخلية).

التغييرات تسري فوراً — لا حاجة لإعادة نشر.'
    )
  )
FROM page

UNION ALL

SELECT page.id, 'text', 71, true,
  jsonb_build_object(
    'anchor', 'kiosk-self-ordering',
    'subtitle', 'User Guides · Kiosk',
    'title', 'In-store Self-Ordering Kiosk',
    'body',
'Turn any tablet into a branded self-ordering kiosk at **/kiosk**.

## What it does
- Renders the same live menu as your online storefront.
- Lets customers choose dine-in or takeaway.
- Captures full order details (items, variants, modifiers, totals).
- Drops the order into the same pipeline as online orders, so it appears on the Kitchen Display.

## Setup
1. Open `/kiosk` on the tablet and put the browser in full-screen / guided-access mode.
2. The kiosk is locked to the ordering flow — no other navigation is exposed.
3. Orders are written to `online_orders` with the kiosk channel so staff can identify them on the board.

## Tips
- Use a dedicated tablet per kiosk station.
- Pair with a thermal printer if you want printed tickets in addition to the Kitchen Display.'
  ),
  jsonb_build_object(
    'ar', jsonb_build_object(
      'subtitle', 'أدلة الاستخدام · الكشك',
      'title', 'كشك الطلب الذاتي داخل المطعم',
      'body',
'حوّل أي تابلت إلى كشك طلب ذاتي يحمل علامتك التجارية على **/kiosk**.

## ما يفعله
- يعرض نفس القائمة الحية لواجهتك الإلكترونية.
- يتيح للعملاء اختيار الأكل في المطعم أو السفري.
- يلتقط تفاصيل الطلب كاملة (الأصناف، الخيارات، الإضافات، الإجمالي).
- يدفع الطلب في نفس مسار الطلبات الإلكترونية ليظهر على شاشة المطبخ.

## الإعداد
1. افتح `/kiosk` على التابلت وضع المتصفح في وضع ملء الشاشة / الوصول الموجّه.
2. الكشك مقفول على مسار الطلب — لا تظهر أي وسائل تنقل أخرى.
3. تُكتب الطلبات في `online_orders` بقناة الكشك ليتمكن الموظفون من تمييزها على اللوحة.

## نصائح
- استخدم تابلت مخصص لكل محطة كشك.
- يمكنك إقرانه بطابعة حرارية إذا أردت تذاكر مطبوعة بجانب شاشة المطبخ.'
    )
  )
FROM page

UNION ALL

SELECT page.id, 'text', 72, true,
  jsonb_build_object(
    'anchor', 'order-manager',
    'subtitle', 'User Guides · Operations',
    'title', 'Order Manager / Kitchen Display',
    'body',
'The Order Manager at **/order-manager** is a real-time Kanban board for every kiosk and online order.

## Lanes
1. **Pending** — newly received, not yet acknowledged.
2. **Confirmed** — accepted by staff.
3. **Preparing** — kitchen has started.
4. **Ready** — handed to customer or rider.

## On each card
- Channel badge (kiosk / online).
- Customer name, phone, and delivery address (if applicable).
- Line items with variants and modifiers.
- Subtotal, delivery fee, and total.
- Timestamps so you can spot slow tickets.

## Workflow
- Move cards forward as the order progresses.
- The board updates in real time across all devices.
- Use it on a wall-mounted screen in the kitchen for hands-free ticket flow.'
  ),
  jsonb_build_object(
    'ar', jsonb_build_object(
      'subtitle', 'أدلة الاستخدام · العمليات',
      'title', 'مدير الطلبات / شاشة المطبخ',
      'body',
'مدير الطلبات على **/order-manager** هو لوحة كانبان فورية لكل طلبات الكشك والطلبات الإلكترونية.

## المسارات
1. **قيد الانتظار** — وصل حديثاً ولم يُؤكد بعد.
2. **مؤكد** — قبله الموظف.
3. **قيد التحضير** — بدأ المطبخ بإعداده.
4. **جاهز** — سُلّم للعميل أو السائق.

## على كل بطاقة
- شارة القناة (كشك / إلكتروني).
- اسم العميل وهاتفه وعنوان التوصيل إن وجد.
- بنود الطلب مع الخيارات والإضافات.
- المجموع الفرعي ورسوم التوصيل والإجمالي.
- الطوابع الزمنية لرصد التذاكر البطيئة.

## سير العمل
- حرّك البطاقات إلى الأمام مع تقدم الطلب.
- اللوحة تتحدث فورياً على كل الأجهزة.
- استخدمها على شاشة معلقة في المطبخ لتدفق تذاكر بدون استخدام اليد.'
    )
  )
FROM page

UNION ALL

SELECT page.id, 'text', 73, true,
  jsonb_build_object(
    'anchor', 'tiered-delivery-fees',
    'subtitle', 'User Guides · Online Ordering',
    'title', 'Tiered Delivery Fees & Rider Commission',
    'body',
'Configure how much customers pay for delivery, and how much of that goes to the rider — all from **Online Orders → Settings**.

## Tiered delivery fees
Define a table of subtotal ranges and the fee that applies in each:

| Subtotal range | Fee |
| -------------- | --- |
| 0 – 50         | 15  |
| 50 – 100       | 10  |
| 100+           | 0   |

At checkout the storefront picks the first tier where `subtotal` falls within the range. If no tier matches, the **flat delivery fee** is used as a fallback.

Scope: **delivery only**. Pickup orders never see a delivery fee.

## Rider commission (HungerStation / Jahez / Mrsool style)
`Rider commission %` is an **internal** cut of the delivery fee that represents the rider''s payout.

- It does **not** increase the customer total.
- Every delivery order stores its own `rider_commission` so historical orders are stable.
- `delivery_fee − rider_commission = restaurant net delivery revenue`, used for payout reconciliation.

## Live preview
The settings page shows what the fee would be at 25, 60, 120, and 250 subtotals so you can sanity-check your tiers before saving.'
  ),
  jsonb_build_object(
    'ar', jsonb_build_object(
      'subtitle', 'أدلة الاستخدام · الطلب الإلكتروني',
      'title', 'رسوم التوصيل المتدرجة وعمولة السائق',
      'body',
'اضبط كم يدفع العميل مقابل التوصيل، وكم يذهب من ذلك للسائق — كل ذلك من **الطلبات الإلكترونية ← الإعدادات**.

## رسوم التوصيل المتدرجة
عرّف جدولاً من شرائح المجموع والرسم المناسب لكل شريحة:

| شريحة المجموع | الرسم |
| ------------- | ----- |
| 0 – 50        | 15    |
| 50 – 100      | 10    |
| 100+          | 0     |

عند الدفع تختار الواجهة أول شريحة يقع المجموع ضمنها. إذا لم تنطبق أي شريحة، تُستخدم **رسوم التوصيل الثابتة** كاحتياط.

النطاق: **التوصيل فقط**. طلبات الاستلام لا تظهر فيها رسوم توصيل أبداً.

## عمولة السائق (بأسلوب هنقرستيشن / جاهز / مرسول)
`نسبة عمولة السائق` هي حصة **داخلية** من رسوم التوصيل تمثل مستحقات السائق.

- لا تزيد إجمالي العميل.
- كل طلب توصيل يحفظ `rider_commission` خاصاً به فتبقى الطلبات السابقة مستقرة.
- `رسوم التوصيل − عمولة السائق = صافي دخل التوصيل للمطعم`، يُستخدم لتسوية المستحقات.

## معاينة مباشرة
تعرض صفحة الإعدادات الرسم عند 25 و60 و120 و250 من المجموع حتى تتأكد من شرائحك قبل الحفظ.'
    )
  )
FROM page;

UPDATE public.cms_page_blocks
SET config = jsonb_set(
  config,
  '{cards}',
  (config->'cards') || jsonb_build_array(
    jsonb_build_object('url', '#online-ordering-storefront', 'icon', 'FileText', 'title', 'Online ordering storefront & settings'),
    jsonb_build_object('url', '#kiosk-self-ordering',       'icon', 'FileText', 'title', 'In-store self-ordering kiosk'),
    jsonb_build_object('url', '#order-manager',             'icon', 'FileText', 'title', 'Order Manager / Kitchen Display'),
    jsonb_build_object('url', '#tiered-delivery-fees',      'icon', 'FileText', 'title', 'Tiered delivery fees & rider commission')
  )
)
WHERE page_id = (SELECT id FROM public.cms_pages WHERE slug = 'documentation')
  AND sort_order = 3
  AND block_type = 'cards';