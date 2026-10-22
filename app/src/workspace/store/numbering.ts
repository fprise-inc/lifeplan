// 顧客番号の区分と通し番号・見本の棚（0033）。番号を振る・変えるのは本体（household-store）で、画面は一覧の探し方・絞り込みと
// 見本の番号の読み方だけを持つ
import type { Category, NumberLabel } from "../../engine/host.ts";
import type { EngineRequest } from "../../engine/types.ts";

export type { Category, CategoryEdit, CategorySettings, NumberLabel, SampleInfo, SampleRequest } from "../../engine/host.ts";

export const CATEGORY_CODE = /^[A-Z]{1,2}$/;

/** 「区分を使う」と答えたときに入れる区分（A 顧問契約・B 単発相談・C 見込み客。FP がその場で直せる） */
export const DEFAULT_CATEGORIES: readonly Category[] = [
  { code: "A", name: "顧問契約" },
  { code: "B", name: "単発相談" },
  { code: "C", name: "見込み客" },
];

/** 家族の形（見本番号の1つ目） */
export const FAMILY_SHAPES: readonly { n: number; name: string }[] = [
  { n: 1, name: "単身" },
  { n: 2, name: "夫婦のみ" },
  { n: 3, name: "夫婦と子" },
  { n: 4, name: "ひとり親" },
  { n: 5, name: "シニア" },
];

/** 本人の年代（見本番号の2つ目） */
export const AGE_BANDS: readonly number[] = [2, 3, 4, 5, 6, 7];

export const ageBandName = (a: number) => `${a}0代`;
export const familyName = (n: number) => FAMILY_SHAPES.find((f) => f.n === n)?.name ?? "";

/** 見本の絞り込みの項目（番号に入れないもの: 働き方・稼ぎ方・住まいなど） */
export const SAMPLE_TRAITS: readonly string[] = ["会社員", "公務員", "自営業", "役員", "年金生活", "共働き", "片働き", "持ち家", "賃貸", "住宅ローン", "教育費", "資産運用"];

/** FP が作る見本の順番の始まり（01〜09 はアプリに入っている見本） */
export const FIRST_OWN_SAMPLE = 10;

export function parseSampleNo(no: string): { family: number; age: number; order: number } | null {
  const m = /^([1-5])-([2-7])-(\d{2})$/.exec(no);
  if (m === null) return null;
  const order = Number(m[3]);
  return order >= 1 ? { family: Number(m[1]), age: Number(m[2]), order } : null;
}

/** 見本番号の説明（例: 夫婦と子・40代） */
export function sampleNoText(no: string): string {
  const p = parseSampleNo(no);
  return p === null ? "" : `${familyName(p.family)}・${ageBandName(p.age)}`;
}

/** 体系の番号として読む（区分の記号＋通し番号[-枝番]。記号は大文字・小文字を問わない） */
function structured(q: string): { code: string; serial: number; branch: string | null } | null {
  const m = /^([A-Za-z]{1,2})(\d{1,6})(?:-(\d{1,2}|[Cc]))?$/.exec(q);
  if (m === null) return null;
  return { code: (m[1] as string).toUpperCase(), serial: Number(m[2]), branch: m[3] === undefined ? null : (m[3] as string).toUpperCase() };
}

/**
 * 一覧で番号を探す: 数字だけ（「0042」「42」）なら通し番号で（枝番の世帯も出す。区分を使わない番号 0042 も同じ）、区分の記号つき（「A42」「a0042-1」）なら
 * 区分と通し番号で、それ以外は番号の一部で探す（自由な番号は数字だけでも一部で探す）
 */
export function matchesNumber(h: { customerNo: string } & NumberLabel, query: string): boolean {
  const q = query.trim();
  if (q === "") return true;
  if (/^\d+$/.test(q)) {
    if (h.serial !== undefined) return h.serial === Number(q);
    return h.customerNo.includes(q);
  }
  const s = structured(q);
  if (s !== null && h.serial !== undefined) return h.category === s.code && h.serial === s.serial && (s.branch === null || h.branch === s.branch);
  return h.customerNo.toUpperCase().includes(q.toUpperCase());
}

/** 区分の絞り込み: "" はすべて、"-" は区分なし */
export const NO_CATEGORY = "-";

export function filterCustomers<T extends { customerNo: string } & NumberLabel>(list: readonly T[], query: string, category: string): T[] {
  return list.filter((h) => matchesNumber(h, query) && (category === "" || (category === NO_CATEGORY ? h.category === undefined : h.category === category)));
}

/** 区分の表示（記号と名前。区分の一覧に無い記号は記号だけ） */
export function categoryText(cats: readonly Category[], code: string | undefined): string {
  if (code === undefined) return "区分なし";
  const c = cats.find((x) => x.code === code);
  return c === undefined ? code : `${c.code} ${c.name}`;
}

/** 見本の棚の1件（アプリに入っている見本と、FP が作った見本） */
export interface ShelfItem {
  kind: "app" | "own";
  /** アプリの見本は data/modelHouseholds の名前、FP の見本は世帯の内部ID */
  id: string;
  no: string;
  name: string;
  traits: readonly string[];
  /** FP の見本の最後の保存 */
  updatedAt?: string;
}

export function shelfItems(app: readonly { id: string; sampleNo: string; title: string; traits: readonly string[] }[], own: readonly ({ id: string; customerNo: string; updatedAt: string } & NumberLabel)[]): ShelfItem[] {
  const items: ShelfItem[] = [
    ...app.map((d): ShelfItem => ({ kind: "app", id: d.id, no: d.sampleNo, name: d.title, traits: d.traits })),
    ...own.flatMap((h): ShelfItem[] => (h.sample === undefined ? [] : [{ kind: "own", id: h.id, no: h.sample.no, name: h.sample.name, traits: h.sample.traits, updatedAt: h.updatedAt }])),
  ];
  return items.sort((a, b) => (a.no < b.no ? -1 : a.no > b.no ? 1 : 0));
}

export interface ShelfFilter {
  /** 家族の形（0 はすべて） */
  family: number;
  /** 年代（0 はすべて） */
  age: number;
  /** すべてを持つ見本だけ */
  traits: readonly string[];
}

export function filterShelf(items: readonly ShelfItem[], f: ShelfFilter): ShelfItem[] {
  return items.filter((i) => {
    const p = parseSampleNo(i.no);
    if (p === null) return false;
    return (f.family === 0 || p.family === f.family) && (f.age === 0 || p.age === f.age) && f.traits.every((t) => i.traits.includes(t));
  });
}

/** 世帯の入力から、見本番号の家族の形と本人の年代の初めの値を決める（FP が選び直せる） */
export function guessShape(req: EngineRequest): { family: number; age: number } {
  const ms = req.input.household.members;
  const self = ms.find((m) => m.kind === "self");
  const spouse = ms.some((m) => m.kind === "spouse");
  const child = ms.some((m) => m.kind === "child");
  const [by, bm] = (self?.birth.birthYearMonth ?? "1980-01").split("-").map(Number) as [number, number];
  const [y, m] = req.input.baseMonth.split("-").map(Number) as [number, number];
  const ageYears = y - by - (m < bm ? 1 : 0);
  const age = Math.min(7, Math.max(2, Math.floor(ageYears / 10)));
  const family = ageYears >= 65 && !child ? 5 : spouse ? (child ? 3 : 2) : child ? 4 : 1;
  return { family, age };
}
