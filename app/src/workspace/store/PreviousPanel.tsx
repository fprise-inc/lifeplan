// 世帯ファイルが開けなかった（壊れた・途中で切れた・空）ときに、直前の保存（直前の世代 .prev。0011 の7）で開き直す画面（中央のパネル）。
// 戻す前に、どの時点の保存か（日時・何回目の保存か・保存した人）を見せる。開けなかったファイルは捨てずに、本体がこの PC の中に別名で残す
import { useEffect, useRef } from "preact/hooks";
import type { PreviousGeneration } from "../../engine/host.ts";
import { shortDate } from "./HouseholdPanel.tsx";

/**
 * 直前の世代を探す、本体の開く操作の失敗（ファイルが壊れた・読めない）。鍵・復元キー・新しい版・事務所の共有の失敗では探さない。
 * 本体が開けた本文の形が画面に合わない（E_BODY_SHAPE）ときは、今のファイルは壊れていないので探さない
 */
const BROKEN = new Set(["E_STORE_CORRUPT", "E_STORE_FORMAT_UNKNOWN", "E_STORE_BODY"]);
export const offersPrevious = (code: string): boolean => BROKEN.has(code);

export interface PreviousPanelProps {
  customerNo: string;
  /** 開けなかった理由の文 */
  reason: string;
  info: PreviousGeneration;
  busy: boolean;
  error: string | null;
  onOpen: () => void;
  onClose: () => void;
}

export function PreviousPanel(p: PreviousPanelProps) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => panel.current?.focus({ preventScroll: true }), []);
  const when = p.info.savedAt !== null ? shortDate(p.info.savedAt) : "";
  const point = [when !== "" ? `${when} の保存` : null, `${p.info.generation}回目の保存`, p.info.savedBy !== null ? `保存した人: ${p.info.savedBy}` : null].filter((x) => x !== null).join("・");
  return (
    <>
      <div class="scrim" aria-hidden="true" />
      <div ref={panel} class="rk-panel fork-panel" role="dialog" aria-modal="true" aria-labelledby="prev-title" tabIndex={-1} data-previous-panel>
        <h2 id="prev-title">世帯 {p.customerNo} を開けませんでした</h2>
        {p.reason !== "" ? <p>{p.reason}</p> : null}
        <p>
          直前の保存の内容が残っています（<b>{point}</b>）。この内容で開き直せます。
        </p>
        <p class="pl-sub">直前の保存の後に入れた変更は戻りません。開けなかったファイルは捨てずに、このPCの中に別名で残します。</p>
        {p.error !== null ? (
          <p class="hh-err" role="alert">
            {p.error}
          </p>
        ) : null}
        <div class="rk-foot">
          <button type="button" class="btn" disabled={p.busy} onClick={p.onOpen} data-previous-open>
            直前の保存で開く
          </button>
          <button type="button" class="btn" disabled={p.busy} onClick={p.onClose}>
            開かない
          </button>
        </div>
      </div>
    </>
  );
}
