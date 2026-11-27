// AIからの表示の設定の案（その世帯に届いた物。結果のタブのプランの帯の下、AIからの候補の次。0213 の段B の後半・接続口の propose_display_settings の share_id）:
// AI が出した世帯ごとの案を、事務所の既定値の画面の「AIからの表示の設定の案」と同じ見た目で設定ごとに「今 → 案」を並べ、FP が「反映する」か「捨てる」を選ぶ。
// - 「今」はこの世帯の画面に出している値。事務所の既定値に従っている設定は「事務所の既定値」、この世帯で変えた設定は「この世帯だけ」と添える
// - 「反映する」を押した設定は、この世帯だけの値になる（事務所の既定値に従う印を外す）。元に戻すの履歴に入る（「元に戻す」で戻せる）。
//   押す前が事務所の既定値だった設定は、表示の設定の「事務所の既定値に戻す」でも戻せる
// - AI が書いた理由は、信用しない文章として文字のまま出す。案の値は画面が確かめ直し、確かめられない案は「捨てる」だけ
// - 閲覧だけで開いている世帯は、反映できない（「捨てる」だけ）
import { useState } from "preact/hooks";
import type { AiHouseholdDisplayCandidate } from "../../engine/host.ts";
import { buildDisplayCatalog, type HouseholdProposableDisplayId } from "../../connector/displayCatalog.ts";
import { householdProposalRow, type HouseholdDisplayState } from "./displayProposals.ts";
import { dateTimeProse } from "./model.ts";

export interface AiDisplayProposalsProps {
  candidates: readonly AiHouseholdDisplayCandidate[];
  state: HouseholdDisplayState;
  /** 反映できない理由（閲覧だけで開いているときなど。null は反映できる） */
  blocked: string | null;
  /** 案の1つの設定を反映する（値は確かめてそろえた物） */
  onApply: (candidate: string, id: HouseholdProposableDisplayId, value: unknown) => Promise<void>;
  /** 案の1つの設定を捨てる（設定は変えない） */
  onDiscard: (candidate: string, id: string) => Promise<void>;
}

let labels: Map<string, { label: string; screen: string }> | null = null;
/** 設定の名前と効く画面（表示の設定の一覧と同じ言葉） */
function labelOf(id: string): { label: string; screen: string } {
  labels ??= new Map(buildDisplayCatalog().settings.map((s) => [s.id, { label: s.label, screen: s.screen }]));
  return labels.get(id) ?? { label: id, screen: "" };
}

const errorText = (e: unknown): string => (typeof e === "string" ? e : e instanceof Error ? e.message : "E_AI_DISPLAY");

export function AiDisplayProposals({ candidates, state, blocked, onApply, onDiscard }: AiDisplayProposalsProps) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const total = candidates.reduce((n, c) => n + c.changes.length, 0);
  if (total === 0) return null;
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
    } catch (e) {
      setMsg({ ok: false, text: `できませんでした（${errorText(e)}）` });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section class="card ai-cands ai-display-cands" aria-label="AIからの表示の設定の案" data-ai-display-proposals>
      <div class="card-h">
        <h2>AIからの表示の設定の案（{total}件）</h2>
        <span class="aside">この世帯の見せ方の案です。設定ごとに今と案を確認して、「反映する」を押した設定だけが、この世帯だけの値になります。世帯の入力も計算の結果も変わりません。反映した後は「元に戻す」で戻せます。</span>
      </div>
      {blocked !== null ? (
        <p class="pl-sub" data-ai-display-blocked>
          {blocked}
        </p>
      ) : null}
      {candidates.map((c) => (
        <div class="os-code-cand" key={c.candidateId} role="group" aria-label="AIからの、表示の設定の案" data-ai-display-candidate={c.candidateId}>
          <p class="os-code-cand-title">
            <b>表示の設定の案（{c.changes.length}件）</b>
            <span class="pl-sub">
              {dateTimeProse(c.receivedAt)} に届きました{c.connector !== null ? `（AIのアプリの名乗り: ${c.connector}。確認できない参考の情報です）` : ""}
            </span>
          </p>
          {c.changes.map((ch) => {
            const row = householdProposalRow(state, ch.id, ch.value);
            const { label, screen } = labelOf(ch.id);
            const problem = row === null ? "この画面では反映できない設定です" : row.problem;
            const canApply = problem === null && row !== null && !row.unchanged && blocked === null;
            return (
              <div class="os-display-row" key={ch.id} role="group" aria-label={label} data-ai-display-change={ch.id}>
                <p class="os-display-name">
                  <b>{label}</b>
                  {screen !== "" ? <small class="pl-sub">{screen}</small> : null}
                </p>
                <div class="os-display-diff">
                  <div class="os-display-side" data-ai-display-now>
                    <span class="os-display-head">
                      今
                      {row?.nowFollows === true ? (
                        <span class="fld-premise office" title="事務所の既定値に従っています。反映すると、この世帯だけの値になります" data-ai-display-now-office>
                          事務所の既定値
                        </span>
                      ) : row?.nowFollows === false ? (
                        <span class="fld-premise household" data-ai-display-now-own>
                          この世帯だけ
                        </span>
                      ) : null}
                    </span>
                    {row?.now ?? "—"}
                  </div>
                  <span class="os-display-arrow" aria-hidden="true">
                    →
                  </span>
                  <div class={`os-display-side${problem === null && row?.unchanged !== true ? " os-code-diff-new" : ""}`} data-ai-display-next>
                    <span class="os-display-head">
                      案
                      {problem === null && row !== null && !row.unchanged && row.nowFollows !== null ? (
                        <span class="fld-premise household" title="反映すると、事務所の既定値を変えても、この設定はこの世帯の値のままになります">
                          この世帯だけ
                        </span>
                      ) : null}
                    </span>
                    {problem !== null ? (
                      <span class="fatal" data-ai-display-problem>
                        この案は反映できません（{problem}）
                      </span>
                    ) : row?.unchanged === true ? (
                      <span>今と同じです（反映しても変わりません）</span>
                    ) : (
                      row?.next
                    )}
                  </div>
                </div>
                {row?.nowFollows === true && canApply ? (
                  <p class="pl-sub os-display-change" data-ai-display-follow-note>
                    今は事務所の既定値に従っています。反映すると、この世帯だけの値になります（表示の設定の「事務所の既定値に戻す」で、また従わせられます）。
                  </p>
                ) : null}
                <p class="os-display-note">
                  <span class="ai-tag">AIの理由</span>
                  <span class="ai-untrusted">{ch.note ?? "（書いていません）"}</span>
                </p>
                <div class="rp-actions">
                  {canApply ? (
                    <button
                      type="button"
                      class="btn primary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await onApply(c.candidateId, row.id, row.value);
                          return `「${label}」に反映しました（この世帯だけの値）。戻すときは「元に戻す」で戻せます。`;
                        })
                      }
                      data-ai-display-apply={ch.id}
                    >
                      反映する
                    </button>
                  ) : null}
                  <button
                    type="button"
                    class="btn"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await onDiscard(c.candidateId, ch.id);
                        return `「${label}」の案を捨てました（設定は変えていません）。`;
                      })
                    }
                    data-ai-display-discard={ch.id}
                  >
                    捨てる
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {msg !== null ? (
        <p class={msg.ok ? "pl-sub" : "fatal"} role="status" data-ai-display-msg>
          {msg.text}
        </p>
      ) : null}
    </section>
  );
}
