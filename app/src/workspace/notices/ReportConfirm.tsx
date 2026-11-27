// 送る報告の確認画面（0259）: AI がまとめた要望・不具合の報告（接続口の propose_issue_report。FP が話した内容を1件ずつに分けた物）か、
// FP が書く報告を、送る前に FP が件ごとに確かめて直す・外す。
// - 件ごとに種類（不具合・要望・質問）・どの画面か・内容を出して直せる。アプリの版・OS・受付番号はそのまま出す。「お客さまの名前・金額など
//   世帯の情報が入っていないことを確かめてください」と出し、件ごとに名前・金額らしい所に印を付けて知らせる（消すかどうかは FP が決める。止めない）
// - 「送る」1回で、全件を1つの文にまとめて写し、既定のブラウザでフォームを1回だけ開く（送り方は reportSend.ts の sendReport の1か所。
//   文は URL に入れない）
// - AI が書いた文は信用しない文章として文字のまま出す
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { CloseX, useEscClose } from "../../presentation/CloseX.tsx";
import { dateTimeText } from "../ai/model.ts";
import { canSend, formKindGuide, KIND_LABEL, markedParts, MARK_LABEL, REPORT_KINDS, REPORT_SCREENS, reportMarks, type ReportDraft, type ReportItem, type ReportKind, type ReportScreen, type ReportSendResult } from "./reportSend.ts";

/** 上の帯（届いている報告の数と、確認画面を開くボタン。中身は出さない） */
export function AiIssueReportBand({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count <= 0) return null;
  return (
    <div class="ai-code-band" role="status" data-ai-issue-report-band>
      <b>AIから、送る報告が届いています（{count}回分）</b>
      <span class="pl-sub">確認して「送る」を押すまで、どこにも送りません</span>
      <button type="button" class="link-btn" onClick={onOpen} data-ai-issue-report-band-open>
        送る報告の確認画面を開く
      </button>
    </div>
  );
}

export interface ReportConfirmProps {
  /** ai: AI がまとめた報告（フォームに via=ai を付ける）・fp: FP が書く報告 */
  source: "ai" | "fp";
  code: string;
  appVersion: string;
  os: string;
  /** 最初の件（FP が書くときは空の1件） */
  initialItems: readonly ReportItem[];
  /** AI のアプリの名乗り（AI の報告だけ） */
  connector?: string | null | undefined;
  receivedAt?: string | undefined;
  /** 送る（全件を1つの文にまとめて写し、フォームを開く。結果を返す） */
  onSend: (d: ReportDraft) => Promise<ReportSendResult>;
  /** AI の報告を捨てる（送らない） */
  onDiscard?: (() => Promise<void>) | undefined;
  onClose: () => void;
}

/** 件の数の上限（接続口と同じ） */
const MAX_ITEMS = 20;

export function ReportConfirm(p: ReportConfirmProps) {
  const [items, setItems] = useState<ReportItem[]>(() => [...p.initialItems]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ReportSendResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  useEscClose(p.onClose);
  const ok = canSend(items);
  const empties = items.filter((i) => i.text.trim() === "").length;
  const totalMarks = useMemo(() => items.reduce((n, i) => n + reportMarks(i.text).length, 0), [items]);
  const put = (at: number, patch: Partial<ReportItem>) => setItems((l) => l.map((x, i) => (i === at ? { ...x, ...patch } : x)));
  const send = async () => {
    if (!ok) return;
    setBusy(true);
    setProblem(null);
    try {
      setDone(await p.onSend({ code: p.code, items, appVersion: p.appVersion, os: p.os, viaAi: p.source === "ai" }));
    } catch {
      setProblem("送れませんでした。もう一度押してください");
    } finally {
      setBusy(false);
    }
  };
  const discard = async () => {
    if (p.onDiscard === undefined) return;
    setBusy(true);
    try {
      await p.onDiscard();
      p.onClose();
    } catch {
      setProblem("捨てられませんでした");
      setBusy(false);
    }
  };
  const who = [p.connector ?? "", p.receivedAt !== undefined ? dateTimeText(p.receivedAt) : ""].filter((x) => x !== "").join("・");
  return (
    <>
      <div class="scrim" aria-hidden="true" onClick={p.onClose} />
      <div ref={panel} class="rk-panel fb-panel rc-panel" role="dialog" aria-modal="true" aria-labelledby="rc-title" tabIndex={-1} data-report-confirm={p.source}>
        <CloseX onClose={p.onClose} what="送る報告の確認画面" />
        <h2 id="rc-title">送る報告の確認</h2>
        {p.source === "ai" ? (
          <p class="pl-sub" data-report-ai>
            AI がまとめた報告です{who !== "" ? `（${who}）` : ""}。お話しの内容を {p.initialItems.length}件に分けてあります。件ごとに確認して、直すか外してから送ってください。
          </p>
        ) : (
          <p class="pl-sub">要望や不具合を書いて送ってください。何をしたら、どうなったか。どうなってほしかったか。いくつかあるときは「＋ 件を足す」で分けて書けます。</p>
        )}
        <p class="rc-warn" role="note" data-report-warn>
          お客さまの名前・金額など世帯の情報が入っていないことを確認してください。数字は見本の世帯の値か、丸めた言葉にしてください。
        </p>
        <dl class="rc-meta">
          <dt>受付番号</dt>
          <dd data-report-code>{p.code}</dd>
          <dt>アプリの版</dt>
          <dd>{p.appVersion}</dd>
          <dt>OS</dt>
          <dd>{p.os}</dd>
          <dt>件数</dt>
          <dd data-report-count={items.length}>{items.length}件</dd>
        </dl>
        <ol class="rc-items">
          {items.map((it, i) => (
            <ReportItemEditor key={i} n={i + 1} item={it} onChange={(patch) => put(i, patch)} onRemove={() => setItems((l) => l.filter((_, j) => j !== i))} />
          ))}
        </ol>
        {items.length === 0 ? (
          <p class="pl-sub" data-report-no-items>
            件がありません。送らないときは{p.onDiscard !== undefined ? "「送らずに捨てる」" : "「やめる」"}を押してください。
          </p>
        ) : null}
        {done === null && items.length < MAX_ITEMS ? (
          <button type="button" class="link-btn rc-add" onClick={() => setItems((l) => [...l, { kind: "request", screen: "その他・分からない", text: "" }])} data-report-add>
            ＋ 件を足す
          </button>
        ) : null}
        <p class="fb-note">
          「送る」を押すと、全件を1つの文（頭に受付番号・アプリの版・OS、件ごとに番号・種類・どの画面か）にまとめてクリップボードに写し、既定のブラウザでフォームを1回だけ開きます。文はフォームの URL には入れません（URL は履歴に残るため）。フォームの「内容」の欄に貼り付けて（Ctrl+V / ⌘V）送ってください。{items.length > 0 ? formKindGuide(items) : ""}{items.length > 1 ? "「どの画面のことですか」は、いちばん近いものを1つ選べば足ります（件ごとの種類と画面は文に書いてあります）。" : ""}このアプリ自身は何も送りません。
        </p>
        {done === null ? (
          <div class="fb-actions">
            <button type="button" class="btn primary" disabled={!ok || busy} onClick={() => void send()} data-report-send>
              送る{items.length > 1 ? `（${items.length}件）` : ""}
            </button>
            {items.length > 0 && empties > 0 ? <span class="pl-sub">内容が空の件があります（書くか外してください）</span> : null}
            {totalMarks > 0 ? <span class="pl-sub" data-report-marks-total={totalMarks}>気になる所が全部で{totalMarks}か所あります</span> : null}
            {p.onDiscard !== undefined ? (
              <button type="button" class="link-btn" disabled={busy} onClick={() => void discard()} data-report-discard>
                送らずに捨てる
              </button>
            ) : null}
            <button type="button" class="link-btn" onClick={p.onClose} data-report-later>
              {p.source === "ai" ? "あとで" : "やめる"}
            </button>
          </div>
        ) : (
          <SentMessage done={done} onClose={p.onClose} />
        )}
        {problem !== null ? (
          <p class="fb-msg err" role="status">
            {problem}
          </p>
        ) : null}
      </div>
    </>
  );
}

/** 1件: 種類・どの画面か・内容と、名前・金額らしい所の印。「外す」でこの件だけ送らない */
function ReportItemEditor({ n, item, onChange, onRemove }: { n: number; item: ReportItem; onChange: (patch: Partial<ReportItem>) => void; onRemove: () => void }) {
  const marks = useMemo(() => reportMarks(item.text), [item.text]);
  return (
    <li class="rc-item" data-report-item={n}>
      <div class="rc-item-head">
        <b class="rc-item-no">{n}件目</b>
        <label class="rc-field">
          <span class="rc-lbl">種類</span>
          <select value={item.kind} onChange={(e) => onChange({ kind: (e.target as HTMLSelectElement).value as ReportKind })} data-report-kind>
            {REPORT_KINDS.map((k) => (
              <option key={k} value={k} selected={k === item.kind}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label class="rc-field">
          <span class="rc-lbl">どの画面のことか</span>
          <select value={item.screen} onChange={(e) => onChange({ screen: (e.target as HTMLSelectElement).value as ReportScreen })} data-report-screen>
            {REPORT_SCREENS.map((s) => (
              <option key={s} value={s} selected={s === item.screen}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button type="button" class="link-btn rc-remove" onClick={onRemove} aria-label={`${n}件目を外す`} data-report-remove>
          外す
        </button>
      </div>
      <textarea class="rc-text" rows={item.text.split("\n").length > 6 ? 10 : 4} value={item.text} aria-label={`${n}件目の内容`} placeholder="何をしたら、どうなったか。どうなってほしかったか" onInput={(e) => onChange({ text: (e.target as HTMLTextAreaElement).value })} data-report-text />
      {marks.length === 0 ? (
        item.text.trim() !== "" ? (
          <p class="rc-marks-none" data-report-marks-none>
            名前・金額・電話番号・メールアドレス・住所・生年月日らしい所は見つかりませんでした（名前は形で見分けられないので、目でも確認してください）。
          </p>
        ) : null
      ) : (
        <div class="rc-marks" data-report-marks={marks.length}>
          <p class="rc-marks-title">
            <b>気になる所が{marks.length}か所あります。</b>世帯の情報なら、上の内容で消すか、見本の値・丸めた言葉に直してください。世帯の情報でなければ、そのまま送れます。
          </p>
          <p class="rc-preview ai-untrusted">
            {markedParts(item.text, marks).map((part, i) =>
              part.mark === null ? (
                part.text
              ) : (
                <mark key={i} class={`rc-mark rc-mark-${part.mark.kind}`} title={MARK_LABEL[part.mark.kind]} data-report-mark={part.mark.kind}>
                  {part.text}
                </mark>
              ),
            )}
          </p>
          <ul class="rc-mark-list">
            {marks.map((m, i) => (
              <li key={i}>
                「<span class="ai-untrusted">{m.text}</span>」 — {MARK_LABEL[m.kind]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

/** 送った後の知らせ（写せなかったときは文を出して選んでもらう） */
function SentMessage({ done, onClose }: { done: ReportSendResult; onClose: () => void }) {
  return (
    <div data-report-sent>
      {done.opened ? (
        done.copied ? (
          <p class="fb-msg" role="status">
            報告の文を写して、ブラウザでフォームを開きました。フォームの「内容」の欄に貼り付けて（Ctrl+V / ⌘V）送ってください。{done.kindGuide}
          </p>
        ) : (
          <p class="fb-msg err" role="status">
            ブラウザでフォームを開きましたが、文を写せませんでした。下の文を選んで写し、フォームの「内容」の欄に貼り付けてください。{done.kindGuide}
          </p>
        )
      ) : (
        <p class="fb-msg err" role="status">
          フォームを開けませんでした。{done.copied ? "報告の文は写してあります。" : "下の文を選んで写してください。"}「要望・不具合を送る」の「フォームを開く」からもう一度開いてください（受付番号はこの PC に覚えています）。
        </p>
      )}
      {!done.copied ? <textarea class="fb-err-text" readOnly rows={6} value={done.text} aria-label="写す文" data-report-copy-text /> : null}
      <div class="rk-actions">
        <button type="button" class="btn" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}
