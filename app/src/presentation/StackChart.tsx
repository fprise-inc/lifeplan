// 積み上げの棒の塗り（模様）と凡例: 収支の推移・資産と負債の推移・説明モード（描くのは MainChart.tsx）。
// 系列はすべてベタ塗り（斜線や点の模様は読みにくいため使わない）。色の明るさを系列ごとに変え、凡例の名前と並び順で区別する
import type { StackSeries } from "./model.ts";

/** 系列の鍵 → 模様（solid・stripe・dots・cross・hline）。色は CSS の .pbg-<鍵> */
export const PATTERN: Readonly<Record<string, string>> = {
  salary: "solid",
  work: "solid",
  pension: "solid",
  incomeOther: "solid",
  living: "solid",
  housing: "solid",
  education: "solid",
  insurance: "solid",
  expenseOther: "solid",
  deposit: "solid",
  nisa: "solid",
  dc: "solid",
  assetOther: "solid",
  mortgage: "solid",
  debtOther: "solid",
};

export function Pattern({ k }: { k: string }) {
  const p = PATTERN[k] ?? "solid";
  return (
    <pattern id={`pt-${k}`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform={p === "stripe" ? "rotate(45)" : undefined}>
      <rect width="6" height="6" class={`pbg-${k}`} />
      {p === "stripe" ? <line x1="0" y1="0" x2="0" y2="6" class="pfg" /> : null}
      {p === "hline" ? <line x1="0" y1="3" x2="6" y2="3" class="pfg" /> : null}
      {p === "dots" ? <circle cx="3" cy="3" r="1.1" class="pfg-dot" /> : null}
      {p === "cross" ? <path d="M0 0L6 6M6 0L0 6" class="pfg" /> : null}
    </pattern>
  );
}

/** 凡例の見本（同じ模様の小さな四角） */
export function Swatch({ k }: { k: string }) {
  return (
    <svg class="swatch" viewBox="0 0 16 12" aria-hidden="true">
      <defs>
        <Pattern k={k} />
      </defs>
      <rect x="0.5" y="0.5" width="15" height="11" fill={`url(#pt-${k})`} class="swatch-box" />
    </svg>
  );
}

/** 凡例（上に積む系列・下に積む系列・そのほかの印） */
export function StackLegend({ up, down, extra }: { up: StackSeries[]; down: StackSeries[]; extra?: preact.JSX.Element | null }) {
  return (
    <div class="legend stack-legend">
      {up.map((s) => (
        <span class="lg" key={s.key}>
          <Swatch k={s.key} />
          {s.label}
        </span>
      ))}
      {down.length > 0 ? <span class="lg-sep" aria-hidden="true" /> : null}
      {down.map((s) => (
        <span class="lg" key={s.key}>
          <Swatch k={s.key} />
          {s.label}
        </span>
      ))}
      {extra ?? null}
    </div>
  );
}
