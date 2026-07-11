import { Request } from "express";

/**
 * رابط التطبيق المُوثوق — نقطة واحدة لحل هذا الرابط في كل الخادم
 * (بدلاً من تكراره في pform.ts / participants.ts / scheduler.ts بمنطق مختلف
 * قليلاً في كل مكان، وهو ما كان يؤدي سابقاً إلى روابط فارغة في بعض رسائل البريد).
 *
 * ترتيب الأولوية:
 *   1. REPLIT_DOMAINS  — بيئة النشر الرسمية على Replit
 *   2. REPLIT_DEV_DOMAIN — بيئة التطوير على Replit
 *   3. APP_URL — متغير بيئة صريح لأي بيئة نشر أخرى (خارج Replit)
 *   4. (فقط إذا زوّدنا req) عنوان الطلب نفسه — حل أخير لبيئة محلية، ويُسجَّل
 *      تحذيراً بدلاً من الفشل الصامت لأن هذا العنوان قد لا يكون صالحاً للبريد
 *      الإلكتروني أو الرسائل المُرسلة خارج نطاق الطلب (كالجدولة الدورية).
 *
 * إذا تعذّر تحديد رابط موثوق تماماً، تُعاد سلسلة فارغة والاستدعاء المسؤول
 * (مثل إرسال بريد التأكيد) يجب أن يتعامل مع ذلك بشكل صريح — لا نُخفي المشكلة.
 */
export function getTrustedBaseUrl(req?: Request): string {
  const domains = process.env.REPLIT_DOMAINS?.split(",");
  if (domains?.length) return `https://${domains[0].trim()}`;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");

  if (req) {
    const host = req.get("host") || "localhost:5000";
    console.warn(
      `[getTrustedBaseUrl] لا توجد REPLIT_DOMAINS/REPLIT_DEV_DOMAIN/APP_URL — تم استخدام عنوان الطلب (${host}) كحل مؤقت. ` +
      `في بيئة نشر غير Replit، اضبط متغير البيئة APP_URL لضمان روابط صحيحة في كل مكان (بما فيها الجدولة الدورية التي لا تملك طلباً).`
    );
    return `${req.protocol}://${host}`;
  }

  console.error(
    "[getTrustedBaseUrl] تعذّر تحديد رابط أساسي موثوق (لا REPLIT_DOMAINS ولا REPLIT_DEV_DOMAIN ولا APP_URL، ولا يوجد طلب HTTP للاعتماد عليه). " +
    "أي رابط يعتمد على هذه القيمة (بريد، تيليغرام) سيُتخطى — اضبط APP_URL لحل هذا نهائياً."
  );
  return "";
}
