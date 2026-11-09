// 本体の正の計算が時間切れ（E_HOST_TIMEOUT）になった枠だけを、少し待ってからもう一度頼む（0180 の2）。
// 時間は経った時間で測るので（engine-host の deadline）、パソコンの負荷が高いと入力に関係なく時間切れになる。もう一度頼むのは
// 時間切れの枠だけ（同時に計算する本数が減るので、通りやすくなる）。ほかのエラーは入力で決まるので、もう一度頼まない
import type { ComputeResponse, SlotRequest } from "./host.ts";
import { isEngineError } from "./types.ts";

/** もう一度頼んでよいエラー（その時の重さで起きるもの） */
export const TRANSIENT_ERRORS: ReadonlySet<string> = new Set(["E_HOST_TIMEOUT"]);

export interface RetryOptions {
  /** もう一度頼む回数の上限（最初の1回は数えない） */
  retries?: number;
  /** n 回目のもう一度の前に待つ時間（ミリ秒） */
  waitMs?: (n: number) => number;
  sleep?: (ms: number) => Promise<void>;
}

/** 既定: 2回まで、1秒・3秒待つ（1回の上限 10秒と合わせて、最も長くて 30秒あまり） */
const DEFAULT_WAIT = (n: number) => (n === 1 ? 1000 : 3000);

const timedOut = (r: ComputeResponse["slots"][string] | undefined): boolean => r !== undefined && isEngineError(r.result) && TRANSIENT_ERRORS.has(r.result.error.code);

/** compute を包む: 時間切れの枠だけを、待ってからもう一度頼み、結果を重ねる。ms は全部の回の合計 */
export function retryTimedOut(compute: (slots: SlotRequest[]) => Promise<ComputeResponse>, o: RetryOptions = {}): (slots: SlotRequest[]) => Promise<ComputeResponse> {
  const retries = o.retries ?? 2;
  const waitMs = o.waitMs ?? DEFAULT_WAIT;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return async (slots) => {
    const res = await compute(slots);
    const out: ComputeResponse = { ms: res.ms, slots: { ...res.slots } };
    for (let n = 1; n <= retries; n++) {
      const again = slots.filter((s) => timedOut(out.slots[s.id]));
      if (again.length === 0) break;
      await sleep(waitMs(n));
      const r = await compute(again);
      out.ms += r.ms;
      for (const s of again) if (r.slots[s.id] !== undefined) out.slots[s.id] = r.slots[s.id] as ComputeResponse["slots"][string];
    }
    return out;
  };
}
