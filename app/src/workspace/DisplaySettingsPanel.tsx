// 結果のタブの表示の設定（作業の層の部品。結果のグラフの右上の「表示の設定」で、結論の下に開く。別の窓は出さない）。
// FP が結果に出す数字と、グラフの比べ方（重ねる／左右に並べる／全部の案を色分けで重ねる）を選ぶ。既定では何も足さず、重ねる。
// 資産と負債のタブの設定（時点を並べるの既定・家計の体力の目安の幅）は、そのタブの表示の設定にある（BalanceTab.tsx）
import { AGE_OPTIONS, LAYOUT_CHOICES, METRIC_CHOICES, shows, toggleMetric, type DisplaySettings } from "./settings.ts";

export function DisplaySettingsPanel({ value, onChange, onClose, feeAvailable }: { value: DisplaySettings; onChange: (s: DisplaySettings) => void; onClose: () => void; feeAvailable: boolean }) {
  return (
    <div class="disp-settings" role="group" aria-label="表示の設定" data-display-settings>
      <div class="ds-head">
        <b>表示の設定</b>
        <span class="ds-note">結果のタブに出す数字とグラフの見せ方を選びます（世帯を保存していれば、世帯のファイルに一緒に保存します）</span>
        <button type="button" class="link-btn" onClick={onClose}>
          閉じる
        </button>
      </div>
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
                      value={String(value.atAge)}
                      onChange={(e) => onChange({ ...toggleMetric(value, "assetsAtAge", true), atAge: Number((e.currentTarget as HTMLSelectElement).value) })}
                      aria-label="年齢"
                      data-metric-age
                    >
                      {AGE_OPTIONS.map((a) => (
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
      <div class="ds-layout" role="radiogroup" aria-label="比べ方" data-layout-choices>
        <span class="ds-k">比べ方</span>
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
    </div>
  );
}
