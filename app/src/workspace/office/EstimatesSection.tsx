// 事務所の既定値の画面「推定の値（統計・目安）」（0111・0261）: 空欄・「わからない」を補う推定の元になるマスタデータの値と、
// コードの中の目安（ボタンで足すときの初めの値・計算のときにエンジンが引く目安。hearing/src/presets.ts。0111 の2回目）を、事務所の値に変える。
// - 2つのタブ: 値の一覧（値の名前・値ID で探す、事務所で変えた値だけを見る、まとまりで絞る）と、推定で埋めない入力欄
// - 定数は1つの欄、表（世帯人員別・年齢別など）は段ごとの欄（空欄の段は公式の値。表の一部だけ変えられる）
// - 根拠の文（書いた文はそのまま出す。書かなければ自動の文「事務所の目安（変えた年月）」。空にはならない）
// - 変える前に、代表の世帯（見本の世帯）で主な結果の差を見る
// - 公式の値が新しくなった値の知らせ（前の公式・新しい公式・今の事務所の値・出典と、押したらどうなるかを並べる。このまま／公式に戻す。
//   値が同じで出典だけが新しくなったときは軽い知らせ〔確かめた／公式に戻す〕）
// - 前提条件の既定値の画面で変える値（土地の割合・建物の残りの価値の下限・売却の費用・資産の種類の信託報酬と期待リターンの目安）は、読むだけにして
//   「前提条件の既定値で変える」で移る（置き場所はここのまま。変える所を1つにする。0261）
// 押した結果は画面の下書きに入れ、ほかの画面と同じく下の帯の「保存」でまとめて事務所データに保存する（0261。前は押すとすぐ保存していた）
import { useMemo, useState } from "preact/hooks";
import { FILL_TARGETS } from "../../../../hearing/src/estimates.ts";
import type { BracketStep } from "../../../../hearing/src/statistics.ts";
import { man, manDiff } from "../../presentation/format.ts";
import { ESTIMATE_GROUPS, editText, estimateEntries, estimateEntry, formatNumber, parseNumber, searchEstimates, sourceText, stepLabel, stepValue, summaryText, type EstimateEntry } from "./estimateCatalog.ts";
import { AUTO_BASIS, BASIS_TEXT_MAX, basisOf, cleanBasisText, keepOfficeValue, officialUpdates, sourceLine, withNoFill, withOfficeValue, withoutOfficeValue, type OfficeEstimates, type OfficeValue, type OfficialUpdate } from "./estimates.ts";
import { PREVIEW_AGE, type PreviewRow } from "./estimatePreview.ts";
import { Help } from "../../presentation/Help.tsx";
import { PREMISE_DEFS } from "../input/premiseDefaults.ts";
import { CheckField } from "./OfficeFields.tsx";
import { premisePageField } from "./pages.ts";

export interface EstimatesSectionProps {
  /** 変えている途中の値 */
  value: OfficeEstimates;
  /** 保存した値（行の「保存していない」の印に使う。無ければ印を出さない） */
  saved?: OfficeEstimates;
  /** 変えた（画面の下書きに入れる。保存は下の帯の「保存」） */
  onChange: (next: OfficeEstimates) => void;
  /** 代表の世帯で、今の値（before）と変えようとしている値（after）の主な結果を比較する（無ければ「差を見る」を出さない） */
  preview?: (before: OfficeEstimates, after: OfficeEstimates) => Promise<PreviewRow[]>;
  /** 今日（YYYY-MM-DD） */
  today: () => string;
  /** 前提条件の既定値の画面で変える値の「前提条件の既定値で変える」（その画面の欄の名前を渡す。無ければリンクを出さない） */
  onGoPremise?: (field: string) => void;
}

/** コードの中の目安の効く所の文 */
const USE_TEXT: Readonly<Record<string, string>> = {
  fill: "空欄・「わからない」を補う推定",
  template: "ボタンで足すときの初めの値（新しく足す行だけ。足してある行は変わりません）",
  engine: "計算のときの目安（世帯に値が無いとき。どの世帯の計算にもすぐ効きます）",
};

/**
 * 前提条件の不動産の評価の事務所の既定値でもある目安（土地の割合・建物の残りの価値の下限・売却の費用。0214 の1）の効く所の文。
 * ほかの前提条件と同じく世帯に写すので、作った世帯にはすぐ効かない（0218）
 */
const PREMISE_USE_TEXT = "前提条件の不動産の評価の事務所の既定値（これから作る世帯に写します。作った世帯は変わらず、確かめの一覧に「事務所の既定値が変わりました」と出ます）";
const useTextOf = (e: { id: string; use?: string }): string => (PREMISE_DEFS.some((d) => d.live === e.id) ? PREMISE_USE_TEXT : USE_TEXT[e.use ?? ""] ?? "");

/** 欄の後ろの単位 */
const UNIT_SUFFIX: Readonly<Record<string, string>> = { yen: "円", months: "か月", pct: "%", years: "年", yearCount: "年", age: "歳", days: "日", hours: "時間", count: "", coef: "" };

/** 一覧に一度に出す数（探す語を入れると全部） */
const LIST_MAX = 30;

/** 編集中の欄の文字（定数は c、表は段の番号） */
type Draft = Record<string, string>;

/** 編集を始めるときの欄の文字: 事務所の値で公式と違う所だけ（同じ所・公式の値は空欄。空欄は公式の値） */
function draftOf(e: EstimateEntry, office: OfficeValue | undefined): Draft {
  if (office === undefined) return {};
  if (!Array.isArray(office)) return { c: editText(e.unit, office as number | string) };
  const off = e.official.value as readonly BracketStep[];
  const out: Draft = {};
  (office as readonly BracketStep[]).forEach((s, i) => {
    if (stepValue(s) !== stepValue(off[i])) out[String(i)] = editText(e.unit, stepValue(s));
  });
  return out;
}

/** 欄の文字から値（読めない欄があれば null） */
function valueOf(e: EstimateEntry, d: Draft): OfficeValue | null {
  if (!Array.isArray(e.official.value)) {
    const v = parseNumber(e.unit, d.c ?? "");
    if (v === undefined) return null;
    if (v === null) return e.official.value;
    return typeof e.official.value === "number" ? (typeof v === "number" ? v : null) : typeof v === "string" ? v : null;
  }
  const off = e.official.value as readonly BracketStep[];
  const kind = off.some((s) => s.amount !== undefined) ? "amount" : "rate";
  const out: BracketStep[] = [];
  for (let i = 0; i < off.length; i++) {
    const s = off[i] as BracketStep;
    const v = parseNumber(e.unit, d[String(i)] ?? "");
    if (v === undefined) return null;
    if (v === null) out.push(s);
    else if (kind === "amount" && typeof v === "number") out.push({ upTo: s.upTo, amount: v });
    else if (kind === "rate" && typeof v === "string") out.push({ upTo: s.upTo, rate: v });
    else return null;
  }
  return out;
}

const metricLine = (r: PreviewRow) => {
  const t = (n: number) => `${man(n)}万円`;
  const dep = (y: number | null) => (y === null ? "尽きない" : `${y}年`);
  const parts = [`${PREVIEW_AGE}歳時点の金融資産 ${t(r.before.target)} → ${t(r.after.target)}（${manDiff(r.after.target - r.before.target)}万円）`];
  parts.push(`資産が尽きる年 ${dep(r.before.depletion)} → ${dep(r.after.depletion)}`);
  parts.push(`生涯の支出の合計 ${manDiff(r.after.expense - r.before.expense)}万円`);
  return parts.join("・");
};

/** 公式の値が新しくなった値の知らせの1件（何がどう変わったかを開いて見られる。数が少なければ初めから開く） */
function UpdateNotice({ u, open, busy, onKeep, onReedit, onRevert, onGo }: { u: OfficialUpdate; open: boolean; busy: boolean; onKeep: () => void; onReedit: () => void; onRevert: () => void; onGo?: (() => void) | undefined }) {
  const head = u.kind === "broken" ? "公式の表の段の分け方が変わり、事務所の値を使えなくなりました" : u.kind === "source" ? "公式の値の出典が新しくなりました。値は変わっていません" : "公式の値が新しくなりました";
  return (
    <div class={`os-est-update ${u.kind}`} data-office-estimate-update={u.id} data-office-estimate-update-kind={u.kind}>
      <details open={open}>
        <summary>
          <strong>{u.name}</strong>: {head}
        </summary>
        <div class="os-est-update-body">
          {u.kind === "value" && u.single !== null ? (
            <dl class="os-est-update-vals" data-office-estimate-update-single>
              <dt>公式の値</dt>
              <dd>
                前 {u.single.before} → 新しい <strong>{u.single.after}</strong>
              </dd>
              <dt>今の事務所の値</dt>
              <dd>{u.single.office}（今はこの値で計算しています）</dd>
            </dl>
          ) : null}
          {u.kind === "value" && u.steps.length > 0 ? (
            <>
              <p>公式の値が変わった段（{u.steps.length}段）:</p>
              <table class="os-code-diff os-est-update-table" data-office-estimate-update-steps>
                <thead>
                  <tr>
                    <th scope="col">段</th>
                    <th scope="col">前の公式</th>
                    <th scope="col">新しい公式</th>
                    <th scope="col">今の事務所の値</th>
                  </tr>
                </thead>
                <tbody>
                  {u.steps.map((s) => (
                    <tr key={s.label} data-office-estimate-update-step={s.label}>
                      <th scope="row">{s.label}</th>
                      <td>{s.before}</td>
                      <td class="os-code-diff-new">{s.after}</td>
                      <td>{s.officeChanged ? s.office : <span class="os-est-muted">変えていない段（今は前の公式 {s.office}）</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
          {u.kind === "value" && u.single === null && u.steps.length === 0 && u.change !== null ? <p>公式の値: {u.change}</p> : null}
          {u.kind === "broken" ? (
            <dl class="os-est-update-vals" data-office-estimate-update-layout>
              {u.layout !== null ? (
                <>
                  <dt>前の段の分け方</dt>
                  <dd>{u.layout.before}</dd>
                  <dt>新しい段の分け方</dt>
                  <dd>
                    <strong>{u.layout.after}</strong>
                  </dd>
                </>
              ) : null}
              <dt>事務所で変えていた段</dt>
              <dd>{u.officeSteps.length > 0 ? u.officeSteps.join("、") : u.office}</dd>
              <dt>今の計算</dt>
              <dd>新しい公式の値で計算しています（事務所の値は使っていません）</dd>
            </dl>
          ) : null}
          {u.kind !== "broken" && u.officeSteps.length > 0 ? <p data-office-estimate-update-other>ほかに事務所で変えている段（公式は変わっていません）: {u.officeSteps.join("、")}</p> : null}
          {u.kind === "source" ? (
            <p>
              <strong>値は変わっていません。</strong>今の事務所の値 {u.office} をそのまま使っていて、計算も変わっていません。
            </p>
          ) : null}
          {u.kind !== "source" && u.beforeSource !== null && u.sourceChanges.length === 0 ? (
            <dl class="os-est-update-vals os-est-update-src" data-office-estimate-update-source>
              <dt>出典</dt>
              <dd>
                {sourceLine(u.afterSource)}
                <span class="os-est-muted">（変わっていません）</span>
              </dd>
            </dl>
          ) : (
            <dl class="os-est-update-vals os-est-update-src" data-office-estimate-update-source>
              <dt>前の出典</dt>
              <dd>{u.beforeSource !== null ? sourceLine(u.beforeSource) : "記録がありません（出典を覚える前に変えた値です）"}</dd>
              <dt>新しい出典</dt>
              <dd>
                {sourceLine(u.afterSource)}
                {u.sourceChanges.length > 0 ? <span class="os-est-muted">（新しくなった所: {u.sourceChanges.join("・")}）</span> : u.beforeSource !== null ? <span class="os-est-muted">（題名・取得日は前と同じです。出典の記録の版だけが新しくなりました）</span> : null}
              </dd>
            </dl>
          )}
          <ul class="os-est-update-effects" data-office-estimate-update-effects>
            <li>{u.keepText}</li>
            <li>{u.revertText}</li>
            <li class="os-est-muted">{u.effect}</li>
          </ul>
        </div>
      </details>
      <p class="os-est-actions">
        {u.kind === "broken" ? (
          onGo === undefined ? (
            <button type="button" class="link-btn" disabled={busy} onClick={onReedit} data-office-estimate-reedit={u.id}>
              値を入れ直す
            </button>
          ) : null
        ) : (
          <button type="button" class="link-btn" disabled={busy} onClick={onKeep} data-office-estimate-keep={u.id}>
            {u.kind === "source" ? "確かめた（事務所の値のまま）" : "このまま（事務所の値を使う）"}
          </button>
        )}
        {onGo !== undefined ? (
          <button type="button" class="link-btn" onClick={onGo} data-office-estimate-go-premise={u.id}>
            前提条件の既定値で変える
          </button>
        ) : (
          <button type="button" class="link-btn" disabled={busy} onClick={onRevert} data-office-estimate-revert-update={u.id}>
            公式に戻す
          </button>
        )}
      </p>
    </div>
  );
}


export function EstimatesSection({ value, saved, onChange, preview, today, onGoPremise }: EstimatesSectionProps) {
  const [tab, setTab] = useState<"values" | "noFill">("values");
  const [query, setQuery] = useState("");
  const [onlyOffice, setOnlyOffice] = useState(false);
  const [group, setGroup] = useState<string>("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [text, setText] = useState("");
  const [rows, setRows] = useState<PreviewRow[] | null | "busy">(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; id?: string } | null>(null);
  const updates = useMemo(() => officialUpdates(value), [value]);
  const changedCount = Object.keys(value.values).length;
  const all = useMemo(() => estimateEntries().filter((e) => e.legacy !== true || value.values[e.id] !== undefined), [value]);
  const list = useMemo(() => {
    let l = searchEstimates(query);
    // 前の分け方の値（今は使わない）は、探したとき・事務所で変えてあるときだけ出す
    if (query.trim() === "") l = l.filter((e) => e.legacy !== true || value.values[e.id] !== undefined);
    if (onlyOffice) l = l.filter((e) => value.values[e.id] !== undefined);
    if (group !== "") l = l.filter((e) => e.group === group);
    return l;
  }, [query, onlyOffice, group, value]);
  const shown = query.trim() !== "" || onlyOffice ? list : list.slice(0, LIST_MAX);
  const entry = editing === null ? undefined : estimateEntry(editing);
  const draftValue = entry === undefined ? null : valueOf(entry, draft);
  const next = entry === undefined || draftValue === null ? null : withOfficeValue(value, entry.id, draftValue, text, today());
  const unchanged = next !== null && entry !== undefined && JSON.stringify(next.values[entry.id] ?? null) === JSON.stringify(value.values[entry.id] ?? null);
  const unsaved = (id: string): boolean => saved !== undefined && JSON.stringify(value.values[id] ?? null) !== JSON.stringify(saved.values[id] ?? null);
  /** 前提条件の既定値の画面で変える値の、その画面へ移る（無ければ null） */
  const goOf = (id: string): (() => void) | undefined => {
    const f = premisePageField(id);
    return f === null || onGoPremise === undefined ? undefined : () => onGoPremise(f);
  };

  const put = (n: OfficeEstimates, done: string, id?: string) => {
    onChange(n);
    setMsg({ ok: true, text: done, ...(id !== undefined ? { id } : {}) });
  };
  const open = (e: EstimateEntry) => {
    const v = value.values[e.id];
    setEditing(e.id);
    setDraft(draftOf(e, v?.value));
    setText(v?.text ?? "");
    setRows(null);
    setMsg(null);
  };
  const close = () => {
    setEditing(null);
    setRows(null);
  };
  const runPreview = async () => {
    if (preview === undefined || next === null) return;
    setRows("busy");
    try {
      setRows(await preview(value, next));
    } catch {
      setRows([]);
    }
  };
  const apply = () => {
    if (entry === undefined || next === null) return;
    const v = next.values[entry.id];
    put(next, v === undefined ? `${entry.name}は公式の値と同じなので、公式の値に戻しました。` : `${entry.name}を事務所の値にしました（根拠「${basisOf(v)}」）。下の「保存」で、どの世帯の推定と計算にも効きます。`, entry.id);
    close();
  };
  const revert = (id: string) => {
    const e = estimateEntry(id);
    put(withoutOfficeValue(value, id), `${e?.name ?? id}を公式の値に戻しました。`, id);
    if (editing === id) close();
  };

  return (
    <div class="os-est" data-office-estimates>
      {updates.length > 0 ? (
        <div class="os-custom-box pending" role="status" data-office-estimate-updates>
          {updates.map((u) => (
            <UpdateNotice
              key={u.id}
              u={u}
              open={updates.length <= 3}
              busy={false}
              onKeep={() => put(keepOfficeValue(value, u.id), u.kind === "source" ? `${u.name}の出典の更新を確かめました（事務所の値のまま使います）。` : `${u.name}は事務所の値のまま使います。`, u.id)}
              onReedit={() => {
                setTab("values");
                open(estimateEntry(u.id) as EstimateEntry);
              }}
              onRevert={() => revert(u.id)}
              onGo={goOf(u.id)}
            />
          ))}
        </div>
      ) : null}
      <div class="os-tabs" role="tablist" aria-label="推定の値の見るもの">
        <button type="button" role="tab" id="os-est-tab-values" aria-controls="os-est-panel-values" aria-selected={tab === "values"} tabIndex={tab === "values" ? 0 : -1} onClick={() => setTab("values")} data-office-estimate-tab="values">
          値の一覧（{all.length}）
        </button>
        <button type="button" role="tab" id="os-est-tab-nofill" aria-controls="os-est-panel-nofill" aria-selected={tab === "noFill"} tabIndex={tab === "noFill" ? 0 : -1} onClick={() => setTab("noFill")} data-office-estimate-tab="noFill">
          推定で埋めない入力欄（{FILL_TARGETS.length}）
        </button>
      </div>
      <div role="tabpanel" id="os-est-panel-values" aria-labelledby="os-est-tab-values" hidden={tab !== "values"}>
        <div class="os-est-find">
          <input type="search" value={query} placeholder="値の名前・値ID で探す（例: 基本生活費、家賃、介護、care.statistics）" aria-label="推定の値を探す" onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} data-office-estimate-search />
          <label class="os-show">
            <input type="checkbox" checked={onlyOffice} onChange={(e) => setOnlyOffice((e.currentTarget as HTMLInputElement).checked)} data-office-estimate-only />
            事務所で変えた値だけ（{changedCount}件）
          </label>
        </div>
        <div class="os-chips" role="group" aria-label="まとまりで絞る" data-office-estimate-groups>
          {ESTIMATE_GROUPS.map((g) => ({ g, n: all.filter((e) => e.group === g).length }))
            .filter((x) => x.n > 0)
            .map(({ g, n }) => (
              <button key={g} type="button" class="add-btn chip-btn" aria-pressed={group === g} onClick={() => setGroup(group === g ? "" : g)} data-office-estimate-group={g}>
                {g} {n}
              </button>
            ))}
        </div>
        {msg !== null && editing === null ? (
          <p class={`fld-help${msg.ok ? "" : " bad"}`} role={msg.ok ? "status" : "alert"} data-office-estimate-msg>
            {msg.text}
          </p>
        ) : null}
        <div class="os-est-head" aria-hidden="true">
          <span>名前</span>
          <span>公式の値・事務所の値</span>
          <span />
        </div>
        <ul class="os-est-list">
          {shown.map((e) => {
            const v = value.values[e.id];
            const isOpen = editing === e.id;
            const go = goOf(e.id);
            return (
              <li key={e.id} class={v !== undefined ? "office" : ""} data-office-estimate={e.id}>
                <div class="os-est-row">
                  <div class="os-est-name">
                    <span>
                      {e.name}
                      {/* 値ID（内部の名前）は「?」の中（探す欄では値ID でも探せる） */}
                      <Help label={e.name} data={{ "data-office-estimate-id": e.id }}>
                        値ID: <code class="os-est-id">{e.id}</code>
                      </Help>
                    </span>
                    {unsaved(e.id) ? <span class="fld-premise officeChanged" data-office-estimate-unsaved={e.id}>保存していない</span> : null}
                  </div>
                  <div class="os-est-vals">
                    <span>公式: {summaryText(e, e.official.value)}</span>
                    {v !== undefined ? (
                      <span class="os-est-office" data-office-estimate-value={e.id}>
                        事務所: {summaryText(e, v.value)}（{basisOf(v)}）
                      </span>
                    ) : null}
                  </div>
                  {go !== undefined ? (
                    <button type="button" class="link-btn" onClick={go} data-office-estimate-go-premise={e.id} title="この値は「前提条件の既定値」の画面で変えます（ここには読むだけで出します）">
                      前提条件の既定値で変える
                    </button>
                  ) : !isOpen ? (
                    <button type="button" class="link-btn" onClick={() => open(e)} data-office-estimate-edit={e.id}>
                      {v !== undefined ? "直す" : "変える"}
                    </button>
                  ) : null}
                </div>
                {isOpen && go === undefined ? (
                  <div class="os-est-editor" data-office-estimate-editor={e.id}>
                    <p class="pl-sub">
                      出典: {sourceText(e.official.title)}
                      {e.use !== undefined ? <span data-office-estimate-use={e.use}>（効く所: {useTextOf(e)}）</span> : null}
                    </p>
                    {!Array.isArray(e.official.value) ? (
                      <div class="fld">
                        <div class="fld-l">
                          <label for={`os-est-c-${e.id}`}>事務所の値（空欄は公式の値 {formatNumber(e.unit, e.official.value as number | string)}）</label>
                        </div>
                        <div class="fld-c">
                          <span class="fld-in">
                            <input id={`os-est-c-${e.id}`} type="text" class={`num${draftValue === null ? " bad" : ""}`} inputMode="decimal" value={draft.c ?? ""} placeholder={editText(e.unit, e.official.value as number | string)} aria-invalid={draftValue === null} onInput={(x) => setDraft({ ...draft, c: (x.currentTarget as HTMLInputElement).value })} data-office-estimate-input="c" />
                            {(UNIT_SUFFIX[e.unit] ?? "") !== "" ? <span class="suffix">{UNIT_SUFFIX[e.unit]}</span> : null}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p class="pl-sub">表の一部の段だけ変えられます（空欄の段は公式の値のまま）。{e.points === true ? "値はその年齢ちょうどの値で、間の年齢は前後の段の値から直線で補います（最後の年齢から上は最後の段の値）。" : ""}</p>
                        <table class="os-code-diff os-est-table">
                          <thead>
                            <tr>
                              <th scope="col">{e.axis ?? "段"}</th>
                              <th scope="col">公式</th>
                              <th scope="col">事務所</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(e.official.value as readonly BracketStep[]).map((s, i) => (e.points === true && s.upTo === null ? null : (
                              <tr key={i}>
                                <th scope="row">{stepLabel(e.axis, e.official.value as readonly BracketStep[], i, e.points)}</th>
                                <td>{formatNumber(e.unit, stepValue(s))}</td>
                                <td>
                                  <input type="text" class="num" inputMode="decimal" value={draft[String(i)] ?? ""} placeholder={editText(e.unit, stepValue(s))} aria-label={`${stepLabel(e.axis, e.official.value as readonly BracketStep[], i, e.points)}の事務所の値`} onInput={(x) => setDraft({ ...draft, [String(i)]: (x.currentTarget as HTMLInputElement).value })} data-office-estimate-input={String(i)} />
                                </td>
                              </tr>
                            )))}
                          </tbody>
                        </table>
                      </>
                    )}
                    {draftValue === null ? (
                      <p class="fld-help bad" role="alert" data-office-estimate-problem>
                        読めない数があります（{e.unit === "pct" ? "％の数（例: 1.25）" : e.unit === "yen" ? "円の整数（例: 250000）" : e.unit === "months" ? "月数の整数" : "0以上の数"}で入れてください）
                      </p>
                    ) : null}
                    <div class="fld">
                      <div class="fld-l">
                        <label for={`os-est-basis-${e.id}`}>根拠の文</label>
                        <Help label="根拠の文">書いた文をそのまま出します。年月を入れたいときは文に書いてください。書かなければ「{AUTO_BASIS}（変えた年月）」です。</Help>
                      </div>
                      <div class="fld-c">
                        <input id={`os-est-basis-${e.id}`} type="text" class="txt os-wide" value={text} maxLength={BASIS_TEXT_MAX} placeholder="例: 当事務所のお客さまの平均（2026年調べ）" onInput={(x) => setText((x.currentTarget as HTMLInputElement).value)} data-office-estimate-basis />
                      </div>
                      <div class="fld-help" data-office-estimate-basis-preview>
                        推定の根拠に出る文: {basisOf({ ...(cleanBasisText(text) !== null ? { text } : {}), changedOn: today() })}
                      </div>
                    </div>
                    {preview !== undefined ? (
                      <div class="os-est-preview" data-office-estimate-preview>
                        <button type="button" class="link-btn" disabled={next === null || unchanged || rows === "busy"} onClick={() => void runPreview()} data-office-estimate-preview-run>
                          代表の世帯で差を見る
                        </button>
                        {rows === "busy" ? <p class="pl-sub">計算しています…</p> : null}
                        {Array.isArray(rows) ? (
                          rows.length === 0 ? (
                            <p class="pl-sub">代表の世帯を計算できませんでした。</p>
                          ) : (
                            <ul class="os-est-preview-rows">
                              {rows.map((r) => (
                                <li key={r.id} data-office-estimate-preview-row={r.id}>
                                  <strong>{r.title}</strong>（見本の世帯。推定で埋まる欄が空欄だったとき）:{" "}
                                  {r.changed ? metricLine(r) : e.use === "template" ? "主な結果は変わりません（ボタンで足すときの初めの値なので、足してある行は変わりません）" : "主な結果は変わりません（この世帯ではこの値を使っていません）"}
                                </li>
                              ))}
                            </ul>
                          )
                        ) : null}
                      </div>
                    ) : null}
                    {msg !== null ? (
                      <p class={`fld-help${msg.ok ? "" : " bad"}`} role={msg.ok ? "status" : "alert"}>
                        {msg.text}
                      </p>
                    ) : null}
                    <p class="os-est-actions">
                      <button type="button" class="btn small primary" disabled={next === null || unchanged} onClick={apply} data-office-estimate-apply>
                        この値にする
                      </button>
                      {value.values[e.id] !== undefined ? (
                        <button type="button" class="link-btn" onClick={() => revert(e.id)} data-office-estimate-revert>
                          公式の値に戻す
                        </button>
                      ) : null}
                      <button type="button" class="link-btn" onClick={close} data-office-estimate-cancel>
                        キャンセル
                      </button>
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {shown.length < list.length ? (
          <p class="pl-sub" data-office-estimate-more>
            ほか{list.length - shown.length}件（名前・値ID で探すか、まとまりで絞ってください）
          </p>
        ) : null}
        {shown.length === 0 ? <p class="pl-sub">探した言葉・まとまりに合う値がありません。</p> : null}
        <p class="os-note-line">土地の割合・建物の残りの価値の下限・売却の費用と、資産の種類の信託報酬・期待リターンの目安は「前提条件の既定値」の画面で変えます（ここには読むだけで出します）。</p>
      </div>
      <div role="tabpanel" id="os-est-panel-nofill" aria-labelledby="os-est-tab-nofill" hidden={tab !== "noFill"} data-office-nofill>
        <p class="os-lead">
          選んだ欄は、新しく入れるとき（新しい世帯・家族や働き方を足したとき・ヒアリングシートの空欄と「わからない」）に推定で埋めず、空欄のまま「未入力（0円で計算中）」にします。
          <Help label="推定で埋めない入力欄">確かめの一覧に出ます。そこから「推定で埋める」もできます。入れてある値は変えません。「計算のときの統計の目安」の欄は、空欄のときに計算で目安を引かず、0円で計算して「入力が足りない」に出します（どの世帯の計算にもすぐ効きます）。</Help>
        </p>
        <div class="os-checks os-checks-wide">
          {FILL_TARGETS.map((t) => (
            <CheckField key={t.id} name={`nofill.${t.id}`} label={t.label} note={t.note} checked={value.noFill.includes(t.id)} onChange={(on) => onChange(withNoFill(value, t.id, on))} data={{ "data-office-nofill": t.id }} wrapData={{ "data-office-nofill-item": t.id }} />
          ))}
        </div>
      </div>
    </div>
  );
}
