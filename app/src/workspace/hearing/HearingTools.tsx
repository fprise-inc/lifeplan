// 入力のホームの「ヒアリングシートを書き出す」「記入済みのシートを取り込む」（作業の層。0018）。
// - 書き出し: シートの種類（シンプル〔既定〕・詳細・見直し〔詳細に前回の値つき〕。0192 で「通常」から改めた）を選び、.xlsx を作って本体の平文の書き出しの出口
//   （OS の保存のダイアログ）で保存する。見直し（前回の値を記入する）を選ぶたびに警告する（0018 の9）
// - 取り込み: 本体の開くダイアログで選んだ .xlsx を hearing/ の部品で読み（返ってきたファイルは信用しない。0018 の6）、
//   候補（新規・変更・同じ・要確認・矛盾）をこのパネルで確かめ、承認したものだけを現状に入れる（0008 の5）
// - 0192: 入口を「聞く（Excel を書き出す・URL で聞く）」と「取り込む（記入済みの Excel・URL の答え）」の2段に分けた。顧客番号は開いている世帯の番号。
//   取り込みの画面は、頼んだ書類で分かる問いのお答えなしを「書類を待っています」と言い分け、入れる値が無くても取り込み済みにできる
import { useEffect, useMemo, useState } from "preact/hooks";
import { version as APP_VERSION } from "../../../package.json";
import type { HearingWebHost, SaveOutcome, SheetHost } from "../../engine/host.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { today } from "../report/assemble.ts";
import { docRequests, docRequestTitles } from "../input/docRequests.ts";
import { WebBuilder, type OfficeLook } from "./WebBuilder.tsx";
import { WebRequests } from "./WebRequests.tsx";
import { markImported, onArrivals, pendingCount, sentAtText, type HearingTemplate } from "./web.ts";
import { applyImport, approvalTime, CUSTOMER_NO_PATTERN, defaultSelection, defaultWorkModes, exportSheet, importSheet, randomBytes, sheetFor, SHEET_KINDS, withRequest, workChangeTexts, type CandidateView, type FieldView, type ImportView, type Issue, type SheetKind, type WorkChangeMode } from "./sheet.ts";

interface Props {
  wh: WorkingHousehold;
  sheets: SheetHost;
  onSave: (next: WorkingHousehold) => void;
  /** 開いている世帯の顧客番号（書き出し・URL の発行の初めの値。保存していない世帯は null。0192） */
  customerNo?: string | null;
}

/** Web のヒアリング（0125）に要るもの（本体に受け付けの命令が無い画面では渡さない） */
export interface WebProps {
  web: HearingWebHost;
  office: OfficeLook;
  templates: readonly HearingTemplate[];
  onTemplates: (list: HearingTemplate[]) => Promise<void>;
  persisted: boolean;
  saveNow: () => Promise<boolean>;
  /** ご相談したいことの話題の事務所の既定値と保存（0192） */
  topics?: readonly string[] | null;
  onTopics?: (list: string[] | null) => Promise<void>;
}

const KIND_TEXT: Record<CandidateView["kind"], string> = { new: "新規", changed: "変更", same: "同じ", noAnswer: "お答えなし" };

/** 事務所の表示（シートの1枚目。設定の保存は後の回なので、アプリを開いている間だけ覚える。顧客番号は世帯ごと） */
const office = { name: "", purpose: "ライフプランの作成と、家計・保険・資産運用のご相談のため", privacyContact: "" };

function Mark({ f }: { f: FieldView }) {
  // 入力の画面と同じ印: 推定（目安で補った・シートの「わからない」を推定にした）・推定（範囲の真ん中）・書類待ち（書類で確かめる欄の「わからない」。
  // 代わりの値で計算する。0041 の追記 2026-10-31）・仮（値の箱の無い欄の仮の値）
  // 範囲の根拠の長い文は、欄の下の段に出す（FieldRow）
  if (f.mark === "range")
    return (
      <span class="badge est" title={f.note ?? "金額の範囲の真ん中"} data-hearing-mark="range">
        推定（範囲の真ん中）
      </span>
    );
  if (f.mark === "unknown")
    return (
      <span class="badge est" title={f.note ?? "書類で確かめるまで代わりの値で計算します"} data-hearing-mark="unknown">
        書類待ち
      </span>
    );
  if (f.mark === "estimated")
    return (
      <span class="badge est" title={f.note ?? "推定"}>
        推定
      </span>
    );
  if (f.mark === "assumed")
    return (
      <span class="badge est" title={f.note ?? "仮の値"}>
        仮
      </span>
    );
  return null;
}

/** 候補の1つの項目: お客さまの答え（印つき）と、変更のときの「今 → 届いた値」。長い根拠は下の段に（項目の名前が縦に崩れないように） */
function FieldRow({ f }: { f: FieldView }) {
  return (
    <div class="hs-field" data-hearing-field={f.noAnswer ? "noAnswer" : "answered"}>
      <dt>{f.label}</dt>
      <dd>
        {f.answer} <Mark f={f} />
      </dd>
      {(f.mark === "range" && f.note !== null) || f.diffs.length > 0 ? (
        <dd class="hs-more">
          {f.mark === "range" && f.note !== null ? <small class="hs-basis">{f.note}</small> : null}
          {f.diffs.length > 0 ? (
            <ul class="hs-diffs">
              {f.diffs.map((d, i) => (
                <li key={i} class={d.kept ? "kept" : d.rough ? "rough" : ""} data-hearing-diff={d.kept ? "kept" : d.rough ? "rough" : "changed"}>
                  <span class="hs-diff-l">{d.label}</span> 今 <b>{d.current}</b>
                  {d.kept ? d.waiting !== null ? <> （{d.waiting}。今の値のまま）</> : <> （お答えが無いので今の値のまま）</> : <> → 届いた値 <b>{d.next}</b></>}
                </li>
              ))}
            </ul>
          ) : null}
        </dd>
      ) : null}
    </div>
  );
}

/** 働き方の種類が変わった候補の、承認の入れ方（今の期間を置きかえる・今の期間を終えて足す） */
function WorkChoice({ c, mode, onMode }: { c: CandidateView; mode: WorkChangeMode; onMode: (m: WorkChangeMode) => void }) {
  if (c.work === null) return null;
  const t = workChangeTexts(c.work);
  return (
    <div class="hs-work" data-hearing-work={mode}>
      <p class="hs-keep">{t.head}</p>
      {t.split !== null ? (
        <div class="hs-work-modes" role="radiogroup" aria-label="承認したときの入れ方">
          <label>
            <input type="radio" name={`work-${c.id}`} checked={mode === "split"} onChange={() => onMode("split")} data-hearing-work-mode="split" /> {t.split}
          </label>
          <label>
            <input type="radio" name={`work-${c.id}`} checked={mode === "replace"} onChange={() => onMode("replace")} data-hearing-work-mode="replace" /> {t.replace}
          </label>
        </div>
      ) : null}
      {t.notes.map((n, i) => (
        <p class="rp-note" key={i}>
          {n}
        </p>
      ))}
    </div>
  );
}

function IssueList({ issues }: { issues: readonly Issue[] }) {
  const shown = issues.filter((i) => i.level !== "info");
  if (shown.length === 0) return null;
  return (
    <ul class="hs-issues">
      {shown.map((i, n) => (
        <li key={n} class={i.level}>
          {i.message}
        </li>
      ))}
    </ul>
  );
}

function ExportPanel({ wh, sheets, onSave, onClose, customerNo = null }: Props & { onClose: () => void }) {
  const [kind, setKind] = useState<SheetKind>("simple");
  const prefill = kind === "review";
  const [form, setForm] = useState({ ...office, customerNo: customerNo ?? "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SaveOutcome | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const okNo = CUSTOMER_NO_PATTERN.test(form.customerNo);
  // 書類のお願い（書類待ちの欄から作る。0102）: 1枚目の後ろに「今回お願いしたい書類」として載せる（既定で載せる。外せる）
  const docs = useMemo(() => docRequestTitles(docRequests(wh)), [wh]);
  const [withDocs, setWithDocs] = useState(true);
  const set = (k: keyof typeof form) => (e: Event) => setForm({ ...form, [k]: (e.currentTarget as HTMLInputElement).value });
  const go = async () => {
    setBusy(true);
    setErr(null);
    Object.assign(office, { name: form.name, purpose: form.purpose, privacyContact: form.privacyContact });
    try {
      const on = today();
      const r = await exportSheet(wh, { definition: sheetFor(kind), prefill, customerNo: form.customerNo, office: { name: form.name, purpose: form.purpose, privacyContact: form.privacyContact }, appVersion: APP_VERSION, exportedOn: on, random: randomBytes(), ...(withDocs && docs.length > 0 ? { requestedDocuments: docs } : {}) });
      const out = await sheets.save(r.bytes, { customerNo: form.customerNo, exportedOn: on, prefilled: prefill });
      setDone(out);
      // 依頼の記録は保存したときだけ残す（取り込むときに、これを正にして読む）
      if (out.saved) onSave(withRequest(wh, r.request));
    } catch (e) {
      setErr(typeof e === "string" ? e : e instanceof Error ? e.message : "E_HEARING_EXPORT");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section class="card hs-panel" aria-label="ヒアリングシートを書き出す" data-hearing-export-panel>
      <div class="card-h">
        <h2>ヒアリングシートを書き出す</h2>
        <span class="aside">表計算のファイル（.xlsx）。お名前の欄はありません</span>
      </div>
      <div class="hs-form">
        <label>
          <span>顧客番号（英数字）</span>
          <input type="text" value={form.customerNo} maxLength={16} onInput={set("customerNo")} aria-invalid={!okNo} data-hearing-customer />
        </label>
        <label>
          <span>事務所名</span>
          <input type="text" value={form.name} maxLength={60} onInput={set("name")} placeholder="シートの1枚目に出ます" />
        </label>
        <label>
          <span>利用目的</span>
          <input type="text" value={form.purpose} maxLength={120} onInput={set("purpose")} />
        </label>
        <label>
          <span>個人情報の窓口</span>
          <input type="text" value={form.privacyContact} maxLength={120} onInput={set("privacyContact")} placeholder="連絡先（任意）" />
        </label>
        <fieldset class="hs-kinds" data-hearing-kinds>
          <legend>シートの種類</legend>
          {SHEET_KINDS.map((k) => (
            <label class="hs-check" key={k.value}>
              <input type="radio" name="hearing-kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} data-hearing-kind={k.value} {...(k.value === "review" ? { "data-hearing-prefill": true } : {})} />
              <span>
                {k.label}
                <small> — {k.note}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {docs.length > 0 ? (
          <label class="hs-check" data-hearing-docs>
            <input type="checkbox" checked={withDocs} onChange={(e) => setWithDocs((e.currentTarget as HTMLInputElement).checked)} data-hearing-docs-check />
            <span>
              書類のお願いを載せる（{docs.length}通）
              <small> — 1枚目の最後に「今回お願いしたい書類」として、{docs.join("、")}</small>
            </span>
          </label>
        ) : null}
        {prefill ? (
          <p class="hs-warn" role="alert">
            暗号化されない表計算のファイルに、家族の生年月や金額などの今の値が載ります。送り方と保管に気をつけてください（書き出したことを記録します）。
          </p>
        ) : null}
      </div>
      {!okNo ? <p class="fatal">顧客番号は英数字・ハイフン・下線（16字まで）で入れてください。氏名は入れません。</p> : null}
      {err !== null ? <p class="fatal">書き出せませんでした（{err}）</p> : null}
      {done !== null ? (
        <p class={`rp-note${done.syncFolder ? " warn" : ""}`} role="status" data-hearing-saved={done.saved ? "1" : "0"}>
          {done.saved ? `「${done.fileName ?? ""}」を保存しました。${done.syncFolder ? "同期フォルダの中です。" : ""}顧客に送ってください。` : "保存しませんでした。"}
        </p>
      ) : null}
      <div class="rp-actions">
        <button type="button" class="btn primary" disabled={busy || !okNo} onClick={() => void go()} data-hearing-export-go>
          {busy ? "作っています…" : "書き出す"}
        </button>
        <button type="button" class="btn" onClick={onClose}>
          閉じる
        </button>
      </div>
    </section>
  );
}

function ReviewPanel({ wh, view, onSave, onClose, heading, sentAt }: { wh: WorkingHousehold; view: ImportView; onSave: (w: WorkingHousehold) => void; onClose: (msg: string | null) => void; heading?: string; sentAt?: string }) {
  const [sel, setSel] = useState<Set<string>>(() => defaultSelection(view));
  /** 働き方の種類が変わった候補の入れ方（置きかえる・終えて足す。0139 の追記 2026-11-07） */
  const [modes, setModes] = useState<Map<string, WorkChangeMode>>(() => defaultWorkModes(view));
  const count = (k: CandidateView["kind"]) => view.candidates.filter((c) => c.kind === k).length;
  const toggle = (id: string, on: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const approve = () => {
    const r = applyImport(wh, view, sel, approvalTime(), modes);
    onSave(r.wh);
    onClose(r.added + r.replaced === 0 && sel.size === 0 ? "取り込み済みにしました（入れた値はありません）" : `${r.added + r.replaced}件を現状に入れました（新規 ${r.added}件・変更 ${r.replaced}件）${r.skipped.length > 0 ? `。入れなかったもの: ${r.skipped.join("、")}` : ""}`);
  };
  const shown = view.candidates.filter((c) => c.kind !== "noAnswer");
  // お答えなしの物のうち、頼んだ書類で分かる問いだけのものは「書類を待っています」と言い分ける（0192）
  const waiting = view.candidates.filter((c) => c.kind === "noAnswer" && c.waiting !== null);
  const kept = view.candidates.filter((c) => c.kind === "noAnswer" && c.waiting === null);
  /** 頼んだ書類で分かる問いの欄（お答えが無く、書類を待っている欄）の数 */
  const waitingFields = view.candidates.flatMap((c) => c.fields.flatMap((f) => f.diffs.filter((d) => d.kept && d.waiting !== null))).length;
  const groups = [...new Set(shown.map((c) => c.group))];
  return (
    <section class="card hs-panel hs-review" aria-label="取り込みの確認" data-hearing-review>
      <div class="card-h">
        <h2>{heading ?? "記入済みのシートの取り込み"}（{view.definition.title} 版{view.definition.version}）</h2>
        <span class="aside">
          新規 {count("new")}・変更 {count("changed")}・同じ {count("same")}
          {kept.length > 0 ? `・お答えなし ${kept.length}` : ""}
          {waitingFields > 0 ? `・書類待ちの欄 ${waitingFields}` : ""}
          {shown.some((c) => c.review) ? `・要確認 ${shown.filter((c) => c.review).length}` : ""}
          {shown.some((c) => c.contradictions.length > 0) ? `・矛盾 ${shown.filter((c) => c.contradictions.length > 0).length}` : ""}
          {view.gates.length > 0 ? `・分岐の答えの違い ${view.gates.length}` : ""}
        </span>
      </div>
      {sentAt !== undefined ? (
        <p class="rp-note" data-hearing-sent-at>
          お客さまが送った日時: {sentAtText(sentAt)}（心当たりのない日時なら、別の方が送ったおそれがあります。承認する前にお客さまに確かめてください）
        </p>
      ) : null}
      <p class="rp-note">チェックした候補だけを現状に入れます。入れるまでは計算に使いません。「推定」「仮」の印は入力の画面と同じです（推定で補った値・仮の値）。変更の候補は「今 → 届いた値」を並べます。お答えの無い欄（空欄・「あとで」）は、承認しても今の値のままです。</p>
      {view.gates.length > 0 ? (
        <div class="hs-gates" role="note" data-hearing-gates>
          <h3>要確認: 分岐の答えが今の世帯と違います（{view.gates.length}）</h3>
          <ul class="hs-list">
            {view.gates.map((g) => (
              <li key={g.gate} data-hearing-gate={g.gate}>
                {g.text}
              </li>
            ))}
          </ul>
          <p class="rp-note">取り込みでは、今の世帯の人や行を消しません（承認しても今のまま）。お答えのとおりなら、承認の後に入力の画面で直してください。</p>
        </div>
      ) : null}
      <IssueList issues={view.issues} />
      {groups.map((g) => (
        <div class="hs-group" key={g}>
          <h3>{g}</h3>
          {view.candidates
            .filter((c) => c.group === g && c.kind !== "noAnswer")
            .map((c) => (
              <div class={`hs-cand k-${c.kind}${c.review || c.contradictions.length > 0 ? " attn" : ""}`} key={c.id} data-candidate={c.kind}>
                <label class="hs-cand-h">
                  <input type="checkbox" checked={sel.has(c.id)} onChange={(e) => toggle(c.id, (e.currentTarget as HTMLInputElement).checked)} />
                  <span class={`hs-kind ${c.kind}`}>{KIND_TEXT[c.kind]}</span>
                  <b>{c.title}</b>
                  {c.kind === "changed" && c.changedFields > 0 ? <small>（今の値と違う欄 {c.changedFields}）</small> : null}
                  {c.review ? <span class="hs-kind review">要確認</span> : null}
                  {c.contradictions.length > 0 ? <span class="hs-kind bad">矛盾</span> : null}
                </label>
                {c.contradictions.map((m, i) => (
                  <p class="hs-bad" key={i}>
                    {m}
                  </p>
                ))}
                {c.keep !== null ? (
                  <p class="hs-keep" data-hearing-keep>
                    {c.keep}
                  </p>
                ) : null}
                {c.caution !== null && !(c.work !== null && (modes.get(c.id) ?? c.work.mode) === "split") ? (
                  <p class="hs-keep" data-hearing-caution>
                    {c.caution}
                  </p>
                ) : null}
                {c.work !== null ? <WorkChoice c={c} mode={modes.get(c.id) ?? c.work.mode} onMode={(m) => setModes((s) => new Map(s).set(c.id, m))} /> : null}
                <dl class="hs-fields">
                  {c.fields.map((f, i) => (
                    // 「終えて足す」は今の期間を置きかえないので、「今 → 届いた値」は出さない（届いた働き方の期間を新しく足す）
                    <FieldRow key={i} f={c.work !== null && (modes.get(c.id) ?? c.work.mode) === "split" ? { ...f, diffs: [] } : f} />
                  ))}
                </dl>
                {c.note !== null ? <p class="rp-note">{c.note}</p> : null}
              </div>
            ))}
        </div>
      ))}
      {waiting.length > 0 ? (
        <div class="hs-group" data-hearing-waiting>
          <h3>書類を待っています（今の値のまま。{waiting.length}）</h3>
          <p class="rp-note">頼んだ書類の数字を使う問いなので、お客さまの画面には出していません。書類が届いたら、書類を見て入力の画面で入れてください。</p>
          <ul class="hs-list">
            {waiting.map((c) => (
              <li key={c.id} data-hearing-waiting-item>
                {c.title}: {c.waiting}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {kept.length > 0 ? (
        <div class="hs-group" data-hearing-kept>
          <h3>お答えがありません（今の値のまま。{kept.length}）</h3>
          <p class="rp-note">お客さまが空欄・「あとで」にした項目や、このシートで聞いていない項目です。今の世帯の値を残し、候補にしません。</p>
          <ul class="hs-list">
            {kept.map((c) => (
              <li key={c.id} data-hearing-kept-item>
                {c.title}: {[...new Set(c.fields.flatMap((f) => f.diffs.filter((d) => d.kept).map((d) => `${d.label}（今 ${d.current}${d.waiting !== null ? `。${d.waiting}` : ""}）`)))].join("、")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {view.checklist.length > 0 ? (
        <div class="hs-group">
          <h3>面談で確かめること（{view.checklist.length}）</h3>
          <ul class="hs-list">
            {view.checklist.map((c, i) => (
              <li key={i}>
                {c.label}: {c.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {view.memo.length > 0 ? (
        <div class="hs-group">
          <h3>FP用のメモに入れる文（{view.memo.length}）</h3>
          <ul class="hs-list">
            {view.memo.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {view.consents.length > 0 ? (
        <p class="rp-note">同意の欄: {view.consents.map((c) => `${c.kind === "purpose" ? "利用目的" : c.kind === "familyInfo" ? "家族の情報" : "外部AIへの提供"}は${c.decision === "given" ? "同意あり" : "同意なし"}`).join("・")}（承認すると同意の記録の下書きに入ります）</p>
      ) : null}
      {shown.length === 0 ? (
        <p class="rp-note" data-hearing-nothing>
          入れる値はありません（どれもお答えが無いか、今の値と同じです）。「取り込み済みにする」で、メモ・同意の記録と、取り込んだことだけを残します。
        </p>
      ) : null}
      <div class="rp-actions">
        {/* 全部お答えなし・同じのときも、取り込み済みにできる（0件の承認。0192） */}
        <button type="button" class="btn primary" disabled={sel.size === 0 && shown.length > 0} onClick={approve} data-hearing-approve>
          {sel.size === 0 ? "取り込み済みにする（入れる値はありません）" : `承認して現状に入れる（${sel.size}件）`}
        </button>
        <button type="button" class="btn" onClick={() => onClose(null)}>
          キャンセル
        </button>
      </div>
    </section>
  );
}

/** 入力のホームの上部（進み具合の近く）に置くボタンと、開いたパネル */
export function HearingTools({ wh, sheets, onSave, webProps, customerNo = null }: Props & { webProps?: WebProps }) {
  // 届いた知らせ（アプリを開いている間に確かめた結果。0192）が変わったら描き直す
  const [, setTick] = useState(0);
  useEffect(() => onArrivals(() => setTick((n) => n + 1)), []);
  const pend = pendingCount(wh);
  const [mode, setMode] = useState<null | "export" | "busy" | "web">(null);
  const [view, setView] = useState<ImportView | null>(null);
  /** Web の依頼から取り込んでいるとき、その依頼番号と、お客さまが送った日時（承認したら取り込み済みの印を付ける） */
  const [webImport, setWebImport] = useState<{ id: string; sentAt: string | null } | null>(null);
  const [issues, setIssues] = useState<readonly Issue[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const pick = async () => {
    setMsg(null);
    setIssues(null);
    setMode("busy");
    try {
      const bytes = await sheets.open();
      if (bytes === null) return;
      const r = await importSheet(bytes, wh);
      if (r.ok) {
        // Web の取り込みの画面を開いたまま Excel を読んだとき、Web の依頼の見出し・送った日時・取り込み済みの印を持ち越さない
        setWebImport(null);
        setView(r.view);
      } else setIssues(r.issues);
    } catch (e) {
      setIssues([{ level: "error", code: "H_FILE_BROKEN", message: e === "E_IMPORT_TOO_LARGE" ? "ファイルが大きすぎるため読みませんでした" : `読み込めませんでした（${typeof e === "string" ? e : "E_IMPORT"}）` }]);
    } finally {
      setMode(null);
    }
  };
  return (
    <>
      <div class="hs-tools" role="group" aria-label="ヒアリングで聞く" data-hearing-ask>
        <span class="hs-tools-h">ヒアリングで聞く</span>
        <button type="button" class="btn" onClick={() => setMode(mode === "export" ? null : "export")} aria-expanded={mode === "export"} data-hearing-export>
          Excel を書き出す
        </button>
        {webProps !== undefined ? (
          <button type="button" class="btn" onClick={() => setMode(mode === "web" ? null : "web")} aria-expanded={mode === "web"} data-hearing-web>
            URL で聞く
          </button>
        ) : null}
      </div>
      <div class="hs-tools" role="group" aria-label="ヒアリングを取り込む" data-hearing-take>
        <span class="hs-tools-h">ヒアリングを取り込む</span>
        <button type="button" class="btn" disabled={mode === "busy"} onClick={() => void pick()} data-hearing-import>
          {mode === "busy" ? "読んでいます…" : "記入済みの Excel を取り込む"}
        </button>
        {webProps !== undefined ? (
          <span class="rp-note" data-hearing-web-pending>
            URL の答えは、下の「URL の依頼」から受け取って取り込みます
            {pend.arrived > 0 ? <b class="hs-kind answered">（届いています {pend.arrived}件）</b> : pend.toImport > 0 ? <b class="hs-kind review">（取り込み待ち {pend.toImport}件）</b> : null}
          </span>
        ) : null}
      </div>
      {msg !== null ? (
        <p class="hs-msg" role="status" data-hearing-msg>
          {msg}
        </p>
      ) : null}
      {mode === "export" ? <ExportPanel wh={wh} sheets={sheets} onSave={onSave} customerNo={customerNo} onClose={() => setMode(null)} /> : null}
      {mode === "web" && webProps !== undefined ? (
        <WebBuilder
          wh={wh}
          web={webProps.web}
          office={webProps.office}
          templates={webProps.templates}
          onTemplates={webProps.onTemplates}
          {...(webProps.topics !== undefined ? { topics: webProps.topics } : {})}
          {...(webProps.onTopics !== undefined ? { onTopics: webProps.onTopics } : {})}
          customerNo={customerNo}
          persisted={webProps.persisted}
          onSave={onSave}
          saveNow={webProps.saveNow}
          onClose={() => setMode(null)}
        />
      ) : null}
      {webProps !== undefined && view === null ? (
        <WebRequests
          wh={wh}
          web={webProps.web}
          officeName={webProps.office.name}
          appVersion={APP_VERSION}
          onSave={onSave}
          saveNow={webProps.saveNow}
          onImport={(v, id, sentAt) => {
            setMsg(null);
            setWebImport({ id, sentAt });
            setView(v);
          }}
        />
      ) : null}
      {issues !== null ? (
        <section class="card hs-panel" aria-label="取り込めませんでした" data-hearing-failed>
          <div class="card-h">
            <h2>取り込めませんでした</h2>
          </div>
          <IssueList issues={issues} />
          <div class="rp-actions">
            <button type="button" class="btn" onClick={() => setIssues(null)}>
              閉じる
            </button>
          </div>
        </section>
      ) : null}
      {view !== null ? (
        <ReviewPanel
          wh={wh}
          view={view}
          onSave={(w) => onSave(webImport !== null ? markImported(w, webImport.id, approvalTime()) : w)}
          {...(webImport !== null ? { heading: `Web のお答えの取り込み（${webImport.id}）` } : {})}
          {...(webImport?.sentAt != null ? { sentAt: webImport.sentAt } : {})}
          onClose={(m) => {
            setView(null);
            setWebImport(null);
            setMsg(m);
          }}
        />
      ) : null}
    </>
  );
}
