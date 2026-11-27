// AIからの Web のヒアリングのひな形の案（0222。接続口の propose_hearing_template）: 事務所の既定値の「入力の画面」のいちばん上に、案ごとに名前・票・聞く項目・
// 独自の質問・頼む書類と AI の理由を出し、「ひな形として保存する」か「捨てる」を選ぶ。保存したときだけ事務所のひな形（hearingTemplates）に入る。
// AI が書いた名前・独自の質問・理由は信用しない文章として文字のまま出す（番号らしい所は書類の候補と同じ決まりで消してある）
import type { AiHearingTemplateCandidate } from "../../engine/host.ts";
import { readTemplateProposal } from "../hearing/aiHearing.ts";
import { selectionSummary } from "../hearing/aiSelection.ts";
import { selectedCount, TEMPLATE_MAX, type HearingTemplate } from "../hearing/selection.ts";
import { dateTimeText } from "../ai/model.ts";

/** 上の帯（届いている案の数と、事務所の既定値の画面を開くボタン。中身は出さない） */
export function AiHearingTemplateBand({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count <= 0) return null;
  return (
    <div class="ai-code-band" role="status" data-ai-hearing-template-band>
      <b>AIから、ヒアリングのひな形の案が届いています（{count}件）</b>
      <span class="pl-sub">確認して「ひな形として保存する」を押すまで、事務所のひな形は変わりません</span>
      <button type="button" class="link-btn" onClick={onOpen} data-ai-hearing-template-band-open>
        事務所の既定値で確認する
      </button>
    </div>
  );
}

export interface HearingTemplateProposalsProps {
  candidates: readonly AiHearingTemplateCandidate[];
  templates: readonly HearingTemplate[];
  /** 保存する（すぐ事務所データへ。保存した事務所の既定値を返す） */
  onSave: (candidateId: string, name: string, selection: NonNullable<ReturnType<typeof readTemplateProposal>["selection"]>) => Promise<unknown>;
  onDiscard: (candidateId: string) => Promise<void>;
}

export function HearingTemplateProposals({ candidates, templates, onSave, onDiscard }: HearingTemplateProposalsProps) {
  if (candidates.length === 0) return null;
  return (
    <section class="os-sec" aria-labelledby="os-hearing-proposals" data-ai-hearing-templates>
      <h4 id="os-hearing-proposals" class="os-h">AIからのヒアリングのひな形の案</h4>
      <p class="pl-sub">URL で聞くときの「カスタム」に入る組み合わせの案です。「ひな形として保存する」を押したときだけ、事務所のひな形に入ります（{TEMPLATE_MAX}件まで）。</p>
      {candidates.map((c) => {
        const v = readTemplateProposal(c, templates, TEMPLATE_MAX);
        const sum = v.selection === null ? null : (selectionSummary(v.selection) as { sheet: string; sections: { title: string; items: { label: string }[] }[]; documents: string[] });
        return (
          <div class="os-code-cand" key={c.candidateId} role="group" aria-label="AIからの、ヒアリングのひな形の案" data-ai-hearing-template={c.candidateId}>
            <p class="os-code-cand-title">
              <b>
                カスタム: <span class="ai-untrusted">{v.name}</span>
              </b>
              <span class="pl-sub">
                {dateTimeText(c.receivedAt)}
                {c.connector !== null ? `・${c.connector}` : ""}
              </span>
            </p>
            {sum !== null && v.selection !== null ? (
              <>
                <p class="rp-note">
                  {sum.sheet === "simple" ? "シンプル" : "詳細"}の票・聞く項目 {selectedCount(v.selection)}・書類: {sum.documents.length === 0 ? "なし" : sum.documents.join("・")}
                </p>
                <ul class="os-hearing-items">
                  {sum.sections.map((s) => (
                    <li key={s.title}>
                      {s.title}: <span class="ai-untrusted">{s.items.map((i) => i.label).join("・")}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p class="rp-note" role="alert" data-ai-hearing-template-problem>
                <span class="fatal">この案は保存できません（{v.problems.join("・")}）</span>
              </p>
            )}
            <p class="os-display-note">
              <span class="ai-tag">AIの理由</span>
              <span class="ai-untrusted">{c.note ?? "（書いていません）"}</span>
            </p>
            {v.masked > 0 ? <p class="rp-note">番号らしい所を {v.masked}か所消しました。</p> : null}
            {v.replaces ? <p class="rp-note">同じ名前の事務所のひな形があります。保存すると置き換えます。</p> : null}
            {!v.replaces && v.full ? <p class="rp-note fatal">事務所のひな形が{TEMPLATE_MAX}件あるので、保存できません（要らないひな形を消してから）。</p> : null}
            <div class="rp-actions">
              {v.selection !== null && (v.replaces || !v.full) ? (
                <button type="button" class="btn primary" onClick={() => void onSave(c.candidateId, v.name, v.selection as NonNullable<typeof v.selection>)} data-ai-hearing-template-save>
                  ひな形として保存する
                </button>
              ) : null}
              <button type="button" class="btn" onClick={() => void onDiscard(c.candidateId)} data-ai-hearing-template-discard>
                捨てる
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
