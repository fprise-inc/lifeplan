// 前提条件の「黒字のうち貯まる割合」の横に出す、控えから見た実際の割合の提案（作業の層。0031）。
// - 控え（新しい順）のうち、作ってから6か月以上たった最初の控えを、控えの入力で計算する（計算は1回。控えを選び直すまで結果を持つ）
// - 今の下書きの金融資産と比べて割合を出し、押すと値が入るボタンと根拠を返す（自動では入れない）
import { useEffect, useMemo, useState } from "preact/hooks";
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";
import { parseYm } from "../levers.ts";
import { ACTUAL_MIN_MONTHS, actualSavingRatio, ratioString, type ActualRatio } from "../surplus.ts";
import type { FieldSuggestion } from "./FieldViews.tsx";
import type { WorkingHousehold } from "./household.ts";

const man = (v: number) => `${Math.round(v / 10000).toLocaleString("ja-JP")}万円`;

/** 提案に使う控え: 新しい順に見て、今の計算の基準の月から6か月以上前に作った最初の控え */
export function suggestSnapshot(wh: WorkingHousehold): { id: string; createdAt: string; req: EngineRequest } | null {
  const now = parseYm(wh.request.input.baseMonth);
  const list = [...(wh.snapshots ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  for (const s of list) {
    const m = /^(\d{4})-(\d{2})/.exec(s.createdAt);
    if (m === null) continue;
    const months = (now.y - Number(m[1])) * 12 + (now.m - Number(m[2]));
    if (months >= ACTUAL_MIN_MONTHS) return { id: s.id, createdAt: s.createdAt, req: s.inputs.request };
  }
  return null;
}

/** 提案の文と根拠（割合を出せないときはボタンなし） */
export function suggestionOf(a: ActualRatio, current: string | null): FieldSuggestion {
  const detail = [
    `期間: ${a.from}の控え〜今（${a.months}か月）`,
    `金融資産: 控えの時点 ${man(a.start)} → 今 ${man(a.now)}（増えた分 ${man(a.now - a.start)}）`,
    `見込みの運用益 ${man(a.expectedReturns)} は、増えた分から除いています（相場で増えた分を「貯まった」と数えない控えめな扱い）`,
    `その間の見込みの黒字（退職金などの一時金を除く）${man(a.expectedSurplus)} に対し、実際に貯まったのは ${man(Math.max(0, a.saved))}`,
    "大きな出入り（一時金・住宅の購入など）や相場の大きな動きがあった期間は、ずれが大きくなります。5% の刻みに切り下げています",
  ];
  if (a.ratio === null) return { text: `控えから見た実際の割合: 出せません（${a.reason ?? ""}）`, action: "", value: null, detail: a.expectedSurplus > 0 ? detail : [] };
  const pct = `${Math.round(a.ratio * 100)}%`;
  const same = current !== null && Math.abs(Number(current) - a.ratio) < 0.001;
  return { text: `控えから見た実際の割合: ${pct}`, action: same ? "" : "入れる", value: same ? null : ratioString(a.ratio), detail };
}

/** 控えから見た実際の割合の提案（欄のキー → 提案）。控えが無い・計算できないときは空 */
export function useSurplusSuggestion(draft: WorkingHousehold, active: boolean, computeOne: ((req: EngineRequest) => Promise<PreviewResult | null>) | undefined): Record<string, FieldSuggestion> {
  const snap = useMemo(() => (active ? suggestSnapshot(draft) : null), [active, draft.snapshots, draft.request.input.baseMonth]);
  const [res, setRes] = useState<{ id: string; table: PreviewResult["table"] | null } | null>(null);
  useEffect(() => {
    if (snap === null || computeOne === undefined || res?.id === snap.id) return;
    let alive = true;
    void computeOne(snap.req).then(
      (r) => alive && setRes({ id: snap.id, table: r?.table ?? null }),
      () => alive && setRes({ id: snap.id, table: null }),
    );
    return () => {
      alive = false;
    };
  }, [snap?.id, computeOne]);
  return useMemo((): Record<string, FieldSuggestion> => {
    if (snap === null || res === null || res.id !== snap.id || res.table === null) return {};
    const a = actualSavingRatio({ snapshot: { createdAt: snap.createdAt, req: snap.req, table: res.table }, current: draft.request });
    return { "assume/surplus/ratio": suggestionOf(a, draft.request.input.assumptions?.surplusSaving?.ratio ?? null) };
  }, [snap, res, draft.request]);
}
