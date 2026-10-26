// 相続・贈与のカードの「相続税の目安」の1行（作業の層。0039 の結果を読むだけ）。
// 今の世帯の要求に相続税の目安（いま亡くなったら・二人とも亡くなった後）を求めて1回だけ計算し、カードの要約とパネルの1行に出す。
// 表示だけで、お金の流れ・世帯の物は変えない（求めるのは画面の側の写しの要求）。計算の道が無い所（画面の確かめなど）では出さない
import { useEffect, useMemo, useState } from "preact/hooks";
import type { EngineRequest, InheritancePoint, PreviewResult } from "../../engine/types.ts";
import type { WorkingHousehold } from "./household.ts";
import { manText, type Summary } from "./items.ts";
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

/** 時点ごとの1行（例: 「いま本人が亡くなったら: かからない見込み」） */
export function inheritanceLines(wh: WorkingHousehold, r: PreviewResult | null): string[] {
  const points = r?.inheritanceTax?.points ?? [];
  const out: string[] = [];
  for (const p of points) {
    const t = pointText(p);
    if (t === null) continue;
    const when = p.point === "bothAfter" ? "二人とも亡くなった後" : `いま${memberLabel(wh, p.decedent)}が亡くなったら`;
    out.push(`${when}: ${t}`);
  }
  return out;
}

/** カードの要約（二人とも亡くなった後の目安。無ければ、いまの目安の大きい方） */
export function inheritanceSummary(r: PreviewResult | null): Summary | null {
  const points = (r?.inheritanceTax?.points ?? []).filter((p) => p.status === "ok");
  const p = points.find((x) => x.point === "bothAfter") ?? [...points].sort((a, b) => b.payable - a.payable)[0];
  if (p === undefined) return null;
  if (p.state === "confirmed") return { pre: "相続税 ", main: manText(p.amount), unit: "万円" };
  return p.noTax ? { pre: "相続税 ", main: "かからない見込み" } : { pre: "相続税 約", main: manText(p.payable), unit: "万円" };
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
