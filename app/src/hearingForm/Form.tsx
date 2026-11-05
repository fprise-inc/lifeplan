// お客さまの画面（0125）: 1画面に1つの問い（または小さなまとまり）・進み具合・戻る／次へ・「わからない」「あとで」・確かめの画面・送った後の画面。
// お客さまのページ（main.tsx。live）と、FP のアプリの見本（preview。通信しない・端末に何も残さない）で同じ部品を使う。
// - スマホを先に考える（文字は大きめ・押す所は大きく・1列）。外のフォント・画像は読まない（CSP）
// - 問いの流れは hearing/src/web/flow.ts（答えに合わせて問いを飛ばす・人数で繰り返す）
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { MONTH_LABELS, yearLabel } from "../../../hearing/src/definition.ts";
import { DOCUMENT_LIMITS, PHOTO_TIPS } from "../../../hearing/src/web/documents.ts";
import { answerText, draftKey, GATE_TEXT, indexLabel, screenId, screens, type Draft, type DraftAnswer, type DraftDocument, type DraftFile, type GateId, type Screen } from "../../../hearing/src/web/flow.ts";
import type { QuestionsPacket, WebItem } from "../../../hearing/src/web/packet.ts";
import { prepareFile } from "./photo.ts";

export interface FormProps {
  packet: QuestionsPacket;
  mode: "live" | "preview";
  initial: Draft;
  /** 下書きが変わった（live は端末の中に暗号化して残す） */
  onDraft?: (d: Draft) => void;
  /** 書類のファイルを暗号化して置く（live だけ） */
  upload?: (bytes: Uint8Array<ArrayBuffer>) => Promise<{ fileId: string; sha256: string }>;
  removeFile?: (fileId: string) => Promise<void>;
  /** 送る（live）。失敗は符号の文字で投げる */
  submit?: (d: Draft) => Promise<void>;
  /** 見本で最初に開く画面（FP のアプリの見本の「この問いを見る」） */
  startAt?: string;
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

const norm = (t: string) => t.normalize("NFKC").replace(/[,\s]/g, "").replace(/[−ー―‐]/g, "-");

/** 数の欄の確かめ（取り込みでも同じ決まりで読む。ここでは打ち間違いに早く気づいてもらうため） */
function inputProblem(item: WebItem, a: DraftAnswer | undefined): string | null {
  if (a === undefined || a.status !== "value" || a.raw === undefined || a.raw.kind === "bool") return null;
  const t = norm(a.raw.text).replace(/万円?$|円$|%$/, "");
  if (item.type === "money" || item.type === "integer" || item.type === "decimal" || item.type === "percent") {
    if (!/^-?\d+(\.\d+)?$/.test(t)) return "数字で入れてください（例: 520）";
    if (item.type === "integer" && t.includes(".")) return "整数で入れてください";
    const n = Number(t);
    if (item.min !== undefined && n < item.min) return `${item.min.toLocaleString("ja-JP")} 以上で入れてください`;
    if (item.max !== undefined && n > item.max) return `${item.max.toLocaleString("ja-JP")} 以下で入れてください`;
  }
  if (item.type === "yearMonth" && (a.raw2 === undefined || a.raw2.kind === "bool" || a.raw2.text === "")) return "月も選んでください";
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

function Choices({ options, value, onPick, name }: { options: readonly { value: string; label: string }[]; value: string | null; onPick: (v: string) => void; name: string }) {
  return (
    <div class="hf-choices" role="radiogroup" aria-label={name}>
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
function Field({ item, a, onChange, years, autoFocus }: { item: WebItem; a: DraftAnswer | undefined; onChange: (a: DraftAnswer | undefined) => void; years: { from: number; to: number }; autoFocus: boolean }) {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (autoFocus && ref.current !== null && window.matchMedia("(pointer: fine)").matches) ref.current.focus();
  }, [autoFocus, item.key]);
  const text = rawText(a);
  const set = (t: string, kind: "number" | "text") => onChange(t.trim() === "" ? undefined : { status: "value", raw: { kind, text: t } });
  switch (item.type) {
    case "choice":
      return <Choices name={item.label} options={item.choices ?? []} value={a?.status === "value" ? text : null} onPick={(v) => onChange({ status: "value", raw: { kind: "text", text: v } })} />;
    case "moneyRange":
      return <Choices name={item.label} options={(item.ranges ?? []).map((r) => ({ value: r.label, label: r.label }))} value={a?.status === "value" ? text : null} onPick={(v) => onChange({ status: "value", raw: { kind: "text", text: v } })} />;
    case "yearMonth": {
      const y = /\d{4}/.exec(text)?.[0] ?? "";
      const m = raw2Text(a);
      const list: number[] = [];
      for (let n = years.to; n >= years.from; n--) list.push(n);
      const put = (yy: string, mm: string) => onChange(yy === "" && mm === "" ? undefined : { status: "value", raw: { kind: "text", text: yy }, ...(mm !== "" ? { raw2: { kind: "number", text: mm } } : {}) });
      return (
        <div class="hf-ym">
          <label>
            <span>年</span>
            <select value={y} onChange={(e) => put((e.currentTarget as HTMLSelectElement).value, m)}>
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
            <select value={m} onChange={(e) => put(y, (e.currentTarget as HTMLSelectElement).value)}>
              <option value="">–</option>
              {MONTH_LABELS.map((l, i) => (
                <option key={l} value={String(i + 1)}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
      );
    }
    case "text":
      return <textarea ref={ref as never} class="hf-text" rows={4} maxLength={item.maxLength ?? 2000} value={text} onInput={(e) => set((e.currentTarget as HTMLTextAreaElement).value, "text")} placeholder={item.example ?? ""} />;
    default: {
      const n = Number(norm(text));
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
  return (
    <div class="hf-states">
      {item.states.includes("unknown") ? (
        <button type="button" class={`hf-state${a?.status === "unknown" ? " on" : ""}`} aria-pressed={a?.status === "unknown"} onClick={() => pick("unknown")}>
          わからない
        </button>
      ) : null}
      {item.states.includes("notApplicable") && item.naLabel !== null ? (
        <button type="button" class={`hf-state${a?.status === "notApplicable" ? " on" : ""}`} aria-pressed={a?.status === "notApplicable"} onClick={() => pick("notApplicable")}>
          {item.naLabel ?? "当てはまらない"}
        </button>
      ) : null}
    </div>
  );
}

function Office({ p }: { p: QuestionsPacket }) {
  return (
    <header class="hf-top">
      <span class="hf-office">{p.office.name !== "" ? p.office.name : "担当の FP"}</span>
    </header>
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

export function HearingForm(props: FormProps): JSX.Element {
  const { packet: p, mode } = props;
  const [d, setD] = useState<Draft>(props.initial);
  const list = useMemo(() => screens(p, d), [p, d]);
  const [cur, setCur] = useState<string>(props.startAt ?? "intro");
  const [back, setBack] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const thumbs = useRef(new Map<string, string>()).current;
  const itemOf = useMemo(() => new Map(p.items.map((i) => [i.key, i])), [p]);
  let at = list.findIndex((s) => screenId(s) === cur);
  if (at < 0) at = 0;
  const screen = list[at] as Screen;
  // 下書きは前の値から作り直す（続けて押しても取りこぼさない）。端末に残すのは変わった後（live の入口が暗号化して置く）
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    props.onDraft?.(d);
  }, [d]);
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
  const next = () => {
    if (screen.kind === "item") {
      for (const k of [screen.key, ...screen.also]) {
        const it = itemOf.get(k);
        const msg = it === undefined ? null : inputProblem(it, d.answers[draftKey(k, screen.index)]);
        if (msg !== null) return setProblem(msg);
      }
    }
    if (screen.kind === "intro" && d.started) {
      // 続きから: まだ答えていない最初の問い（無ければ確かめの画面）
      const todo = list.find((x) => (x.kind === "item" && [x.key, ...x.also].every((k) => d.answers[draftKey(k, x.index)] === undefined)) || (x.kind === "gate" && d.gates[x.gate] === undefined));
      return go(todo === undefined ? list.length - 1 : list.indexOf(todo));
    }
    if (screen.kind === "intro") update((cur) => ({ ...cur, started: true }));
    if (back) {
      setBack(false);
      return setCur("review");
    }
    go(at + 1);
  };
  const later = () => {
    if (screen.kind === "item") {
      const keys = [screen.key, ...screen.also];
      const index = screen.index;
      update((cur) => {
        const answers = { ...cur.answers };
        // 答えのある欄はそのまま（「あとで」は答えの無い欄にだけ付ける）
        for (const k of keys) if (answers[draftKey(k, index)] === undefined) answers[draftKey(k, index)] = { status: "later" };
        return { ...cur, answers };
      });
    }
    setProblem(null);
    if (back) {
      setBack(false);
      return setCur("review");
    }
    go(at + 1);
  };
  const send = async () => {
    setSending(true);
    setSendErr(null);
    try {
      if (props.submit !== undefined) await props.submit(d);
      setSent(true);
    } catch (e) {
      setSendErr(errorText(e instanceof Error ? e.message : String(e)));
    } finally {
      setSending(false);
    }
  };
  const style = p.office.color !== null ? ({ "--hf-accent": p.office.color } as Record<string, string>) : undefined;
  const total = list.length - 1;
  const pct = Math.round((Math.min(at, total) / Math.max(1, total)) * 100);
  const sec = (id: string) => p.sections.find((s) => s.id === id);

  if (sent)
    return (
      <div class="hf" style={style} data-hf-screen="sent">
        <Office p={p} />
        <main class="hf-main hf-sent">
          <div class="hf-check" aria-hidden="true">
            ✓
          </div>
          <h1>送りました</h1>
          <p>ご協力ありがとうございました。{p.office.name !== "" ? `${p.office.name}の` : ""}担当の FP に、送ったことをお知らせください。</p>
          <p class="hf-note">このページは閉じてかまいません。送った答えと書類は、この端末には残しません。</p>
          {mode === "preview" ? <p class="hf-note">（見本です。答えは送っていません）</p> : null}
        </main>
      </div>
    );

  const header = (
    <>
      <Office p={p} />
      {screen.kind !== "intro" ? (
        <div class="hf-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="進み具合">
          <div class="hf-bar" style={{ width: `${pct}%` }} />
          <span>
            {Math.min(at, total)} / {total}
          </span>
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
        <h1>{p.title}</h1>
        {p.office.purpose !== "" ? <p class="hf-lead">{p.office.purpose}にお聞きします。</p> : null}
        <ul class="hf-notes">
          {p.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        <p class="hf-note">回答の期限: {new Date(p.expiresAt).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" })}まで</p>
        {p.office.privacyContact !== "" ? <p class="hf-note">個人情報のお問い合わせ: {p.office.privacyContact}</p> : null}
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
    const g = GATE_TEXT[screen.gate];
    const max = g.max(p);
    const val = d.gates[screen.gate];
    const opts = screen.gate === "spouse" ? [{ value: "1", label: "いらっしゃる" }, { value: "0", label: "いらっしゃらない" }] : Array.from({ length: max + 1 }, (_, n) => ({ value: String(n), label: n === 0 ? "いない・ない" : `${n}` }));
    canNext = val !== undefined;
    body = (
      <div>
        <p class="hf-sec">{sec(screen.section)?.title ?? ""}</p>
        <h2 class="hf-q">{g.label}</h2>
        <p class="hf-lead">{g.lead}</p>
        <Choices name={g.label} options={opts} value={val === undefined ? null : String(val)} onPick={(v) => update((cur) => ({ ...cur, gates: { ...cur.gates, [screen.gate as GateId]: Number(v) } }))} />
      </div>
    );
  } else if (screen.kind === "item") {
    const it = itemOf.get(screen.key) as WebItem;
    const head = indexLabel(it, screen.index);
    const a = d.answers[draftKey(it.key, screen.index)];
    showLater = true;
    const pre = it.confirm === true ? it.prefill?.[String(screen.index ?? 0)] : undefined;
    body = (
      <div>
        <p class="hf-sec">
          {sec(screen.section)?.title ?? ""}
          {head !== null ? <b class="hf-who">{head}</b> : null}
        </p>
        <h2 class="hf-q">{it.label}</h2>
        {it.guide !== undefined ? <p class="hf-guide">{it.guide}</p> : null}
        {pre !== undefined ? <p class="hf-pre">前回のお答え: {answerText(it, pre as DraftAnswer)}（変わっていなければ、そのまま「次へ」）</p> : null}
        <Field item={it} a={a?.status === "value" ? a : undefined} onChange={(x) => setAnswer(it.key, screen.index, x)} years={p.years} autoFocus={mode === "live"} />
        {it.example !== undefined && it.type !== "text" ? <p class="hf-example">記入例: {it.example}</p> : null}
        <StateButtons item={it} a={a} onChange={(x) => setAnswer(it.key, screen.index, x)} />
        {screen.also.map((k) => {
          const sub = itemOf.get(k) as WebItem;
          const sa = d.answers[draftKey(k, screen.index)];
          return (
            <div class="hf-also" key={k}>
              <p class="hf-also-h">{sub.type === "moneyRange" ? "はっきりしなければ、だいたいの範囲で" : sub.label}</p>
              <Field item={sub} a={sa?.status === "value" ? sa : undefined} onChange={(x) => setAnswer(k, screen.index, x)} years={p.years} autoFocus={false} />
              <StateButtons item={sub} a={sa} onChange={(x) => setAnswer(k, screen.index, x)} />
            </div>
          );
        })}
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
    const rows = list.map((s, i) => ({ s, i })).filter(({ s }) => s.kind === "item" || s.kind === "gate" || s.kind === "consent");
    const pending = rows.filter(({ s }) => s.kind === "item" && [s.key, ...s.also].every((k) => d.answers[draftKey(k, s.index)] === undefined || d.answers[draftKey(k, s.index)]?.status === "later")).length;
    const docsPending = p.documents.filter((x) => (d.documents[x.id]?.status ?? "blank") === "blank").length;
    body = (
      <div class="hf-review">
        <h2 class="hf-q">お答えの確かめ</h2>
        <p class="hf-lead">直したい所は「直す」を押してください。よければ、いちばん下の「この内容で送る」を押してください。</p>
        {pending + docsPending > 0 ? <p class="hf-pre">まだの問いが{pending}、まだの書類が{docsPending}あります。わかる所だけでかまいません。</p> : null}
        {p.sections.map((sc) => {
          const mine = rows.filter(({ s }) => (s.kind === "item" || s.kind === "gate") && s.section === sc.id);
          if (mine.length === 0) return null;
          return (
            <section class="hf-rv-sec" key={sc.id}>
              <h3>{sc.title}</h3>
              <dl>
                {mine.map(({ s, i }) => {
                  if (s.kind === "gate") {
                    const v = d.gates[s.gate];
                    return (
                      <div key={screenId(s)} class="hf-rv">
                        <dt>{GATE_TEXT[s.gate].label}</dt>
                        <dd>
                          {v === undefined ? "（まだ）" : s.gate === "spouse" ? (v === 1 ? "いらっしゃる" : "いらっしゃらない") : v === 0 ? "いない・ない" : `${v}`}
                          <button type="button" class="hf-link" onClick={() => (setBack(true), go(i))}>
                            直す
                          </button>
                        </dd>
                      </div>
                    );
                  }
                  if (s.kind !== "item") return null;
                  const it = itemOf.get(s.key) as WebItem;
                  const head = indexLabel(it, s.index);
                  const subs = s.also.map((k) => ({ it: itemOf.get(k) as WebItem, a: d.answers[draftKey(k, s.index)] })).filter((x) => x.a !== undefined && x.a.status !== "later");
                  const main = d.answers[draftKey(s.key, s.index)];
                  const shown = main === undefined && subs.length > 0 ? subs.map((x) => answerText(x.it, x.a)).join("・") : answerText(it, main) + (subs.length > 0 && main !== undefined && main.status !== "value" ? `（${subs.map((x) => answerText(x.it, x.a)).join("・")}）` : "");
                  return (
                    <div key={screenId(s)} class={`hf-rv${main === undefined || main.status === "later" ? " todo" : ""}`}>
                      <dt>
                        {head !== null ? `${head} ` : ""}
                        {it.label}
                      </dt>
                      <dd>
                        {shown}
                        <button type="button" class="hf-link" onClick={() => (setBack(true), go(i))}>
                          直す
                        </button>
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          );
        })}
        {p.documents.length > 0 ? (
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
                      <button type="button" class="hf-link" onClick={() => (setBack(true), go(list.findIndex((s) => s.kind === "documents")))}>
                        直す
                      </button>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ) : null}
        {sendErr !== null ? (
          <p class="hf-err" role="alert">
            {sendErr}
          </p>
        ) : null}
        <p class="hf-note">送った後は直せません。直したいことがあれば、担当の FP にお伝えください。</p>
      </div>
    );
  }
  return (
    <div class={`hf${mode === "preview" ? " preview" : ""}`} style={style} data-hf-screen={screenId(screen)}>
      {header}
      {mode === "preview" ? <p class="hf-banner">見本です（お客さまにはこう見えます。答えは送られません）</p> : null}
      <main class="hf-main">{body}</main>
      <nav class="hf-nav">
        {at > 0 ? (
          <button type="button" class="hf-back" onClick={() => (back ? (setBack(false), setCur("review")) : go(at - 1))}>
            {back ? "確かめに戻る" : "戻る"}
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
