// 事務所の既定値の画面「FP顧問料の料金表」（0073 の追記 2026-10-27・0261）: 単発の料金・継続の顧問料（月額／年額）・料金の段階・万一のときの扱い。
// FP顧問料の契約を足すときに写す（足した契約は、後で料金表を変えても変わらない）
import { revealAdded } from "../../presentation/revealAdded.ts";
import { feeYenFromText, FEE_STEP_YEAR_MAX, type FeeTexts } from "./formText.ts";
import { Help } from "../../presentation/Help.tsx";
import { fieldId, NumField, OfficeGroup, OfficeSection, SegField } from "./OfficeFields.tsx";
import type { FeeTable } from "./settings.ts";

export interface FeePageProps {
  table: FeeTable;
  fee: FeeTexts;
  onFee: (f: FeeTexts) => void;
  onTable: (t: FeeTable) => void;
  /** 料金表の文字が読めるか（読めなければ段階の並びの下に知らせる） */
  ok: boolean;
}

export function FeePage({ table, fee, onFee, onTable, ok }: FeePageProps) {
  const per = table.per === "month" ? "月" : "年";
  return (
    <>
      <OfficeSection id="os-fee-amounts" title="料金" help="額は税込です。顧客の画面には額だけを出します（値上げの率は使いません）。">
        <OfficeGroup data={{ "data-office-fee": "" }}>
          <div class="os-fields">
            <NumField
              name="feeOneTime"
              label="単発の料金（相談料・プラン作成料）"
              value={fee.oneTime}
              onInput={(v) => onFee({ ...fee, oneTime: v })}
              suffix="万円"
              placeholder="30"
              help="税込。万円で入れます（「12,000円」のように円を付ければ円）。"
              note="0なら単発の料金を入れません"
              problem={feeYenFromText(fee.oneTime) === undefined ? "万円の数で入れてください" : null}
              data={{ "data-office-fee-one": "" }}
            />
            {/* 継続の顧問料: 払い方（月額・年額の区切りボタン）と額を1つの欄に並べる */}
            <div class="fld">
              <div class="fld-l">
                <label for={fieldId("feeAmount")}>継続の顧問料（{per}額）</label>
                <Help label="継続の顧問料">税込。月額は毎月払う（既定）、年額は毎年、始まりの月に払います。単発の料金の12か月後（翌年の同じ月）から払います。</Help>
              </div>
              <div class="fld-c">
                <span class="seg-g fld-seg" role="radiogroup" aria-label="継続の顧問料の払い方">
                  {(["month", "year"] as const).map((v) => (
                    <button key={v} type="button" role="radio" aria-checked={table.per === v} tabIndex={table.per === v ? 0 : -1} onClick={() => onTable({ ...table, per: v })} onKeyDown={(e) => {
                      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
                      e.preventDefault();
                      const to = v === "month" ? "year" : "month";
                      onTable({ ...table, per: to });
                      ((e.currentTarget as HTMLElement).parentElement?.children[to === "month" ? 0 : 1] as HTMLElement | undefined)?.focus();
                    }} data-office-fee-per={v}>
                      {v === "month" ? "月額" : "年額"}
                    </button>
                  ))}
                </span>
                <span class="fld-in">
                  <input id={fieldId("feeAmount")} type="text" class={`num${feeYenFromText(fee.amount) === undefined ? " bad" : ""}`} inputMode="decimal" value={fee.amount} placeholder="1" aria-invalid={feeYenFromText(fee.amount) === undefined} onInput={(e) => onFee({ ...fee, amount: (e.currentTarget as HTMLInputElement).value })} data-office-fee-amount />
                  <span class="suffix">万円</span>
                </span>
              </div>
              {feeYenFromText(fee.amount) === undefined ? (
                <div class="fld-help bad" role="alert">
                  万円の数で入れてください
                </div>
              ) : (
                <div class="fld-help">単発の料金の12か月後（翌年の同じ月）から</div>
              )}
            </div>
          </div>
          <h6 class="os-sub-h">料金の段階</h6>
          {fee.steps.length > 0 ? (
            <ol class="os-steps">
              {fee.steps.map((x, i) => (
                <li key={i} data-office-fee-step={i}>
                  <span class="fld-in">
                    <input id={fieldId(`feeStepYear.${i}`)} type="text" class="num os-num-xs" inputMode="numeric" value={x.year} aria-label={`料金の段階 ${i + 1}: 何年目から`} onInput={(e) => onFee({ ...fee, steps: fee.steps.map((y, j) => (j === i ? { ...y, year: (e.currentTarget as HTMLInputElement).value } : y)) })} />
                    <span class="suffix">年目から{per}</span>
                    <input type="text" class="num os-num-s" inputMode="decimal" value={x.amount} aria-label={`料金の段階 ${i + 1}: 額（万円）`} onInput={(e) => onFee({ ...fee, steps: fee.steps.map((y, j) => (j === i ? { ...y, amount: (e.currentTarget as HTMLInputElement).value } : y)) })} />
                    <span class="suffix">万円</span>
                  </span>
                  <button type="button" class="link-btn danger" onClick={() => onFee({ ...fee, steps: fee.steps.filter((_y, j) => j !== i) })}>
                    外す
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
          {!ok && feeYenFromText(fee.oneTime) !== undefined && feeYenFromText(fee.amount) !== undefined ? (
            <div class="fld-help bad" role="alert" data-office-fee-problem>
              段階は2〜{FEE_STEP_YEAR_MAX}年目で、重ならないように入れてください（額は万円）
            </div>
          ) : null}
          <p class="os-acts">
            <button
              type="button"
              class="add-btn"
              onClick={(e) => {
                revealAdded(e.currentTarget);
                onFee({ ...fee, steps: [...fee.steps, { year: String(Math.max(1, ...fee.steps.map((y) => Number(y.year) || 1)) + 1), amount: fee.steps.at(-1)?.amount ?? fee.amount }] });
              }}
              data-office-fee-add-step
            >
              ＋ 料金の段階（○年目から○万円）
            </button>
          </p>
        </OfficeGroup>
      </OfficeSection>
      <OfficeSection id="os-fee-contingency" title="払う人などに万一があったとき">
        <OfficeGroup>
          <div class="os-fields">
            <SegField
              name="feeOnContingency"
              label="継続の顧問料"
              value={table.onContingency}
              options={[
                { value: "stop", label: "止める（既定）", data: { "data-office-fee-on": "stop" } },
                { value: "continue", label: "万一のあとも続ける", data: { "data-office-fee-on": "continue" } },
              ]}
              onPick={(v) => onTable({ ...table, onContingency: v })}
              help="払う人などに万一があったら、継続の顧問料を止めるか、万一のあとも続けるかです。"
            />
          </div>
        </OfficeGroup>
      </OfficeSection>
    </>
  );
}
