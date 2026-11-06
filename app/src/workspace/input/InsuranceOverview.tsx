// 保険の入力項目の「保険料と解約返戻金」の区画（0055。読むだけ。簡易にも出す。欄の下に置く）。入力は増えない。
// 保険料の月・年の合計とこれから払う総額、必要保障額をどこで見るかの1行、貯蓄型の契約だけ解約返戻金の元本割れを1行
import type { InsuranceView } from "./insuranceView.ts";

const man = (v: number) => `${Math.round(v / 10000).toLocaleString("ja-JP")}万円`;

export function InsuranceOverview({ view }: { view: InsuranceView | null }) {
  if (view === null) return null;
  const p = view.premium;
  return (
    <section class="in-section ins-ov" aria-label="保険料と解約返戻金" data-insurance-overview>
      <p class="in-note" data-insurance-premium>
        保険料 月 {p.monthly.toLocaleString("ja-JP")}円（年 {p.annual.toLocaleString("ja-JP")}円）・これから払う総額 {man(p.remaining)}
      </p>
      {/* 必要保障額との過不足は万一のときのタブで見る（同じ計算を2か所に出さない。0055 の 2026-10-29 の追記。数字はここに出さない） */}
      <p class="in-note" data-insurance-need>
        必要保障額との過不足は、結果の「万一のとき」のタブで見ます
      </p>
      {view.savings.map((s) => (
        <p key={s.object} class="in-note" data-insurance-savings={s.object}>
          解約返戻金: {s.label} {s.text}
        </p>
      ))}
    </section>
  );
}
