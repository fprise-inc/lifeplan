// 入力のホーム（作業の層の部品）: 14枚のカードを同じ大きさのグリッドで並べ、押すと中央に入力のパネルが開く。
// カードに出すのは「イラスト＋名前＋要約の数字1つ＋状態（4つ）」まで。最初の5枚のほかのカードは、未入力・推定のときに何で計算しているかの1行と、
// 「当てはまらない」「目安で入れる」の1押しを出す。上部に進み具合（未入力〔0円の所あり〕の数を左に強く、続けて入力済み・推定で計算中・当てはまらない）。
// カードの下にピン（ホームに出した物。押すとその物だけを開く。進み具合に数えない）。「＋ 項目を追加」で足した物は属するカードに入り、ピンが出る
import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";
import type { Level } from "./form.ts";
import type { WorkingHousehold } from "./household.ts";
import { ILLUSTRATIONS } from "./illustrations.ts";
import { InputPanel } from "./InputPanel.tsx";
import { addItem, addOptions, DEFAULT_LAYOUT, fillCard, groupedItems, inputItems, itemOf, notApplicableCard, pinItems, progressOf, togglePin, type AddOption, type CardLayout, type InputItem, type PinItem } from "./items.ts";
import { inheritanceSummary, useInheritanceEstimate } from "./inheritanceLine.ts";
import { pensionEstimateSummary, usePensionEstimate } from "./pensionEstimate.ts";
import { STAGE_ORDER } from "./stages/index.ts";
import { StatusBadge, statusText } from "./StatusBadge.tsx";
import { CheckList, checkSummary } from "./CheckList.tsx";
import type { NoticeRow } from "../engineNotices.ts";
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
  /** カードの並びと最初の5枚（事務所の設定。省くと標準） */
  layout?: CardLayout;
  /** 現状の計算結果の知らせ（確かめの一覧の「計算の知らせ」。0064） */
  calcNotices?: readonly NoticeRow[];
}

interface CardActions {
  /** 「当てはまらない」の1押し（プランの編集中は出さない） */
  onNa?: (id: string) => void;
  /** 「目安で入れる」の1押し */
  onFill?: (id: string) => void;
}

function Card({ item, onOpen, flash, diffs, firstMark, acts }: { item: InputItem; onOpen: (id: string) => void; flash: boolean; diffs?: { label: string; n: number } | undefined; firstMark: boolean; acts: CardActions }) {
  const s = item.summary;
  const showNa = item.canNa && acts.onNa !== undefined;
  const showFill = item.canFill && acts.onFill !== undefined;
  return (
    <div class={`ih-card s-${item.status}${flash ? " flash" : ""}${firstMark ? " first" : ""}`} style={{ "--c": item.color }}>
      <button type="button" class="ih-open" data-card={item.id} aria-label={`${item.label}（${statusText(item)}）を開く`} onClick={() => onOpen(item.id)}>
        <span class="ih-ill" aria-hidden="true">
          <img src={ILLUSTRATIONS[item.art]} alt="" />
        </span>
        <span class="ih-body">
          <span class="ih-name">
            {item.label}
            {firstMark ? (
              <span class="first-tag" data-first>
                最初の5枚
              </span>
            ) : null}
            {diffs !== undefined && diffs.n > 0 ? (
              <span class="plan-count" data-plan-count={diffs.n}>
                {diffs.label}: {diffs.n}か所
              </span>
            ) : null}
          </span>
          <span class="ih-sum">
            {s === null ? (
              <span class="yet">{item.status === "na" ? "なし" : "まだ入っていません"}</span>
            ) : (
              <>
                {s.pre !== undefined ? <small>{s.pre}</small> : null}
                {s.main}
                {s.unit !== undefined ? <small>{s.unit}</small> : null}
              </>
            )}
          </span>
          <StatusBadge item={item} mini />
        </span>
      </button>
      {item.hint !== null ? (
        <div class="ih-hint" data-hint={item.id}>
          <p>{item.hint}</p>
          {showNa || showFill ? (
            <div class="ih-hint-acts">
              {showFill ? (
                <button type="button" class="btn small" onClick={() => acts.onFill?.(item.id)} data-card-fill={item.id}>
                  目安で入れる
                </button>
              ) : null}
              {showNa ? (
                <button type="button" class="btn small" onClick={() => acts.onNa?.(item.id)} data-card-na={item.id}>
                  当てはまらない
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <span class="ih-band" aria-hidden="true" />
    </div>
  );
}

/** ピン（ホームに出した物）: 押すとその物のまとまりだけを開く。「外す」はピンだけを外す（物は残る） */
function PinCard({ pin, onOpen, onUnpin, planLabel }: { pin: PinItem; onOpen: (id: string) => void; onUnpin?: ((p: PinItem) => void) | undefined; planLabel: string | null }) {
  const s = pin.summary;
  const where = STAGE_ORDER.find((x) => x.id === pin.owner)?.label ?? "";
  return (
    <div class={`ih-pin s-${pin.status}`} style={{ "--c": pin.color }}>
      <button type="button" class="ih-pin-open" data-pin={pin.id} aria-label={`ピン: ${pin.label}（${statusText(pin)}。物は${where}のカード）を開く`} onClick={() => onOpen(pin.id)}>
        <span class="ih-pin-name">
          <span aria-hidden="true">📌</span> {pin.label}
          {pin.planOnly && planLabel !== null ? (
            <span class="plan-count" data-pin-plan>
              {planLabel}で足した
            </span>
          ) : null}
        </span>
        <span class="ih-pin-sum">
          {s === null ? "" : `${s.pre ?? ""}${s.main}${s.unit ?? ""}`}
          <small>（{where}）</small>
        </span>
        <StatusBadge item={pin} mini />
      </button>
      {onUnpin !== undefined ? (
        <button type="button" class="link-btn" onClick={() => onUnpin(pin)} data-unpin={pin.id} title="ピンだけを外します（物は残ります）">
          外す
        </button>
      ) : null}
    </div>
  );
}

function AddCard({ open, onOpen, onPick, options }: { open: boolean; onOpen: (v: boolean) => void; onPick: (key: string) => void; options: readonly AddOption[] }) {
  if (!open)
    return (
      <div class="ih-card ih-add">
        <button type="button" class="ih-add-main" onClick={() => onOpen(true)} data-add-open>
          <span class="ih-plus" aria-hidden="true">
            ＋
          </span>
          <span>
            項目を追加
            <small>ペット・留学・名前を付けた支出・介護など。物は属するカードに入り、ホームにピンが出ます</small>
          </span>
        </button>
      </div>
    );
  return (
    <div class="ih-card ih-add">
      <div class="ih-add-menu" role="group" aria-label="足す項目を選ぶ">
        <p>どの項目を足しますか</p>
        {options.map((o) => (
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

const NO_NOTICES: readonly NoticeRow[] = [];

export function InputView({ wh, onSave, level, onLevel, initialOpen, tools, computeOne, statement, plans, layout = DEFAULT_LAYOUT, calcNotices = NO_NOTICES }: Props) {
  /** 直しているプラン（直せないときは現状） */
  const editing = plans !== undefined && plans.sel !== null && plans.lock === null ? (plans.list.find((x) => x.id === plans.sel) ?? null) : null;
  const pcat = plans?.cat;
  /** カードに見せる世帯（プランを直しているときはそのプランの中身。カードの要約・状態もプランの中身から） */
  const shown = useMemo(() => (editing === null || pcat === undefined ? wh : planView(wh, pcat, editing.id)), [wh, editing, pcat]);
  const rows = useMemo(() => (editing === null || pcat === undefined ? [] : diffRows(wh, pcat, editing.id, planIndex([wh, shown]))), [wh, editing, pcat, shown]);
  const counts = useMemo(() => countsByCard(rows), [rows]);
  const [diffOpen, setDiffOpen] = useState(false);
  /** 相続・贈与のカードの要約（相続税の目安。計算の結果から読むだけ） */
  const inheritance = useInheritanceEstimate(shown, true, computeOne);
  const pensionEst = usePensionEstimate(shown, true, computeOne);
  const items = useMemo(() => inputItems(shown, { layout, inheritance: inheritanceSummary(inheritance), pension: pensionEstimateSummary(shown, pensionEst.std) }), [shown, layout, inheritance, pensionEst]);
  const pins = useMemo(() => pinItems(shown, editing !== null ? wh : undefined), [shown, editing, wh]);
  const groups = useMemo(() => groupedItems(items), [items]);
  const p = progressOf(items);
  /** ざっくり派の案内（最初の5枚に未入力が残る間。閉じられる） */
  const [guideClosed, setGuideClosed] = useState(false);
  const guide = !guideClosed && items.some((i) => i.first && i.status === "missing");
  const [openId, setOpenId] = useState<string | null>(initialOpen !== undefined && (items.some((i) => i.id === initialOpen) || wh.addedItems.some((a) => a.id === initialOpen)) ? initialOpen : null);
  const [addDraft, setAddDraft] = useState<WorkingHousehold | null>(null);
  const [addMenu, setAddMenu] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [statementOpen, setStatementOpen] = useState(statement?.initialOpen === true);
  const [checkOpen, setCheckOpen] = useState(initialOpen === "check");
  /** 確かめの一覧から開いたときに移る欄 */
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const check = useMemo(() => checkSummary(wh, calcNotices), [wh, calcNotices]);
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
  // カードの上の1押し（現状を直す。プランの編集中は出さない）
  const cardActs: CardActions =
    editing !== null
      ? {}
      : {
          onNa: (id) => {
            onSave(notApplicableCard(wh, id));
            setFlashId(id);
            setToast(`「${items.find((i) => i.id === id)?.label ?? ""}」を当てはまらないにしました`);
          },
          onFill: (id) => {
            onSave(fillCard(wh, id));
            setFlashId(id);
            setToast(`「${items.find((i) => i.id === id)?.label ?? ""}」を目安で入れました（推定の印）`);
          },
        };
  const unpin = (pin: PinItem) => {
    onSave(togglePin(wh, pin.added));
    setToast(`「${pin.label}」のピンを外しました（物は残ります）`);
  };
  const save = (next: WorkingHousehold, id: string) => {
    const label = itemOf(next, id)?.label;
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
          <p class="ih-lead">カードを押すと、入力のパネルが開きます。空欄は統計の目安などで補って計算します（「推定で計算中」の印）。保存した世帯は、世帯ごとに暗号化して自動で保存します（見本の世帯は保存しません。上の「世帯」から保存できます）。</p>
        </div>
        <div class="ih-prog" aria-live="polite">
          <div class="ih-prog-line" data-progress>
            <span class={`ih-prog-miss${p.missing > 0 ? " on" : ""}`} data-progress-missing={p.missing}>
              <span class="ih-st missing mini">未入力（0円の所あり）</span> <span class="n">{p.missing}</span>
            </span>
            <span class="ih-prog-rest">
              {p.total}項目中 入力済み <span class="n">{p.done}</span>・推定で計算中 <span class="n">{p.est}</span>・当てはまらない <span class="n">{p.na}</span>
            </span>
          </div>
          <div class="ih-prog-bar" aria-hidden="true">
            {items.map((i) => (
              <i key={i.id} class={i.status} />
            ))}
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
          {editing !== null ? "現状の" : ""}確かめの一覧（未入力 {check.counts.missing}・わからない {check.counts.unknown}・注意 {check.counts.notice}
          {check.counts.calc > 0 ? `・計算の知らせ ${check.counts.calc}` : ""}・推定 {check.counts.estimated}）
        </button>
      </div>
      {checkOpen ? (
        <CheckList
          wh={wh}
          notices={calcNotices}
          onOpen={openField}
          onEdit={(next, done) => {
            onSave(next);
            setToast(done);
          }}
        />
      ) : null}
      {guide ? (
        <div class="ih-guide" role="note" data-first-guide>
          <p>
            まず<b>最初の5枚</b>（{items.filter((i) => i.first).map((i) => i.label).join("・")}）を入れてください。ほかのカードは、推定か「当てはまらない」「目安で入れる」の1押しで進められます。
          </p>
          <button type="button" class="link-btn" onClick={() => setGuideClosed(true)} data-first-guide-close>
            閉じる
          </button>
        </div>
      ) : null}
      {groups.map((g, gi) => (
        <section class="ih-group" key={g.group?.id ?? "all"} aria-label={g.group?.label ?? "入力の項目"}>
          {g.group !== null ? <h2 class="ih-gh">{g.group.label}</h2> : null}
          <div class="ih-cards">
            {g.items.map((i) => (
              <Card key={i.id} item={i} onOpen={open} flash={flashId === i.id} diffs={editing !== null ? { label: editing.label, n: counts.get(i.id) ?? 0 } : undefined} firstMark={guide && i.first} acts={cardActs} />
            ))}
            {gi === groups.length - 1 ? <AddCard open={addMenu} onOpen={setAddMenu} onPick={pick} options={addOptions(shown)} /> : null}
          </div>
        </section>
      ))}
      {pins.length > 0 ? (
        <section class="ih-pins" aria-label="ホームに出した物（ピン）" data-pins>
          <h2 class="ih-gh">ピン（ホームに出した物。進み具合には数えません）</h2>
          <div class="ih-pin-list">
            {pins.map((x) => (
              <PinCard key={x.id} pin={x} onOpen={open} onUnpin={x.planOnly ? undefined : unpin} planLabel={editing?.label ?? null} />
            ))}
          </div>
        </section>
      ) : null}
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
