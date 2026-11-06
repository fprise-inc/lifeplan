// お客さまの画面（0125・0130）: 1画面に小さなまとまりの問い・進み具合・戻る／次へ・「わからない」「あとで」・確かめの画面・送った後の画面。
// お客さまのページ（main.tsx。live）と、FP のアプリの見本（preview。通信しない・端末に何も残さない）で同じ部品を使う。
// - 手軽さが主軸: 金額は「だいたいの範囲」を押すだけで答えられ、きっちりした額は「くわしい額を入れる」で開く。空のまま「次へ」は「あとで」と同じ
// - スマホを先に考える（文字は大きめ・押す所は大きく・1列）。外のフォント・画像は読まない（CSP）
// - 問いの流れは hearing/src/web/flow.ts（答えに合わせて問いを飛ばす・人数で繰り返す・1画面にまとめる）
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { MONTH_LABELS, yearLabel } from "../../../hearing/src/definition.ts";
import { DOCUMENT_LIMITS, PHOTO_TIPS } from "../../../hearing/src/web/documents.ts";
import { answerText, draftKey, estimate, fieldAnswered, fieldKeys, gateAnswerText, gateText, indexLabel, initialDraft, MONTH_UNKNOWN, normNumber, progress, screenId, screens, START_SECTION, START_TITLE, yearChoices, type Draft, type DraftAnswer, type DraftDocument, type DraftFile, type GateId, type Screen, type ScreenField } from "../../../hearing/src/web/flow.ts";
import type { QuestionsPacket, WebItem } from "../../../hearing/src/web/packet.ts";
import { prepareFile } from "./photo.ts";

export interface FormProps {
  packet: QuestionsPacket;
  mode: "live" | "preview";
  initial: Draft;
  /** 下書きが変わった（live は端末の中に暗号化して残す） */
  onDraft?: (d: Draft) => void;
  /** この端末の入力を消す（live は端末の中の下書きを消す。付けた書類は、この部品が先に外す） */
  onClear?: () => void;
  /** 書類のファイルを暗号化して置く（live だけ） */
  upload?: (bytes: Uint8Array<ArrayBuffer>) => Promise<{ fileId: string; sha256: string }>;
  removeFile?: (fileId: string) => Promise<void>;
  /** 送る（live）。失敗は符号の文字で投げる */
  submit?: (d: Draft) => Promise<void>;
  /** 見本で最初に開く画面（FP のアプリの見本の「この問いを見る」。見本だけ "sent" で送った後の画面） */
  startAt?: string;
  /** 今の日時（年の選択肢・送った日時。試しで固定する） */
  now?: () => Date;
}

const ERRORS: Record<string, string> = {
  E_RELAY_SUBMITTED: "このご質問には、もうお答えいただいています。",
  E_RELAY_EXPIRED: "回答の期限が過ぎています。担当の FP にご連絡ください。",
  E_RELAY_GONE: "このリンクはもう使えません。担当の FP にご連絡ください。",
  E_RELAY_TOO_LARGE: "送る内容が大きすぎます。書類の数を減らしてください。",
  E_RELAY_BUSY: "混み合っています。少し待ってから、もう一度送ってください。",
  E_RELAY_UNREACHABLE: "つながりませんでした。電波の良い所で、もう一度送ってください（答えはこの端末に残っています）。",
};
export const errorText = (code: string): string => ERRORS[code] ?? "うまく送れませんでした。もう一度お試しください。続くときは担当の FP にご連絡ください。";

const AGE_KEY = "hs.family.adult.age";

/** 数の欄の確かめ（取り込みでも同じ決まりで読む。ここでは打ち間違いに早く気づいてもらうため） */
function inputProblem(item: WebItem, a: DraftAnswer | undefined, ageAnswered: boolean): string | null {
  if (a === undefined || a.status !== "value" || a.raw === undefined || a.raw.kind === "bool") return null;
  const t = normNumber(a.raw.text).replace(/万円?$|円$|%$/, "");
  if (item.type === "money" || item.type === "integer" || item.type === "decimal" || item.type === "percent") {
    const u = item.unitLabel !== undefined && t.endsWith(item.unitLabel) ? t.slice(0, -item.unitLabel.length) : t;
    if (!/^-?\d+(\.\d+)?$/.test(u)) return "数字で入れてください（例: 520）";
    if (item.type === "integer" && u.includes(".")) return "整数で入れてください";
    const n = Number(u);
    if (item.min !== undefined && n < item.min) return `${item.min.toLocaleString("ja-JP")} 以上で入れてください`;
    if (item.max !== undefined && n > item.max) return `${item.max.toLocaleString("ja-JP")} 以下で入れてください`;
  }
  if (item.type === "yearMonth") {
    const m = a.raw2 === undefined || a.raw2.kind === "bool" ? "" : a.raw2.text;
    if (t === "") return "年も選んでください";
    if (m === MONTH_UNKNOWN) return ageAnswered ? null : "月がわからなければ、下の「年齢」を入れてください（あとで答えるなら「あとで」）";
    if (m === "") return "月も選んでください";
  }
  return null;
}

function unitText(item: WebItem): string {
  if (item.type === "money") return item.unit?.scale === "manYen" ? "万円" : "円";
  if (item.type === "percent") return "%";
  return item.unitLabel ?? "";
}

function basisText(item: WebItem): string | null {
  if (item.type !== "money" || item.unit === undefined) return null;
  return item.unit.basis === "monthly" ? "月あたり" : item.unit.basis === "annual" ? "1年あたり" : null;
}

function Choices({ options, value, onPick, name, compact }: { options: readonly { value: string; label: string }[]; value: string | null; onPick: (v: string) => void; name: string; compact?: boolean }) {
  return (
    <div class={`hf-choices${compact === true ? " hf-compact" : ""}`} role="radiogroup" aria-label={name}>
      {options.map((c) => (
        <button type="button" key={c.value} class={`hf-choice${value === c.value ? " on" : ""}`} role="radio" aria-checked={value === c.value} onClick={() => onPick(c.value)}>
          {c.label}
        </button>
      ))}
    </div>
  );
}

const rawText = (a: DraftAnswer | undefined): string => (a?.status === "value" && a.raw !== undefined && a.raw.kind !== "bool" ? a.raw.text : "");
const raw2Text = (a: DraftAnswer | undefined): string => (a?.status === "value" && a.raw2 !== undefined && a.raw2.kind !== "bool" ? a.raw2.text : "");

/** 1つの項目の記入欄 */
function Field({ item, a, onChange, years, autoFocus, now, monthUnknown }: { item: WebItem; a: DraftAnswer | undefined; onChange: (a: DraftAnswer | undefined) => void; years: { from: number; to: number }; autoFocus: boolean; now: Date; monthUnknown: boolean }) {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (autoFocus && ref.current !== null && window.matchMedia("(pointer: fine)").matches) ref.current.focus();
  }, [autoFocus, item.key]);
  const text = rawText(a);
  const set = (t: string, kind: "number" | "text") => onChange(t.trim() === "" ? undefined : { status: "value", raw: { kind, text: t } });
  switch (item.type) {
    case "choice":
      // 短い選択肢（男性・女性 など）と、5つ以上の選択肢（働き方 など）は2列にして画面を短く（1画面にまとめた問いが長くならないように）
      return <Choices compact={(item.choices ?? []).length >= 5 || (item.choices ?? []).every((c) => c.label.length <= 8)} name={item.label} options={item.choices ?? []} value={a?.status === "value" ? text : null} onPick={(v) => onChange({ status: "value", raw: { kind: "text", text: v } })} />;
    case "moneyRange":
      return <Choices compact name={item.label} options={(item.ranges ?? []).map((r) => ({ value: r.label, label: r.label }))} value={a?.status === "value" ? text : null} onPick={(v) => onChange({ status: "value", raw: { kind: "text", text: v } })} />;
    case "yearMonth": {
      const y = /\d{4}/.exec(normNumber(text))?.[0] ?? "";
      const m = raw2Text(a);
      const list = yearChoices(item, years, now, y === "" ? undefined : Number(y));
      const put = (yy: string, mm: string) => onChange(yy === "" && mm === "" ? undefined : { status: "value", raw: { kind: "text", text: yy }, ...(mm !== "" ? { raw2: { kind: mm === MONTH_UNKNOWN ? "text" : "number", text: mm } } : {}) });
      return (
        <div class="hf-ym">
          <label>
            <span>年</span>
            <select value={y} onChange={(e) => put((e.currentTarget as HTMLSelectElement).value, m)} aria-label={`${item.label}の年`}>
              <option value="">選んでください</option>
              {list.map((n) => (
                <option key={n} value={String(n)}>
                  {yearLabel(n)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>月</span>
            <select value={m} onChange={(e) => put(y, (e.currentTarget as HTMLSelectElement).value)} aria-label={`${item.label}の月`}>
              <option value="">–</option>
              {MONTH_LABELS.map((l, i) => (
                <option key={l} value={String(i + 1)}>
                  {l}
                </option>
              ))}
              {monthUnknown ? <option value={MONTH_UNKNOWN}>わからない</option> : null}
            </select>
          </label>
        </div>
      );
    }
    case "text":
      return <textarea ref={ref as never} class="hf-text" rows={4} maxLength={item.maxLength ?? 2000} value={text} onInput={(e) => set((e.currentTarget as HTMLTextAreaElement).value, "text")} placeholder={item.example ?? ""} aria-label={item.label} />;
    default: {
      const n = Number(normNumber(text).replace(/万円?$|円$/, ""));
      const man = item.type === "money" && item.unit?.scale === "manYen" && text !== "" && Number.isFinite(n);
      return (
        <div class="hf-num">
          {basisText(item) !== null ? <span class="hf-basis">{basisText(item)}</span> : null}
          <input ref={ref as never} type="text" inputMode={item.type === "integer" ? "numeric" : "decimal"} autoComplete="off" value={text} onInput={(e) => set((e.currentTarget as HTMLInputElement).value, "number")} aria-label={item.label} />
          <span class="hf-unit">{unitText(item)}</span>
          {man ? <small class="hf-yen">＝ {(n * 10000).toLocaleString("ja-JP", { maximumFractionDigits: 0 })}円</small> : null}
        </div>
      );
    }
  }
}

function StateButtons({ item, a, onChange }: { item: WebItem; a: DraftAnswer | undefined; onChange: (a: DraftAnswer | undefined) => void }) {
  const pick = (status: "unknown" | "notApplicable") => onChange(a?.status === status ? undefined : { status });
  const unknown = item.states.includes("unknown");
  const na = item.states.includes("notApplicable") && item.naLabel !== null;
  if (!unknown && !na) return null;
  return (
    <div class="hf-states">
      {unknown ? (
        <button type="button" class={`hf-state${a?.status === "unknown" ? " on" : ""}`} aria-pressed={a?.status === "unknown"} onClick={() => pick("unknown")}>
          わからない
        </button>
      ) : null}
      {na ? (
        <button type="button" class={`hf-state${a?.status === "notApplicable" ? " on" : ""}`} aria-pressed={a?.status === "notApplicable"} onClick={() => pick("notApplicable")}>
          {item.naLabel ?? "当てはまらない"}
        </button>
      ) : null}
    </div>
  );
}

const officeName = (p: QuestionsPacket) => (p.office.name !== "" ? p.office.name : "担当の FP");

function Office({ p }: { p: QuestionsPacket }) {
  return (
    <header class="hf-top">
      <span class="hf-office">{officeName(p)}</span>
    </header>
  );
}

const dateText = (iso: string) => new Date(iso).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });

/** 一番下の小さな「このページの仕組み」（専門用語を避けて短く。提供元の名前と窓口は、配る所の説明のページに置く） */
function About({ p }: { p: QuestionsPacket }) {
  const who = p.office.name !== "" ? `${p.office.name}の担当の FP` : "担当の FP";
  return (
    <details class="hf-about" data-hf-about>
      <summary>このページの仕組み</summary>
      <ul>
        <li>お答えと書類は、この端末の中で鍵をかけて（暗号化して）から送ります。開けるのは、{who}のアプリだけです。</li>
        <li>途中で預かる置き場も、このページを動かしている提供元も、中身は読めない仕組みです。</li>
        <li>送った物は、担当の FP が受け取るか、回答の期限（{dateText(p.expiresAt)}）が過ぎると、置き場から消えます。</li>
        <li>途中のお答えは、この端末のこのブラウザの中に鍵をかけて残します。送ると消えます。「この端末の入力を消す」でも消せます。</li>
      </ul>
    </details>
  );
}

function fileLabel(f: DraftFile): string {
  return f.label;
}

/** 書類の画面（書類ごとに、撮る・ファイルを選ぶ・手元にない・あとで送る） */
function Documents({ p, d, mode, setDoc, upload, removeFile, thumbs }: { p: QuestionsPacket; d: Draft; mode: FormProps["mode"]; setDoc: (id: string, x: DraftDocument) => void; upload: FormProps["upload"]; removeFile: FormProps["removeFile"]; thumbs: Map<string, string> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const [tips, setTips] = useState(true);
  const total = Object.values(d.documents).reduce((s, x) => s + x.files.reduce((t, f) => t + f.bytes, 0), 0);
  const count = Object.values(d.documents).reduce((s, x) => s + x.files.length, 0);
  const attach = async (id: string, files: FileList | null) => {
    if (files === null || files.length === 0) return;
    const cur = d.documents[id] ?? { status: "blank", files: [] };
    let list = [...cur.files];
    setErr((e) => ({ ...e, [id]: "" }));
    for (const f of Array.from(files)) {
      if (list.length >= DOCUMENT_LIMITS.filesPerDocument) {
        setErr((e) => ({ ...e, [id]: `1つの書類に付けられるのは${DOCUMENT_LIMITS.filesPerDocument}枚までです` }));
        break;
      }
      if (count + list.length - cur.files.length >= DOCUMENT_LIMITS.files) {
        setErr((e) => ({ ...e, [id]: `送れるファイルは全部で${DOCUMENT_LIMITS.files}までです` }));
        break;
      }
      setBusy(id);
      const prep = await prepareFile(f);
      if (!prep.ok) {
        setErr((e) => ({ ...e, [id]: prep.reason }));
        continue;
      }
      if (total + prep.bytes.length > DOCUMENT_LIMITS.totalBytes) {
        setErr((e) => ({ ...e, [id]: "送るファイルが合わせて大きすぎます（40MB まで）" }));
        break;
      }
      try {
        const up = upload === undefined ? { fileId: `preview${String(list.length).padStart(9, "0")}`, sha256: "" } : await upload(prep.bytes);
        const n = list.length + 1;
        const label = prep.mime === "application/pdf" ? `PDF ${n}` : `写真 ${n}`;
        if (prep.mime !== "application/pdf" && typeof URL.createObjectURL === "function" && mode === "live") thumbs.set(up.fileId, URL.createObjectURL(new Blob([prep.bytes], { type: prep.mime })));
        list = [...list, { fileId: up.fileId, mime: prep.mime, bytes: prep.bytes.length, sha256: up.sha256, label }];
        setDoc(id, { status: "attached", files: list });
      } catch (e) {
        setErr((x) => ({ ...x, [id]: errorText(e instanceof Error ? e.message : String(e)) }));
      }
    }
    setBusy(null);
  };
  const drop = async (id: string, f: DraftFile) => {
    const cur = d.documents[id] ?? { status: "blank", files: [] };
    try {
      if (removeFile !== undefined) await removeFile(f.fileId);
    } catch {
      // 外せなくても、答えの一覧に載せなければ FP は受け取らない（受け取った後にまとめて消える）
    }
    const files = cur.files.filter((x) => x.fileId !== f.fileId);
    setDoc(id, { status: files.length > 0 ? "attached" : "blank", files });
  };
  return (
    <div class="hf-docs">
      <p class="hf-lead">お手元にあれば、写真か PDF で送ってください。書類はこの端末の中で暗号化して送り、担当の FP だけが開けます。</p>
      <details class="hf-tips" open={tips} onToggle={(e) => setTips((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>撮る前に（大事なこと）</summary>
        <ul>
          {PHOTO_TIPS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </details>
      {p.documents.map((doc) => {
        const x = d.documents[doc.id] ?? { status: "blank", files: [] };
        const chip = x.status === "attached" ? `付けました（${x.files.length}）` : x.status === "notAvailable" ? "手元にない" : x.status === "later" ? "あとで送る" : "まだ";
        return (
          <section class={`hf-doc s-${x.status}`} key={doc.id} data-hf-doc={doc.id}>
            <div class="hf-doc-h">
              <h3>{doc.title}</h3>
              <span class={`hf-chip c-${x.status}`}>{chip}</span>
            </div>
            {doc.purpose !== "" ? <p class="hf-why">{doc.purpose}</p> : null}
            {doc.where !== "" ? <p class="hf-where">写す所: {doc.where}</p> : null}
            {x.files.length > 0 ? (
              <ul class="hf-files">
                {x.files.map((f) => (
                  <li key={f.fileId}>
                    {thumbs.has(f.fileId) ? <img src={thumbs.get(f.fileId)} alt="" /> : <span class="hf-file-ic" aria-hidden="true">{f.mime === "application/pdf" ? "PDF" : "写"}</span>}
                    <span>{fileLabel(f)}</span>
                    <button type="button" class="hf-link" onClick={() => void drop(doc.id, f)}>
                      外す
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div class="hf-doc-actions">
              <label class={`hf-btn${busy === doc.id ? " busy" : ""}`}>
                <input type="file" accept="image/*" capture="environment" disabled={busy !== null} onChange={(e) => void attach(doc.id, (e.currentTarget as HTMLInputElement).files).then(() => ((e.target as HTMLInputElement).value = ""))} />
                撮る
              </label>
              <label class="hf-btn">
                <input type="file" accept="image/jpeg,image/png,image/heic,image/heif,application/pdf" multiple disabled={busy !== null} onChange={(e) => void attach(doc.id, (e.currentTarget as HTMLInputElement).files).then(() => ((e.target as HTMLInputElement).value = ""))} />
                ファイルを選ぶ
              </label>
              <button type="button" class={`hf-state${x.status === "notAvailable" ? " on" : ""}`} aria-pressed={x.status === "notAvailable"} onClick={() => setDoc(doc.id, { status: x.status === "notAvailable" ? "blank" : "notAvailable", files: x.files })}>
                手元にない
              </button>
              <button type="button" class={`hf-state${x.status === "later" ? " on" : ""}`} aria-pressed={x.status === "later"} onClick={() => setDoc(doc.id, { status: x.status === "later" ? "blank" : "later", files: x.files })}>
                あとで送る
              </button>
            </div>
            {busy === doc.id ? <p class="hf-note">暗号化して送っています…</p> : null}
            {err[doc.id] !== undefined && err[doc.id] !== "" ? <p class="hf-err">{err[doc.id]}</p> : null}
            {mode === "preview" ? <p class="hf-note">（見本では、選んだファイルは送られません）</p> : null}
          </section>
        );
      })}
    </div>
  );
}

const secTitle = (p: QuestionsPacket, id: string) => (id === START_SECTION ? START_TITLE : (p.sections.find((s) => s.id === id)?.title ?? ""));

type Row = { readonly i: number; readonly section: string; readonly gate: GateId } | { readonly i: number; readonly section: string; readonly f: ScreenField };

/** 確かめの画面・送った内容の一覧の行（分岐の問いと、画面の中の問いごと）。続けて同じ区画の行をまとめる */
function rowsOf(list: readonly Screen[]): { section: string; rows: Row[] }[] {
  const out: { section: string; rows: Row[] }[] = [];
  list.forEach((s, i) => {
    const rows: Row[] = s.kind === "gate" ? s.gates.map((gate) => ({ i, section: s.section, gate })) : s.kind === "item" ? s.fields.map((f) => ({ i, section: s.section, f })) : [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last !== undefined && last.section === r.section) last.rows.push(r);
      else out.push({ section: r.section, rows: [r] });
    }
  });
  return out;
}

/** 答えの一覧（確かめの画面は「直す」つき。送った後の画面は見るだけ） */
function AnswerList({ p, list, d, itemOf, onFix }: { p: QuestionsPacket; list: readonly Screen[]; d: Draft; itemOf: Map<string, WebItem>; onFix?: (i: number) => void }) {
  return (
    <>
      {rowsOf(list).map((g, gi) => (
        <section class="hf-rv-sec" key={`${g.section}:${gi}`}>
          <h3>{secTitle(p, g.section)}</h3>
          <dl>
            {g.rows.map((r) => {
              if ("gate" in r) {
                return (
                  <div key={`g:${r.gate}`} class={`hf-rv${d.gates[r.gate] === undefined ? " todo" : ""}`}>
                    <dt>{gateText(p, r.gate).label}</dt>
                    <dd>
                      {gateAnswerText(p, r.gate, d.gates[r.gate])}
                      {onFix !== undefined ? (
                        <button type="button" class="hf-link" onClick={() => onFix(r.i)}>
                          直す
                        </button>
                      ) : null}
                    </dd>
                  </div>
                );
              }
              const it = itemOf.get(r.f.key) as WebItem;
              const head = indexLabel(it, r.f.index);
              const subs = r.f.alt.map((k) => ({ it: itemOf.get(k) as WebItem, a: d.answers[draftKey(k, r.f.index)] })).filter((x) => x.a !== undefined && x.a.status !== "later");
              const main = d.answers[draftKey(r.f.key, r.f.index)];
              const mainShown = main !== undefined && main.status !== "later";
              // 別の答え方（範囲・年齢）は、答えの欄が空か「わからない」か、生年月の月がわからないときに添える
              const withSubs = subs.length > 0 && mainShown && (main.status !== "value" || raw2Text(main) === MONTH_UNKNOWN);
              const shown = !mainShown && subs.length > 0 ? subs.map((x) => answerText(x.it, x.a)).join("・") : !mainShown ? "（まだ）" : answerText(it, main) + (withSubs ? `（${subs.map((x) => answerText(x.it, x.a)).join("・")}）` : "");
              return (
                <div key={draftKey(r.f.key, r.f.index)} class={`hf-rv${fieldAnswered(d, r.f) ? "" : " todo"}`}>
                  <dt>
                    {head !== null ? `${head} ` : ""}
                    {it.label}
                  </dt>
                  <dd>
                    {shown}
                    {onFix !== undefined ? (
                      <button type="button" class="hf-link" onClick={() => onFix(r.i)}>
                        直す
                      </button>
                    ) : null}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </>
  );
}

function DocumentList({ p, d, onFix }: { p: QuestionsPacket; d: Draft; onFix?: () => void }) {
  if (p.documents.length === 0) return null;
  return (
    <section class="hf-rv-sec">
      <h3>書類</h3>
      <dl>
        {p.documents.map((x) => {
          const v = d.documents[x.id];
          const t = v === undefined || v.status === "blank" ? "（まだ）" : v.status === "attached" ? `付けました（${v.files.map((f) => f.label).join("・")}）` : v.status === "notAvailable" ? "手元にない" : "あとで送る";
          return (
            <div class={`hf-rv${v === undefined || v.status === "blank" ? " todo" : ""}`} key={x.id}>
              <dt>{x.title}</dt>
              <dd>
                {t}
                {onFix !== undefined ? (
                  <button type="button" class="hf-link" onClick={onFix}>
                    直す
                  </button>
                ) : null}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

/** この端末の入力を消す（押し間違えないように、2回目で消す） */
function ClearDraft({ onClear }: { onClear: () => void }) {
  const [ask, setAsk] = useState(false);
  if (!ask)
    return (
      <p class="hf-clear">
        <button type="button" class="hf-link" onClick={() => setAsk(true)} data-hf-clear>
          この端末の入力を消す
        </button>
      </p>
    );
  return (
    <div class="hf-clear ask" role="alert">
      <p>この端末に残っている途中のお答えと、付けた書類を消します。よろしいですか。</p>
      <button type="button" class="hf-state" onClick={onClear} data-hf-clear-yes>
        消す
      </button>
      <button type="button" class="hf-state" onClick={() => setAsk(false)}>
        やめる
      </button>
    </div>
  );
}

/** 画面の中の1つの問い（答えの欄・別の答え方・わからない など） */
function Question({ p, d, f, itemOf, setAnswer, first, showHead, now, mode }: { p: QuestionsPacket; d: Draft; f: ScreenField; itemOf: Map<string, WebItem>; setAnswer: (key: string, index: number | undefined, a: DraftAnswer | undefined) => void; first: boolean; showHead: boolean; now: Date; mode: FormProps["mode"] }) {
  const it = itemOf.get(f.key) as WebItem;
  const a = d.answers[draftKey(f.key, f.index)];
  const head = indexLabel(it, f.index);
  const pre = it.confirm === true ? it.prefill?.[String(f.index ?? 0)] : undefined;
  const range = f.alt.map((k) => itemOf.get(k) as WebItem).find((x) => x.type === "moneyRange");
  const others = f.alt.filter((k) => k !== range?.key);
  const ra = range === undefined ? undefined : d.answers[draftKey(range.key, f.index)];
  const [open, setOpen] = useState(a?.status === "value");
  const Heading = first ? "h2" : "h3";
  const setMain = (x: DraftAnswer | undefined) => {
    setAnswer(f.key, f.index, x);
    // 金額か範囲のどちらかで答える（片方を選んだら、もう片方を消す）
    if (x !== undefined && range !== undefined) setAnswer(range.key, f.index, undefined);
  };
  const age = others.includes(AGE_KEY) ? itemOf.get(AGE_KEY) : undefined;
  const birthYear = it.type === "yearMonth" && raw2Text(a) === MONTH_UNKNOWN ? Number(/\d{4}/.exec(rawText(a))?.[0]) : NaN;
  return (
    <div class={`hf-field${first ? "" : " more"}`} data-hf-field={draftKey(f.key, f.index)}>
      {showHead && head !== null ? <p class="hf-who-line">{head}</p> : null}
      <Heading class={first ? "hf-q" : "hf-q2"}>{it.label}</Heading>
      {it.guide !== undefined ? <p class="hf-guide">{it.guide}</p> : null}
      {pre !== undefined ? <p class="hf-pre">前回のお答え: {answerText(it, pre as DraftAnswer)}（変わっていなければ、そのまま「次へ」）</p> : null}
      {range !== undefined ? (
        <>
          {basisText(it) !== null ? <p class="hf-basis-line">{basisText(it)}・だいたいの範囲を選んでください</p> : <p class="hf-basis-line">だいたいの範囲を選んでください</p>}
          <Field item={range} a={ra?.status === "value" ? ra : undefined} onChange={(x) => (setAnswer(range.key, f.index, x), x !== undefined ? setAnswer(f.key, f.index, undefined) : undefined)} years={p.years} autoFocus={false} now={now} monthUnknown={false} />
          {open ? (
            <div class="hf-exact">
              <Field item={it} a={a?.status === "value" ? a : undefined} onChange={setMain} years={p.years} autoFocus={mode === "live"} now={now} monthUnknown={false} />
              {it.example !== undefined ? <p class="hf-example">記入例: {it.example}</p> : null}
            </div>
          ) : (
            <button type="button" class="hf-link hf-open" onClick={() => setOpen(true)} data-hf-exact={f.key}>
              くわしい額を入れる
            </button>
          )}
        </>
      ) : (
        <>
          <Field item={it} a={a?.status === "value" ? a : undefined} onChange={setMain} years={p.years} autoFocus={first && mode === "live"} now={now} monthUnknown={age !== undefined} />
          {it.example !== undefined && it.type !== "text" && it.type !== "yearMonth" ? <p class="hf-example">記入例: {it.example}</p> : null}
        </>
      )}
      <StateButtons
        item={it}
        a={a}
        onChange={(x) => {
          setAnswer(f.key, f.index, x);
          if (x !== undefined && range !== undefined) setAnswer(range.key, f.index, undefined);
        }}
      />
      {others.map((k) => {
        const sub = itemOf.get(k) as WebItem;
        const sa = d.answers[draftKey(k, f.index)];
        return (
          <div class="hf-also" key={k}>
            <p class="hf-also-h">{k === AGE_KEY ? "年齢（生まれた年月がわからないとき）" : sub.label}</p>
            {k === AGE_KEY && Number.isFinite(birthYear) ? (
              <p class="hf-note">
                {birthYear}年生まれなら、いま{now.getFullYear() - birthYear - 1}歳か{now.getFullYear() - birthYear}歳です
              </p>
            ) : null}
            <Field item={sub} a={sa?.status === "value" ? sa : undefined} onChange={(x) => setAnswer(k, f.index, x)} years={p.years} autoFocus={false} now={now} monthUnknown={false} />
            <StateButtons item={sub} a={sa} onChange={(x) => setAnswer(k, f.index, x)} />
          </div>
        );
      })}
    </div>
  );
}

export function HearingForm(props: FormProps): JSX.Element {
  const { packet: p, mode } = props;
  const clock = props.now ?? (() => new Date());
  const [d, setD] = useState<Draft>(props.initial);
  const list = useMemo(() => screens(p, d), [p, d]);
  const [cur, setCur] = useState<string>(props.startAt ?? "intro");
  const [back, setBack] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // 見本だけ、送った後の画面を開ける（FP のアプリの見本・試し）
  const [sent, setSent] = useState<Date | null>(mode === "preview" && props.startAt === "sent" ? clock() : null);
  const [showSent, setShowSent] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const thumbs = useRef(new Map<string, string>()).current;
  const itemOf = useMemo(() => new Map(p.items.map((i) => [i.key, i])), [p]);
  const est = useMemo(() => estimate(p), [p]);
  let at = list.findIndex((s) => screenId(s) === cur);
  if (at < 0) at = 0;
  const screen = list[at] as Screen;
  // 下書きは前の値から作り直す（続けて押しても取りこぼさない）。端末に残すのは変わった後（live の入口が暗号化して置く）
  const first = useRef(true);
  const skipSave = useRef(false);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    props.onDraft?.(d);
  }, [d]);
  useEffect(() => {
    if (!printing) return;
    setPrinting(false);
    if (typeof window !== "undefined" && typeof window.print === "function") window.print();
  }, [printing]);
  const update = (f: (cur: Draft) => Draft) => setD(f);
  const setAnswer = (key: string, index: number | undefined, a: DraftAnswer | undefined) => {
    setProblem(null);
    update((cur) => {
      const answers = { ...cur.answers };
      if (a === undefined) delete answers[draftKey(key, index)];
      else answers[draftKey(key, index)] = a;
      return { ...cur, answers };
    });
  };
  const go = (n: number) => {
    const s = list[Math.max(0, Math.min(list.length - 1, n))];
    if (s === undefined) return;
    setProblem(null);
    setCur(screenId(s));
    if (typeof window !== "undefined" && mode === "live") window.scrollTo(0, 0);
  };
  const toReview = () => {
    setBack(false);
    setProblem(null);
    setCur("review");
    if (typeof window !== "undefined" && mode === "live") window.scrollTo(0, 0);
  };
  /** 答えの無い問いに「あとで」を付ける（答えのある欄はそのまま） */
  const markLater = () => {
    if (screen.kind !== "item") return;
    const fields = screen.fields;
    update((cur) => {
      const answers = { ...cur.answers };
      for (const f of fields) if (!fieldAnswered(cur, f) && answers[draftKey(f.key, f.index)] === undefined) answers[draftKey(f.key, f.index)] = { status: "later" };
      return { ...cur, answers };
    });
  };
  const pendingAt = list.findIndex((x) => (x.kind === "item" && x.fields.some((f) => !fieldAnswered(d, f))) || (x.kind === "gate" && x.gates.some((g) => d.gates[g] === undefined)));
  const next = () => {
    if (screen.kind === "item") {
      for (const f of screen.fields) {
        const ageAnswered = f.alt.includes(AGE_KEY) && d.answers[draftKey(AGE_KEY, f.index)] !== undefined && d.answers[draftKey(AGE_KEY, f.index)]?.status !== "later";
        for (const k of fieldKeys(f)) {
          const it = itemOf.get(k);
          const msg = it === undefined ? null : inputProblem(it, d.answers[draftKey(k, f.index)], ageAnswered);
          if (msg !== null) return setProblem(screen.fields.length > 1 ? `${(itemOf.get(f.key) as WebItem).label}: ${msg}` : msg);
        }
      }
      // 空のまま「次へ」は「あとで」と同じ（確かめの画面で「まだの問い」に出る。続きからは飛ばす）
      markLater();
    }
    if (screen.kind === "intro" && d.started) {
      // 続きから: まだ答えていない最初の問い（無ければ確かめの画面）。「あとで」にした問いは飛ばす
      const todo = list.find((x) => (x.kind === "item" && x.fields.every((f) => fieldKeys(f).every((k) => d.answers[draftKey(k, f.index)] === undefined))) || (x.kind === "gate" && x.gates.some((g) => d.gates[g] === undefined)));
      return go(todo === undefined ? list.length - 1 : list.indexOf(todo));
    }
    if (screen.kind === "intro") update((cur) => ({ ...cur, started: true }));
    if (back) return toReview();
    go(at + 1);
  };
  const later = () => {
    markLater();
    setProblem(null);
    if (back) return toReview();
    go(at + 1);
  };
  const send = async () => {
    setSending(true);
    setSendErr(null);
    try {
      if (props.submit !== undefined) await props.submit(d);
      setSent(clock());
    } catch (e) {
      setSendErr(errorText(e instanceof Error ? e.message : String(e)));
    } finally {
      setSending(false);
    }
  };
  const clear = () => {
    for (const x of Object.values(d.documents))
      for (const f of x.files) {
        if (props.removeFile !== undefined) void props.removeFile(f.fileId).catch(() => undefined);
        const t = thumbs.get(f.fileId);
        if (t !== undefined && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(t);
        thumbs.delete(f.fileId);
      }
    skipSave.current = true;
    props.onClear?.();
    setD(initialDraft(p));
    setBack(false);
    setCur("intro");
  };
  const style = p.office.color !== null ? ({ "--hf-accent": p.office.color } as Record<string, string>) : undefined;
  const now = clock();

  if (sent !== null) {
    const laterDocs = p.documents.filter((x) => d.documents[x.id]?.status === "later");
    return (
      <div class={`hf${mode === "preview" ? " preview" : ""}`} style={style} data-hf-screen="sent">
        <Office p={p} />
        <main class="hf-main hf-sent">
          <div class="hf-check" aria-hidden="true">
            ✓
          </div>
          <h1>{p.office.name !== "" ? `${p.office.name}に届きました` : "送りました"}</h1>
          <p>
            {sent.toLocaleString("ja-JP", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}に送りました。ご協力ありがとうございました。
          </p>
          {laterDocs.length > 0 ? <p>「あとで送る」にした書類（{laterDocs.map((x) => x.title).join("・")}）は、担当の FP から送り方をお知らせします。</p> : null}
          <p>担当の FP に、送ったことをお知らせください。</p>
          <div class="hf-sent-actions">
            <button type="button" class="hf-state" onClick={() => setShowSent(!showSent)} aria-expanded={showSent} data-hf-show-sent>
              {showSent ? "送った内容を閉じる" : "送った内容を見る"}
            </button>
            <button type="button" class="hf-state" onClick={() => (setShowSent(true), setPrinting(true))} data-hf-print>
              印刷する
            </button>
          </div>
          {showSent ? (
            <div class="hf-review hf-sent-list" data-hf-sent-list>
              <AnswerList p={p} list={list} d={d} itemOf={itemOf} />
              <DocumentList p={p} d={d} />
            </div>
          ) : null}
          <p class="hf-note">このページを閉じると、送った内容はこの端末には残りません。控えが要るときは、閉じる前に印刷してください。</p>
          {mode === "preview" ? <p class="hf-note">（見本です。答えは送っていません）</p> : null}
          <About p={p} />
        </main>
      </div>
    );
  }

  const pr = progress(p, list, at);
  const header = (
    <>
      <Office p={p} />
      {screen.kind !== "intro" ? (
        <div class="hf-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pr.pct} aria-label="進み具合">
          <ol class="hf-steps" aria-hidden="true">
            {pr.stages.map((s, i) => (
              <li key={s.id} class={i < pr.current ? "done" : i === pr.current ? "now" : ""} />
            ))}
          </ol>
          <span>{pr.stages[pr.current]?.title ?? ""}</span>
        </div>
      ) : null}
    </>
  );

  let body: JSX.Element;
  let canNext = true;
  let nextLabel = "次へ";
  let showLater = false;
  if (screen.kind === "intro") {
    nextLabel = d.started ? "続きから" : "はじめる";
    body = (
      <div class="hf-intro">
        <h1>{officeName(p)}からのご質問です</h1>
        <p class="hf-title">{p.title}</p>
        {p.office.purpose !== "" ? <p class="hf-lead">{p.office.purpose}にお聞きします。</p> : null}
        <ul class="hf-facts" data-hf-facts>
          <li>
            ご質問は<b>{est.screens}画面</b>ほど、<b>{est.minutes}分</b>ほどで答えられます。
          </li>
          <li>お答えは、この端末の中で暗号化してから送ります。{p.office.name !== "" ? `${p.office.name}の` : ""}担当の FP だけが開けます。</li>
          <li>
            回答の期限: <b>{dateText(p.expiresAt)}</b>まで
          </li>
        </ul>
        <ul class="hf-notes">
          {p.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        {p.office.privacyContact !== "" ? <p class="hf-note">個人情報のお問い合わせ: {p.office.privacyContact}</p> : null}
        {d.started ? <ClearDraft onClear={clear} /> : null}
      </div>
    );
  } else if (screen.kind === "consent") {
    body = (
      <div>
        <h2 class="hf-q">{p.consent.title}</h2>
        <p class="hf-lead">{p.consent.lead}</p>
        {p.consent.items.map((it) => (
          <div class="hf-consent" key={it.key}>
            <p>{it.label}</p>
            <Choices name={it.label} options={it.choices ?? []} value={rawText(d.answers[draftKey(it.key)]) || null} onPick={(v) => setAnswer(it.key, undefined, { status: "value", raw: { kind: "text", text: v } })} />
          </div>
        ))}
      </div>
    );
  } else if (screen.kind === "gate") {
    canNext = screen.gates.every((g) => d.gates[g] !== undefined);
    body = (
      <div>
        <p class="hf-sec">{secTitle(p, screen.section)}</p>
        {screen.gates.map((g, i) => {
          const t = gateText(p, g);
          const val = d.gates[g];
          const H = i === 0 ? "h2" : "h3";
          return (
            <div class={`hf-field${i === 0 ? "" : " more"}`} key={g} data-hf-gate={g}>
              <H class={i === 0 ? "hf-q" : "hf-q2"}>{t.label}</H>
              <p class="hf-lead">{t.lead}</p>
              <div class={`hf-gate-opts n${Math.min(3, t.options.length)}`}>
                <Choices compact name={t.label} options={t.options} value={val === undefined ? null : String(val)} onPick={(v) => update((cur) => ({ ...cur, gates: { ...cur.gates, [g]: Number(v) } }))} />
              </div>
            </div>
          );
        })}
      </div>
    );
  } else if (screen.kind === "item") {
    const lead = itemOf.get(screen.key) as WebItem;
    const sameIndex = screen.fields.every((f) => f.index === screen.index);
    const head = sameIndex ? indexLabel(lead, screen.index) : null;
    showLater = true;
    body = (
      <div>
        <p class="hf-sec">
          {secTitle(p, screen.section)}
          {head !== null ? <b class="hf-who">{head}</b> : null}
        </p>
        {screen.fields.map((f, i) => (
          <Question key={`${screenId(screen)}:${draftKey(f.key, f.index)}`} p={p} d={d} f={f} itemOf={itemOf} setAnswer={setAnswer} first={i === 0} showHead={!sameIndex} now={now} mode={mode} />
        ))}
        {problem !== null ? (
          <p class="hf-err" role="alert">
            {problem}
          </p>
        ) : null}
      </div>
    );
  } else if (screen.kind === "documents") {
    body = (
      <div>
        <h2 class="hf-q">送っていただきたい書類</h2>
        <Documents p={p} d={d} mode={mode} thumbs={thumbs} upload={props.upload} removeFile={props.removeFile} setDoc={(id, x) => update((cur) => ({ ...cur, documents: { ...cur.documents, [id]: x } }))} />
      </div>
    );
  } else {
    // 確かめの画面
    nextLabel = sending ? "送っています…" : "この内容で送る";
    const pending = list.reduce((n, s) => n + (s.kind === "item" ? s.fields.filter((f) => !fieldAnswered(d, f)).length : 0), 0);
    const docsPending = p.documents.filter((x) => (d.documents[x.id]?.status ?? "blank") === "blank").length;
    body = (
      <div class="hf-review">
        <h2 class="hf-q">お答えの確かめ</h2>
        <p class="hf-lead">直したい所は「直す」を押してください。よければ、いちばん下の「この内容で送る」を押してください。</p>
        {pending + docsPending > 0 ? (
          <div class="hf-pre" data-hf-pending>
            <p>
              まだの問いが{pending}、まだの書類が{docsPending}あります。途中まででも送れます。答えていない所は、面談のときにうかがいます。
            </p>
            {pendingAt >= 0 && pendingAt < list.length - 1 ? (
              <button type="button" class="hf-state" onClick={() => (setBack(true), go(pendingAt))} data-hf-todo>
                まだの問いに答える
              </button>
            ) : null}
          </div>
        ) : null}
        <AnswerList p={p} list={list} d={d} itemOf={itemOf} onFix={(i) => (setBack(true), go(i))} />
        <DocumentList p={p} d={d} onFix={() => (setBack(true), go(list.findIndex((s) => s.kind === "documents")))} />
        {sendErr !== null ? (
          <p class="hf-err" role="alert">
            {sendErr}
          </p>
        ) : null}
        <p class="hf-note">送った後は直せません。直したいことがあれば、担当の FP にお伝えください。</p>
        <ClearDraft onClear={clear} />
      </div>
    );
  }
  return (
    <div class={`hf${mode === "preview" ? " preview" : ""}`} style={style} data-hf-screen={screenId(screen)}>
      {header}
      {mode === "preview" ? <p class="hf-banner">見本です（お客さまにはこう見えます。答えは送られません）</p> : null}
      <main class="hf-main">
        {body}
        <About p={p} />
      </main>
      <nav class="hf-nav">
        {/* 確かめの画面の「直す」から来たときは、戻る先は確かめの画面だけ（右のボタン）。左には何も出さない */}
        {at > 0 && !back ? (
          <button type="button" class="hf-back" onClick={() => go(at - 1)}>
            戻る
          </button>
        ) : (
          <span />
        )}
        {showLater ? (
          <button type="button" class="hf-later" onClick={later}>
            あとで
          </button>
        ) : null}
        <button type="button" class="hf-next" disabled={!canNext || sending} onClick={() => (screen.kind === "review" ? void send() : next())} data-hf-next>
          {back && screen.kind !== "review" ? "確かめに戻る" : nextLabel}
        </button>
      </nav>
    </div>
  );
}
