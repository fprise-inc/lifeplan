// 収益不動産の建てる・買う予定（0232）: 支払いのある取得の予定（土地ごと買う・持っている土地に建てる）。
// - 欄は物件の中身の planned（予定の形・時期・購入代金と建築費の内訳・建物附属設備の耐用年数・取得の諸費用・自己資金・建物の固定資産税評価額）。
//   計算エンジン（asset.realEstate）が、予定の月から評価額・家賃・経費・減価償却を入れ、予定の月に自己資金を払う
// - 持ち始める時点（holdFrom。相続・贈与で受け取る物件。支払いが無い）とは別の欄。予定のある物件には持ち始める時点を出さない
// - 建物の固定資産税評価額は、相続税の評価の材料（表の評価額〔時価〕には使わない）。新築の評価額の割合（事務所の推定の値。0181）を建物の価格に
//   かけた額を推定で入れ、推定のままの額は建築費・購入代金に合わせて入れ直す（refreshRentalPlans。FP が入れた額は変えない）
import type { Account, Box, Debt, Household, RealEstatePlan } from "../../../engine/types.ts";
import type { Address } from "../../store/readings.ts";
import { addMonths } from "../../levers.ts";
import { byId, plain, resolveTimepoint, timepointField, yenBox, type FieldDef, type Finder, type GroupDef, type Option } from "../form.ts";
import { confirmedBox, mutate, newId, presetBasis, standardBox, type WorkingHousehold } from "../household.ts";
import { putRow } from "../rows.ts";
import { manOf, pctOf, taxGuide } from "../propertyTax.ts";
import { amountText } from "../units.ts";

/** 予定の形 */
export const PLAN_TYPES: Option[] = [
  { value: "buy", label: "土地ごと買う" },
  { value: "build", label: "持っている土地に建てる" },
];

/** 相続の直前の極端な借入れ・購入による評価の引き下げについての、控えめな注意（予定の物件の入力のところに出す） */
export const PLAN_INHERITANCE_NOTE =
  "借入れをして不動産を買う・建てると、相続税の評価が大きく下がることがあります。ただ、相続の直前の極端な借入れ・購入で評価を下げると、通達どおりの評価が認められないことがあります（令和4年4月19日の最高裁判決）。";

/** 推定の根拠の文の頭（この頭の推定を、建物の固定資産税評価額の推定の印として読む） */
export const PLAN_ASSESSED_BASIS = "建物の固定資産税評価額の推定";

/** 予定の物件か（中身に建てる・買う予定がある） */
export const plannedOf = (a: Pick<Account, "property">): RealEstatePlan | undefined => a.property?.planned;
/** 土地ごと買う予定の物件（器の時価は計算に使わない） */
export const isPlannedBuy = (a: Pick<Account, "property">): boolean => a.property?.planned?.type === "buy";
/** 持っている土地に建てる予定の物件（器の時価は今の土地の時価） */
export const isPlannedBuild = (a: Pick<Account, "property">): boolean => a.property?.planned?.type === "build";

/** 予定の月（解けなければ null） */
export const planMonth = (h: Household, a: Pick<Account, "property">): string | null => {
  const p = a.property?.planned;
  return p === undefined ? null : resolveTimepoint(h, p.at);
};

/** 「2030年7月」 */
const jaYm = (ym: string): string => `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月`;

/** 予定の見出しの短い文（「2030年7月に買う予定」「2028年4月に建てる予定」） */
export function planText(h: Household, a: Pick<Account, "property">): string | null {
  const p = a.property?.planned;
  if (p === undefined) return null;
  const ym = planMonth(h, a);
  return `${ym !== null ? jaYm(ym) : ""}に${p.type === "buy" ? "買う" : "建てる"}予定`;
}

/** 購入代金・建築費の合計（建てる予定は建物と建物附属設備。土地の欄は読まない。エンジンと同じ） */
export function planPrice(p: RealEstatePlan): number {
  const x = p.parts ?? {};
  return (p.type === "buy" ? (x.land ?? 0) : 0) + (x.building ?? 0) + (x.equipment ?? 0);
}

/** 建物の価格（建物と建物附属設備。固定資産税評価額の推定の元） */
export const planBuildingPrice = (p: RealEstatePlan): number => (p.parts?.building ?? 0) + (p.parts?.equipment ?? 0);

/** これから借りるこの物件のローン（借入の月が計算基準月か、それより後。エンジンと同じ） */
export function newPropertyLoans(h: Household, accountId: string, baseMonth: string): Debt[] {
  return (h.debts ?? []).filter((d) => {
    if (d.property !== accountId) return false;
    const s = resolveTimepoint(h, d.start);
    return s !== null && s >= baseMonth;
  });
}

/** 自己資金を空にしたときに払う額（代金＋諸費用−これから借りるこの物件のローンの借入額。0円より下げない。エンジンと同じ） */
export function planEquityDefault(h: Household, a: Account, baseMonth: string): number | null {
  const p = a.property?.planned;
  if (p === undefined) return null;
  const borrowed = newPropertyLoans(h, a.id, baseMonth).reduce((s, d) => s + d.principal, 0);
  return Math.max(0, planPrice(p) + (p.costs ?? 0) - borrowed);
}

/** 建物の固定資産税評価額の推定（建物の価格×新築の評価額の割合。1万円に丸める。建物の価格が無ければ null） */
export function planAssessedEstimate(p: RealEstatePlan): { value: number; basis: string } | null {
  const price = planBuildingPrice(p);
  if (price <= 0) return null;
  const ratio = taxGuide.buildingRatio;
  const value = Math.round((price * ratio) / 10000) * 10000;
  return {
    value,
    basis: `${PLAN_ASSESSED_BASIS}（建物の価格${manOf(price)}×新築の評価額の割合${pctOf(ratio)}。住まいの固定資産税の目安と同じ割合です。相続税の評価の材料で、評価額〔時価〕には使いません。実際の評価額が分かれば入れ直してください）`,
  };
}

const basisOf = (b: Box<number> | undefined): string | undefined => (b as { estimate?: { basis?: string } } | undefined)?.estimate?.basis;
/** 欄がこの推定のままか（FP が入れていない） */
export const isEstimatedAssessed = (b: Box<number> | undefined): boolean => b !== undefined && b.state === "estimated" && b.origin.kind === "auto" && (basisOf(b)?.startsWith(PLAN_ASSESSED_BASIS) ?? false);
const estBox = (value: number, basis: string): Box<number> => ({ value, state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis } }) as Box<number>;

/**
 * 予定の物件の建物の固定資産税評価額の推定を入れる・入れ直す（h をそのまま書き換える。refreshEstimates から）: 欄が無いか推定のままなら、
 * 建物の価格から入れ直す（建物の価格が無くなったら推定の欄を外す）。FP が入れた額は変えない
 */
export function refreshRentalPlans(h: Household): void {
  for (const a of h.accounts ?? []) {
    const p = a.property?.planned;
    if (a.kind !== "realEstate" || p === undefined) continue;
    if (p.assessed !== undefined && !isEstimatedAssessed(p.assessed)) continue;
    const e = planAssessedEstimate(p);
    if (e === null) {
      if (p.assessed !== undefined) delete p.assessed;
      continue;
    }
    if (p.assessed === undefined || p.assessed.value !== e.value || basisOf(p.assessed) !== e.basis) p.assessed = estBox(e.value, e.basis);
  }
}

/** 欄の場所（器の中の入力項目） */
const onPlan = (id: string, at: string[]) => (): Address => ({ target: { object: id }, item: "account.property", at: ["planned", ...at] });
const withAddress = (f: FieldDef, a: () => Address): FieldDef => ({ ...f, address: a });

/** 予定を足したときの目安の値に、推定の行を書く（打つと、値が変わったときに行が外れて確定になる） */
function estimatedRow(input: object, a: Address, basis: string): void {
  putRow(input as Record<string, unknown>, a, { state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis } });
}

/** 予定の時期の目安（今から1年後） */
const PLAN_AFTER_MONTHS = 12;
const PLAN_AT_BASIS = presetBasis("買う・建てる時期の目安 今から1年後");

export const UNENTERED_PLAN_RENT = "未入力（家賃を入れてください。0円で計算中）";
export const UNENTERED_LAND_VALUE = "未入力（今の土地の評価額を入れてください。0円で計算中）";

/** 「＋ 建てる・買う予定」: 土地ごと買う予定の物件を1件足す（予定の形を「持っている土地に建てる」に変えられる） */
export function addPlannedProperty(wh: WorkingHousehold, id: () => string = newId): WorkingHousehold {
  return mutate(wh, (h, req) => {
    const self = h.members.find((m) => m.kind === "self") ?? h.members[0];
    if (self === undefined) return;
    const aid = id();
    (h.accounts ??= []).push({
      id: aid,
      kind: "realEstate",
      owner: self.id,
      // 土地ごと買う予定は器の時価を計算に使わない（予定の形を「持っている土地に建てる」にすると、今の土地の評価額の欄になる）
      marketValue: confirmedBox(0),
      asOf: req.input.baseMonth,
      contributions: [],
      property: { kind: "apartment", planned: { type: "buy", at: { at: addMonths(req.input.baseMonth, PLAN_AFTER_MONTHS) } }, rental: { monthly: standardBox(0, UNENTERED_PLAN_RENT) } },
    });
    estimatedRow(req.input as unknown as object, onPlan(aid, ["at"])(), PLAN_AT_BASIS);
  });
}

/** 「＋ この土地に建てる予定」: 建物の無い物件（貸していない土地など）に、建てる予定を足す（家賃の欄を未入力で作る） */
export function addBuildPlan(wh: WorkingHousehold, accountId: string): WorkingHousehold {
  return mutate(wh, (h, req) => {
    const a = (h.accounts ?? []).find((x) => x.id === accountId);
    if (a?.property === undefined || a.property.planned !== undefined) return;
    a.property.planned = { type: "build", at: { at: addMonths(req.input.baseMonth, PLAN_AFTER_MONTHS) } };
    if (a.property.kind === undefined || a.property.kind === "land" || a.property.kind === "parking") a.property.kind = "apartment";
    a.property.rental ??= { monthly: standardBox(0, UNENTERED_PLAN_RENT) };
    estimatedRow(req.input as unknown as object, onPlan(accountId, ["at"])(), PLAN_AT_BASIS);
  });
}

/** 建てる予定を足せる物件（予定が無く、まだ貸していない物件） */
export const canAddBuildPlan = (a: Account): boolean => a.property !== undefined && a.property.planned === undefined && a.property.rental === undefined;

/** 建てる・買う予定のまとまり（予定のある物件だけ） */
export function planGroup(wh: WorkingHousehold, a: Account): GroupDef | null {
  const p = a.property?.planned;
  if (p === undefined) return null;
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const find = byId((x: Household) => x.accounts, a.id);
  const findPlan: Finder = (hh, w) => (find(hh, w) as Account | undefined)?.property?.planned as Record<string, unknown> | undefined;
  const kp = `sav/${a.id}/property/plan`;
  const buy = p.type === "buy";
  const self = h.members.find((m) => m.id === a.owner);
  const ageOf = self !== undefined ? { ageOf: (hh: Household) => hh.members.find((m) => m.id === self.id) } : {};
  const yenOf = (key: string, path: string[], label: string, level: "simple" | "detail", help: string): FieldDef =>
    withAddress(plain({ key: `${kp}/${key}`, item: "account.property", label, level, kind: "yen", basis: "once", find: findPlan, path, optional: true, help }), onPlan(a.id, path));
  const equityDefault = planEquityDefault(h, a, base);
  const loans = newPropertyLoans(h, a.id, base);
  const fields: FieldDef[] = [
    withAddress(
      plain({
        key: `${kp}/type`,
        item: "account.property",
        label: "予定の形",
        level: "simple",
        kind: "select",
        options: PLAN_TYPES,
        find: findPlan,
        path: ["type"],
        structural: true,
        help: "土地ごと買うときは、購入代金（土地・建物）を入れます。持っている土地に建てるときは、上の評価額に今の土地の評価額（時価）を入れ、建物の建築費を入れます。どちらも、その月から評価額・家賃・経費・減価償却に入れ、その月に自己資金を払います",
        // 持っている土地に建てる予定にしたら、土地の評価額がまだ0円なら「未入力」の印にする（土地ごと買う予定では器の時価を使わない）
        after: (hh, _t, v, w) => {
          const x = find(hh, w) as Account | undefined;
          if (x === undefined) return;
          if (v === "build" && (x.marketValue?.value ?? 0) === 0) x.marketValue = standardBox(0, UNENTERED_LAND_VALUE);
          if (v === "buy" && x.marketValue?.state === "estimated" && (x.marketValue.value ?? 0) === 0) x.marketValue = confirmedBox(0);
        },
      }),
      onPlan(a.id, ["type"]),
    ),
    withAddress(
      timepointField({
        key: `${kp}/at`,
        item: "account.property",
        label: buy ? "買う時期" : "建物の引き渡しの時期",
        level: "simple",
        find: findPlan,
        path: ["at"],
        help: buy ? "物件を買う（引き渡しを受ける）月です。この月から評価額・家賃収入・経費・減価償却に入れ、この月に自己資金を払います" : "建物が完成して引き渡しを受ける月です。この月から建物の評価額・家賃収入・経費・減価償却に入れ、この月に自己資金を払います（それまでは土地だけです）",
        ...ageOf,
      }),
      onPlan(a.id, ["at"]),
    ),
  ];
  if (buy) fields.push(yenOf("land", ["parts", "land"], "購入代金: 土地", "simple", "土地の代金です。減価償却はしません（売ったときの取得費に入ります）"));
  fields.push(
    yenOf("building", ["parts", "building"], buy ? "購入代金: 建物" : "建築費: 建物", "simple", buy ? "建物の本体の代金です。構造の法定耐用年数で減価償却します（中古なら、土地と建物の「建物が建った年」を入れると簡便法の年数で）" : "建物の本体の工事の費用です。構造の法定耐用年数で、新築として減価償却します"),
    yenOf("equipment", ["parts", "equipment"], buy ? "購入代金: 建物附属設備" : "建築費: 建物附属設備", "detail", "給排水・電気・ガス・空調などの設備の額です。建物とは別の耐用年数（法定15年）で減価償却します"),
  );
  if ((p.parts?.equipment ?? 0) > 0)
    fields.push(
      withAddress(
        plain({ key: `${kp}/equipmentLife`, item: "account.property", label: "建物附属設備の耐用年数", level: "detail", kind: "int", suffix: "年", min: 2, max: 50, find: findPlan, path: ["equipmentLife"], optional: true, fallback: 15, help: "定額法で減価償却します。入れなければ法定の15年（中古で買うなら簡便法に直した年数）" }),
        onPlan(a.id, ["equipmentLife"]),
      ),
    );
  fields.push(
    yenOf("costs", ["costs"], "取得の諸費用", "simple", buy ? "仲介手数料・登記の費用・不動産取得税・ローンの手数料などの合計です。予定の月に払い、建物（と建物附属設備）の分は減価償却します" : "設計の費用・登記の費用・不動産取得税・ローンの手数料などの合計です。予定の月に払い、建物（と建物附属設備）の分は減価償却します"),
    withAddress(
      plain({
        key: `${kp}/equity`,
        item: "account.property",
        label: "自己資金",
        level: "simple",
        kind: "yen",
        basis: "once",
        find: findPlan,
        path: ["equity"],
        optional: true,
        ...(equityDefault !== null ? { fallback: equityDefault } : {}),
        help: `予定の月に手元のお金（預金など）から払う額です。入れなければ、${buy ? "購入代金" : "建築費"}と取得の諸費用の合計から、これから借りるこの物件のローンの借入額を引いた額にします`,
        hint: () => (equityDefault === null ? null : `${buy ? "代金" : "建築費"}＋諸費用${loans.length > 0 ? `−ローン ${amountText(loans.reduce((s, d) => s + d.principal, 0))}` : "（ローンなし）"}`),
      }),
      onPlan(a.id, ["equity"]),
    ),
    yenBox({
      key: `${kp}/assessed`,
      item: "account.property",
      label: "建物の固定資産税評価額",
      level: "detail",
      basis: "once",
      find: findPlan,
      path: ["assessed"],
      optional: true,
      help: "建てた・買った年の、建物（設備を含む）の固定資産税評価額です。相続税の評価の材料にします（キャッシュフロー表・バランスシートの評価額は時価のまま）。空欄なら建物の価格×新築の評価額の割合の目安で、実際の評価額（納税通知書・評価証明書）が分かれば入れ直します",
      estimate: (hh, w) => {
        const x = (find(hh, w) as Account | undefined)?.property?.planned;
        return x === undefined ? null : planAssessedEstimate(x);
      },
    }),
  );
  const price = planPrice(p);
  return {
    key: kp,
    title: `建てる・買う予定（${planText(h, a) ?? ""}${price > 0 ? `・${amountText(price)}` : ""}）`,
    level: "simple",
    note: PLAN_INHERITANCE_NOTE,
    moreLabel: "建物附属設備・固定資産税評価額などを入れる",
    fields,
    actions: [],
  };
}
