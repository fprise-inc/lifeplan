// 退職金・企業年金のカードの下の「受け取りの並び」（読むだけ。0057）。中身は retirementLineup.ts
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";
import type { WorkingHousehold } from "./household.ts";
import { memberLabel } from "./labels.ts";
import { lineups, useLineupResult } from "./retirementLineup.ts";

export function RetirementLineup({ wh, computeOne }: { wh: WorkingHousehold; computeOne?: (req: EngineRequest) => Promise<PreviewResult | null> }) {
  const r = useLineupResult(wh, true, computeOne);
  const list = lineups(wh, r);
  if (list.length === 0) return null;
  const withTax = r !== null;
  return (
    <div class="ip-lineup" role="note" data-retirement-lineup>
      <p>
        <b>受け取りの並び</b>（読むだけ。時期・受け取り方はプランで変えて比べられます）
      </p>
      {list.map((l) => (
        <div key={l.member} class="ip-lineup-person" data-lineup-member={l.member}>
          <p class="who">{memberLabel(wh, l.member)}</p>
          <table>
            <thead>
              <tr>
                <th scope="col">時期</th>
                <th scope="col">もの</th>
                <th scope="col">額</th>
                {withTax ? <th scope="col">退職所得の税</th> : null}
              </tr>
            </thead>
            <tbody>
              {l.rows.map((x) => (
                <tr key={`${x.ym}/${x.what}`}>
                  <td>{x.when}</td>
                  <td>
                    {x.what}
                    {x.from === "savings" ? <span class="sub">（→ 貯蓄・運用で直す）</span> : null}
                  </td>
                  <td>{x.amount}</td>
                  {withTax ? <td>{x.tax ?? "—"}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
          {l.notes.length > 0 ? (
            <ul class="notes">
              {l.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}
