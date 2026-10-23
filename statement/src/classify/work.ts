// 区分（どこに入るか）と世帯の働き方（0034 の5）。
//   会社員: 家計／立替（会社に請求する分）／一時的／除外
//   個人事業主: 家計／事業の経費（割合で分けられる）／一時的／除外
//   法人役員: 家計／会社の経費／一時的／除外
// 区分は行の持ち主（明細の持ち主か、行ごとに選んだ構成員）の働き方で決める。夫は会社員・妻は個人事業主のような世帯は、
// 行ごとの持ち主で分かれる。副業のように1人が2つの働き方を持つときは、FP が働き方を足す（styles）

export type WorkStyle = "employee" | "selfEmployed" | "executive" | "none";
export type Bucket = "household" | "reimbursable" | "business" | "company" | "oneOff" | "excluded";

export const BUCKET_LABELS: Record<Bucket, string> = {
  household: "家計",
  reimbursable: "立替（会社に請求する分）",
  business: "事業の経費",
  company: "会社の経費",
  oneOff: "一時的",
  excluded: "除外",
};

export const WORK_STYLE_LABELS: Record<WorkStyle, string> = { employee: "会社員", selfEmployed: "個人事業主", executive: "法人役員", none: "働いていない" };

const COMMON: readonly Bucket[] = ["household", "oneOff", "excluded"];

export const BUCKETS_BY_STYLE: Record<WorkStyle, readonly Bucket[]> = {
  employee: ["household", "reimbursable", "oneOff", "excluded"],
  selfEmployed: ["household", "business", "oneOff", "excluded"],
  executive: ["household", "company", "oneOff", "excluded"],
  none: COMMON,
};

/** 働き方の組から選べる区分（足し合わせ） */
export function bucketsOf(styles: readonly WorkStyle[]): Bucket[] {
  const out = new Set<Bucket>(COMMON);
  for (const s of styles) for (const b of BUCKETS_BY_STYLE[s]) out.add(b);
  return (["household", "reimbursable", "business", "company", "oneOff", "excluded"] as const).filter((b) => out.has(b));
}

/** 計算の要求のうち、働き方を決めるのに読む部分（エンジンの型の一部） */
export interface HouseholdLike {
  readonly members: readonly { readonly id: string; readonly kind: string; readonly birth?: { readonly birthYearMonth?: string } }[];
  readonly employmentPeriods?: readonly { readonly member: string; readonly from: unknown; readonly to: unknown; readonly type: string }[];
}

/** 時点を年月に（絶対の年月と「○歳になった月」だけ。読めなければ null） */
function monthOf(t: unknown, h: HouseholdLike): string | null {
  if (typeof t !== "object" || t === null) return null;
  const o = t as Record<string, unknown>;
  if (typeof o.at === "string") return o.at;
  const age = o.memberAge as { member?: string; years?: number } | undefined;
  if (age !== undefined && typeof age.member === "string" && typeof age.years === "number") {
    const b = h.members.find((m) => m.id === age.member)?.birth?.birthYearMonth;
    if (typeof b === "string" && /^\d{4}-\d{2}$/u.test(b)) return `${Number(b.slice(0, 4)) + age.years}${b.slice(4)}`;
  }
  return null;
}

const STYLE_OF_TYPE: Record<string, WorkStyle> = {
  regular: "employee",
  contract: "employee",
  partTime: "employee",
  civilServant: "employee",
  selfEmployed: "selfEmployed",
  executive: "executive",
  leave: "employee",
  unemployed: "none",
};

/** 基準の月の働き方（働き方の期間から。その月に当たる期間が無ければ none） */
export function workStyleAt(h: HouseholdLike, member: string, month: string): WorkStyle[] {
  const out = new Set<WorkStyle>();
  for (const p of h.employmentPeriods ?? []) {
    if (p.member !== member) continue;
    const from = monthOf(p.from, h);
    const to = p.to === null ? null : monthOf(p.to, h);
    if (from !== null && from > month) continue;
    if (p.to !== null && to !== null && to < month) continue;
    out.add(STYLE_OF_TYPE[p.type] ?? "none");
  }
  if (out.size > 1) out.delete("none");
  return out.size === 0 ? ["none"] : [...out];
}

/** 構成員ごとの働き方（FP が選んだ働き方があればそれを使う） */
export function memberStyles(h: HouseholdLike, month: string, chosen?: Readonly<Record<string, readonly WorkStyle[]>>): Map<string, WorkStyle[]> {
  const out = new Map<string, WorkStyle[]>();
  for (const m of h.members) {
    const c = chosen?.[m.id];
    out.set(m.id, c !== undefined && c.length > 0 ? [...c] : workStyleAt(h, m.id, month));
  }
  return out;
}

/** 割合（10進の文字列 "0.6" など。0より大きく1以下）を分数にする。読めなければ null */
export function parseShare(s: string): { num: bigint; den: bigint } | null {
  const m = /^(0(?:\.\d{1,4})?|1(?:\.0{1,4})?)$/u.exec(s);
  if (m === null) return null;
  const [i, f = ""] = s.split(".") as [string, string?];
  const den = 10n ** BigInt(f.length);
  const num = BigInt(i) * den + BigInt(f === "" ? "0" : f);
  if (num <= 0n || num > den) return null;
  return { num, den };
}

/** 金額を割合で按分する（事業の分は切り捨て、残りを家計に。負の金額＝返品も同じ割合で戻す） */
export function splitByShare(amount: number, share: string): { business: number; household: number } | null {
  const r = parseShare(share);
  if (r === null) return null;
  const abs = BigInt(Math.abs(amount));
  const biz = Number((abs * r.num) / r.den);
  const b = amount < 0 ? -biz : biz;
  return { business: b, household: amount - b };
}
