// 入力のホーム（作業の層の部品）: 項目ごとのカードを同じ大きさのグリッドで並べ、押すと中央に入力のパネルが開く。
// カードに出すのは「イラスト＋名前＋要約の数字1つ＋状態」まで。上部に「○項目中○項目 入力済み」と項目ごとのマスの進み具合。
// 項目が増えたら、まとまりの見出しで区切る（items.ts の GROUP_HEADINGS_FROM）。「＋ 項目を追加」で FP が項目を足せる
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";
import type { Level } from "./form.ts";
import type { WorkingHousehold } from "./household.ts";
import { ILLUSTRATIONS } from "./illustrations.ts";
import { InputPanel } from "./InputPanel.tsx";
import { ADD_OPTIONS, addItem, groupedItems, inputItems, progressOf, type InputItem } from "./items.ts";
import { StatusBadge, statusText } from "./StatusBadge.tsx";
import { CheckList, checkSummary } from "./CheckList.tsx";
import { DiffList, DiffListToggle, PlanTarget, type PlanEditProps } from "./PlanEdit.tsx";
import { countsByCard, diffRows, planIndex, planView, recordPlanEdit } from "../plans/planEdit.ts";

interface Props {
  wh: WorkingHousehold;
  /** パネルで「保存」した世帯（親が計算し直す） */
  onSave: (next: WorkingHousehold) => void;
  level: Level;
  onLevel: (l: Level) => void;
  /** 開いたときにパネルを開く項目（URL の #open=work など。画面の確かめ用） */
  initialOpen?: string;
  /** 進み具合の下に置く道具（ヒアリングシートの書き出しと取り込み）。カードの並びの上に出す */
  tools?: ComponentChildren;
  /** 1件だけの計算（基本生活費のパネルの、控えから見た実際の貯まり方。0031） */
  computeOne?: (req: EngineRequest) => Promise<PreviewResult | null>;
  /**
   * 明細から生活費を出すパネル（0034）。入口は基本生活費のパネルの見出しの横の「明細から出す」だけ。
   * render の back は、閉じたとき（承認したときは入れた件数つき）に呼ぶ。基本生活費のパネルに戻る
   */
  statement?: { render: (back: (approved?: number) => void) => ComponentChildren; initialOpen?: boolean };
  /**
   * プランを直す道具（0036 の8）。編集の対象にプランを選ぶと、カードとパネルはそのプランの中身を見せ、直したことはそのプランの差分になる。
   * 取り込み・ヒアリング・明細の承認・確かめの一覧は、プランを選んでいても現状を直す
   */
  plans?: PlanEditProps;
}

function Card({ item, onOpen, flash, diffs }: { item: InputItem; onOpen: (id: string) => void; flash: boolean; diffs?: { label: string; n: number } | undefined }) {
  const s = item.summary;
  return (
    <button type="button" class={`ih-card s-${item.status}${flash ? " flash" : ""}`} style={{ "--c": item.color }} data-card={item.id} aria-label={`${item.label}（${statusText(item)}）を開く`} onClick={() => onOpen(item.id)}>
      <span class="ih-ill" aria-hidden="true">
        <img src={ILLUSTRATIONS[item.art]} alt="" />
      </span>
      <span class="ih-body">
        <span class="ih-name">
          {item.label}
          {item.added !== null ? <span class="fp-tag">FPが追加</span> : null}
          {diffs !== undefined && diffs.n > 0 ? (
            <span class="plan-count" data-plan-count={diffs.n}>
              {diffs.label}: {diffs.n}か所
            </span>
          ) : null}
        </span>
        <span class="ih-sum">
          {item.status === "none" ? (
            <span class="yet">まだ入っていません</span>
          ) : s === null ? (
            <span class="yet">なし</span>
          ) : (
            <>
              {s.pre !== undefined ? <small>{s.pre}</small> : null}
              {s.main}
              {s.unit !== undefined ? <small>{s.unit}</small> : null}
            </>
          )}
        </span>
      </span>
      <StatusBadge item={item} />
      <span class="ih-band" aria-hidden="true" />
    </button>
  );
}

function AddCard({ open, onOpen, onPick }: { open: boolean; onOpen: (v: boolean) => void; onPick: (key: string) => void }) {
  if (!open)
    return (
      <div class="ih-card ih-add">
        <button type="button" class="ih-add-main" onClick={() => onOpen(true)} data-add-open>
          <span class="ih-plus" aria-hidden="true">
            ＋
          </span>
          <span>
            項目を追加
            <small>ペット・留学・名前を付けた支出・介護など、FPが項目を足せます</small>
          </span>
        </button>
      </div>
    );
  return (
    <div class="ih-card ih-add">
      <div class="ih-add-menu" role="group" aria-label="足す項目を選ぶ">
        <p>どの項目を足しますか</p>
        {ADD_OPTIONS.map((o) => (
          <button type="button" key={o.key} onClick={() => onPick(o.key)} data-add={o.key}>
            <span class="nm">{o.label}</span>
            <small>{o.note}</small>
          </button>
        ))}
        <button type="button" disabled title="FPが名前・単位・計算への入れ方を決める項目は、拡張領域の仕組みといっしょに作ります">
          <span class="nm">自由な項目を作る</span>
          <small>準備中</small>
        </button>
        <button type="button" class="cancel" onClick={() => onOpen(false)}>
          キャンセル
        </button>
      </div>
    </div>
  );
}

export function InputView({ wh, onSave, level, onLevel, initialOpen, tools, computeOne, statement, plans }: Props) {
  /** 直しているプラン（直せないときは現状） */
  const editing = plans !== undefined && plans.sel !== null && plans.lock === null ? (plans.list.find((x) => x.id === plans.sel) ?? null) : null;
  const pcat = plans?.cat;
  /** カードに見せる世帯（プランを直しているときはそのプランの中身。カードの要約・状態もプランの中身から） */
  const shown = useMemo(() => (editing === null || pcat === undefined ? wh : planView(wh, pcat, editing.id)), [wh, editing, pcat]);
  const rows = useMemo(() => (editing === null || pcat === undefined ? [] : diffRows(wh, pcat, editing.id, planIndex([wh, shown]))), [wh, editing, pcat, shown]);
  const counts = useMemo(() => countsByCard(rows), [rows]);
  const [diffOpen, setDiffOpen] = useState(false);
  const items = useMemo(() => inputItems(shown), [shown]);
  const groups = useMemo(() => groupedItems(items), [items]);
  const p = progressOf(items);
  const [openId, setOpenId] = useState<string | null>(initialOpen !== undefined && items.some((i) => i.id === initialOpen) ? initialOpen : null);
  const [addDraft, setAddDraft] = useState<WorkingHousehold | null>(null);
  const [addMenu, setAddMenu] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [statementOpen, setStatementOpen] = useState(statement?.initialOpen === true);
  const [checkOpen, setCheckOpen] = useState(initialOpen === "check");
  /** 確かめの一覧から開いたときに移る欄 */
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const check = useMemo(() => checkSummary(wh), [wh]);
  const backTo = useRef<string | null>(null);

  // パネルを閉じたら、押したカードに戻る
  useEffect(() => {
    if (openId !== null || backTo.current === null) return;
    const el = document.querySelector<HTMLElement>(`[data-card="${backTo.current}"]`) ?? document.querySelector<HTMLElement>("[data-add-open]");
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest" });
    backTo.current = null;
  }, [openId]);
  useEffect(() => {
    if (flashId === null) return;
    const t = setTimeout(() => setFlashId(null), 1600);
    return () => clearTimeout(t);
  }, [flashId]);
  useEffect(() => {
    if (toast === null) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const open = (id: string) => {
    setAddDraft(null);
    setFocusKey(null);
    setOpenId(id);
  };
  // 確かめの一覧の「開く」: カードを開いて欄に移る（詳細の欄なら詳細にする）。移るだけで値も状態も変えない
  const openField = (id: string, key: string | null, l: Level) => {
    if (l === "detail" && level !== "detail") onLevel("detail");
    setAddDraft(null);
    setFocusKey(key);
    setOpenId(id);
  };
  const close = () => {
    backTo.current = openId;
    setOpenId(null);
    setAddDraft(null);
    setFocusKey(null);
  };
  const pick = (key: string) => {
    const r = addItem(shown, key);
    if (r === null) return;
    setAddMenu(false);
    // プランを直しているときは、足した物をそのプランの足す差分にした世帯を下書きにする
    setAddDraft(editing !== null && pcat !== undefined ? recordPlanEdit(wh, pcat, editing.id, shown, r.wh) : r.wh);
    setOpenId(r.itemId);
  };
  // 基本生活費のパネル → 明細のパネル → 基本生活費のパネル（承認した値が見えるように、保存した世帯から開き直す）
  const openStatement = (saved?: WorkingHousehold) => {
    if (saved !== undefined) onSave(saved);
    backTo.current = null;
    setOpenId(null);
    setAddDraft(null);
    setStatementOpen(true);
  };
  const backFromStatement = (approved?: number) => {
    setStatementOpen(false);
    setAddDraft(null);
    setOpenId("living");
    if (approved !== undefined) setToast(`明細から${approved}件を入れました`);
  };
  const save = (next: WorkingHousehold, id: string) => {
    const label = inputItems(next).find((i) => i.id === id)?.label;
    if (editing !== null && plans !== undefined) plans.onSavePlan(next);
    else onSave(next);
    backTo.current = id;
    setOpenId(null);
    setAddDraft(null);
    setFlashId(id);
    setToast(editing !== null ? `「${label ?? ""}」を${editing.label}に保存しました` : label !== undefined ? `「${label}」を保存しました` : "保存しました");
  };

  return (
    <div class={`ih${editing !== null ? " plan-mode" : ""}`} style={editing !== null ? { "--plan-c": editing.color } : {}}>
      <div class="ih-head">
        <div>
          <h1>入力</h1>
          <p class="ih-lead">カードを押すと、入力のパネルが開きます。空欄は統計の目安などで補って計算します（「推定あり」の印）。保存した世帯は、世帯ごとに暗号化して自動で保存します（見本の世帯は保存しません。上の「世帯」から保存できます）。</p>
        </div>
        <div class="ih-prog" aria-live="polite">
          <div class="ih-prog-line" data-progress>
            {p.total}項目中 <span class="n">{p.done}</span>項目 入力済み
          </div>
          <div class="ih-prog-bar" aria-hidden="true">
            {items.map((i) => (
              <i key={i.id} class={i.status} />
            ))}
          </div>
          <div class="ih-prog-key">
            <span>
              <StatusBadge item={{ status: "done", estimated: 0 }} mini /> {p.done}
            </span>
            <span>
              <span class="ih-st est mini">推定あり</span> {p.est}
            </span>
            <span>
              <StatusBadge item={{ status: "none", estimated: 0 }} mini /> {p.none}
            </span>
          </div>
        </div>
      </div>
      {plans !== undefined && (plans.list.length > 0 || plans.sel !== null) ? <PlanTarget p={plans} /> : null}
      {editing !== null && pcat !== undefined ? (
        <div class="ih-check">
          <DiffListToggle rows={rows} open={diffOpen} onOpen={setDiffOpen} />
        </div>
      ) : null}
      {editing !== null && pcat !== undefined && diffOpen && plans !== undefined ? <DiffList rows={rows} wh={wh} planId={editing.id} cat={pcat} onEdit={plans.onSavePlan} onOpen={open} /> : null}
      {tools !== undefined ? (
        <div class="ih-tools">
          {editing !== null ? <p class="in-note" data-current-only>取り込み・ヒアリング・明細の承認は、プランを選んでいても現状に入ります（プランの差分にはしません）。</p> : null}
          {tools}
        </div>
      ) : null}
      <div class="ih-check">
        <button type="button" class="add-btn" aria-expanded={checkOpen} onClick={() => setCheckOpen(!checkOpen)} data-check-open>
          {editing !== null ? "現状の" : ""}確かめの一覧（未入力 {check.counts.missing}・わからない {check.counts.unknown}・注意 {check.counts.notice}・推定 {check.counts.estimated}）
        </button>
      </div>
      {checkOpen ? (
        <CheckList
          wh={wh}
          onOpen={openField}
          onEdit={(next, done) => {
            onSave(next);
            setToast(done);
          }}
        />
      ) : null}
      {groups.map((g, gi) => (
        <section class="ih-group" key={g.group?.id ?? "all"} aria-label={g.group?.label ?? "入力の項目"}>
          {g.group !== null ? <h2 class="ih-gh">{g.group.label}</h2> : null}
          <div class="ih-cards">
            {g.items.map((i) => (
              <Card key={i.id} item={i} onOpen={open} flash={flashId === i.id} diffs={editing !== null ? { label: editing.label, n: counts.get(i.id) ?? 0 } : undefined} />
            ))}
            {gi === groups.length - 1 ? <AddCard open={addMenu} onOpen={setAddMenu} onPick={pick} /> : null}
          </div>
        </section>
      ))}
      {openId !== null ? (
        <InputPanel
          key={`${openId}:${editing?.id ?? ""}`}
          wh={wh}
          itemId={openId}
          {...(addDraft !== null ? { initialDraft: addDraft } : {})}
          level={level}
          onLevel={onLevel}
          onSave={save}
          onClose={close}
          {...(focusKey !== null ? { focusKey } : {})}
          {...(computeOne !== undefined ? { computeOne } : {})}
          {...(openId === "living" && statement !== undefined && editing === null ? { onStatement: openStatement } : {})}
          {...(editing !== null && pcat !== undefined ? { plan: { id: editing.id, label: editing.label, color: editing.color, cat: pcat } } : {})}
        />
      ) : null}
      {statement !== undefined && statementOpen ? statement.render(backFromStatement) : null}
      <div class={`toast${toast !== null ? " on" : ""}`} role="status" aria-live="polite">
        {toast ?? ""}
      </div>
    </div>
  );
}
