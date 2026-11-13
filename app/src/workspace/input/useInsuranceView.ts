// 保険の入力項目の「保険料と解約返戻金」（0055）の、画面の部品が使う計算の入れ物（世帯が変わったら計算し直す）。
// 中身の計算は insuranceView.ts（画面の部品を読まない。確かめの一覧を AI接続口にも同梱するため、入れ物だけをここに分けた。0210）
import { useEffect, useMemo, useState } from "preact/hooks";
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";
import type { WorkingHousehold } from "./household.ts";
import { insuranceRequest, insuranceView, type InsuranceView } from "./insuranceView.ts";

/** 保険料と解約返戻金の計算（世帯が変わったら計算し直す）。計算の道が無ければ null のまま */
export function useInsuranceView(wh: WorkingHousehold, active: boolean, computeOne: ((req: EngineRequest) => Promise<PreviewResult | null>) | undefined): InsuranceView | null {
  const req = useMemo(() => (active && computeOne !== undefined && (wh.request.input.household.insuranceContracts ?? []).length > 0 ? insuranceRequest(wh) : null), [active, computeOne, wh]);
  const [res, setRes] = useState<InsuranceView | null>(null);
  useEffect(() => {
    if (req === null || computeOne === undefined) return;
    let alive = true;
    void computeOne(req)
      .catch(() => null)
      .then((r) => {
        if (alive) setRes(insuranceView(wh, r));
      });
    return () => {
      alive = false;
    };
  }, [req, computeOne, wh]);
  // 計算し直している間は、前の結果を見せておく（数字が消えてちらつかないように）
  return req === null ? null : res;
}
