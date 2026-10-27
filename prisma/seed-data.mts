// Demo content. Prices are integer Toman, estimated for late 1405 (2026).
// Restaurant ids are fixed so the seed can find its own data under RLS
// (looking a restaurant up by slug needs a tenant context we don't have yet).

export type CategorySpec = {
  name: string;
  /** Relative popularity by hour of day (Tehran time); 0 = not ordered then. */
  weight: (hour: number) => number;
  /** Notes staff typically type for items in this category. */
  notes: string[];
  items: { name: string; price: number; available?: boolean }[];
};

export type StaffSpec = {
  name: string;
  phone: string;
  pin: string;
  role: "MANAGER" | "STAFF" | "KITCHEN";
};

export type RestaurantSpec = {
  id: string;
  name: string;
  slug: string;
  vatRateBp: number;
  serviceChargeBp: number;
  branchName: string;
  tables: { label: string; seats: number }[];
  staff: StaffSpec[];
  categories: CategorySpec[];
  /** Hours open (Tehran), and how busy each hour is relative to the others. */
  hourWeights: Record<number, number>;
  /** Expected orders on a normal day; Thursday and Friday scale this up. */
  ordersPerDay: number;
  historyDays: number;
  takeawayShare: number;
};

const COFFEE_NOTES = ["بدون شکر", "کم‌شیرین", "شیر بادام", "شات اضافه", "داغ داغ", "شیر کم‌چرب"];
const COLD_NOTES = ["یخ کم", "بدون یخ", "کم‌شیرین"];
const FOOD_NOTES = ["سس جدا", "بدون پیاز", "کمی تند", "نان اضافه", "بدون گوجه"];
const DESSERT_NOTES = ["گرم شود", "با بستنی", "دو قاشق"];

export const NARENJ: RestaurantSpec = {
  id: "c0ffee00-0000-4000-8000-000000000001",
  name: "کافه نارنج",
  slug: "cafe-narenj",
  vatRateBp: 1000, // 10% — to be confirmed for 1405
  serviceChargeBp: 0, // most small cafés don't charge حق سرویس
  branchName: "شعبه خیابان زند، شیراز",
  tables: Array.from({ length: 10 }, (_, i) => ({
    label: String(i + 1),
    seats: [2, 2, 4, 4, 4, 2, 6, 4, 2, 8][i]!,
  })),
  staff: [
    { name: "مریم کاظمی", phone: "09170000001", pin: "1234", role: "MANAGER" },
    { name: "علی رضایی", phone: "09170000002", pin: "1111", role: "STAFF" },
    { name: "سارا احمدی", phone: "09170000003", pin: "2222", role: "STAFF" },
    { name: "حسین محمدی", phone: "09170000004", pin: "3333", role: "STAFF" },
    { name: "نرگس حسینی", phone: "09170000005", pin: "4444", role: "KITCHEN" },
  ],
  hourWeights: {
    8: 3, 9: 5, 10: 5, 11: 4, 12: 4, 13: 5, 14: 4, 15: 3,
    16: 4, 17: 6, 18: 7, 19: 8, 20: 8, 21: 6, 22: 3,
  },
  ordersPerDay: 28,
  historyDays: 6, // today plus the six days before: one full week
  takeawayShare: 0.12,
  categories: [
    {
      name: "نوشیدنی گرم",
      weight: () => 4,
      notes: COFFEE_NOTES,
      items: [
        { name: "اسپرسو", price: 120_000 },
        { name: "آمریکانو", price: 130_000 },
        { name: "کاپوچینو", price: 165_000 },
        { name: "لاته", price: 175_000 },
        { name: "موکا", price: 195_000 },
        { name: "قهوه ترک", price: 140_000 },
        { name: "چای ایرانی (قوری دونفره)", price: 110_000 },
        { name: "چای ماسالا", price: 160_000 },
        { name: "دمنوش به‌لیمو و نعناع", price: 120_000 },
        { name: "دمنوش گل‌گاوزبان", price: 130_000 },
        { name: "هات چاکلت", price: 180_000, available: false },
      ],
    },
    {
      name: "نوشیدنی سرد",
      weight: (h) => (h >= 12 ? 3 : 1),
      notes: COLD_NOTES,
      items: [
        { name: "آیس آمریکانو", price: 145_000 },
        { name: "آیس لاته", price: 190_000 },
        { name: "شربت بهارنارنج", price: 140_000 },
        { name: "لیموناد", price: 150_000 },
        { name: "موهیتو (بدون الکل)", price: 175_000 },
        { name: "شیک شکلات", price: 230_000 },
        { name: "شیک وانیل", price: 220_000, available: false },
      ],
    },
    {
      name: "کیک و دسر",
      weight: (h) => (h >= 15 ? 2 : 0.5),
      notes: DESSERT_NOTES,
      items: [
        { name: "چیزکیک نیویورکی", price: 210_000 },
        { name: "کیک شکلاتی", price: 180_000 },
        { name: "کیک هویج", price: 170_000, available: false },
        { name: "براونی", price: 150_000 },
        { name: "فالوده شیرازی", price: 130_000 },
        { name: "بستنی سنتی زعفرانی", price: 140_000 },
      ],
    },
    {
      name: "صبحانه",
      weight: (h) => (h < 12 ? 3 : h === 12 ? 1 : 0),
      notes: FOOD_NOTES,
      items: [
        { name: "صبحانه ایرانی (نان، پنیر، گردو، سبزی)", price: 280_000 },
        { name: "املت", price: 190_000 },
        { name: "نیمرو", price: 160_000 },
        { name: "پنکیک با عسل", price: 230_000 },
        { name: "کره و مربای هویج", price: 140_000 },
      ],
    },
    {
      name: "غذای سبک",
      weight: (h) => (h < 11 ? 0 : h <= 15 ? 3 : h >= 19 ? 2 : 0.5),
      notes: FOOD_NOTES,
      items: [
        { name: "ساندویچ مرغ گریل", price: 320_000 },
        { name: "کلاب ساندویچ", price: 360_000 },
        { name: "سالاد سزار", price: 340_000 },
        { name: "پاستا آلفردو", price: 390_000, available: false },
        { name: "سیب‌زمینی سرخ‌کرده", price: 170_000 },
      ],
    },
  ],
};

// Small second tenant in another city; exists to demonstrate isolation.
export const KUCHEH: RestaurantSpec = {
  id: "7e4a0000-0000-4000-8000-000000000002",
  name: "رستوران کوچه",
  slug: "kucheh",
  vatRateBp: 1000,
  serviceChargeBp: 1000, // 10% حق سرویس, common for sit-down restaurants
  branchName: "شعبه یوسف‌آباد، تهران",
  tables: Array.from({ length: 6 }, (_, i) => ({ label: String(i + 1), seats: 4 })),
  staff: [
    { name: "رضا موسوی", phone: "09120000001", pin: "5555", role: "MANAGER" },
    { name: "فاطمه کریمی", phone: "09120000002", pin: "6666", role: "STAFF" },
    { name: "محمد جعفری", phone: "09120000003", pin: "7777", role: "KITCHEN" },
  ],
  hourWeights: { 12: 5, 13: 8, 14: 6, 15: 2, 19: 3, 20: 6, 21: 7, 22: 4 },
  ordersPerDay: 12,
  historyDays: 3,
  takeawayShare: 0.15,
  categories: [
    {
      name: "غذای اصلی",
      weight: () => 4,
      notes: FOOD_NOTES,
      items: [
        { name: "کباب کوبیده (دو سیخ)", price: 450_000 },
        { name: "جوجه کباب", price: 480_000 },
        { name: "زرشک‌پلو با مرغ", price: 460_000 },
        { name: "قورمه‌سبزی", price: 420_000 },
        { name: "دیزی سنگی", price: 520_000, available: false },
      ],
    },
    {
      name: "پیش‌غذا",
      weight: () => 2,
      notes: [],
      items: [
        { name: "سالاد شیرازی", price: 90_000 },
        { name: "ماست و خیار", price: 85_000 },
        { name: "زیتون پرورده", price: 120_000 },
      ],
    },
    {
      name: "نوشیدنی",
      weight: () => 3,
      notes: ["خنک", "بدون یخ"],
      items: [
        { name: "دوغ محلی", price: 60_000 },
        { name: "نوشابه", price: 45_000 },
        { name: "آب معدنی", price: 25_000 },
      ],
    },
  ],
};

export const DEMO_RESTAURANTS = [NARENJ, KUCHEH];

export const VOID_REASONS = [
  "مشتری منصرف شد",
  "اشتباه در ثبت سفارش",
  "تأخیر زیاد آشپزخانه",
  "مواد اولیه تمام شد",
];

export const DISCOUNTS = [
  { type: "PERCENT", value: 1000, reason: "مشتری دائمی" },
  { type: "PERCENT", value: 1500, reason: "تولد مهمان" },
  { type: "AMOUNT", value: 50_000, reason: "تأخیر در سرو سفارش" },
  { type: "AMOUNT", value: 100_000, reason: "جبران اشتباه در سفارش" },
  { type: "PERCENT", value: 2000, reason: "تخفیف همکار" },
] as const;
