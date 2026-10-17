// 表示の設定（作業の層の部品。主画面のグラフの右上の「表示の設定」で、結論の下に開く。別の窓は出さない）。
// FP が主画面に出す数字を選ぶ。既定では何も足さない。事務所の設定として持てる形で、まだファイルには保存しない（settings.ts）
import { AGE_OPTIONS, METRIC_CHOICES, shows, toggleMetric, type DisplaySettings } from "./settings.ts";

export function DisplaySettingsPanel({ value, onChange, onClose, feeAvailable }: { value: DisplaySettings; onChange: (s: DisplaySettings) => void; onClose: () => void; feeAvailable: boolean }) {
  return (
    <div class="disp-settings" role="group" aria-label="表示の設定" data-display-settings>
      <div class="ds-head">
        <b>表示の設定</b>
        <span class="ds-note">主画面に出す数字を選びます（事務所の設定。今は画面の中だけで持ち、アプリを閉じると元に戻ります）</span>
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
    </div>
  );
}
