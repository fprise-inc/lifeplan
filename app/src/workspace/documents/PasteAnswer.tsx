// ウェブのチャット AI の答えを貼り付ける入口（0151）。AI接続口を使えない FP が、ウェブのチャット AI に書類を読ませた答え
// （document-candidates@1 の JSON）を貼り付け、同じ読み口（readProposalText）と同じ確かめの画面で承認する。
// - 書類の中身は AI の会社に渡るので、外部AIへの提供の同意（0014）がある世帯（と見本の世帯）だけで使える。名前・番号を伏せて渡してもらう
// - 読めない答え・形の違う答えは、理由を出して取り込まない。読めた候補は、FP が「取り込んで確かめる」を押したときだけ読み取りの記録に入る
// - 貼り付けた文そのものは保存しない（読み取りの記録には、読み口を通った候補だけが入る）
import { useEffect, useRef, useState } from "preact/hooks";
import type { WorkingHousehold } from "../input/household.ts";
import { approvalTime } from "../hearing/sheet.ts";
import { readPasted, type PasteGate } from "./ai.ts";
import { docTypeLabel, LIMITS, type DocType, type DocumentReading } from "./types.ts";

/** AI に渡す読み方の手引き（書類の種類を選ぶと、説明書・その書類の手引き・入力の欄の一覧をまとめた文を写す。guides.ts） */
export interface PasteGuide {
  options: readonly { value: DocType; label: string }[];
  text: (t: DocType) => string;
}

export interface PasteAnswerProps {
  wh: WorkingHousehold;
  gate: PasteGate;
  /** AI に渡す読み方の手引き（あれば書類の種類を選んで「読み方の手引きを写す」を出す） */
  guide?: PasteGuide;
  /** 同意を記録する画面を開く（保存した世帯だけ） */
  onOpenConsent?: () => void;
  /** 読めた答えを読み取りの記録に入れ、確かめの画面を開く */
  onRead: (reading: DocumentReading) => void;
  onClose: () => void;
}

/** 伏せてから渡すもの（画面の注意と、確かめの印の文に使う） */
export const PASTE_WARNING = "書類の中身は AI の会社に渡ります。お名前などを伏せて渡してください（ご住所・個人番号〔マイナンバー〕・基礎年金番号・証券番号・口座番号・健康の告知の欄も）。";

export function PasteAnswer(p: PasteAnswerProps) {
  const [text, setText] = useState("");
  const [connector, setConnector] = useState("");
  const [masked, setMasked] = useState(false);
  const [result, setResult] = useState<{ reading: DocumentReading | null; issues: string[] } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [guideType, setGuideType] = useState<DocType | null>(p.guide?.options[0]?.value ?? null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => panel.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [p.onClose]);

  const read = () => setResult(readPasted(p.wh, text, connector, approvalTime()));
  const reading = result?.reading ?? null;
  const counts = reading === null ? null : { values: reading.candidates.length, objects: reading.objects.length, references: reading.references.length, unreadable: reading.candidates.filter((c) => c.unreadable === true).length };
  return (
    <>
      <div class="scrim" aria-hidden="true" onClick={p.onClose} />
      <div ref={panel} class="rk-panel dr-panel dp-panel" role="dialog" aria-modal="true" aria-labelledby="dp-title" tabIndex={-1} data-documents-paste>
        <h2 id="dp-title">AI の答えを貼り付ける</h2>
        <p class="hh-warn" data-documents-paste-warning>
          {PASTE_WARNING}
        </p>
        {!p.gate.ok ? (
          <>
            <p class="hh-err" role="alert" data-documents-paste-blocked>
              {p.gate.reason}
            </p>
            <div class="dr-foot">
              {p.onOpenConsent !== undefined ? (
                <button type="button" class="btn primary" onClick={p.onOpenConsent} data-documents-paste-consent>
                  同意と共有を開く
                </button>
              ) : null}
              <button type="button" class="btn" onClick={p.onClose}>
                閉じる
              </button>
            </div>
          </>
        ) : (
          <>
            {p.gate.sample ? <p class="in-note" data-documents-paste-sample>見本の世帯（架空）です。実在のお客さまの書類は、その方の世帯で外部AIへの提供の同意を記録してから読んでください。</p> : null}
            <ol class="dp-steps">
              <li>ウェブのチャット AI に、お名前・番号を伏せた書類と、読み方の手引き（答えの形 document-candidates@1）を渡します。</li>
              <li>AI の答え（JSON）を、そのまま下に貼り付けて「読む」を押します。前後の文や ```json の囲みがあっても読めます。</li>
              <li>読めた値は候補として確かめの画面に出ます。値ごとに承認したものだけが現状に入ります。</li>
            </ol>
            {p.guide !== undefined && guideType !== null ? (
              <p class="dp-guide">
                <label>
                  書類の種類
                  <select
                    value={guideType}
                    onChange={(e) => {
                      setGuideType((e.currentTarget as HTMLSelectElement).value as DocType);
                      setCopied(null);
                    }}
                    data-documents-paste-guide-type
                  >
                    {p.guide.options.map((o) => (
                      <option value={o.value} key={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  class="btn small"
                  onClick={() =>
                    void Promise.resolve(navigator.clipboard?.writeText(p.guide?.text(guideType) ?? ""))
                      .then(() => setCopied("手引きを写しました。AI のチャットに貼り、書類と一緒に渡してください"))
                      .catch(() => setCopied("写せませんでした"))
                  }
                  data-documents-paste-guide
                >
                  読み方の手引きを写す
                </button>
                {copied !== null ? <span class="in-note">{copied}</span> : null}
              </p>
            ) : null}
            <label class="dp-check">
              <input type="checkbox" checked={masked} onChange={(e) => setMasked((e.currentTarget as HTMLInputElement).checked)} data-documents-paste-masked />
              書類のお名前・番号を伏せてから AI に渡したことを確かめました
            </label>
            <label class="dp-field">
              使った AI の名前
              <input
                type="text"
                value={connector}
                maxLength={LIMITS.connector}
                placeholder="例: ウェブのチャット AI の名前"
                onInput={(e) => {
                  setConnector((e.currentTarget as HTMLInputElement).value);
                  setResult(null);
                }}
                data-documents-paste-connector
              />
            </label>
            <label class="dp-field">
              AI の答え
              <textarea
                rows={10}
                value={text}
                spellcheck={false}
                onInput={(e) => {
                  setText((e.currentTarget as HTMLTextAreaElement).value);
                  setResult(null);
                }}
                data-documents-paste-text
              />
            </label>
            {result !== null && reading === null ? (
              <div class="hh-err" role="alert" data-documents-paste-error>
                取り込みませんでした。
                <ul>
                  {result.issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {reading !== null && counts !== null ? (
              <div class="rk-ok dp-result" role="status" data-documents-paste-result>
                {docTypeLabel(reading.docType)}: 値の候補 {counts.values}件{counts.unreadable > 0 ? `（うち読めなかった欄 ${counts.unreadable}件）` : ""}
                {counts.objects > 0 ? `・新しい物 ${counts.objects}件` : ""}
                {counts.references > 0 ? `・照合だけの値 ${counts.references}件` : ""}を読みました。
                {reading.dropped > 0 ? ` 個人番号などの番号らしい所を${reading.dropped}か所消しました（候補にも記録にも残しません）。` : ""}
                {result !== null && result.issues.length > 0 ? (
                  <>
                    <br />
                    読まなかった所:
                    <ul>
                      {result.issues.map((i) => (
                        <li key={i}>{i}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            ) : null}
            <div class="dr-foot">
              {reading === null ? (
                <button type="button" class="btn primary" disabled={!masked || text.trim() === "" || connector.trim() === ""} onClick={read} data-documents-paste-read>
                  読む
                </button>
              ) : (
                <button type="button" class="btn primary" disabled={!masked} onClick={() => p.onRead(reading)} data-documents-paste-accept>
                  取り込んで確かめる
                </button>
              )}
              <span class="in-note">貼り付けた文は保存しません。取り込むのは、読めた候補だけです（承認するまで現状は変わりません）。</span>
              <button type="button" class="btn" onClick={p.onClose}>
                閉じる
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
