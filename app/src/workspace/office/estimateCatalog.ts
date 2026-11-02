// 事務所の推定の値（0111）の一覧: マスタデータ（data/master。画面の写しは hearing/src/statistics.generated.ts）の値ID ごとの、
// 画面の名前・まとまり・数の単位・段階表の段の読み方。値の中身と出典は写し（officialMasterValue）から読む。
// 法令で決まる値（国立大学・大学院の授業料の標準額。docs/estimates-review.md の種類「法令」）は一覧に入れない（事務所で変えられない）
import { masterIds, officialMasterValue, type BracketStep, type MasterValue } from "../../../../hearing/src/statistics.ts";
import { PRESETS, presetDef, type PresetUse } from "../../../../hearing/src/presets.ts";
import { LIVING_CATEGORIES } from "../input/labels.ts";

/**
 * 数の単位: 円・月数・率（％で見せる）・年数（平均余命。小数）・係数（昇給カーブ・功績倍率）・年数（整数）・歳・日数・時間・数（人数・倍）
 * （コードの中の目安〔hearing/src/presets.ts〕の単位は engine/src/sdk/estimates.ts の PresetUnit）
 */
export type EstimateUnit = "yen" | "months" | "pct" | "years" | "coef" | "yearCount" | "age" | "days" | "hours" | "count";

export interface EstimateEntry {
  /** 値ID（条件ごとの行のある値は「<値ID>.<条件の値>」） */
  id: string;
  /** まとまり（一覧の見出し） */
  group: string;
  /** 画面の名前 */
  name: string;
  unit: EstimateUnit;
  /** 段階表の段の読み方（例「世帯人員」）。定数は null */
  axis: string | null;
  /** 公式の値（写しのいちばん新しい行。コードの中の目安は一覧の値と版） */
  official: MasterValue;
  /** 統計（マスタデータ）か、コードの中の目安（presets.ts。0111 の2回目） */
  source: "statistic" | "preset";
  /** コードの中の目安の効く所（空欄を補う推定・ボタンで足すときの初めの値・計算のときにエンジンが引く目安） */
  use?: PresetUse;
}

/** コードの中の目安の公式の値（マスタデータの値と同じ形。題名は出典・時点、版は一覧の rev） */
function presetOfficial(id: string): MasterValue | null {
  const d = presetDef(id);
  return d === undefined ? null : { title: d.source, value: d.value, rev: d.rev, reviewed: true, retrievedAt: null };
}

/** 公式の値（事務所の推定の値を当てない値）: マスタデータの値か、コードの中の目安の一覧の値。無ければ null */
export const officialEstimate = (id: string): MasterValue | null => officialMasterValue(id) ?? presetOfficial(id);

/** 法令で決まる値（統計の形でマスタデータに置いているが、事務所では変えない）。国立大学・大学院の授業料・入学料の標準額（省令） */
export const isLegalValue = (id: string): boolean => /^education\.statistics\.(university|graduate)\.national\./.test(id);

const EMP: Record<string, string> = { regular: "正社員", nonRegular: "正社員以外" };
const SEX: Record<string, string> = { male: "男性", female: "女性" };
const SIZE: Record<string, string> = { all: "企業規模計", large: "1,000人以上", medium: "100〜999人", small: "10〜99人" };
const EDU: Record<string, string> = {
  university: "大学卒",
  highSchoolOffice: "高校卒（管理・事務・技術）",
  highSchoolManual: "高校卒（現業）",
  highSchool: "高校卒",
  juniorCollege: "高専・短大卒",
};
const STAGE: Record<string, string> = {
  kindergarten: "幼稚園",
  elementary: "小学校",
  juniorHigh: "中学校",
  highSchool: "高校",
  university: "大学",
  graduate: "大学院",
  juniorCollege: "短大",
  kosen: "高専",
  nursery: "保育園",
};
const SECTOR: Record<string, string> = { public: "公立", private: "私立", national: "国立" };
const ITEM: Record<string, string> = {
  total: "学習費総額（年額）",
  outOfSchool: "学校外活動費（年額）",
  extracurricular: "教科外活動費（年額。部活動など）",
  schoolLunch: "学校給食費（年額）",
  admission: "入学金",
  tuition: "授業料（年額）",
  facility: "施設設備費（年額）",
};
const COURSE: Record<string, string> = { all: "全体", humanities: "文科系", science: "理科系", medical: "医歯系", master: "修士課程", doctor: "博士課程", law: "法科大学院", professional: "専門職学位課程" };
const CARE: Record<string, string> = {
  monthly: "介護の月々の費用（全体）",
  monthlyHome: "介護の月々の費用（在宅）",
  monthlyFacility: "介護の月々の費用（施設）",
  months: "介護の期間",
  initial: "介護の一時的な費用",
};
const RETIRE_REASON: Record<string, string> = { mandatory: "定年", company: "会社都合", voluntary: "自己都合", earlyIncentive: "早期優遇" };
const LIVING = new Map(LIVING_CATEGORIES.map((c) => [c.value, c.label]));

/** 値ID から画面の名前・まとまり・単位・段の読み方（知らない形の値ID は題名をそのまま名前にする） */
function describe(id: string, title: string): Omit<EstimateEntry, "id" | "official" | "source"> {
  const p = id.split(".");
  const axisOf = (fallback: string | null) => /upTo は([^、。）]+)/.exec(title)?.[1] ?? fallback;
  if (p[0] === "living") {
    if (p[2] === "basicMonthly") return { group: "生活費", name: "基本生活費（月額・世帯人員別）", unit: "yen", axis: "世帯人員" };
    const c = p[3] ?? "";
    const label = LIVING.get(c) ?? c;
    return { group: "生活費", name: `基本生活費の内訳: ${label}（月額・世帯人員別${c === "transport" || c === "otherConsumption" ? "。前の分け方" : ""}）`, unit: "yen", axis: "世帯人員" };
  }
  if (p[0] === "care") return { group: "介護", name: CARE[p[2] ?? ""] ?? title, unit: p[2] === "months" ? "months" : "yen", axis: null };
  if (p[0] === "lifeTable") return { group: "平均余命", name: `平均余命（${SEX[p[2] ?? ""] ?? ""}・年齢別）`, unit: "years", axis: "年齢" };
  if (p[0] === "housing" || p[0] === "loanRates") {
    const names: Record<string, string> = {
      "housing.statistics.mortgageRate.fixed": "住宅ローンの金利（全期間固定。新しく借りるとき・今返している分）",
      "housing.statistics.mortgageRate.fixedPeriod10": "住宅ローンの金利（固定期間選択型・当初10年。新しく借りるとき・今返している分）",
      "housing.statistics.mortgageRate.variable": "住宅ローンの金利（変動。新しく借りるとき）",
      "housing.statistics.mortgageRate.current": "今返している住宅ローンの金利（変動）",
      "housing.statistics.rentGrowth": "家賃の変動率（年）",
      "loanRates.carLoan": "自動車ローンの金利",
      "loanRates.scholarship": "貸与の奨学金の利率（これから借りる分）",
      "loanRates.scholarship.repaying": "今返している奨学金の利率",
    };
    return { group: "住まい・ローン", name: names[id] ?? title, unit: "pct", axis: null };
  }
  if (p[0] === "education") {
    if (p[2] === "boarding") return { group: "教育", name: p[3] === "initial" ? "自宅外の通学を始める費用" : "自宅外の通学の仕送り（年額）", unit: "yen", axis: null };
    if (p[2] === "nursery") return { group: "教育", name: "保育園の保育料のほかにかかる費用（年額）", unit: "yen", axis: null };
    const stage = STAGE[p[2] ?? ""] ?? p[2];
    const sector = SECTOR[p[3] ?? ""] ?? p[3];
    const course = p.length === 6 ? `・${COURSE[p[4] ?? ""] ?? p[4]}` : "";
    const item = ITEM[p[p.length - 1] ?? ""] ?? p[p.length - 1];
    return { group: "教育", name: `${sector}${stage}${course}の${item}`, unit: "yen", axis: null };
  }
  if (p[0] === "wageStats") {
    if (p[1] === "business") return { group: "給与・収入", name: "自営業の事業所得（年額）", unit: "yen", axis: null };
    if (p[1] === "default") return { group: "給与・収入", name: "昇給カーブの係数（年齢別。詳細で選んだときだけ使う）", unit: "coef", axis: "年齢" };
    if (p[1] === "partTimeHourly") return { group: "給与・収入", name: `パートの時給（${SEX[p[2] ?? ""] ?? ""}）`, unit: "yen", axis: null };
    if (p[1] === "civilServant") return p[2] === "monthlyByAge" ? { group: "給与・収入", name: "公務員の毎月の給与（年齢別）", unit: "yen", axis: axisOf("年齢") } : { group: "給与・収入", name: "公務員の毎月の給与", unit: "yen", axis: null };
    if (p[1] === "byAge") {
      const what = p[2] === "annualBonus" ? "年間の賞与" : "毎月の給与（残業代などを含む）";
      return { group: "給与・収入", name: `${what}（年齢別・${EMP[p[3] ?? ""] ?? ""}・${SEX[p[4] ?? ""] ?? ""}・${SIZE[p[5] ?? ""] ?? ""}）`, unit: "yen", axis: axisOf("年齢") };
    }
    const what = p[1] === "annualBonus" ? "年間の賞与" : p[1] === "scheduledMonthly" ? "毎月の所定内給与（残業代などを含まない）" : "毎月の給与（残業代などを含む）";
    return { group: "給与・収入", name: `${what}（${EMP[p[2] ?? ""] ?? ""}・${SEX[p[3] ?? ""] ?? ""}）`, unit: "yen", axis: null };
  }
  if (p[0] === "retirementBenefit") {
    if (p[1] === "prevalence") return p[2] === "bySize" ? { group: "退職金", name: "退職給付制度がある企業の割合（企業規模別）", unit: "pct", axis: axisOf("常用労働者数") } : { group: "退職金", name: "退職給付制度がある企業の割合", unit: "pct", axis: null };
    if (p[1] === "smallFirm") return { group: "退職金", name: `中小企業のモデル退職金（${RETIRE_REASON[p[2] ?? ""] ?? ""}・${EDU[p[3] ?? ""] ?? ""}・勤続年数別）`, unit: "yen", axis: axisOf("勤続年数") };
    const byService = p[3] === "byService";
    return { group: "退職金", name: `退職金（${RETIRE_REASON[p[1] ?? ""] ?? ""}・${EDU[p[2] ?? ""] ?? ""}${byService ? "・勤続年数別" : ""}）`, unit: "yen", axis: byService ? axisOf("勤続年数") : null };
  }
  return { group: "そのほか", name: title, unit: "yen", axis: null };
}

/** まとまりの並び */
export const ESTIMATE_GROUPS = ["生活費", "給与・収入", "退職金", "教育", "介護", "住まい・ローン", "車", "万一・保険", "前提条件・資産運用", "ライフイベント", "平均余命", "そのほか"] as const;

let cache: readonly EstimateEntry[] | null = null;

/** 事務所で変えられる値の一覧（まとまりの順、まとまりの中は値ID の順） */
export function estimateEntries(): readonly EstimateEntry[] {
  if (cache !== null) return cache;
  const out: EstimateEntry[] = [];
  for (const id of masterIds()) {
    if (isLegalValue(id)) continue;
    const official = officialMasterValue(id);
    if (official === null) continue;
    out.push({ id, official, source: "statistic", ...describe(id, official.title) });
  }
  // コードの中の目安（0111 の2回目。名前・まとまり・単位は一覧に書いてある）
  for (const d of PRESETS) {
    const official = presetOfficial(d.id);
    if (official === null) continue;
    out.push({ id: d.id, official, source: "preset", use: d.use, group: d.group, name: d.name, unit: d.unit, axis: null });
  }
  const g = (e: EstimateEntry) => (ESTIMATE_GROUPS as readonly string[]).indexOf(e.group);
  cache = out.sort((a, b) => g(a) - g(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return cache;
}

export const estimateEntry = (id: string): EstimateEntry | undefined => estimateEntries().find((e) => e.id === id);

/** 題名から、データの読み方の注記（upTo の説明など）を外した文（画面に出す出典の文） */
export const sourceText = (title: string): string =>
  title.replace(/（upTo [はが][^）]*）/g, "").replace(/[。、]?upTo [はが][^）]*/g, "").replace(/。各段は[^）]*/g, "").replace(/。1人の段は[^）]*/g, "").replace(/（）/g, "");

/** 検索（値ID・画面の名前・出典の文のどれかに、空白で区切ったすべての語が入る） */
export function searchEstimates(query: string, entries: readonly EstimateEntry[] = estimateEntries()): readonly EstimateEntry[] {
  const words = query.trim().toLowerCase().split(/[\s\u3000]+/).filter((w) => w !== "");
  if (words.length === 0) return entries;
  return entries.filter((e) => {
    const hay = `${e.id} ${e.name} ${e.official.title}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// ---- 数の見せ方と読み方 ----

const group3 = (n: number) => n.toLocaleString("ja-JP");

/** 1つの数の見せ方（単位つき。値の無い段は「—」） */
export function formatNumber(unit: EstimateUnit, v: number | string | undefined): string {
  if (v === undefined) return "—";
  if (unit === "yen") return `${group3(Number(v))}円`;
  if (unit === "months") return `${group3(Number(v))}か月`;
  if (unit === "pct") return `${String(Number((Number(v) * 100).toFixed(4)))}%`;
  if (unit === "years" || unit === "yearCount") return `${String(v)}年`;
  if (unit === "age") return `${String(v)}歳`;
  if (unit === "days") return `${group3(Number(v))}日`;
  if (unit === "hours") return `${String(v)}時間`;
  if (unit === "count") return group3(Number(v));
  return String(v);
}

/** 欄に入れる文字（％は100倍。円はそのまま） */
export function editText(unit: EstimateUnit, v: number | string | undefined): string {
  if (v === undefined) return "";
  if (unit === "pct") return String(Number((Number(v) * 100).toFixed(4)));
  return String(v);
}

/**
 * 欄の文字から値（読めない・範囲の外は undefined、空は null）。円・月数は0以上の整数、％は-20〜100（小数4桁まで。値は率の10進の文字）、
 * 年数・係数は0以上の小数（小数4桁まで）
 */
export function parseNumber(unit: EstimateUnit, text: string): number | string | null | undefined {
  const t = text.trim().replace(/[０-９．－]/g, (c) => (c === "．" ? "." : c === "－" ? "-" : String.fromCharCode(c.charCodeAt(0) - 0xfee0))).replace(/[,，、円%％]|か月|年$|歳$|日$|時間$|人$|倍$/g, "");
  if (t === "") return null;
  if (unit === "yen" || unit === "months" || unit === "yearCount" || unit === "age" || unit === "days" || unit === "hours" || unit === "count") {
    if (!/^\d{1,10}$/.test(t)) return undefined;
    return Number(t);
  }
  if (!/^-?\d{1,3}(\.\d{1,4})?$/.test(t)) return undefined;
  const n = Number(t);
  if (unit === "pct") {
    if (n < -20 || n > 100) return undefined;
    return String(Number((n / 100).toFixed(6)));
  }
  if (n < 0) return undefined;
  return t.replace(/^(-?)0+(\d)/, "$1$2");
}

/** 段の名前（例「2人」「6人以上」「〜24歳」「90歳〜」） */
export function stepLabel(axis: string | null, table: readonly BracketStep[], i: number): string {
  const s = table[i];
  if (s === undefined) return "";
  const prev = i > 0 ? table[i - 1]?.upTo : undefined;
  const a = axis ?? "";
  const unit = a.includes("世帯人員") ? "人" : a.includes("年齢") ? "歳" : a.includes("勤続") ? "年" : a.includes("労働者") ? "人" : "";
  if (a.includes("世帯人員")) return s.upTo === null ? `${String((prev ?? 0) + 1)}人以上` : `${String(s.upTo)}人`;
  if (s.upTo === null) return prev === undefined || prev === null ? "すべて" : `${String(prev + 1)}${unit}〜`;
  if (prev === undefined || prev === null) return `〜${String(s.upTo)}${unit}`;
  return `${String(prev + 1)}〜${String(s.upTo)}${unit}`;
}

/** 段の値（額の表は amount、率の表は rate） */
export const stepValue = (s: BracketStep | undefined): number | string | undefined => (s === undefined ? undefined : s.amount ?? s.rate);

/** 値のあらまし（定数はその数、段階表は代表の段か段の数） */
export function summaryText(e: Pick<EstimateEntry, "unit" | "axis">, v: MasterValue["value"]): string {
  if (!Array.isArray(v)) return formatNumber(e.unit, v as number | string);
  const t = v as readonly BracketStep[];
  const shown = t.map((s, i) => ({ s, i })).filter(({ s }) => stepValue(s) !== undefined);
  const first = shown[0];
  if (first === undefined) return `${t.length}段の表`;
  return `${stepLabel(e.axis, t, first.i)} ${formatNumber(e.unit, stepValue(first.s))} ほか（${t.length}段の表）`;
}

/** 2つの値の違いの文（「52,000円 → 60,000円」・表は変わった段「2人 208,847円 → 250,000円 ほか1段」）。同じなら null */
export function changeText(e: Pick<EstimateEntry, "unit" | "axis">, before: MasterValue["value"], after: MasterValue["value"]): string | null {
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  if (!Array.isArray(before) || !Array.isArray(after)) return `${Array.isArray(before) ? summaryText(e, before) : formatNumber(e.unit, before as number | string)} → ${Array.isArray(after) ? summaryText(e, after) : formatNumber(e.unit, after as number | string)}`;
  const b = before as readonly BracketStep[];
  const a = after as readonly BracketStep[];
  if (b.length !== a.length || b.some((s, i) => s.upTo !== a[i]?.upTo)) return `表の段の分け方が変わりました（${b.length}段 → ${a.length}段）`;
  const diff = a.map((s, i) => i).filter((i) => stepValue(a[i]) !== stepValue(b[i]));
  const one = diff[0];
  if (one === undefined) return null;
  const head = `${stepLabel(e.axis, a, one)} ${formatNumber(e.unit, stepValue(b[one]))} → ${formatNumber(e.unit, stepValue(a[one]))}`;
  return diff.length > 1 ? `${head} ほか${diff.length - 1}段` : head;
}
