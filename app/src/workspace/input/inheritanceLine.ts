// 相続・贈与のカードの「相続税の目安」の1行（作業の層。0039 の結果を読むだけ）。
// 今の世帯の要求に相続税の目安（いま亡くなったら・二人とも亡くなった後）を求めて1回だけ計算し、入力項目の要約の下の小さな1行とパネルの1行に出す。
// 表示だけで、お金の流れ・世帯の物は変えない（求めるのは画面の側の写しの要求）。計算の道が無い所（画面の確かめなど）では出さない
import { useEffect, useMemo, useState } from "preact/hooks";
import type { EngineRequest, Household, InheritancePoint, InheritanceTimelineRow, PreviewResult } from "../../engine/types.ts";
import type { WorkingHousehold } from "./household.ts";
import { manText } from "./items.ts";
import { bothAfterLabel, memberLabel } from "./labels.ts";
import { divisionText, isDetailed, landTargets, withLandEstimates } from "./inheritanceLand.ts";

/** 一次と二次の推移で比較する分け方（0251。入れた分け方の配偶者の割合だけを替える。spouseShare の省略は法定相続分） */
export const TIMELINE_ALTERNATIVES = [
  { key: "legal" },
  { key: "spouseAll", spouseShare: "1" },
  { key: "spouseLandsOnly", spouseShare: "0" },
] as const;

/**
 * 相続税の目安を求める要求（今の世帯の写し。万一の想定・必要保障額の推移は外す）。timeline は相続税も試算する世帯で、一次と二次の推移
 * （毎年・比較する分け方つき。0251）も求める（入力項目の下の目安だけ。結果のタブのポイントは求めない）
 */
export function inheritanceRequest(req: EngineRequest, o: { timeline?: boolean } = {}): EngineRequest {
  const out = structuredClone(req);
  delete out.input.contingencies;
  delete out.input.protection;
  // 相続税も試算する世帯は、建物の固定資産税評価額の推定を足す（世帯には保存しない。0231）
  const t = withLandEstimates(req.input.inheritanceTax ?? {}, req);
  out.input.inheritanceTax = { ...t, points: ["now", "bothAfter"], ...(o.timeline === true && t.detailed === true ? { timeline: { alternatives: TIMELINE_ALTERNATIVES.map((a) => ({ ...a })) } } : {}) };
  out.trace = "none";
  return out;
}

const pointText = (p: InheritancePoint): string | null => {
  if (p.status === "noData") return null;
  if (p.status === "noHeirs") return "相続人がいないので出していません";
  if (p.state === "confirmed") return `${manText(p.amount)}万円（FP が入れた額）`;
  return p.noTax ? "かからない見込み" : `約${manText(p.payable)}万円`;
};

/**
 * 入力項目の要約の下の小さな1行（「相続税（二人とも亡くなった後）: かからない見込み」「相続税（二人とも亡くなった後）: 約120万円」。一人の世帯は「相続税（表の最後の年）: …」）。
 * 二人とも亡くなった後（一人の世帯は表の最後の年）の目安。無ければ、いまの目安の大きい方。主な表示は入れた中身（items.ts。0060 の 2026-10-29 の追記）
 */
export function inheritanceTaxNote(r: PreviewResult | null, h: Household): string | null {
  const points = (r?.inheritanceTax?.points ?? []).filter((p) => p.status === "ok");
  const p = points.find((x) => x.point === "bothAfter") ?? [...points].sort((a, b) => b.payable - a.payable)[0];
  if (p === undefined) return null;
  // どの場面の相続税かを書く（二人とも亡くなった後の目安と、いま亡くなったときの目安は額が大きく違う。0041 の追記 2026-11-06）
  const head = `相続税（${p.point === "bothAfter" ? bothAfterLabel(h) : "いま亡くなったら"}）`;
  if (p.state === "confirmed") return `${head}: ${manText(p.amount)}万円`;
  return p.noTax ? `${head}: かからない見込み` : `${head}: 約${manText(p.payable)}万円`;
}

/** 相続税の目安の計算（今の世帯が変わったら計算し直す）。計算の道が無ければ null のまま。timeline は一次と二次の推移も求める（相続・贈与の入力項目の中だけ。0251） */
export function useInheritanceEstimate(wh: WorkingHousehold, active: boolean, computeOne: ((req: EngineRequest) => Promise<PreviewResult | null>) | undefined, o: { timeline?: boolean } = {}): PreviewResult | null {
  const timeline = o.timeline === true;
  const req = useMemo(() => (active && computeOne !== undefined ? inheritanceRequest(wh.request, { timeline }) : null), [active, computeOne, wh.request, timeline]);
  const [res, setRes] = useState<{ req: EngineRequest; r: PreviewResult | null } | null>(null);
  useEffect(() => {
    if (req === null || computeOne === undefined) return;
    let alive = true;
    void computeOne(req).then(
      (r) => alive && setRes({ req, r }),
      () => alive && setRes({ req, r: null }),
    );
    return () => {
      alive = false;
    };
  }, [req, computeOne]);
  // 計算し直している間は、前の結果を見せておく（数字が消えてちらつかないように）
  return req === null ? null : (res?.r ?? null);
}

// ---- 相続・贈与のカードの目安の内訳（時点ごと・内訳・含めていないもの・FP が入れた額）と遺したい額 ----

/** 当たりそうな、入れていない決まりの知らせ（エンジンの cautions） */
export const CAUTION_TEXT: Readonly<Record<string, string>> = {
  twentyPercentSurcharge: "兄弟姉妹・祖父母が相続人です。その人の税の2割加算は目安に入れていません",
  smallLandSpecial: "持ち家があります。小規模宅地等の特例（自宅の土地の評価を下げる）で、税が大きく下がることがあります",
  adoptedLimit: "法定相続人の数に入れない養子がいます（実子がいれば1人・いなければ2人まで）",
  settlementGiftToNonHeir: "相続人でない人への相続時精算課税の贈与があります（その人も相続税を納めます）",
  noHeirs: "相続人がいないので、税を出していません",
  // 相続税も試算する世帯（0231）
  smallLandNotSet: "小規模宅地等の特例の取得する人を選んでいない土地があります（選ぶまで特例を使いません）",
  smallLandAreaMissing: "土地の面積が無いので、小規模宅地等の特例を使っていない土地があります",
  smallLandAreaLimit: "小規模宅地等の特例の面積の上限を超えた分は、減らしていません（減る額の大きい土地から適用）",
  smallLandRecentRental: "貸し始めて3年以内の貸付があります（事業的規模の貸付を3年を超えて続けていなければ、貸付の特例の対象になりません）",
  landInputMissing: "土地の評価の入れ方に要る値（路線価と面積・固定資産税評価額・倍率）が無い土地は、時価×評価の割合で見ています",
  divisionAdjusted: "取得する土地の評価や、前に相続時精算課税でもらった財産が、分け方の割合の分より大きい人がいるので、その人の取得をその額まで増やし、ほかの人の分を割合の比で減らしました",
  divisionSharesInvalid: "子の割合の合計が100%になっていないので、入れた割合を使わず法定相続分どおりで計算しています（入力項目の「遺産の分け方」で直せます）",
  divisionSharesIgnored: "法定相続人の数を直しているので、子ごとの割合は使わず、配偶者のほかの相続人で等分しています",
};

/** 目安に含めていない決まり（エンジンの notIncluded） */
export const NOT_INCLUDED_TEXT: Readonly<Record<string, string>> = {
  twentyPercentSurcharge: "2割加算",
  smallLandSpecial: "小規模宅地等の特例",
  landValuationDetail: "土地の評価の細部（路線価・倍率）",
  primarySecondaryComparison: "一次と二次の相続の分け方の比較",
  calendarGiftAddBack: "亡くなる前の暦年課税の贈与の加算",
  successiveInheritanceCredit: "相次相続控除",
  minorCredit: "未成年者控除",
  disabilityCredit: "障害者控除",
  receivingSideEstimate: "受け取る側の相続税（親の遺産から）",
  landCorrectionDetail: "土地の補正（奥行・間口・形。補正の率を入れたときだけ）",
};

/** 特例の状態の言葉（0231） */
const SPECIAL_TEXT: Readonly<Record<string, string>> = {
  limit: "面積の上限で使えない",
  notSet: "取得する人を選んでいない",
  notMet: "要件を満たさない",
  noArea: "面積が無い",
  within3Years: "貸し始めて3年以内",
  notLived: "住んでいない",
  notRented: "貸していない",
};
const METHOD_TEXT: Readonly<Record<string, string>> = { market: "時価×評価の割合", routePrice: "路線価×面積", multiplier: "固定資産税評価額×倍率", fixedEstimate: "固定資産税評価額×8/7" };
const BUILDING_TEXT: Readonly<Record<string, string>> = { entered: "固定資産税評価額", estimate: "固定資産税評価額の推定", market: "時価×評価の割合" };

/**
 * 「詳しく試算しますか」の一言（0231）: 相続税も試算していない世帯で、目安でかかりそうな時点（FP が入れた額でない）があり、不動産を持つときだけ。
 * 不動産が無ければ土地の試算は要らないので出さない
 */
export function detailPrompt(wh: WorkingHousehold, r: PreviewResult | null): string | null {
  if (isDetailed(wh) || landTargets(wh.request.input.household).length === 0) return null;
  const likely = (r?.inheritanceTax?.points ?? []).some((p) => p.status === "ok" && p.state === "estimated" && !p.noTax);
  return likely ? "相続税がかかりそうです。土地の評価（路線価など）と小規模宅地等の特例を入れて、詳しく試算しますか" : null;
}

const RELATION_TEXT: Readonly<Record<string, string>> = { spouse: "配偶者", child: "子", grandchild: "孫（代襲）", parent: "親", grandparent: "祖父母", sibling: "兄弟姉妹" };

/** 時点1つの見せ方 */
export interface InheritancePointView {
  /** 「いま本人が亡くなったら」 */
  title: string;
  /** 答えの1文（「かからない見込み」「約120万円」「1,000万円（FP が入れた額）」） */
  answer: string;
  /** 内訳の行 */
  details: string[];
  /** 当たりそうな、入れていない決まり */
  cautions: string[];
}

type PointFull = InheritancePoint & {
  assets: Record<string, number>;
  heirs?: { member: string; relation: string; outside: boolean; counted: boolean; adopted?: boolean }[];
  heirCountOverridden?: boolean;
  taxableEstate?: number;
  spouseReduction?: number;
  settlementCredit?: number;
};

const man = (yen: number) => `${manText(yen)}万円`;

/** 相続人がいない時点に添える1行 */
export const NO_HEIRS_HINT = "兄弟姉妹（亡くなっていれば甥・姪）がいれば、介護・親の項目の「＋ 兄弟姉妹」（詳細）で足すと、相続人に数えます";
/** 相続税の目安の不動産の評価の割合の既定（計算エンジンの inheritance.estimate の REAL_ESTATE_RATIO と同じ。時価の80%） */
const REAL_ESTATE_RATIO_DEFAULT = "0.8";

/** 内訳の分け方の言葉（0251）: 入れた分け方・法定相続分どおり（特例の減額は土地を取得する人に）・法定相続分どおり */
function divisionNote(wh: WorkingHousehold, p: InheritancePoint): string {
  // 二人とも亡くなった後は配偶者がいないので、子の割合だけを書く
  if (p.division?.entered === true) return `入れた分け方（${divisionText(wh, { spouse: p.point !== "bothAfter" }) ?? "法定相続分どおり"}）で分けたとして`;
  if (p.division !== undefined) return "法定相続分どおりに分け、特例で減った額は土地を取得する人の分から引いたとして";
  return "法定相続分どおりに分けたとして";
}

/** 時点ごとの見せ方（相続・贈与のカードの区画「相続税の目安」） */
export function inheritanceView(wh: WorkingHousehold, r: PreviewResult | null): { points: InheritancePointView[]; notIncluded: string[] } {
  const out: InheritancePointView[] = [];
  for (const p0 of r?.inheritanceTax?.points ?? []) {
    const p = p0 as PointFull;
    const answer = pointText(p);
    if (answer === null) continue;
    const title = p.point === "bothAfter" ? `${bothAfterLabel(wh.request.input.household)}（${p.month.slice(0, 4)}年）` : p.point === "contingency" ? `万一のタブで${memberLabel(wh, p.decedent)}が亡くなったら` : `いま${memberLabel(wh, p.decedent)}が亡くなったら`;
    const details: string[] = [];
    // 相続人がいない（子のいない夫婦の二人とも亡くなった後など）: 兄弟姉妹・甥姪が相続人になる世帯で、何を入れればよいかを添える
    if (p.status === "noHeirs") details.push(NO_HEIRS_HINT);
    if (p.status === "ok") {
      const a = p.assets;
      // 不動産の評価の割合（相続税の目安の設定。入れていなければ計算エンジンの既定の80%）。相続税も試算する世帯は、不動産ごとの評価の合計（下の行に内訳）
      const ratio = Number(wh.request.input.inheritanceTax?.realEstateRatio ?? REAL_ESTATE_RATIO_DEFAULT);
      const ratioText = `${String(Math.round(ratio * 1000) / 10)}%`;
      const parts = [
        `金融資産 ${man(a.financial ?? 0)}`,
        ...((a.realEstateMarket ?? 0) > 0 ? [p.lands !== undefined ? `不動産 ${man(a.realEstate ?? 0)}（時価 ${man(a.realEstateMarket ?? 0)}）` : `不動産 ${man(a.realEstate ?? 0)}（時価 ${man(a.realEstateMarket ?? 0)} の${ratioText}）`] : []),
        ...((a.insurance ?? 0) > 0 ? [`死亡保険金 ${man(a.insurance ?? 0)}（非課税 ${man(a.insuranceExempt ?? 0)}）`] : []),
        ...((a.retirement ?? 0) > 0 ? [`死亡退職金 ${man(a.retirement ?? 0)}（非課税 ${man(a.retirementExempt ?? 0)}）`] : []),
        ...((a.other ?? 0) > 0 ? [`その他 ${man(a.other ?? 0)}`] : []),
        ...((a.settlementGifts ?? 0) > 0 ? [`相続時精算課税の贈与 ${man(a.settlementGifts ?? 0)}`] : []),
        // 債務には、亡くなった人がまだ払っていない所得の税（準確定申告・住民税の残りなど）を含む（0039 の追記）
        ...((a.debts ?? 0) > 0 ? [`債務 −${man(a.debts ?? 0)}${(a.unpaidTaxes ?? 0) > 0 ? `（うち まだ払っていない税 ${man(a.unpaidTaxes ?? 0)}）` : ""}`] : []),
        ...((a.funeral ?? 0) > 0 ? [`葬式の費用 −${man(a.funeral ?? 0)}`] : []),
      ];
      details.push(`財産（${p.valuationYear}年末）: ${parts.join("・")}${(a.smallLandReduction ?? 0) > 0 ? `・小規模宅地等の特例 −${man(a.smallLandReduction ?? 0)}` : ""} → 課税価格 ${man(a.taxablePrice ?? 0)}`);
      // 相続税も試算する世帯: 不動産ごとの評価と特例（0231）
      const titles = new Map(landTargets(wh.request.input.household).map((t) => [t.object, t.title]));
      for (const l of p.lands ?? []) {
        const sp = l.special;
        const special = sp.status === "applied" ? `特例 ${sp.appliedArea !== undefined ? `${String(Math.round(Number(sp.appliedArea) * 100) / 100)}㎡ ` : ""}−${man(sp.reduction)}${sp.defaulted === true ? "（配偶者が取得するとみなした）" : ""}` : sp.status === "none" ? null : `特例なし（${SPECIAL_TEXT[sp.status] ?? sp.status}）`;
        const bits = [
          `土地 ${man(l.land)}（${METHOD_TEXT[l.method] ?? l.method}${l.rentalRatio !== undefined ? `・貸家建付地（賃貸割合${String(Math.round(Number(l.rentalRatio) * 1000) / 10)}%）` : ""}）`,
          ...(l.buildingSource !== "none" ? [`建物 ${man(l.building)}（${BUILDING_TEXT[l.buildingSource] ?? ""}${l.buildingFloor === true ? "・築年数による下限で横ばい" : ""}${l.rentalRatio !== undefined ? "・貸家" : ""}）`] : []),
          ...(special !== null ? [special] : []),
        ];
        details.push(`${titles.get(l.object) ?? "不動産"}: ${bits.join("・")}`);
      }
      const heirs = (p.heirs ?? []).filter((x) => x.counted);
      const who = heirs.map((x) => `${RELATION_TEXT[x.relation] ?? "相続人"}${x.outside ? "（世帯の外）" : ""}${x.adopted === true ? "（養子）" : ""}`);
      details.push(`法定相続人 ${String(p.heirCount)}人${p.heirCountOverridden === true ? "（直した数）" : who.length > 0 ? `（${who.join("・")}）` : ""} → 基礎控除 ${man(p.basicDeduction)}`);
      if (p.noTax) details.push(`基礎控除まで あと ${man(Math.max(0, p.margin))}`);
      else {
        const minus = [
          ...((p.surcharge ?? 0) > 0 ? [`2割加算 ＋${man(p.surcharge ?? 0)}`] : []),
          ...((p.spouseReduction ?? 0) > 0 ? [`配偶者の軽減 −${man(p.spouseReduction ?? 0)}`] : []),
          ...((p.minorCredit ?? 0) > 0 ? [`未成年者控除 −${man(p.minorCredit ?? 0)}`] : []),
          ...((p.settlementCredit ?? 0) > 0 ? [`精算課税で払った贈与税 −${man(p.settlementCredit ?? 0)}`] : []),
        ];
        details.push(`課税遺産総額 ${man(p.taxableEstate ?? 0)} → 税の総額 ${man(p.totalTax)}${minus.length > 0 ? `（${minus.join("・")}）` : ""} → 納める額 ${man(p.payable)}（世帯の人 ${man(p.payableHousehold)}${p.payableOutside > 0 ? `・世帯の外の相続人 ${man(p.payableOutside)}` : ""}。${divisionNote(wh, p)}）`);
      }
      // 分け方（0251）: 人ごとの取得と納める額（相続税も試算する世帯で、分け方を入れたか、特例の減額を取得する人に寄せたとき）
      if (p.division !== undefined && (p.byHeir ?? []).length > 0)
        details.push(
          `人ごと: ${(p.byHeir ?? [])
            .map((b) => `${b.member !== undefined ? memberLabel(wh, b.member) : `ほかの${String(b.count ?? 0)}人`} 取得 ${man(b.acquisition)}${(b.landReduction ?? 0) > 0 ? `（特例 −${man(b.landReduction ?? 0)}）` : ""}・納める額 ${man(b.payable)}`)
            .join("、")}`,
        );
      if (p.state === "confirmed") details.push(`目安は ${p.noTax ? "かからない見込み" : `約${man(p.payable)}`}（FP が入れた額を使っています）`);
    }
    out.push({ title, answer, details, cautions: p.cautions.map((c) => CAUTION_TEXT[c] ?? c) });
  }
  const hasTimeline = r?.inheritanceTax?.timeline !== undefined;
  return { points: out, notIncluded: (r?.inheritanceTax?.notIncluded ?? []).map((x) => (x === "successiveInheritanceCredit" && hasTimeline ? "相次相続控除（一次と二次の推移の二次には入れています）" : (NOT_INCLUDED_TEXT[x] ?? x))) };
}

// ---- 一次と二次の相続税の推移（0251。相続税も試算する夫婦の世帯だけ） ----

/** 分け方の名前（推移の比較の行）。配偶者は残された人（後に亡くなる人）の呼び名を添える */
export const SERIES_LABEL: Readonly<Record<string, (survivor: string) => string>> = {
  entered: () => "入れた分け方",
  legal: () => "法定相続分どおり",
  spouseAll: (n) => `残された${n}が全部取得する`,
  spouseLandsOnly: (n) => `残された${n}は取得する土地だけ`,
};

export interface TimelineView {
  /** 「ご本人が先に亡くなるとして（年は表の行）、配偶者は2071年12月に亡くなるとして」 */
  lead: string;
  /** 表の上に出す前提の1文（一次で取得したお金は二次まで使わないとして） */
  premise: string;
  /** 二次を計算していない理由（二次の相続人がいない）。計算していれば null */
  secondaryMissing: string | null;
  /** 入れた分け方の名前（入れていなければ「法定相続分どおり」） */
  entered: string;
  /** 入れた分け方の年ごとの行 */
  rows: InheritanceTimelineRow[];
  /** 比較する分け方（入れた分け方が法定相続分どおりなら、法定相続分の行は出さない） */
  series: { key: string; label: string; rows: InheritanceTimelineRow[] }[];
  /** 二次の税に入れた控除と、二次の財産の決め方の注意 */
  notes: string[];
}

/** 一次と二次の推移の見せ方。推移が無い（試算しない・夫婦でない・計算の道が無い）ときは null */
export function timelineView(wh: WorkingHousehold, r: PreviewResult | null): TimelineView | null {
  const tl = r?.inheritanceTax?.timeline;
  const entered = tl?.series.find((s) => s.key === "entered");
  if (tl === undefined || entered === undefined || entered.rows.length === 0) return null;
  const d = wh.request.input.inheritanceTax?.division;
  const enteredText = divisionText(wh);
  const plainLegal = d?.spouseShare === undefined;
  const survivor = memberLabel(wh, tl.second);
  const series = tl.series
    .filter((s) => !(s.key === "legal" && plainLegal))
    .map((s) => ({ key: s.key, label: s.key === "entered" ? (enteredText !== null ? `入れた分け方（${enteredText}）` : "法定相続分どおり") : (SERIES_LABEL[s.key]?.(survivor) ?? s.key), rows: s.rows }));
  return {
    lead: `${memberLabel(wh, tl.first)}が先に亡くなるとして（年は表の行）、${survivor}は${tl.secondMonth.slice(0, 4)}年${String(Number(tl.secondMonth.slice(5, 7)))}月に亡くなるとして`,
    premise: "一次で取得したお金は、二次まで使わない（増えも減りもしない）として出しています",
    secondaryMissing: tl.secondaryStatus === "noHeirs" ? `二次は計算していません（${survivor}の相続人〔兄弟姉妹など〕が入っていません）。${NO_HEIRS_HINT}` : null,
    entered: enteredText !== null ? `入れた分け方（${enteredText}）` : "法定相続分どおり",
    rows: entered.rows,
    series,
    notes: [
      "一次は、今年はいまの時点、ほかの年はその年の12月に亡くなるとして、その年の年末の財産で出しています",
      "二次の財産は、後に亡くなる人の名義の財産（表の年末）に、一次で取得した財産（土地・建物は二次の年の評価、ほかは一次の時点の額から一次で納めた額を引いた額）を足しています。一次で取得したお金は二次まで増えも減りもしないとみなします",
      "二次は相次相続控除（一次から10年以内）と、一次で受けた未成年者控除の残りを入れています。二次の自宅などの特例は、土地ごとに二次の相続の取得する人を選ぶまで使いません",
    ],
  };
}

/** 推移の表に出す年（5年ごと・最初と最後の年。all なら毎年） */
export function timelineYears(rows: readonly InheritanceTimelineRow[], all: boolean): InheritanceTimelineRow[] {
  if (all || rows.length <= 8) return [...rows];
  const first = rows[0]?.year ?? 0;
  return rows.filter((x, i) => i === 0 || i === rows.length - 1 || (x.year - first) % 5 === 0);
}

/** 比較の行のうち合計がいちばん少ない分け方（同じなら前の行）。二次を計算していないときは出さない */
export function cheapestAt(view: TimelineView, year: number): { label: string; total: number } | null {
  if (view.secondaryMissing !== null) return null;
  let best: { label: string; total: number } | null = null;
  for (const s of view.series) {
    const row = s.rows.find((x) => x.year === year);
    if (row !== undefined && (best === null || row.total < best.total)) best = { label: s.label, total: row.total };
  }
  return best;
}

/**
 * 遺したい額と、表の最後の年の金融資産の比較（相続税の目安を求めた計算の表から読む。お金の流れは同じ）。
 * 遺したい額は今の値段なので、前提の物価上昇率で表の最後の年の値段にして比較する。遺したい額が無い・表が無ければ null
 */
export function legacyLine(wh: WorkingHousehold, r: PreviewResult | null): string | null {
  const amount = wh.request.input.legacy?.amount?.value ?? null;
  if (amount === null || r === null) return null;
  const end = wh.request.input.endYear;
  const cells = r.table.filter((c) => c.row === "cf.balance.financial" && c.year === end);
  if (cells.length === 0) return null;
  const fin = cells.reduce((s, c) => s + c.amount, 0);
  const base = Number(wh.request.input.baseMonth.slice(0, 4));
  const inf = Number(wh.request.input.assumptions?.inflation?.default ?? "0");
  const target = Math.round(amount * (1 + inf) ** Math.max(0, end - base));
  const diff = fin - target;
  return `表の最後の年（${String(end)}年）の金融資産 約${man(fin)} ／ 遺したい額 ${man(amount)}（物価上昇率で${String(end)}年の値段にすると 約${man(target)}）→ ${diff >= 0 ? `足ります（約${man(diff)} 多い）` : `約${man(-diff)} 足りません`}`;
}
