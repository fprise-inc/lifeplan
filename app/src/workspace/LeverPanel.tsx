// 打ち手のスライダー（作業の層の部品。共有用の表示でも出す）。
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

export function LeverPanel({ levers, onSlide, onRelease, onReset }: { levers: LeverRow[]; onSlide: (key: LeverKey, index: number) => void; onRelease: () => void; onReset: (to: "current" | "first") => void }) {
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
