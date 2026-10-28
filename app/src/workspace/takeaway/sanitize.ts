// 持ち帰り用のレポートに入れる計算の要求から、自由記述と識別子を外す（0030。0012・0016 の2 の考え方）。
// - 計算の要求の形は engine/schemas/ の JSON Schema で決まっていて、決まっていない欄は持てない（additionalProperties: false）。
//   その中で、文字を自由に入れられる欄（FREE_TEXT）を1つずつ扱いを決めて外す・決まった文字に置き換える。スキーマに自由記述の欄が増えたら、
//   テスト（test/takeaway.test.ts）が止まり、ここで扱いを決めるまで通らない
// - 物・構成員の ID（UUID）は、書き出すたびに新しい乱数の ID に付け替える（世帯ファイルの ID と結び付けられないように。対応は保つ）
// - 値の出どころ（AIからの候補・ヒアリング・取り込み）と承認の記録は外し、「手で入れた値」にする（AIの記録を持ち出さない）
import type { EngineRequest } from "../../engine/types.ts";

/** スキーマの自由記述の欄（スキーマのファイル名#$defs の中の場所）と、その扱い */
export const FREE_TEXT: Readonly<Record<string, "drop" | "generic" | "keep">> = {
  // 値の箱の出どころの参照（候補の ID）と、AI のアプリが名乗った名前
  "common#/$defs/valueBoxMeta/properties/origin/properties/ref": "drop",
  "common#/$defs/valueBoxMeta/properties/origin/properties/connector": "drop",
  // 推定の根拠の説明（文は決まった言葉に置き換える）
  "common#/$defs/valueBoxMeta/properties/estimate/properties/basis": "generic",
  // 保険の商品の参照（数表の出どころごと外す。数表の数字は残す）
  "engine.input#/$defs/insuranceContract/properties/schedule/properties/source/properties/productRef": "drop",
  // 周期的な支出（出るお金の行）・入るお金の行の見出し（FP が書いた文。決まった言葉に置き換える。0044）
  "engine.input#/$defs/periodicExpense/properties/label": "generic",
  "engine.input#/$defs/incomeFlow/properties/label": "generic",
  // ローンの名前（FP が書いた文。外す。種類の細目から見せる。0052）
  "engine.input#/$defs/debt/properties/label": "drop",
  // 退職給付の名前（FP が書いた文。外す。種類から見せる。0057）
  "engine.input#/$defs/retirementBenefit/properties/label": "drop",
  // 保険の名前（FP が書いた文。外す。種類の細目から見せる。0054）
  "engine.input#/$defs/insuranceContract/properties/label": "drop",
  // 口座の間の移し替えの見出し（入れ物だけ。外す）
  "engine.input#/$defs/transfer/properties/label": "drop",
  // 事務所の料金表から写したメニュー（事務所の設定。メニューごと外す）
  "engine.input#/$defs/advisoryFee/properties/menu/properties/label": "drop",
  "engine.input#/$defs/advisoryFee/properties/menu/properties/copiedFrom/properties/at": "drop",
  // 学費データの出どころ（公開の学費データのパックの名前と版。識別子ではない）
  "engine.input#/$defs/schoolTuition/properties/source/properties/pack": "keep",
  "engine.input#/$defs/schoolTuition/properties/source/properties/version": "keep",
  // 学校のコース（文。外す）
  "engine.input#/$defs/schoolTuition/properties/track": "drop",
  // 塾・習い事の見出し（FP が書いた文。外す）
  "engine.input#/$defs/goal/properties/education/properties/lessons/items/properties/label": "drop",
  // 車の維持費の内訳の名前つきの行の名前（FP が書いた文。外す。0069）
  "engine.input#/$defs/car/properties/upkeepOther/items/properties/label": "drop",
  // 収益不動産の物件名・所在地・メモ（FP が書いた文。外す。物件の種類と番号から見せる。0079）
  "engine.input#/$defs/account/properties/property/properties/name": "drop",
  "engine.input#/$defs/account/properties/property/properties/location": "drop",
  "engine.input#/$defs/account/properties/property/properties/memo": "drop",
  // 収益不動産の大きな修繕の中身（FP が書いた文。外す。0080）
  "engine.input#/$defs/account/properties/property/properties/repairs/items/properties/label": "drop",
};

/** 学校コード（13桁）は計算に使わない（学費の行は自己完結）ので、決まった値に置き換える */
export const SCHOOL_PLACEHOLDER = "0000000000000";
/** 決まった言葉 */
export const GENERIC_TEXT = { periodicExpense: "周期的な支出", incomeFlow: "入るお金", estimateBasis: "統計などで補った値" } as const;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** 書き出し1回分の ID の付け替え（同じ ID は同じ新しい ID に） */
export class IdMap {
  private readonly map = new Map<string, string>();
  private readonly fresh: () => string;
  constructor(fresh: () => string = () => crypto.randomUUID()) {
    this.fresh = fresh;
  }
  of(id: string): string {
    const k = id.toLowerCase();
    let v = this.map.get(k);
    if (v === undefined) {
      v = this.fresh();
      this.map.set(k, v);
    }
    return v;
  }
  /** 文字列の中の UUID をすべて付け替える */
  text(s: string): string {
    return s.replace(UUID, (m) => this.of(m));
  }
  /** 付け替えた元の ID（テスト用） */
  originals(): string[] {
    return [...this.map.keys()];
  }
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
const isObj = (v: Json | undefined): v is { [k: string]: Json } => typeof v === "object" && v !== null && !Array.isArray(v);

/** 値の箱（state と origin を持つ）: 出どころは種類だけにし、AI などは「手で入れた」にする。承認の記録は外す。推定の根拠は決まった言葉 */
function cleanBox(o: { [k: string]: Json }): void {
  if (isObj(o.origin)) {
    const kind = o.origin.kind;
    o.origin = { kind: kind === "auto" || kind === "override" ? kind : "manual" };
  }
  delete o.approval;
  if (isObj(o.estimate)) o.estimate = { method: o.estimate.method ?? "statistic", basis: GENERIC_TEXT.estimateBasis };
}

function walk(v: Json, ids: IdMap, path: readonly string[]): Json {
  if (typeof v === "string") return ids.text(v);
  if (Array.isArray(v)) return v.map((x) => walk(x, ids, path));
  if (!isObj(v)) return v;
  const o: { [k: string]: Json } = {};
  for (const [k, x] of Object.entries(v)) o[ids.text(k)] = walk(x, ids, [...path, k]);
  if ("state" in o && isObj(o.origin)) cleanBox(o);
  const parent = path.at(-1);
  const grand = path.at(-2);
  // 周期的な支出の見出し
  if (grand === "periodicExpenses" || parent === "periodicExpenses") {
    if (typeof o.label === "string") o.label = GENERIC_TEXT.periodicExpense;
  }
  // 入るお金の行の見出しと、口座の間の移し替えの見出し
  if (grand === "incomeFlows" || parent === "incomeFlows") {
    if (typeof o.label === "string") o.label = GENERIC_TEXT.incomeFlow;
  }
  if (parent === "transfers" || grand === "transfers") delete o.label;
  // ローンの名前
  if (parent === "debts") delete o.label;
  // 退職給付の名前
  if (parent === "retirementBenefits") delete o.label;
  // FP顧問料の契約: 料金表から写したメニューを外す
  if (parent === "advisoryFees" || grand === "advisoryFees") delete o.menu;
  // 保険の数表の出どころ（商品の参照）
  if (parent === "insuranceContracts" && isObj(o.schedule)) delete o.schedule.source;
  // 保険の名前
  if (parent === "insuranceContracts") delete o.label;
  // 塾・習い事の見出し
  if (parent === "lessons" || grand === "lessons") delete o.label;
  // 車の維持費の内訳の名前つきの行の名前
  if (parent === "upkeepOther") delete o.label;
  // 収益不動産の大きな修繕の中身（0080）
  if (parent === "repairs") delete o.label;
  // 収益不動産の物件名・所在地・メモ（口座の中身 accounts[].property。0079）
  if (parent === "property" && grand === "accounts") {
    delete o.name;
    delete o.location;
    delete o.memo;
  }
  // 学校が決まっているときの学費の行: 学校コードとコースを外す
  if (parent === "school" && typeof o.school === "string" && typeof o.unit === "string" && Array.isArray(o.rows)) {
    o.school = SCHOOL_PLACEHOLDER;
    o.unit = SCHOOL_PLACEHOLDER;
    if ("track" in o) o.track = null;
  }
  return o;
}

/** 計算の要求から自由記述と識別子を外し、ID を付け替える（元の要求は変えない）。根拠の記録は「なし」 */
export function sanitizeRequest(req: EngineRequest, ids: IdMap): EngineRequest {
  const out = walk(JSON.parse(JSON.stringify(req)) as Json, ids, []) as unknown as EngineRequest;
  return { ...out, trace: "none" };
}
