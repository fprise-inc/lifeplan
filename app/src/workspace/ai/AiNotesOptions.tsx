// メモと面談の履歴も AI に渡す（0249）: 渡すときの印・伏せる言葉・AI に渡る文の確かめ（1件ずつ・まとめての両方で使う）。
// - 印を付けた共有だけ、FP のメモと面談の記録の両方の欄（お客さまと見てよい欄・FP だけの欄）を渡す。渡せるかは本体の判定（ai_notes_use）
// - 渡す前に本体が名前を伏せる（伏せる言葉と、敬称の前の名前らしい語）。伏せる言葉はこの画面と本体のメモリの上だけで使い、保存しない
// - 確かめの画面は、AI に渡る文（伏せた後）を伏せた所に印を付けて見せ、名前らしい所が残っていそうな世帯を先に出す
import { useState } from "preact/hooks";
import type { AiHost, AiNotesPreview } from "../../engine/host.ts";
import { aiMessage, codeOf, maskWords } from "./model.ts";

/** 印の横の説明 */
export const NOTES_OPTION_TEXT = "FPのメモと、面談の記録の両方の欄（お客さまと見てよい欄・FPだけの欄）を渡します。お名前は「（名前）」に伏せてから渡します。";
/** 伏せる言葉の欄の説明 */
export const MASK_WORDS_NOTE = "入れた言葉は、このとき渡す文を伏せるのに使うだけで、保存しません。敬称（さん・様など）の前の名前らしい語は、入れなくても伏せます。";

/** 伏せた所に印を付けた文 */
export function MaskedText({ text, spans }: { text: string; spans: readonly [number, number][] }) {
  const chars = [...text];
  const parts: (string | { mark: string })[] = [];
  let at = 0;
  for (const [s, e] of spans) {
    if (s < at || e > chars.length) continue;
    if (s > at) parts.push(chars.slice(at, s).join(""));
    parts.push({ mark: chars.slice(s, e).join("") });
    at = e;
  }
  if (at < chars.length) parts.push(chars.slice(at).join(""));
  return (
    <span class="ai-notes-text">
      {parts.map((p, i) =>
        typeof p === "string" ? (
          p
        ) : (
          <mark key={i} class="ai-masked" title="伏せた所">
            {p.mark}
          </mark>
        ),
      )}
    </span>
  );
}

/** 確かめの画面の一覧（名前らしい所が残っていそうな世帯が先。本体が並べた順） */
export function NotesPreviewList({ list, showNo }: { list: readonly AiNotesPreview[]; showNo: boolean }) {
  if (list.length === 0) return <p class="in-note">メモと面談の記録はありません。</p>;
  return (
    <div class="ai-notes-preview" data-ai-notes-preview>
      <p class="pl-sub">AIに渡る文です（伏せた所に印）。名前が残っていたら、伏せる言葉に足してください。</p>
      {list.map((p) => (
        <details key={p.id} open={p.suspects.length > 0} data-ai-notes-household={p.customerNo}>
          <summary>
            {showNo ? `${p.customerNo}: ` : ""}
            {p.texts.length === 0 ? "メモと面談の記録はありません" : `${p.texts.length}件`}
            {p.suspects.length > 0 ? (
              <span class="hh-warn" data-ai-notes-suspects={p.suspects.length}>
                {" "}
                名前らしい所が残っていそうです: {p.suspects.join("／")}
              </span>
            ) : null}
          </summary>
          <ul class="ai-notes-texts">
            {p.texts.map((t, i) => (
              <li key={i}>
                <span class="pl-sub">{t.author}</span>
                <br />
                <MaskedText text={t.text} spans={t.spans} />
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

export interface NotesOptionsProps {
  ai: AiHost;
  /** 確かめの画面で見る世帯 */
  ids: readonly string[];
  /** 印を付けているか */
  on: boolean;
  onToggle: (on: boolean) => void;
  /** 伏せる言葉の欄（文字のまま。区切りは maskWords） */
  words: string;
  onWords: (w: string) => void;
  /** 渡せないときの理由の文（1件ずつのとき。渡せれば null） */
  blocked: string | null;
  /** メモと面談の記録の数（1件ずつのとき。分からなければ undefined） */
  count?: number;
  /** まとめて渡すとき（確かめの画面に顧客番号を出す） */
  bulk: boolean;
  /** 初めの確かめの画面（テスト用） */
  initialPreview?: AiNotesPreview[] | null;
}

export function NotesOptions(p: NotesOptionsProps) {
  const [preview, setPreview] = useState<AiNotesPreview[] | null>(p.initialPreview ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const look = p.ai.notesPreview;
  return (
    <div class="ai-notes" data-ai-notes>
      <label class="ai-check">
        <input type="checkbox" checked={p.on && p.blocked === null} disabled={p.blocked !== null} onChange={(e) => p.onToggle((e.currentTarget as HTMLInputElement).checked)} data-ai-notes-on />
        メモと面談の履歴も渡す{p.count !== undefined ? `（メモと面談の記録 ${p.count}件）` : ""}
      </label>
      <p class="pl-sub">{NOTES_OPTION_TEXT}</p>
      {p.blocked !== null ? (
        <p class="in-note" data-ai-notes-blocked>
          {p.blocked}
        </p>
      ) : null}
      {p.on && p.blocked === null ? (
        <>
          <label class="ai-notes-words">
            伏せる言葉（お客さまの名字など。「、」で区切る）
            <input value={p.words} maxLength={400} placeholder="例: 田中、山田" onInput={(e) => p.onWords((e.currentTarget as HTMLInputElement).value)} data-ai-notes-words />
          </label>
          <p class="pl-sub">{MASK_WORDS_NOTE}</p>
          {look !== undefined ? (
            <button
              type="button"
              class="btn small"
              disabled={busy || p.ids.length === 0}
              onClick={() => {
                setBusy(true);
                setError(null);
                look([...p.ids], maskWords(p.words)).then(
                  (l) => {
                    setBusy(false);
                    setPreview(l);
                  },
                  (e: unknown) => {
                    setBusy(false);
                    setError(aiMessage(codeOf(e)));
                  },
                );
              }}
              data-ai-notes-look
            >
              AIに渡る文を確かめる
            </button>
          ) : null}
          {error !== null ? <p class="hh-err">{error}</p> : null}
          {preview !== null ? <NotesPreviewList list={preview} showNo={p.bulk} /> : null}
        </>
      ) : null}
    </div>
  );
}
