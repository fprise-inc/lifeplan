// 写しの要求の結果を画面で持つ hook（扶養の境目の参考の行。0075）。resultRows.ts は画面の部品を読まない（AI接続口の根拠の読み方に同梱する。0183）
import { useEffect, useMemo, useState } from "preact/hooks";
import type { EngineRequest, PreviewResult } from "../engine/types.ts";

/**
 * 写しの要求の結果（扶養の境目の参考の行）。要求が null なら null。計算し直している間は前の結果を見せておく（ちらつかないように）。
 * 計算の道が無ければ null のまま
 */
export function useRefResult(req: EngineRequest | null, computeOne: ((req: EngineRequest) => Promise<PreviewResult | null>) | undefined): PreviewResult | null {
  const [res, setRes] = useState<PreviewResult | null>(null);
  const key = useMemo(() => (req === null ? null : JSON.stringify(req)), [req]);
  useEffect(() => {
    if (req === null || computeOne === undefined) return;
    let alive = true;
    void computeOne(req).then(
      (r) => alive && setRes(r),
      () => alive && setRes(null),
    );
    return () => {
      alive = false;
    };
  }, [key, computeOne]);
  return req === null ? null : res;
}
