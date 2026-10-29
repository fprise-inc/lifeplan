// 相続・贈与のカードの「相続税の目安」の1行（作業の層。0039 の結果を読むだけ）。
// 今の世帯の要求に相続税の目安（いま亡くなったら・二人とも亡くなった後）を求めて1回だけ計算し、入力項目の要約の下の小さな1行とパネルの1行に出す。
// 表示だけで、お金の流れ・世帯の物は変えない（求めるのは画面の側の写しの要求）。計算の道が無い所（画面の確かめなど）では出さない
import { useEffect, useMemo, useState } from "preact/hooks";
import type { EngineRequest, InheritancePoint, PreviewResult } from "../../engine/types.ts";
import type { WorkingHousehold } from "./household.ts";
import { manText } from "./items.ts";
import { memberLabel } from "./labels.ts";

/** 相続税の目安を求める要求（今の世帯の写し。万一の想定・必要保障額の推移は外す） */
export function inheritanceRequest(req: EngineRequest): EngineRequest {
  const out = structuredClone(req);
  delete out.input.contingencies;
  delete out.input.protection;
  out.input.inheritanceTax = { ...(req.input.inheritanceTax ?? {}), points: ["now", "bothAfter"] };
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
 * 入力項目の要約の下の小さな1行（「相続税: かからない見込み」「相続税: 約120万円」）。
 * 二人とも亡くなった後の目安。無ければ、いまの目安の大きい方。主な表示は入れた中身（items.ts。0060 の 2026-10-29 の追記）
 */
export function inheritanceTaxNote(r: PreviewResult | null): string | null {
  const points = (r?.inheritanceTax?.points ?? []).filter((p) => p.status === "ok");
  const p = points.find((x) => x.point === "bothAfter") ?? [...points].sort((a, b) => b.payable - a.payable)[0];
  if (p === undefined) return null;
  if (p.state === "confirmed") return `相続税: ${manText(p.amount)}万円`;
  return p.noTax ? "相続税: かからない見込み" : `相続税: 約${manText(p.payable)}万円`;
}

/** 相続税の目安の計算（今の世帯が変わったら計算し直す）。計算の道が無ければ null のまま */
export function useInheritanceEstimate(wh: WorkingHousehold, active: boolean, computeOne: ((req: EngineRequest) => Promise<PreviewResult | null>) | undefined): PreviewResult | null {
  const req = useMemo(() => (active && computeOne !== undefined ? inheritanceRequest(wh.request) : null), [active, computeOne, wh.request]);
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
};

/** 目安に含めていない決まり（エンジンの notIncluded） */
export const NOT_INCLUDED_TEXT: Readonly<Record<string, string>> = {
  twentyPercentSurcharge: "2割加算",
  smallLandSpecial: "小規模宅地等の特例",
  landValuationDetail: "土地の評価の細部（路線価・倍率）",
  primarySecondaryComparison: "一次と二次の相続の分け方の比べ",
  calendarGiftAddBack: "亡くなる前の暦年課税の贈与の加算",
  successiveInheritanceCredit: "相次相続控除",
  minorCredit: "未成年者控除",
  disabilityCredit: "障害者控除",
  receivingSideEstimate: "受け取る側の相続税（親の遺産から）",
};

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

/** 時点ごとの見せ方（相続・贈与のカードの区画「相続税の目安」） */
export function inheritanceView(wh: WorkingHousehold, r: PreviewResult | null): { points: InheritancePointView[]; notIncluded: string[] } {
  const out: InheritancePointView[] = [];
  for (const p0 of r?.inheritanceTax?.points ?? []) {
    const p = p0 as PointFull;
    const answer = pointText(p);
    if (answer === null) continue;
    const title = p.point === "bothAfter" ? `二人とも亡くなった後（${p.month.slice(0, 4)}年）` : p.point === "contingency" ? `万一のタブで${memberLabel(wh, p.decedent)}が亡くなったら` : `いま${memberLabel(wh, p.decedent)}が亡くなったら`;
    const details: string[] = [];
    if (p.status === "ok") {
      const a = p.assets;
      const parts = [
        `金融資産 ${man(a.financial ?? 0)}`,
        ...((a.realEstateMarket ?? 0) > 0 ? [`不動産 ${man(a.realEstate ?? 0)}（時価 ${man(a.realEstateMarket ?? 0)} の評価の割合）`] : []),
        ...((a.insurance ?? 0) > 0 ? [`死亡保険金 ${man(a.insurance ?? 0)}（非課税 ${man(a.insuranceExempt ?? 0)}）`] : []),
        ...((a.retirement ?? 0) > 0 ? [`死亡退職金 ${man(a.retirement ?? 0)}（非課税 ${man(a.retirementExempt ?? 0)}）`] : []),
        ...((a.other ?? 0) > 0 ? [`その他 ${man(a.other ?? 0)}`] : []),
        ...((a.settlementGifts ?? 0) > 0 ? [`相続時精算課税の贈与 ${man(a.settlementGifts ?? 0)}`] : []),
        ...((a.debts ?? 0) > 0 ? [`債務 −${man(a.debts ?? 0)}`] : []),
        ...((a.funeral ?? 0) > 0 ? [`葬式の費用 −${man(a.funeral ?? 0)}`] : []),
      ];
      details.push(`財産（${p.valuationYear}年末）: ${parts.join("・")} → 課税価格 ${man(a.taxablePrice ?? 0)}`);
      const heirs = (p.heirs ?? []).filter((x) => x.counted);
      const who = heirs.map((x) => `${RELATION_TEXT[x.relation] ?? "相続人"}${x.outside ? "（世帯の外）" : ""}${x.adopted === true ? "（養子）" : ""}`);
      details.push(`法定相続人 ${String(p.heirCount)}人${p.heirCountOverridden === true ? "（直した数）" : who.length > 0 ? `（${who.join("・")}）` : ""} → 基礎控除 ${man(p.basicDeduction)}`);
      if (p.noTax) details.push(`基礎控除まで あと ${man(Math.max(0, p.margin))}`);
      else {
        const minus = [...((p.spouseReduction ?? 0) > 0 ? [`配偶者の軽減 −${man(p.spouseReduction ?? 0)}`] : []), ...((p.settlementCredit ?? 0) > 0 ? [`精算課税で払った贈与税 −${man(p.settlementCredit ?? 0)}`] : [])];
        details.push(`課税遺産総額 ${man(p.taxableEstate ?? 0)} → 税の総額 ${man(p.totalTax)}${minus.length > 0 ? `（${minus.join("・")}）` : ""} → 納める額 ${man(p.payable)}（世帯の人 ${man(p.payableHousehold)}${p.payableOutside > 0 ? `・世帯の外の相続人 ${man(p.payableOutside)}` : ""}。法定相続分どおりに分けたとして）`);
      }
      if (p.state === "confirmed") details.push(`目安は ${p.noTax ? "かからない見込み" : `約${man(p.payable)}`}（FP が入れた額を使っています）`);
    }
    out.push({ title, answer, details, cautions: p.cautions.map((c) => CAUTION_TEXT[c] ?? c) });
  }
  return { points: out, notIncluded: (r?.inheritanceTax?.notIncluded ?? []).map((x) => NOT_INCLUDED_TEXT[x] ?? x) };
}

/**
 * 遺したい額と、表の最後の年の金融資産の比べ（相続税の目安を求めた計算の表から読む。お金の流れは同じ）。
 * 遺したい額は今の値段なので、前提の物価上昇率で表の最後の年の値段にして比べる。遺したい額が無い・表が無ければ null
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
