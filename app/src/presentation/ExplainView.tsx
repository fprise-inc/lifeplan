// 説明モード（提示層の部品）: 面談で、グラフを1段ずつ積み上げて見せる（収入 → 年金 → 支出 → 教育 → 住宅 → 資産の推移）。
// ボタンか ← → キーで1段ずつ進み、Esc か「説明を終わる」でいつでも抜ける。
// 受け取るのは ExplainModel だけ（顧客に見せる画面。FP の内部の情報は受け取らない。0016 の2）。別の窓は出さず、画面の中に重ねる
import { useEffect, useRef } from "preact/hooks";
import type { ExplainModel, StackSeries } from "./model.ts";
import { StackChart, StackLegend } from "./StackChart.tsx";

export function ExplainView({ model, step, onStep, onClose }: { model: ExplainModel; step: number; onStep: (i: number) => void; onClose: () => void }) {
  const last = model.steps.length - 1;
  const cur = Math.max(0, Math.min(last, step));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        onStep(Math.min(last, cur + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        onStep(Math.max(0, cur - 1));
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cur, last, onStep, onClose]);

  const on = (k: string) => model.steps.findIndex((s) => s.key === k) <= cur;
  const up: StackSeries[] = [];
  if (on("income")) up.push({ key: "work", label: "給与・退職金などの収入", values: model.work });
  if (on("pension")) up.push({ key: "pension", label: "年金", values: model.pension });
  const down: StackSeries[] = [];
  if (on("expense")) down.push({ key: "living", label: "生活費・税など", values: model.living });
  if (on("education")) down.push({ key: "education", label: "教育費", values: model.education });
  if (on("housing")) down.push({ key: "housing", label: "住居費", values: model.housing });
  const showAssets = on("assets");
  const s = model.steps[cur];
  return (
    <div class="explain" role="dialog" aria-modal="true" aria-labelledby="ex-title" tabIndex={-1} ref={ref} data-explain>
      <div class="ex-head">
        <h2 id="ex-title">{model.title}</h2>
        <ol class="ex-steps" aria-label="説明の段">
          {model.steps.map((x, i) => (
            <li key={x.key} class={i === cur ? "on" : i < cur ? "done" : ""} aria-current={i === cur ? "step" : undefined}>
              <button type="button" onClick={() => onStep(i)}>
                <span class="n">{i + 1}</span>
                {x.title}
              </button>
            </li>
          ))}
        </ol>
        <button type="button" class="btn ex-close" onClick={onClose} data-explain-close>
          説明を終わる ×
        </button>
      </div>
      <div class={`ex-body${showAssets ? " with-assets" : ""}`}>
        <p class="ex-sentence" aria-live="polite">
          {s?.sentence.map((p, i) => (p.strong === true ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>))}
        </p>
        <StackLegend
          up={up}
          down={down}
          extra={
            showAssets ? (
              <span class="lg">
                <i />
                金融資産
              </span>
            ) : null
          }
        />
        <StackChart years={model.years} ages={model.ages} up={up} down={down} line={showAssets ? { label: "金融資産", values: model.financial } : null} selectedYear={null} label={`${model.title}（${s?.title ?? ""}まで）`} />
      </div>
      <div class="ex-foot">
        <button type="button" class="btn" disabled={cur === 0} onClick={() => onStep(cur - 1)} data-explain-prev>
          ← 前
        </button>
        <span class="ex-pos">
          {cur + 1} / {model.steps.length}
        </span>
        <button type="button" class="btn primary" disabled={cur === last} onClick={() => onStep(cur + 1)} data-explain-next>
          次 →
        </button>
      </div>
    </div>
  );
}
