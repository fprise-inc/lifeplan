// 運用の利回り（assumptions.investmentReturn）を計算に使う物があるか（0260）。提案書の前提の一覧に「運用利回り」の行を出すかを決めるのに使う
// （計算には使わない。入力の形だけを見る）。計算の決まりは sdk/helpers.ts の accountReturnRate（specRate）と、plan.cashflow の器の年利・
// insurance.policy の貯蓄型の積立・protection.need の逆算方式と同じ:
// - 口座: 器の利回り（expectedReturn）があれば使わない。資産の配分が無ければ、預金・外貨預金は預金の利回り（無ければ運用の利回り）、
//   不動産は0%（か評価額の増減率）、暗号資産は0%、その他の資産・保険の器は0%（配分が無いとき）、ほかの器は運用の利回り。
//   資産の配分の種類は、資産の種類ごとの利回りがあればそれ、無ければ預金の種類は預金の利回り、不動産は0%、ほかは運用の利回り。
//   利回りの段階の段も同じ。資産配分の入れ方（allocation）は、運用する器に共通の配分（段階も）を写す。合計の入れ方（total）は、まとめた器だけ
// - 預金（収支が入る口座）: 預金の利回りも資産の種類ごとの預金も無ければ運用の利回り
// - 保険の貯蓄型（変額・外貨建て）で目安でない物: 資産の種類が無いか、その種類の利回りが無ければ運用の利回り
// - 必要保障額の逆算方式: 遺族の金融資産を運用の利回りで伸ばす
// 迷うときは「使う」と答える（行を出しておけば、前提を隠さない）

interface Mix {
  readonly assetClass: string;
  readonly share: string;
}
interface Spec {
  readonly expectedReturn?: string;
  readonly assetMix?: readonly Mix[];
}
interface AccountLike extends Spec {
  readonly kind: string;
  readonly valueGrowth?: string;
  readonly returnStages?: readonly Spec[];
}
/** 入力の形のうち、ここで読む所だけ（計算エンジンの入力と、画面・提案書の計算の要求のどちらも受ける） */
export interface ReturnUseInput {
  readonly household: {
    readonly accounts?: readonly AccountLike[];
    readonly insuranceContracts?: readonly { readonly template: string; readonly simple?: { readonly assetClass?: string; readonly estimate?: boolean } }[];
  };
  readonly assumptions?: {
    readonly depositReturn?: unknown;
    readonly assetReturns?: Readonly<Record<string, unknown>>;
    readonly investment?: {
      readonly method?: string;
      readonly allocation?: { readonly mix: readonly Mix[]; readonly stages?: readonly { readonly mix: readonly Mix[] }[] };
    };
  };
  readonly protection?: { readonly method?: string };
}

/** 預金・外貨預金・不動産の器の資産の種類（配分を持たないとき） */
const CASH_KINDS: Readonly<Record<string, string>> = { deposit: "cash.deposit", fxDeposit: "cash.foreign", realEstate: "realEstate" };
const DEPOSIT_CLASSES: ReadonlySet<string> = new Set(["cash.deposit", "cash.foreign"]);
/** 資産配分の入れ方で共通の配分を写す器（engine/investment.ts の INVEST_KINDS と同じ） */
const ALLOCATION_KINDS: ReadonlySet<string> = new Set(["taxable", "nisa", "childNisa", "juniorNisa", "legacyNisa", "ideco", "corporateDc", "esop"]);
/** 金融資産に入れない器（合計の入れ方でも残す） */
const NOT_FINANCIAL: ReadonlySet<string> = new Set(["realEstate", "otherAsset", "insurance"]);
/** 貯蓄型の保険で積立の部分を運用する物（insurance.policy の FUND と同じ） */
const FUND_TEMPLATES: ReadonlySet<string> = new Set(["insurance.variable", "insurance.foreignCurrency"]);

/** 運用の利回りを計算に使う物があるか（無ければ、提案書の前提の一覧に運用の利回りの行を出さない） */
export function investmentReturnUsed(input: ReturnUseInput): boolean {
  const a = input.assumptions;
  const has = (cls: string): boolean => a?.assetReturns?.[cls] !== undefined;
  const classUses = (cls: string): boolean => (has(cls) || cls === "realEstate" ? false : DEPOSIT_CLASSES.has(cls) ? a?.depositReturn === undefined : true);
  const specUses = (kind: string, spec: Spec): boolean => {
    if (spec.expectedReturn !== undefined) return false;
    const mix = (spec.assetMix ?? []).filter((m) => Number(m.share) > 0);
    if (mix.length === 0) {
      if (kind === "cryptoAsset") return false;
      const cls = CASH_KINDS[kind];
      return cls === undefined ? true : classUses(cls);
    }
    return mix.some((m) => classUses(m.assetClass));
  };
  // 収支が入る預金
  if (classUses("cash.deposit")) return true;
  const inv = a?.investment;
  let accounts = input.household.accounts ?? [];
  if (inv?.method === "total" && accounts.some((x) => x.kind === "pooled")) accounts = accounts.filter((x) => x.kind === "pooled" || NOT_FINANCIAL.has(x.kind));
  const alloc = inv?.method === "allocation" ? inv.allocation : undefined;
  for (const x of accounts) {
    if ((x.kind === "realEstate" || x.kind === "otherAsset") && x.valueGrowth !== undefined) continue;
    if ((x.kind === "insurance" || x.kind === "otherAsset") && x.assetMix === undefined) continue;
    const specs: Spec[] = alloc !== undefined && ALLOCATION_KINDS.has(x.kind) ? [{ assetMix: alloc.mix }, ...(alloc.stages ?? []).map((s) => ({ assetMix: s.mix }))] : [x, ...(x.returnStages ?? []).map((s): Spec => (s.assetMix !== undefined ? { assetMix: s.assetMix } : { expectedReturn: s.expectedReturn ?? "0" }))];
    if (specs.some((s) => specUses(x.kind, s))) return true;
  }
  for (const c of input.household.insuranceContracts ?? []) {
    if (!FUND_TEMPLATES.has(c.template) || c.simple?.estimate === true) continue;
    const cls = c.simple?.assetClass;
    if (cls === undefined || !has(cls)) return true;
  }
  return input.protection?.method === "reverse";
}
