// 入力のホーム（作業の層の部品）: 15枚のカードを同じ大きさのグリッドで並べ、押すと中央に入力のパネルが開く。
// カードに出すのは「イラスト＋名前＋要約の数字1つ＋状態（4つ）」まで。カードは、未入力・推定のときに何で計算しているかの1行と、
// 「当てはまらない」「目安で入れる」の1押しを出す。上部に進み具合（未入力〔0円の所あり〕の数を左に強く、続けて入力済み・推定で計算中・当てはまらない・まだ入れていない）。
// カードの下にピン（ホームに出した物。押すとその物だけを開く。進み具合に数えない）。ピンは「📌 ホームに出す」で出した物と、前の版の「＋ 項目を追加」で足した物
// 入力項目の並びの最後は「探して開く」（InputFind.tsx）: 言葉から、それを入れる入力項目の欄を開く（前の「＋ 項目を追加」の所。新しい物は作らない。0045 の 2026-11-04 の追記）
// 0072: 進み具合の状態を押すとそのカードだけに絞る・小さな結果（金融資産の線と足りなくなる年）・全部のカードの入れ方（簡易／詳細）・
// カードをまたぐ取り込みの入口（「取り込む」。プランの編集中は押せない）・確かめの一覧にプランで足した物の行
// 0077: 上部は2行（1行目: 見出しと進み具合、2行目: 編集の対象と道具）。説明の文は「?」の中へ。小さな結果と、全部のカードの入れ方の一括の切り替えは外した
// （入れ方の標準／詳細はカードごと。パネルの見出しの切り替えで、そのカードだけを変える）。プランを選んでも上部とカードの配置は動かさない
// 0077 の追記: 控え・面談の準備・取り込むの入口は上の帯の FP のメニューへ移した。ホームの上部は進み具合と編集の対象だけ。
// メニューから開いた中身は、2行目の下に幅いっぱいで出す。項目がまだ何も入っていない新しい世帯のときだけ、ホームにも「取り込む」を出す
// 入力項目の選び方（itemChoice.ts）: 1行目の右の「入力項目を選ぶ」で、この世帯で出す入力項目と開いたときの入れ方を選ぶ。非表示の項目は進み具合に数えない。
// 「最初の5枚」の案内と印はなくした（どの項目から入れてもよい。並びは事務所の既定値で変えられる）
import { Fragment, type ComponentChildren } from "preact";
import { Help } from "../../presentation/Help.tsx";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { toggledSet, type GroupOpenState } from "./FieldViews.tsx";
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";
import { inSimpleOnlyGroup, type Level } from "./form.ts";
import type { WorkingHousehold } from "./household.ts";
import { ILLUSTRATIONS } from "./illustrations.ts";
import { InputPanel } from "./InputPanel.tsx";
import { DEFAULT_LAYOUT, estimatedList, fillCard, nothingEnteredYet, groupedItems, inputItems, itemOf, itemStage, notApplicableCard, pinItems, progressOf, shownItems, summarySegments, togglePin, type CardLayout, type InputItem, type ItemStatus, type PinItem, type Summary } from "./items.ts";
import { InputFind } from "./InputFind.tsx";
import type { FindHit, FindTarget } from "./inputSearch.ts";
import { inheritanceTaxNote, useInheritanceEstimate } from "./inheritanceLine.ts";
import { pensionEstimateSummary, usePensionEstimate } from "./pensionEstimate.ts";
import { STAGE_ORDER } from "./stages/index.ts";
import { STATUS_TEXT, StatusBadge, statusText } from "./StatusBadge.tsx";
import { CheckList, checkButtonText, checkSummary } from "./CheckList.tsx";
import { DocRequests } from "./DocRequests.tsx";
import { docRequests, type DocRequest } from "./docRequests.ts";
import { docStartOf, type DocStart } from "../documents/start.ts";
import type { NoticeRow } from "../engineNotices.ts";
import { DiffList, PlanTarget, type PlanEditProps } from "./PlanEdit.tsx";
import { countsByCard, diffRows, planIndex, planView, recordPlanEdit } from "../plans/planEdit.ts";
import { ItemChooser, type OfficeItems } from "./ItemChooser.tsx";
import { levelIn } from "./itemChoice.ts";
import { sortChildrenByBirth } from "./stages/family.ts";
import { DocLinks, DocViewContext, ReceivedButton, ReceivedDocs, useReceivedDocs, type ReceivedProps } from "../hearing/ReceivedDocs.tsx";
import { DocViewer } from "../hearing/DocViewer.tsx";
import { keepWebLog } from "../hearing/web.ts";

interface Props {
  wh: WorkingHousehold;
  /** パネルで「保存」した世帯（親が計算し直す） */
  onSave: (next: WorkingHousehold) => void;
  /** カードの入れ方（標準／詳細）の初め（URL の #level=detail など）。カードごとにパネルの見出しで切り替える（0077） */
  level: Level;
  /** 開いたときにパネルを開く項目（URL の #open=work など。画面の確かめ用） */
  initialOpen?: string;
  /** FP のメニュー（上の帯）から開いた中身（控え・面談の準備のパネル）。2行目の下に出す */
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
  /** 入力項目の並び（事務所の既定値。省くと標準） */
  layout?: CardLayout;
  /** 現状の計算結果の知らせ（確かめの一覧の「計算の知らせ」。0064） */
  calcNotices?: readonly NoticeRow[];
  /**
   * カードをまたぐ取り込みの入口（ヒアリングシート・AI に資料を渡す。0072）。ホームの「取り込む」にまとめる。
   * 取り込みは現状に入るので、プランの編集中は押せない（「現状に切り替える」を出す）。
   * 入口は上の帯の FP のメニュー。項目がまだ何も入っていない新しい世帯のときだけ、ホームにも「取り込む」を出す
   */
  imports?: ComponentChildren;
  /** 「入力項目を選ぶ」を開いて始める（URL の #choose。画面の確かめ用） */
  chooseOpen?: boolean;
  /** 事務所の既定の選び方（入力項目を選ぶの「この選び方を事務所の既定にする」。0091） */
  officeItems?: OfficeItems;
  /** 「探して開く」に初めに入れておく言葉（URL の #find=留学。画面の確かめ用） */
  findQuery?: string;
  /**
   * 書類の読み取りへ進む（0154 の3）: 書類のお願いの1通の「この書類を読む」・書類待ちの欄・保険と年金の見出しの「書類から読む」。
   * 取り込みは現状に入るので、プランの編集中は入口を出さない
   */
  onReadDoc?: (start: DocStart) => void;
  /** 取り込みの中身を開いているか（親が持つ。FP のメニューから開く）。省くとホームの中で持つ */
  importsOpen?: boolean;
  onImportsOpen?: (open: boolean) => void;
  /** Web のヒアリングで受け取った書類の保存の口と、依頼の記録の書き換え（見た・保存した・消す。0191）。省くと保存のボタンを出さない */
  received?: ReceivedProps;
}

/** 進み具合の状態の名前（絞り込みの文） */
const STATUS_NAMES: Record<ItemStatus, string> = { missing: "未入力（0円の所あり）", done: "入力済み", est: "推定で計算中", na: "該当なし", empty: "まだ入れていない", std: "既定の値で計算中" };

interface CardActions {
  /** 「当てはまらない」の1押し（プランの編集中は押せない。ボタンは出したまま、配置を動かさない） */
  onNa?: (id: string) => void;
  /** 「目安で入れる」の1押し */
  onFill?: (id: string) => void;
}

/** プランの編集中に、カードの1押しを押せない理由 */
const CARD_ACT_OFF = "現状を直す操作のため、プランの編集中は使えません";

/** 要約の文字: 「・」の区切りごとのまとまりにして、まとまりの途中では折り返さない（items.ts の summarySegments。0045 の 2026-10-29 の追記） */
function SummaryText({ s, plain }: { s: Summary; plain?: boolean }) {
  return (
    <>
      {summarySegments(s).map((seg, i) => (
        <Fragment key={i}>
          {i > 0 ? <wbr /> : null}
          <span class="sum-seg">{seg.map((p, j) => (p.small && plain !== true ? <small key={j}>{p.text}</small> : p.text))}</span>
        </Fragment>
      ))}
    </>
  );
}

function Card({ item, onOpen, flash, diffs, acts }: { item: InputItem; onOpen: (id: string) => void; flash: boolean; diffs?: { label: string; n: number } | undefined; acts: CardActions }) {
  const s = item.summary;
  const tip = item.status === "est" ? estimatedList(item.estimatedNames ?? [], item.estimated) : null;
  const showNa = item.canNa;
  const showFill = item.canFill;
  return (
    <div class={`ih-card s-${item.status}${flash ? " flash" : ""}`} style={{ "--c": item.color }}>
      <button type="button" class="ih-open" data-card={item.id} aria-label={`${item.label}（${statusText(item)}${diffs !== undefined && diffs.n > 0 ? `・${diffs.label}で${diffs.n}か所` : ""}）を開く`} onClick={() => onOpen(item.id)}>
        <span class="ih-ill" aria-hidden="true">
          <img src={ILLUSTRATIONS[item.art]} alt="" />
        </span>
        {/* プランで直した所の数: 絵の上に重ねる（カードの高さを変えない） */}
        {diffs !== undefined && diffs.n > 0 ? (
          <span class="plan-count on-card" data-plan-count={diffs.n}>
            {diffs.label}: {diffs.n}か所
          </span>
        ) : null}
        <span class="ih-body">
          <span class="ih-name">
            {item.label}
          </span>
          <span class="ih-sum">
            {s === null ? (
              <span class="yet">{item.status === "na" ? "なし" : "まだ入っていません"}</span>
            ) : (
              <SummaryText s={s} />
            )}
          </span>
          {s?.note !== undefined ? (
            <span class="ih-note" data-note={item.id}>
              {s.note}
            </span>
          ) : null}
          {tip === null ? <StatusBadge item={item} mini /> : null}
        </span>
      </button>
      {/* 推定で計算中の札: カーソルを合わせる・キーボードでフォーカスする・押すと、何が推定かの短い一覧（「?」と同じ吹き出しの部品。札の文字と大きさは変えない。
          開くボタンの中にボタンを入れられないので、札だけをボタンの外の同じ所に置く。0041 の追記 2026-11-06） */}
      {tip !== null ? (
        <div class="ih-est-tip" data-est-tip={item.id}>
          <Help label={`${item.label}の推定`} mark={STATUS_TEXT.est} markClass="ih-st est mini" target="推定のままの欄">
            <ul class="ih-est-list">
              {tip.names.map((n) => (
                <li key={n}>{n}</li>
              ))}
              {tip.rest > 0 ? <li>ほか {tip.rest}か所</li> : null}
            </ul>
          </Help>
        </div>
      ) : null}
      {item.hint !== null ? (
        <div class="ih-hint" data-hint={item.id}>
          <p>{item.hint}</p>
          {showNa || showFill ? (
            <div class="ih-hint-acts">
              {showFill ? (
                <button type="button" class="btn small" onClick={() => acts.onFill?.(item.id)} disabled={acts.onFill === undefined} {...(acts.onFill === undefined ? { title: CARD_ACT_OFF } : {})} data-card-fill={item.id}>
                  推定で入れる
                </button>
              ) : null}
              {showNa ? (
                <button type="button" class="btn small" onClick={() => acts.onNa?.(item.id)} disabled={acts.onNa === undefined} {...(acts.onNa === undefined ? { title: CARD_ACT_OFF } : {})} data-card-na={item.id}>
                  該当なし
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
      <button type="button" class="ih-pin-open" data-pin={pin.id} aria-label={`ピン: ${pin.label}（${statusText(pin)}。物は${where}の項目）を開く`} onClick={() => onOpen(pin.id)}>
        <span class="ih-pin-name">
          <span aria-hidden="true">📌</span> {pin.label}
          {pin.planOnly && planLabel !== null ? (
            <span class="plan-count" data-pin-plan>
              {planLabel}で足した
            </span>
          ) : null}
        </span>
        <span class="ih-pin-sum">
          {s === null ? "" : <SummaryText s={s} plain />}
          <small>（{where}）</small>
        </span>
        <StatusBadge item={pin} mini />
      </button>
      {onUnpin !== undefined ? (
        <button type="button" class="link-btn" onClick={() => onUnpin(pin)} data-unpin={pin.id} title="ピンだけを外します（物は残ります）">
          ピンを外す
        </button>
      ) : null}
    </div>
  );
}

const NO_NOTICES: readonly NoticeRow[] = [];

/**
 * カードをまたぐ取り込みの入口（ヒアリングシート・AI に資料を渡す）。明細は基本生活費のカードの見出しから（ここには置かない）。
 * 取り込みは現状に入るので、プランの編集中（off）は中身の代わりに「現状に切り替える」を出す。ボタンの大きさは変えない（配置を動かさない）。
 * button を false にすると「取り込む ▾」を描かず、開いた中身だけを出す（FP のメニューから開いたとき。中身に「閉じる」を出す）
 */
export function ImportMenu({ children, off, initialOpen = false, open: outer, onOpen, button = true }: { children?: ComponentChildren; off?: { label: string; toCurrent?: () => void }; initialOpen?: boolean; open?: boolean; onOpen?: (open: boolean) => void; button?: boolean }) {
  const [inner, setInner] = useState(initialOpen);
  const open = outer ?? inner;
  const setOpen = (v: boolean) => (onOpen !== undefined ? onOpen(v) : setInner(v));
  return (
    <>
      {button ? (
        <div class={`ih-imports${off !== undefined ? " off" : ""}`} data-imports {...(off !== undefined ? { "data-current-only": true } : {})}>
          <button type="button" class="add-btn" aria-expanded={open} onClick={() => setOpen(!open)} data-imports-open>
            取り込む {open ? "▴" : "▾"}
          </button>
          <Help label="取り込む">
            <p>ヒアリングシート・AI に渡した資料から、まとめて取り込みます。どれも候補として受け、確かめてから現状に入ります。</p>
            <p>明細（口座・カード）は、基本生活費の項目の見出しの「明細から出す」から取り込みます。</p>
            <p>取り込みは現状に入るため、プランの編集中は使えません。はじめのほかは、上の帯の FP のメニューから開きます。</p>
          </Help>
        </div>
      ) : null}
      {open ? (
        <div class="ih-imports-list" data-imports-list {...(!button && off !== undefined ? { "data-current-only": true } : {})}>
          {!button ? (
            <div class="ih-imports-h">
              <b>取り込む</b>
              <button type="button" class="btn small" onClick={() => setOpen(false)} data-imports-close>
                閉じる
              </button>
            </div>
          ) : null}
          {off !== undefined ? (
            <p class="in-note">
              {off.label}の編集中は取り込めません（取り込みは現状に入ります）。
              {off.toCurrent !== undefined ? (
                <button type="button" class="link-btn" onClick={off.toCurrent} data-to-current>
                  現状に切り替える
                </button>
              ) : null}
            </p>
          ) : (
            children
          )}
        </div>
      ) : null}
    </>
  );
}

export function InputView({ wh, onSave, level, initialOpen, tools, computeOne, statement, plans, layout = DEFAULT_LAYOUT, calcNotices = NO_NOTICES, imports, importsOpen, onImportsOpen, chooseOpen = false, officeItems, findQuery, onReadDoc, received }: Props) {
  /** 直しているプラン（直せないときは現状） */
  const editing = plans !== undefined && plans.sel !== null && plans.lock === null ? (plans.list.find((x) => x.id === plans.sel) ?? null) : null;
  const pcat = plans?.cat;
  /** カードに見せる世帯（プランを直しているときはそのプランの中身。カードの要約・状態もプランの中身から） */
  const shown = useMemo(() => (editing === null || pcat === undefined ? wh : planView(wh, pcat, editing.id)), [wh, editing, pcat]);
  const rows = useMemo(() => (editing === null || pcat === undefined ? [] : diffRows(wh, pcat, editing.id, planIndex([wh, shown]))), [wh, editing, pcat, shown]);
  const counts = useMemo(() => countsByCard(rows), [rows]);
  const [diffOpen, setDiffOpen] = useState(false);
  /** 取り込みの中身を開いているか（親が持たないとき） */
  const [homeImports, setHomeImports] = useState(false);
  /** 相続・贈与のカードの要約（相続税の目安。計算の結果から読むだけ） */
  const inheritance = useInheritanceEstimate(shown, true, computeOne);
  const pensionEst = usePensionEstimate(shown, true, computeOne);
  /** 全部の入力項目（非表示の物も。「入力項目を選ぶ」の一覧） */
  const allItems = useMemo(() => inputItems(shown, { layout, inheritanceTax: inheritanceTaxNote(inheritance), pension: pensionEstimateSummary(shown, pensionEst.std) }), [shown, layout, inheritance, pensionEst]);
  /** ホームに出す入力項目（非表示にしてあり値の入っていない物を除く。プランで直した所のある項目は出す） */
  const items = useMemo(() => shownItems(allItems.map((i) => (i.hidden && (counts.get(i.id) ?? 0) > 0 ? { ...i, hidden: false } : i))), [allItems, counts]);
  const pins = useMemo(() => pinItems(shown, editing !== null ? wh : undefined), [shown, editing, wh]);
  const groups = useMemo(() => groupedItems(items), [items]);
  const p = progressOf(items);
  /** 項目がまだ何も入っていない新しい世帯（このときだけホームにも「取り込む」を出す） */
  const fresh = useMemo(() => nothingEnteredYet(wh, editing === null ? items : inputItems(wh, { layout })), [wh, editing, items, layout]);
  /** 進み具合の状態で絞る（null は全部） */
  const [statusFilter, setStatusFilter] = useState<ItemStatus | null>(null);
  const filterBy = (st: ItemStatus) => setStatusFilter(statusFilter === st ? null : st);
  const shownGroups = statusFilter === null ? groups : groups.map((g) => ({ ...g, items: g.items.filter((i) => i.status === statusFilter) })).filter((g) => g.items.length > 0);
  const [openId, setOpenId] = useState<string | null>(initialOpen !== undefined && (allItems.some((i) => i.id === initialOpen) || wh.addedItems.some((a) => a.id === initialOpen)) ? initialOpen : null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [statementOpen, setStatementOpen] = useState(statement?.initialOpen === true);
  const [checkOpen, setCheckOpen] = useState(initialOpen === "check");
  /** 確かめの一覧から開いたときに移る欄 */
  const [focusKey, setFocusKey] = useState<string | null>(null);
  /** 「探して開く」から開いたときに移る所（欄・ボタン・まとまり・区画） */
  const [focusAt, setFocusAt] = useState<FindTarget | null>(null);
  const check = useMemo(() => checkSummary(wh, calcNotices), [wh, calcNotices]);
  /** 書類のお願い（書類待ちの欄から作る送ってほしい書類の一覧。0102） */
  const [docsOpen, setDocsOpen] = useState(initialOpen === "docs");
  const docCount = useMemo(() => (check.counts.unknown > 0 ? docRequests(wh).length : 0), [wh, check.counts.unknown]);
  /** Web のヒアリングで受け取った書類（一覧・横に出して見る・保存。0191） */
  const rd = useReceivedDocs(wh, received ?? { update: (f) => onSave(f(wh)) });
  /** パネルの下書き（開いたときの世帯から作る）を入れるとき、開いている間に変わった Web の依頼の記録（見た・保存した印）を戻さない */
  const keepWeb = (next: WorkingHousehold): WorkingHousehold => (next.hearing === wh.hearing ? next : keepWebLog(next, wh));
  /**
   * カードごとの入れ方（標準／詳細）。パネルの見出しで切り替えた入れ方は画面の中だけで持ち、保存しない（0077）。
   * 切り替えていないカードは、世帯の選び方の「開いたときの入れ方」（ピンは物が属するカードの入れ方）、無ければ level（初め）
   */
  const [levels, setLevels] = useState<Readonly<Record<string, Level>>>({});
  const levelOf = (id: string): Level => levels[id] ?? levelIn(wh.itemChoice, pins.find((x) => x.id === id)?.owner ?? id) ?? level;
  const forgetLevel = (id: string) =>
    setLevels((m) => {
      const { [id]: _gone, ...rest } = m;
      void _gone;
      return rest;
    });
  const setLevelOf = (id: string, l: Level) => setLevels((m) => ({ ...m, [id]: l }));
  /**
   * まとまりごとの「▸ 詳しく」で開いた物（まとまりのキー）。同じ世帯を開いている間だけ覚え、保存しない（0078 の追記）。
   * 保存して閉じたときは覚えたまま、キャンセル（保存しないで閉じる）では、そのとき開いていたものを閉じた状態に戻す（0078 の 2026-11-05 の追記）
   */
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const groupOpen = useMemo<GroupOpenState>(() => ({ isOpen: (k) => openGroups.has(k), toggle: (k) => setOpenGroups((s) => toggledSet(s, k)) }), [openGroups]);
  /** パネルを開いたときの「▸」の開き閉じ（キャンセルで戻す先） */
  const openGroupsAtOpen = useRef<ReadonlySet<string>>(openGroups);
  useEffect(() => {
    if (openId !== null) openGroupsAtOpen.current = openGroups;
    // パネルを開いた時点の状態だけを覚える（開いている間の開け閉めでは覚え直さない）
  }, [openId]);
  const backTo = useRef<string | null>(null);
  /** 「探して開く」から開いたパネルを閉じたら、探す欄に戻る */
  const backToFind = useRef(false);

  // パネルを閉じたら、押したカード（「探して開く」から開いたときは探す欄）に戻る。カードが無い（ホームに出していない入力項目）ときも探す欄へ
  useEffect(() => {
    if (openId !== null || backTo.current === null) return;
    const find = document.querySelector<HTMLElement>("[data-find-input]");
    const el = (backToFind.current ? find : null) ?? document.querySelector<HTMLElement>(`[data-card="${backTo.current}"]`) ?? find;
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest" });
    backTo.current = null;
    backToFind.current = false;
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
    setFocusKey(null);
    setFocusAt(null);
    backToFind.current = false;
    setOpenId(id);
  };
  // 確かめの一覧の「開く」: カードを開いて欄に移る（詳細の欄なら詳細にする）。移るだけで値も状態も変えない
  const openField = (id: string, key: string | null, l: Level) => {
    if (l === "detail" && levelOf(id) !== "detail") setLevelOf(id, "detail");
    // 標準だけのまとまりの欄（今の働き方など）は、詳細では出ないので標準にして移る
    else if (key !== null && levelOf(id) === "detail") {
      const st = itemStage(shown, id);
      if (st !== null && inSimpleOnlyGroup(st, key)) setLevelOf(id, "simple");
    }
    setFocusKey(key);
    setFocusAt(null);
    backToFind.current = false;
    setOpenId(id);
  };
  // 「探して開く」で選んだ欄: 入力項目を開いてその所へ移る（詳細だけの所なら詳細、標準だけの所なら標準にする）。
  // ホームに出していない入力項目も、そのまま開く（入力項目の選び方は変えない。値を入れて保存すると、今の決まりどおりホームに出る）
  const openFound = (h: FindHit) => {
    const id = h.card;
    if (h.level !== null && levelOf(id) !== h.level) setLevelOf(id, h.level);
    setFocusKey(null);
    setFocusAt(h.target.kind === "card" ? null : h.target);
    backToFind.current = true;
    setOpenId(id);
  };
  // 保存しないで閉じる（キャンセル・変更を捨てて閉じる・Esc）: 入れた値と同じく、開いた「▸」も開く前に戻す
  const close = () => {
    backTo.current = openId;
    setOpenGroups(openGroupsAtOpen.current);
    setOpenId(null);
    setFocusKey(null);
    setFocusAt(null);
  };
  // 基本生活費のパネル → 明細のパネル → 基本生活費のパネル（承認した値が見えるように、保存した世帯から開き直す）
  const openStatement = (saved?: WorkingHousehold) => {
    if (saved !== undefined) onSave(keepWeb(saved));
    backTo.current = null;
    setOpenId(null);
    setStatementOpen(true);
  };
  // 書類の読み取りへ進む（パネルから: 保存していない変更を保存し、パネルを閉じてから）
  const readDocFromPanel = (start: DocStart, saved?: WorkingHousehold) => {
    if (onReadDoc === undefined) return;
    if (saved !== undefined) onSave(keepWeb(saved));
    backTo.current = null;
    setOpenId(null);
    onReadDoc(start);
  };
  const backFromStatement = (approved?: number) => {
    setStatementOpen(false);
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
            setToast(`「${items.find((i) => i.id === id)?.label ?? ""}」を該当なしにしました`);
          },
          onFill: (id) => {
            onSave(fillCard(wh, id));
            setFlashId(id);
            setToast(`「${items.find((i) => i.id === id)?.label ?? ""}」を推定で入れました`);
          },
        };
  const unpin = (pin: PinItem) => {
    onSave(togglePin(wh, pin.added));
    setToast(`「${pin.label}」のピンを外しました（物は残ります）`);
  };
  const save = (next0: WorkingHousehold, id: string) => {
    // パネルを開いている間に付けた受け取った書類の印（見た・保存した）を、パネルの下書きの古い依頼の記録で戻さない
    const next = keepWeb(next0);
    const label = itemOf(next, id)?.label;
    if (editing !== null && plans !== undefined) plans.onSavePlan(next);
    // 家族は保存のときに子を生年月の順に並べ直す（打っている間は並び替えない。family.ts の panelOrder）
    else onSave(id === "family" ? sortChildrenByBirth(next) : next);
    backTo.current = id;
    setOpenId(null);
    setFocusAt(null);
    setFlashId(id);
    setToast(editing !== null ? `「${label ?? ""}」を${editing.label}に保存しました` : label !== undefined ? `「${label}」を保存しました` : "保存しました");
  };

  const importOff =
    editing !== null
      ? {
          off: {
            label: editing.label,
            ...(plans !== undefined ? { toCurrent: () => plans.onSelect(null) } : {}),
          },
        }
      : {};
  const importCtl = importsOpen !== undefined ? { open: importsOpen, ...(onImportsOpen !== undefined ? { onOpen: onImportsOpen } : {}) } : { open: homeImports, onOpen: setHomeImports };

  return (
    <DocViewContext.Provider value={rd}>
    <div class="ih">
      {/* 1行目: 見出し・確かめの一覧・進み具合 */}
      <div class="ih-head">
        <div class="ih-head-l">
        <h1>
          入力
          <Help label="入力のホーム" id="home">
            <p>入力項目を押すと、入力のパネルが開きます。入れ方（標準／詳細）は、パネルの見出しで項目ごとに切り替えます。</p>
            <p>右の「入力項目を選ぶ」で、この世帯で出す入力項目と、開いたときの入れ方を選べます。</p>
            <p>入れていない欄は統計の平均などで補って計算します（「推定で計算中」の印）。</p>
            <p>保存した世帯は、世帯ごとに暗号化して自動で保存します（見本の世帯は保存しません。上の「世帯」から保存できます）。</p>
            <p>進み具合の「未入力」「入力済み」などを押すと、その入力項目だけに絞ります。</p>
          </Help>
        </h1>
          <div class="ih-check">
            {/* 数は短く「未入力 3か所・推定 15か所 ほか」。種類ごとの数の並びは開いた中だけ（0041 の追記 2026-11-06） */}
            <button type="button" class="add-btn" aria-expanded={checkOpen} onClick={() => setCheckOpen(!checkOpen)} data-check-open>
              {checkButtonText(check.counts)}
            </button>
            {docCount > 0 || docsOpen ? (
              <button type="button" class="add-btn" aria-expanded={docsOpen} onClick={() => setDocsOpen(!docsOpen)} data-docs-open>
                書類のお願い（{docCount}通）
              </button>
            ) : null}
            <ReceivedButton rd={rd} />
          </div>
        </div>
        <div class="ih-prog" aria-live="polite">
          <div class="ih-prog-line" data-progress>
            {/* 未入力の入力項目の数。1以上のときだけ赤い札、0なら灰色の文字だけ（0041 の追記 2026-11-06） */}
            <button type="button" class={`ih-prog-miss${p.missing > 0 ? " on" : " zero"}${statusFilter === "missing" ? " sel" : ""}`} data-progress-missing={p.missing} aria-pressed={statusFilter === "missing"} onClick={() => filterBy("missing")}>
              {p.missing > 0 ? <span class="ih-st missing mini">未入力（0円の所あり）</span> : <span class="ih-prog-zero">未入力</span>} <span class="n">{p.missing}</span>
              <span class="u">項目</span>
            </button>
            <span class="ih-prog-rest">
              {p.total}項目中{" "}
              <button type="button" class={`ih-prog-f${statusFilter === "done" ? " sel" : ""}`} aria-pressed={statusFilter === "done"} onClick={() => filterBy("done")} data-progress-filter="done">
                入力済み <span class="n">{p.done}</span>
              </button>
              ・
              <button type="button" class={`ih-prog-f${statusFilter === "est" ? " sel" : ""}`} aria-pressed={statusFilter === "est"} onClick={() => filterBy("est")} data-progress-filter="est">
                推定で計算中 <span class="n">{p.est}</span>
              </button>
              ・
              <button type="button" class={`ih-prog-f${statusFilter === "na" ? " sel" : ""}`} aria-pressed={statusFilter === "na"} onClick={() => filterBy("na")} data-progress-filter="na">
                該当なし <span class="n">{p.na}</span>
              </button>
              ・
              <button type="button" class={`ih-prog-f${statusFilter === "empty" ? " sel" : ""}`} aria-pressed={statusFilter === "empty"} onClick={() => filterBy("empty")} data-progress-filter="empty">
                まだ入れていない <span class="n">{p.empty}</span>
              </button>
              {p.std > 0 || statusFilter === "std" ? (
                <>
                  ・
                  <button type="button" class={`ih-prog-f${statusFilter === "std" ? " sel" : ""}`} aria-pressed={statusFilter === "std"} onClick={() => filterBy("std")} data-progress-filter="std">
                    既定の値で計算中 <span class="n">{p.std}</span>
                  </button>
                </>
              ) : null}
            </span>
          </div>
          <div class="ih-prog-bar" aria-hidden="true">
            {items.map((i) => (
              <i key={i.id} class={i.status} />
            ))}
          </div>
        </div>
      </div>
      {/* 2行目: 編集の対象（と、新しい世帯のときだけ「取り込む」）と、右端に「入力項目を選ぶ」。控え・面談の準備は上の帯の FP のメニューから開き、中身はこの行の下に幅いっぱいで出す */}
      <div class="ih-bar" data-home-bar>
        {plans !== undefined && (plans.list.length > 0 || plans.sel !== null) ? <PlanTarget p={plans} {...(editing !== null ? { diffs: { rows, open: diffOpen, onOpen: setDiffOpen } } : {})} /> : null}
        {imports !== undefined && fresh ? (
          <div class="ih-tools">
            <ImportMenu {...importOff} {...importCtl}>
              {imports}
            </ImportMenu>
          </div>
        ) : null}
        {/* 右端: 入力項目を選ぶ（この世帯で出す入力項目と、開いたときの入れ方。選び方は世帯全体の物なので、プランの編集中も現状の世帯に入れる） */}
        <ItemChooser wh={wh} items={allItems} onChange={onSave} onLevel={forgetLevel} initialOpen={chooseOpen} {...(officeItems !== undefined ? { office: officeItems } : {})} />
      </div>
      {/* FP のメニューから開いた中身（控え・面談の準備・取り込む）の置き場。余白はこの箱が持つ（パネルごとに足さない。0077 の追記） */}
      <div class="ih-opened" data-home-opened>
        {tools}
        {imports !== undefined && !fresh ? (
          <ImportMenu button={false} {...importOff} {...importCtl}>
            {imports}
          </ImportMenu>
        ) : null}
      </div>
      {editing !== null && pcat !== undefined && diffOpen && plans !== undefined ? <DiffList rows={rows} wh={wh} planId={editing.id} planLabel={plans.list.find((x) => x.id === editing.id)?.label ?? "このプラン"} cat={pcat} onEdit={plans.onSavePlan} onOpen={open} onClose={() => setDiffOpen(false)} /> : null}
      {docsOpen ? <DocRequests wh={wh} onOpen={openField} onClose={() => setDocsOpen(false)} {...(onReadDoc !== undefined && editing === null ? { onRead: (r: DocRequest) => { const st = docStartOf(r); if (st !== null) onReadDoc(st); } } : {})} /> : null}
      {rd.listOpen ? <ReceivedDocs rd={rd} /> : null}
      {checkOpen ? (
        <CheckList
          wh={wh}
          onDocRequests={() => setDocsOpen(true)}
          notices={calcNotices}
          onOpen={openField}
          onEdit={(next, done) => {
            onSave(next);
            setToast(done);
          }}
          {...(editing !== null && pcat !== undefined && plans !== undefined
            ? {
                plan: {
                  label: editing.label,
                  view: shown,
                  onEdit: (next: WorkingHousehold, done: string) => {
                    plans.onSavePlan(recordPlanEdit(wh, pcat, editing.id, shown, next));
                    setToast(done);
                  },
                },
              }
            : {})}
        />
      ) : null}
      {statusFilter !== null ? (
        <p class="ih-filter" role="status" data-card-filter={statusFilter}>
          「{STATUS_NAMES[statusFilter]}」の入力項目だけを出しています（{shownGroups.reduce((n, g) => n + g.items.length, 0)}項目）。
          <button type="button" class="link-btn" onClick={() => setStatusFilter(null)} data-card-filter-clear>
            全部の入力項目を出す
          </button>
        </p>
      ) : null}
      {shownGroups.map((g, gi) => (
        <section class="ih-group" key={g.group?.id ?? "all"} aria-label={g.group?.label ?? "入力の項目"}>
          {g.group !== null ? <h2 class="ih-gh">{g.group.label}</h2> : null}
          <div class="ih-cards">
            {g.items.map((i) => (
              <Card key={i.id} item={i} onOpen={open} flash={flashId === i.id} diffs={editing !== null ? { label: editing.label, n: counts.get(i.id) ?? 0 } : undefined} acts={cardActs} />
            ))}
            {gi === shownGroups.length - 1 && statusFilter === null ? <InputFind wh={shown} items={allItems} onPick={openFound} {...(findQuery !== undefined ? { initialQuery: findQuery } : {})} /> : null}
          </div>
        </section>
      ))}
      {pins.length > 0 ? (
        <section class="ih-pins" aria-label="ホームに出した物（ピン）" data-pins>
          <h2 class="ih-gh">
            ピン
            <Help label="ピン">
              <p>ホームに出した物です。押すと、その物だけを開きます。進み具合には数えません。</p>
              <p>入力項目の中の物の見出しの「📌 ホームに出す」で出します（前の版の「＋ 項目を追加」で足した物も、ここに出ます）。「ピンを外す」はピンだけを外します（物は残ります）。</p>
            </Help>
          </h2>
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
          level={levelOf(openId)}
          onLevel={(l) => setLevelOf(openId, l)}
          groupOpen={groupOpen}
          onSave={save}
          onClose={close}
          {...(focusKey !== null ? { focusKey } : {})}
          {...(focusAt !== null ? { focusAt } : {})}
          {...(computeOne !== undefined ? { computeOne } : {})}
          {...(openId === "living" && statement !== undefined && editing === null ? { onStatement: openStatement } : {})}
          {...(onReadDoc !== undefined && editing === null ? { onReadDoc: readDocFromPanel } : {})}
          {...(editing !== null && pcat !== undefined ? { plan: { id: editing.id, label: editing.label, color: editing.color, cat: pcat } } : {})}
          docs={<DocLinks rd={rd} card={pins.find((x) => x.id === openId)?.owner ?? openId} />}
        />
      ) : null}
      {rd.viewing !== null ? <DocViewer rd={rd} beside={openId !== null} /> : null}
      {statement !== undefined && statementOpen ? statement.render(backFromStatement) : null}
      <div class={`toast${toast !== null ? " on" : ""}`} role="status" aria-live="polite">
        {toast ?? ""}
      </div>
    </div>
    </DocViewContext.Provider>
  );
}
