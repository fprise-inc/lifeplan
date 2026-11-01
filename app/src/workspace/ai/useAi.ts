// AI接続口の状態と、開いている世帯の「同意とAIの記録」を本体から読む（3秒ごと。事件の通知は使わない: 画面に新しい権限を与えないため）
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { AiHost, AiHouseholdView, AiStatus } from "../../engine/host.ts";

/** 読み直しの間隔（残り時間・届いた候補・読まれた記録） */
export const AI_POLL_MS = 3000;

export interface AiState {
  status: AiStatus | null;
  /** 開いている保存した世帯の記録（見本・未保存は null） */
  view: AiHouseholdView | null;
  refresh: () => Promise<void>;
  setStatus: (s: AiStatus) => void;
  setView: (v: AiHouseholdView) => void;
}

/**
 * 前と同じ中身なら置き直さない状態（3秒ごとの読み直しで、何も変わっていないのに画面全体を描き直さない。
 * 共有中は残り時間が変わるので、そのたびに置き直す）
 */
function useSameSkippingState<T>(): [T | null, (v: T | null) => void] {
  const [value, setValue] = useState<T | null>(null);
  const last = useRef("null");
  const set = useCallback((v: T | null) => {
    const text = JSON.stringify(v);
    if (text === last.current) return;
    last.current = text;
    setValue(v);
  }, []);
  return [value, set];
}

export function useAi(ai: AiHost | null, storeReady: boolean, householdId: string | null): AiState {
  const [status, setStatus] = useSameSkippingState<AiStatus>();
  const [view, setView] = useSameSkippingState<AiHouseholdView>();
  const idRef = useRef(householdId);
  idRef.current = householdId;

  const refresh = useCallback(async () => {
    if (ai === null || !storeReady) return;
    try {
      setStatus(await ai.status());
    } catch {
      setStatus(null);
    }
    const id = idRef.current;
    if (id === null) {
      setView(null);
      return;
    }
    try {
      const v = await ai.household(id);
      if (idRef.current === id) setView(v);
    } catch {
      if (idRef.current === id) setView(null);
    }
  }, [ai, storeReady, setStatus, setView]);

  useEffect(() => {
    setView(null);
    void refresh();
  }, [refresh, householdId, setView]);

  useEffect(() => {
    if (ai === null || !storeReady) return;
    const t = setInterval(() => void refresh(), AI_POLL_MS);
    return () => clearInterval(t);
  }, [ai, storeReady, refresh]);

  return { status, view, refresh, setStatus, setView };
}
