// 結果のタブの表示の設定（作業の層の部品。結果のグラフの右上の「表示の設定」で、結論の下に開く。別の窓は出さない）。
// FP が結果に出す数字と、グラフの比較の仕方（重ねる／左右に並べる／全部の案を色分けで重ねる）を選ぶ。既定では何も足さず、重ねる。
// 資産と負債のタブの設定（時点を並べるの既定・家計の体力の目安を表示するかと目安の幅）は、そのタブの表示の設定にある（BalanceTab.tsx）
// 設定ごとに「事務所の既定値」か「この世帯だけ」を出し、「この世帯だけ」には「事務所の既定値に戻す」を置く（0213 の段C。office を渡したときだけ）
import { OfficeMark, type OfficeMarks } from "../presentation/OfficeMark.tsx";
import { ageOptionsFor, LAYOUT_CHOICES, METRIC_CHOICES, shows, toggleMetric, type DisplaySettings } from "./settings.ts";

/** firstAge: 本人の表の最初の年の年齢（これより前の年齢は「○歳時点」に選べない。present.ts の firstAgeOf）。office: 事務所の既定値の印（0213 の段C） */
export function DisplaySettingsPanel({ value, onChange, onClose, feeAvailable, firstAge = null, office }: { value: DisplaySettings; onChange: (s: DisplaySettings) => void; onClose: () => void; feeAvailable: boolean; firstAge?: number | null; office?: OfficeMarks }) {
  const ages = ageOptionsFor(firstAge, value.atAge);
  return (
    <div class="disp-settings" role="group" aria-label="表示の設定" data-display-settings>
      <div class="ds-head">
        <b>表示の設定</b>
        <span class="ds-note">結果のタブに出す数字とグラフの見せ方を選びます（世帯を保存していれば、世帯のファイルに一緒に保存します）</span>
        <button type="button" class="link-btn" onClick={onClose}>
          閉じる
        </button>
      </div>
      {office !== undefined ? (
        <div class="ds-marks" data-display-marks="result.metrics">
          <span>
            出す数字 <OfficeMark marks={office} ids={["result.metrics"]} />
          </span>
          <span>
            「○歳時点」の年齢 <OfficeMark marks={office} ids={["result.atAge"]} />
          </span>
        </div>
      ) : null}
      <div class="ds-list">
        {METRIC_CHOICES.map((c) => {
          const disabled = c.key === "feeLine" && !feeAvailable;
          return (
            <label key={c.key} class={`ds-item${shows(value, c.key) ? " on" : ""}${disabled ? " off" : ""}`}>
              <input type="checkbox" checked={shows(value, c.key)} disabled={disabled} onChange={(e) => onChange(toggleMetric(value, c.key, (e.currentTarget as HTMLInputElement).checked))} data-metric={c.key} />
              <span class="ds-l">
                {c.key === "assetsAtAge" ? (
                  <span class="ds-age">
                    <select
                      value={String(ages.value)}
                      onChange={(e) => onChange({ ...toggleMetric(value, "assetsAtAge", true), atAge: Number((e.currentTarget as HTMLSelectElement).value) })}
                      aria-label="年齢"
                      data-metric-age
                    >
                      {ages.options.map((a) => (
                        <option key={a} value={String(a)}>
                          {a}
                        </option>
                      ))}
                    </select>
                    歳時点の金融資産
                  </span>
                ) : (
                  c.label
                )}
                <small>{disabled ? "顧問料の契約がある世帯で選べます" : c.note}</small>
              </span>
            </label>
          );
        })}
      </div>
      <div class="ds-layout" role="radiogroup" aria-label="比較の仕方" data-layout-choices>
        {/* 比較の仕方は「事務所の既定値」「この世帯だけ」の印を出さない（選択肢が3つだけで迷わないため。利用者の判断。0213 の段C）。
            その世帯で値を変えたら世帯の値になる動きは、ほかの設定と同じ */}
        <span class="ds-k">比較の仕方</span>
        {LAYOUT_CHOICES.map((c) => (
          <label key={c.key} class={`ds-item${value.layout === c.key ? " on" : ""}`}>
            <input type="radio" name="chart-layout" value={c.key} checked={value.layout === c.key} onChange={() => onChange({ ...value, layout: c.key })} data-layout={c.key} />
            <span class="ds-l">
              {c.label}
              {c.key === "overlay" ? "（既定）" : ""}
              <small>{c.note}</small>
            </span>
          </label>
        ))}
      </div>
      {office !== undefined ? (
        <div class="ds-marks" data-display-marks="result.inv">
          <span>資産の推移のグラフの上のチェック:</span>
          <span>
            口座の内訳を表示 <OfficeMark marks={office} ids={["result.invBreakdown"]} />
          </span>
          <span>
            運用の期間を表示 <OfficeMark marks={office} ids={["result.invPeriods"]} />
          </span>
        </div>
      ) : null}
    </div>
  );
}
