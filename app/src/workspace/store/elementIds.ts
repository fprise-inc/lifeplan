// 並びの要素の ID（0035 の5）: 関係・生活費の段と費目・積立・利率の段・繰上げ返済・保険の更新・教育の段など、並びの要素は ID を持つ。
// ID の無い古いデータを読むときは、本体の 0.16 → 0.17 の変換の段と同じ場所から決まった ID を振る。画面で新しく足した要素には乱数の ID。
// 画面の中の世帯も ID を持つ（開いたとき fromRequest・世帯を置き換えるとき）。番号で当てると、足す・外す・並べ替えで別の要素に当たるため
import { migrationId } from "./readings.ts";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);


// 0.18 から（0040）: 段階と例外の年の並び（周期的な支出・家賃・修繕費・固定資産税・不動産の家賃と経費・器の利回り・資産配分）。
// 0.18 の形は足すだけで、0.17 以前のファイルにはこの並びが無い（本体の 0.16 → 0.17 の段は振らない）。画面で足すときは乱数の ID を付けて足す
const ELEMENT_LISTS: readonly [string, readonly (readonly string[])[]][] = [
  ["livingExpenses", [["stages"], ["categories"]]],
  ["accounts", [["contributions"], ["returnStages"], ["returnExceptions"], ["property", "rental", "stages"], ["property", "rental", "exceptions"], ["property", "expenses", "stages"], ["property", "expenses", "exceptions"]]],
  ["debts", [["rateSchedule"], ["prepayments"]]],
  ["residences", [["purchase", "gifts"], ["rent", "stages"], ["rent", "exceptions"], ["maintenance", "stages"], ["maintenance", "exceptions"], ["propertyTax", "stages"], ["propertyTax", "exceptions"]]],
  ["periodicExpenses", [["stages"], ["exceptions"]]],
  ["insuranceContracts", [["renewals"]]],
  ["goals", [["education", "stages"], ["education", "lessons"], ["education", "scholarships"], ["education", "loans"], ["education", "gifts"]]],
  ["advisoryFees", [["terms", "oneTime"], ["terms", "recurring", "revision", "steps"]]],
];
const ASSUMPTION_LISTS: readonly (readonly string[])[] = [["marketShocks"], ["loanRateShifts"], ["incomeShocks"], ["returnShifts"], ["surplusSaving", "changes"], ["investment", "allocation", "stages"]];

const getPath = (o: unknown, path: readonly string[]): unknown => path.reduce<unknown>((n, k) => (isObj(n) ? n[k] : undefined), o);

/** 場所から決まった ID（変換の段と同じ作り方）。同じ並びにもうある ID なら、場所に数を足して作り直す（同じ世帯なら同じ ID になる） */
export function placeId(place: string, used: Set<string>): string {
  let id = migrationId(place);
  for (let n = 1; used.has(id); n++) id = migrationId(`${place}/${n}`);
  used.add(id);
  return id;
}

/** ID の作り方: 場所（`<親の物の ID>/<欄の名前>/<番号>`）と、同じ並びにもうある ID から */
export type MakeId = (place: string, used: Set<string>) => string;

/** 新しく足した要素の ID（乱数。0035 の5） */
export const randomId: MakeId = (_place, used) => {
  let id = crypto.randomUUID();
  while (used.has(id)) id = crypto.randomUUID();
  used.add(id);
  return id;
};

/** ID の無い要素に ID を振る */
function giveIds(list: unknown, place: string, make: MakeId): void {
  if (!Array.isArray(list)) return;
  const used = new Set(list.flatMap((e) => (isObj(e) && typeof e.id === "string" ? [e.id] : [])));
  list.forEach((e, i) => {
    if (isObj(e) && typeof e.id !== "string") e.id = make(`${place}/${i}`, used);
  });
}

/**
 * 並びの要素に ID を振る（世帯の要求の input を書き換える。0035 の5）。ID の無い古いデータを読むときは場所から決まった ID
 * （変換の段と同じ。既定）、画面で新しく足した要素には乱数の ID（randomId）。もう ID のある要素は変えない
 */
export function giveElementIds(input: Json, make: MakeId = placeId): void {
  const h = input.household;
  if (isObj(h)) {
    for (const [coll, paths] of ELEMENT_LISTS) {
      for (const obj of Array.isArray(h[coll]) ? (h[coll] as unknown[]) : []) {
        if (!isObj(obj) || typeof obj.id !== "string") continue;
        for (const p of paths) giveIds(getPath(obj, p), `${obj.id}/${p.join("/")}`, make);
      }
    }
    const rels = Array.isArray(h.relations) ? h.relations : [];
    const used = new Set(rels.flatMap((r) => (isObj(r) && typeof r.id === "string" ? [r.id] : [])));
    rels.forEach((r, i) => {
      if (!isObj(r) || typeof r.id === "string") return;
      const a = typeof r.a === "string" ? r.a : typeof r.parent === "string" ? r.parent : "";
      const b = typeof r.b === "string" ? r.b : typeof r.child === "string" ? r.child : "";
      r.id = make(`relations/${i}/${a}/${b}`, used);
    });
  }
  for (const p of ASSUMPTION_LISTS) giveIds(getPath(input.assumptions, p), `assumptions/${p.join("/")}`, make);
}

const FOUND = Symbol("ID の無い要素");

/** ID の無い要素があるか（無ければ写しを作らずに済ませるため。世帯は書き換えない: 最初の1つで止める） */
export function lacksElementIds(input: Json): boolean {
  try {
    giveElementIds(input, () => {
      throw FOUND;
    });
  } catch (e) {
    if (e === FOUND) return true;
    throw e;
  }
  return false;
}
