// 結果のタブの気づき（0074）: 選んでいるプランの結果から、決まりで数件（預金が少なくなる年・赤字が続く・教育と介護が重なる・NISA の枠を
// 使い切る年・相続税がかかる見込み）。入力は増えない。年のある気づきは「その年を見る」、どれも「対策を考える」で対策へ
import { useEffect, useMemo, useState } from "preact/hooks";
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";
import { inheritanceRequest } from "../input/inheritanceLine.ts";
import { insights } from "./fpTools.ts";

/** 相続税の目安を計算する（active のときだけ。要求が変わったら計算し直す） */
export function useInheritanceFor(req: EngineRequest | null, active: boolean, computeOne: ((r: EngineRequest) => Promise<PreviewResult | null>) | undefined): PreviewResult | null {
  const q = useMemo(() => (active && req !== null && computeOne !== undefined ? inheritanceRequest(req) : null), [active, req, computeOne]);
  const [res, setRes] = useState<PreviewResult | null>(null);
  useEffect(() => {
    if (q === null || computeOne === undefined) return;
    let alive = true;
    void computeOne(q).then(
      (r) => alive && setRes(r),
      () => alive && setRes(null),
    );
    return () => {
      alive = false;
    };
  }, [q, computeOne]);
  return q === null ? null : res;
}

export function inheritancePayable(r: PreviewResult | null): number | null {
  const ps = (r?.inheritanceTax?.points ?? []).filter((p) => p.status === "ok" && p.point === "now" && !p.noTax);
  if (ps.length === 0) return null;
  return Math.max(...ps.map((p) => p.payable));
}

export function Insights({ req, result, months, inheritance, onYear, onLevers }: { req: EngineRequest; result: PreviewResult | null; months?: number; inheritance?: PreviewResult | null; onYear?: (y: number) => void; onLevers?: () => void }) {
  if (result === null) return null;
  const list = insights(req, result, { ...(months !== undefined ? { months } : {}), inheritanceTax: inheritancePayable(inheritance ?? null) });
  if (list.length === 0) return null;
  return (
    <section class="fp-insights" aria-label="気づき" data-insights>
      <h3>気づき（{list.length}）</h3>
      <ul>
        {list.map((i) => (
          <li key={i.key} data-insight={i.key}>
            <span class="fee-tag">{i.title}</span>
            <span>{i.text}</span>
            {i.year !== null && onYear !== undefined ? (
              <button type="button" class="link-btn" onClick={() => onYear(i.year as number)}>
                その年を見る
              </button>
            ) : null}
            {onLevers !== undefined ? (
              <button type="button" class="link-btn" onClick={onLevers}>
                対策を考える
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
