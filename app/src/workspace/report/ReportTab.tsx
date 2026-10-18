// 上のタブ「提案書」（作業の層）: 載せる案と章を選び、宛名を入れ（保存しない）、PDF の見本を画面の中で見て、「PDFを保存」で書き出す。
// - 計算は本体の正の計算（host.compute）。画面側の先出しの結果は PDF に使わない（0005 の2）
// - PDF は本体が作り、本体の中に置く。画面は見本の画像（ページごとの PNG）だけを受け取る（CSP の object-src・frame-src が none）
// - 保存は本体の平文の書き出しの出口（OS の保存のダイアログ）。最初の保存の前に、平文の注意を出す（0020 の5）
import { useEffect, useMemo, useState } from "preact/hooks";
import { CHAPTERS, hasMaterial, type CashflowLayout, type ChapterId, type Orientation, type ProposalInput } from "../../../../report/src/index.ts";
import type { HostApi, RenderInfo, SaveOutcome } from "../../engine/host.ts";
import { isEngineError, type PreviewResult } from "../../engine/types.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { CURRENT } from "../plans/band.ts";
import type { Catalog } from "../plans/items.ts";
import type { Values } from "../plans/plans.ts";
import { DEFAULT_CHAPTERS, DEFAULT_LAYOUT, planReport, reportInput, today, type ReportChoice } from "./assemble.ts";
import { ReportViewer } from "./ReportViewer.tsx";

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

export function ReportTab(p: Props) {
  const slots = [CURRENT, ...p.band];
  const firstProposal = p.selected !== CURRENT ? p.selected : (p.band[0] ?? CURRENT);
  const [proposal, setProposal] = useState(firstProposal);
  const [compare, setCompare] = useState<string[]>(slots);
  const [chapters, setChapters] = useState<Set<ChapterId>>(new Set(DEFAULT_CHAPTERS));
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
    () => ({ proposal, compare: slots.filter((id) => compare.includes(id) || id === proposal), base: p.base, chapters: CHAPTERS.filter((c) => c.fixed || chapters.has(c.id)).map((c) => c.id), targetAge: p.targetAge, issuedOn: today(), preparedBy, layout: { orientation, cashflow } }),
    [proposal, compare.join(","), p.base, [...chapters].join(","), p.targetAge, preparedBy, slots.join(","), orientation, cashflow],
  );
  // 何を変えたら作り直しが要るか（宛名も PDF に入るので含める。帳票の入力そのものは保存しない）
  const key = JSON.stringify({ choice, addressee: addressee.trim(), wh: p.wh.request, values: slots.map((id) => p.valuesOf(id)) });
  const stale = built !== null && built.key !== key;
  const busy = status.kind === "busy";

  const build = async () => {
    if (proposal === CURRENT) return;
    setSaved(null);
    setSaveErr(null);
    const t0 = performance.now();
    try {
      setStatus({ kind: "busy", step: "計算しています…" });
      const plan = planReport({ wh: p.wh, catalog: p.catalog, valuesOf: p.valuesOf, letterOf: p.letterOf }, choice);
      const names = Object.keys(plan.requests);
      const res = await p.host.compute(names.map((id) => ({ id, rev: 1, request: JSON.stringify(plan.requests[id]) })));
      const results: Record<string, PreviewResult> = {};
      for (const id of names) {
        const r = res.slots[id]?.result;
        if (r === undefined || isEngineError(r)) throw r !== undefined && isEngineError(r) ? r.error.code : "E_REPORT_COMPUTE";
        results[id] = r;
      }
      const t1 = performance.now();
      setStatus({ kind: "busy", step: "作成しています…" });
      const input = reportInput(plan.bundle(results));
      const t2 = performance.now();
      const ri = await p.host.report.render(JSON.stringify(input), addressee.trim() === "" ? null : addressee.trim());
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
    } catch (e) {
      setSaveErr(typeof e === "string" ? e : "E_EXPORT");
    }
  };
  const save = () => (warnedThisSession ? void doSave() : setWarn(true));

  const material = (id: ChapterId) => (built === null ? true : hasMaterial(built.input, id) || !chapters.has(id));
  const drafted = [proposal, ...compare].some((id) => p.modified.has(id));

  if (p.band.length === 0)
    return (
      <section class="card rp-empty">
        <h2>提案書</h2>
        <p>提案書に載せる案がありません。主画面で案を作り、帯に並べてから開いてください。</p>
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
        {status.kind === "error" ? <p class="fatal">作れませんでした（{status.code}）</p> : null}
        {stale && !busy ? <p class="rp-note warn">設定を変えました。「作り直す」を押すと見本と保存する PDF が新しくなります。</p> : null}
        {built !== null && !busy ? (
          <p class="rp-note" data-report-ready>
            {built.timings.pages}ページ・{Math.round(built.timings.bytes / 1024)}KB（作成 {seconds(built.timings.totalMs)}：計算 {seconds(built.timings.computeMs)}・PDF {seconds(built.timings.renderMs)}）
          </p>
        ) : null}
        <fieldset class="rp-set">
          <legend>載せる案</legend>
          <label class="rp-row">
            <span>提案</span>
            <select value={proposal} onChange={(e) => setProposal((e.currentTarget as HTMLSelectElement).value)} data-report-proposal>
              {p.band.map((id) => (
                <option value={id} key={id}>
                  {p.letterOf(id).letter}案 {p.letterOf(id).name}
                </option>
              ))}
            </select>
          </label>
          <p class="rp-note">現状は A案（入力の値）です。目標の年齢は表示の設定の {p.targetAge}歳です。</p>
          <div class="rp-checks" role="group" aria-label="比較のページに載せる案">
            <span class="rp-sub">比較のページに載せる案（基準: {p.letterOf(p.base).letter}案）</span>
            {slots.map((id) => (
              <label key={id} class="rp-check">
                <input type="checkbox" checked={compare.includes(id) || id === proposal} disabled={id === proposal} onChange={(e) => setCompare((c) => ((e.currentTarget as HTMLInputElement).checked ? [...c, id] : c.filter((x) => x !== id)))} data-report-compare={p.letterOf(id).letter} />
                {p.letterOf(id).letter}案 {id === CURRENT ? "現状" : p.letterOf(id).name}
              </label>
            ))}
          </div>
          {drafted ? <p class="rp-note warn">保存していない変更を含む案があります。今の中身（主画面と同じ）で作ります。</p> : null}
        </fieldset>
        <fieldset class="rp-set">
          <legend>章</legend>
          <div class="rp-checks cols" role="group" aria-label="載せる章">
            {CHAPTERS.map((c) => (
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
                やめる
              </button>
            </div>
          </div>
        ) : null}
        {saved !== null ? (
          <p class={`rp-note${saved.syncFolder ? " warn" : ""}`} role="status" data-report-saved={saved.saved ? "1" : "0"}>
            {saved.saved ? `「${saved.fileName ?? ""}」を保存しました。${saved.syncFolder ? "同期フォルダの中です。共有の範囲に気をつけてください。" : ""}` : "保存しませんでした。"}
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
