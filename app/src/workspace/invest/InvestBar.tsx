// 資産の推移のグラフの上の切り替え（作業の層。0026）: 「□ 口座の内訳を表示」「□ 運用の期間を表示」（表示の設定として覚える）と
// 「相場が下がった場合を重ねる」（最初は出さない。重ねると3つの線を1本ずつ外せる）。グラフの下の資産の内訳（ドーナツ）の欄
// （「口座の内訳を表示」にチェックが入っているときだけ出す）
import { DonutPair, type DonutPane } from "../../presentation/Donut.tsx";
import type { InvestChartModel } from "../../presentation/model.ts";
import { OFFICIAL_WORDING } from "../resultTexts.ts";

export interface InvestBarProps {
  invest: InvestChartModel;
  /** 口座の内訳のチェックを出すか（合計の入れ方では出さない） */
  canBreakdown: boolean;
  onBreakdown: (on: boolean) => void;
  onPeriods: (on: boolean) => void;
  stressOn: boolean;
  onStress: (on: boolean) => void;
  onStressLine: (key: string) => void;
  /** 相場が下がった場合の一覧の最後の注（事務所の文で消したときは null。省略は公式の文。0212） */
  stressNote?: string | null;
}

export function InvestBar(p: InvestBarProps) {
  const inv = p.invest;
  const stressNote = p.stressNote === undefined ? OFFICIAL_WORDING.text("result:invest/stressNote") : p.stressNote;
  const bd = inv.view.breakdown && inv.breakdown !== null && inv.breakdown.length > 0;
  return (
    <div class="inv-bar" data-invest-bar>
      <div class="inv-legend" aria-label="口座の内訳の色">
        {bd
          ? (inv.breakdown ?? []).map((s) => (
              <span class="ilg" key={s.key}>
                <i class={`sw inv-${s.key}`} />
                {s.label}
              </span>
            ))
          : null}
      </div>
      <div class="inv-tools">
        {p.canBreakdown ? (
          <label class="chk">
            <input type="checkbox" checked={inv.view.breakdown} onChange={(e) => p.onBreakdown((e.currentTarget as HTMLInputElement).checked)} data-inv-breakdown />
            <span>口座の内訳を表示</span>
          </label>
        ) : null}
        {inv.band !== null ? (
          <label class="chk">
            <input type="checkbox" checked={inv.view.band} onChange={(e) => p.onPeriods((e.currentTarget as HTMLInputElement).checked)} data-inv-periods />
            <span>運用の期間を表示</span>
          </label>
        ) : null}
        <button type="button" class={`stress-btn${p.stressOn ? " on" : ""}`} aria-pressed={p.stressOn} onClick={() => p.onStress(!p.stressOn)} data-stress-open>
          {p.stressOn ? "重ねるのをやめる" : "相場が下がった場合を重ねる"}
        </button>
      </div>
      {p.stressOn && inv.stress !== null ? (
        <ul class="stress-list" aria-label="相場が下がった場合" data-stress-list>
          {inv.stress.map((l) => {
            const off = inv.view.stressHidden.includes(l.key);
            return (
              <li key={l.key} class={off ? "off" : ""}>
                <button type="button" aria-pressed={!off} onClick={() => p.onStressLine(l.key)} title={off ? "この線を重ねる" : "この線を外す"}>
                  <i class={`sl s-${l.key}`} />
                  <span class="nm">{l.label}</span>
                  <b>{l.values === null ? "計算しています" : l.lasts}</b>
                </button>
              </li>
            );
          })}
          {stressNote !== null ? <li class="note">{stressNote}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

export interface DonutCardProps {
  panes: DonutPane[];
  by: "account" | "class";
  onBy: (by: "account" | "class") => void;
  /** 例: 「グラフで年を押して固定すると、その年の内訳になります」。事務所の文で消したときは null（0212） */
  note: string | null;
}

/** 資産の内訳（ドーナツ）の欄。プランA と選んだプランを同じ年で並べる */
export function DonutCard(p: DonutCardProps) {
  return (
    <section class="donut-card" aria-label="資産の内訳" data-donut-card>
      <div class="donut-h">
        <h3>資産の内訳</h3>
        <span class="seg-g sm" role="group" aria-label="内訳の分け方">
          <button type="button" aria-pressed={p.by === "account"} onClick={() => p.onBy("account")} data-mix-by="account">
            口座ごと
          </button>
          <button type="button" aria-pressed={p.by === "class"} onClick={() => p.onBy("class")} data-mix-by="class">
            資産の種類ごと
          </button>
        </span>
        {p.note !== null ? <span class="donut-note">{p.note}</span> : null}
      </div>
      <DonutPair panes={p.panes} />
    </section>
  );
}
