// 保険のカードの「保障の見え方」の区画（0055。読むだけ。簡易にも出す）。入力は増えない。
// 保障の階段（契約ごとに積み上げ）と必要保障額の線（今の貯蓄を差し引いた線が既定・差し引かない線も並べる）、過不足、内訳、保険料、
// 保険料のうち貯まる分と元本割れ、病気の想定で受け取る見込み、気づき、必要保障額に合わせるボタン
import type { WorkingHousehold } from "./household.ts";
import { fitToNeed } from "./stages/insurance.ts";
import type { InsuranceView, MemberView } from "./insuranceView.ts";

const COLORS = ["#3B86AE", "#E0A23B", "#5BA36B", "#B5679E", "#7A7FC4", "#C8664B", "#4BA6A0", "#9C8A55"];
const man = (v: number) => `${Math.round(v / 10000).toLocaleString("ja-JP")}万円`;

function Steps({ m, colors }: { m: MemberView; colors: Map<string, string> }) {
  const W = 560;
  const H = 150;
  const pad = { l: 62, r: 8, t: 8, b: 18 };
  const n = m.years.length;
  const max = Math.max(1, ...m.years.map((y) => Math.max(y.coverage, y.need, y.needWithAssets)));
  const bw = (W - pad.l - pad.r) / n;
  const yOf = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const line = (pick: (i: number) => number) => m.years.map((_, i) => `${i === 0 ? "M" : "L"}${pad.l + bw * (i + 0.5)},${yOf(pick(i))}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} class="ins-steps" role="img" aria-label={`${m.label}の保障の階段と必要保障額`}>
      <text x={pad.l - 4} y={pad.t + 8} text-anchor="end" class="ins-ax">
        {man(max)}
      </text>
      <text x={pad.l - 4} y={H - pad.b} text-anchor="end" class="ins-ax">
        0
      </text>
      {m.years.map((y, i) => {
        let acc = 0;
        return (
          <g key={y.year}>
            {y.by.map((b) => {
              const y0 = yOf(acc);
              acc += b.amount;
              const y1 = yOf(acc);
              return <rect key={b.object} x={pad.l + bw * i + 0.5} y={y1} width={Math.max(1, bw - 1)} height={Math.max(0, y0 - y1)} fill={colors.get(b.object) ?? "#999"} />;
            })}
            {i % 5 === 0 ? (
              <text x={pad.l + bw * (i + 0.5)} y={H - 4} text-anchor="middle" class="ins-ax">
                {y.year}
              </text>
            ) : null}
          </g>
        );
      })}
      <path d={line((i) => m.years[i]?.need ?? 0)} fill="none" stroke="#888" stroke-width="1.5" stroke-dasharray="4 3" />
      <path d={line((i) => m.years[i]?.needWithAssets ?? 0)} fill="none" stroke="#C0392B" stroke-width="2" />
    </svg>
  );
}

export function InsuranceOverview({ wh, view, onEdit }: { wh: WorkingHousehold; view: InsuranceView | null; onEdit: (w: WorkingHousehold) => void }) {
  if (view === null) return null;
  const colors = new Map(view.legend.map((l, i) => [l.object, COLORS[i % COLORS.length] as string]));
  const p = view.premium;
  return (
    <section class="in-section ins-ov" aria-label="保障の見え方" data-insurance-overview>
      <h3>保障の見え方</h3>
      <p class="in-note">
        保険料 月 {p.monthly.toLocaleString("ja-JP")}円（年 {p.annual.toLocaleString("ja-JP")}円）・これから払う総額 {man(p.remaining)}
      </p>
      {p.rises.length > 0 ? <p class="in-note">更新で上がる年: {p.rises.join("、")}</p> : null}
      {p.ends.length > 0 ? <p class="in-note">払込が終わる年: {p.ends.join("、")}</p> : null}
      {view.members.map((m) => (
        <div key={m.member} class="ins-member" data-insurance-member={m.member}>
          <h4>{m.label}が亡くなった場合の保障</h4>
          <Steps m={m} colors={colors} />
          <p class="in-note" data-insurance-gap>
            {m.worst !== null
              ? `必要保障額（今の貯蓄を差し引いた額。赤の線）に対して、いちばん大きい不足は ${m.worst.year}年の ${man(m.worst.shortfall)}`
              : m.years.every((y) => y.needWithAssets === 0)
                ? "今の貯蓄を差し引くと、どの年も必要保障額は0円です（赤の線）"
                : m.least !== null
                  ? `必要保障額（今の貯蓄を差し引いた額。赤の線）を、どの年も満たしています（いちばん少ない年でも ${man(m.least.surplus)}多い）`
                  : ""}
            。点線は貯蓄を差し引かない必要保障額。
          </p>
          {m.breakdown !== null ? (
            <details class="ins-break">
              <summary>
                {m.breakdown.year}年に亡くなった場合の内訳（必要な資金 {man(m.breakdown.expenses)}・準備できる資金 {man(m.breakdown.resources)}）
              </summary>
              <ul>
                <li>
                  必要な資金（毎年の分の合計）: 生活費 {man(m.breakdown.b.expenses.living)}・住居費 {man(m.breakdown.b.expenses.housing)}・教育費 {man(m.breakdown.b.expenses.education)}・保険料 {man(m.breakdown.b.expenses.premiums)}・介護 {man(m.breakdown.b.expenses.care)}・税と社会保険料 {man(m.breakdown.b.expenses.taxSi)}・そのほか {man(m.breakdown.b.expenses.other)}
                </li>
                <li>
                  必要な資金（一時の分）: 整理資金 {man(m.breakdown.b.lump.funeral)}・予備の生活資金 {man(m.breakdown.b.lump.reserve)}
                </li>
                <li>
                  準備できる資金（毎年の分の合計）: 遺族年金 {man(m.breakdown.b.resources.survivorPension)}・遺族の収入 {man(m.breakdown.b.resources.survivorIncome)}・児童手当と教育の公的支援 {man(m.breakdown.b.resources.publicSupport)}
                </li>
                <li>
                  準備できる資金（一時の分）: 死亡退職金 {man(m.breakdown.b.lumpResources.retirementAllowance)}・確定拠出年金の死亡一時金 {man(m.breakdown.b.lumpResources.dcLump)}・弔慰金 {man(m.breakdown.b.lumpResources.condolence)}
                </li>
                {m.breakdown.b.creditLife > 0 ? <li>団信で消える住宅ローンの返済 {man(m.breakdown.b.creditLife)}（住居費から除いています）</li> : null}
              </ul>
            </details>
          ) : null}
        </div>
      ))}
      {view.legend.length > 0 ? (
        <ul class="ins-legend">
          {view.legend.map((l) => (
            <li key={l.object}>
              <span class="sw" style={{ background: colors.get(l.object) }} />
              {l.label}
            </li>
          ))}
        </ul>
      ) : null}
      {view.fits.length > 0 ? (
        <div class="ins-fits">
          {view.fits.map((f) => (
            <p key={f.object} class="in-note">
              {f.label}: 死亡保険金が未入力です。{f.amount > 0 ? `${f.year}年の不足は ${man(f.amount)}。` : "今の保障で必要保障額を満たしています。"}
              {f.amount > 0 ? (
                <button type="button" class="link-btn" onClick={() => onEdit(fitToNeed(wh, f.object, f.amount, f.year))} data-fit-need={f.object}>
                  必要保障額に合わせる（新しく入る保険のとき）
                </button>
              ) : null}
            </p>
          ))}
        </div>
      ) : null}
      {view.savings.length > 0 ? (
        <div class="ins-savings">
          <h4>保険料のうち貯まる分（解約返戻金）</h4>
          <ul>
            {view.savings.map((s) => (
              <li key={s.object}>
                {s.label}: {s.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {view.medical !== null && view.medical.lines.length > 0 ? (
        <div class="ins-medical" data-insurance-medical>
          <h4>{view.medical.heading}</h4>
          <ul>
            {view.medical.lines.map((l) => (
              <li key={l.object}>
                {l.label}: {l.parts.length > 0 ? `${l.parts.map((x) => `${x.label} ${man(x.amount)}`).join("＋")}＝` : ""}
                {man(l.total)}
              </li>
            ))}
          </ul>
          <p class="in-note">病気の種類・入院の日数・手術の回数は、万一のタブの「大きな病気のときの前提」で直せます。2回目以降のがん一時金・先進医療などの細かい条件は計算していません。</p>
        </div>
      ) : null}
      {view.notices.length > 0 ? (
        <ul class="ins-notices" aria-label="気づき">
          {view.notices.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
