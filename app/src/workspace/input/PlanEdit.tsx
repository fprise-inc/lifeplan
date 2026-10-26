// 入力画面でプランを直すときの部品（0036 の8・0043）: 編集の対象（現状・プラン）の選び方、プランの色の帯、違いの一覧。
// 欄の部品の外側だけを持つ（欄の印と「↺ 現状に戻す」は FieldViews.tsx の PlanMarksContext）
import type { WorkingHousehold } from "./household.ts";
import type { Catalog } from "../plans/items.ts";
import { acknowledgeRow, revertRow, toggleRow, type DiffRow } from "../plans/planEdit.ts";

export interface PlanChoice {
  id: string;
  /** 例: 「プランB」 */
  label: string;
  /** プランの名前（例: 「プランB 借入を500万円減らす」） */
  name: string;
  color: string;
}

/** 入力のホームの、プランを直すための道具（App が渡す） */
export interface PlanEditProps {
  list: PlanChoice[];
  /** 直している対象（null は現状） */
  sel: string | null;
  onSelect: (id: string | null) => void;
  /** 新しいプラン: 現状から（base null）・このプランを土台に（base はプランの ID） */
  onNew: (base: string | null) => void;
  /** このプランを複製 */
  onCopy: (id: string) => void;
  cat: Catalog;
  /** プランの差分を直した世帯（現状は同じ）を入れる */
  onSavePlan: (next: WorkingHousehold) => void;
  /** 選んだプランを入力で直せない理由（結果のタブに保存していない変更があるなど）。直せるなら null */
  lock: string | null;
}

/** 編集の対象の選び方とプランの色の帯 */
export function PlanTarget({ p }: { p: PlanEditProps }) {
  const cur = p.list.find((x) => x.id === p.sel) ?? null;
  return (
    <div class={`ih-target${cur !== null ? " on" : ""}`} style={cur !== null ? { "--plan-c": cur.color } : {}} data-plan-target>
      <label>
        編集の対象
        <select
          value={p.sel ?? ""}
          onChange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            p.onSelect(v === "" ? null : v);
          }}
          data-plan-select
        >
          <option value="">現状</option>
          {p.list.map((x) => (
            <option value={x.id} key={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      {cur !== null ? (
        <span class="ih-target-note" data-plan-band>
          <b>{cur.label}</b>を編集中（現状は変わりません）
        </span>
      ) : (
        <span class="ih-target-note">入力（現状）を直すと、保存したプランにも反映されます</span>
      )}
      <span class="ih-target-gap" />
      <button type="button" class="link-btn" onClick={() => p.onNew(null)} data-plan-new>
        ＋ 現状から新しいプラン
      </button>
      {cur !== null ? (
        <>
          <button type="button" class="link-btn" onClick={() => p.onCopy(cur.id)} data-plan-copy>
            このプランを複製
          </button>
          <button type="button" class="link-btn" onClick={() => p.onNew(cur.id)} data-plan-on-base>
            このプランを土台に
          </button>
        </>
      ) : null}
      {p.lock !== null && cur !== null ? (
        <p class="ih-target-lock" role="note" data-plan-lock>
          {p.lock}
        </p>
      ) : null}
    </div>
  );
}

const REVIEW_FIRST = (r: DiffRow) => r.enabled && r.review !== null && r.review.state !== "ok";

/**
 * 違いの一覧（0036 の8）: 差分1件ずつ（置き換えの組は1件）に「何を・現状 → プラン」・オン／オフ・戻す・要確認・出どころ。要確認を上に、
 * カードごとに並べる。オフにした差分・連鎖で一緒に外す差分も出す
 */
export function DiffList({ rows, wh, planId, cat, onEdit, onOpen }: { rows: readonly DiffRow[]; wh: WorkingHousehold; planId: string; cat: Catalog; onEdit: (next: WorkingHousehold) => void; onOpen: (card: string) => void }) {
  const review = rows.filter(REVIEW_FIRST);
  const rest = rows.filter((r) => !REVIEW_FIRST(r));
  const cards: { card: string | null; label: string; rows: DiffRow[] }[] = [];
  for (const r of rest) {
    const g = cards.find((c) => c.card === r.card);
    if (g !== undefined) g.rows.push(r);
    else cards.push({ card: r.card, label: r.cardLabel, rows: [r] });
  }
  const line = (r: DiffRow) => (
    <li key={r.key} class={`dl-row${r.enabled ? "" : " off"}${r.cause !== null ? " follower" : ""}${REVIEW_FIRST(r) ? " review" : ""}`} data-diff-row={r.key} data-diff-kind={r.kind}>
      <label class="dl-on" title={r.inherited ? "土台のプランの差分は、土台のプランでオン・オフします" : "オフにすると、この差分を当てずに計算します（差分は残ります）"}>
        <input type="checkbox" checked={r.enabled} disabled={r.inherited} onChange={(e) => onEdit(toggleRow(wh, planId, r, (e.currentTarget as HTMLInputElement).checked))} data-diff-toggle />
        <span class="sr">{r.enabled ? "オン" : "オフ"}</span>
      </label>
      <span class="dl-l">
        {r.label}
        {r.cause !== null ? <small class="dl-tag">一緒に外す</small> : null}
        {r.followers > 0 ? <small class="dl-tag">ほか{r.followers}件を一緒に外す</small> : null}
      </span>
      <span class="dl-v">
        {r.from} → <b>{r.to}</b>
      </span>
      <span class="dl-o">
        {r.inherited ? `土台（${r.planName}）・` : ""}
        {r.origin}
        {r.enabled ? "" : "・オフ"}
      </span>
      <span class="dl-act">
        {r.card !== null ? (
          <button type="button" class="link-btn" onClick={() => onOpen(r.card as string)}>
            開く
          </button>
        ) : null}
        <button type="button" class="link-btn" onClick={() => onEdit(revertRow(wh, cat, planId, r))} data-diff-revert>
          ↺ 戻す
        </button>
      </span>
      {REVIEW_FIRST(r) ? (
        <span class="dl-note">
          <b>要確認:</b> {r.review?.note}
          {r.review?.state === "changed" ? (
            <button type="button" class="link-btn" onClick={() => onEdit(acknowledgeRow(wh, cat, planId, r))} data-diff-ack>
              確認した（このまま）
            </button>
          ) : null}
        </span>
      ) : null}
    </li>
  );
  return (
    <section class="diff-list" aria-label="違いの一覧" data-diff-list>
      {rows.length === 0 ? <p class="in-note">現状と違う所はまだありません。カードを開いて欄を直すと、ここに並びます。</p> : null}
      {review.length > 0 ? (
        <>
          <h3>要確認</h3>
          <ul>{review.map(line)}</ul>
        </>
      ) : null}
      {cards.map((c) => (
        <div key={c.card ?? "other"}>
          <h3>{c.label}</h3>
          <ul>{c.rows.map(line)}</ul>
        </div>
      ))}
    </section>
  );
}

/** 違いの一覧を開くボタン（数と要確認の数） */
export function DiffListToggle({ rows, open, onOpen }: { rows: readonly DiffRow[]; open: boolean; onOpen: (v: boolean) => void }) {
  const on = rows.filter((r) => r.enabled).length;
  const off = rows.length - on;
  const rv = rows.filter(REVIEW_FIRST).length;
  return (
    <button type="button" class="add-btn" aria-expanded={open} onClick={() => onOpen(!open)} data-diff-open>
      違いの一覧（{on}件{off > 0 ? `・オフ ${off}` : ""}{rv > 0 ? `・要確認 ${rv}` : ""}）
    </button>
  );
}
