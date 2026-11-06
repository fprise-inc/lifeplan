// 確かめの一覧（入力のホームの道具。0041・0072）: 未入力・書類待ち・確かめの注意・計算の知らせ・推定を並べ、行から欄へ移る（「開く」）。
// 行の操作（推定で入れる・該当なし・この値にする）とまとめての操作は、世帯を直す（元に戻すで戻せる）。欄に移るだけでは何も変えない。
// - 絞り込み: カード・状態（種類と「次回確かめる」）・出どころ（手で・ヒアリング・取り込み・AI・自動）・確かさ（書類・申告・概算）。
//   確かさが申告・概算の確定の値は、確かさか種類で絞り込んだときだけ出す
// - 行ごとの「次回確かめる」の印（recheck.ts。世帯ファイルに残す）と、印の行の書き出し（面談で確かめることの文）
// - 確かめの注意の「確認した」（noticeAck.ts。世帯ファイルに残す）。確認した注意は状態の絞り込み「確認した注意」に並べ、「また出す」で戻す
// - プランの編集中は、そのプランで足した物の推定・未入力も出す（札「プランBで足した」。行の操作はそのプランの差分になる）
import { useMemo, useState } from "preact/hooks";
import type { Level } from "./form.ts";
import type { WorkingHousehold } from "./household.ts";
import type { NoticeRow } from "../engineNotices.ts";
import { findObject } from "../store/readings.ts";
import { today } from "../report/assemble.ts";
import { ackedRows, CERTAINTY_LABELS, CHECK_KIND_LABELS, checkCounts, checkList, confirmAllEstimates, DEFAULT_KINDS, fillAll, confirmAllLabel, CONFIRM_ALL_NOTE, fillAllLabel, KIND_ORDER, KIND_UNITS, kindCount, ORIGIN_LABELS, type Certainty, type CheckKind, type CheckRow, type OriginKind } from "./checkRows.ts";
import { isRechecked, recheckMarks, recheckText, setRecheck } from "./recheck.ts";
import { Help } from "../../presentation/Help.tsx";

/** 根拠を、行を開いたときだけ出す種類（推定・書類待ち・確かさ。0077）。ほかの種類の文は状態の知らせなので常に出す */
export const BASIS_ON_OPEN: ReadonlySet<CheckKind> = new Set<CheckKind>(["estimated", "unknown", "certainty", "premise"]);

/** プランの編集中に、そのプランで足した物の行を出すための道具 */
export interface CheckPlan {
  /** 例: 「プランB」 */
  label: string;
  /** プランを当てた作業中の世帯 */
  view: WorkingHousehold;
  /** プランを当てた世帯を直した（親がそのプランの差分にする） */
  onEdit: (nextView: WorkingHousehold, done: string) => void;
}

interface Props {
  wh: WorkingHousehold;
  /** 世帯を直した（操作の名前つき。親が保存して計算し直す） */
  onEdit: (next: WorkingHousehold, done: string) => void;
  /** カードを開いて欄に移る */
  onOpen: (card: string, fieldKey: string | null, level: Level) => void;
  /** 現状の計算結果の知らせ（入力で直せるものを「計算の知らせ」に出す。0064） */
  notices?: readonly NoticeRow[];
  /** プランの編集中（そのプランで足した物の行を出す） */
  plan?: CheckPlan;
  /** 書類待ちの行を、送ってほしい書類の一覧（書類のお願い。0102）にまとめて開く */
  onDocRequests?: () => void;
}

/**
 * 入力のホームの「確かめの一覧」のボタンの文: 未入力と推定の数だけ（ほかの種類があれば「ほか」。数の並びは開いた中だけ。0041 の追記 2026-11-06）
 */
export function checkButtonText(counts: Readonly<Record<CheckKind, number>>): string {
  const others = counts.notStarted + counts.unknown + counts.notice + counts.calc;
  return `確かめの一覧（${kindCount("missing", counts.missing, "未入力")}・${kindCount("estimated", counts.estimated)}${others > 0 ? " ほか" : ""}）`;
}

/** 入力のホームの見出しの下に出す、確かめの一覧の入口の数（未入力・書類待ち・推定。前提条件の標準の値は数えない） */
export function checkSummary(wh: WorkingHousehold, notices: readonly NoticeRow[] = []): { total: number; counts: Record<CheckKind, number> } {
  const counts = checkCounts(checkList(wh, notices));
  return { total: counts.missing + counts.notStarted + counts.unknown + counts.notice + counts.calc + counts.estimated, counts };
}

const NO_NOTICES: readonly NoticeRow[] = [];

/** プランで足した物（現状に無い物・構成員）の行 */
export function planOnlyRows(wh: WorkingHousehold, view: WorkingHousehold): CheckRow[] {
  const inp = wh.request.input as unknown as Record<string, unknown>;
  const vinp = view.request.input as unknown as Record<string, unknown>;
  return checkList(view).filter((r) => r.holder != null && r.kind !== "calc" && findObject(inp, r.holder) === undefined && findObject(vinp, r.holder) !== undefined);
}

type KindFilter = "" | CheckKind | "recheck" | "acked";

/** 確かめの一覧の絞り込み（カード・状態・出どころ・確かさ）。種類を選ばず確かさも選ばないときは、確かさの行を出さない */
export interface CheckFilter {
  card: string;
  kind: KindFilter;
  origin: "" | OriginKind;
  certainty: "" | Certainty;
}

export function passesFilter(r: CheckRow, f: CheckFilter, marked: (id: string) => boolean): boolean {
  if (f.card !== "" && r.card !== f.card) return false;
  // 確認した注意（絞り込み）: いつもの行は出さず、確認した注意だけを並べる（ackedRows）
  if (f.kind === "acked") return false;
  if (f.kind === "recheck") {
    if (!marked(r.id)) return false;
  } else if (f.kind !== "") {
    if (r.kind !== f.kind) return false;
  } else if (!DEFAULT_KINDS.includes(r.kind) && f.certainty === "") return false;
  if (f.origin !== "" && r.origin !== f.origin) return false;
  if (f.certainty !== "" && r.certainty !== f.certainty) return false;
  return true;
}

export function CheckList({ wh, onEdit, onOpen, notices = NO_NOTICES, plan, onDocRequests }: Props) {
  const all = useMemo(() => checkList(wh, notices), [wh, notices]);
  const planRows = useMemo(() => (plan === undefined ? [] : planOnlyRows(wh, plan.view)), [wh, plan?.view]);
  const acked = useMemo(() => ackedRows(wh), [wh]);
  const [filter, setFilter] = useState<CheckFilter>({ card: "", kind: "", origin: "", certainty: "" });
  const [copied, setCopied] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** まとめての「この値にする」を押す前の確かめの1行を出しているか */
  const [asking, setAsking] = useState(false);
  /** 根拠を開いた行 */
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const toggleOpen = (id: string) => setOpened((o) => {
    const n = new Set(o);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const { card, kind } = filter;
  const put = (k: keyof CheckFilter) => (e: Event) => setFilter({ ...filter, [k]: (e.currentTarget as HTMLSelectElement).value });
  const marks = recheckMarks(wh);
  const cards = useMemo(() => [...new Map([...all, ...planRows].map((r) => [r.card, r.cardLabel])).entries()], [all, planRows]);
  const marked = (id: string) => isRechecked(wh, id);
  const shown = all.filter((r) => passesFilter(r, filter, marked));
  const shownAcked = kind === "acked" ? acked.filter((r) => card === "" || r.card === card) : [];
  const shownPlan = planRows.filter((r) => passesFilter(r, filter, () => false));
  const counts = checkCounts(all);
  const premise = kind === "" ? all.filter((r) => r.kind === "premise" && (card === "" || r.card === card) && (filter.origin === "" || r.origin === filter.origin) && (filter.certainty === "" || r.certainty === filter.certainty)) : [];
  const fillable = shown.filter((r) => (r.kind === "missing" || r.kind === "notStarted") && r.actions.some((a) => a.key === "fill")).length;
  // まとめて確定にできる推定（推定が値でなく決まりの欄は「この値にする」を持たない）
  const estimated = all.filter((r) => r.kind === "estimated" && (card === "" || r.card === card) && r.actions.some((a) => a.key === "confirm")).length;
  const run = (r: CheckRow, key: string) => {
    const a = r.actions.find((x) => x.key === key);
    if (a === undefined) return;
    const next = a.run(wh);
    if (next !== wh) onEdit(next, `「${r.label}」: ${a.label}`);
  };
  const runPlan = (r: CheckRow, key: string) => {
    const a = r.actions.find((x) => x.key === key);
    if (a === undefined || plan === undefined) return;
    const next = a.run(plan.view);
    if (next !== plan.view) plan.onEdit(next, `「${r.label}」: ${a.label}（${plan.label}）`);
  };
  const toggleMark = (r: CheckRow) => {
    const on = marked(r.id);
    onEdit(setRecheck(wh, r, on ? null : today()), on ? `「${r.label}」の「次回確かめる」を外しました` : `「${r.label}」に「次回確かめる」を付けました`);
  };
  const copy = async () => {
    const text = recheckText(marks, all);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(null);
      setNote("写しました。面談の確かめの一覧や見直しの準備に貼り付けてください（氏名・顧客番号は入っていません）");
    } catch {
      // 写せないときは文を見せる（選んで写す）
      setCopied(text);
    }
  };
  const line = (r: CheckRow, planRow: boolean) => {
    const on = !planRow && marked(r.id);
    return (
      <li key={r.id} data-ck-row={r.id} class={on ? "marked" : ""}>
        <span class="ck-card">{r.cardLabel}</span>
        <span class="ck-label">
          {r.label}
          {planRow && plan !== undefined ? (
            <span class="plan-count" data-ck-plan>
              {plan.label}で足した
            </span>
          ) : null}
        </span>
        {r.value != null ? (
          <span class="ck-value" data-ck-value>
            {r.value}
          </span>
        ) : null}
        {r.origin != null && r.origin !== "manual" && r.origin !== "auto" ? (
          <span class="ck-tag" data-ck-origin-tag={r.origin}>
            {ORIGIN_LABELS[r.origin]}
          </span>
        ) : null}
        {r.certainty != null ? (
          <span class="ck-tag" data-ck-certainty-tag={r.certainty}>
            {CERTAINTY_LABELS[r.certainty]}
          </span>
        ) : null}
        {r.detail !== null && BASIS_ON_OPEN.has(r.kind) ? (
          <button type="button" class="link-btn ck-basis" aria-expanded={opened.has(r.id)} onClick={() => toggleOpen(r.id)} data-ck-basis={r.id}>
            根拠 {opened.has(r.id) ? "▴" : "▾"}
          </button>
        ) : null}
        {r.detail !== null && (!BASIS_ON_OPEN.has(r.kind) || opened.has(r.id)) ? <span class="ck-detail">{r.detail}</span> : null}
        <span class="ck-acts">
          {r.actions.map((a) => (
            <button type="button" key={a.key} class="link-btn" onClick={() => (planRow ? runPlan(r, a.key) : run(r, a.key))} {...(a.title !== undefined ? { title: a.title } : {})} data-ck-action={a.key}>
              {a.label}
            </button>
          ))}
          <button type="button" class="link-btn" onClick={() => onOpen(r.card, r.fieldKey, r.level)} data-ck-open>
            開く
          </button>
          {!planRow ? (
            <label class="ck-mark" title="次の面談・見直しで確かめる所に印を付けます（世帯に残ります。計算は変わりません）">
              <input type="checkbox" checked={on} onChange={() => toggleMark(r)} data-ck-recheck={r.id} />
              次回確かめる
            </label>
          ) : null}
        </span>
      </li>
    );
  };
  const kinds = kind === "acked" ? [] : kind === "" || kind === "recheck" ? KIND_ORDER : [kind];
  return (
    <section class="ck" aria-label="確かめの一覧" data-checklist>
      <div class="ck-head">
        <h2>
          確かめの一覧
          <Help label="確かめの一覧" id="checklist">
            <p>未入力・まだ入れていない項目・書類待ち・確かめの注意・計算のお知らせ・推定の欄を並べます。いつも現状の世帯を見ます（プランの編集中は、そのプランで足した物の行も出します）。数は欄の数（○か所）で、注意・お知らせは件数です。</p>
            <p>仮の値（生年月など、推定できない欄に計算のために置いた値）は、未入力に出します。前提条件の既定の値のままの前提は、いちばん下の「前提条件の標準の値」にまとめます（推定の数には入れません）。</p>
            <p>「入っていない所を推定で入れる」は、入っていない物（教育費・退職金・住居費など）を推定で入れます。「推定のままの値を「この値にする」」は、推定のままの値をその値のまま確定にします（確定にすると、家族や収入を直しても推定で入れ直されません）。</p>
            <p>書類待ちは、欄で「書類で確かめる」にした所です（住民税は住民税の決定通知書、退職金・企業年金は会社の退職金規程・制度の資料、年金の加入月数はねんきん定期便、住宅ローン・自動車ローンは返済予定表、手術の額は保険証券）。確かめるまでは代わりの値で計算し、書類の値を打つか「この値にする」で消えます。「書類のお願いにまとめる」で、送ってもらう書類の一覧とお願いの文を出せます。</p>
            <p>「開く」でその欄に移ります（移るだけでは値も状態も変わりません）。推定・書類待ち・確かさの行は「根拠」で根拠が開きます。</p>
            <p>確かさが申告・概算の値は、確かさか状態で絞り込んだときだけ出します。「次回確かめる」は、次の面談・見直しで確かめる所の印です（世帯に残ります。計算は変わりません）。</p>
            <p>お客さまと確かめてそのままでよい注意（医療保険を2本とも続けるなど）は「確認した」で隠せます。中身が変わると、また出ます。隠した注意は状態の「確認した注意」で見られ、「また出す」で戻せます。</p>
          </Help>
        </h2>
        <p class="ck-lead" data-ck-lead>
          {[
            kindCount("missing", counts.missing, "未入力"),
            ...(counts.notStarted > 0 ? [kindCount("notStarted", counts.notStarted, "まだ入れていない")] : []),
            kindCount("unknown", counts.unknown),
            kindCount("notice", counts.notice),
            ...(counts.calc > 0 ? [kindCount("calc", counts.calc, "計算のお知らせ")] : []),
            kindCount("estimated", counts.estimated),
            ...(marks.length > 0 ? [`次回確かめる ${marks.length}か所`] : []),
            ...(acked.length > 0 ? [`確認した注意 ${acked.length}件`] : []),
          ].join("・")}
        </p>
        <div class="ck-tools">
          <label>
            入力項目
            <select value={card} onChange={put("card")} data-ck-card>
              <option value="">すべて</option>
              {cards.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            状態
            <select value={kind} onChange={put("kind")} data-ck-kind-filter>
              <option value="">すべて</option>
              {KIND_ORDER.map((k) => (
                <option key={k} value={k}>
                  {CHECK_KIND_LABELS[k]}
                </option>
              ))}
              <option value="recheck">次回確かめる（印の行）</option>
              {acked.length > 0 || kind === "acked" ? <option value="acked">確認した注意（また出せます）</option> : null}
            </select>
          </label>
          <label>
            出どころ
            <select value={filter.origin} onChange={put("origin")} data-ck-origin>
              <option value="">すべて</option>
              {(Object.keys(ORIGIN_LABELS) as OriginKind[]).map((k) => (
                <option key={k} value={k}>
                  {ORIGIN_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            確かさ
            <select value={filter.certainty} onChange={put("certainty")} data-ck-certainty>
              <option value="">すべて</option>
              {(Object.keys(CERTAINTY_LABELS) as Certainty[]).map((k) => (
                <option key={k} value={k}>
                  {CERTAINTY_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div class="ck-tools">
          {fillable > 0 ? (
            <button
              type="button"
              class="add-btn"
              onClick={() => {
                const r = fillAll(wh, card === "" ? undefined : card);
                if (r.count > 0) onEdit(r.wh, `推定で入れました（${r.count}か所）`);
              }}
              data-ck-fill-all
            >
              {fillAllLabel(fillable, card === "" ? "" : "この項目")}
            </button>
          ) : null}
          {estimated > 0 && !asking ? (
            <button type="button" class="add-btn" onClick={() => setAsking(true)} title="推定のままの値を、その値のまま確定にします（押すと確かめの1行が出ます）" data-ck-confirm-all>
              {confirmAllLabel(estimated, card === "" ? "全部" : "この項目")}
            </button>
          ) : null}
          {marks.length > 0 ? (
            <button type="button" class="add-btn" onClick={() => void copy()} data-ck-recheck-copy title="印の付いた行を、面談で確かめることの文にして写します">
              次回確かめることを写す（{marks.length}件）
            </button>
          ) : null}
        </div>
        {asking && estimated > 0 ? (
          <p class="ck-ask" role="alert" data-ck-confirm-ask>
            {CONFIRM_ALL_NOTE}
            <button
              type="button"
              class="btn small primary"
              onClick={() => {
                setAsking(false);
                const r = confirmAllEstimates(wh, card === "" ? undefined : card);
                if (r.count > 0) onEdit(r.wh, `推定のままの値を「この値にする」にしました（${r.count}か所）`);
              }}
              data-ck-confirm-run
            >
              この値にする（{estimated}か所）
            </button>
            <button type="button" class="btn small" onClick={() => setAsking(false)} data-ck-confirm-cancel>
              キャンセル
            </button>
          </p>
        ) : null}
        {note !== null ? (
          <p class="in-note" role="status">
            {note}
          </p>
        ) : null}
        {copied !== null ? <textarea class="ck-copy" readOnly value={copied} rows={Math.min(12, copied.split("\n").length + 1)} aria-label="次回確かめること" data-ck-recheck-text /> : null}
      </div>
      {kind === "acked" && shownAcked.length === 0 ? <p class="in-note">「確認した」にした注意はありません。</p> : null}
      {kind !== "acked" && shown.length === 0 && shownPlan.length === 0 && premise.length === 0 ? <p class="in-note">確かめる所はありません。</p> : null}
      {shownPlan.length > 0 && plan !== undefined ? (
        <div class="ck-kind ck-plan" data-ck-kind="plan">
          <h3>
            {plan.label}で足した物（{shownPlan.length}）
          </h3>
          <ul>{shownPlan.map((r) => line(r, true))}</ul>
        </div>
      ) : null}
      {kinds.map((k) => {
        const list = shown.filter((r) => r.kind === k);
        if (list.length === 0) return null;
        return (
          <div class={`ck-kind ck-${k}`} key={k} data-ck-kind={k}>
            <h3>
              {CHECK_KIND_LABELS[k]}（{list.length}{KIND_UNITS[k]}）
              {k === "unknown" && onDocRequests !== undefined ? (
                <button type="button" class="link-btn ck-docs" onClick={onDocRequests} data-ck-doc-requests title="書類待ちの欄を、お客さまに送ってもらう書類の一覧にまとめます">
                  書類のお願いにまとめる
                </button>
              ) : null}
            </h3>
            <ul>{list.map((r) => line(r, false))}</ul>
          </div>
        );
      })}
      {/* 前提条件の標準の値: 推定の数とまとめての操作に入れず、いちばん下の折りたたみの1行（状態で「前提条件の標準の値」を選ぶと、ほかの種類と同じに並ぶ） */}
      {kind === "" && premise.length > 0 ? (
        <details class="ck-kind ck-premise" data-ck-kind="premise-fold">
          <summary>
            {CHECK_KIND_LABELS.premise}（{premise.length}{KIND_UNITS.premise}）
          </summary>
          <p class="in-note">前提条件の入力項目の、既定の値のままの前提です。事務所の既定値か、この世帯に合わせて前提条件の入力項目で直します（推定の数には入れていません）。</p>
          <ul>{premise.map((r) => line(r, false))}</ul>
        </details>
      ) : null}
      {kind === "recheck" ? <RecheckGone wh={wh} rows={all} /> : null}
      {shownAcked.length > 0 ? (
        <div class="ck-kind ck-acked" data-ck-kind="acked">
          <h3>確認した注意（{shownAcked.length}）</h3>
          <ul>
            {shownAcked.map((r) => (
              <li key={r.id} data-ck-acked={r.id}>
                <span class="ck-card">{r.cardLabel}</span>
                <span class="ck-label">{r.label}</span>
                {r.detail !== null ? <span class="ck-detail">{r.detail}</span> : null}
                <span class="ck-acts">
                  {r.actions.map((a) => (
                    <button type="button" key={a.key} class="link-btn" onClick={() => run(r, a.key)} {...(a.title !== undefined ? { title: a.title } : {})} data-ck-action={a.key}>
                      {a.label}
                    </button>
                  ))}
                  <button type="button" class="link-btn" onClick={() => onOpen(r.card, r.fieldKey, r.level)} data-ck-open>
                    開く
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** 印を付けた行のうち、今は確かめの一覧に無い行（確定した・物を外した） */
function RecheckGone({ wh, rows }: { wh: WorkingHousehold; rows: readonly CheckRow[] }) {
  const ids = new Set(rows.map((r) => r.id));
  const gone = recheckMarks(wh).filter((m) => !ids.has(m.id));
  if (gone.length === 0) return null;
  return (
    <div class="ck-kind ck-gone" data-ck-kind="gone">
      <h3>印を付けた行のうち、今は一覧に無いもの（{gone.length}）</h3>
      <ul>
        {gone.map((m) => (
          <li key={m.id} data-ck-gone={m.id}>
            <span class="ck-card">{m.cardLabel}</span>
            <span class="ck-label">{m.label}</span>
            <span class="ck-detail">{m.on} に印。確定したか物を外したため、一覧からは消えました（書き出しには残ります）</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
