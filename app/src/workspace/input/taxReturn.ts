// 所得税の申告の仕方（青色・白色）と青色申告特別控除の区分の欄（members[].taxReturn。0081・0155）。
// 人ごとの1つの値を、収益不動産の入力項目（物件の持ち主ごとの「申告」）と、働き方と収入の入力項目（事業所得のある人の「確定申告」）の
// 2か所に同じ当て先で出す（どちらから入れても同じ値。欄の定義はこの1か所）
import type { Household, Member, RealEstateProperty } from "../../engine/types.ts";
import type { Address } from "../store/readings.ts";
import { plain, type FieldDef, type Finder, type Level, type Option } from "./form.ts";
import type { WorkingHousehold } from "./household.ts";
import { incomeTreatment } from "./moneyRows.ts";

/** 申告の仕方と青色申告特別控除の区分（0081） */
export const TAX_RETURN_METHODS: Option[] = [
  { value: "white", label: "白色" },
  { value: "blue", label: "青色" },
];
export const BLUE_DEDUCTIONS: Option[] = [
  { value: "electronic", label: "65万円" },
  { value: "doubleEntry", label: "55万円" },
  { value: "simple", label: "10万円" },
];

/** 入れていないときの計算（エンジンの tax.totalIncome と同じ: 欄が無ければ白色、青色で区分が無ければ10万円）の推定の根拠（55万円・65万円を使える人だけ。0155） */
export const TAX_RETURN_BLANK = "既定の値（白色。青色申告特別控除なしで計算しています。青色申告なら選んでください）";
export const BLUE_DEDUCTION_BLANK = "既定の値（10万円。55万円・65万円の要件に当たるなら選んでください）";

/** 民泊・宿の所得の区分（省略は営業の形から: 旅館業は事業所得、ほかは雑所得。0081） */
export const lodgingIncomeKind = (l: NonNullable<RealEstateProperty["lodging"]>): "miscellaneous" | "business" | "realEstate" => l.incomeKind ?? (l.business === "inn" ? "business" : "miscellaneous");

/**
 * その人に事業所得があるか（青色申告特別控除の55万円・65万円の要件。エンジンの tax.totalIncome と同じ見方）: 自営の働き方の期間、
 * 課税の扱いが事業所得の入るお金の行（受け取る人。空ならご本人）、事業所得の民泊・宿
 */
export function hasBusinessIncome(h: Household, member: string): boolean {
  if ((h.employmentPeriods ?? []).some((x) => x.member === member && x.type === "selfEmployed")) return true;
  const self = h.members.find((m) => m.kind === "self")?.id;
  if ((h.incomeFlows ?? []).some((f) => incomeTreatment(f) === "business" && (f.recipient ?? self) === member)) return true;
  return (h.accounts ?? []).some((a) => a.kind === "realEstate" && a.owner === member && a.property?.lodging !== undefined && lodgingIncomeKind(a.property.lodging) === "business");
}

const HELP_METHOD =
  "確定申告書の第一表の「青色」の印か、青色申告決算書があれば青色です。青色申告なら、青色申告特別控除を不動産所得・事業所得から引き（不動産所得から先に）、損益通算で引ききれない赤字を翌年から3年繰り越します。白色は控除が無く、引ききれない赤字を捨てます。入れなければ白色で計算します。収益不動産の「申告」と働き方と収入の「確定申告」は同じ値です";
const HELP_DEDUCTION =
  "青色申告決算書の青色申告特別控除額。65万円は複式簿記の帳簿と e-Tax での申告（か電子帳簿の保存）、55万円は複式簿記の帳簿と貸借対照表・損益計算書を期限内に出すとき、それ以外は10万円です。55万円・65万円は、不動産所得が事業的規模か事業所得があるときだけ使えます。不動産所得・事業所得の黒字の合計が上限で、不動産所得から先に引きます";

/**
 * 申告の仕方と（青色のとき）青色申告特別控除の欄。prefix は欄のキーの頭（収益不動産は rental/taxReturn/<人>、働き方と収入は work/<人>/taxReturn）。
 * scaleMet: 不動産所得が事業的規模の目安に当たるか（当たらず事業所得も無いのに55万円・65万円なら、欄に10万円で計算している知らせ）
 */
export function taxReturnFields(wh: WorkingHousehold, memberId: string, prefix: string, level: Level, scaleMet: boolean): FieldDef[] {
  const h = wh.request.input.household;
  const m = h.members.find((x) => x.id === memberId) as Member | undefined;
  const find: Finder = (hh) => hh.members.find((x) => x.id === memberId) as Record<string, unknown> | undefined;
  const address = (at: string) => (): Address => ({ target: { object: memberId }, item: "member.taxReturn", at: [at] });
  // 入れていないときは、計算と同じ値を見せる。55万円・65万円を使える人（事業所得があるか、不動産所得が事業的規模）は推定の印を付ける
  // （控除の有無で結果が大きく動く）。ほかの人（10万円までの人）は今までどおり省略の既定として見せる。
  // 見せている値を書き戻しても世帯は変えない（0041。「この値にする」と書類の値は write で書く）
  const business = hasBusinessIncome(h, memberId);
  const matters = business || scaleMet;
  const blank = (f: FieldDef, value: string, basis: string): FieldDef => ({
    ...f,
    // 「推定に戻す」で空（推定の既定）に戻せる
    ...(matters ? { blankIsEstimate: true } : {}),
    get: (w) => {
      const st = f.get(w);
      return st.value === null ? { ...st, value, ...(matters ? { estimated: basis } : { implicit: true }) } : st;
    },
    set: (w, v) => (v === value && f.get(w).value === null ? w : f.set(w, v)),
  });
  const method = blank(
    plain({
      key: `${prefix}/method`,
      item: "member.taxReturn",
      label: "申告の仕方",
      level,
      kind: "select",
      options: TAX_RETURN_METHODS,
      find,
      path: ["taxReturn", "method"],
      optional: true,
      structural: true,
      help: HELP_METHOD,
      // 白色は白色と書く（入れていない＝推定の白色と見分ける）。青色の区分は外す。空にしたら申告の欄ごと外す
      after: (_h, t, v) => {
        const tr = t.taxReturn as { method?: string; blueDeduction?: string } | undefined;
        if (v === null || tr?.method === undefined) delete t.taxReturn;
        else if (v === "white") delete tr.blueDeduction;
      },
    }),
    "white",
    TAX_RETURN_BLANK,
  );
  const fields: FieldDef[] = [{ ...method, address: address("method") }];
  if (m?.taxReturn?.method === "blue") {
    const ded = blank(
      plain({
        key: `${prefix}/blueDeduction`,
        item: "member.taxReturn",
        label: "青色申告特別控除",
        level,
        kind: "select",
        options: BLUE_DEDUCTIONS,
        find,
        path: ["taxReturn", "blueDeduction"],
        optional: true,
        help: HELP_DEDUCTION,
      }),
      "simple",
      BLUE_DEDUCTION_BLANK,
    );
    fields.push({
      ...ded,
      address: address("blueDeduction"),
      get: (w) => {
        const st = ded.get(w);
        return (st.value === "electronic" || st.value === "doubleEntry") && !scaleMet && !business ? { ...st, warn: "事業的規模の目安に当たらず事業所得も無いので、10万円で計算しています" } : st;
      },
    });
  }
  return fields;
}
