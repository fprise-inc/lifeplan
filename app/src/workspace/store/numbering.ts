// 顧客番号の区分と通し番号・見本の棚（0033・0247）。番号を振る・変えるのは本体（household-store）で、画面は一覧の探し方・絞り込みを持つ。
// 見本は番号を持たない（名前・家族の形・本人の年代・項目で探す。0247 の1）
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

/** 家族の形（見本の family） */
export const FAMILY_SHAPES: readonly { n: number; name: string }[] = [
  { n: 1, name: "単身" },
  { n: 2, name: "夫婦のみ" },
  { n: 3, name: "夫婦と子" },
  { n: 4, name: "ひとり親" },
  { n: 5, name: "シニア" },
];

/** 本人の年代（見本の age） */
export const AGE_BANDS: readonly number[] = [2, 3, 4, 5, 6, 7];

export const ageBandName = (a: number) => `${a}0代`;
export const familyName = (n: number) => FAMILY_SHAPES.find((f) => f.n === n)?.name ?? "";

/** 見本の絞り込みの項目（働き方・稼ぎ方・住まいなど） */
export const SAMPLE_TRAITS: readonly string[] = ["会社員", "公務員", "自営業", "役員", "年金生活", "共働き", "片働き", "持ち家", "賃貸", "住宅ローン", "教育費", "資産運用", "収益不動産", "親の介護・相続"];

/**
 * 見本を開いていて、動かしても保存しない（見本の帯の「動かしても見本は変わりません」と同じ条件。0033）。
 * item は見本の棚の今開いている見本（見本でなければ null）、mode は自分で作った見本の開き方（「この見本を直す」で edit）。
 * アプリに入っている見本は mode が null で、いつも保存しない
 */
export function sampleNotSaving(item: ShelfItem | null, mode: null | "view" | "edit"): boolean {
  return item !== null && mode !== "edit";
}

/** 家族の形と本人の年代の説明（例: 夫婦と子・40代） */
export function shapeText(family: number, age: number): string {
  const f = familyName(family);
  return f === "" || !AGE_BANDS.includes(age) ? "" : `${f}・${ageBandName(age)}`;
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

/** 見本の棚の自分で作った見本の種類（ShelfItem.group） */
export const OWN_GROUP = "own";

/** 見本の棚の1件（アプリに入っている見本と、FP が作った見本）。番号は持たない（0247 の1） */
export interface ShelfItem {
  kind: "app" | "own";
  /** 種類（見出しの分け方）: アプリに入っている見本はセットの ID（例 official.basic）、自分で作った見本は OWN_GROUP */
  group: string;
  /** アプリの見本は data/modelHouseholds の名前、FP の見本は世帯の内部ID */
  id: string;
  /** 家族の形（1〜5） */
  family: number;
  /** 本人の年代（2〜7） */
  age: number;
  name: string;
  traits: readonly string[];
  /** FP の見本の最後の保存 */
  updatedAt?: string;
}

/** 見本の棚に並べるセット（samples/sets.ts の SampleSet のうち、棚に要る所） */
export interface ShelfSet {
  id: string;
  name: string;
  samples: readonly { id: string; title: string; traits: readonly string[]; family: number; age: number }[];
}

/**
 * 見本の棚の並び（0247 の2）: セット（定義の順。セットの中も定義の順）→ 自分で作った見本（名前の順。本体の一覧と同じ）。
 * 家族の形・年代は、アプリの見本はセットの定義の family・age、自分で作った見本は一覧の欄の sample から読む
 */
export function shelfItems(sets: readonly ShelfSet[], own: readonly ({ id: string; customerNo: string; updatedAt: string } & NumberLabel)[]): ShelfItem[] {
  const apps = sets.flatMap((set) => set.samples.map((d): ShelfItem => ({ kind: "app", group: set.id, id: d.id, family: d.family, age: d.age, name: d.title, traits: d.traits })));
  const owns = own
    .flatMap((h): ShelfItem[] => (h.sample === undefined ? [] : [{ kind: "own", group: OWN_GROUP, id: h.id, family: h.sample.family, age: h.sample.age, name: h.sample.name, traits: h.sample.traits, updatedAt: h.updatedAt }]))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return [...apps, ...owns];
}

/** 自分で作った見本の見出し（事務所の共有では「事務所で作った見本」。PC の中だけと、1人で複数の PC の同期フォルダは「自分で作った見本」。0247 の2） */
export function ownSampleHeading(officeShared: boolean): string {
  return officeShared ? "事務所で作った見本" : "自分で作った見本";
}

/** 見本の棚を種類で分けた1つ（heading が null のときは見出しを出さない） */
export interface ShelfSection {
  group: string;
  heading: string | null;
  items: ShelfItem[];
}

/**
 * 見本の棚を種類ごとに分ける（0247 の2）。並びは items のまま（shelfItems の順）。行の無い種類は出さない（絞り込みで0件になった種類の見出しも出さない）。
 * 見出しは、出ている種類が2つ以上のときだけ出す（はじめて使う人〔基本の見本だけ〕には見出しを出さない）。headings はセットの ID と OWN_GROUP → 見出し
 */
export function shelfSections(items: readonly ShelfItem[], headings: Readonly<Record<string, string>>): ShelfSection[] {
  const out: ShelfSection[] = [];
  for (const i of items) {
    const last = out[out.length - 1];
    if (last !== undefined && last.group === i.group) last.items.push(i);
    else out.push({ group: i.group, heading: null, items: [i] });
  }
  return out.length < 2 ? out : out.map((sec) => ({ ...sec, heading: headings[sec.group] ?? null }));
}

/** 見本の名前に使えない名前（アプリに入っているすべてのセットの見本の名前。本体に渡して、自分で作った見本の名前と重ならないようにする。0247 の1） */
export function reservedSampleNames(sets: readonly { samples: readonly { title: string }[] }[]): string[] {
  return sets.flatMap((set) => set.samples.map((d) => d.title));
}

/** 見本の名前を比べる形（本体と同じく前後の空白を除き NFC にそろえる） */
export const sampleNameKey = (name: string) => name.trim().normalize("NFC");

export interface ShelfFilter {
  /** 家族の形（0 はすべて） */
  family: number;
  /** 年代（0 はすべて） */
  age: number;
  /** すべてを持つ見本だけ */
  traits: readonly string[];
  /** 名前の一部（空はすべて） */
  name?: string;
}

/** 名前で探すときの比べる形（NFKC にそろえ、全角と半角・大文字と小文字を問わない） */
const searchKey = (s: string) => s.normalize("NFKC").toLowerCase();

/** 見本の名前で探す: 名前の一部が入っていれば（空白で区切った言葉は、どれも入っている物だけ） */
export function matchesSampleName(name: string, query: string): boolean {
  const n = searchKey(name);
  return searchKey(query)
    .split(/\s+/)
    .filter((w) => w !== "")
    .every((w) => n.includes(w));
}

export function filterShelf(items: readonly ShelfItem[], f: ShelfFilter): ShelfItem[] {
  return items.filter((i) => (f.family === 0 || i.family === f.family) && (f.age === 0 || i.age === f.age) && f.traits.every((t) => i.traits.includes(t)) && matchesSampleName(i.name, f.name ?? ""));
}

/** 世帯の入力から、見本の家族の形と本人の年代の初めの値を決める（FP が選び直せる） */
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
