// 主画面のグラフの切り替え（提示層の部品）: 収支の推移・資産と負債の推移。受け取るのは提示用の値だけ（0016 の2）
import type { BalanceChartModel, FlowChartModel } from "./model.ts";
import { StackChart, StackLegend, YearBreakdown } from "./StackChart.tsx";

export type ChartTab = "assets" | "flows" | "balance";
export const CHART_TABS: readonly { id: ChartTab; label: string }[] = [
  { id: "assets", label: "資産の推移" },
  { id: "flows", label: "収支の推移" },
  { id: "balance", label: "資産と負債の推移" },
];

export function ChartTabs({ tab, onTab }: { tab: ChartTab; onTab: (t: ChartTab) => void }) {
  return (
    <div class="chart-tabs" role="tablist" aria-label="グラフ">
      {CHART_TABS.map((t) => (
        <button type="button" role="tab" key={t.id} aria-selected={t.id === tab} class={t.id === tab ? "on" : ""} onClick={() => onTab(t.id)} data-chart-tab={t.id}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** 収支の推移: 収入を上に、支出を下に積む。赤字の年は下の帯（赤の斜線）と「▲」 */
export function FlowChartView({ model, selectedYear, onSelectYear }: { model: FlowChartModel; selectedYear: number; onSelectYear: (y: number) => void }) {
  const i = model.years.indexOf(selectedYear);
  const flags = model.net.map((v) => v < 0);
  const deficits = flags.filter(Boolean).length;
  return (
    <div class="flow-chart" data-flow-chart>
      <div class="chart-top">
        <StackLegend
          up={model.income}
          down={model.expense}
          extra={
            <span class="lg short">
              <i />
              赤字の年（▲）
            </span>
          }
        />
        <span class="footnote">上が収入、下が支出。{deficits > 0 ? `赤字の年が ${deficits}年 あります` : "赤字の年はありません"}</span>
      </div>
      <StackChart years={model.years} ages={model.ages} up={model.income} down={model.expense} flags={flags} selectedYear={selectedYear} onSelectYear={onSelectYear} label={model.title} />
      {i >= 0 ? (
        <YearBreakdown
          year={selectedYear}
          index={i}
          groups={[
            { label: "収入", series: model.income },
            { label: "支出", series: model.expense },
          ]}
          tail={[{ label: (model.net[i] ?? 0) < 0 ? "▲ 赤字" : "年間収支", amount: model.net[i] ?? 0, bad: (model.net[i] ?? 0) < 0 }]}
        />
      ) : null}
    </div>
  );
}

/** 資産と負債の推移: 資産を上に、負債を下に積み、純資産を線で */
export function BalanceChartView({ model, selectedYear, onSelectYear }: { model: BalanceChartModel; selectedYear: number; onSelectYear: (y: number) => void }) {
  const i = model.years.indexOf(selectedYear);
  const short = model.shortfall.map((v) => -v);
  const hasShort = short.some((v) => v > 0);
  return (
    <div class="balance-chart" data-balance-chart>
      <div class="chart-top">
        <StackLegend
          up={model.assets.filter((s) => s.values.some((v) => v > 0))}
          down={model.debts.filter((s) => s.values.some((v) => v > 0))}
          extra={
            <>
              <span class="lg">
                <i />
                純資産（資産−負債）
              </span>
              {hasShort ? (
                <span class="lg short">
                  <i />
                  不足（▲）
                </span>
              ) : null}
            </>
          }
        />
        <span class="footnote">上が資産、下が負債（年末の残高）</span>
      </div>
      <StackChart
        years={model.years}
        ages={model.ages}
        up={model.assets.filter((s) => s.values.some((v) => v > 0))}
        down={model.debts.filter((s) => s.values.some((v) => v > 0))}
        hatchedDown={short}
        line={{ label: "純資産", values: model.netWorth }}
        selectedYear={selectedYear}
        onSelectYear={onSelectYear}
        label={model.title}
      />
      {i >= 0 ? (
        <YearBreakdown
          year={selectedYear}
          index={i}
          groups={[
            { label: "資産", series: model.assets },
            { label: "負債", series: model.debts },
          ]}
          tail={[
            ...((model.shortfall[i] ?? 0) < 0 ? [{ label: "▲ 不足", amount: model.shortfall[i] ?? 0, bad: true }] : []),
            { label: "純資産", amount: model.netWorth[i] ?? 0, bad: (model.netWorth[i] ?? 0) < 0 },
          ]}
        />
      ) : null}
    </div>
  );
}
