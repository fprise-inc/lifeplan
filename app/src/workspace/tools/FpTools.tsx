// 入力のホームの 面談の準備（0074）: 世帯の中身の一覧・次の1年に起きること・見直し（控え → 過ぎた予定の確かめ → ヒアリングシートの見直し →
// 前回との違い）。どれも読むだけで、押すとそのカードを開く。見直しの「控えを取る」だけが控えを作る
import { useEffect, useMemo, useState } from "preact/hooks";
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { formatYearMonth } from "../input/units.ts";
import { addMonths } from "../levers.ts";
import { man } from "../../presentation/format.ts";
import { snapshotDateText, TRIGGER_TEXT, type Snapshot } from "../snapshots/snapshots.ts";
import { withoutRemovedAssumptions } from "../surplus.ts";
import { householdContents, inputChanges, nextYearEvents, pastPlans, resultFigures, type ResultFigures } from "./fpTools.ts";

export interface FpToolsProps {
  wh: WorkingHousehold;
  /** 現状の計算結果（次の1年・前回との違いの結果の数） */
  result: PreviewResult | null;
  computeOne?: ((req: EngineRequest) => Promise<PreviewResult | null>) | undefined;
  /** カードを開く */
  onOpen: (card: string) => void;
  /** 控えを取る（見直しの前） */
  onSnapshot?: ((memo: string) => Promise<void>) | undefined;
  /** 資産と負債のタブの「前回と比べる」へ */
  onBalance?: (() => void) | undefined;
  /** 「○歳時点」の年齢（結果のタブの表示の設定） */
  atAge?: number;
  /** 開いている道具（親が持つとき。FP のメニューから開く） */
  tool?: FpTool | null;
  onTool?: (t: FpTool | null) => void;
  /** 道具の名前の並びを描く。既定は描く（入力のホームでは描かず、上の帯の FP のメニューから開く） */
  bar?: boolean;
}

export type FpTool = "contents" | "year" | "review";
type Tool = FpTool;

const newest = (list: readonly Snapshot[]) => [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

/** 最後の見直し（いちばん新しい控え）と次の目安（1年後） */
export function reviewTiming(list: readonly Snapshot[]): { last: string; next: string } | null {
  const s = newest(list)[0];
  if (s === undefined) return null;
  const ym = s.createdAt.slice(0, 7);
  return { last: ym, next: addMonths(ym, 12) };
}

export function FpTools({ wh, result, computeOne, onOpen, onSnapshot, onBalance, atAge = 90, tool: outer, onTool, bar = true }: FpToolsProps) {
  const [inner, setInner] = useState<Tool | null>(null);
  const tool = outer !== undefined ? outer : inner;
  const setTool = (t: Tool | null) => (onTool !== undefined ? onTool(t) : setInner(t));
  const snaps = wh.snapshots ?? [];
  const timing = reviewTiming(snaps);
  // 道具の名前の並びと、開いた中身は隣どうしに置く（入力のホームでは、中身を道具の行の下に幅いっぱいで出す。0077）
  return (
    <>
    {bar ? (
    <div class="hs-tools fp-tools" role="group" aria-label="面談の準備" data-fp-tools>
      <span class="hs-tools-h">面談の準備</span>
      <button type="button" class="link-btn" aria-expanded={tool === "contents"} onClick={() => setTool(tool === "contents" ? null : "contents")} data-fp-tool="contents">
        世帯の中身の一覧
      </button>
      <button type="button" class="link-btn" aria-expanded={tool === "year"} onClick={() => setTool(tool === "year" ? null : "year")} data-fp-tool="year">
        次の1年に起きること
      </button>
      <button type="button" class="link-btn" aria-expanded={tool === "review"} onClick={() => setTool(tool === "review" ? null : "review")} data-fp-tool="review">
        見直し
      </button>
      {timing !== null ? (
        <span class="pl-sub" data-review-timing>
          最後の控え {formatYearMonth(timing.last)}・次の見直しの目安 {formatYearMonth(timing.next)}
        </span>
      ) : null}
    </div>
    ) : null}
      {tool === "contents" ? <Contents wh={wh} onOpen={onOpen} onClose={() => setTool(null)} /> : null}
      {tool === "year" ? <NextYear wh={wh} result={result} onOpen={onOpen} onClose={() => setTool(null)} /> : null}
      {tool === "review" ? <Review wh={wh} result={result} computeOne={computeOne} onOpen={onOpen} onSnapshot={onSnapshot} onBalance={onBalance} atAge={atAge} onClose={() => setTool(null)} /> : null}
    </>
  );
}

function Head({ title, note, onClose }: { title: string; note: string; onClose: () => void }) {
  return (
    <div class="card-h">
      <h2>{title}</h2>
      <span class="aside">{note}</span>
      <button type="button" class="btn" onClick={onClose}>
        閉じる
      </button>
    </div>
  );
}

function Contents({ wh, onOpen, onClose }: { wh: WorkingHousehold; onOpen: (card: string) => void; onClose: () => void }) {
  const sections = useMemo(() => householdContents(wh), [wh]);
  return (
    <section class="card fp-panel" aria-label="世帯の中身の一覧" data-fp-contents>
      <Head title="世帯の中身の一覧" note="人・収入・退職給付・口座と不動産・保険・ローン・出るお金・介護・相続と贈与を1画面に（読むだけ）。押すとその入力項目を開きます" onClose={onClose} />
      <div class="fp-contents">
        {sections.map((s) => (
          <div key={s.card} class="fp-sec" data-fp-section={s.card}>
            <h3>
              <button type="button" class="link-btn" onClick={() => onOpen(s.card)}>
                {s.cardLabel}
              </button>
              <small>（{s.rows.length}）</small>
            </h3>
            <ul>
              {s.rows.map((r) => (
                <li key={r.id}>
                  {r.label}
                  {r.text !== null ? <span class="fp-v">{r.text}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function NextYear({ wh, result, onOpen, onClose }: { wh: WorkingHousehold; result: PreviewResult | null; onOpen: (card: string) => void; onClose: () => void }) {
  const list = useMemo(() => nextYearEvents(wh, result), [wh, result]);
  const base = wh.request.input.baseMonth;
  return (
    <section class="card fp-panel" aria-label="次の1年に起きること" data-fp-year>
      <Head title="次の1年に起きること" note={`${formatYearMonth(base)}から${formatYearMonth(addMonths(base, 11))}まで。入れた物と計算の結果から（入力は増えません）`} onClose={onClose} />
      {list.length === 0 ? <p class="in-note">この1年に起きる予定は見つかりませんでした。</p> : null}
      <ul class="fp-list">
        {list.map((e, i) => (
          <li key={i} data-fp-event>
            <span class="fp-when">{e.ym !== null ? formatYearMonth(e.ym) : `${e.year}年`}</span>
            <span>{e.label}</span>
            {e.card !== null ? (
              <button type="button" class="link-btn" onClick={() => onOpen(e.card as string)}>
                開く
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function figuresText(f: ResultFigures | null): string {
  if (f === null) return "—";
  const d = f.depletion === null ? "資産は尽きない" : `${f.depletion}年に資産が尽きる`;
  return f.atAge === null ? d : `${d}・${f.atAge.age}歳の金融資産 ${man(f.atAge.amount)}万円`;
}

function Review({ wh, result, computeOne, onOpen, onSnapshot, onBalance, atAge, onClose }: { wh: WorkingHousehold; result: PreviewResult | null; computeOne?: ((req: EngineRequest) => Promise<PreviewResult | null>) | undefined; onOpen: (card: string) => void; onSnapshot?: ((memo: string) => Promise<void>) | undefined; onBalance?: (() => void) | undefined; atAge: number; onClose: () => void }) {
  const snaps = useMemo(() => newest(wh.snapshots ?? []), [wh.snapshots]);
  const [sel, setSel] = useState<string>(snaps[0]?.id ?? "");
  const [taken, setTaken] = useState(false);
  // 選んでいない（控えを今作った）ときは、いちばん新しい控え
  const snap = snaps.find((s) => s.id === sel) ?? snaps[0] ?? null;
  const past = useMemo(() => pastPlans(wh), [wh]);
  const changes = useMemo(() => (snap === null ? [] : inputChanges(snap.inputs.request, wh)), [snap, wh]);
  const [prevRes, setPrevRes] = useState<{ id: string; r: PreviewResult | null } | null>(null);
  useEffect(() => {
    if (snap === null || computeOne === undefined) return;
    let alive = true;
    void computeOne(withoutRemovedAssumptions(snap.inputs.request)).then(
      (r) => alive && setPrevRes({ id: snap.id, r }),
      () => alive && setPrevRes({ id: snap.id, r: null }),
    );
    return () => {
      alive = false;
    };
  }, [snap, computeOne]);
  const before = snap !== null && prevRes?.id === snap.id && prevRes.r !== null ? resultFigures(withoutRemovedAssumptions(snap.inputs.request), prevRes.r, atAge) : null;
  const now = result !== null ? resultFigures(wh.request, result, atAge) : null;
  return (
    <section class="card fp-panel" aria-label="見直し" data-fp-review>
      <Head title="見直し" note="前回の面談から変わったことを確かめて、面談に進みます" onClose={onClose} />
      <ol class="fp-steps">
        <li>
          <b>控えを取る</b>（見直しの前の今の入力と結果を残します）
          {onSnapshot !== undefined ? (
            <button
              type="button"
              class="link-btn"
              disabled={taken}
              onClick={() =>
                void onSnapshot("見直しの前").then(() => {
                  setTaken(true);
                })
              }
              data-fp-review-snapshot
            >
              {taken ? "残しました" : "この時点を残す"}
            </button>
          ) : null}
        </li>
        <li data-fp-review-past>
          <b>過ぎた予定の確かめ</b>（計算の基準の月より前に過ぎた1回きりの予定。済んだら外し、受け取ったお金は口座の残高に入れます。まだなら時期を直します）
          {past.length === 0 ? (
            <p class="in-note">過ぎた予定はありません。</p>
          ) : (
            <ul class="fp-list">
              {past.map((p) => (
                <li key={p.id}>
                  <span class="fp-when">{p.when}</span>
                  <span>{p.label}</span>
                  {p.card !== null ? (
                    <button type="button" class="link-btn" onClick={() => onOpen(p.card as string)}>
                      開く
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </li>
        <li>
          <b>ヒアリングシートの見直し</b>（「取り込む」のヒアリングシートで「見直し（前回の値つき）」を書き出し、記入されたシートを取り込みます。確かめの一覧で「次回確かめる」の印を付けた所は、印の行を写して面談に使えます）
        </li>
        <li data-fp-review-diff>
          <b>前回との違い</b>
          {snaps.length === 0 ? (
            <p class="in-note">控えがまだありません。面談の区切りで「この時点を残す」を押すと、次の見直しで比べられます。</p>
          ) : (
            <>
              <label class="fp-sel">
                比べる控え
                <select value={snap?.id ?? ""} onChange={(e) => setSel((e.currentTarget as HTMLSelectElement).value)} data-fp-review-select>
                  {snaps.map((s) => (
                    <option key={s.id} value={s.id}>
                      {snapshotDateText(s.createdAt)}（{TRIGGER_TEXT[s.trigger]}
                      {s.memo !== "" ? `・${s.memo}` : ""}）
                    </option>
                  ))}
                </select>
              </label>
              <table class="fp-figs" data-fp-review-figures>
                <tbody>
                  <tr>
                    <th>控えの時点の見込み</th>
                    <td>{snap !== null && prevRes?.id === snap.id && prevRes.r === null ? "今の計算エンジンでは計算できませんでした" : figuresText(before)}</td>
                  </tr>
                  <tr>
                    <th>今の見込み</th>
                    <td>{figuresText(now)}</td>
                  </tr>
                </tbody>
              </table>
              {onBalance !== undefined ? (
                <button type="button" class="link-btn" onClick={onBalance}>
                  見込んでいた今の純資産と今の実際を比べる（資産と負債のタブ）
                </button>
              ) : null}
              <p class="fp-sub">入力の違い（{changes.length}件）</p>
              {changes.length === 0 ? <p class="in-note">控えの時点から入力は変わっていません。</p> : null}
              <ul class="fp-list fp-changes">
                {changes.map((c) => (
                  <li key={c.key} data-fp-change>
                    <span class="fp-when">{c.cardLabel}</span>
                    <span>{c.label}</span>
                    <span class="fp-v">
                      {c.before} → <b>{c.after}</b>
                    </span>
                    {c.card !== null ? (
                      <button type="button" class="link-btn" onClick={() => onOpen(c.card as string)}>
                        開く
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </li>
      </ol>
    </section>
  );
}
