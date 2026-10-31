// 「明細から生活費を出す」（作業の層。0034）。基本生活費のパネルの見出しの横の「明細から出す」で開く大きなパネル。閉じる・承認すると基本生活費のパネルに戻る。
//   1 口座・カード: 呼び名・持ち主・カード会社（カード番号・口座番号は書かない）
//   2 明細の取り込み: 本体の開くダイアログで選んだ CSV・PDF を PC の中で読み、列の対応付けを確かめて（選び直して・覚えて）取り込む。期間を直す
//   3 ヒアリング: 迷う行をお客さまに画面を見せながらボタンで決める（持ち主の働き方で選べる区分を変える）。世帯の決まり・働き方の選び直し。
//     前もってお客さまに印を付けてもらう確認シート（表計算のファイル）の書き出しと、返ってきたシートの印を確かめて入れること
//   4 生活費の候補: 月平均・一時的支出・注意を見せ、FP がチェックした候補だけを現状に入れる（承認の記録と取り込んだ記録 applied を残す）
// 明細のファイルのバイト列はこのパネルの中で読むときだけ持ち、閉じれば捨てる（世帯にも事務所データにも残さない）
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { version as APP_VERSION } from "../../../package.json";
import { CARD_ISSUERS, COLUMN_ROLES, LIVING_LABELS, markSheetWarnings, ROLE_LABELS, WORK_STYLE_LABELS, type Bucket, type ColumnMapping, type ColumnRole, type Issue, type ReviewItem, type SourceKind, type StatementCandidate, type StatementCategory, type StatementLog } from "../../../../statement/src/index.ts";
import type { SaveOutcome, StatementHost, StatementOfficeData } from "../../engine/host.ts";
import { approvalTime, randomBytes } from "../hearing/sheet.ts";
import { newId, type WorkingHousehold } from "../input/household.ts";
import {
  accountLabelProblem,
  addAccount,
  addImport,
  analyze,
  approve,
  approveMarks,
  beforeText,
  BUCKET_BUTTONS,
  candidatesOf,
  CATEGORY_GROUPS,
  categoryShort,
  decide,
  decidedRows,
  defaultCandidateSelection,
  defaultMarkSelection,
  exportMarkSheet,
  formatToLearn,
  KIND_LABELS,
  logOf,
  markDateText,
  markText,
  otherReview,
  ownerOptions,
  percentText,
  periodProblem,
  putRule,
  readFile,
  readSheet,
  removeAccount,
  removeImport,
  removeRule,
  requestSize,
  rowsSpan,
  setInclude,
  setPeriod,
  setStyles,
  SHARE_CHOICES,
  shareOfPercent,
  sheetPlan,
  STYLE_CHOICES,
  styleRows,
  updateAccount,
  withSheetRequest,
  yen,
  type AccountDraft,
  type Analysis,
  type ReadOk,
  type SheetRead,
} from "./model.ts";

type Step = "accounts" | "import" | "review" | "result";

const STEPS: readonly { id: Step; label: string }[] = [
  { id: "accounts", label: "口座・カード" },
  { id: "import", label: "明細の取り込み" },
  { id: "review", label: "ヒアリング" },
  { id: "result", label: "生活費の候補" },
];

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

const dateText = (d: string) => d.replace(/-/gu, "/");

interface PanelProps {
  wh: WorkingHousehold;
  host: StatementHost;
  /** 明細の取り込みの記録を変えた（元に戻す・やり直すの対象にしない） */
  onLog: (log: StatementLog) => void;
  /** 候補を承認した世帯（現状の値と取り込んだ記録） */
  onApprove: (next: WorkingHousehold) => void;
  /** 承認した後（入れた件数）。渡すと、パネルの中に知らせを出す代わりにこちらを呼ぶ（基本生活費のパネルに戻る） */
  onApproved?: (n: number) => void;
  onClose: () => void;
  initialStep?: Step;
  /** 表示用の顧客番号（確認シートの管理欄とファイル名に出す。英数字だけ） */
  customerNo?: string;
}

function IssueList({ issues, info = false }: { issues: readonly Issue[]; info?: boolean }) {
  const shown = issues.filter((i) => info || i.level !== "info");
  if (shown.length === 0) return null;
  return (
    <ul class="hs-issues st-issues">
      {shown.map((i, n) => (
        <li key={n} class={i.level}>
          {i.message}
        </li>
      ))}
    </ul>
  );
}

// ---- 1 口座・カード ----

const blankDraft = (): AccountDraft => ({ kind: "card", label: "", owner: null });

function AccountForm({ wh, initial, onDone, onCancel, edit }: { wh: WorkingHousehold; initial: AccountDraft; onDone: (d: AccountDraft) => void; onCancel?: () => void; edit: boolean }) {
  const [d, setD] = useState<AccountDraft>(initial);
  const [touched, setTouched] = useState(false);
  const problem = accountLabelProblem(d.label);
  const owners = ownerOptions(wh);
  return (
    <div class="st-acc-form" data-statement-account-form>
      {!edit ? (
        <div class="st-kinds" role="group" aria-label="明細の種類">
          {(["card", "bank", "app"] as const).map((k) => (
            <button type="button" key={k} class={d.kind === k ? "on" : ""} aria-pressed={d.kind === k} onClick={() => setD({ ...d, kind: k })} data-statement-kind={k}>
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>
      ) : null}
      <div class="hs-form">
        <label>
          <span>呼び名</span>
          <input type="text" value={d.label} maxLength={60} placeholder={d.kind === "card" ? "例: ご本人のカード（Aカード）" : d.kind === "bank" ? "例: 配偶者の給与口座" : "例: 家計簿アプリ"} onInput={(e) => setD({ ...d, label: (e.currentTarget as HTMLInputElement).value })} onBlur={() => setTouched(true)} aria-invalid={touched && problem !== null} data-statement-label />
        </label>
        <label>
          <span>持ち主</span>
          <select value={d.owner ?? ""} onChange={(e) => setD({ ...d, owner: (e.currentTarget as HTMLSelectElement).value || null })} data-statement-owner>
            <option value="">共用（世帯の家計）</option>
            {owners.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {d.kind === "card" ? (
          <label>
            <span>カード会社（銀行の引き落としと結びつける）</span>
            <select value={d.issuer ?? ""} onChange={(e) => setD({ ...d, issuer: (e.currentTarget as HTMLSelectElement).value })} data-statement-issuer>
              <option value="">選ばない</option>
              {CARD_ISSUERS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {touched && problem !== null ? <p class="fatal">{problem}</p> : <p class="rp-note">呼び名には、カード番号・口座番号を書きません。</p>}
      <div class="rp-actions">
        <button
          type="button"
          class="btn primary"
          disabled={problem !== null}
          onClick={() => {
            onDone(d);
            if (!edit) setD({ ...blankDraft(), kind: d.kind });
            setTouched(false);
          }}
          data-statement-account-add
        >
          {edit ? "直す" : "足す"}
        </button>
        {onCancel !== undefined ? (
          <button type="button" class="btn" onClick={onCancel}>
            キャンセル
          </button>
        ) : null}
      </div>
    </div>
  );
}

function AccountsStep({ wh, log, onLog, onNext }: { wh: WorkingHousehold; log: StatementLog; onLog: (l: StatementLog) => void; onNext: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const owners = new Map(ownerOptions(wh).map((o) => [o.value, o.label]));
  return (
    <div class="st-step" data-statement-step="accounts">
      <p class="st-lead">明細を取り込む口座・カードを登録します。持ち主の働き方で、ヒアリングで選べる区分（立替・事業の経費・会社の経費）が変わります。</p>
      {log.accounts.length > 0 ? (
        <ul class="st-accounts">
          {log.accounts.map((a) => {
            const n = log.imports.filter((i) => i.account === a.id).length;
            return (
              <li key={a.id} class="st-acc" data-statement-account={a.kind}>
                {editing === a.id ? (
                  <AccountForm
                    wh={wh}
                    edit
                    initial={{ kind: a.kind, label: a.label, owner: a.owner, ...(a.issuer !== undefined ? { issuer: a.issuer } : {}) }}
                    onDone={(d) => {
                      onLog(updateAccount(log, a.id, d));
                      setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <>
                    <span class={`st-kind k-${a.kind}`}>{KIND_LABELS[a.kind]}</span>
                    <b>{a.label}</b>
                    <span class="st-acc-meta">
                      持ち主: {a.owner === null ? "共用" : (owners.get(a.owner) ?? "（いない家族）")}
                      {a.issuer !== undefined ? `・${CARD_ISSUERS.find((c) => c.id === a.issuer)?.label ?? a.issuer}` : ""}
                      {`・明細 ${n}件`}
                    </span>
                    <span class="st-acc-act">
                      {removing === a.id ? (
                        <>
                          <small>{n > 0 ? `取り込んだ明細 ${n}件もいっしょに外します。` : ""}</small>
                          <button type="button" class="btn sm danger" onClick={() => onLog(removeAccount(log, a.id))}>
                            外す
                          </button>
                          <button type="button" class="btn sm" onClick={() => setRemoving(null)}>
                            やめる
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" class="btn sm" onClick={() => setEditing(a.id)}>
                            直す
                          </button>
                          <button type="button" class="btn sm" onClick={() => setRemoving(a.id)}>
                            外す
                          </button>
                        </>
                      )}
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      <h3 class="st-h3">口座・カードを足す</h3>
      <AccountForm wh={wh} edit={false} initial={blankDraft()} onDone={(d) => onLog(addAccount(log, d, newId()))} />
      {log.accounts.length > 0 ? (
        <div class="rp-actions st-next">
          <button type="button" class="btn primary" onClick={onNext} data-statement-next>
            明細の取り込みへ
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---- 2 明細の取り込み ----

const SOURCE_TEXT: Record<ReadOk["mappingSource"], string> = {
  fp: "選び直した列の対応付けで読みました",
  learned: "事務所で覚えた列の対応付けで読みました",
  guessed: "見出しから列の対応付けを推し量りました。列を確かめてください（確かめた形は事務所で覚えます）",
  reader: "明細の行の形（日付・店・金額）から読みました",
};

function roleOfColumn(m: ColumnMapping, j: number): ColumnRole | "" {
  return (COLUMN_ROLES.find((r) => m.columns[r] === j) ?? "") as ColumnRole | "";
}

function withRole(m: ColumnMapping, j: number, role: ColumnRole | ""): ColumnMapping {
  const columns: Partial<Record<ColumnRole, number>> = {};
  for (const r of COLUMN_ROLES) {
    const v = m.columns[r];
    if (v === undefined || v === j || r === role) continue;
    columns[r] = v;
  }
  if (role !== "") columns[role] = j;
  return { ...m, columns };
}

function MappingEditor({ out, onMapping, busy }: { out: ReadOk; onMapping: (m: ColumnMapping) => void; busy: boolean }) {
  const m = out.mapping;
  const cells = out.table.cells;
  const width = Math.min(20, Math.max(0, ...cells.slice(0, 60).map((r) => r.length)));
  const start = m.headerRow ?? 0;
  const shown = cells.slice(start, start + 9);
  return (
    <div class="st-map" data-statement-mapping>
      <div class="st-map-opts">
        <label>
          <span>見出しの行</span>
          <select value={m.headerRow === null ? "" : String(m.headerRow)} disabled={busy} onChange={(e) => onMapping({ ...m, headerRow: (e.currentTarget as HTMLSelectElement).value === "" ? null : Number((e.currentTarget as HTMLSelectElement).value) })}>
            <option value="">見出しなし</option>
            {cells.slice(0, 30).map((_, i) => (
              <option key={i} value={String(i)}>
                {i + 1}行目
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>金額の向き</span>
          <select value={m.sign} disabled={busy} onChange={(e) => onMapping({ ...m, sign: (e.currentTarget as HTMLSelectElement).value === "expenseNegative" ? "expenseNegative" : "expensePositive" })}>
            <option value="expensePositive">支払いが正の数（カードに多い）</option>
            <option value="expenseNegative">支払いが負の数（家計簿アプリに多い）</option>
          </select>
        </label>
      </div>
      <div class="st-map-scroll">
        <table class="st-map-t">
          <thead>
            <tr>
              {Array.from({ length: width }, (_, j) => {
                const r = roleOfColumn(m, j);
                return (
                  <th key={j} class={r !== "" ? "on" : ""}>
                    <select value={r} disabled={busy} aria-label={`${j + 1}列目の使い方`} onChange={(e) => onMapping(withRole(m, j, (e.currentTarget as HTMLSelectElement).value as ColumnRole | ""))} data-statement-col={j}>
                      <option value="">使わない</option>
                      {COLUMN_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={i} class={m.headerRow !== null && i === 0 ? "hd" : ""}>
                {Array.from({ length: width }, (_, j) => (
                  <td key={j} class={roleOfColumn(m, j) !== "" ? "on" : ""}>
                    {row[j] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="rp-note">表はカード番号・口座番号らしき数字を消した後のものです（●●●●）。元のファイルは保存しません。</p>
    </div>
  );
}

interface Reading {
  bytes: Uint8Array;
  account: string;
  kind: SourceKind;
  out: ReadOk;
  period: { from: string; to: string };
}

function ImportStep({ wh, log, office, host, onLog, onOffice, onNext, onAccounts }: { wh: WorkingHousehold; log: StatementLog; office: StatementOfficeData; host: StatementHost; onLog: (l: StatementLog) => void; onOffice: (o: StatementOfficeData) => void; onNext: () => void; onAccounts: () => void }) {
  const [account, setAccount] = useState<string | null>(log.accounts[0]?.id ?? null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [failed, setFailed] = useState<readonly Issue[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const acc = log.accounts.find((a) => a.id === account) ?? null;
  const accLabel = (id: string) => log.accounts.find((a) => a.id === id)?.label ?? "（外した口座）";
  void wh;

  const pick = async () => {
    if (acc === null) return;
    setMsg(null);
    setFailed(null);
    setBusy(true);
    try {
      const bytes = await host.open();
      if (bytes === null) return;
      const out = await readFile(bytes, acc.kind, office.formats);
      if (!out.ok) {
        setFailed(out.issues);
        setReading(null);
        return;
      }
      setReading({ bytes, account: acc.id, kind: acc.kind, out, period: rowsSpan(out) ?? { from: "", to: "" } });
      setShowMap(out.needsMapping);
    } catch (e) {
      setFailed([{ level: "error", code: "S_FORMAT_UNKNOWN", message: e === "E_IMPORT_TOO_LARGE" ? "ファイルが大きすぎます（10MBまで）。期間を分けて書き出してください" : `読み込めませんでした（${typeof e === "string" ? e : "E_STATEMENT_OPEN"}）` }]);
    } finally {
      setBusy(false);
    }
  };
  const remap = async (m: ColumnMapping) => {
    if (reading === null) return;
    setBusy(true);
    try {
      const out = await readFile(reading.bytes, reading.kind, office.formats, m);
      if (!out.ok) setFailed(out.issues);
      else setReading({ ...reading, out, period: rowsSpan(out) ?? reading.period });
    } finally {
      setBusy(false);
    }
  };
  const take = async () => {
    if (reading === null) return;
    const at = approvalTime();
    const r = addImport(log, reading.out, { id: newId(), account: reading.account, at, period: reading.period });
    if (!r.ok) {
      setMsg(r.reason === "duplicate" ? "このファイルはもう取り込んでいます（同じファイルは2回取り込みません）" : r.reason === "period" ? "期間を確かめてください" : "取り込める行がありません。列の対応付けを確かめてください");
      return;
    }
    onLog(r.log);
    setReading(null);
    setMsg(`「${accLabel(reading.account)}」に ${r.rows}行を取り込みました`);
    const f = formatToLearn(reading.out, reading.kind, at);
    if (f !== null) {
      try {
        onOffice(await host.learn([], [f]));
      } catch {
        setMsg(`「${accLabel(reading.account)}」に ${r.rows}行を取り込みました（列の対応付けは覚えられませんでした）`);
      }
    }
  };

  if (log.accounts.length === 0)
    return (
      <div class="st-step" data-statement-step="import">
        <p class="st-lead">先に、明細を取り込む口座・カードを登録してください。</p>
        <div class="rp-actions">
          <button type="button" class="btn primary" onClick={onAccounts}>
            口座・カードの登録へ
          </button>
        </div>
      </div>
    );
  const out = reading?.out;
  const pp = reading !== null ? periodProblem(reading.period) : null;
  return (
    <div class="st-step" data-statement-step="import">
      <p class="st-lead">口座・カードを選んでから、明細のファイル（CSV・TSV・文字の入った PDF）を選びます。読むのはこの PC の中だけで、外には送りません。</p>
      <div class="st-pick" role="radiogroup" aria-label="取り込む口座・カード">
        {log.accounts.map((a) => (
          <button type="button" role="radio" key={a.id} aria-checked={account === a.id} class={account === a.id ? "on" : ""} onClick={() => setAccount(a.id)} data-statement-pick={a.kind}>
            <span class={`st-kind k-${a.kind}`}>{KIND_LABELS[a.kind]}</span>
            {a.label}
          </button>
        ))}
      </div>
      <div class="rp-actions">
        <button type="button" class="btn primary" disabled={busy || acc === null} onClick={() => void pick()} data-statement-open>
          {busy && reading === null ? "読んでいます…" : "明細のファイルを選ぶ"}
        </button>
      </div>
      {msg !== null ? (
        <p class="hs-msg st-msg" role="status" data-statement-msg>
          {msg}
        </p>
      ) : null}
      {failed !== null ? (
        <div class="st-failed" role="alert">
          <b>読めませんでした</b>
          <IssueList issues={failed} />
        </div>
      ) : null}
      {reading !== null && out !== undefined ? (
        <section class="st-read" aria-label="読んだ明細" data-statement-read>
          <h3 class="st-h3">
            「{accLabel(reading.account)}」の明細を読みました
            <small>
              {out.reader.id === "pdfText" ? "PDF" : "CSV"}・{out.rows.length}行{out.skipped > 0 ? `（読み飛ばした行 ${out.skipped}）` : ""}
            </small>
          </h3>
          <p class={`rp-note${out.needsMapping ? " warn" : ""}`}>{SOURCE_TEXT[out.mappingSource]}</p>
          <IssueList issues={out.issues} info />
          {showMap ? (
            <MappingEditor out={out} busy={busy} onMapping={(m) => void remap(m)} />
          ) : (
            <button type="button" class="btn sm" onClick={() => setShowMap(true)} data-statement-show-mapping>
              列の対応付けを見る・選び直す
            </button>
          )}
          <div class="st-period">
            <span class="st-period-h">明細の期間</span>
            <input type="date" value={reading.period.from} onInput={(e) => setReading({ ...reading, period: { ...reading.period, from: (e.currentTarget as HTMLInputElement).value } })} aria-label="期間の始め" data-statement-from />
            〜
            <input type="date" value={reading.period.to} onInput={(e) => setReading({ ...reading, period: { ...reading.period, to: (e.currentTarget as HTMLInputElement).value } })} aria-label="期間の終わり" data-statement-to />
            <small>使った日の最初と最後から入れています。12か月分の明細なら、明細の初日・末日に直すと月平均が正しくなります。</small>
          </div>
          {pp !== null ? <p class="fatal">{pp}</p> : null}
          <div class="rp-actions">
            <button type="button" class="btn primary" disabled={busy || out.rows.length === 0 || pp !== null} onClick={() => void take()} data-statement-take>
              取り込む（{out.rows.length}行）
            </button>
            <button type="button" class="btn" onClick={() => setReading(null)}>
              やめる
            </button>
          </div>
        </section>
      ) : null}
      {log.imports.length > 0 ? (
        <>
          <h3 class="st-h3">取り込んだ明細</h3>
          <table class="st-imports">
            <thead>
              <tr>
                <th>口座・カード</th>
                <th>期間</th>
                <th>行</th>
                <th>仕分けに使う</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {log.imports.map((i) => (
                <tr key={i.id} class={i.include ? "" : "off"} data-statement-import>
                  <td>{accLabel(i.account)}</td>
                  <td class="st-imp-period">
                    <input type="date" value={i.period.from} aria-label="期間の始め" onChange={(e) => onLog(setPeriod(log, i.id, { from: (e.currentTarget as HTMLInputElement).value, to: i.period.to }))} />
                    〜
                    <input type="date" value={i.period.to} aria-label="期間の終わり" onChange={(e) => onLog(setPeriod(log, i.id, { from: i.period.from, to: (e.currentTarget as HTMLInputElement).value }))} />
                  </td>
                  <td class="num">{i.rows.length}</td>
                  <td>
                    <input type="checkbox" checked={i.include} aria-label="仕分けに使う" onChange={(e) => onLog(setInclude(log, i.id, (e.currentTarget as HTMLInputElement).checked))} />
                  </td>
                  <td>
                    {removing === i.id ? (
                      <>
                        <button type="button" class="btn sm danger" onClick={() => onLog(removeImport(log, i.id))}>
                          外す
                        </button>
                        <button type="button" class="btn sm" onClick={() => setRemoving(null)}>
                          やめる
                        </button>
                      </>
                    ) : (
                      <button type="button" class="btn sm" onClick={() => setRemoving(i.id)}>
                        外す
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div class="rp-actions st-next">
            <button type="button" class="btn primary" onClick={onNext} data-statement-next>
              ヒアリングへ
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---- 3 ヒアリング ----

function CategoryButtons({ current, onPick, compact = false }: { current: StatementCategory | null; onPick: (c: StatementCategory) => void; compact?: boolean }) {
  const [more, setMore] = useState(false);
  const groups = compact && !more ? CATEGORY_GROUPS.slice(0, 1) : CATEGORY_GROUPS;
  return (
    <div class="st-cats">
      {groups.map((g) => (
        <div key={g.label} class="st-cat-g" role="group" aria-label={g.label}>
          {CATEGORY_GROUPS.length > 1 && (!compact || more) ? <small>{g.label}</small> : null}
          {g.ids.map((id) => (
            <button type="button" key={id} class={current === id ? "on" : ""} aria-pressed={current === id} onClick={() => onPick(id)} data-statement-cat={id}>
              {categoryShort(id)}
            </button>
          ))}
        </div>
      ))}
      {compact ? (
        <button type="button" class="st-more" onClick={() => setMore(!more)} aria-expanded={more}>
          {more ? "▲ 基本生活費だけにする" : "▼ ほかの項目（住居・車・一時的な支出など）"}
        </button>
      ) : null}
    </div>
  );
}

function ReviewCard({ item, label, owners, onDecide }: { item: ReviewItem; label: string; owners: { value: string; label: string }[]; onDecide: (d: { category?: StatementCategory | null; bucket?: Bucket; share?: string; owner?: string | null }) => void }) {
  const [askShare, setAskShare] = useState(false);
  const [custom, setCustom] = useState("");
  const [catOpen, setCatOpen] = useState(item.category === null);
  const cs = shareOfPercent(Number(custom));
  return (
    <li class="st-item" data-statement-review={item.reasons[0]}>
      <div class="st-item-h">
        <span class="st-date">{dateText(item.date)}</span>
        <b class="st-merchant">{item.merchant}</b>
        <span class="st-amt">{yen(item.amount)}</span>
      </div>
      <div class="st-item-meta">
        <span>{label}</span>
        <label class="st-owner">
          持ち主
          <select value={item.owner ?? ""} onChange={(e) => onDecide({ owner: (e.currentTarget as HTMLSelectElement).value || null })}>
            <option value="">明細の持ち主のまま</option>
            {owners.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <span class="st-reason">{item.reasonText}</span>
      </div>
      <div class="st-item-cat">
        <span>項目: </span>
        <button type="button" class="st-catnow" onClick={() => setCatOpen(!catOpen)} aria-expanded={catOpen}>
          {item.category === null ? "分からない（選ぶ）" : categoryShort(item.category)} {catOpen ? "▲" : "▼"}
        </button>
      </div>
      {catOpen ? (
        <CategoryButtons
          compact
          current={item.category}
          onPick={(c) => {
            onDecide({ category: c });
            setCatOpen(false);
          }}
        />
      ) : null}
      <div class="st-buckets" role="group" aria-label="どこに入れるか">
        {item.allowed.map((b) => (
          <button
            type="button"
            key={b}
            class={`b-${b}${item.bucket === b ? " now" : ""}`}
            onClick={() => {
              if (b === "business") setAskShare(true);
              else onDecide({ bucket: b });
            }}
            data-statement-bucket={b}
          >
            {BUCKET_BUTTONS[b]}
          </button>
        ))}
      </div>
      {askShare ? (
        <div class="st-share" role="group" aria-label="事業で使った割合">
          <span>事業で使った割合</span>
          {SHARE_CHOICES.map((p) => (
            <button type="button" key={p} onClick={() => onDecide({ bucket: "business", share: shareOfPercent(p) ?? "1" })} data-statement-share={p}>
              {p}%
            </button>
          ))}
          <label>
            <input type="number" min={1} max={100} value={custom} onInput={(e) => setCustom((e.currentTarget as HTMLInputElement).value)} aria-label="割合（％）" />%
          </label>
          <button type="button" class="btn sm" disabled={cs === null} onClick={() => cs !== null && onDecide({ bucket: "business", share: cs })}>
            決める
          </button>
        </div>
      ) : null}
    </li>
  );
}

// ---- 3 の中: 確認シート（前もってお客さまに印を付けてもらう表計算のファイル） ----

function SheetSection({ wh, log, an, office, host, customerNo, onLog, onLearn }: { wh: WorkingHousehold; log: StatementLog; an: Analysis; office: StatementOfficeData; host: StatementHost; customerNo?: string; onLog: (l: StatementLog) => void; onLearn: (e: ReturnType<typeof decide>["learn"]) => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<SaveOutcome | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [read, setRead] = useState<SheetRead | null>(null);
  const [failed, setFailed] = useState<readonly Issue[] | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const rest = an.review.length;
  const plan = useMemo(() => sheetPlan(an), [an]);
  const requests = log.requests ?? [];
  const write = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const at = approvalTime();
      const r = await exportMarkSheet(wh, an, { random: randomBytes(), at, appVersion: APP_VERSION, ...(customerNo !== undefined ? { customerNo } : {}) });
      const out = await host.saveSheet(r.bytes, { customerNo: customerNo ?? "", exportedOn: at.slice(0, 10) });
      setSaved(out);
      // 依頼の記録は保存したときだけ残す（取り込むときに、これを正にして読む）
      if (out.saved) onLog(withSheetRequest(log, r.request));
      setAsking(false);
    } catch (e) {
      setErr(typeof e === "string" ? e : e instanceof Error ? e.message : "E_STATEMENT_SHEET_EXPORT");
    } finally {
      setBusy(false);
    }
  };
  const open = async () => {
    setBusy(true);
    setFailed(null);
    setMsg(null);
    setSaved(null);
    try {
      const bytes = await host.openSheet();
      if (bytes === null) return;
      const r = await readSheet(bytes, wh, an);
      if (!r.ok) {
        setFailed(r.issues);
        setRead(null);
        return;
      }
      setRead(r);
      setSel(defaultMarkSelection(r.candidates));
    } catch (e) {
      setFailed([{ level: "error", code: "S_SHEET_FILE", message: e === "E_IMPORT_TOO_LARGE" ? "ファイルが大きすぎます（10MBまで）" : `読み込めませんでした（${typeof e === "string" ? e : "E_STATEMENT_SHEET_OPEN"}）` }]);
    } finally {
      setBusy(false);
    }
  };
  const take = () => {
    if (read === null) return;
    const r = approveMarks(log, read, sel, office.dictionary, approvalTime());
    onLog(r.log);
    if (r.learn.length > 0) onLearn(r.learn);
    setMsg(`お客さまの印 ${r.lines}行${r.decided !== r.lines ? `（明細の ${r.decided}行）` : ""}を仕分けに入れました${read.unmarked > 0 ? `（印の無い ${read.unmarked}行は迷う行のまま残っています）` : ""}`);
    setRead(null);
  };
  const toggle = (no: number, on: boolean) =>
    setSel((x) => {
      const n = new Set(x);
      if (on) n.add(no);
      else n.delete(no);
      return n;
    });
  return (
    <section class="st-sec st-sheet" aria-label="確認シート" data-statement-sheet>
      <h3 class="st-h3">
        確認シート（お客さまに前もって印を付けてもらう）<small>迷う行を表計算のファイル（.xlsx）に書き出し、お客さまが選んだ印を読み込みます。読み込んだ印は、ここで確かめてから入れます</small>
      </h3>
      <div class="rp-actions">
        <button type="button" class="btn" disabled={busy || rest === 0} onClick={() => setAsking(true)} data-statement-sheet-export>
          確認シートを書き出す（{plan.lines.length}行）
        </button>
        <button type="button" class="btn" disabled={busy || requests.length === 0} onClick={() => void open()} data-statement-sheet-open>
          {busy && !asking ? "読んでいます…" : "印の付いたシートを読み込む"}
        </button>
      </div>
      {asking ? (
        <div class="st-sheet-ask" role="alert" data-statement-sheet-warn>
          <IssueList issues={markSheetWarnings(plan)} info />
          <p class="rp-note">シートには、使った日・店の名前・金額・カード／口座の呼び名・お使いになった方と、選ぶ欄（何に使ったか・どこに入るか・事業の割合・メモ）だけが載ります。お名前・世帯の番号は載りません。辞書で分からない店・区分だけが迷う店・カードの引き落としは、同じ持ち主・同じカード／口座の同じ店を1行にまとめ（期間・回数・合計を載せます）、答えをその店の行すべてに当てます。高額の行などは1行ずつ載せます。</p>
          <div class="rp-actions">
            <button type="button" class="btn primary" disabled={busy} onClick={() => void write()} data-statement-sheet-go>
              {busy ? "作っています…" : "分かったうえで書き出す"}
            </button>
            <button type="button" class="btn" onClick={() => setAsking(false)}>
              やめる
            </button>
          </div>
        </div>
      ) : null}
      {err !== null ? <p class="fatal">書き出せませんでした（{err}）</p> : null}
      {saved !== null ? (
        <p class={`rp-note${saved.syncFolder ? " warn" : ""}`} role="status" data-statement-sheet-saved={saved.saved ? "1" : "0"}>
          {saved.saved ? `「${saved.fileName ?? ""}」を保存しました。${saved.syncFolder ? "同期フォルダの中です。" : ""}お客さまに送ってください。返ってきたら「印の付いたシートを読み込む」から読みます。` : "保存しませんでした。"}
        </p>
      ) : null}
      {msg !== null ? (
        <p class="hs-msg st-msg" role="status" data-statement-sheet-msg>
          {msg}
        </p>
      ) : null}
      {failed !== null ? (
        <div class="st-failed" role="alert" data-statement-sheet-failed>
          <b>読み込めませんでした</b>
          <IssueList issues={failed} />
        </div>
      ) : null}
      {requests.length > 0 ? (
        <ul class="hs-list st-requests">
          {[...requests].reverse().map((r) => (
            <li key={r.id}>
              {r.id}: {dateText(r.at.slice(0, 10))} に {requestSize(r).lines}行{requestSize(r).rows !== requestSize(r).lines ? `（明細の ${requestSize(r).rows}行）` : ""}を書き出し
              {r.received.length > 0 ? `・${dateText((r.received.at(-1)?.at ?? "").slice(0, 10))} に取り込み（${r.received.at(-1)?.decided ?? 0}行）` : "・まだ返っていません"}
            </li>
          ))}
        </ul>
      ) : null}
      {read !== null ? (
        <div class="st-marks" data-statement-marks>
          <h3 class="st-h3">
            お客さまの印（依頼 {read.request.id}）<small>チェックした行だけを仕分けに入れます。要確認の行は、理由を見てからチェックしてください</small>
          </h3>
          <IssueList issues={read.issues} />
          {read.candidates.length > 0 ? (
            <table class="st-decided st-marks-t">
              <thead>
                <tr>
                  <th />
                  <th>番号</th>
                  <th>使った日（まとめた店は期間・回数）</th>
                  <th>店</th>
                  <th class="num">金額</th>
                  <th>お客さまの印</th>
                  <th>メモ・確かめること</th>
                </tr>
              </thead>
              <tbody>
                {read.candidates.map((c) => (
                  <tr key={c.no} class={c.status === "needsReview" ? "attn" : ""} data-statement-mark={c.status}>
                    <td>
                      <input type="checkbox" checked={sel.has(c.no)} aria-label={`${c.no}番を入れる`} onChange={(e) => toggle(c.no, (e.currentTarget as HTMLInputElement).checked)} />
                    </td>
                    <td class="num">{c.no}</td>
                    <td>{markDateText(c)}</td>
                    <td>
                      {c.merchant}
                      {c.kind === "shop" ? <small class="st-note">同じ店の {c.count}行にまとめて入れます</small> : null}
                    </td>
                    <td class="num">{c.kind === "shop" ? `合計 ${yen(c.amount)}` : yen(c.amount)}</td>
                    <td>
                      <b>{markText(c)}</b>
                      {c.status === "needsReview" ? <span class="hs-kind review">要確認</span> : null}
                    </td>
                    <td>
                      {c.memo !== undefined ? <span class="st-memo">「{c.memo}」</span> : null}
                      {c.notes.map((n, i) => (
                        <small key={i} class="st-note">
                          {n}
                        </small>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p class="rp-note">印の付いた行はありませんでした。</p>
          )}
          {read.memos.length > 0 ? (
            <>
              <h3 class="st-h3">メモだけの行（迷う行のまま）</h3>
              <ul class="hs-list">
                {read.memos.map((m) => (
                  <li key={m.no}>
                    {m.no}番 {markDateText(m)} {m.merchant} {m.kind === "shop" ? `合計 ${yen(m.amount)}` : yen(m.amount)}: 「{m.memo}」
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <p class="rp-note">メモは画面に出すだけで、保存しません。印の無い明細の行（{read.unmarked}行）は迷う行のまま残ります。同じ店をまとめた行の印は、書き出したときのその店の行すべてに入ります（書き出した後に取り込んだ行には入りません）。</p>
          <div class="rp-actions">
            <button type="button" class="btn primary" disabled={sel.size === 0} onClick={take} data-statement-marks-approve>
              承認して仕分けに入れる（{sel.size}行）
            </button>
            <button type="button" class="btn" onClick={() => setRead(null)}>
              やめる
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ReviewStep({ wh, log, an, office, host, customerNo, onLog, onLearn, onNext }: { wh: WorkingHousehold; log: StatementLog; an: Analysis; office: StatementOfficeData; host: StatementHost; customerNo?: string; onLog: (l: StatementLog) => void; onLearn: (e: ReturnType<typeof decide>["learn"]) => void; onNext: () => void }) {
  const [asRule, setAsRule] = useState(false);
  const [showDecided, setShowDecided] = useState(false);
  const [rule, setRule] = useState<{ category: StatementCategory; owner: string; bucket: Bucket; share: string }>({ category: "communication", owner: "", bucket: "business", share: "50" });
  const owners = ownerOptions(wh);
  const ownerName = new Map(owners.map((o) => [o.value, o.label]));
  const accounts = new Map(log.accounts.map((a) => [a.id, a]));
  const others = otherReview(an.review);
  const decided = decidedRows(an.rows);
  const styles = styleRows(wh);
  const rest = an.review.length;
  const apply = (decisions: Parameters<typeof decide>[1], extra?: (l: StatementLog) => StatementLog) => {
    const at = approvalTime();
    const r = decide(log, decisions, office.dictionary, at);
    onLog(extra !== undefined ? extra(r.log) : r.log);
    if (r.learn.length > 0) onLearn(r.learn);
  };
  const itemLabel = (it: ReviewItem) => {
    const a = accounts.get(it.account);
    return `${a?.label ?? ""}${it.owner !== null ? `・${ownerName.get(it.owner) ?? ""}` : ""}`;
  };
  const allBuckets: Bucket[] = ["reimbursable", "business", "company", "oneOff", "excluded", "household"];
  const ruleShare = shareOfPercent(Number(rule.share));
  return (
    <div class="st-step" data-statement-step="review">
      <div class={`st-progress${rest === 0 ? " done" : ""}`} role="status" data-statement-rest={rest}>
        {rest === 0 ? "迷う行はありません。「生活費の候補」で数を確かめてください" : `迷う行 あと ${rest}行`}
        <small>（取り込んだ行 {an.rows.length}・決めた行 {decided.length}）</small>
      </div>

      <SheetSection wh={wh} log={log} an={an} office={office} host={host} {...(customerNo !== undefined ? { customerNo } : {})} onLog={onLog} onLearn={onLearn} />

      <section class="st-sec" aria-label="働き方">
        <h3 class="st-h3">
          働き方<small>持ち主の働き方で、選べる区分が変わります（副業のときは2つ選びます）</small>
        </h3>
        <ul class="st-styles">
          {styles.map((s) => (
            <li key={s.member} data-statement-style={s.member}>
              <b>{s.label}</b>
              <span class="st-chips" role="group" aria-label={`${s.label}の働き方`}>
                {STYLE_CHOICES.map((st) => {
                  const on = s.styles.includes(st);
                  return (
                    <button
                      type="button"
                      key={st}
                      class={on ? "on" : ""}
                      aria-pressed={on}
                      onClick={() => {
                        const cur = s.styles.filter((x) => x !== "none");
                        onLog(setStyles(log, s.member, on ? cur.filter((x) => x !== st) : [...cur, st]));
                      }}
                      data-statement-style-pick={st}
                    >
                      {WORK_STYLE_LABELS[st]}
                    </button>
                  );
                })}
              </span>
              <small>
                選べる区分: {s.buckets.map((b) => BUCKET_BUTTONS[b]).join("・")}
                {s.chosen ? (
                  <>
                    （働き方の期間では {s.fromPeriods.map((x) => WORK_STYLE_LABELS[x]).join("・")}）{" "}
                    <button type="button" class="st-link" onClick={() => onLog(setStyles(log, s.member, null))}>
                      働き方の期間に戻す
                    </button>
                  </>
                ) : null}
              </small>
            </li>
          ))}
        </ul>
      </section>

      {an.unknown.length > 0 ? (
        <section class="st-sec" aria-label="辞書で分からない店">
          <h3 class="st-h3">
            辞書で分からない店（{an.unknown.length}店）<small>項目を選ぶと、同じ店の行にまとめて入り、事務所の辞書が覚えます（店の名前と項目だけ）</small>
          </h3>
          <ul class="st-items">
            {an.unknown.map((u) => (
              <li key={u.key} class="st-item" data-statement-unknown>
                <div class="st-item-h">
                  <b class="st-merchant">{u.label}</b>
                  <span class="st-amt">
                    {u.count}回・{u.count > 1 ? `${dateText(u.from)}〜${dateText(u.to)}・合計 ` : `${dateText(u.from)}・`}
                    {yen(u.total)}
                  </span>
                </div>
                <CategoryButtons compact current={null} onPick={(c) => apply(u.rows.map((r) => ({ importId: r.importId, rowId: r.rowId, category: c })))} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {others.length > 0 ? (
        <section class="st-sec" aria-label="迷う行">
          <h3 class="st-h3">
            迷う行（{others.length}行）<small>どこに入れるかをボタンで決めます</small>
          </h3>
          <label class="hs-check st-asrule">
            <input type="checkbox" checked={asRule} onChange={(e) => setAsRule((e.currentTarget as HTMLInputElement).checked)} data-statement-asrule />
            決めた区分を、同じ店の世帯の決まりにする（この世帯の同じ店の行にも当てる）
          </label>
          <ul class="st-items">
            {others.map((it) => (
              <ReviewCard
                key={`${it.importId}:${it.rowId}`}
                item={it}
                label={itemLabel(it)}
                owners={owners}
                onDecide={(d) =>
                  apply([{ importId: it.importId, rowId: it.rowId, ...d }], asRule && d.bucket !== undefined ? (l) => putRule(l, { match: { key: it.key }, ...(it.owner !== null ? { owner: it.owner } : {}), bucket: d.bucket as Bucket, ...(d.share !== undefined ? { share: d.share } : {}) }, newId(), approvalTime()) : undefined)
                }
              />
            ))}
          </ul>
        </section>
      ) : null}

      <section class="st-sec" aria-label="世帯の決まり">
        <h3 class="st-h3">
          世帯の決まり<small>「通信の半分は事業」のような、この世帯だけの決まり（事務所の辞書には入れません）</small>
        </h3>
        {log.rules.length > 0 ? (
          <ul class="st-rules">
            {log.rules.map((r) => (
              <li key={r.id}>
                {"key" in r.match ? `店「${r.match.key}」` : `項目「${categoryShort(r.match.category)}」`} → {BUCKET_BUTTONS[r.bucket]}
                {r.bucket === "business" && r.share !== undefined ? ` ${percentText(r.share)}` : ""}
                {r.owner !== undefined ? `（${ownerName.get(r.owner) ?? ""}の行）` : ""}
                <button type="button" class="btn sm" onClick={() => onLog(removeRule(log, r.id))}>
                  外す
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div class="st-rule-form">
          <select value={rule.category} aria-label="項目" onChange={(e) => setRule({ ...rule, category: (e.currentTarget as HTMLSelectElement).value as StatementCategory })}>
            {CATEGORY_GROUPS.flatMap((g) => g.ids).map((id) => (
              <option key={id} value={id}>
                {categoryShort(id)}
              </option>
            ))}
          </select>
          <select value={rule.owner} aria-label="持ち主" onChange={(e) => setRule({ ...rule, owner: (e.currentTarget as HTMLSelectElement).value })}>
            <option value="">全員の行</option>
            {owners.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}の行
              </option>
            ))}
          </select>
          →
          <select value={rule.bucket} aria-label="区分" onChange={(e) => setRule({ ...rule, bucket: (e.currentTarget as HTMLSelectElement).value as Bucket })}>
            {allBuckets.map((b) => (
              <option key={b} value={b}>
                {BUCKET_BUTTONS[b]}
              </option>
            ))}
          </select>
          {rule.bucket === "business" ? (
            <label>
              <input type="number" min={1} max={100} value={rule.share} aria-label="割合（％）" onInput={(e) => setRule({ ...rule, share: (e.currentTarget as HTMLInputElement).value })} />%
            </label>
          ) : null}
          <button
            type="button"
            class="btn sm"
            disabled={rule.bucket === "business" && ruleShare === null}
            onClick={() => onLog(putRule(log, { match: { category: rule.category }, ...(rule.owner !== "" ? { owner: rule.owner } : {}), bucket: rule.bucket, ...(rule.bucket === "business" && ruleShare !== null ? { share: ruleShare } : {}) }, newId(), approvalTime()))}
            data-statement-rule-add
          >
            決まりを足す
          </button>
        </div>
        <p class="rp-note">持ち主の働き方で選べない区分の決まりは当てません（会社員の行に「事業の経費」など）。</p>
      </section>

      {decided.length > 0 ? (
        <section class="st-sec" aria-label="決めた行">
          <button type="button" class="st-more" onClick={() => setShowDecided(!showDecided)} aria-expanded={showDecided}>
            {showDecided ? "▲" : "▼"} 決めた行（{decided.length}行）
          </button>
          {showDecided ? (
            <table class="st-decided">
              <tbody>
                {decided.map((r) => (
                  <tr key={`${r.importId}:${r.row.id}`}>
                    <td>{dateText(r.row.date)}</td>
                    <td>{r.row.merchant}</td>
                    <td class="num">{yen(r.row.amount)}</td>
                    <td>{r.category === null ? "分からない" : categoryShort(r.category)}</td>
                    <td>
                      {BUCKET_BUTTONS[r.bucket]}
                      {r.share !== undefined ? ` ${percentText(r.share)}` : ""}
                    </td>
                    <td>
                      <button type="button" class="btn sm" onClick={() => apply([{ importId: r.importId, rowId: r.row.id, category: null, bucket: null, share: null, owner: null }])}>
                        取り消す
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      ) : null}
      <div class="rp-actions st-next">
        <button type="button" class="btn primary" onClick={onNext} data-statement-next>
          生活費の候補へ
        </button>
      </div>
    </div>
  );
}

// ---- 4 生活費の候補 ----

function ResultStep({ wh, log, an, onApprove }: { wh: WorkingHousehold; log: StatementLog; an: Analysis; onApprove: (next: WorkingHousehold, n: number) => void }) {
  const s = an.summary;
  const ref = useMemo(() => newId(), [s]);
  const list = useMemo(() => candidatesOf(wh, s, ref, newId), [wh, s, ref]);
  const [sel, setSel] = useState<Set<string>>(() => defaultCandidateSelection(list));
  useEffect(() => setSel(defaultCandidateSelection(list)), [list]);
  const owners = new Map(ownerOptions(wh).map((o) => [o.value, o.label]));
  const accounts = new Map(log.accounts.map((a) => [a.id, a.label]));
  const max = Math.max(1, ...s.living.map((l) => l.monthly));
  const toggle = (c: StatementCandidate, on: boolean) =>
    setSel((x) => {
      const n = new Set(x);
      if (on) n.add(c.id);
      else n.delete(c.id);
      return n;
    });
  if (s.days === 0)
    return (
      <div class="st-step" data-statement-step="result">
        <IssueList issues={s.notices} />
        <p class="st-lead">明細を取り込むと、ここに月平均と生活費の候補が出ます。</p>
      </div>
    );
  return (
    <div class="st-step" data-statement-step="result">
      <IssueList issues={s.notices} />
      <div class="st-basis">
        期間 {dateText(s.from ?? "")}〜{dateText(s.to ?? "")}（{s.months}か月）
        <small>{s.coverage.map((c) => `${accounts.get(c.account) ?? ""} ${(c.days / 30.44).toFixed(1)}か月`).join("・")}・口座ごとの期間で割ってから足しています（使った日で数えます）</small>
      </div>
      <div class="st-result">
        <section class="st-living" aria-label="基本生活費の月平均" data-statement-living>
          <h3 class="st-h3">基本生活費の月平均</h3>
          <div class="st-total">
            月 <b>{s.livingTotal.toLocaleString("ja-JP")}</b>円
          </div>
          <ul class="st-bars">
            {s.living.map((l) => (
              <li key={l.category}>
                <span class="nm">{LIVING_LABELS[l.category]}</span>
                <span class="bar" aria-hidden="true">
                  <i style={{ width: `${Math.round((l.monthly / max) * 100)}%` }} />
                </span>
                <span class="v">{yen(l.monthly)}</span>
                <small>{l.detail.map((d) => `${d.category === "unknown" ? "分からない店" : categoryShort(d.category)} ${d.monthly.toLocaleString("ja-JP")}`).join("・")}</small>
              </li>
            ))}
          </ul>
          {s.unknownMonthly !== 0 ? <p class="rp-note warn">分からない店の月平均 {yen(s.unknownMonthly)} を「その他」に入れています（ヒアリングで決めると移ります）。</p> : null}
        </section>
        <section class="st-side" aria-label="参考の値">
          <h3 class="st-h3">参考（それぞれの入力の欄で入れます）</h3>
          <dl class="st-ref">
            {(
              [
                ["housing", "住居関連"],
                ["education", "教育"],
                ["insurance", "保険"],
                ["car", "車"],
                ["tax", "税・社会保険料（計算で出す分は除く）"],
              ] as const
            )
              .filter(([k]) => s.reference[k] !== 0)
              .map(([k, label]) => (
                <div key={k}>
                  <dt>{label}</dt>
                  <dd>月 {yen(s.reference[k])}</dd>
                </div>
              ))}
            {s.outside.map((o, i) => (
              <div key={`o${i}`}>
                <dt>
                  家計から外した{BUCKET_BUTTONS[o.bucket]}
                  {o.owner !== null ? `（${owners.get(o.owner) ?? ""}）` : ""}
                </dt>
                <dd>月 {yen(o.monthly)}</dd>
              </div>
            ))}
          </dl>
          {s.oneOffs.length > 0 ? (
            <>
              <h3 class="st-h3">一時的な支出</h3>
              <ul class="st-oneoffs" data-statement-oneoffs>
                {s.oneOffs.slice(0, 12).map((o) => (
                  <li key={o.durable === true ? `durable/${o.key}` : o.key}>
                    <span class="nm">{o.label}</span>
                    <span class="v">{yen(o.amount)}</span>
                    <small>
                      {o.durable === true ? "家電・家具の買い替えの候補・" : ""}
                      {o.annual !== undefined ? (o.annual.confidence === "low" ? "年1回かは分からない" : o.annual.everyYears === 2 ? "2年に1回" : "年1回") : `${o.occurrences.length}回`}
                      {o.annual !== undefined && o.annual.confidence !== "low" ? `（確かさ ${o.annual.confidence === "high" ? "高" : "中"}）` : ""}・年 {yen(o.perYear)}
                    </small>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      </div>
      <section class="st-sec st-cands" aria-label="生活費の候補" data-statement-candidates>
        <h3 class="st-h3">
          入力に入れる候補<small>チェックした候補だけを現状に入れます（推定の値として。入れるまでは計算に使いません）</small>
        </h3>
        {list.length === 0 ? <p class="rp-note">入れる候補はありません。</p> : null}
        {list.map((c) => (
          <label key={c.id} class={`hs-cand st-cand${c.status === "needsReview" ? " attn" : ""}`} data-statement-candidate={c.collection}>
            <span class="hs-cand-h">
              <input type="checkbox" checked={sel.has(c.id)} onChange={(e) => toggle(c, (e.currentTarget as HTMLInputElement).checked)} />
              <span class={`hs-kind ${c.op === "add" ? "new" : ""}`}>{c.op === "add" ? "新規" : "変更"}</span>
              <b>{c.title}</b>
              {c.status === "needsReview" ? <span class="hs-kind review">要確認</span> : null}
            </span>
            {beforeText(c) !== null ? <span class="st-before">{beforeText(c)}</span> : null}
            {c.note !== null ? <span class="rp-note">{c.note}</span> : null}
          </label>
        ))}
        <div class="rp-actions">
          <button type="button" class="btn primary" disabled={sel.size === 0} onClick={() => onApprove(approve(wh, list, sel, s, ref, approvalTime()), sel.size)} data-statement-approve>
            承認して現状に入れる（{sel.size}件）
          </button>
        </div>
      </section>
      {log.applied.length > 0 ? (
        <section class="st-sec" aria-label="取り込んだ記録">
          <h3 class="st-h3">取り込んだ記録</h3>
          <ul class="hs-list">
            {log.applied.map((a) => (
              <li key={a.id}>
                {a.at.slice(0, 16).replace("T", " ")} に {a.items.length}件を入れました（{dateText(a.basis.from)}〜{dateText(a.basis.to)}、{a.basis.months}か月の明細から）
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

// ---- パネル ----

export function StatementPanel({ wh, host, onLog, onApprove, onApproved, onClose, initialStep, customerNo }: PanelProps) {
  const log = logOf(wh);
  const [step, setStep] = useState<Step>(initialStep ?? (log.accounts.length === 0 ? "accounts" : log.imports.length === 0 ? "import" : "review"));
  const [office, setOffice] = useState<StatementOfficeData | null>(null);
  const [officeErr, setOfficeErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    host.office().then(
      (o) => live && setOffice(o),
      (e: unknown) => {
        if (!live) return;
        // 事務所データを読めなくても、同梱の辞書だけで仕分けられる（覚える操作は止める）
        setOffice({ dictionary: [], formats: [] });
        setOfficeErr(typeof e === "string" ? e : "E_STATEMENT_OFFICE");
      },
    );
    return () => {
      live = false;
    };
  }, [host]);
  const an = useMemo(() => (office === null ? null : analyze(wh, office.dictionary)), [wh, office]);
  const learn = (entries: ReturnType<typeof decide>["learn"]) => {
    if (officeErr !== null) return;
    host.learn(entries, []).then(setOffice, () => setMsg("事務所の辞書に覚えられませんでした（この世帯の決めたことは残っています）"));
  };
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>(".st-steps button.on")?.focus({ preventScroll: true });
    document.documentElement.classList.add("panel-open");
    return () => document.documentElement.classList.remove("panel-open");
  }, []);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    panel.current?.querySelector(".ip-body")?.scrollTo({ top: 0 });
  }, [step]);
  const count: Record<Step, string> = {
    accounts: String(log.accounts.length),
    import: String(log.imports.length),
    review: an === null ? "" : String(an.review.length),
    result: "",
  };
  return (
    <>
      <div class="scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        class="ipanel wide st-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="st-title"
        data-statement-panel
        onKeyDown={(e) => {
          if (e.key !== "Tab" || panel.current === null) return;
          const els = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
          const first = els[0];
          const last = els.at(-1);
          if (first === undefined || last === undefined) return;
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <div class="ip-band" aria-hidden="true" />
        <div class="ip-head st-head">
          <h2 id="st-title">明細から生活費を出す</h2>
          <nav class="st-steps" aria-label="手順">
            {STEPS.map((s, i) => (
              <button type="button" key={s.id} class={step === s.id ? "on" : ""} aria-current={step === s.id ? "step" : undefined} onClick={() => setStep(s.id)} data-statement-tab={s.id}>
                <span class="no">{i + 1}</span>
                {s.label}
                {count[s.id] !== "" && count[s.id] !== "0" ? <span class={`ct${s.id === "review" ? " attn" : ""}`}>{count[s.id]}</span> : null}
              </button>
            ))}
          </nav>
          <button type="button" class="x-btn" aria-label="閉じる（Esc）" title="閉じる（Esc）" onClick={onClose}>
            ×
          </button>
        </div>
        <div class="ip-body">
          {officeErr !== null ? <p class="rp-note warn">事務所で覚えた辞書と形を読めませんでした（{officeErr}）。同梱の辞書だけで仕分けます。</p> : null}
          {msg !== null ? (
            <p class="hs-msg st-msg" role="status">
              {msg}
            </p>
          ) : null}
          {office === null || an === null ? (
            <p class="rp-note">読み込んでいます…</p>
          ) : step === "accounts" ? (
            <AccountsStep wh={wh} log={log} onLog={onLog} onNext={() => setStep("import")} />
          ) : step === "import" ? (
            <ImportStep wh={wh} log={log} office={office} host={host} onLog={onLog} onOffice={setOffice} onNext={() => setStep("review")} onAccounts={() => setStep("accounts")} />
          ) : step === "review" ? (
            <ReviewStep wh={wh} log={log} an={an} office={office} host={host} {...(customerNo !== undefined ? { customerNo } : {})} onLog={onLog} onLearn={learn} onNext={() => setStep("result")} />
          ) : (
            <ResultStep
              wh={wh}
              log={log}
              an={an}
              onApprove={(next, n) => {
                onApprove(next);
                if (onApproved !== undefined) {
                  onApproved(n);
                  return;
                }
                setMsg(`${n}件を現状に入れました。入力の「基本生活費」などで確かめられます`);
                panel.current?.querySelector(".ip-body")?.scrollTo({ top: 0 });
              }}
            />
          )}
        </div>
        <div class="ip-foot">
          <p class="ip-note">読む・仕分ける・数えるはこの PC の中だけで行い、明細を外へ送りません。元のファイルは保存しません（指紋と取り込んだ行だけを、暗号化した世帯ファイルに残します）。</p>
          <button type="button" class="btn" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </>
  );
}
