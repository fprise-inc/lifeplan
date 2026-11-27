// AIからの候補（主画面のプランの帯の下）: AI が出したプランの候補を、何を変えるかを確かめてから「プランとして保存」か「捨てる」。
// - 保存するまで、世帯にもプランにも入らない（0015 の7・0022 の承認の考え方）
// - AI が書いた題名・説明・理由は、信用しない文章として文字のまま出す。プランの名前はアプリが作る（FP が直せる）
// - 主画面のプランで動かせない項目は取り込まない（理由を出す）
// - プランの名前の欄は、候補の並びで決める（2つ目の候補は、保存する前から1つ目と違う文字。保存・捨てたら残った候補で作り直す）。FP が直した名前はそのまま
// - 同じ項目を後の行が動かすので使わない行（replaced）は、値を控えめにして（太字にしない・薄く・取り消し線）、読み上げにも「使わない値」と渡す
import { useState } from "preact/hooks";
import type { AiCandidate } from "../../engine/host.ts";
import type { WorkingHousehold } from "../input/household.ts";
import type { Catalog } from "../plans/items.ts";
import type { Values } from "../plans/plans.ts";
import { candidatePlanNames, candidateRows, candidateValues, dateTimeProse, type CandidateRow } from "./model.ts";

export interface AiCandidatesProps {
  candidates: readonly AiCandidate[];
  wh: WorkingHousehold;
  catalog: Catalog;
  onAccept: (c: AiCandidate, name: string) => Promise<void>;
  onReject: (c: AiCandidate) => Promise<void>;
}

export function AiCandidates(p: AiCandidatesProps) {
  // FP が欄で直した名前（候補の ID ごと）。直していない候補の名前は、毎回並びから作る
  const [edited, setEdited] = useState<Readonly<Record<string, string>>>({});
  const pending = p.candidates.filter((c) => c.status === "pending");
  if (pending.length === 0) return null;
  const shown = pending.map((c) => {
    const rows = candidateRows(c, p.wh, p.catalog);
    return { c, rows, values: candidateValues(rows) };
  });
  const names = candidatePlanNames(
    p.wh,
    p.catalog,
    shown.map((x) => ({ values: x.values, name: Object.hasOwn(edited, x.c.id) ? (edited[x.c.id] as string) : null })),
  );
  return (
    <section class="card ai-cands" aria-label="AIからの候補" data-ai-candidates>
      <div class="card-h">
        <h2>AIからの候補（{pending.length}件）</h2>
        <span class="aside">AI が作ったプランの候補です。中身を確認して、プランとして保存するか捨ててください。保存するまで、世帯にもプランにも入りません。</span>
      </div>
      {shown.map((x, i) => (
        <CandidateCard key={x.c.id} {...p} {...x} name={names[i] as string} onName={(name) => setEdited((m) => ({ ...m, [x.c.id]: name }))} />
      ))}
    </section>
  );
}

/** 候補の値の見せ方: プランの値を決める行（入れる・今の値に戻す）は太字、後の行に置き換わる行は控えめに（読み上げにも渡す）、ほかは普通の字 */
function CandidateValue({ r }: { r: CandidateRow }) {
  if (r.use === "apply" || r.use === "restore") return <b>{r.to}</b>;
  if (r.use === "replaced")
    return (
      <>
        <span class="vh">使わない値（後の行の値に置き換わります）: </span>
        <span class="ai-off">{r.to}</span>
      </>
    );
  return <>{r.to}</>;
}

function CandidateCard({ c, rows, values, name, onName, onAccept, onReject }: AiCandidatesProps & { c: AiCandidate; rows: CandidateRow[]; values: Values; name: string; onName: (name: string) => void }) {
  const usable = Object.keys(values).length;
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
          {dateTimeProse(c.receivedAt)} に届きました{c.origin.connector !== null ? `・AI のアプリの名乗り: ${c.origin.connector}（自己申告）` : ""}
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
            <tr key={r.diffId} class={r.use === "apply" ? "" : r.use === "replaced" ? "ai-skip ai-replaced" : "ai-skip"} data-ai-row={r.use === "apply" ? "use" : "skip"} data-ai-use={r.use}>
              <td>
                {r.place !== null ? (
                  <>
                    <span class="pl-sub">{r.place}</span>
                    <br />
                  </>
                ) : null}
                <span class={r.use === "replaced" ? "ai-off" : undefined}>{r.label}</span>
              </td>
              <td class="num">{r.from}</td>
              <td class="num">
                <CandidateValue r={r} />
              </td>
              <td class="ai-untrusted">{r.note ?? "—"}</td>
              <td>{r.use === "apply" ? "プランに入れる" : r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="ai-cand-foot">
        <label>
          プランの名前
          <input value={name} maxLength={80} onInput={(e) => onName((e.currentTarget as HTMLInputElement).value)} data-ai-plan-name />
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
