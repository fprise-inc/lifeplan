// 上のタブ「提案書」（作業の層）: 載せる案と章を選び、宛名を入れ（保存しない）、PDF の見本を画面の中で見て、「PDFを保存」で書き出す。
// - 計算は本体の正の計算（host.compute）。画面側の先出しの結果は PDF に使わない（0005 の2）
// - PDF は本体が作り、本体の中に置く。画面は見本の画像（ページごとの PNG）だけを受け取る（CSP の object-src・frame-src が none）
// - 保存は本体の平文の書き出しの出口（OS の保存のダイアログ）。最初の保存の前に、平文の注意を出す（0020 の5）
// - 保存したら、その時点の控え（0009 の2。きっかけ「PDF書き出し」）を残す（宛名・担当は控えに入れない）
// - タブの上の切り替えで「持ち帰り用のレポート」（顧客に渡す HTML ファイル1つ。0030。workspace/takeaway/TakeawayPanel.tsx）も作る。
//   どちらも「顧客に渡すもの」で、載せるプランの選び方・宛名・平文の書き出しの出口が同じなので、上のタブを増やさずに同じタブの中に置く
import { brandingNow, reportAccent } from "../office/branding.ts";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";
import { chapterList, E_REPORT_NO_YEARS, hasMaterial, type CashflowLayout, type ChapterId, type Orientation, type ProposalInput } from "../../../../report/src/index.ts";
import type { HostApi, RenderInfo, SaveOutcome } from "../../engine/host.ts";
import { forEngine } from "../../engine/moneyRows.ts";
import { isEngineError, type PreviewResult } from "../../engine/types.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { CURRENT } from "../plans/band.ts";
import type { Catalog } from "../plans/items.ts";
import type { Values } from "../plans/plans.ts";
import type { SnapshotDraft } from "../snapshots/snapshots.ts";
import type { BsColumn, BsPointKey, MoneyThreeSettings } from "../../presentation/model.ts";
import { BS_POINT_CHOICES, DEFAULT_BS_POINTS } from "../balanceTab.ts";
import { DEFAULT_CHAPTERS, DEFAULT_LAYOUT, estimatedCards, planReport, reportInput, today, type ReportChoice } from "./assemble.ts";
import { ReportViewer } from "./ReportViewer.tsx";
import { TakeawayPanel } from "../takeaway/TakeawayPanel.tsx";
import { OfficeNamesContext, rowNamesOf } from "../office/customTexts.ts";
import type { LoadedExtension } from "../extensions/manifest.ts";

interface Props {
  host: HostApi;
  wh: WorkingHousehold;
  catalog: Catalog;
  /** 主画面の帯（現状のほかに並べた案）・基準の案・選んだ案 */
  band: string[];
  base: string;
  selected: string;
  /** 保存していない変更がある案 */
  modified: ReadonlySet<string>;
  valuesOf: (id: string) => Values;
  letterOf: (id: string) => { letter: string; name: string };
  /** 表示の設定の「○歳時点」 */
  targetAge: number;
  /** 資産と負債のタブで時点を並べるときの既定の時点と、この世帯で選んだ時点（表示の設定。提案書のバランスシートの図も同じ時点にする） */
  bsPoints?: readonly BsPointKey[];
  bsColumns?: readonly BsColumn[] | null;
  /** お金の3つの分け方（資産と負債のタブの表示の設定。0032） */
  moneyThree?: MoneyThreeSettings;
  /** 提案書の拡張の章（今使える束の章。合算BS は、コードで有効・事務所の設定の印・役員として働く人のいる世帯のときだけ。0107・0114 の6） */
  extChapters?: readonly { id: `ext.${string}`; label: string }[];
  /** 今使える拡張の束（拡張の章の材料を作る） */
  extensions?: readonly LoadedExtension[];
  /** そのうち、見本の世帯でだけ見せている束の id（章に見本の印を付ける。0197） */
  sampleExtensions?: ReadonlySet<string>;
  /** PDF を保存したときに控えを残す（App が現状とプランの写しを足して世帯に入れる） */
  onSnapshot?: (d: SnapshotDraft) => Promise<void>;
  /** 最初に開く形（提案書の PDF・持ち帰り用のレポート） */
  initialMode?: "pdf" | "takeaway";
}

/** 提案書のタブ: 上の切り替えで、提案書の PDF と持ち帰り用のレポート（0030）を選ぶ */
export function ReportTab(p: Props) {
  const [mode, setMode] = useState<"pdf" | "takeaway">(p.initialMode ?? "pdf");
  return (
    <div class="rp-wrap">
      <div class="seg-g rp-mode" role="group" aria-label="作るもの">
        <button type="button" aria-pressed={mode === "pdf"} onClick={() => setMode("pdf")} data-report-mode="pdf">
          提案書（PDF）
        </button>
        <button type="button" aria-pressed={mode === "takeaway"} onClick={() => setMode("takeaway")} data-report-mode="takeaway">
          持ち帰り用のレポート（ブラウザで開くファイル）
        </button>
      </div>
      {mode === "pdf" ? (
        <ProposalPdf {...p} />
      ) : p.band.length === 0 ? (
        <section class="card rp-empty">
          <h2>持ち帰り用のレポート</h2>
          <p>載せるプランがありません。結果でプランを作り、帯に並べてから開いてください。</p>
        </section>
      ) : (
        <TakeawayPanel host={p.host} wh={p.wh} catalog={p.catalog} band={p.band} base={p.base} selected={p.selected} valuesOf={p.valuesOf} letterOf={p.letterOf} targetAge={p.targetAge} {...(p.moneyThree !== undefined ? { moneyThree: p.moneyThree } : {})} {...(p.onSnapshot !== undefined ? { onSnapshot: p.onSnapshot } : {})} />
      )}
    </div>
  );
}

export interface ReportTimings {
  /** 正の計算（本体） */
  computeMs: number;
  /** 帳票の入力の組み立て（画面） */
  buildMs: number;
  /** PDF を作る（本体の中の時間・画面から見た時間） */
  renderHostMs: number;
  renderMs: number;
  /** 押してから見本の1ページ目が出るまで */
  totalMs: number;
  pages: number;
  bytes: number;
  slots: number;
}

type Status = { kind: "idle" } | { kind: "busy"; step: string } | { kind: "ready" } | { kind: "error"; code: string };

/** 平文の注意（提案書の PDF は最初の保存の前に出す。0020 の5）。アプリを開いている間だけ覚える（設定の保存は後の回） */
let warnedThisSession = false;

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}秒`;

/** 紙の向きの選択肢（1冊の中の向き） */
const ORIENTATIONS: { id: Orientation; label: string; note: string }[] = [
  { id: "portrait", label: "縦にそろえる", note: "印刷して綴じる・両面印刷に向きます" },
  { id: "landscape", label: "横にそろえる", note: "画面で見せる（オンライン面談）に向きます" },
  { id: "mixed", label: "年ごとの表だけ横", note: "以前の形。キャッシュフロー表の章だけ A4 横" },
];

/** キャッシュフロー表の載せ方の選択肢 */
const CASHFLOWS: { id: CashflowLayout; label: string; note: string }[] = [
  { id: "summary", label: "要約（主な行・全年）", note: "収入合計・支出合計・年間収支・金融資産残高を、現状と提案で並べます" },
  { id: "excerpt", label: "抜粋（全部の行・5年ごと）", note: "最初と最後の年・5年ごと・主なできごとの年だけ" },
  { id: "full", label: "全年（全部の行）", note: "内訳まですべて。ページが増えます" },
];

/** 作れなかったときの文。直し方が決まっているものは案内を出し、ほかは符号をそのまま出す */
export function reportErrorText(code: string): string {
  // 時間切れ: 本体は時間切れの計算だけを2回まで頼み直している（0180 の2）。それでも終わらなかったときの文。「作り直す」を押せばよい
  if (code === "E_HOST_TIMEOUT") return "作れませんでした。計算に時間がかかりすぎて、途中で止まりました。入力のせいではなく、パソコンの負荷が高いときに起きます。ほかのアプリを閉じるか、少し待ってから、「作り直す」を押してください（E_HOST_TIMEOUT）";
  if (code === E_REPORT_NO_YEARS) return "作れませんでした（表に載る年がありません。表は計算基準月の翌年から載せます。入力の「表の最後の年」を計算基準の年より後にしてください）";
  return `作れませんでした（${code}）`;
}

/** 並べる時点の呼び方（例: 今・退職の年・75歳。年を直に選んだ時点は「2040年」） */
export function bsPointsText(columns: readonly BsColumn[] | null, defaults: readonly BsPointKey[]): string {
  const cols = columns ?? defaults.map((k) => ({ point: k }));
  return cols.map((c) => ("point" in c ? (BS_POINT_CHOICES.find((x) => x.key === c.point)?.label ?? c.point) : `${c.year}年`)).join("・");
}

function ProposalPdf(p: Props) {
  // 表の行の事務所の名前（カスタム層の名前の差し替え。承認した物だけ）。提案書でも画面と同じ名前にする
  const rowNames = rowNamesOf(useContext(OfficeNamesContext));
  const slots = [CURRENT, ...p.band];
  const firstProposal = p.selected !== CURRENT ? p.selected : (p.band[0] ?? CURRENT);
  const [proposal, setProposal] = useState(firstProposal);
  const [compare, setCompare] = useState<string[]>(slots);
  const [chapters, setChapters] = useState<Set<ChapterId>>(new Set(DEFAULT_CHAPTERS));
  // 提案書の拡張の章（合算BS など。0114 の6）は、今使える束の章だけを「提案での変更点」の後に出す
  const extKey = (p.extChapters ?? []).map((c) => c.id).join(",");
  const shownChapters = useMemo(() => chapterList(p.extChapters ?? []), [extKey]);
  const [addressee, setAddressee] = useState("");
  const [preparedBy, setPreparedBy] = useState("");
  const [orientation, setOrientation] = useState<Orientation>(DEFAULT_LAYOUT.orientation);
  const [cashflow, setCashflow] = useState<CashflowLayout>(DEFAULT_LAYOUT.cashflow);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [info, setInfo] = useState<RenderInfo | null>(null);
  const [built, setBuilt] = useState<{ key: string; input: ProposalInput; timings: ReportTimings; firstSvg: string | null } | null>(null);
  const [version, setVersion] = useState(0);
  const [warn, setWarn] = useState(false);
  const [saved, setSaved] = useState<SaveOutcome | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // 帯が変わったら、選べない案を外す
  useEffect(() => {
    if (!slots.includes(proposal) || proposal === CURRENT) setProposal(firstProposal);
    setCompare((c) => c.filter((id) => slots.includes(id)));
  }, [p.band.join(","), p.selected]);
  // 画面を離れたら、本体の中の PDF（宛名入り）を捨てる
  useEffect(() => () => void p.host.report.discard().catch(() => undefined), [p.host]);

  const choice: ReportChoice = useMemo(
    () => ({ proposal, compare: slots.filter((id) => compare.includes(id) || id === proposal), base: p.base, chapters: shownChapters.filter((c) => c.fixed || chapters.has(c.id)).map((c) => c.id), targetAge: p.targetAge, issuedOn: today(), preparedBy, layout: { orientation, cashflow }, bsPoints: p.bsPoints ?? DEFAULT_BS_POINTS, bsColumns: p.bsColumns ?? null, ...(p.moneyThree !== undefined ? { moneyThree: p.moneyThree } : {}) }),
    [proposal, compare.join(","), p.base, [...chapters].join(","), extKey, p.targetAge, preparedBy, slots.join(","), orientation, cashflow, JSON.stringify(p.bsPoints ?? null), JSON.stringify(p.bsColumns ?? null), JSON.stringify(p.moneyThree ?? null)],
  );
  // 何を変えたら作り直しが要るか（宛名も PDF に入るので含める。帳票の入力そのものは保存しない）
  const key = JSON.stringify({ choice, addressee: addressee.trim(), names: rowNames ?? null, wh: p.wh.request, ext: p.wh.extValues ?? null, values: slots.map((id) => p.valuesOf(id)) });
  const stale = built !== null && built.key !== key;
  const busy = status.kind === "busy";

  const build = async () => {
    if (proposal === CURRENT) return;
    setSaved(null);
    setSaveErr(null);
    const t0 = performance.now();
    try {
      setStatus({ kind: "busy", step: "計算しています…" });
      const plan = planReport({ wh: p.wh, catalog: p.catalog, valuesOf: p.valuesOf, letterOf: p.letterOf, ...(p.extensions !== undefined ? { extensions: p.extensions } : {}), ...(p.sampleExtensions !== undefined ? { sampleExtensions: p.sampleExtensions } : {}) }, choice);
      const names = Object.keys(plan.requests);
      const res = await p.host.compute(names.map((id) => ({ id, rev: 1, request: JSON.stringify(forEngine(plan.requests[id] as NonNullable<(typeof plan.requests)[string]>)) })));
      const results: Record<string, PreviewResult> = {};
      for (const id of names) {
        const r = res.slots[id]?.result;
        if (r === undefined || isEngineError(r)) throw r !== undefined && isEngineError(r) ? r.error.code : "E_REPORT_COMPUTE";
        results[id] = r;
      }
      const t1 = performance.now();
      setStatus({ kind: "busy", step: "作成しています…" });
      const input = reportInput({ ...plan.bundle(results), ...(rowNames !== undefined ? { names: rowNames } : {}) });
      const t2 = performance.now();
      // 事務所の基調の色（0121）を見出しなどの色に。事務所の名前とロゴは本体が事務所データから入れる
      const ri = await p.host.report.render(JSON.stringify(input), addressee.trim() === "" ? null : addressee.trim(), reportAccent(brandingNow()));
      const t3 = performance.now();
      // 見本の1ページ目を待つ（ここまでを「できるまでの時間」とする。読んだものは見本の画面がそのまま使う）
      const firstSvg = await p.host.report.pageSvg(0).catch(() => null);
      const timings: ReportTimings = { computeMs: t1 - t0, buildMs: t2 - t1, renderHostMs: ri.ms, renderMs: t3 - t2, totalMs: performance.now() - t0, pages: ri.pages, bytes: ri.bytes, slots: names.length };
      setInfo(ri);
      setBuilt({ key, input, timings, firstSvg });
      setVersion((v) => v + 1);
      setStatus({ kind: "ready" });
      if (import.meta.env.DEV) (globalThis as { __financiaReport?: unknown }).__financiaReport = { timings, chapters: input.chapters, comparison: input.comparison?.columns ?? null };
    } catch (e) {
      setStatus({ kind: "error", code: typeof e === "string" ? e : e instanceof Error ? e.message : "E_REPORT" });
    }
  };

  const doSave = async () => {
    setWarn(false);
    setSaveErr(null);
    try {
      const r = await p.host.report.save();
      warnedThisSession = true;
      setSaved(r);
      if (r.saved && built !== null && p.onSnapshot !== undefined) {
        const l = p.letterOf(proposal);
        const input = built.input;
        await p.onSnapshot({
          trigger: "pdf",
          memo: `提案書（${built.timings.pages}ページ）`,
          plan: { id: proposal, letter: l.letter, name: l.name },
          report: { chapters: [...(input.chapters ?? choice.chapters)], orientation: (input.layout ?? DEFAULT_LAYOUT).orientation, cashflow: (input.layout ?? DEFAULT_LAYOUT).cashflow, targetAge: choice.targetAge, issuedOn: input.document.issuedOn },
          outputs: { summary: input.summary, dataSet: input.assumptions.dataSet },
        }).catch(() => undefined);
      }
    } catch (e) {
      setSaveErr(typeof e === "string" ? e : "E_EXPORT");
    }
  };
  const save = () => (warnedThisSession ? void doSave() : setWarn(true));

  const material = (id: ChapterId) => (built === null ? true : hasMaterial(built.input, id) || !chapters.has(id));
  const drafted = [proposal, ...compare].some((id) => p.modified.has(id));
  const estimates = useMemo(() => estimatedCards(p.wh), [p.wh]);

  if (p.band.length === 0)
    return (
      <section class="card rp-empty">
        <h2>提案書</h2>
        <p>提案書に載せるプランがありません。結果でプランを作り、帯に並べてから開いてください。</p>
      </section>
    );

  return (
    <div class="rp" data-report-tab>
      <section class="card rp-side" aria-label="提案書の設定">
        <div class="card-h">
          <h2>提案書</h2>
          <span class="aside">β版・試算の印が入ります</span>
        </div>
        <div class="rp-actions">
          <button type="button" class="btn primary" disabled={busy || proposal === CURRENT || (built !== null && !stale && status.kind === "ready")} onClick={() => void build()} data-report-build>
            {built === null ? "見本を作る" : stale || status.kind !== "ready" ? "作り直す" : "見本は最新です"}
          </button>
          <button type="button" class="btn" disabled={busy || built === null || stale || status.kind !== "ready"} onClick={save} data-report-save>
            PDFを保存
          </button>
        </div>
        {busy ? (
          <p class="rp-status" role="status" data-report-busy>
            {status.step}
          </p>
        ) : null}
        {status.kind === "error" ? <p class="fatal" data-report-error>{reportErrorText(status.code)}</p> : null}
        {stale && !busy ? <p class="rp-note warn">設定を変えました。「作り直す」を押すと見本と保存する PDF が新しくなります。</p> : null}
        {built !== null && !busy ? (
          <p class="rp-note" data-report-ready>
            {built.timings.pages}ページ・{Math.round(built.timings.bytes / 1024)}KB（作成 {seconds(built.timings.totalMs)}：計算 {seconds(built.timings.computeMs)}・PDF {seconds(built.timings.renderMs)}）
          </p>
        ) : null}
        <fieldset class="rp-set">
          <legend>載せるプラン</legend>
          <label class="rp-row">
            <span>提案</span>
            <select value={proposal} onChange={(e) => setProposal((e.currentTarget as HTMLSelectElement).value)} data-report-proposal>
              {p.band.map((id) => (
                <option value={id} key={id}>
                  プラン{p.letterOf(id).letter} {p.letterOf(id).name}
                </option>
              ))}
            </select>
          </label>
          <p class="rp-note">現状は プランA（入力の値）です。目標の年齢は表示の設定の {p.targetAge}歳です。</p>
          <p class="rp-note" data-report-bs-points>
            バランスシートの図の時点は、資産と負債のタブで並べている時点（{bsPointsText(p.bsColumns ?? null, p.bsPoints ?? DEFAULT_BS_POINTS)}）です。提案のプランの年で並べます。
          </p>
          <div class="rp-checks" role="group" aria-label="比較のページに載せるプラン">
            <span class="rp-sub">比較のページに載せるプラン（基準: プラン{p.letterOf(p.base).letter}）</span>
            {slots.map((id) => (
              <label key={id} class="rp-check">
                <input type="checkbox" checked={compare.includes(id) || id === proposal} disabled={id === proposal} onChange={(e) => setCompare((c) => ((e.currentTarget as HTMLInputElement).checked ? [...c, id] : c.filter((x) => x !== id)))} data-report-compare={p.letterOf(id).letter} />
                プラン{p.letterOf(id).letter} {id === CURRENT ? "現状" : p.letterOf(id).name}
              </label>
            ))}
          </div>
          {drafted ? <p class="rp-note warn">保存していない変更を含むプランがあります。今の中身（結果と同じ）で作ります。</p> : null}
          {estimates.length > 0 ? (
            <p class="rp-note" data-report-estimates>
              推定・仮の値のままの欄があります（FP向けの表示）: {estimates.map((e) => `${e.label} ${e.count}か所`).join("・")}。提案書には「一部は統計の平均で補っています」とだけ載せ、どの欄かは書きません。
            </p>
          ) : null}
        </fieldset>
        <fieldset class="rp-set">
          <legend>章</legend>
          <div class="rp-checks cols" role="group" aria-label="載せる章">
            {shownChapters.map((c) => (
              <label key={c.id} class={`rp-check${material(c.id) ? "" : " none"}`}>
                <input
                  type="checkbox"
                  checked={c.fixed || chapters.has(c.id)}
                  disabled={c.fixed}
                  onChange={(e) =>
                    setChapters((s) => {
                      const n = new Set(s);
                      if ((e.currentTarget as HTMLInputElement).checked) n.add(c.id);
                      else n.delete(c.id);
                      return n;
                    })
                  }
                  data-report-chapter={c.id}
                />
                {c.label}
                {c.fixed ? <small>（外せません）</small> : material(c.id) ? null : <small>（材料が無いので省きます）</small>}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset class="rp-set">
          <legend>紙の向きとキャッシュフロー表</legend>
          <div class="rp-checks" role="radiogroup" aria-label="紙の向き">
            <span class="rp-sub">紙の向き（1冊の中）</span>
            {ORIENTATIONS.map((o) => (
              <label key={o.id} class="rp-check">
                <input type="radio" name="rp-orientation" checked={orientation === o.id} onChange={() => setOrientation(o.id)} data-report-orientation={o.id} />
                {o.label}
                <small>（{o.note}）</small>
              </label>
            ))}
          </div>
          <div class="rp-checks" role="radiogroup" aria-label="キャッシュフロー表の載せ方">
            <span class="rp-sub">キャッシュフロー表の載せ方</span>
            {CASHFLOWS.map((c) => (
              <label key={c.id} class="rp-check">
                <input type="radio" name="rp-cashflow" checked={cashflow === c.id} onChange={() => setCashflow(c.id)} data-report-cashflow={c.id} />
                {c.label}
                <small>（{c.note}）</small>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset class="rp-set">
          <legend>宛名と担当</legend>
          <label class="rp-row">
            <span>宛名</span>
            <input type="text" value={addressee} maxLength={40} autocomplete="off" placeholder="例: 見本 太郎" onInput={(e) => setAddressee((e.currentTarget as HTMLInputElement).value)} data-report-addressee />
            <span class="rp-unit">様</span>
          </label>
          <p class="rp-note">宛名は PDF に重ねるだけで、保存しません（画面を閉じると消えます）。</p>
          <label class="rp-row">
            <span>担当</span>
            <input type="text" value={preparedBy} maxLength={40} autocomplete="off" placeholder="事務所名・担当FP（任意）" onInput={(e) => setPreparedBy((e.currentTarget as HTMLInputElement).value)} />
          </label>
        </fieldset>
        {warn ? (
          <div class="rp-warn" role="alertdialog" aria-label="保存の前の注意" data-export-warn>
            <p>この PDF は暗号化されません。顧客の個人情報（宛名・家族・金額）を含みます。送り方と保管は FP の責任です。</p>
            <p class="rp-note">保存先は書類のフォルダの「ファイナンシア書き出し」が既定です。クラウドと同期するフォルダの中を選ぶとお知らせします。</p>
            <div class="rp-actions">
              <button type="button" class="btn primary" onClick={() => void doSave()} data-export-ok>
                わかりました。保存する
              </button>
              <button type="button" class="btn" onClick={() => setWarn(false)}>
                キャンセル
              </button>
            </div>
          </div>
        ) : null}
        {saved !== null ? (
          <p class={`rp-note${saved.syncFolder ? " warn" : ""}`} role="status" data-report-saved={saved.saved ? "1" : "0"}>
            {saved.saved ? `「${saved.fileName ?? ""}」を保存しました。${saved.syncFolder ? "同期フォルダの中です。共有の範囲に気をつけてください。" : ""}${p.onSnapshot !== undefined ? "この時点の控えを残しました（入力の「控えの一覧」）。" : ""}` : "保存しませんでした。"}
          </p>
        ) : null}
        {saveErr !== null ? <p class="fatal">保存できませんでした（{saveErr === "E_EXPORT_FORBIDDEN_DIR" ? "データフォルダ・カスタム層の中には保存できません" : saveErr}）</p> : null}
      </section>
      <section class="card rp-view" aria-label="PDF の見本">
        {info === null || built === null ? (
          <div class="rp-blank">
            <p>{busy ? status.step : "「見本を作る」を押すと、ここに PDF の見本が出ます。"}</p>
          </div>
        ) : (
          <ReportViewer host={p.host} info={info} version={version} stale={stale} firstSvg={built.firstSvg} />
        )}
      </section>
    </div>
  );
}
