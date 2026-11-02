// 事務所の既定値の画面の区画「推定の値（統計）」（0111）: 空欄・「わからない」を補う推定の元になるマスタデータの値を、事務所の値に変える。
// - 値の名前・値ID で探す、事務所で変えた値だけを見る、まとまりで絞る
// - 定数は1つの欄、表（世帯人員別・年齢別など）は段ごとの欄（空欄の段は公式の値。表の一部だけ変えられる）
// - 根拠の文（書かなければ自動の文「事務所の目安」。変えた年月はいつも後ろに付く。空にはならない）
// - 変える前に、代表の世帯（見本の世帯）で主な結果の差を見る
// - 公式の値が新しくなった値の知らせ（このまま／公式に戻す）
// - 推定で埋めない入力欄
// 押した結果はすぐ事務所データに保存し、どの世帯にもすぐ効く（パネルの「保存」は要らない）
import { useMemo, useState } from "preact/hooks";
import { FILL_TARGETS } from "../../../../hearing/src/estimates.ts";
import type { BracketStep } from "../../../../hearing/src/statistics.ts";
import { man, manDiff } from "../../presentation/format.ts";
import { ESTIMATE_GROUPS, editText, estimateEntries, estimateEntry, formatNumber, parseNumber, searchEstimates, sourceText, stepLabel, stepValue, summaryText, type EstimateEntry } from "./estimateCatalog.ts";
import { AUTO_BASIS, BASIS_TEXT_MAX, basisOf, cleanBasisText, keepOfficeValue, officialUpdates, withNoFill, withOfficeValue, withoutOfficeValue, type OfficeEstimates, type OfficeValue } from "./estimates.ts";
import { PREVIEW_AGE, type PreviewRow } from "./estimatePreview.ts";

export interface EstimatesSectionProps {
  value: OfficeEstimates;
  /** 保存する（すぐ事務所データへ。失敗したら投げる） */
  onChange: (next: OfficeEstimates) => Promise<void>;
  /** 代表の世帯で、今の値（before）と変えようとしている値（after）の主な結果を比べる（無ければ「差を見る」を出さない） */
  preview?: (before: OfficeEstimates, after: OfficeEstimates) => Promise<PreviewRow[]>;
  /** 今日（YYYY-MM-DD） */
  today: () => string;
}

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

export function EstimatesSection({ value, onChange, preview, today }: EstimatesSectionProps) {
  const [query, setQuery] = useState("");
  const [onlyOffice, setOnlyOffice] = useState(false);
  const [group, setGroup] = useState<string>("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [text, setText] = useState("");
  const [rows, setRows] = useState<PreviewRow[] | null | "busy">(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; id?: string } | null>(null);
  const updates = useMemo(() => officialUpdates(value), [value]);
  const changedCount = Object.keys(value.values).length;
  const list = useMemo(() => {
    let l = searchEstimates(query);
    if (onlyOffice) l = l.filter((e) => value.values[e.id] !== undefined);
    if (group !== "") l = l.filter((e) => e.group === group);
    return l;
  }, [query, onlyOffice, group, value]);
  const shown = query.trim() !== "" || onlyOffice ? list : list.slice(0, LIST_MAX);
  const entry = editing === null ? undefined : estimateEntry(editing);
  const draftValue = entry === undefined ? null : valueOf(entry, draft);
  const next = entry === undefined || draftValue === null ? null : withOfficeValue(value, entry.id, draftValue, text, today());
  const unchanged = next !== null && entry !== undefined && JSON.stringify(next.values[entry.id] ?? null) === JSON.stringify(value.values[entry.id] ?? null);

  const save = async (n: OfficeEstimates, done: string, id?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await onChange(n);
      setMsg({ ok: true, text: done, ...(id !== undefined ? { id } : {}) });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: `保存できませんでした（${typeof e === "string" ? e : e instanceof Error ? e.message : "E_OFFICE_SETTINGS"}）` });
      return false;
    } finally {
      setBusy(false);
    }
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
  const apply = async () => {
    if (entry === undefined || next === null) return;
    const v = next.values[entry.id];
    const ok = await save(next, v === undefined ? `${entry.name}は公式の値と同じなので、公式の値に戻しました。` : `${entry.name}を事務所の値にしました（根拠「${basisOf(v)}」）。どの世帯の推定と計算にもすぐ効きます。`, entry.id);
    if (ok) close();
  };
  const revert = async (id: string) => {
    const e = estimateEntry(id);
    const ok = await save(withoutOfficeValue(value, id), `${e?.name ?? id}を公式の値に戻しました。`, id);
    if (ok && editing === id) close();
  };

  return (
    <section class="os-sec" aria-labelledby="os-estimates" data-office-estimates>
      <h3 id="os-estimates">推定の値（統計）</h3>
      <p class="pl-sub">
        空欄・「わからない」を補う推定の元になる統計の値（基本生活費・給与・退職金・学校の費用・介護の費用と期間・ローンの金利・平均余命など）を、事務所の値に変えられます。
        変えた値は、これから入れる推定と、計算のときに使う目安に、どの世帯にもすぐ効きます。世帯に入れてある推定のままの値は、その世帯の入力を直したときに新しい値で入れ直します（FP が入れた値・確定にした値は変わりません。世帯ごとに直せます）。
        税・社会保険・年金など法令で決まる値は変えられません。押した結果はすぐ保存します。
      </p>
      {updates.length > 0 ? (
        <div class="os-custom-box pending" role="status" data-office-estimate-updates>
          {updates.map((u) => (
            <div class="os-est-update" key={u.id} data-office-estimate-update={u.id}>
              <p>
                <strong>公式の値が新しくなりました</strong>（{u.name}。前 {u.change}）。
                {u.broken ? "公式の表の段の分け方が変わったので、事務所の値を使えません（今は公式の値で計算しています）。公式に戻すか、値を入れ直してください。" : "今は事務所の値を使い続けています。"}
              </p>
              <p class="os-est-actions">
                {!u.broken ? (
                  <button type="button" class="link-btn" disabled={busy} onClick={() => void save(keepOfficeValue(value, u.id), `${u.name}は事務所の値のまま使います。`, u.id)} data-office-estimate-keep={u.id}>
                    このまま（事務所の値を使う）
                  </button>
                ) : (
                  <button type="button" class="link-btn" disabled={busy} onClick={() => open(estimateEntry(u.id) as EstimateEntry)} data-office-estimate-reedit={u.id}>
                    値を入れ直す
                  </button>
                )}
                <button type="button" class="link-btn" disabled={busy} onClick={() => void revert(u.id)} data-office-estimate-revert-update={u.id}>
                  公式に戻す
                </button>
              </p>
            </div>
          ))}
        </div>
      ) : null}
      <div class="os-est-find">
        <input type="search" value={query} placeholder="値の名前・値ID で探す（例: 基本生活費、介護、care.statistics）" aria-label="推定の値を探す" onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} data-office-estimate-search />
        <select value={group} aria-label="まとまりで絞る" onChange={(e) => setGroup((e.currentTarget as HTMLSelectElement).value)} data-office-estimate-group>
          <option value="">すべてのまとまり</option>
          {ESTIMATE_GROUPS.filter((g) => estimateEntries().some((e) => e.group === g)).map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <label class="os-show">
          <input type="checkbox" checked={onlyOffice} onChange={(e) => setOnlyOffice((e.currentTarget as HTMLInputElement).checked)} data-office-estimate-only />
          事務所で変えた値だけ（{changedCount}件）
        </label>
      </div>
      {msg !== null && editing === null ? (
        <p class={`fld-help${msg.ok ? "" : " bad"}`} role={msg.ok ? "status" : "alert"} data-office-estimate-msg>
          {msg.text}
        </p>
      ) : null}
      <ul class="os-est-list">
        {shown.map((e) => {
          const v = value.values[e.id];
          const isOpen = editing === e.id;
          return (
            <li key={e.id} class={v !== undefined ? "office" : ""} data-office-estimate={e.id}>
              <div class="os-est-row">
                <div class="os-est-name">
                  <span>{e.name}</span>
                  <small class="os-est-id">{e.id}</small>
                </div>
                <div class="os-est-vals">
                  <span>公式: {summaryText(e, e.official.value)}</span>
                  {v !== undefined ? (
                    <span class="os-est-office" data-office-estimate-value={e.id}>
                      事務所: {summaryText(e, v.value)}（{basisOf(v)}）
                    </span>
                  ) : null}
                </div>
                {!isOpen ? (
                  <button type="button" class="link-btn" onClick={() => open(e)} data-office-estimate-edit={e.id}>
                    {v !== undefined ? "直す" : "変える"}
                  </button>
                ) : null}
              </div>
              {isOpen ? (
                <div class="os-est-editor" data-office-estimate-editor={e.id}>
                  <p class="pl-sub">出典: {sourceText(e.official.title)}</p>
                  {!Array.isArray(e.official.value) ? (
                    <label class="os-pct">
                      <span>事務所の値（空欄は公式の値 {formatNumber(e.unit, e.official.value as number | string)}）</span>
                      <span class="os-in">
                        <input inputMode="decimal" value={draft.c ?? ""} placeholder={editText(e.unit, e.official.value as number | string)} aria-invalid={draftValue === null} onInput={(x) => setDraft({ ...draft, c: (x.currentTarget as HTMLInputElement).value })} data-office-estimate-input="c" />
                        {e.unit === "yen" ? "円" : e.unit === "months" ? "か月" : e.unit === "pct" ? "%" : e.unit === "years" ? "年" : ""}
                      </span>
                    </label>
                  ) : (
                    <>
                      <p class="pl-sub">表の一部の段だけ変えられます（空欄の段は公式の値のまま）。</p>
                      <table class="os-code-diff os-est-table">
                        <thead>
                          <tr>
                            <th scope="col">{e.axis ?? "段"}</th>
                            <th scope="col">公式</th>
                            <th scope="col">事務所</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(e.official.value as readonly BracketStep[]).map((s, i) => (
                            <tr key={i}>
                              <th scope="row">{stepLabel(e.axis, e.official.value as readonly BracketStep[], i)}</th>
                              <td>{formatNumber(e.unit, stepValue(s))}</td>
                              <td>
                                <input inputMode="decimal" value={draft[String(i)] ?? ""} placeholder={editText(e.unit, stepValue(s))} aria-label={`${stepLabel(e.axis, e.official.value as readonly BracketStep[], i)}の事務所の値`} onInput={(x) => setDraft({ ...draft, [String(i)]: (x.currentTarget as HTMLInputElement).value })} data-office-estimate-input={String(i)} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                  {draftValue === null ? (
                    <p class="fld-help bad" role="alert" data-office-estimate-problem>
                      読めない数があります（{e.unit === "pct" ? "％の数（例: 1.25）" : e.unit === "yen" ? "円の整数（例: 250000）" : e.unit === "months" ? "月数の整数" : "0以上の数"}で入れてください）
                    </p>
                  ) : null}
                  <label class="os-pct">
                    <span>根拠の文（書かなければ「{AUTO_BASIS}」。変えた年月は後ろに付きます）</span>
                    <input type="text" value={text} maxLength={BASIS_TEXT_MAX} placeholder="例: 当事務所のお客さまの平均（2026年調べ）" onInput={(x) => setText((x.currentTarget as HTMLInputElement).value)} data-office-estimate-basis />
                    <small data-office-estimate-basis-preview>
                      推定の根拠に出る文: {basisOf({ ...(cleanBasisText(text) !== null ? { text } : {}), changedOn: today() })}
                    </small>
                  </label>
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
                                <strong>{r.title}</strong>（見本の世帯。推定で埋まる欄が空欄だったとき）: {r.changed ? metricLine(r) : "主な結果は変わりません（この世帯ではこの値を使っていません）"}
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
                    <button type="button" class="btn primary" disabled={busy || next === null || unchanged} onClick={() => void apply()} data-office-estimate-apply>
                      この値にする
                    </button>
                    {value.values[e.id] !== undefined ? (
                      <button type="button" class="link-btn" disabled={busy} onClick={() => void revert(e.id)} data-office-estimate-revert>
                        公式の値に戻す
                      </button>
                    ) : null}
                    <button type="button" class="link-btn" onClick={close} data-office-estimate-cancel>
                      やめる
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
      {shown.length === 0 ? <p class="pl-sub">当てはまる値がありません。</p> : null}
      <div class="os-lever-group" data-office-nofill>
        <h4>推定で埋めない入力欄</h4>
        <p class="pl-sub">選んだ欄は、新しく入れるとき（新しい世帯・家族や働き方を足したとき・ヒアリングシートの空欄と「わからない」）に推定で埋めず、空欄のまま「未入力（0円で計算中）」にします（確かめの一覧に出ます。そこから「推定で埋める」もできます）。入れてある値は変えません。</p>
        <ul class="os-est-nofill">
          {FILL_TARGETS.map((t) => (
            <li key={t.id} data-office-nofill-item={t.id}>
              <label>
                <input
                  type="checkbox"
                  checked={value.noFill.includes(t.id)}
                  disabled={busy}
                  onChange={(x) => {
                    const on = (x.currentTarget as HTMLInputElement).checked;
                    void save(withNoFill(value, t.id, on), on ? `${t.label}を推定で埋めないようにしました。` : `${t.label}を推定で埋めるようにしました。`);
                  }}
                  data-office-nofill={t.id}
                />
                <span>{t.label}</span>
              </label>
              <small>{t.note}</small>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
