// 結果のタブのポイント（0074。2026-11-12 に「気づき」から改め、中身を見直した）: 選んでいるプランの結果から、決まりで数件（預金が少なくなる年・赤字が続く〔働いている間〕・
// 大きな支出が重なる年・退職から年金までの空白・退職後もローンが残る・住宅ローン控除が終わる年・相続税がかかる見込み）。入力は増えない。
// 年のあるポイントは「その年を見る」、どれも「対策を考える」で対策へ
import { useEffect, useMemo, useState } from "preact/hooks";
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { inheritanceRequest } from "../input/inheritanceLine.ts";
import { endYearOff, endYearToStandard } from "../input/stages/assumptions.ts";
import { insights, withoutHousingCredit, type CreditPair } from "./fpTools.ts";

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

/**
 * 住宅ローン控除を受けない計算と、同じ時に計算し直した今の計算の組（控除の期間の中のローンがあるときだけ。要求が変わったら計算し直す）。
 * 控除が終わる年のポイントに使う。組で計算するのは、表に出ている結果が入力の途中の古い答えでも、控除の違いだけを比較できるようにするため
 */
export function useCreditPairFor(req: EngineRequest | null, computeOne: ((r: EngineRequest) => Promise<PreviewResult | null>) | undefined): CreditPair | null {
  const pair = useMemo(() => {
    const off = req !== null && computeOne !== undefined ? withoutHousingCredit(req) : null;
    return off === null || req === null ? null : { on: req, off };
  }, [req, computeOne]);
  const [res, setRes] = useState<{ key: object; r: CreditPair | null } | null>(null);
  useEffect(() => {
    if (pair === null || computeOne === undefined) return;
    let alive = true;
    void Promise.all([computeOne(pair.on), computeOne(pair.off)]).then(
      ([on, off]) => alive && setRes({ key: pair, r: on != null && off != null ? { on, off } : null }),
      () => alive && setRes({ key: pair, r: null }),
    );
    return () => {
      alive = false;
    };
  }, [pair, computeOne]);
  // 前の要求の答え（別のプラン・直す前の入力）は使わない
  return pair === null || res?.key !== pair ? null : res.r;
}

export function inheritancePayable(r: PreviewResult | null): number | null {
  const ps = (r?.inheritanceTax?.points ?? []).filter((p) => p.status === "ok" && p.point === "now" && !p.noTax);
  if (ps.length === 0) return null;
  return Math.max(...ps.map((p) => p.payable));
}

export function Insights({
  req,
  result,
  months,
  inheritance,
  computeOne,
  credit,
  onYear,
  onLevers,
  initialOpen = false,
}: {
  req: EngineRequest;
  result: PreviewResult | null;
  months?: number;
  inheritance?: PreviewResult | null;
  /** 住宅ローン控除を受けない計算に使う（無ければ控除が終わる年のポイントは出さない） */
  computeOne?: (r: EngineRequest) => Promise<PreviewResult | null>;
  /** 住宅ローン控除を受ける・受けない計算の組を外から渡す（テスト用。渡すと computeOne では計算しない） */
  credit?: CreditPair | null;
  onYear?: (y: number) => void;
  onLevers?: () => void;
  initialOpen?: boolean;
}) {
  // 閉じているときは灰色の小さい1行（「ポイント ○件 ▸」）。押すと一覧が開き、もう一度押すと閉じる（0074 の追記 2026-11-12）
  const [open, setOpen] = useState(initialOpen);
  const computed = useCreditPairFor(credit === undefined ? req : null, computeOne);
  const pair = credit !== undefined ? credit : computed;
  const list = useMemo(
    () => (result === null ? [] : insights(req, result, { ...(months !== undefined ? { months } : {}), inheritanceTax: inheritancePayable(inheritance ?? null), credit: pair })),
    [req, result, months, inheritance, pair],
  );
  if (result === null || list.length === 0) return null;
  return (
    <section class={`fp-insights${open ? " open" : ""}`} aria-label="ポイント" data-insights={list.length}>
      <button type="button" class="quiet-toggle" aria-expanded={open} onClick={() => setOpen(!open)} data-insights-open>
        ポイント {list.length}件
        <span class="quiet-caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        <ul class="ins-body">
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
      ) : null}
    </section>
  );
}

/**
 * 表の最後の年が標準から大きく外れている世帯（若い方の大人が85〜105歳の外。古い世帯・前の版の見本の写しなど）の、結果のタブの入力の確認。
 * 前提条件の詳細の欄の中だけでは気づかないので、グラフの下（ポイントの上）にも出す。押したときだけ既定にする（黙って直さない）。
 * wh は現状（入力）の世帯
 */
export function EndYearNote({ wh, onFix }: { wh: WorkingHousehold; onFix: (next: WorkingHousehold) => void }) {
  const o = endYearOff(wh);
  if (o === null) return null;
  return (
    <div class="fee-note input-notice" role="note" data-input-notice data-end-year-note>
      <span class="fee-tag">入力の確認</span>
      <span>
        表の最後の年が{o.end}年（{o.ages}）です。既定は、ご本人・配偶者のうち若い方が100歳になる{o.std}年です
      </span>
      <button type="button" class="link-btn" onClick={() => onFix(endYearToStandard(wh))} data-end-year-fix>
        既定（{o.std}年）にする
      </button>
    </div>
  );
}
