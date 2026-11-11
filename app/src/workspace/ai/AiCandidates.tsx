// AIからの候補（主画面のプランの帯の下）: AI が出したプランの候補を、何を変えるかを確かめてから「プランとして保存」か「捨てる」。
// - 保存するまで、世帯にもプランにも入らない（0015 の7・0022 の承認の考え方）
// - AI が書いた題名・説明・理由は、信用しない文章として文字のまま出す。プランの名前はアプリが作る（FP が直せる）
// - 主画面のプランで動かせない項目は取り込まない（理由を出す）
import { useState } from "preact/hooks";
import type { AiCandidate } from "../../engine/host.ts";
import type { WorkingHousehold } from "../input/household.ts";
import type { Catalog } from "../plans/items.ts";
import { candidatePlanName, candidateRows, candidateValues, dateTimeText } from "./model.ts";

export interface AiCandidatesProps {
  candidates: readonly AiCandidate[];
  wh: WorkingHousehold;
  catalog: Catalog;
  onAccept: (c: AiCandidate, name: string) => Promise<void>;
  onReject: (c: AiCandidate) => Promise<void>;
}

export function AiCandidates(p: AiCandidatesProps) {
  const pending = p.candidates.filter((c) => c.status === "pending");
  if (pending.length === 0) return null;
  return (
    <section class="card ai-cands" aria-label="AIからの候補" data-ai-candidates>
      <div class="card-h">
        <h2>AIからの候補（{pending.length}件）</h2>
        <span class="aside">AI が作ったプランの候補です。中身を確かめて、プランとして保存するか捨ててください。保存するまで、世帯にもプランにも入りません。</span>
      </div>
      {pending.map((c) => (
        <CandidateCard key={c.id} c={c} {...p} />
      ))}
    </section>
  );
}

function CandidateCard({ c, wh, catalog, onAccept, onReject }: AiCandidatesProps & { c: AiCandidate }) {
  const rows = candidateRows(c, wh, catalog);
  const values = candidateValues(rows);
  const usable = Object.keys(values).length;
  const [name, setName] = useState(() => candidatePlanName(wh, catalog, values));
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <article class="ai-cand" data-ai-candidate={c.id}>
      <div class="ai-cand-h">
        <span class="ai-tag">AIが書いた題名</span>
        <b class="ai-untrusted">{c.title}</b>
        <span class="pl-sub">
          {dateTimeText(c.receivedAt)} に届きました{c.origin.connector !== null ? `・AI のアプリの名乗り: ${c.origin.connector}（自己申告）` : ""}
        </span>
      </div>
      {c.summary.trim() !== "" ? (
        <p class="ai-untrusted ai-summary">
          <span class="ai-tag">AIの説明</span>
          {c.summary}
        </p>
      ) : null}
      <table class="plan-list ai-cand-rows">
        <thead>
          <tr>
            <th>変える項目</th>
            <th>今</th>
            <th>候補</th>
            <th>AIの理由</th>
            <th>取り込み</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.diffId} class={r.key !== null && r.reason === null ? "" : "ai-skip"} data-ai-row={r.key !== null && r.reason === null ? "use" : "skip"}>
              <td>
                {r.place !== null ? (
                  <>
                    <span class="pl-sub">{r.place}</span>
                    <br />
                  </>
                ) : null}
                {r.label}
              </td>
              <td class="num">{r.from}</td>
              <td class="num">
                <b>{r.to}</b>
              </td>
              <td class="ai-untrusted">{r.note ?? "—"}</td>
              <td>{r.key !== null && r.reason === null ? "プランに入れる" : r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="ai-cand-foot">
        <label>
          プランの名前
          <input value={name} maxLength={80} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} data-ai-plan-name />
        </label>
        <button type="button" class="btn primary" disabled={busy || usable === 0} onClick={() => void act(() => onAccept(c, name))} data-ai-accept>
          プランとして保存
        </button>
        <button type="button" class="btn" disabled={busy} onClick={() => void act(() => onReject(c))} data-ai-reject>
          捨てる
        </button>
        {usable === 0 ? <span class="pl-sub">「結果」の画面のプランで動かせる変更がないため、保存できません</span> : null}
      </div>
    </article>
  );
}
