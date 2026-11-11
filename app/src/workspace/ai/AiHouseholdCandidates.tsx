// AIからの新しい世帯の候補（接続口の道具 propose_household）: 中身を確かめてから「世帯として作る」か「捨てる」。
// - 候補が届いても、世帯の一覧は変わらない。作るまで、世帯はどこにも保存されない（本体のメモリの中だけ。アプリを閉じると消える）
// - 出すのは家族・収入・資産・住まいとローン・生活費と、AI が推定したこと。架空かお客さまかは、作る前に FP が選び直せる
// - AI が書いた題・推定したことは、信用しない文章として文字のまま出す（番号らしい所は読み口で消してある）
// - 作る前に、番号らしい所を消した後の入力を画面と同じ計算で確かめる（計算できなければ作れない）
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { AiHouseholdCandidate } from "../../engine/host.ts";
import { PopIcon } from "../../presentation/icons.tsx";
import { householdOverview, KIND_TEXT, readHouseholdCandidate, type HouseholdKind, type OverviewRow, type ReadHousehold } from "./households.ts";
import { dateTimeText } from "./model.ts";

/** 届いている候補の帯（件数と、確かめる画面を開くボタンだけ。中身は出さない） */
export function AiHouseholdCandidateBand({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count <= 0) return null;
  return (
    <div class="ai-code-band" role="status" data-ai-household-band>
      <b>AIから新しい世帯の候補が届いています（{count}件）</b>
      <span class="pl-sub">確かめて「世帯として作る」を押すまで、世帯の一覧は変わりません</span>
      <button type="button" class="link-btn" onClick={onOpen} data-ai-household-band-open>
        候補を確かめる
        <PopIcon />
      </button>
    </div>
  );
}

export interface AiHouseholdCandidatesProps {
  candidates: readonly AiHouseholdCandidate[];
  /** 番号らしい所を消した後の入力が、画面と同じ計算で計算できるか（できれば null、できなければ理由）。渡さなければ確かめない */
  check?: (c: ReadHousehold) => Promise<string | null>;
  /** 世帯として作る（失敗の文を返す。作るのをやめたら null） */
  onCreate: (c: ReadHousehold, kind: HouseholdKind) => Promise<string | null>;
  onDiscard: (candidateId: string) => Promise<string | null>;
  onClose: () => void;
}

export function AiHouseholdCandidates(p: AiHouseholdCandidatesProps) {
  const read = useMemo(() => p.candidates.map((c) => ({ id: c.candidateId, ...readHouseholdCandidate(c) })), [p.candidates]);
  const [sel, setSel] = useState<string | null>(read[0]?.id ?? null);
  const current = read.find((r) => r.id === sel) ?? read[0];
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => panel.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [p.onClose]);
  return (
    <>
      <div class="scrim" aria-hidden="true" onClick={p.onClose} />
      <div ref={panel} class="rk-panel ai-panel ai-hh-panel" role="dialog" aria-modal="true" aria-labelledby="ai-hh-title" tabIndex={-1} data-ai-household-panel>
        <h2 id="ai-hh-title">AIからの新しい世帯の候補</h2>
        <p class="in-note">AI が組み立てた世帯です。中身を確かめて「世帯として作る」を押したときだけ、世帯の一覧に入ります。捨てても、ほかの世帯は変わりません。作らなかった候補は、アプリを閉じると消えます。</p>
        {read.length > 1 ? (
          <nav class="ai-tabs" aria-label="届いた候補">
            {read.map((r, i) => (
              <button type="button" key={r.id} class={r.id === current?.id ? "on" : ""} onClick={() => setSel(r.id)} data-ai-household-pick={i}>
                候補{i + 1}
              </button>
            ))}
          </nav>
        ) : null}
        {current === undefined ? (
          <p class="in-note">届いている候補はありません。</p>
        ) : current.candidate === null ? (
          <CandidateUnreadable issues={current.issues} onDiscard={() => p.onDiscard(current.id)} />
        ) : (
          <CandidateReview key={current.id} c={current.candidate} check={p.check} onCreate={p.onCreate} onDiscard={() => p.onDiscard(current.id)} />
        )}
        <div class="rk-foot">
          <button type="button" class="btn" onClick={p.onClose} data-ai-household-close>
            閉じる
          </button>
        </div>
      </div>
    </>
  );
}

function CandidateUnreadable({ issues, onDiscard }: { issues: string[]; onDiscard: () => Promise<string | null> }) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div class="ai-cand" data-ai-household-unreadable>
      <p class="hh-err">この候補は読めませんでした（{issues.join("・")}）。捨ててください。</p>
      <button type="button" class="btn" onClick={() => void onDiscard().then(setMsg)} data-ai-household-discard>
        捨てる
      </button>
      {msg !== null ? <p class="hh-err">{msg}</p> : null}
    </div>
  );
}

function Rows({ title, rows, empty }: { title: string; rows: OverviewRow[]; empty: string }) {
  return (
    <div class="ai-hh-sec" data-ai-household-section={title}>
      <h4>{title}</h4>
      {rows.length === 0 ? (
        <p class="pl-sub">{empty}</p>
      ) : (
        <dl>
          {rows.map((r, i) => (
            <div key={`${r.label}-${i}`}>
              <dt>{r.label}</dt>
              <dd>
                {r.value}
                {r.estimated === true ? (
                  <span class="pl-tag ai-hh-est" data-ai-household-estimated>
                    推定
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function CandidateReview({ c, check, onCreate, onDiscard }: { c: ReadHousehold; check: AiHouseholdCandidatesProps["check"]; onCreate: AiHouseholdCandidatesProps["onCreate"]; onDiscard: () => Promise<string | null> }) {
  const [kind, setKind] = useState<HouseholdKind>(c.kind);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [checked, setChecked] = useState<{ state: "checking" } | { state: "ok" } | { state: "error"; reason: string }>(check === undefined ? { state: "ok" } : { state: "checking" });
  const ov = useMemo(() => householdOverview(c.input), [c.input]);
  useEffect(() => {
    if (check === undefined) return;
    let live = true;
    void check(c).then(
      (reason) => live && setChecked(reason === null ? { state: "ok" } : { state: "error", reason }),
      () => live && setChecked({ state: "error", reason: "計算で確かめられませんでした" }),
    );
    return () => {
      live = false;
    };
  }, [c, check]);
  const act = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg(await fn());
    } finally {
      setBusy(false);
    }
  };
  return (
    <article class="ai-cand ai-hh" data-ai-household={c.candidateId} data-ai-household-kind={kind}>
      <div class="ai-cand-h">
        <span class="ai-tag">AIが書いた題</span>
        <b class="ai-untrusted" data-ai-household-title>
          {c.title}
        </b>
        <span class="pl-sub">
          {dateTimeText(c.receivedAt)} に届きました{c.connector !== null ? `・AI のアプリの名乗り: ${c.connector}（自己申告）` : ""}・{ov.basis}
        </span>
      </div>
      <fieldset class="ai-scope ai-hh-kind">
        <legend>どちらの世帯として作るか</legend>
        {(["fictional", "client"] as const).map((k) => (
          <label key={k}>
            <input type="radio" name={`ai-hh-kind-${c.candidateId}`} checked={kind === k} onChange={() => setKind(k)} data-ai-household-kind-pick={k} />
            <b>{KIND_TEXT[k].label}</b>: {KIND_TEXT[k].long}
            {c.kind === k ? <span class="pl-sub">（AI の選んだ種類）</span> : null}
            <span class="pl-sub ai-hh-kind-note">{KIND_TEXT[k].share}</span>
          </label>
        ))}
        {kind === "fictional" ? <p class="in-note">実在のお客さまの情報（年齢・年収・資産などの数字）を入れていないことを確かめてから作ってください。作った後に「お客さまの世帯にする」はできますが、お客さまの世帯を架空の世帯には戻せません。</p> : null}
      </fieldset>
      <div class="ai-hh-grid">
        <Rows title="家族" rows={ov.family} empty="家族がいません" />
        <Rows title="収入" rows={ov.income} empty="働き方の期間がありません（収入なし）" />
        <Rows title="資産" rows={ov.assets} empty="金融資産がありません" />
        <Rows title="住まい" rows={ov.housing} empty="住まいの入力がありません" />
        <Rows title="ローン" rows={ov.loans} empty="ローンはありません" />
        <Rows title="生活費" rows={ov.living} empty="生活費の入力がありません" />
      </div>
      <div class="ai-hh-sec" data-ai-household-note>
        <h4>AIが推定したこと</h4>
        {c.note !== null ? <p class="ai-untrusted ai-summary">{c.note}</p> : <p class="pl-sub">書かれていません。</p>}
        {ov.estimatedCount > 0 ? <p class="pl-sub">入力のうち {ov.estimatedCount} か所が「推定」の値です（作った後、入力の画面で推定の印が付きます）。</p> : null}
      </div>
      {c.masked + c.dropped > 0 ? (
        <p class="hh-warn" data-ai-household-masked>
          番号らしい所を {c.masked + c.dropped} か所、読まずに消しました（個人番号・口座番号などは世帯に入れません）。
        </p>
      ) : null}
      <p class={checked.state === "error" ? "hh-err" : "pl-sub"} role="status" data-ai-household-check={checked.state}>
        {checked.state === "checking" ? "計算できるかを確かめています…" : checked.state === "ok" ? "この中身で計算できることを確かめました。" : `この中身では計算できないため、作れません（${checked.reason}）。AI に直してもらってください。`}
      </p>
      <div class="ai-cand-foot">
        <button type="button" class="btn primary" disabled={busy || checked.state !== "ok"} onClick={() => void act(() => onCreate(c, kind))} data-ai-household-create>
          世帯として作る
        </button>
        <button type="button" class="btn" disabled={busy} onClick={() => void act(onDiscard)} data-ai-household-discard>
          捨てる
        </button>
        <span class="pl-sub">作ると、{KIND_TEXT[kind].label === "架空" ? "「架空」の印の付いた" : "お客さまの"}世帯として世帯の一覧に入り、その世帯を開きます。値の出どころは「AI」として残ります。</span>
      </div>
      {msg !== null ? (
        <p class="hh-err" role="alert">
          {msg}
        </p>
      ) : null}
    </article>
  );
}
