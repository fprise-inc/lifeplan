// 入力のホームの 面談の準備（0074）: 世帯の中身の一覧・次の1年に起きること・前回から変わったこと（控え → 過ぎた予定の確かめ → ヒアリングシートの見直し →
// 前回との違い。前の名前は「見直し」。0074 の追記）。どれも読むだけで、押すとそのカードを開く。前回から変わったことの「控えを取る」だけが控えを作る
import { useEffect, useMemo, useState } from "preact/hooks";
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { formatYearMonth } from "../input/units.ts";
import { addMonths } from "../levers.ts";
import { man } from "../../presentation/format.ts";
import { snapshotDateText, TRIGGER_TEXT, type Snapshot } from "../snapshots/snapshots.ts";
import { withoutRemovedAssumptions } from "../surplus.ts";
import { householdContents, inputChanges, nextYearEvents, pastPlans, resultFigures, type ResultFigures } from "./fpTools.ts";
import { consultNotes, gateNotes } from "../hearing/web.ts";
import { latestMeeting, meetingDateText, type Meeting } from "../meetings/meetings.ts";

export interface FpToolsProps {
  wh: WorkingHousehold;
  /** 現状の計算結果（次の1年・前回との違いの結果の数） */
  result: PreviewResult | null;
  computeOne?: ((req: EngineRequest) => Promise<PreviewResult | null>) | undefined;
  /** カードを開く */
  onOpen: (card: string) => void;
  /** 控えを取る（前回から変わったことの1つ目） */
  onSnapshot?: ((memo: string) => Promise<void>) | undefined;
  /** 資産と負債のタブの「前回と比較」へ */
  onBalance?: (() => void) | undefined;
  /** 「○歳時点」の年齢（結果のタブの表示の設定） */
  atAge?: number;
  /** 開いている道具（親が持つとき。FP のメニューから開く） */
  tool?: FpTool | null;
  onTool?: (t: FpTool | null) => void;
  /** 道具の名前の並びを描く。既定は描く（入力のホームでは描かず、上の帯の FP のメニューから開く） */
  bar?: boolean;
  /** 面談の履歴の記録を開く（前回から変わったことの「前回の面談の記録」。0182） */
  onMeeting?: ((id: string) => void) | undefined;
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

export function FpTools({ wh, result, computeOne, onOpen, onSnapshot, onBalance, atAge = 90, tool: outer, onTool, bar = true, onMeeting }: FpToolsProps) {
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
        前回から変わったこと
      </button>
      {timing !== null ? (
        <span class="pl-sub" data-review-timing>
          最後の控え {formatYearMonth(timing.last)}・次の面談の目安 {formatYearMonth(timing.next)}
        </span>
      ) : null}
    </div>
    ) : null}
      {tool === "contents" ? <Contents wh={wh} onOpen={onOpen} onClose={() => setTool(null)} /> : null}
      {tool === "year" ? <NextYear wh={wh} result={result} onOpen={onOpen} onClose={() => setTool(null)} /> : null}
      {tool === "review" ? <Review wh={wh} result={result} computeOne={computeOne} onOpen={onOpen} onSnapshot={onSnapshot} onBalance={onBalance} atAge={atAge} onMeeting={onMeeting} onClose={() => setTool(null)} /> : null}
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

/**
 * 控えの時点と今の見込み・入力の違い（前回から変わったことの「前回との違い」と、面談の履歴の1件を開いたときに使う。0074・0182）。
 * 控えの要求を今の計算エンジンで計算し直して並べる（読むだけ）
 */
export function SnapshotCompare({ wh, snap, result, computeOne, onOpen, onBalance, atAge }: { wh: WorkingHousehold; snap: Snapshot; result: PreviewResult | null; computeOne?: ((req: EngineRequest) => Promise<PreviewResult | null>) | undefined; onOpen: (card: string) => void; onBalance?: (() => void) | undefined; atAge: number }) {
  const changes = useMemo(() => inputChanges(snap.inputs.request, wh), [snap, wh]);
  const [prevRes, setPrevRes] = useState<{ id: string; r: PreviewResult | null } | null>(null);
  useEffect(() => {
    if (computeOne === undefined) return;
    let alive = true;
    void computeOne(withoutRemovedAssumptions(snap.inputs.request)).then(
      (r) => alive && setPrevRes({ id: snap.id, r }),
      () => alive && setPrevRes({ id: snap.id, r: null }),
    );
    return () => {
      alive = false;
    };
  }, [snap, computeOne]);
  const before = prevRes?.id === snap.id && prevRes.r !== null ? resultFigures(withoutRemovedAssumptions(snap.inputs.request), prevRes.r, atAge) : null;
  const now = result !== null ? resultFigures(wh.request, result, atAge) : null;
  return (
    <>
      <table class="fp-figs" data-fp-review-figures>
        <tbody>
          <tr>
            <th>控えの時点の見込み</th>
            <td>{prevRes?.id === snap.id && prevRes.r === null ? "今の計算エンジンでは計算できませんでした" : figuresText(before)}</td>
          </tr>
          <tr>
            <th>今の見込み</th>
            <td>{figuresText(now)}</td>
          </tr>
        </tbody>
      </table>
      {onBalance !== undefined ? (
        <button type="button" class="link-btn" onClick={onBalance}>
          見込んでいた今の純資産と今の実際を比較する（資産と負債のタブ）
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
  );
}

/** 前回から変わったことから開く面談の記録: 比較する控えをつないだ記録があればそれ、無ければいちばん新しい記録（0182） */
export function meetingForReview(list: readonly Meeting[], snapId: string | null): Meeting | null {
  const linked = snapId === null ? undefined : [...list].reverse().find((m) => m.snapshot === snapId);
  return linked ?? latestMeeting(list);
}

function Review({ wh, result, computeOne, onOpen, onSnapshot, onBalance, atAge, onMeeting, onClose }: { wh: WorkingHousehold; result: PreviewResult | null; computeOne?: ((req: EngineRequest) => Promise<PreviewResult | null>) | undefined; onOpen: (card: string) => void; onSnapshot?: ((memo: string) => Promise<void>) | undefined; onBalance?: (() => void) | undefined; atAge: number; onMeeting?: ((id: string) => void) | undefined; onClose: () => void }) {
  const snaps = useMemo(() => newest(wh.snapshots ?? []), [wh.snapshots]);
  const [sel, setSel] = useState<string>(snaps[0]?.id ?? "");
  const [taken, setTaken] = useState(false);
  // 選んでいない（控えを今作った）ときは、いちばん新しい控え
  const snap = snaps.find((s) => s.id === sel) ?? snaps[0] ?? null;
  const past = useMemo(() => pastPlans(wh), [wh]);
  const meeting = meetingForReview(wh.meetings ?? [], snap?.id ?? null);
  return (
    <section class="card fp-panel" aria-label="前回から変わったこと" data-fp-review>
      <Head title="前回から変わったこと" note="控えを取り、過ぎた予定・ヒアリングシート・前回の控えとの違いを確かめて、見直しの面談に進みます" onClose={onClose} />
      <ol class="fp-steps">
        <li>
          <b>控えを取る</b>（比較する前の今の入力と結果を残します）
          {onSnapshot !== undefined ? (
            <button
              type="button"
              class="link-btn"
              disabled={taken}
              onClick={() =>
                void onSnapshot("見直しの面談の前").then(() => {
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
          <b>ヒアリングシートの見直し</b>（「ヒアリング・取り込む」で「見直し」の Excel を書き出すか URL で聞き、届いた答えを取り込みます。確かめの一覧で「次回確かめる」の印を付けた所は、印の行を写して面談に使えます）
          <GateNotes wh={wh} />
        </li>
        <li data-fp-review-diff>
          <b>前回との違い</b>
          {meeting !== null && onMeeting !== undefined ? (
            <p class="fp-meeting-link">
              <button type="button" class="link-btn" onClick={() => onMeeting(meeting.id)} data-fp-review-meeting={meeting.id}>
                {snap !== null && meeting.snapshot === snap.id ? "この控えの面談の記録を開く" : "前回の面談の記録を開く"}（{meetingDateText(meeting.on)}）
              </button>
            </p>
          ) : null}
          {snaps.length === 0 || snap === null ? (
            <p class="in-note">控えがまだありません。面談の区切りで「この時点を残す」を押すと、次の面談で比較できます。</p>
          ) : (
            <>
              <label class="fp-sel">
                比較する控え
                <select value={snap.id} onChange={(e) => setSel((e.currentTarget as HTMLSelectElement).value)} data-fp-review-select>
                  {snaps.map((s) => (
                    <option key={s.id} value={s.id}>
                      {snapshotDateText(s.createdAt)}（{TRIGGER_TEXT[s.trigger]}
                      {s.memo !== "" ? `・${s.memo}` : ""}）
                    </option>
                  ))}
                </select>
              </label>
              <SnapshotCompare wh={wh} snap={snap} result={result} computeOne={computeOne} onOpen={onOpen} onBalance={onBalance} atAge={atAge} />
            </>
          )}
        </li>
      </ol>
    </section>
  );
}

/** Web のヒアリングで届いた分岐の答え（お子さまの人数など）と、今の世帯との違い（0158。面談で確かめる。読むだけ） */
function GateNotes({ wh }: { wh: WorkingHousehold }) {
  const g = useMemo(() => gateNotes(wh), [wh]);
  const c = useMemo(() => consultNotes(wh), [wh]);
  // ご相談したいこと（選んだ話題と書いた文。0192）は、分岐の答えが無くても出す
  const consult =
    c === null ? null : (
      <div class="fp-gates" data-fp-consult>
        <p class="fp-sub">
          Web のヒアリングで届いたご相談したいこと（{c.requestId}・{new Date(c.receivedAt).toLocaleDateString("ja-JP")} に受け取り）
        </p>
        <ul class="fp-list">
          {c.topics.length > 0 ? (
            <li data-fp-consult-topics>
              <span class="fp-when">選んだ話題</span>
              <span>{c.topics.join("、")}</span>
            </li>
          ) : null}
          {c.text !== null ? (
            <li data-fp-consult-text>
              <span class="fp-when">書いたこと</span>
              <span>{c.text}</span>
            </li>
          ) : null}
        </ul>
      </div>
    );
  if (g === null) return consult;
  const diff = g.lines.filter((l) => l.now !== null).length;
  return (
    <>
      {consult}
      <div class="fp-gates" data-fp-gates>
        <p class="fp-sub">
          Web のヒアリングで届いた人数など（{g.requestId}・{new Date(g.receivedAt).toLocaleDateString("ja-JP")} に受け取り）{diff > 0 ? `。今の世帯と違うもの ${diff}件は面談で確かめてください` : ""}
        </p>
        <ul class="fp-list">
          {g.lines.map((l) => (
            <li key={l.label} data-fp-gate>
              <span class="fp-when">{l.label}</span>
              <span>{l.text}とのお答え</span>
              {l.now !== null ? (
                <span class="fp-v">
                  今の世帯は <b>{l.now}</b>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
