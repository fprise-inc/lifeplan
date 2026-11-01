// 入力画面でプランを直すときの部品（0036 の8・0043・0077）: 編集の対象（現状・プラン）の選び方、違いの一覧。
// 欄の部品の外側だけを持つ（欄の印と「↺ 現状に戻す」は FieldViews.tsx の PlanMarksContext）
import { useEffect, useRef, useState } from "preact/hooks";
import { Help } from "../../presentation/Help.tsx";
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
  /** 結果のタブへ（選んでいるプランのまま。0072） */
  onResults?: () => void;
}

/**
 * 編集の対象の選び方（0077）。プランの色は、この箱の枠と左の小さな点だけに使う（画面全体の色・左の帯は出さない）。
 * 現状とプランで箱の中の並びと大きさを変えない（プランの操作は「プランの操作」の中にまとめ、選んでも配置が1ピクセルも動かない）
 */
export function PlanTarget({ p, diffs, initialMenu = false }: { p: PlanEditProps; diffs?: { rows: readonly DiffRow[]; open: boolean; onOpen: (v: boolean) => void }; initialMenu?: boolean }) {
  const cur = p.list.find((x) => x.id === p.sel) ?? null;
  const [menu, setMenu] = useState(initialMenu);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (box.current !== null && e.target instanceof Node && box.current.contains(e.target)) return;
      setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setMenu(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [menu]);
  const pick = (f: () => void) => () => {
    setMenu(false);
    f();
  };
  return (
    <div ref={box} class={`ih-target${cur !== null ? " on" : ""}`} style={cur !== null ? { "--plan-c": cur.color } : {}} data-plan-target>
      <span class="ih-target-dot" aria-hidden="true" />
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
        <span class="vh" role="status" data-plan-band>
          {cur.label}を編集中（現状は変わりません）
        </span>
      ) : null}
      <Help label="編集の対象" id="plan-target">
        <p>現状を直すと、保存したプランにも反映されます。プランが指していた物を外すと、そのプランに「要確認」が出ます。</p>
        <p>プランを選ぶと、入力項目とパネルはそのプランの中身を見せ、直したことはそのプランの差分になります（現状は変わりません）。入力項目の「プランB: 1か所」は、現状と違う所の数です。</p>
        <p>取り込み・確かめの一覧・入力項目の「該当なし」「推定で入れる」は、いつも現状を直します。</p>
      </Help>
      <div class="ih-target-menu">
        <button type="button" class="add-btn" aria-expanded={menu} aria-haspopup="true" onClick={() => setMenu(!menu)} data-plan-menu>
          プランの操作 {menu ? "▴" : "▾"}
        </button>
        {menu ? (
          <div class="ih-target-list" role="group" aria-label="プランの操作" data-plan-menu-list>
            {cur !== null && diffs !== undefined ? <DiffListToggle rows={diffs.rows} open={diffs.open} onOpen={(v) => pick(() => diffs.onOpen(v))()} /> : null}
            {cur !== null && p.onResults !== undefined ? (
              <button type="button" class="link-btn" onClick={pick(p.onResults)} data-plan-results>
                結果を見る
              </button>
            ) : null}
            <button type="button" class="link-btn" onClick={pick(() => p.onNew(null))} data-plan-new>
              ＋ 現状から新しいプラン
            </button>
            {cur !== null ? (
              <>
                <button type="button" class="link-btn" onClick={pick(() => p.onCopy(cur.id))} data-plan-copy>
                  このプランを複製
                </button>
                <button type="button" class="link-btn" onClick={pick(() => p.onNew(cur.id))} data-plan-on-base>
                  このプランを土台に
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {p.lock !== null && cur !== null ? (
        <Help label="直せない理由" mark="入力では直せません" markClass="ih-target-lock" id="plan-lock">
          <p data-plan-lock>{p.lock}</p>
        </Help>
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
      {rows.length === 0 ? <p class="in-note">現状と違う所はまだありません。入力項目を開いて欄を直すと、ここに並びます。</p> : null}
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
