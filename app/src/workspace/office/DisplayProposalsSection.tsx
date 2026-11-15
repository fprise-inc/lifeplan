// 事務所の既定値の画面の「AIからの表示の設定の案」（0215。接続口の propose_display_settings）: AI が出した案を設定ごとに「今 → 案」で並べ、
// FP が「反映する」か「捨てる」を選ぶ。反映した設定は、すぐ事務所の既定値に保存する（パネルの「保存」は要らない）。
// 「前の値に戻す」: 反映する前の値（事務所データの前の値。office/displayHistory.ts）を、設定ごとに新しい順に出し、押すとその値に戻す。
// - AI が書いた理由は、信用しない文章として文字のまま出す（AIからの候補の画面と同じ）。案の値は画面が確かめ直し、確かめられない案は「捨てる」だけ
// - 「新しい世帯で出す入力項目と、開いたときの入れ方」は新しく作る世帯にだけ効く（作った世帯にそろえる操作は出さない）
// - 結果のタブ・資産と負債のタブの表示の設定（0213 の段C）は、事務所の既定値に従う世帯にだけ効く（従わない世帯にそろえる操作は出さない）
import { useState } from "preact/hooks";
import type { AiDisplayCandidate } from "../../engine/host.ts";
import { buildDisplayCatalog, type ProposableDisplayId } from "../../connector/displayCatalog.ts";
import { isProposableDisplayId } from "../../connector/displayProposal.ts";
import { dateTimeText } from "../ai/model.ts";
import { DISPLAY_HISTORY_MAX } from "./displayHistory.ts";
import { displayNow, displayText, proposalRow } from "./displayProposals.ts";
import type { OfficeSettings } from "./settings.ts";

export interface DisplayProposalsSectionProps {
  /** 保存してある事務所の既定値（「今」はこの値） */
  value: OfficeSettings;
  candidates: readonly AiDisplayCandidate[];
  /** 案の1つの設定を反映する（値は確かめてそろえた物。保存した事務所の既定値を返す） */
  onApply: (candidate: string, id: ProposableDisplayId, value: unknown) => Promise<OfficeSettings>;
  /** 案の1つの設定を捨てる（設定は変えない） */
  onDiscard: (candidate: string, id: string) => Promise<void>;
  /** 前の値に戻す（index は前の値の並びの位置。保存した事務所の既定値を返す） */
  onRestore: (id: ProposableDisplayId, index: number) => Promise<OfficeSettings>;
}

/** 事務所の既定値の効き方の言葉（表示の設定の一覧の officeEffect） */
const EFFECT_TEXT: Readonly<Record<"live" | "newHouseholds" | "followers", string>> = {
  live: "どの世帯にもすぐ効きます",
  newHouseholds: "新しく作る世帯にだけ効きます（作った世帯は変わりません）",
  followers: "事務所の既定値に従う世帯にすぐ効きます（世帯で変えた設定と、前からある世帯は変わりません）",
};

let labels: Map<string, { label: string; effect: string }> | null = null;
/** 設定の名前と効き方（表示の設定の一覧と同じ言葉） */
function labelOf(id: string): { label: string; effect: string } {
  labels ??= new Map(buildDisplayCatalog().settings.map((s) => [s.id, { label: s.label, effect: EFFECT_TEXT[s.officeEffect ?? "live"] }]));
  return labels.get(id) ?? { label: id, effect: "" };
}

const errorText = (e: unknown): string => (typeof e === "string" ? e : e instanceof Error ? e.message : "E_OFFICE_SETTINGS");

export function DisplayProposalsSection({ value, candidates, onApply, onDiscard, onRestore }: DisplayProposalsSectionProps) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const history = value.displayHistory ?? {};
  const restorable = (Object.keys(history) as ProposableDisplayId[]).filter((id) => (history[id] ?? []).length > 0);
  if (candidates.length === 0 && restorable.length === 0) return null;
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
    <section class="os-sec" aria-labelledby="os-ai-display" data-office-ai-display>
      <h3 id="os-ai-display">AIからの表示の設定の案</h3>
      {candidates.length > 0 ? (
        <p class="pl-sub">
          AIが出したのは案だけです。設定ごとに今と案を確かめて、「反映する」を押した設定だけが事務所の既定値に入ります（すぐ保存します。パネルの「保存」は要りません）。見せ方だけの設定なので、世帯の値も計算の結果も変わりません。反映した後も「前の値に戻す」で戻せます。
        </p>
      ) : null}
      {candidates.map((c) => (
        <div class="os-code-cand" key={c.candidateId} role="group" aria-label="AIからの、表示の設定の案" data-display-candidate={c.candidateId}>
          <p class="os-code-cand-title">
            <b>表示の設定の案（{c.changes.length}件）</b>
            <span class="pl-sub">
              {dateTimeText(c.receivedAt)} に届きました{c.connector !== null ? `（AIのアプリの名乗り: ${c.connector}。確かめられない参考の情報です）` : ""}
            </span>
          </p>
          {c.changes.map((ch) => {
            const known = isProposableDisplayId(ch.id);
            const row = known ? proposalRow(value, ch.id as ProposableDisplayId, ch.value) : null;
            const { label, effect } = labelOf(ch.id);
            const problem = row === null ? "この画面では反映できない設定です" : row.problem;
            return (
              <div class="os-display-row" key={ch.id} role="group" aria-label={label} data-display-change={ch.id}>
                <p class="os-display-name">
                  <b>{label}</b>
                  {effect !== "" ? <small class="pl-sub">{effect}</small> : null}
                </p>
                <div class="os-display-diff">
                  <div class="os-display-side" data-display-now>
                    <span class="os-display-head">今</span>
                    {row?.now ?? "—"}
                  </div>
                  <span class="os-display-arrow" aria-hidden="true">
                    →
                  </span>
                  <div class={`os-display-side${problem === null && row?.unchanged !== true ? " os-code-diff-new" : ""}`} data-display-next>
                    <span class="os-display-head">案</span>
                    {problem !== null ? (
                      <span class="fatal" data-display-problem>
                        この案は反映できません（{problem}）
                      </span>
                    ) : row?.unchanged === true ? (
                      <span>今と同じです（反映しても変わりません）</span>
                    ) : (
                      row?.next
                    )}
                  </div>
                </div>
                {row?.change != null && problem === null && !row.unchanged ? (
                  <p class="pl-sub os-display-change" data-display-delta>
                    変わる所: {row.change}
                  </p>
                ) : null}
                <p class="os-display-note">
                  <span class="ai-tag">AIの理由</span>
                  <span class="ai-untrusted">{ch.note ?? "（書いていません）"}</span>
                </p>
                <div class="rp-actions">
                  {problem === null && row !== null && !row.unchanged ? (
                    <button
                      type="button"
                      class="btn primary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await onApply(c.candidateId, row.id, row.value);
                          return `「${label}」に反映しました。${effect}。`;
                        })
                      }
                      data-display-apply={ch.id}
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
                    data-display-discard={ch.id}
                  >
                    捨てる
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {restorable.length > 0 ? (
        <div class="os-lever-group" data-display-history>
          <h4>前の値に戻す</h4>
          <p class="pl-sub">AIの案を反映する前の値です（設定ごとに新しい方から{DISPLAY_HISTORY_MAX}件まで）。戻すと、戻す前の値もここに残ります。</p>
          {restorable.map((id) => {
            const { label } = labelOf(id);
            const list = history[id] ?? [];
            return (
              <div key={id} class="os-display-hist" data-display-history-setting={id}>
                <p>
                  <b>{label}</b>
                  <span class="pl-sub">（今: {displayNow(value, id).text}）</span>
                </p>
                <ul class="os-cards">
                  {list
                    .map((e, i) => ({ e, i }))
                    .reverse()
                    .map(({ e, i }) => (
                      <li key={`${e.at}-${i}`} data-display-history-entry={`${id}:${i}`}>
                        <span class="os-name">
                          <span class="pl-sub">
                            {dateTimeText(e.at)} {e.reason === "ai" ? "AIの案を反映する前" : "前の値に戻す前"}:
                          </span>{" "}
                          {displayText(id, e.value)}
                        </span>
                        <button
                          type="button"
                          class="link-btn"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await onRestore(id, i);
                              return `「${label}」を前の値に戻しました。`;
                            })
                          }
                          data-display-restore={`${id}:${i}`}
                        >
                          この値に戻す
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}
      {msg !== null ? (
        <p class={msg.ok ? "pl-sub" : "fatal"} role="status" data-display-msg>
          {msg.text}
        </p>
      ) : null}
    </section>
  );
}
