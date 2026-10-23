// 仕分けの項目（0034 の4）。言葉は日本FP協会の家計の分け方（基本生活費の内訳・住居関連費・車両費・教育費・保険料・その他の支出・一時的支出）と、
// アプリの既存の言葉（入力の「基本生活費」の内訳 LivingCategory、一時的支出の行）に合わせる。
// 計算に使う先: 基本生活費の内訳の項目だけが「基本生活費の月平均」の候補になる。住居・教育・保険・車・税は、それぞれの入力の欄で入れるので参考の値として出す

/** 仕分けの項目 */
export type StatementCategory =
  | "food"
  | "dailyGoods"
  | "utilities"
  | "communication"
  | "transport"
  | "medical"
  | "clothing"
  | "furniture"
  | "recreation"
  | "allowance"
  | "social"
  | "otherLiving"
  | "cash"
  | "housing"
  | "education"
  | "insurance"
  | "car"
  | "tax"
  | "lumpSum"
  | "cardFee"
  | "transfer"
  | "income";

/** 計算エンジンの基本生活費の内訳（engine の LivingCategory と同じ値） */
export type LivingCategory = "food" | "utilities" | "furniture" | "clothing" | "health" | "transport" | "recreation" | "otherConsumption" | "allowance";

export interface CategoryInfo {
  readonly id: StatementCategory;
  readonly label: string;
  /** 家計の分け方の大きな区分 */
  readonly group: "living" | "housing" | "education" | "insurance" | "car" | "tax" | "oneOff" | "transfer" | "income";
  /** 基本生活費の内訳のどれに入れるか（基本生活費でない項目は無し） */
  readonly living?: LivingCategory;
  /** 季節で変わる（取り込んだ期間が12か月に満たないと月平均が偏る） */
  readonly seasonal?: true;
}

export const CATEGORIES: readonly CategoryInfo[] = [
  { id: "food", label: "食費", group: "living", living: "food" },
  { id: "dailyGoods", label: "日用品", group: "living", living: "furniture" },
  { id: "utilities", label: "水道・光熱", group: "living", living: "utilities", seasonal: true },
  { id: "communication", label: "通信", group: "living", living: "transport" },
  { id: "transport", label: "交通", group: "living", living: "transport" },
  { id: "medical", label: "医療", group: "living", living: "health" },
  { id: "clothing", label: "被服・美容", group: "living", living: "clothing" },
  { id: "furniture", label: "家具・家電", group: "living", living: "furniture" },
  { id: "recreation", label: "教養娯楽", group: "living", living: "recreation" },
  { id: "allowance", label: "こづかい", group: "living", living: "otherConsumption" },
  { id: "social", label: "交際", group: "living", living: "otherConsumption" },
  { id: "otherLiving", label: "その他の生活費", group: "living", living: "otherConsumption" },
  { id: "cash", label: "現金の引き出し", group: "living", living: "otherConsumption" },
  { id: "housing", label: "住居関連（家賃・管理費・修繕・固定資産税）", group: "housing" },
  { id: "education", label: "教育", group: "education" },
  { id: "insurance", label: "保険", group: "insurance" },
  { id: "car", label: "車（ガソリン・駐車場・車検・自動車税）", group: "car" },
  { id: "tax", label: "税・社会保険料", group: "tax" },
  { id: "lumpSum", label: "一時的な支出（旅行・冠婚葬祭・大きな買い物）", group: "oneOff" },
  { id: "cardFee", label: "カードの年会費", group: "oneOff" },
  { id: "transfer", label: "振替・カードの引き落とし", group: "transfer" },
  { id: "income", label: "収入・入金", group: "income" },
];

export const CATEGORY_IDS: readonly StatementCategory[] = CATEGORIES.map((c) => c.id);

export function categoryInfo(id: StatementCategory): CategoryInfo {
  return CATEGORIES.find((c) => c.id === id) as CategoryInfo;
}

export function isCategory(v: unknown): v is StatementCategory {
  return typeof v === "string" && (CATEGORY_IDS as readonly string[]).includes(v);
}

/** 基本生活費の内訳の言葉（アプリの入力の画面と同じ） */
export const LIVING_LABELS: Record<LivingCategory, string> = {
  food: "食費",
  utilities: "水道・光熱費",
  furniture: "家具・家事用品",
  clothing: "被服費",
  health: "保健医療費",
  transport: "交通・通信費",
  recreation: "教養娯楽費",
  otherConsumption: "その他の消費（こづかい・交際費など）",
  allowance: "仕送り",
};

export const LIVING_ORDER: readonly LivingCategory[] = ["food", "utilities", "furniture", "clothing", "health", "transport", "recreation", "otherConsumption", "allowance"];

/** 一時的支出の行（アプリの「名前を付けた支出」の行と同じ値）を項目から選ぶ */
export function periodicRowOf(c: StatementCategory, label = ""): string {
  switch (c) {
    case "car":
      return "cf.expense.lumpSum.car";
    case "social":
      return "cf.expense.lumpSum.gift";
    case "medical":
      return "cf.expense.care.medical";
    case "housing":
      return /修繕|リフォーム|工事/u.test(label) ? "cf.expense.housing.maintenance" : "cf.expense.other";
    case "lumpSum":
    case "cardFee":
    case "recreation":
    case "furniture":
      return "cf.expense.lumpSum.other";
    default:
      return "cf.expense.other";
  }
}
