// 相続税の試算（相続・贈与の入力項目。0231）: 「相続税も試算する」にチェックした世帯だけ、不動産ごとに土地の面積・評価の入れ方・建物の評価・
// 貸している割合・小規模宅地等の特例の種類と取得する人（一次・二次）を入れる。値は相続税の目安の設定（input.inheritanceTax の detailed・lands）に置き、
// 時点の無い設定なので毎回の計算には入らない（engine/moneyRows.ts の withoutStoredSettings）。チェックしない世帯の入力は増やさない（区画は詳細の1つの欄だけ）
// - 建物の固定資産税評価額を入れていない不動産は、固定資産税の目安（0112・0181）と同じ式の建物の評価額を、計算の要求を作るときだけ
//   buildingEstimate に入れる（世帯には保存しない。withLandEstimates）
import type { Account, EngineRequest, Household, InheritanceLandSetting, InheritanceTaxRequest, Residence, SmallLandChoice } from "../../engine/types.ts";
import { field, resolveTimepoint, type FieldDef, type GroupDef, type Option, type SectionDef } from "./form.ts";
import { mutate, type WorkingHousehold } from "./household.ts";
import { accountLabelOf, HELD_ESTATE_SUBTYPES, VALUATION_DEFAULTS } from "./labels.ts";
import { hasExecutive } from "./officer.ts";
import { ownedHomeTaxInputs } from "./ownedHomeTax.ts";
import { buildingValueRatio, propertyTaxInputs, taxGuide } from "./propertyTax.ts";
import type { Address } from "../store/readings.ts";

type Use = NonNullable<InheritanceLandSetting["use"]>;
type Acquirer = SmallLandChoice["acquirer"];

/** 試算の対象の不動産（持ち家・住まい以外の不動産） */
export interface LandTarget {
  object: string;
  kind: "home" | "rental" | "held";
  title: string;
}

/** 試算の対象の不動産の並び（持ち家〔購入の予定を含む〕・貸している不動産・貸していない不動産の順） */
export function landTargets(h: Household): LandTarget[] {
  const homes = (h.residences ?? []).filter((r) => r.kind === "own");
  const out: LandTarget[] = homes.map((r, i) => ({ object: r.id, kind: "home", title: `${r.purchase !== undefined ? "購入する家" : "持ち家"}${homes.length > 1 ? ` ${String(i + 1)}` : ""}` }));
  const estates = (h.accounts ?? []).filter((a) => a.kind === "realEstate");
  estates.forEach((a, i) => {
    const rental = a.property !== undefined;
    const sub = a.subtype !== undefined && a.subtype in HELD_ESTATE_SUBTYPES ? HELD_ESTATE_SUBTYPES[a.subtype as keyof typeof HELD_ESTATE_SUBTYPES].short : null;
    const name = (rental ? a.property?.name?.trim() : null) || accountLabelOf(a) || (rental ? `物件${String(i + 1)}` : (sub ?? `不動産 ${String(i + 1)}`));
    out.push({ object: a.id, kind: rental && a.property?.rental !== undefined && a.property.lodging === undefined ? "rental" : "held", title: name });
  });
  return out;
}

// ---- 建物の固定資産税評価額の推定（固定資産税の目安と同じ式。計算基準年の額） ----

const landShareSetting = (req: EngineRequest): string | undefined => (req.input.assumptions?.realEstateValuation as { landShare?: string } | undefined)?.landShare;

/** 建物の固定資産税評価額の推定（計算基準年。持ち始めが後ならその年の新しい家の額）。推定の元が無ければ null */
export function buildingEstimateOf(req: EngineRequest, object: string): number | null {
  const h = req.input.household;
  const baseYear = Number(req.input.baseMonth.slice(0, 4));
  const ratio = taxGuide.buildingRatio;
  const r = (h.residences ?? []).find((x) => x.id === object);
  if (r !== undefined) {
    const own = ownedHomeTaxInputs(h, r, req.input.baseMonth, req.input.endYear, landShareSetting(req));
    if (own !== null) {
      const built = own.builtYear ?? own.valueYear;
      return Math.round(own.value * (1 - Number(own.landShare)) * ratio * buildingValueRatio(own.structure, built, own.valueYear, Math.max(baseYear, own.fromYear ?? baseYear)));
    }
    const buy = propertyTaxInputs(h, r as Residence, req.input.endYear, landShareSetting(req));
    if (buy !== null) return Math.round(buy.price * (1 - buy.landShare) * ratio);
    return null;
  }
  const a = (h.accounts ?? []).find((x) => x.id === object);
  const p = a?.property;
  const value = a?.marketValue?.value ?? null;
  if (a === undefined || p === undefined || value === null || !(value > 0)) return null;
  const share = Number(p.landShare ?? landShareSetting(req) ?? VALUATION_DEFAULTS.landShare);
  if (!(share < 1)) return null;
  const valueYear = Number((a.asOf ?? req.input.baseMonth).slice(0, 4));
  const structure = p.structure ?? "wood";
  return Math.round(value * (1 - share) * ratio * buildingValueRatio(structure, p.builtYear ?? valueYear, valueYear, Math.max(baseYear, valueYear)));
}

/** 相続税を求める要求の設定に、建物の評価の推定を足す（相続税も試算する世帯だけ。世帯の設定は変えない） */
export function withLandEstimates(t: InheritanceTaxRequest, req: EngineRequest): InheritanceTaxRequest {
  if (t.detailed !== true) return t;
  const stored = new Map((t.lands ?? []).map((l) => [l.object, l]));
  const lands: InheritanceLandSetting[] = [];
  for (const target of landTargets(req.input.household)) {
    const l = stored.get(target.object);
    stored.delete(target.object);
    if (l?.buildingValue !== undefined) {
      lands.push(l);
      continue;
    }
    const est = buildingEstimateOf(req, target.object);
    if (est !== null) lands.push({ ...(l ?? { object: target.object }), buildingEstimate: est });
    else if (l !== undefined) lands.push(l);
  }
  // 物が無くなった設定はそのまま渡す（計算は読まない）
  lands.push(...stored.values());
  return { ...t, lands };
}

// ---- 世帯の設定の読み書き ----

const taxOf = (wh: WorkingHousehold): InheritanceTaxRequest => wh.request.input.inheritanceTax ?? {};
const landOf = (wh: WorkingHousehold, object: string): InheritanceLandSetting | undefined => taxOf(wh).lands?.find((l) => l.object === object);
const onInput = (at: string[]) => (): Address => ({ target: { plan: "input" }, item: "plan.inheritanceTax", at });

/** 相続税の目安の設定を書き換える（空になった欄・物を消す） */
function writeTax(wh: WorkingHousehold, fn: (t: InheritanceTaxRequest) => void): WorkingHousehold {
  return mutate(wh, (_h, req) => {
    const t: InheritanceTaxRequest = structuredClone(req.input.inheritanceTax ?? {});
    fn(t);
    if (t.lands !== undefined) {
      t.lands = t.lands.filter((l) => Object.keys(l).some((k) => k !== "object" && (l as unknown as Record<string, unknown>)[k] !== undefined));
      if (t.lands.length === 0) delete t.lands;
    }
    if (t.detailed !== true) delete t.detailed;
    for (const k of Object.keys(t) as (keyof InheritanceTaxRequest)[]) if (t[k] === undefined) delete t[k];
    if (Object.keys(t).length === 0) delete req.input.inheritanceTax;
    else req.input.inheritanceTax = t;
  });
}

/** 不動産1つの設定を書き換える */
function writeLand(wh: WorkingHousehold, object: string, fn: (l: Record<string, unknown>) => void): WorkingHousehold {
  return writeTax(wh, (t) => {
    const lands = [...(t.lands ?? [])];
    const i = lands.findIndex((l) => l.object === object);
    const l: Record<string, unknown> = structuredClone(i < 0 ? { object } : lands[i]) as unknown as Record<string, unknown>;
    fn(l);
    for (const k of Object.keys(l)) if (l[k] === undefined || l[k] === null || l[k] === "") delete l[k];
    if (i < 0) lands.push(l as unknown as InheritanceLandSetting);
    else lands[i] = l as unknown as InheritanceLandSetting;
    t.lands = lands;
  });
}

/** 相続税も試算するか（チェックを外しても入れた設定は残す。チェックし直せば同じ値で計算する） */
export const isDetailed = (wh: WorkingHousehold): boolean => taxOf(wh).detailed === true;
export const setDetailed = (wh: WorkingHousehold, on: boolean): WorkingHousehold => writeTax(wh, (t) => (t.detailed = on ? true : undefined));

// ---- 欄 ----

const DETAILED_HELP =
  "チェックすると、不動産ごとに土地の面積・評価の入れ方（路線価・倍率など）・建物の固定資産税評価額・小規模宅地等の特例を入れて、相続税を試算します（2割加算・未成年者控除も入れます）。チェックしなければ、今までどおり不動産を時価の80%で見た目安を出します。どちらも表示だけで、お金の流れには入れません";

/** 「相続税も試算する」の欄 */
export function detailedField(level: "simple" | "detail"): FieldDef {
  return field({
    key: "inherit/tax/detailed",
    item: "plan.inheritanceTax",
    label: "相続税も試算する（土地の評価・小規模宅地等の特例）",
    level,
    kind: "bool",
    optional: true,
    help: DETAILED_HELP,
    get: (w) => ({ value: isDetailed(w), implicit: !isDetailed(w) }),
    set: (w, v) => setDetailed(w, v === true),
    address: onInput(["detailed"]),
  });
}

const METHOD_OPTIONS: Option[] = [
  { value: "market", label: "時価×評価の割合（路線価が分からない）" },
  { value: "routePrice", label: "路線価×面積（路線価地域）" },
  { value: "multiplier", label: "固定資産税評価額×倍率（倍率地域）" },
  { value: "fixedEstimate", label: "固定資産税評価額から推定（×8/7）" },
];
const LEASEHOLD_OPTIONS: Option[] = (["A", "B", "C", "D", "E", "F", "G"] as const).map((k, i) => ({ value: k, label: `${k}（${String(90 - i * 10)}%）` }));
const USE_LABEL: Readonly<Record<Use, string>> = {
  residence: "自宅（特定居住用。330㎡まで80%減）",
  rental: "貸付（貸付事業用。200㎡まで50%減）",
  business: "事業に使っている（特定事業用。400㎡まで80%減）",
  familyCompany: "自分の会社に貸している（特定同族会社事業用。400㎡まで80%減）",
  none: "特例を使わない",
};
const ACQUIRER_LABEL: Readonly<Record<Use, Partial<Record<Acquirer, string>>>> = {
  residence: { spouse: "配偶者（要件なし）", cohabiting: "同居の親族", noHome: "持ち家の無い親族（いわゆる家なき子）", other: "要件を満たす人がいない" },
  rental: { spouse: "配偶者", successor: "貸付を引き継ぐ親族", other: "要件を満たす人がいない" },
  business: { spouse: "配偶者", successor: "事業を引き継ぐ親族", other: "要件を満たす人がいない" },
  familyCompany: { spouse: "配偶者", successor: "会社の役員である親族", other: "要件を満たす人がいない" },
  none: {},
};
const MET_HELP: Readonly<Record<Use, string>> = {
  residence:
    "取得する人が要件を満たすかを確かめてチェックします（ソフトは判定しません）。同居の親族: 亡くなるまで同居し、申告期限（10か月後）まで住み続けて持ち続ける。持ち家の無い親族: 亡くなった人に配偶者も同居の相続人もおらず、取得する人が相続の前3年以内に自分・配偶者・3親等内の親族・関係のある法人の持ち家に住んだことがなく、住んでいる家を過去に持ったことがなく、申告期限まで持ち続ける",
  rental: "取得する人が、申告期限まで貸付を続け、持ち続けるかを確かめてチェックします（ソフトは判定しません）",
  business: "取得する人が、申告期限までに事業を引き継ぎ、申告期限まで続けて持ち続けるかを確かめてチェックします（ソフトは判定しません。相続の前3年以内に始めた事業は、事業の規模の要件があります）",
  familyCompany: "取得する人が、申告期限に会社の役員で、申告期限まで持ち続けるかを確かめてチェックします（ソフトは判定しません。会社は亡くなった人と親族などで発行済株式の50%超を持つ法人で、土地を事業〔不動産貸付業を除く〕に使っていること）",
  none: "",
};
const SPECIAL_HELP =
  "小規模宅地等の特例で土地の評価を減らします。取得する人と、その人が要件を満たすかは、利用者が選んでチェックします（ソフトは要件を判定しません）。面積の上限は、貸付を入れないとき自宅330㎡・事業400㎡を別々に、入れるとき「自宅×200/330＋事業×200/400＋貸付≦200㎡」で、減る額の大きい土地から適用します。老人ホームに入った人の自宅・二世帯住宅・店舗併用住宅の細かい条件は入れていません";

/** その世帯で選べる特例の種類（自営の働き方のある世帯は事業、役員の世帯は自分の会社に貸している土地。今の値は残す） */
function useOptions(h: Household, t: LandTarget, current: Use | undefined): Option[] {
  const selfEmployed = (h.employmentPeriods ?? []).some((p) => p.type === "selfEmployed");
  const uses: Use[] = t.kind === "home" ? ["residence"] : t.kind === "rental" ? ["rental"] : [];
  if (t.kind !== "home" && selfEmployed) uses.push("business");
  if (t.kind !== "home" && hasExecutive(h)) uses.push("familyCompany");
  if (t.kind === "held") uses.push("rental");
  if (current !== undefined && !uses.includes(current) && current !== "none") uses.push(current);
  uses.push("none");
  return uses.map((u) => ({ value: u, label: USE_LABEL[u] }));
}
const defaultUse = (t: LandTarget): Use => (t.kind === "home" ? "residence" : t.kind === "rental" ? "rental" : "none");

/** 貸し始めが計算基準月の3年以内か（貸付の特例の3年の決まりの欄を出すか） */
function recentRental(h: Household, a: Account | undefined, baseMonth: string): boolean {
  const from = a?.property?.rental?.from;
  const ym = from === undefined ? (a?.property?.acquisition?.at ?? null) : resolveTimepoint(h, from);
  if (ym === null) return false;
  const idx = (s: string) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)) - 1;
  return idx(ym) > idx(baseMonth) - 36;
}

/** 不動産1つの欄のまとまり */
function landGroup(wh: WorkingHousehold, t: LandTarget, couple: boolean): GroupDef {
  const h = wh.request.input.household;
  const k = `inherit/land/${t.object}`;
  const l = landOf(wh, t.object);
  const at = onInput(["lands"]);
  const base = { item: "plan.inheritanceTax", optional: true, address: at };
  const get = <T>(read: (x: InheritanceLandSetting) => T | undefined) => (w: WorkingHousehold) => ({ value: (() => {
    const x = landOf(w, t.object);
    const v = x === undefined ? undefined : read(x);
    return v === undefined ? null : (v as unknown as string | number | boolean);
  })() });
  const put = (name: string, conv: (v: unknown) => unknown = (v) => v) => (w: WorkingHousehold, v: unknown) => writeLand(w, t.object, (x) => (x[name] = v === null || v === "" ? undefined : conv(v)));
  const account = (h.accounts ?? []).find((a) => a.id === t.object);
  const fields: FieldDef[] = [];
  const method = l?.method ?? "market";
  const ratio = Number(taxOf(wh).realEstateRatio ?? "0.8");
  const landArea = account?.property?.area?.land;
  fields.push(
    field({
      ...base,
      key: `${k}/area`,
      label: "土地の面積",
      level: "simple",
      kind: "decimal",
      suffix: "㎡",
      ...(landArea !== undefined ? { blankMeans: `${landArea}㎡（物件の土地の面積）` } : {}),
      help: "物件全体の土地の面積です（登記簿・固定資産税の課税明細書の地積）。マンションは敷地全体の面積×敷地権の割合。小規模宅地等の特例の面積の上限と、路線価×面積の計算に使います。名義を夫婦で分けていれば、亡くなる人の分は名義の割合で分けます",
      get: get((x) => x.area),
      set: put("area", (v) => String(v)),
    }),
    field({
      ...base,
      key: `${k}/method`,
      label: "土地の評価の入れ方",
      level: "simple",
      kind: "select",
      options: METHOD_OPTIONS,
      blankMeans: `時価×${String(Math.round(ratio * 1000) / 10)}%`,
      help: "路線価のある地域は路線価（1㎡あたり。国税庁の路線価図）×面積、倍率地域は土地の固定資産税評価額×倍率（評価倍率表）。どちらも分からなければ、固定資産税評価額×8/7（評価額は公示価格の7割程度、路線価は8割程度を目安に定められるため）か、時価×評価の割合（今の目安）。奥行・間口・形の補正は、補正したいときだけ「補正の率」に入れます",
      get: (w) => ({ value: landOf(w, t.object)?.method ?? "market", implicit: landOf(w, t.object)?.method === undefined }),
      set: put("method", (v) => (v === "market" ? undefined : v)),
    }),
  );
  if (method === "routePrice")
    fields.push(field({ ...base, key: `${k}/routePrice`, label: "路線価（1㎡あたり）", level: "simple", kind: "yen", basis: "once", unit: "yen", help: "国税庁の路線価図の、正面の道路の価格（千円単位で書かれている値×1,000円）。計算基準年の値として入れ、ほかの年は土地の評価額の推移と同じ割合で動かします", get: get((x) => x.routePrice), set: put("routePrice", Number) }));
  if (method === "multiplier" || method === "fixedEstimate")
    fields.push(field({ ...base, key: `${k}/fixedValue`, label: "土地の固定資産税評価額", level: "simple", kind: "yen", basis: "once", help: "固定資産税の課税明細書の土地の「価格（評価額）」（課税標準額ではない値）。物件全体の額です", get: get((x) => x.fixedValue), set: put("fixedValue", Number) }));
  if (method === "multiplier")
    fields.push(field({ ...base, key: `${k}/multiplier`, label: "評価倍率", level: "simple", kind: "decimal", suffix: "倍", help: "国税庁の評価倍率表の、その地域の宅地の倍率", get: get((x) => x.multiplier), set: put("multiplier", (v) => String(v)) }));
  if (method !== "market" || l?.adjustment !== undefined)
    fields.push(field({ ...base, key: `${k}/adjustment`, label: "補正の率", level: "detail", kind: "pct", min: 0, max: 200, blankMeans: "100%（補正しない）", help: "奥行価格補正・間口狭小補正・不整形地補正などを掛けた率（例 95%）。入れなければ補正しません", get: get((x) => x.adjustment), set: put("adjustment", (v) => String(v)) }));
  // 建物（固定資産税評価額。入れなければ固定資産税の目安と同じ式の推定）
  if (t.kind !== "held" || account?.property !== undefined || l?.buildingValue !== undefined) {
    const est = buildingEstimateOf(wh.request, t.object);
    fields.push(
      field({
        ...base,
        key: `${k}/building`,
        label: "建物の固定資産税評価額",
        level: "simple",
        kind: "yen",
        basis: "once",
        blankMeans: est !== null ? `推定 約${(Math.round(est / 10000)).toLocaleString("ja-JP")}万円（固定資産税の目安と同じ式）` : "時価×評価の割合",
        help: "固定資産税の課税明細書の家屋の「価格（評価額）」。相続税では建物はこの額で評価します。入れなければ、固定資産税の目安と同じ式（建物の価格×新築の評価額の割合、評価替えごとの経年減点補正率）で推定します",
        get: get((x) => x.buildingValue),
        set: put("buildingValue", Number),
      }),
    );
  }
  if (t.kind === "rental") {
    const vac = account?.property?.rental?.vacancyRate;
    const full = account?.property?.rental?.rentBy === "actual";
    fields.push(
      field({ ...base, key: `${k}/rentalRatio`, label: "賃貸割合", level: "detail", kind: "pct", min: 0, max: 100, blankMeans: full ? "100%" : `${String(Math.round((1 - Number(vac ?? "0")) * 1000) / 10)}%（1−空室率）`, help: "貸している床面積の割合。一時的な空室（すぐ次の人を募集し、空いていたのが1か月程度など）は貸しているとみなせます。入れなければ1−空室率（今の家賃で入れた物件は100%）。亡くなる月に貸していなければ0%として計算します", get: get((x) => x.rentalRatio), set: put("rentalRatio", (v) => String(v)) }),
      field({ ...base, key: `${k}/leasehold`, label: "借地権割合（路線価図の記号）", level: "detail", kind: "select", options: LEASEHOLD_OPTIONS, blankMeans: "D（60%）", help: "貸家建付地の減額（土地の評価×借地権割合×借家権割合30%×賃貸割合）に使います。路線価図の路線価の後ろの記号（A 90%〜G 30%）。入れなければ D（60%。住宅地で多い区分の低い方）", get: get((x) => x.leaseholdRatio), set: put("leaseholdRatio") }),
    );
  }
  // 小規模宅地等の特例
  const use: Use = l?.use ?? defaultUse(t);
  fields.push(field({ ...base, key: `${k}/use`, label: "小規模宅地等の特例", level: "simple", kind: "select", options: useOptions(h, t, l?.use), blankMeans: USE_LABEL[defaultUse(t)], help: SPECIAL_HELP, get: (w) => ({ value: landOf(w, t.object)?.use ?? defaultUse(t), implicit: landOf(w, t.object)?.use === undefined }), set: put("use", (v) => (v === defaultUse(t) ? undefined : v)) }));
  if (use !== "none") {
    if (use === "rental" && recentRental(h, account, wh.request.input.baseMonth))
      fields.push(field({ ...base, key: `${k}/rentalContinued`, label: "事業的規模の貸付を3年を超えて続けている", level: "simple", kind: "bool", help: "貸し始めて3年以内の貸付は、原則として特例の対象になりません。亡くなった人が相続の日まで3年を超えて事業的規模（5棟10室など）の貸付を続けていれば対象です。当てはまるときだけチェックします", get: (w) => ({ value: landOf(w, t.object)?.rentalContinued === true }), set: put("rentalContinued", (v) => (v === true ? true : undefined)) }));
    const rounds: { name: "primary" | "secondary"; label: string }[] = [{ name: "primary", label: couple ? "一次の相続（先に亡くなったとき）" : "相続のとき" }, ...(couple ? [{ name: "secondary" as const, label: "二次の相続（二人とも亡くなった後）" }] : [])];
    for (const r of rounds) {
      const labels = ACQUIRER_LABEL[use];
      const options: Option[] = (Object.keys(labels) as Acquirer[]).filter((a) => !(a === "spouse" && (r.name === "secondary" || !couple))).map((a) => ({ value: a, label: labels[a] as string }));
      const choice = l?.[r.name];
      const spouseDefault = use === "residence" && r.name === "primary" && couple;
      fields.push(
        field({
          ...base,
          key: `${k}/${r.name}/acquirer`,
          label: `取得する人（${r.label}）`,
          level: "simple",
          kind: "select",
          options,
          blankMeans: spouseDefault ? "配偶者が取得するとみなす" : "選んでいない（特例を使わない）",
          help: r.name === "secondary" ? "二人とも亡くなった後に、この土地を取得する人です（同居の子がいるかなど、一次とは違うことが多いので別に選びます）" : "この土地を取得する人です。配偶者が自宅を取得するときは要件がありません",
          get: get((x) => x[r.name]?.acquirer),
          set: (w, v) => writeLand(w, t.object, (x) => (x[r.name] = v === null || v === "" ? undefined : { ...((x[r.name] as SmallLandChoice | undefined) ?? {}), acquirer: v })),
        }),
      );
      const needsMet = choice !== undefined && choice.acquirer !== "other" && !(use === "residence" && choice.acquirer === "spouse");
      if (needsMet)
        fields.push(
          field({
            ...base,
            key: `${k}/${r.name}/met`,
            label: `取得する人が要件を満たす（${r.label}）`,
            level: "simple",
            kind: "bool",
            help: MET_HELP[use],
            get: (w) => ({ value: landOf(w, t.object)?.[r.name]?.met === true }),
            set: (w, v) => writeLand(w, t.object, (x) => {
              const c = x[r.name] as SmallLandChoice | undefined;
              if (c === undefined) return;
              x[r.name] = v === true ? { ...c, met: true } : { acquirer: c.acquirer };
            }),
          }),
        );
    }
  }
  return { key: k, title: t.title, level: "simple", fields, actions: [] };
}

/** 区画「相続税の試算」: チェックしていない世帯は詳細の1つの欄だけ。チェックした世帯は標準に出し、不動産ごとのまとまりを並べる */
export function taxDetailSection(wh: WorkingHousehold): SectionDef {
  const h = wh.request.input.household;
  const on = isDetailed(wh);
  const level = on ? "simple" : "detail";
  const couple = h.members.filter((m) => (m.kind === "self" || m.kind === "spouse") && m.expected !== true).length === 2;
  const targets = on ? landTargets(h) : [];
  const note = on
    ? targets.length > 0
      ? "不動産ごとに、土地の面積と評価の入れ方、小規模宅地等の特例の取得する人を入れます。空欄のままの不動産は時価×評価の割合で見ます。結果は下の「相続税の目安」の「内訳」に、不動産ごとの評価と特例で減った額を出します（表示だけで、お金の流れには入れません）"
      : "持ち家・住まい以外の不動産がありません。不動産を入れると、ここで土地の評価と小規模宅地等の特例を入れられます（2割加算・未成年者控除は入れています）"
    : "相続税がかかりそうな世帯で、土地の評価と小規模宅地等の特例を入れて試算するときにチェックします。チェックしなければ入力は増えません";
  return {
    key: "inherit/detail",
    title: "相続税の試算",
    note,
    level,
    groups: [{ key: "inherit/detail", level, fields: [detailedField(level)], actions: [] }, ...targets.map((t) => landGroup(wh, t, couple))],
    actions: [],
  };
}
