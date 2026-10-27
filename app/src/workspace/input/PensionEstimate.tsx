// 年金のカードの下の「年金の見込み」（読むだけ。0067）。中身は pensionEstimate.ts
import { Help } from "../../presentation/Help.tsx";
import type { WorkingHousehold } from "./household.ts";
import { estimateView, type usePensionEstimate } from "./pensionEstimate.ts";

export function PensionEstimate({ wh, est }: { wh: WorkingHousehold; est: ReturnType<typeof usePensionEstimate> }) {
  const v = estimateView(wh, est);
  if (v === null || v.people.length === 0) return null;
  return (
    <div class="ip-lineup" role="note" data-pension-estimate>
      <p>
        <b>年金の見込み</b>
        <Help label="年金の見込み">計算の結果から読むだけです。物価・賃金の伸びを0にした今の水準で、これからの加入を含みます。</Help>
      </p>
      {v.people.map((p) => (
        <div key={p.member} class="ip-lineup-person" data-estimate-member={p.member}>
          <p class="who">
            {p.who}: {p.text}
            {p.sub.length > 0 ? (
              <Help label={`${p.who}の年金の見込み`}>
                <ul>
                  {p.sub.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </Help>
            ) : null}
          </p>
        </div>
      ))}
      {v.total !== null ? (
        <p class="who" data-estimate-total>
          {v.total}
        </p>
      ) : null}
    </div>
  );
}

