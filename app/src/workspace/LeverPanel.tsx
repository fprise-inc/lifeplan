// 打ち手のスライダー（作業の層の部品）。
// 動かしている間（input）は画面側の先出し、指を離したら（change・pointerup・keyup）正の計算（0005 の5）
import type { LeverKey } from "./levers.ts";

export interface LeverRow {
  key: LeverKey;
  label: string;
  steps: number[];
  index: number;
  baseIndex: number;
  valueText: string;
  stepText: (v: number) => string;
  baseText: string;
  note: string | null;
}

/** FP顧問料の ON/OFF（提案の側だけ。現状は変えない） */
export interface FeeToggle {
  on: boolean;
  /** 例: 「単発30万円＋年額12万円（2027年1月から）」 */
  note: string;
  /** 現状にも入っている（すでに契約している）か */
  inCurrent: boolean;
  onToggle: () => void;
}

export function LeverPanel({ levers, onSlide, onRelease, onReset, fee }: { levers: LeverRow[]; onSlide: (key: LeverKey, index: number) => void; onRelease: () => void; onReset: (to: "current" | "first") => void; fee?: FeeToggle | null }) {
  return (
    <aside class="card col-levers" aria-labelledby="h-lev">
      <div class="card-h">
        <h2 id="h-lev">対策</h2>
        <span class="aside">動かすとすぐ計算し直します</span>
      </div>
      {levers.map((l) => (
        <div class={`lever${l.index !== l.baseIndex ? " changed" : ""}`} key={l.key}>
          <div class="lever-head">
            <label for={`lv-${l.key}`}>{l.label}</label>
            <span class="lever-val">{l.valueText}</span>
          </div>
          <input
            id={`lv-${l.key}`}
            type="range"
            min={0}
            max={l.steps.length - 1}
            step={1}
            value={l.index}
            data-lever={l.key}
            aria-valuetext={l.valueText}
            onInput={(e) => onSlide(l.key, Number((e.currentTarget as HTMLInputElement).value))}
            onChange={onRelease}
            onPointerUp={onRelease}
            onKeyUp={onRelease}
          />
          <div class="ticks">
            {l.steps.map((v, i) => (
              <button
                type="button"
                key={v}
                class={`tick${i === l.index ? " is-on" : ""}${i === l.baseIndex ? " is-base" : ""}`}
                onClick={() => {
                  onSlide(l.key, i);
                  onRelease();
                }}
              >
                {l.stepText(v)}
              </button>
            ))}
          </div>
          <div class="lever-note">
            {l.note !== null ? <span>{l.note}</span> : <span />}
            <span class="base-tag">現状: {l.baseText}</span>
          </div>
        </div>
      ))}
      {fee != null ? (
        <div class={`lever toggle${fee.on !== fee.inCurrent ? " changed" : ""}`}>
          <div class="lever-head">
            <label for="lv-fee">FP顧問料</label>
            <button type="button" id="lv-fee" class={`switch${fee.on ? " on" : ""}`} role="switch" aria-checked={fee.on} onClick={fee.onToggle} data-fee-toggle>
              <span class="knob" aria-hidden="true" />
              <span class="lbl">{fee.on ? "入れる" : "入れない"}</span>
            </button>
          </div>
          <div class="lever-note">
            <span>{fee.note}</span>
            <span class="base-tag">現状: {fee.inCurrent ? "入れる" : "入れない"}</span>
          </div>
        </div>
      ) : null}
      <div class="levers-foot">
        <button type="button" class="reset-btn" onClick={() => onReset("current")}>
          現状に戻す
        </button>
        <button type="button" class="reset-btn" onClick={() => onReset("first")}>
          最初の提案に戻す
        </button>
      </div>
    </aside>
  );
}
