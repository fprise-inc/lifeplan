// 入力のパネル（作業の層の部品）: カードを押すと画面の中央に開き、背景を暗くする（別の窓は出さない）。
// 中身は今までの入力の欄（簡易と詳細の切り替えを含む）。値は下書きに入れ、「保存」で世帯に入れる。× と Esc で閉じる（保存していない変更があれば先に知らせる）
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { allFields, type Level } from "./form.ts";
import { fieldDomId, FieldStateOps, FieldSuggestions, GroupOpen, PinControls, PlanMarksContext, Section, SectionLinks, visible, type GroupOpenState, type PinControl, type PlanMarks, type SectionLink } from "./FieldViews.tsx";
import { dropStaleRows } from "./rows.ts";
import { applyStateOp, availableOps, confirmAll, fieldStatus, planStateOp, type StateOp } from "./valueState.ts";
import type { FieldDef } from "./form.ts";
import type { Catalog } from "../plans/items.ts";
import { diffRows, fieldMark, groupMark, planView, recordPlanEdit, referrersOf, removedObjects, removedRows, revertField, revertRow, settleFields, withoutObjects, type Referrer } from "../plans/planEdit.ts";
import { fillAll, gapsOf } from "./fill.ts";
import { useSurplusSuggestion } from "./surplusSuggest.ts";
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";
import { withRefreshedEstimates } from "./estimates.ts";
import { withProvisionalHousing } from "./housingCredit.ts";
import type { WorkingHousehold } from "./household.ts";
import { Help, HelpOf } from "../../presentation/Help.tsx";
import { LEVEL_HELP_COMMON, levelDiffLine } from "./levelHelp.ts";
import { ILLUSTRATIONS } from "./illustrations.ts";
import { isPinned, itemOf, itemStage, pinOfGroup, saveItem, togglePin } from "./items.ts";
import { inheritanceTaxNote, inheritanceView, legacyLine, useInheritanceEstimate } from "./inheritanceLine.ts";
import { RetirementLineup } from "./RetirementLineup.tsx";
import { AssumptionList } from "./AssumptionList.tsx";
import { PensionEstimate } from "./PensionEstimate.tsx";
import { pensionEstimateSummary, usePensionEstimate } from "./pensionEstimate.ts";
import { StatusBadge } from "./StatusBadge.tsx";
import { SavingsPanel } from "./savings/SavingsPanel.tsx";
import { InsuranceOverview } from "./InsuranceOverview.tsx";
import { RentalOverview } from "./RentalOverview.tsx";
import { useRentalFigures } from "../rentalTab.ts";
import { useInsuranceView } from "./insuranceView.ts";
import { useNurseryFee } from "./nurseryFeeView.ts";
import { nurseryMethodNote } from "./stages/education.ts";
import { historyScope, undoController, useUndoScope } from "../undo/controller.ts";
import { deepEqual, UndoHistory } from "../undo/history.ts";

export interface InputPanelProps {
  /** 保存されている世帯（下書きの始まり） */
  wh: WorkingHousehold;
  itemId: string;
  /** 項目を足したとき: 足した物を入れた下書き（保存するまで世帯には入れない） */
  initialDraft?: WorkingHousehold;
  level: Level;
  onLevel: (l: Level) => void;
  onSave: (next: WorkingHousehold, itemId: string) => void;
  onClose: () => void;
  /** 1件だけの計算（基本生活費のパネルで、控えから実際の貯まり方を出すときに控えの入力を計算する。0031） */
  computeOne?: (req: EngineRequest) => Promise<PreviewResult | null>;
  /** 基本生活費のパネルの「明細から出す」（0034）。保存していない変更を保存してから開くときは、保存する世帯を渡す */
  onStatement?: (saved?: WorkingHousehold) => void;
  /** 開いたときに移る欄のキー（確かめの一覧の「開く」。欄に移るだけで、値も状態も変えない） */
  focusKey?: string;
  /**
   * プランを直しているとき（0036 の8）: 欄にはそのプランの中身（作業中の世帯）を見せ、直したことをそのプランの差分にする。
   * 下書きは世帯（現状とプランの一覧）のまま持ち、「保存」で plan.onSave に渡す（現状は変わらない）
   */
  plan?: PanelPlan;
  /** まとまりごとの「▸ 詳しく」の開け閉め（入力の画面が持つ。渡さなければパネルの中で覚える。0078 の追記） */
  groupOpen?: GroupOpenState;
}

export interface PanelPlan {
  id: string;
  /** 例: 「プランB」 */
  label: string;
  color: string;
  cat: Catalog;
}

const NO_LINKS: Record<string, SectionLink> = {};

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * 開いた直後に移る先（上から順に、最初に見つかった物）。説明の「?」（data-help-btn）は選ばない:
 * 区画の見出しの「?」が最初のボタンのカードで、開いただけで説明が出ていた（0077 の追記）
 */
export const PANEL_FIRST_FOCUS: readonly string[] = [".ip-body [data-autofocus]", ".ip-body input, .ip-body select", ".ip-body button:not(.danger):not([data-help-btn])", ".x-btn"];

export function InputPanel({ wh, itemId, initialDraft, level, onLevel, onSave, onClose, computeOne, onStatement, focusKey, plan, groupOpen }: InputPanelProps) {
  const [draft, setDraft] = useState<WorkingHousehold>(initialDraft ?? wh);
  const [dirty, setDirty] = useState(initialDraft !== undefined);
  const [leaving, setLeaving] = useState(false);
  /** 知らせが「明細のパネルを開く前に保存する」か（false なら「閉じると変更が消える」） */
  const [toStatement, setToStatement] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  /** 欄に見せる世帯: 現状を直すときは下書き、プランを直すときは下書きにそのプランを当てた作業中の世帯 */
  const shown = useMemo(() => (plan === undefined ? draft : planView(draft, plan.cat, plan.id)), [draft, plan]);
  /** 相続・贈与のカードの相続税の目安（計算の結果から読むだけ） */
  const inheritance = useInheritanceEstimate(shown, itemId === "inheritance", computeOne);
  const rentalFig = useRentalFigures(shown.request, itemId === "rental", computeOne);
  /** 保険の入力項目の保険料と解約返戻金（今のままの計算を読むだけ。0055 の追記） */
  const insurance = useInsuranceView(shown, itemId === "insurance", computeOne);
  /** 子ども・教育のカードの保育料の自動の計算の結果（読むだけ。0029 の追記 2026-10-30） */
  const nurseryFee = useNurseryFee(shown, itemId === "education", computeOne);
  /** 年金のカードの年金の見込み（計算の結果から読むだけ。プランを直しているときは、そのプランの額） */
  const pensionEst = usePensionEstimate(shown, itemId === "pension", computeOne);
  const item = useMemo(() => itemOf(shown, itemId, { inheritanceTax: inheritanceTaxNote(inheritance), pension: pensionEstimateSummary(shown, pensionEst.std) }), [shown, itemId, inheritance, pensionEst]);
  const stage = useMemo(() => itemStage(shown, itemId), [shown, itemId]);
  const adding = initialDraft !== undefined;
  const suggestions = useSurplusSuggestion(shown, itemId === "living", computeOne);
  /** 外したときの連鎖の確かめ（外す物を指す物を並べ、一緒に外す物を選ぶ。0036 の8） */
  const [chain, setChain] = useState<{ target: WorkingHousehold; refs: Referrer[]; chosen: Set<string> } | null>(null);

  // 元に戻す・やり直す: 開いている間は、このパネルの下書きの履歴を使う（裏の世帯は戻さない）
  const history = useRef<UndoHistory<WorkingHousehold> | null>(null);
  if (history.current === null) history.current = new UndoHistory<WorkingHousehold>({ same: deepEqual });
  const latest = useRef(draft);
  latest.current = draft;
  const commit = (n: WorkingHousehold) => {
    const cur = latest.current;
    if (n === cur) return;
    if (history.current !== null) undoController.record(history.current, cur, n, (h) => h.control ?? item?.label ?? "入力");
    latest.current = n;
    setDraft(n);
    setDirty(true);
    setLeaving(false);
    setToStatement(false);
  };
  /** プランの値の状態の操作で作った作業中の世帯 → その操作を差分にした世帯（欄の部品はそのまま onEdit に返す） */
  const madeBy = useRef(new WeakMap<WorkingHousehold, WorkingHousehold>());
  /** このカードの欄（欄の値が土台・現状と同じに戻ったら差分を消すため） */
  const cardFields = (w: WorkingHousehold): FieldDef[] => {
    const st = itemStage(w, itemId);
    return st === null ? [] : allFields(st);
  };
  const recordPlan = (target: WorkingHousehold, causes?: ReadonlyMap<string, string>) => {
    if (plan === undefined) return;
    const cur = latest.current;
    const before = planView(cur, plan.cat, plan.id);
    const n = recordPlanEdit(cur, plan.cat, plan.id, before, target, causes !== undefined ? { causes } : {});
    commit(settleFields(n, plan.cat, plan.id, cardFields(planView(n, plan.cat, plan.id))));
  };
  const edit = (next: WorkingHousehold) => {
    const cur = latest.current;
    if (plan === undefined) {
      if (next === cur) return;
      // 値が変わった所の前からの値の状態の行（書類待ち・該当なし・承認など）を外してから、推定のままの値を入れ直す（0041）
      commit(withProvisionalHousing(withRefreshedEstimates(dropStaleRows(cur, next))));
      return;
    }
    const made = madeBy.current.get(next);
    if (made !== undefined) return commit(made);
    const before = planView(cur, plan.cat, plan.id);
    if (next === before) return;
    // プランの中身でも同じ決まりで行を外し、推定を入れ直す（入れ直した推定は出どころ auto の値の箱の差分になる。0036 の8）
    const target = withProvisionalHousing(withRefreshedEstimates(dropStaleRows(before, next)));
    const removed = removedObjects(before, target);
    const refs = removed.length > 0 ? referrersOf(target, removed) : [];
    if (refs.length > 0) {
      setChain({ target, refs, chosen: new Set(refs.map((r) => r.id)) });
      return;
    }
    recordPlan(target);
  };
  const stateOps =
    plan === undefined
      ? applyStateOp
      : (_v: WorkingHousehold, f: FieldDef, op: StateOp): WorkingHousehold => {
          const real = planStateOp(latest.current, plan.cat, plan.id, f, op);
          const nv = planView(real, plan.cat, plan.id);
          madeBy.current.set(nv, real);
          return nv;
        };
  const marks = useMemo<PlanMarks | null>(
    () =>
      plan === undefined
        ? null
        : {
            field: (f, v) => fieldMark(latest.current, plan.cat, plan.id, f, v),
            revert: (f, v) => commit(revertField(latest.current, plan.cat, plan.id, f, v)),
            group: (g, v) => groupMark(latest.current, plan.id, g, v),
          },
    // 印は下書きが変わるたびに読み直す
    [plan, draft],
  );
  const rows = useMemo(() => (plan === undefined ? [] : diffRows(draft, plan.cat, plan.id)), [draft, plan]);
  // まとまりの「📌 ホームに出す」: ピンは画面の側の印（addedItems）なので、プランを直しているときも下書きの世帯にそのまま書く（差分にしない）
  const pins = useMemo<PinControl>(
    () => ({
      refOf: (k) => pinOfGroup(k)?.ref ?? null,
      pinned: (ref) => isPinned(latest.current, ref),
      toggle: (k) => {
        const p = pinOfGroup(k);
        if (p !== null) commit(togglePin(latest.current, p));
      },
    }),
    [draft],
  );
  const removedHere = plan === undefined ? [] : removedRows(rows, itemId);
  useUndoScope(
    historyScope(
      1,
      () => history.current,
      (s) => {
        latest.current = s;
        setDraft(s);
        setDirty(true);
        setLeaving(false);
        setToStatement(false);
      },
    ),
  );
  const tryClose = () => {
    if (dirty && (!leaving || toStatement)) {
      setLeaving(true);
      setToStatement(false);
      return;
    }
    onClose();
  };
  // プランを直しているときは、カードの「保存した」印（現状の記録）は付けない
  const save = () => onSave(plan === undefined ? saveItem(draft, itemId) : draft, itemId);
  // 基本生活費の見出しの横の「明細から出す」（0034）。保存していない変更があれば、先に保存するかを聞く
  const links = useMemo<Record<string, SectionLink>>(() => {
    if (itemId !== "living" || onStatement === undefined) return NO_LINKS;
    const link: SectionLink = {
      label: "明細から出す",
      title: "カード・銀行の明細から月平均を出し、候補として入れます",
      onClick: () => {
        if (dirty) {
          setLeaving(true);
          setToStatement(true);
          return;
        }
        onStatement();
      },
    };
    return { "living/main": link, "living/none": link, "money/living/out": link };
  }, [itemId, onStatement, dirty]);

  // 開いた直後: 最初の欄（無ければ最初のボタン、それも無ければ閉じるボタン）に移る。説明の「?」には移らない（PANEL_FIRST_FOCUS）。確かめの一覧から来たときは、その欄に移る。背景はスクロールさせない
  // （欄に移るだけでは値も状態も変えない。0041）
  useEffect(() => {
    const el = panel.current;
    const target = focusKey !== undefined ? el?.querySelector<HTMLElement>(`#${fieldDomId(focusKey)}`) : null;
    if (target != null) {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "center" });
      target.closest(".fld")?.classList.add("jumped");
      document.documentElement.classList.add("panel-open");
      return () => document.documentElement.classList.remove("panel-open");
    }
    const first = PANEL_FIRST_FOCUS.map((q) => el?.querySelector<HTMLElement>(q)).find((x) => x != null);
    first?.focus({ preventScroll: true });
    document.documentElement.classList.add("panel-open");
    return () => document.documentElement.classList.remove("panel-open");
  }, []);

  // Esc で閉じる（変更があれば先に知らせ、もう一度で閉じる）
  const closeRef = useRef(tryClose);
  closeRef.current = tryClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // 知らせが出たら、その中のボタンに移る
  useEffect(() => {
    if (leaving) panel.current?.querySelector<HTMLElement>("[data-discard], [data-save-statement]")?.focus();
  }, [leaving, toStatement]);

  if (item === null || stage === null) return null;
  const sections = stage.sections.filter((s) => visible(level, s.level));
  // 見えている欄のうち推定のままの欄（「推定の値をまとめて使う」で確定にする欄）
  // 詳細では、標準だけのまとまり（今の働き方など。同じ値を詳細の欄で入れる）の欄を数えない
  const shownFields = allFields({ ...stage, sections: sections.map((s) => ({ ...s, groups: s.groups.filter((g) => level === "simple" || g.simpleOnly !== true) })) }).filter((f) => visible(level, f.level));
  const estimatedShown = shownFields.filter((f) => f.quietEstimate === undefined && fieldStatus(f, shown).status === "estimated" && availableOps(f, shown).includes("confirm")).length;
  // このカードの入っていない物（古い世帯では自動で推定を入れず、ここと確かめの一覧に出す。fill.ts）
  const gaps = gapsOf(shown).filter((g) => g.card === itemId);
  // まだ何も入れていない項目（赤い帯を出さない）
  const quiet = item.status === "empty";
  const confirmShown = () => {
    if (plan === undefined) return edit(confirmAll(draft, shownFields).wh);
    let w = latest.current;
    for (const f of shownFields) if (f.quietEstimate === undefined && fieldStatus(f, planView(w, plan.cat, plan.id)).status === "estimated") w = planStateOp(w, plan.cat, plan.id, f, "confirm");
    commit(w);
  };
  const removed = item.added !== null && item.summary === null;
  // 保存の下の1行は状態だけ（推定のままの欄の数）。保存すると何が起きるかは「?」の中（0077）
  const note = leaving ? null : !removed && item.estimated > 0 ? `推定・仮の値のままの欄: ${item.estimated}つ` : null;
  const saveHelp = removed
    ? "保存すると、このピンがなくなります。"
    : plan !== undefined
      ? `保存すると、${plan.label}の差分になります（現状は変わりません）。`
      : adding
        ? "保存すると、物が足され、ホームにピンが出ます（キャンセルすると足しません）。"
        : item.added !== null
          ? "保存すると、この物に入れた値が世帯に入ります。"
          : "保存すると、この項目は「入力済み」になります（何も入れずに保存すると「該当なし」）。";

  return (
    <>
      <div class="scrim" onClick={tryClose} aria-hidden="true" />
      <div
        ref={panel}
        class={`ipanel${itemId === "savings" ? " wide" : ""}${plan !== undefined ? " plan-mode" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ip-title"
        style={{ "--c": item.color, ...(plan !== undefined ? { "--plan-c": plan.color } : {}) }}
        data-plan-edit={plan?.id}
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
        {plan !== undefined ? (
          <p class="ip-plan" data-plan-band>
            <b>{plan.label}</b>を編集中（現状は変わりません）
          </p>
        ) : null}
        <div class="ip-head">
          <div class="ip-thumb" aria-hidden="true">
            <img src={ILLUSTRATIONS[item.art]} alt="" />
          </div>
          <h2 id="ip-title">
            {item.label}
            {item.added !== null ? <span class="fp-tag">📌 ピン</span> : null}
            <StatusBadge item={item} />
            {/* カードの説明と入れ方の決まりは「?」の中（0077） */}
            <Help label={item.label} id="panel">
              {item.lead !== "" ? <p>{item.lead}</p> : null}
              <p>空欄は統計の平均などで補って計算します（「推定」の印。印を押すと根拠が開きます）。推定の値は欄に灰色で見えています。そのままでよければ、欄の「この値にする」を押すと、その値が欄に入って確定になります（欄に入っただけでは確定になりません）。</p>
            </Help>
          </h2>
          <div class="ip-tools">
            <div class="level-switch" role="group" aria-label="入力の細かさ">
              <button type="button" class={level === "simple" ? "on" : ""} aria-pressed={level === "simple"} onClick={() => onLevel("simple")}>
                標準
              </button>
              <button type="button" class={level === "detail" ? "on" : ""} aria-pressed={level === "detail"} onClick={() => onLevel("detail")}>
                詳細
              </button>
            </div>
            {/* 標準と詳細の違いは切り替えのすぐ右の「?」の中（どの入力項目も同じ言い回し。levelHelp.ts。0077 の追記。「?」は説明する物の右に置く＝2026-10-29 の追記） */}
            <Help label="標準と詳細の違い" id="level">
              {LEVEL_HELP_COMMON.map((t) => (
                <p key={t}>{t}</p>
              ))}
              <p data-level-diff>{levelDiffLine(stage.id)}</p>
            </Help>
            <button type="button" class="x-btn" aria-label="閉じる（Esc）" title="閉じる（Esc）" onClick={tryClose}>
              ×
            </button>
          </div>
          {chain !== null ? (
            <div class="ip-chain" role="alertdialog" aria-label="一緒に外す物" data-plan-chain>
              <p>外す物を指している物があります。一緒に外す物を選んでください（選ばなかった物は残ります）。</p>
              <ul>
                {chain.refs.map((r) => (
                  <li key={r.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={chain.chosen.has(r.id)}
                        onChange={(e) => {
                          const next = new Set(chain.chosen);
                          if ((e.currentTarget as HTMLInputElement).checked) next.add(r.id);
                          else next.delete(r.id);
                          setChain({ ...chain, chosen: next });
                        }}
                        data-chain-item={r.id}
                      />
                      {r.label}
                    </label>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                class="btn primary"
                onClick={() => {
                  const ids = [...chain.chosen];
                  const causes = new Map(chain.refs.filter((r) => chain.chosen.has(r.id)).map((r) => [r.id, r.refersTo]));
                  setChain(null);
                  recordPlan(withoutObjects(chain.target, ids), causes);
                }}
                data-chain-ok
              >
                外す
              </button>
              <button type="button" class="btn" onClick={() => setChain(null)} data-chain-cancel>
                やめる
              </button>
            </div>
          ) : null}
          {removedHere.length > 0 ? (
            <ul class="ip-removed" aria-label="このプランで外した物" data-plan-removed>
              {removedHere.map((r) => (
                <li key={r.key}>
                  <span class="nm">{r.kind === "replace" ? `${r.label}（${r.from} → ${r.to}）` : r.label.replace(/^外す: /, "")}</span>
                  <button type="button" class="link-btn" onClick={() => plan !== undefined && commit(revertRow(latest.current, plan.cat, plan.id, r))} data-plan-unremove>
                    {r.inherited ? `土台（${r.planName}）で外した ↺` : r.kind === "replace" ? "このプランで置き換えた ↺" : "このプランで外した ↺"}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {/* 入っていない物: 入れ始めた項目は赤い帯で知らせ、まだ入れていない項目は帯を出さず、目安と「該当なし」の操作だけを控えめに（0045 の追記） */}
          {gaps.length > 0 ? (
            <div class={`ip-gaps${quiet ? " quiet" : ""}`} role="note" data-gaps={quiet ? "quiet" : "alert"}>
              {quiet ? null : <p>未入力（0円で計算中）の所があります。</p>}
              <ul>
                {gaps.map((g) => (
                  <li key={g.id} data-gap={g.id}>
                    <span>{quiet ? `${g.label}:` : `${g.label}: ${g.note}`}</span>
                    {g.fill !== undefined ? (
                      <button type="button" class="link-btn" onClick={() => edit(g.fill?.(shown) ?? shown)} {...(g.basis !== undefined ? { title: `推定: ${g.basis}` } : {})} data-gap-fill>
                        推定で埋める
                      </button>
                    ) : null}
                    {g.none !== undefined ? (
                      <button type="button" class="link-btn" onClick={() => edit(g.none?.(shown) ?? shown)} data-gap-none>
                        該当なし{g.noneLabel !== undefined ? `（${g.noneLabel}）` : ""}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {gaps.filter((g) => g.fill !== undefined).length > 1 ? (
                <button type="button" class="link-btn" onClick={() => edit(fillAll(shown, itemId).wh)} data-gap-fill-card>
                  この項目を推定で埋める
                </button>
              ) : null}
            </div>
          ) : null}
          {estimatedShown > 0 ? (
            <div class="ip-bulk">
              {/* 見えている推定の欄の全部に「この値にする」を押すのと同じ（0041 の追記） */}
              <button type="button" class="fld-fill" onClick={confirmShown} title="見えている推定の欄に、推定の値をまとめて入れます（確定になります）" data-confirm-all>
                推定の値をまとめて使う（{estimatedShown}つ）
              </button>
            </div>
          ) : null}
        </div>
        <div class="ip-body" data-reveal-root>
          <GroupOpen.Provider value={groupOpen ?? null}>
          <PinControls.Provider value={pins}>
          {itemId === "savings" ? (
            <PlanMarksContext.Provider value={marks}>
            <FieldStateOps.Provider value={stateOps}>
              <SavingsPanel wh={shown} level={level} onEdit={edit} />
            </FieldStateOps.Provider>
            </PlanMarksContext.Provider>
          ) : (
            <PlanMarksContext.Provider value={marks}>
            <FieldStateOps.Provider value={stateOps}>
            <FieldSuggestions.Provider value={suggestions}>
              <SectionLinks.Provider value={links}>
                {/* 収益不動産: 上に物件の一覧（読むだけ。入力から出せる数字だけ。0079） */}
                {itemId === "rental" ? <RentalOverview wh={shown} figures={rentalFig} /> : null}
                {sections.map((s) => (
                  <Section key={s.key} section={s} wh={shown} level={level} onEdit={edit} />
                ))}
                {sections.length === 0 ? <p class="in-note">この項目の欄は「詳細」で出ます</p> : null}
                {/* 子ども・教育: 保育料を自動で計算している段の、年ごとの月の平均（読むだけ。0029 の追記 2026-10-30） */}
                {itemId === "education" && nurseryFee.length > 0 ? (
                  <div class="ip-inherit" role="note" data-nursery-fee>
                    <p>
                      <b>保育料（自動計算の目安）</b>
                      <Help label="保育料（自動計算の目安）">{nurseryMethodNote()}</Help>
                    </p>
                    <ul>
                      {nurseryFee.map((l) => (
                        <li key={l.child}>{l.text}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {/* 保険: 入れる区画の下に保険料と解約返戻金（読むだけ。過不足は万一のタブで見る。0055 の追記） */}
                {itemId === "insurance" ? <InsuranceOverview view={insurance} /> : null}
                {/* 相続・贈与: 入れる区画の下に相続税の目安（読むだけ。ほかのカードと同じく、入れる欄を先に出す。0060 の追記） */}
                {itemId === "inheritance" && (inheritanceView(shown, inheritance).points.length > 0 || legacyLine(shown, inheritance) !== null) ? (
                  <div class="ip-inherit" role="note" data-inheritance-line>
                    {legacyLine(shown, inheritance) !== null ? (
                      <p data-legacy-line>
                        <b>遺したい額</b>: {legacyLine(shown, inheritance)}
                      </p>
                    ) : null}
                    {inheritanceView(shown, inheritance).points.length > 0 ? (
                      <>
                        <p>
                          <b>相続税の目安</b>
                          <Help label="相続税の目安">表示だけです。お金の流れには入れていません。</Help>
                        </p>
                        <ul>
                          {inheritanceView(shown, inheritance).points.map((p) => (
                            <li key={p.title} data-inheritance-point>
                              {p.title}: {p.answer}
                              {p.details.length > 0 || p.cautions.length > 0 ? (
                                <details>
                                  <summary>内訳</summary>
                                  <ul>
                                    {p.details.map((d) => (
                                      <li key={d}>{d}</li>
                                    ))}
                                    {p.cautions.map((c) => (
                                      <li key={c} class="ip-inherit-caution">
                                        注意: {c}
                                      </li>
                                    ))}
                                  </ul>
                                </details>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                        {inheritanceView(shown, inheritance).notIncluded.length > 0 ? (
                          <p class="ip-inherit-note">
                            含めていないもの: {inheritanceView(shown, inheritance).notIncluded.join("・")}
                            <Help label="含めていないもの">額が分かれば、「詳細」の「相続税の目安の設定」の「税理士などの出した額」で直せます。</Help>
                          </p>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ) : null}
                {/* 退職金・企業年金: カードの下に受け取りの並び（読むだけ。0058） */}
                {itemId === "retirement" ? <RetirementLineup wh={shown} {...(computeOne !== undefined ? { computeOne } : {})} /> : null}
                {/* 前提条件: 前提と推定の一覧（確かめた記録はプランごと。値は変えないので、プランを直していても差分にしない。0070） */}
                {itemId === "assumptions" ? <AssumptionList wh={shown} planId={plan?.id ?? null} onAgree={(f) => commit({ ...latest.current, agreed: f(latest.current).agreed })} onLevel={onLevel} /> : null}
                {/* 年金: カードの下に年金の見込み（読むだけ。0067） */}
                {itemId === "pension" ? <PensionEstimate wh={shown} est={pensionEst} /> : null}
              </SectionLinks.Provider>
            </FieldSuggestions.Provider>
            </FieldStateOps.Provider>
            </PlanMarksContext.Provider>
          )}
          </PinControls.Provider>
          </GroupOpen.Provider>
        </div>
        <div class="ip-foot" role={leaving ? "alert" : undefined}>
          {leaving && toStatement && onStatement !== undefined ? (
            <>
              <p class="ip-note warn">保存していない変更があります。明細のパネルを開く前に、この変更を保存します。</p>
              <button type="button" class="btn" onClick={() => {
                  setLeaving(false);
                  setToStatement(false);
                }}>
                入力に戻る
              </button>
              <button type="button" class="btn primary" onClick={() => onStatement(saveItem(draft, itemId))} data-save-statement>
                保存して明細を開く
              </button>
            </>
          ) : leaving ? (
            <>
              <p class="ip-note warn">保存していない変更があります。閉じると、この変更は消えます。</p>
              <button type="button" class="btn" onClick={() => setLeaving(false)}>
                入力に戻る
              </button>
              <button type="button" class="btn danger" onClick={onClose} data-discard>
                変更を捨てて閉じる
              </button>
            </>
          ) : (
            <>
              <p class="ip-note" data-panel-note>
                {note}
              </p>
              <button type="button" class="btn" onClick={onClose}>
                キャンセル
              </button>
              {/* 保存すると何が起きるかは、保存のボタンのすぐ右の「?」の中（前は下の帯の左端にあり、何の説明か分からなかった。0077 の 2026-10-29 の追記） */}
              <HelpOf
                help={
                  <Help label="保存" id="save" target="保存">
                    <p>{saveHelp}</p>
                    {!removed && item.estimated > 0 ? <p>保存しても、推定の欄が残る間は項目は「推定で計算中」のままです。</p> : null}
                  </Help>
                }
              >
                <button type="button" class="btn primary" onClick={save} data-save>
                  保存
                </button>
              </HelpOf>
            </>
          )}
        </div>
      </div>
    </>
  );
}
