// 確かめの一覧（入力のホームの道具。0041）: 未入力・わからない・確かめの注意・推定を並べ、行から欄へ移る（「開く」）。
// 行の操作（推定で埋める・該当なし・確定）とまとめての操作は、世帯を直す（元に戻すで戻せる）。欄に移るだけでは何も変えない
import { useMemo, useState } from "preact/hooks";
import type { Level } from "./form.ts";
import type { WorkingHousehold } from "./household.ts";
import type { NoticeRow } from "../engineNotices.ts";
import { CHECK_KIND_LABELS, checkCounts, checkList, confirmAllEstimates, fillAll, KIND_ORDER, type CheckKind, type CheckRow } from "./checkRows.ts";

interface Props {
  wh: WorkingHousehold;
  /** 世帯を直した（操作の名前つき。親が保存して計算し直す） */
  onEdit: (next: WorkingHousehold, done: string) => void;
  /** カードを開いて欄に移る */
  onOpen: (card: string, fieldKey: string | null, level: Level) => void;
  /** 現状の計算結果の知らせ（入力で直せるものを「計算の知らせ」に出す。0064） */
  notices?: readonly NoticeRow[];
}

const KINDS = KIND_ORDER;

/** 入力のホームの見出しの下に出す、確かめの一覧の入口の数（未入力・わからない・推定） */
export function checkSummary(wh: WorkingHousehold, notices: readonly NoticeRow[] = []): { total: number; counts: Record<CheckKind, number> } {
  const counts = checkCounts(checkList(wh, notices));
  return { total: counts.missing + counts.unknown + counts.notice + counts.calc + counts.estimated, counts };
}

const NO_NOTICES: readonly NoticeRow[] = [];

export function CheckList({ wh, onEdit, onOpen, notices = NO_NOTICES }: Props) {
  const rows = useMemo(() => checkList(wh, notices), [wh, notices]);
  const [card, setCard] = useState<string>("");
  const cards = useMemo(() => [...new Map(rows.map((r) => [r.card, r.cardLabel])).entries()], [rows]);
  const shown = card === "" ? rows : rows.filter((r) => r.card === card);
  const counts = checkCounts(rows);
  const fillable = shown.filter((r) => r.kind === "missing" && r.actions.some((a) => a.key === "fill")).length;
  const estimated = rows.filter((r) => r.kind === "estimated").length;
  const run = (r: CheckRow, key: string) => {
    const a = r.actions.find((x) => x.key === key);
    if (a === undefined) return;
    const next = a.run(wh);
    if (next !== wh) onEdit(next, `「${r.label}」: ${a.label}`);
  };
  return (
    <section class="ck" aria-label="確かめの一覧" data-checklist>
      <div class="ck-head">
        <h2>確かめの一覧</h2>
        <p class="ck-lead">
          未入力 {counts.missing}・わからない {counts.unknown}・確かめの注意 {counts.notice}
          {counts.calc > 0 ? `・計算の知らせ ${counts.calc}` : ""}・推定 {counts.estimated}。「開く」でその欄に移ります（移るだけでは値も状態も変わりません）。
        </p>
        <div class="ck-tools">
          <label>
            カード
            <select value={card} onChange={(e) => setCard((e.currentTarget as HTMLSelectElement).value)} data-ck-card>
              <option value="">すべて</option>
              {cards.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {fillable > 0 ? (
            <button
              type="button"
              class="add-btn"
              onClick={() => {
                const r = fillAll(wh, card === "" ? undefined : card);
                if (r.count > 0) onEdit(r.wh, `推定で埋めました（${r.count}件）`);
              }}
              data-ck-fill-all
            >
              推定で埋める（{card === "" ? "まとめて" : "このカード"} {fillable}件）
            </button>
          ) : null}
          {estimated > 0 && card === "" ? (
            <button
              type="button"
              class="add-btn"
              onClick={() => {
                const r = confirmAllEstimates(wh);
                if (r.count > 0) onEdit(r.wh, `推定をまとめて確定しました（${r.count}つ）`);
              }}
              data-ck-confirm-all
            >
              推定をまとめて確定（全部 {estimated}つ）
            </button>
          ) : null}
        </div>
      </div>
      {shown.length === 0 ? <p class="in-note">確かめる所はありません。</p> : null}
      {KINDS.map((k) => {
        const list = shown.filter((r) => r.kind === k);
        if (list.length === 0) return null;
        return (
          <div class={`ck-kind ck-${k}`} key={k} data-ck-kind={k}>
            <h3>
              {CHECK_KIND_LABELS[k]}（{list.length}）
            </h3>
            <ul>
              {list.map((r) => (
                <li key={r.id} data-ck-row={r.id}>
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
        );
      })}
    </section>
  );
}
