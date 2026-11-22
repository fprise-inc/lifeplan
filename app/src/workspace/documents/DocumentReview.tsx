// 書類の読み取りの確かめの画面（0148 の2）と、入力のホームの「取り込む」の入口。
// - 1画面に1通。左に書類から読んだ所（元の場所と、その所の文字。伏せ字の後）、右に入る欄の行（共通の部品 ReviewTable）。行を押すと左のその所が光る
// - 1つずつ承認・直す・入れない。まとめて承認は確からしさが高く、今の値が空・推定・書類待ちか同じ値の行だけ（review/rows.ts の bulkEligible）
// - 新しい物（保険の契約）は、物ごとに「足す」か「今の○○に当てる」を選んでから、その中の値を承認する。同じ物がありそうなら
//   知らせる（黙ってまとめない。0154 の3）
// - 照合だけの値（特約の額など）は入力にせず、書類の額とアプリの計算を並べる
// - 世帯の値を変える操作は、読み取りの記録を先に入れてから、元に戻せる変更として現状に入れる（呼ぶ側の onChange）
// - 読めるのは保険証券・ご契約内容のお知らせ・設計書（0159）と、課税明細書・路線価図（0235。書類の土地は今ある不動産に入れるだけで、足さない）。取り込みを外した書類の前の記録は、見るだけで出す
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { CloseX, useEscClose } from "../../presentation/CloseX.tsx";
import type { WorkingHousehold } from "../input/household.ts";
import { formatYearMonth } from "../input/units.ts";
import { approvalTime } from "../hearing/sheet.ts";
import { roles } from "../roles.ts";
import { ReviewTable } from "../review/ReviewTable.tsx";
import { pendingCount, pendingTotal, removable, withoutReading, withReading } from "./log.ts";
import { readProposal } from "./proposal.ts";
import { acceptCandidates, acceptObject, correctCandidate, docReview, linkObject, rejectCandidates, rejectObject, reopenCandidate, withHolder, type CalcOf, type Chosen } from "./review.ts";
import { SAMPLE_DOCUMENTS } from "./samples.ts";
import { docTypeLabel, isRetired, readableDocsLine, type DocumentLog, type DocumentReading } from "./types.ts";

export interface DocChange {
  /** 現状の値を変えたときだけ（元に戻せる変更として入れる） */
  wh?: WorkingHousehold;
  log: DocumentLog | undefined;
}

const yen = (n: number): string => `${Math.abs(n).toLocaleString("ja-JP")}円`;

/** 架空の見本を世帯の記録に足す（見本の世帯だけ。同じ見本をもう読んでいれば足さない） */
export function withSamples(wh: WorkingHousehold, at: string = approvalTime(), newId: () => string = () => crypto.randomUUID()): { log: DocumentLog | undefined; added: number } {
  let log = wh.documents;
  let added = 0;
  const members = roles(wh.request).map((r) => ({ key: r.key, id: r.member.id }));
  for (const s of SAMPLE_DOCUMENTS) {
    const reader = { id: `sample.${s.id}`, version: 1 };
    if ((log?.readings ?? []).some((r) => r.via === "sample" && r.reader?.id === reader.id && pendingCount(r) > 0)) continue;
    const p = readProposal(s.raw, { via: "sample", at, newId, reader, members });
    if (p.reading === null) continue;
    log = withReading(log, p.reading);
    added++;
  }
  return { log, added };
}

/** AI接続口から届いて、まだ確かめていない書類（未決の候補のある記録。届いた順） */
export const aiPending = (wh: Pick<WorkingHousehold, "documents">): DocumentReading[] => (wh.documents?.readings ?? []).filter((r) => r.via === "ai" && pendingCount(r) > 0);

/** AI から書類の候補が届いた帯（0151）。確かめるまで出す（承認するまで現状は変わらない） */
export function AiDocumentBand({ wh, failed, onOpen, onDismiss }: { wh: WorkingHousehold; failed: { count: number; issues: readonly string[] }; onOpen: (id: string) => void; onDismiss: () => void }) {
  const list = aiPending(wh);
  if (list.length === 0 && failed.count === 0) return null;
  const first = list[0];
  return (
    <div class="ai-code-band" role="status" data-documents-ai-band>
      {list.length > 0 ? <b>AI から書類の候補が届きました（{list.length}通・未決 {list.reduce((n, r) => n + pendingCount(r), 0)}件）</b> : null}
      {failed.count > 0 ? (
        <b data-documents-ai-band-failed>
          AI から届いた書類の候補のうち {failed.count}通は、読める候補が無いため取り込みませんでした（{failed.issues.join("・")}）
        </b>
      ) : null}
      <span class="pl-sub">確かめて承認するまで、現状は変わりません</span>
      {first !== undefined ? (
        <button type="button" class="link-btn" onClick={() => onOpen(first.id)} data-documents-ai-band-open>
          確かめる
        </button>
      ) : null}
      {failed.count > 0 ? (
        <button type="button" class="link-btn" onClick={onDismiss} data-documents-ai-band-dismiss>
          わかりました
        </button>
      ) : null}
    </div>
  );
}

/**
 * 入力のホームの「取り込む」の中の入口「AI で書類を読み取る」（保険証券・ご契約内容のお知らせ・設計書〔0159〕と、課税明細書・路線価図〔0235〕）。
 * - ai があれば（保存した世帯だけ）、AI と接続する・この世帯を AI に渡すボタンを出す。保存していない世帯（アプリの見本の世帯を含む）は AI に渡せない
 * - 読んだ書類があれば確かめの画面を開くボタン、見本の世帯でだけ架空の見本のボタン（AI に渡さずに確かめの画面を試せる）
 * - AI の答えを貼り付ける入口は、利用者の判断（2026-11-20）でなくした（0151 の追記）。前に貼り付けで読んだ記録も、確かめの画面でそのまま読める
 */
export function DocumentEntry({ wh, sample, ai, onOpen, onSamples }: { wh: WorkingHousehold; sample: boolean; ai?: { connected: boolean; onOpen: () => void }; onOpen: () => void; onSamples: () => void }) {
  const readings = wh.documents?.readings ?? [];
  const pending = pendingTotal(wh);
  return (
    <div class="hs-tools" role="group" aria-label="AI で書類を読み取る" data-imports-ai>
      <span class="hs-tools-h">AI で書類を読み取る</span>
      <span class="in-note" data-imports-ai-kinds>
        {readableDocsLine()}
      </span>
      {ai !== undefined ? (
        <button type="button" class="btn small" onClick={ai.onOpen} data-imports-ai-open>
          {ai.connected ? "この世帯を AI に渡す" : "AI と接続する"}
        </button>
      ) : null}
      {readings.length > 0 ? (
        <button type="button" class="btn small" onClick={onOpen} data-documents-open>
          読んだ書類を確かめる{pending > 0 ? `（未決 ${pending}件）` : `（${readings.length}通）`}
        </button>
      ) : null}
      {sample ? (
        <button type="button" class="btn small" onClick={onSamples} data-documents-samples>
          架空の保険証券の見本で試す
        </button>
      ) : null}
      <span class="in-note">
        お使いの AI（Claude など）をファイナンシアと接続すると、AI が書類を読み、読んだ値（保険の契約の値、相続税の試算の土地・建物の値）が「候補」として届きます。確かめて承認したものだけが現状に入ります（書類を含む外部AIへの同意がある世帯と、架空の世帯だけ）。個人番号などの番号・土地の所在は読みません・残しません。面談の履歴とメモは AI に渡しません。ほかの書類は、書類を見て欄に打ってください（欄の「?」に書類のどこを見るかがあります）。
      </span>
      {ai === undefined ? (
        <span class="in-note" data-imports-ai-unsaved>
          {sample ? "見本の世帯は AI に渡せません。「架空の保険証券の見本で試す」で、AI が読んだ書類と同じ確かめの画面を試せます。" : "保存していない世帯は AI に渡せません。世帯を保存してから使ってください。"}
        </span>
      ) : null}
    </div>
  );
}

export interface DocumentReviewProps {
  wh: WorkingHousehold;
  calc: CalcOf | null;
  onChange: (c: DocChange) => void;
  onClose: () => void;
  initial?: string;
}

export function DocumentReview(p: DocumentReviewProps) {
  const readings = p.wh.documents?.readings ?? [];
  const [cur, setCur] = useState<string | null>(p.initial ?? readings.find((r) => pendingCount(r) > 0)?.id ?? readings[0]?.id ?? null);
  const [sel, setSel] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Chosen>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [discard, setDiscard] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => panel.current?.focus({ preventScroll: true }), []);
  useEscClose(p.onClose);
  const reading: DocumentReading | undefined = readings.find((r) => r.id === cur) ?? readings[0];
  const view = useMemo(() => (reading === undefined ? null : docReview(p.wh, reading, chosen, p.calc, readings)), [p.wh, reading, chosen, p.calc, readings]);

  const put = (r: DocumentReading, wh?: WorkingHousehold) => p.onChange({ ...(wh !== undefined ? { wh } : {}), log: withReading(p.wh.documents, r) });
  const report = (count: number, failed: readonly string[]) =>
    setMsg(failed.length > 0 ? { ok: false, text: `${count}件を入れました。入れられなかった候補: ${failed.join("・")}` } : { ok: true, text: `${count}件を現状に入れました（元に戻すで戻せます）` });

  if (reading === undefined || view === null)
    return (
      <>
        <div class="scrim" aria-hidden="true" onClick={p.onClose} />
        <div ref={panel} class="rk-panel dr-panel" role="dialog" aria-modal="true" aria-labelledby="dr-title" tabIndex={-1} data-documents-panel>
          <CloseX onClose={p.onClose} what="書類の読み取りの確かめ" />
          <h2 id="dr-title">書類の読み取りの確かめ</h2>
          <p class="in-note">読んだ書類はありません。</p>
          <div class="dr-foot">
            <button type="button" class="btn" onClick={p.onClose}>
              閉じる
            </button>
          </div>
        </div>
      </>
    );

  const rows = view.groups.flatMap((g) => g.rows);
  const accept = (ids: readonly string[]) => {
    const res = acceptCandidates(p.wh, reading, ids, chosen, approvalTime());
    if (res.count > 0) put(res.reading, res.wh);
    report(res.count, res.failed);
  };
  return (
    <>
      <div class="scrim" aria-hidden="true" onClick={p.onClose} />
      <div ref={panel} class="rk-panel dr-panel" role="dialog" aria-modal="true" aria-labelledby="dr-title" tabIndex={-1} data-documents-panel={reading.id}>
        <CloseX onClose={p.onClose} what="書類の読み取りの確かめ" />
        <h2 id="dr-title">書類の読み取りの確かめ</h2>
        {readings.length > 1 ? (
          <nav class="dr-list" aria-label="読んだ書類">
            {readings.map((r) => (
              <button
                type="button"
                key={r.id}
                class={r.id === reading.id ? "on" : ""}
                aria-current={r.id === reading.id ? "true" : undefined}
                onClick={() => {
                  setCur(r.id);
                  setSel(null);
                  setChosen({});
                  setMsg(null);
                  setDiscard(false);
                }}
                data-documents-reading={r.id}
              >
                {docTypeLabel(r.docType)}
                {r.asOf !== undefined ? `（${formatYearMonth(r.asOf)}）` : ""}
                {isRetired(r) ? <span class="dr-n done">見るだけ</span> : pendingCount(r) > 0 ? <span class="dr-n">未決 {pendingCount(r)}</span> : <span class="dr-n done">済</span>}
              </button>
            ))}
          </nav>
        ) : null}
        <div class="dr-head">
          <b class="dr-title" data-documents-title>
            {view.title}
          </b>
          <span class="in-note">
            {view.via}
            {view.asOf !== null ? `・書類の時点 ${formatYearMonth(view.asOf)}` : ""}
          </span>
          <label class="dr-holder">
            書類の名義
            <select
              value={view.holder ?? ""}
              onChange={(e) => {
                const v = (e.currentTarget as HTMLSelectElement).value;
                put(withHolder(p.wh, reading, v === "" ? null : v));
              }}
              data-documents-holder
            >
              <option value="">（決めていない）</option>
              {view.holderOptions.map((o) => (
                <option value={o.id} key={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {removable(reading) ? (
            discard ? (
              <span class="dr-discard" role="group" aria-label="この書類の候補を捨てる">
                未決の候補も消えます（元に戻せません）。
                <button
                  type="button"
                  class="btn small danger"
                  onClick={() => {
                    setDiscard(false);
                    setCur(null);
                    p.onChange({ log: withoutReading(p.wh.documents, reading.id) });
                  }}
                  data-documents-remove-confirm
                >
                  捨てる
                </button>
                <button type="button" class="link-btn" onClick={() => setDiscard(false)}>
                  やめる
                </button>
              </span>
            ) : (
              <button type="button" class="link-btn danger" onClick={() => setDiscard(true)} data-documents-remove>
                この書類の候補を捨てる
              </button>
            )
          ) : null}
        </div>
        {view.needsHolder ? <p class="hh-err">書類の名義（どなたの書類か）を選ぶと、承認できるようになります（名前は読まないので、続柄で選んでください）。</p> : null}
        {view.notices.length > 0 ? (
          <ul class="dr-notices" data-documents-notices>
            {view.notices.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
        {msg !== null ? (
          <p class={msg.ok ? "rk-ok" : "hh-err"} role="status" data-documents-msg>
            {msg.text}
          </p>
        ) : null}
        <div class="dr-body">
          <aside class="dr-source" aria-label="書類から読んだ所">
            <h3>書類から読んだ所</h3>
            <p class="in-note">伏せ字の後の文字です。元のファイルは保存していません。</p>
            <ol>
              {rows.map((r) => (
                <li key={r.id} class={sel === r.id ? "sel" : ""}>
                  <button type="button" onClick={() => setSel(r.id)} aria-pressed={sel === r.id} data-documents-source={r.id}>
                    <span class="dr-src-where">{r.source.where ?? "（場所の記載なし）"}</span>
                    {r.source.text !== null ? <span class="dr-src-text">{r.source.text}</span> : null}
                  </button>
                </li>
              ))}
            </ol>
          </aside>
          <div class="dr-main">
            {view.groups.map((g) => (
              <section class="dr-group" key={g.key} data-documents-group={g.key}>
                <h3>{g.label}</h3>
                {g.object !== null ? (
                  <div class={`dr-object s-${g.object.status}`} data-documents-object={g.object.key}>
                    {g.object.status === "pending" && view.retired ? (
                      <span>取り込みを外した書類の{g.object.noun}です（足せません）。入力の画面の「＋」で足して、書類を見て打ってください。</span>
                    ) : g.object.status === "pending" && g.object.linkOnly ? (
                      <>
                        <span>
                          この書類の土地・建物を、どの不動産の値として入れますか（確からしさ {g.object.confidence}）。選ぶと、下の値を承認できます。
                          {g.object.links.length === 0 ? " 持ち家か住まい以外の不動産を入力してから選んでください。" : ""}
                        </span>
                        {g.object.links.map((t) => (
                          <button
                            type="button"
                            key={t.id}
                            class="btn small"
                            title={`下の値を、「${t.label}」の相続税の試算の欄に入れます（値は1つずつ承認します）`}
                            onClick={() => {
                              const next = linkObject(p.wh, reading, g.object?.key ?? "", t.id, approvalTime());
                              if (next === null) setMsg({ ok: false, text: "選べませんでした" });
                              else {
                                put(next);
                                setMsg({ ok: true, text: `「${t.label}」の値として入れます。値を確かめて承認してください` });
                              }
                            }}
                            data-documents-object-link={`${g.object?.key ?? ""}:${t.id}`}
                          >
                            「{t.label}」に入れる
                          </button>
                        ))}
                        <button type="button" class="link-btn" onClick={() => put(rejectObject(reading, g.object?.key ?? "", approvalTime()))} data-documents-object-reject={g.object.key}>
                          入れない
                        </button>
                      </>
                    ) : g.object.status === "pending" ? (
                      <>
                        <span>
                          この書類の{g.object.noun === "保険契約" ? "契約" : g.object.noun}を、新しい物として足しますか（確からしさ {g.object.confidence}）。足すか今の{g.object.noun}に当てると、下の値を承認できます。
                        </span>
                        <button
                          type="button"
                          class="btn small primary"
                          onClick={() => {
                            const res = acceptObject(p.wh, reading, g.object?.key ?? "", approvalTime());
                            if (res === null) setMsg({ ok: false, text: `足せませんでした（この世帯では、入力の画面に「＋ ${g.object?.noun ?? ""}」のボタンがありません。名義の人の働き方などを確かめてください）` });
                            else {
                              put(res.reading, res.wh);
                              setMsg({ ok: true, text: "新しい物を足しました。値を確かめて承認してください" });
                            }
                          }}
                          data-documents-object-accept={g.object.key}
                        >
                          足す
                        </button>
                        {g.object.links.slice(0, 4).map((t) => (
                          <button
                            type="button"
                            key={t.id}
                            class="btn small"
                            title={`新しく足さずに、今の${g.object?.noun ?? ""}「${t.label}」の欄に、下の値を当てます（値は1つずつ承認します）`}
                            onClick={() => {
                              const next = linkObject(p.wh, reading, g.object?.key ?? "", t.id, approvalTime());
                              if (next === null) setMsg({ ok: false, text: "当てられませんでした" });
                              else {
                                put(next);
                                setMsg({ ok: true, text: `今の${g.object?.noun ?? ""}「${t.label}」に当てました。値を確かめて承認してください` });
                              }
                            }}
                            data-documents-object-link={`${g.object?.key ?? ""}:${t.id}`}
                          >
                            {t.label.includes(g.object?.noun ?? "") ? `今の「${t.label}」に当てる` : `今の${g.object?.noun ?? ""}「${t.label}」に当てる`}
                          </button>
                        ))}
                        <button type="button" class="link-btn" onClick={() => put(rejectObject(reading, g.object?.key ?? "", approvalTime()))} data-documents-object-reject={g.object.key}>
                          足さない
                        </button>
                      </>
                    ) : (
                      <span>
                        {g.object.linkOnly
                          ? g.object.status === "accepted"
                            ? `「${g.object.linkedTo ?? "今ある不動産"}」の値として入れます`
                            : "入れないことにしました"
                          : g.object.status === "accepted"
                            ? g.object.linkedTo !== null
                              ? `今の${g.object.noun}「${g.object.linkedTo}」に入れます`
                              : "足しました"
                            : "足さないことにしました"}
                      </span>
                    )}
                  </div>
                ) : null}
                <ReviewTable
                  rows={g.rows}
                  selected={sel}
                  onSelect={setSel}
                  onAccept={(id) => accept([id])}
                  onCorrect={(id, text) => {
                    const res = correctCandidate(p.wh, reading, id, text, chosen, approvalTime());
                    if ("error" in res) return res.error;
                    put(res.reading, res.wh);
                    setMsg({ ok: true, text: "直した値を現状に入れました（元に戻すで戻せます）" });
                    return null;
                  }}
                  onReject={(id) => put(rejectCandidates(reading, [id], approvalTime()))}
                  onReopen={(id) => put(reopenCandidate(reading, id))}
                  onChoose={(id, key) => setChosen({ ...chosen, [id]: key })}
                />
              </section>
            ))}
            {view.references.length > 0 ? (
              <section class="dr-group dr-refs" data-documents-references>
                <h3>照合だけの値（入力にはしません）</h3>
                <table class="rv-table">
                  <thead>
                    <tr>
                      <th scope="col">項目</th>
                      <th scope="col">書類の額</th>
                      <th scope="col">アプリの計算</th>
                      <th scope="col">差</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.references.map((x) => (
                      <tr key={x.id} data-documents-reference={x.id}>
                        <td>{x.label}</td>
                        <td>{yen(x.amount)}</td>
                        <td>{x.calc !== null ? yen(x.calc) : <span class="in-note">比較できません</span>}</td>
                        <td>{x.calc !== null ? `${x.calc >= x.amount ? "+" : "−"}${yen(x.calc - x.amount)}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}
          </div>
        </div>
        <div class="dr-foot">
          <button type="button" class="btn primary" disabled={view.bulk.length === 0} onClick={() => accept(view.bulk)} data-documents-bulk>
            まとめて承認（{view.bulk.length}件）
          </button>
          <span class="in-note">まとめて承認に入るのは、確からしさが高く、今の値が空・推定・書類待ちか同じ値の行だけです。今の確定の値と違う行・種類を決める行は1つずつ確かめてください。</span>
          <span class="dr-score" data-documents-score>
            読み取りの成績: 合った {view.score.matched}・直した {view.score.corrected}・読めなかった {view.score.unreadable}
          </span>
          <button type="button" class="btn" onClick={p.onClose}>
            閉じる
          </button>
        </div>
      </div>
    </>
  );
}
