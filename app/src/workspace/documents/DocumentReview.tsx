// 書類の読み取りの確かめの画面（0148 の2）と、入力のホームの「取り込む」の入口。
// - 1画面に1通。左に書類から読んだ所（元の場所と、その所の文字。伏せ字の後）、右に入る欄の行（共通の部品 ReviewTable）。行を押すと左のその所が光る
// - 1つずつ承認・直す・入れない。まとめて承認は確からしさが高く、今の値が空・推定・書類待ちか同じ値の行だけ（review/rows.ts の bulkEligible）
// - 新しい物（保険の契約など）は、物ごとに「足す」を選んでから、その中の値を承認する。同じ契約がありそうなら知らせる（黙ってまとめない）
// - 照合だけの値は入力にせず、書類の額とアプリの計算を並べる
// - 世帯の値を変える操作は、読み取りの記録を先に入れてから、元に戻せる変更として現状に入れる（呼ぶ側の onChange）
// - 保険の契約の候補がある書類（控除証明書など）は、入れ漏れの一覧（今の保険の入力に無さそうな契約）を上に出す（0153 の3）
// - 入口から、控除証明書の電子データ（XML）のファイルを、このパソコンの中だけで読む（0153 の2。読み手は deductionXml.ts）
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { WorkingHousehold } from "../input/household.ts";
import { formatYearMonth } from "../input/units.ts";
import { approvalTime } from "../hearing/sheet.ts";
import { roles } from "../roles.ts";
import { ReviewTable } from "../review/ReviewTable.tsx";
import { pendingCount, pendingTotal, removable, withoutReading, withReading } from "./log.ts";
import { readProposal } from "./proposal.ts";
import { deductionProposals, readDeductionFile } from "./deductionXml.ts";
import { gapDate, gapText } from "./insuranceGaps.ts";
import { acceptCandidates, acceptObject, correctCandidate, docReview, rejectCandidates, rejectObject, reopenCandidate, withHolder, type CalcOf, type Chosen } from "./review.ts";
import { SAMPLE_DEDUCTION_XML, SAMPLE_DOCUMENTS } from "./samples.ts";
import { docTypeLabel, type DocumentLog, type DocumentReading } from "./types.ts";

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

/** 架空の控除証明書の電子データ（XML）を、XML の読み手で読んだ記録（見本の世帯だけ。0153 の4） */
export function xmlSampleReadings(wh: WorkingHousehold, at: string = approvalTime(), newId: () => string = () => crypto.randomUUID()): DocumentReading[] {
  const members = roles(wh.request).map((r) => ({ key: r.key, id: r.member.id }));
  const reader = { id: "sample.deductionXml", version: 1 };
  return deductionProposals(SAMPLE_DEDUCTION_XML).proposals.flatMap((p) => {
    const r = readProposal(p.raw, { via: "sample", at, newId, reader, members }).reading;
    return r === null ? [] : [{ ...r, dropped: r.dropped + p.masked }];
  });
}

/** もう読んだファイル（同じ指紋の記録がある） */
const alreadyRead = (wh: WorkingHousehold, sha256: string | undefined): boolean => sha256 !== undefined && (wh.documents?.readings ?? []).some((x) => x.file?.sha256 === sha256);

const MAX_FILES = 10;

/** 入力のホームの「取り込む」の中の入口（書類の読み取り）。onReadings があれば、控除証明書の電子データ（XML）を読む入口も出す */
export function DocumentEntry({ wh, sample, onOpen, onSamples, onReadings }: { wh: WorkingHousehold; sample: boolean; onOpen: () => void; onSamples: () => void; onReadings?: (readings: DocumentReading[]) => void }) {
  const readings = wh.documents?.readings ?? [];
  const pending = pendingTotal(wh);
  const [xmlMsg, setXmlMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const readFiles = async (files: FileList | null) => {
    if (files === null || files.length === 0 || onReadings === undefined) return;
    setBusy(true);
    const members = roles(wh.request).map((r) => ({ key: r.key, id: r.member.id }));
    const fresh: DocumentReading[] = [];
    const notes: string[] = [];
    let again = 0;
    try {
      for (const f of [...files].slice(0, MAX_FILES)) {
        const res = await readDeductionFile(new Uint8Array(await f.arrayBuffer()), { at: approvalTime(), newId: () => crypto.randomUUID(), members });
        // 理由にはファイル名を添える（画面に出すだけで、記録には残さない）
        notes.push(...res.issues.map((x) => (files.length > 1 ? `「${f.name}」: ${x}` : x)));
        // 前に読んだファイル（同じ指紋）は足さない。1つのファイルの証明書は、まとめて足すか足さないか
        const sha = res.readings[0]?.file?.sha256;
        if (alreadyRead(wh, sha) || fresh.some((x) => x.file?.sha256 === sha)) again += res.readings.length;
        else fresh.push(...res.readings);
      }
    } catch {
      notes.push("ファイルを読めませんでした");
    }
    if (files.length > MAX_FILES) notes.push(`一度に読めるのは${MAX_FILES}ファイルまでです`);
    if (again > 0) notes.push(`前に読んだファイルの証明書（${again}通）は、もう一度は足していません`);
    setBusy(false);
    const contracts = fresh.reduce((n, r) => n + r.objects.length, 0);
    setXmlMsg(fresh.length > 0 ? { ok: true, text: `証明書${fresh.length}通・契約${contracts}件を読みました。${notes.join("。")}` } : { ok: false, text: notes.length > 0 ? notes.join("。") : "読める証明書がありませんでした" });
    if (fresh.length > 0) onReadings(fresh);
  };
  return (
    <div class="hs-tools" role="group" aria-label="書類の読み取り" data-imports-documents>
      <span class="hs-tools-h">書類の読み取り</span>
      {onReadings !== undefined ? (
        <label class={`btn${busy ? " disabled" : ""}`} data-documents-xml>
          控除証明書の電子データ（XML）を読む
          <input
            type="file"
            accept=".xml,application/xml,text/xml"
            multiple
            hidden
            disabled={busy}
            onChange={(e) => {
              const input = e.currentTarget as HTMLInputElement;
              void readFiles(input.files).then(() => (input.value = ""));
            }}
            data-documents-xml-file
          />
        </label>
      ) : null}
      {onReadings !== undefined && sample ? (
        <button type="button" class="btn" onClick={() => onReadings(xmlSampleReadings(wh))} data-documents-xml-sample>
          架空の控除証明書の電子データで試す
        </button>
      ) : null}
      {readings.length > 0 ? (
        <button type="button" class="btn" onClick={onOpen} data-documents-open>
          読んだ書類を確かめる{pending > 0 ? `（未決 ${pending}件）` : `（${readings.length}通）`}
        </button>
      ) : null}
      {sample ? (
        <button type="button" class="btn" onClick={onSamples} data-documents-samples>
          架空の書類の見本で試す
        </button>
      ) : null}
      <span class="in-note">書類から読んだ値は候補として届き、確かめて承認したものだけが現状に入ります。個人番号などの番号は読みません・残しません。</span>
      {onReadings !== undefined ? (
        <span class="in-note" data-documents-xml-note>
          控除証明書の電子データ（マイナポータルから保存した生命保険料・地震保険料の XML）は、このパソコンの中だけで読みます（外へ送りません）。元のファイル・氏名・証券番号は保存しません。
        </span>
      ) : null}
      {xmlMsg !== null ? (
        <span class={xmlMsg.ok ? "rk-ok" : "hh-err"} role="status" data-documents-xml-msg>
          {xmlMsg.text}
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [p.onClose]);
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
                {pendingCount(r) > 0 ? <span class="dr-n">未決 {pendingCount(r)}</span> : <span class="dr-n done">済</span>}
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
            {view.gaps !== null ? (
              <section class="dr-group dr-gaps" data-documents-gaps>
                <h3>保険の入れ漏れの一覧</h3>
                <p class="in-note" data-documents-gaps-summary>
                  この書類の契約 {view.gaps.rows.length}件のうち、今の保険の入力に無さそうな契約 {view.gaps.missing}件・同じ契約かもしれない契約 {view.gaps.maybe}件。
                  同じ契約かもしれないときは、まとめません（同じなら「足さない」にして、今の契約の欄を直してください）。保障の額は証明書に無いので、足した契約は証券を見て入れてください。
                </p>
                <table class="rv-table">
                  <thead>
                    <tr>
                      <th scope="col">書類の契約</th>
                      <th scope="col">契約年月</th>
                      <th scope="col">年間の保険料</th>
                      <th scope="col">控除の区分</th>
                      <th scope="col">今の保険の入力</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.gaps.rows.map((g) => (
                      <tr key={g.key} class={`dr-gap s-${g.status}`} data-documents-gap={g.key} data-documents-gap-status={g.status}>
                        <td>
                          {g.label}
                          <span class="in-note">（{g.kind}）</span>
                        </td>
                        <td>{gapDate(g)}</td>
                        <td>{g.annual !== null ? yen(g.annual) : "—"}</td>
                        <td>{g.deduction ?? "—"}</td>
                        <td>{gapText(g)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}
            {view.groups.map((g) => (
              <section class="dr-group" key={g.key} data-documents-group={g.key}>
                <h3>{g.label}</h3>
                {g.object !== null ? (
                  <div class={`dr-object s-${g.object.status}`} data-documents-object={g.object.key}>
                    {g.object.status === "pending" ? (
                      <>
                        <span>
                          この書類の契約を、新しい物として足しますか（確からしさ {g.object.confidence}）。足すと、下の値を承認できます。
                        </span>
                        <button
                          type="button"
                          class="btn small primary"
                          onClick={() => {
                            const res = acceptObject(p.wh, reading, g.object?.key ?? "", approvalTime());
                            if (res === null) setMsg({ ok: false, text: "足せませんでした" });
                            else {
                              put(res.reading, res.wh);
                              setMsg({ ok: true, text: "新しい物を足しました。値を確かめて承認してください" });
                            }
                          }}
                          data-documents-object-accept={g.object.key}
                        >
                          足す
                        </button>
                        <button type="button" class="link-btn" onClick={() => put(rejectObject(reading, g.object?.key ?? "", approvalTime()))} data-documents-object-reject={g.object.key}>
                          足さない
                        </button>
                      </>
                    ) : (
                      <span>{g.object.status === "accepted" ? "足しました" : "足さないことにしました"}</span>
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
                        <td>{x.calc !== null ? yen(x.calc) : <span class="in-note">比べられません</span>}</td>
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
