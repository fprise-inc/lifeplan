// 事務所の既定値の画面の区画「結果のタブ・資産と負債のタブの表示の設定」（0213 の段C）: 結果のタブ・資産と負債のタブの表示の設定の11件の
// 事務所の既定値を決める（パネルの「保存」で事務所データの display に書く）。
// - 効くのは、事務所の既定値に従う印のある世帯（新しく作る世帯）だけ。その世帯で値を変えた設定と、前からある世帯（印の無い世帯）は世帯の値のまま。
//   作った世帯にそろえる操作は出さない
// - この世帯で並べる時点（資産と負債のタブの見出し）と対策に足した項目は世帯ごとだけで、ここには出さない
// - 欄の部品は世帯の表示の設定と同じ物（資産と負債のタブの「時点を並べる」の既定・家計の体力の目安の幅）を使う
import { GuideEditor, PointDefaultsEditor } from "../../presentation/BalanceTab.tsx";
import { BS_POINT_CHOICES } from "../balanceTab.ts";
import { MONEY_THREE_MONTHS, MONEY_THREE_NAME_CHOICES, MONEY_THREE_YEARS } from "../moneyThree.ts";
import { AGE_OPTIONS, LAYOUT_CHOICES, METRIC_CHOICES, STANDARD_DISPLAY, toggleMetric, type DisplayPair } from "../settings.ts";

/** 運用の期間の帯の選択肢（表示の設定の一覧の result.invPeriods と同じ言葉） */
const PERIOD_CHOICES: readonly { value: boolean | null; key: string; label: string }[] = [
  { value: null, key: "auto", label: "取り崩しの予定があるときだけ表示する（既定）" },
  { value: true, key: "on", label: "表示する" },
  { value: false, key: "off", label: "表示しない" },
];

const intIn = (t: string, min: number, max: number): number | null => {
  const v = Number(t.trim());
  return Number.isInteger(v) && v >= min && v <= max ? v : null;
};

export function DisplayDefaultsSection({ value, onChange }: { value: DisplayPair; onChange: (d: DisplayPair) => void }) {
  const r = value.result;
  const b = value.balance;
  const setR = (patch: Partial<DisplayPair["result"]>) => onChange({ ...value, result: { ...r, ...patch } });
  const setB = (patch: Partial<DisplayPair["balance"]>) => onChange({ ...value, balance: { ...b, ...patch } });
  return (
    <section class="os-sec" aria-labelledby="os-display" data-office-display>
      <h3 id="os-display">結果のタブ・資産と負債のタブの表示の設定</h3>
      <p class="pl-sub">
        世帯の「表示の設定」の事務所の既定値です。新しく作る世帯は、ここの値に従います（ここを変えると、従っている世帯にもすぐ効きます）。世帯で値を変えた設定は「この世帯だけ」になり、ここを変えても変わりません。前からある世帯は、その世帯の値のままです（世帯の表示の設定の「事務所の既定値に戻す」で従うようにできます。「事務所の既定値に戻す」が出るのは、「○歳時点」の年齢・「時点を並べる」の既定・目安の幅・「何か月分」・「何年先まで」です。出す数字・比較の仕方・口座の内訳を表示・運用の期間を表示・家計の体力の目安・お金の3つの分け方の呼び方は、世帯で選び直します）。見せ方だけで、値も計算の結果も変わりません。この世帯で並べる時点と、対策に足した項目は世帯ごとです。
      </p>
      <h4 class="os-sub">結果のタブ</h4>
      <div class="ds-list" role="group" aria-label="出す数字" data-office-display-metrics>
        {METRIC_CHOICES.map((c) => {
          const on = r.metrics.includes(c.key);
          return (
            <label key={c.key} class={`ds-item${on ? " on" : ""}`}>
              <input type="checkbox" checked={on} onChange={(e) => setR(toggleMetric(r, c.key, (e.currentTarget as HTMLInputElement).checked))} data-office-metric={c.key} />
              <span class="ds-l">
                {c.label}
                <small>{c.key === "feeLine" ? "顧問料の契約がある世帯だけに出ます" : c.note}</small>
              </span>
            </label>
          );
        })}
      </div>
      <div class="ds-layout">
        <label class="os-pct">
          <span>「○歳時点の金融資産」の年齢</span>
          <select value={String(r.atAge)} onChange={(e) => setR({ atAge: Number((e.currentTarget as HTMLSelectElement).value) })} data-office-display-age>
            {AGE_OPTIONS.map((a) => (
              <option key={a} value={String(a)}>
                {a}歳
              </option>
            ))}
          </select>
          <small>提案書・持ち帰り用のレポートの目標の年齢にもなります。本人の表の最初の年の年齢より前の年齢の世帯では、その年齢で出します</small>
        </label>
      </div>
      <div class="ds-layout" role="radiogroup" aria-label="比較の仕方" data-office-display-layout>
        <span class="ds-k">比較の仕方</span>
        {LAYOUT_CHOICES.map((c) => (
          <label key={c.key} class={`ds-item${r.layout === c.key ? " on" : ""}`}>
            <input type="radio" name="office-chart-layout" value={c.key} checked={r.layout === c.key} onChange={() => setR({ layout: c.key })} data-office-layout={c.key} />
            <span class="ds-l">
              {c.label}
              {c.key === "overlay" ? "（既定）" : ""}
              <small>{c.note}</small>
            </span>
          </label>
        ))}
      </div>
      <div class="ds-layout" data-office-display-inv>
        <span class="ds-k">資産の推移のグラフ</span>
        <label class={`ds-item${r.invBreakdown ? " on" : ""}`}>
          <input type="checkbox" checked={r.invBreakdown} onChange={(e) => setR({ invBreakdown: (e.currentTarget as HTMLInputElement).checked })} data-office-inv-breakdown />
          <span class="ds-l">
            口座の内訳を表示
            <small>口座ごとに積み上げ、グラフの下に資産の内訳を出します（既定は出さない）</small>
          </span>
        </label>
        <label class="os-pct">
          <span>運用の期間を表示</span>
          <select value={PERIOD_CHOICES.find((c) => c.value === r.invPeriods)?.key ?? "auto"} onChange={(e) => setR({ invPeriods: PERIOD_CHOICES.find((c) => c.key === (e.currentTarget as HTMLSelectElement).value)?.value ?? null })} data-office-inv-periods>
            {PERIOD_CHOICES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <h4 class="os-sub">資産と負債のタブ</h4>
      <div class="ds-layout ds-bspoints" data-office-display-points>
        <span class="ds-k">「時点を並べる」の既定</span>
        <PointDefaultsEditor choices={BS_POINT_CHOICES} value={b.points} onChange={(k) => setB({ points: k })} />
      </div>
      <div class="ds-layout ds-bspoints" data-office-display-health>
        <span class="ds-k">家計の体力の目安</span>
        <label class={`ds-item${b.health ? " on" : ""}`}>
          <input type="checkbox" checked={b.health} onChange={(e) => setB({ health: (e.currentTarget as HTMLInputElement).checked })} data-office-health />
          <span class="ds-l">
            家計の体力の目安を表示する
            <small>1年ずつ見るときの図の下に出します。外しても目安の幅は覚えておきます</small>
          </span>
        </label>
        <GuideEditor guide={b.guide} basisDefault="living" auto="世帯から決める（既定）" name="office-guide-basis" onGuide={(g) => setB({ guide: g })} />
      </div>
      <div class="ds-layout" role="radiogroup" aria-label="お金の3つの分け方の呼び方" data-office-display-m3>
        <span class="ds-k">お金の3つの分け方</span>
        {MONEY_THREE_NAME_CHOICES.map((c) => (
          <label key={c.key} class={`ds-item${b.moneyThree.wording === c.key ? " on" : ""}`}>
            <input type="radio" name="office-m3-names" value={c.key} checked={b.moneyThree.wording === c.key} onChange={() => setB({ moneyThree: { ...b.moneyThree, wording: c.key } })} data-office-m3-names={c.key} />
            <span class="ds-l">
              {c.names.join("・")}
              <small>{c.note}</small>
            </span>
          </label>
        ))}
      </div>
      <div class="ds-layout" data-office-display-m3-numbers>
        <span class="ds-k">境目</span>
        <label class="os-pct">
          <span>使うお金は「何か月分」</span>
          <span class="os-in">
            <input
              type="number"
              min={MONEY_THREE_MONTHS.min}
              max={MONEY_THREE_MONTHS.max}
              value={b.moneyThree.months}
              onChange={(e) => {
                const v = intIn((e.currentTarget as HTMLInputElement).value, MONEY_THREE_MONTHS.min, MONEY_THREE_MONTHS.max);
                if (v !== null) setB({ moneyThree: { ...b.moneyThree, months: v } });
              }}
              data-office-m3-months
            />
            か月分
          </span>
          <small>
            {MONEY_THREE_MONTHS.min}〜{MONEY_THREE_MONTHS.max}（既定 {MONEY_THREE_MONTHS.default}）
          </small>
        </label>
        <label class="os-pct">
          <span>貯めるお金は「何年先まで」</span>
          <span class="os-in">
            <input
              type="number"
              min={MONEY_THREE_YEARS.min}
              max={MONEY_THREE_YEARS.max}
              value={b.moneyThree.years}
              onChange={(e) => {
                const v = intIn((e.currentTarget as HTMLInputElement).value, MONEY_THREE_YEARS.min, MONEY_THREE_YEARS.max);
                if (v !== null) setB({ moneyThree: { ...b.moneyThree, years: v } });
              }}
              data-office-m3-years
            />
            年先まで
          </span>
          <small>
            {MONEY_THREE_YEARS.min}〜{MONEY_THREE_YEARS.max}（既定 {MONEY_THREE_YEARS.default}）
          </small>
        </label>
      </div>
      <p class="pl-sub">
        <button type="button" class="link-btn" onClick={() => onChange(STANDARD_DISPLAY)} data-office-display-reset>
          既定に戻す（提供元の既定の表示の設定）
        </button>
      </p>
    </section>
  );
}
