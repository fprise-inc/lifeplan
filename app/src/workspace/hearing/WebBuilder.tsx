// Web のヒアリング（0125）の FP の画面: 聞く項目・並び・確かめてもらう項目・独自の質問・ご相談したいことの話題・頼む書類を選び、顧客にどう見えるかを
// 見本で見て、URL を発行する（有効期限は30日の決め打ち。延長は依頼の一覧で。0158）・案内文のひな形をコピー。送るのは FP（メールなど）。アプリはメールを送らない
// - 書類（0190）: 一覧から足す・書類の持ち主（ご本人・配偶者の方）を選ぶ・その他の書類（名前と説明を FP が書く）。頼んだ書類で分かる問いは、
//   項目の行に「源泉徴収票（ご本人）の数字を使います」と出し、お客さまの画面には出さない（お客さまが「手元にない」を選んだときだけ出す）
// - 0192: ひな形はシンプル・詳細・見直しと、カスタム（自分で選んだ・保存した組み合わせ）。シンプルはご両親を既定で外す（足せば聞ける）。
//   ひな形を切り替えても書類・独自の質問・話題は残す（項目を直した後なら確かめる）。分野は外しても元の位置に残す（灰色）。金額の「だいたいの範囲」は
//   金額の項目の「範囲でも答えられる」で選ぶ（別の項目として並べない・数えない）。数は1つの数え方（聞く項目の数・お客さまの画面の数と所要時間）。
//   顧客番号は開いている世帯の番号（世帯をまたいで覚えない）。事務所のひな形には、その世帯の書類待ちの結びつきと持ち主を入れない
import { useEffect, useMemo, useState } from "preact/hooks";
import { HearingForm } from "../../hearingForm/Form.tsx";
import { screenId, screenOf, screens } from "../../../../hearing/src/web/flow.ts";
import { DOCUMENT_TEMPLATES, OWNER_LABEL, templateOf, type DocumentOwner } from "../../../../hearing/src/web/documents.ts";
import { axisOf } from "../../../../hearing/src/definition.ts";
import { checkSelection, CONSULT_KEY, CUSTOM_CHOICES_MAX, CUSTOM_CHOICE_LABEL_MAX, CUSTOM_HELP_MAX, CUSTOM_LABEL_MAX, CUSTOM_MAX, DEFAULT_TOPICS, documentCovers, FP_SECTION, selectableItems, TOPIC_LABEL_MAX, TOPICS_MAX, type CustomAnswer, type CustomQuestion, type QuestionsPacket, type RequestedDocument, type SelectedItem, type SelectedSection, type WebSelection } from "../../../../hearing/src/web/packet.ts";
import { answerText } from "../../../../hearing/src/web/flow.ts";
import type { HearingWebHost } from "../../engine/host.ts";
import { docRequests } from "../input/docRequests.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { CUSTOMER_NO_PATTERN } from "./sheet.ts";
import {
  cleanTopics,
  coverageHelp,
  coverageOf,
  CUSTOM_TEMPLATE,
  defaultOwner,
  documentFromCheck,
  documentFromTemplate,
  estimateOf,
  filledCount,
  householdShape,
  invitationText,
  issueWeb,
  nextDocId,
  officeFace,
  prefillOf,
  previewDraft,
  previewPacket,
  selectedCount,
  sheetOf,
  TEMPLATE_MAX,
  templateForSave,
  templateSelection,
  WEB_TEMPLATES,
  withCustom,
  withCustomEdit,
  withoutCustom,
  withOwner,
  type CoverageInfo,
  type HearingTemplate,
  type WebLogEntry,
  type WebTemplateKind,
} from "./web.ts";
import "../../hearingForm/form.css";

export interface OfficeLook {
  name: string;
  /** 基調の色（白地で読める濃さ。0121。標準なら null） */
  color: string | null;
}

interface Props {
  wh: WorkingHousehold;
  web: HearingWebHost;
  office: OfficeLook;
  templates: readonly HearingTemplate[];
  onTemplates: (list: HearingTemplate[]) => Promise<void>;
  /** ご相談したいことの話題の事務所の既定値（null は標準の話題）と、その保存（null で標準に戻す）。0192 */
  topics?: readonly string[] | null;
  onTopics?: (list: string[] | null) => Promise<void>;
  /** 開いている世帯の顧客番号（保存していない世帯は null。0192: 世帯をまたいで覚えない） */
  customerNo?: string | null;
  /** 保存した世帯か（保存していない世帯では、鍵を失うので発行しない） */
  persisted: boolean;
  onSave: (wh: WorkingHousehold) => void;
  saveNow: () => Promise<boolean>;
  onClose: () => void;
}

/** 事務所の文（アプリを開いている間だけ覚える。ヒアリングシートの書き出しと同じ。顧客番号は覚えない: 世帯ごとの番号を使う） */
const remembered = { purpose: "ライフプランの作成と、家計・保険・資産運用のご相談のため", privacyContact: "" };

/** 繰り返しの軸の言葉（項目選びで、誰の・何の問いかを見分ける） */
const AXIS_HINT: Readonly<Record<string, string>> = { adult: "ご本人・配偶者の方ごと", child: "お子さまごと", parent: "ご両親ごと", loan: "ローンごと", policy: "保険ごと" };

/** 独自の質問の答えの形の言葉 */
const ANSWER_KINDS: readonly { value: CustomAnswer; label: string }[] = [
  { value: "text", label: "自由に書く" },
  { value: "yesNo", label: "はい・いいえ" },
  { value: "choice", label: "選択肢から選ぶ" },
];

/** 書類の一覧の並び（ひな形の並びのまとまり） */
const DOC_GROUPS: readonly { title: string; kinds: readonly string[] }[] = [
  { title: "収入", kinds: ["withholding", "payslip", "bonusSlip", "taxReturn", "companyAccounts", "residentTaxNotice", "retirementRules"] },
  { title: "年金", kinds: ["pensionNotice", "pensionAmountNotice", "dcNotice"] },
  { title: "貯蓄・投資", kinds: ["deposits", "securities", "investStatement"] },
  { title: "保険", kinds: ["insurancePolicy", "insuranceDeduction"] },
  { title: "住まい・ローン", kinds: ["loanSchedule", "otherLoanSchedule", "propertyTax", "rentalContract"] },
  { title: "家計・その他", kinds: ["householdBook", "other"] },
];

const move = <T,>(list: readonly T[], i: number, d: -1 | 1): T[] => {
  const j = i + d;
  if (j < 0 || j >= list.length) return [...list];
  const out = [...list];
  [out[i], out[j]] = [out[j] as T, out[i] as T];
  return out;
};

/** 区画の並び（選んだ区画は選んだ並びのまま、選んでいない区画は元のシートの位置の近くに差し込む。外した区画も元の位置に残す。H-123） */
function orderOf(def: NonNullable<ReturnType<typeof sheetOf>>, sel: WebSelection): string[] {
  const choosable = new Set(selectableItems(def).map((i) => i.key));
  const base = [...def.sections.filter((s) => s.groups.some((g) => g.items.some((k) => choosable.has(k)))).map((s) => s.id), FP_SECTION.id];
  return displayKeys(base, sel.sections.map((s) => s.id)).filter((id) => id !== FP_SECTION.id || sel.sections.some((s) => s.id === id));
}

/** 区画の中の項目の並び（選んだ項目の並びに、選んでいない項目を元の並びの近くに差し込む。外しても最後に回らない） */
function displayKeys(base: readonly string[], chosen: readonly string[]): string[] {
  const out = [...chosen];
  for (const k of base) {
    if (out.includes(k)) continue;
    const at = base.indexOf(k);
    // 元の並びで前にある項目のうち、いちばん後ろの物の次に置く
    let pos = 0;
    out.forEach((x, i) => {
      if (base.indexOf(x) < at) pos = i + 1;
    });
    out.splice(pos, 0, k);
  }
  return out;
}

const sameSel = (a: WebSelection, b: WebSelection) => JSON.stringify(a.sections) === JSON.stringify(b.sections);

export function WebBuilder({ wh, web, office, templates, onTemplates, topics: officeTopics = null, onTopics, customerNo = null, persisted, onSave, saveNow, onClose }: Props) {
  const baseTopics = officeTopics ?? DEFAULT_TOPICS;
  const [kind, setKind] = useState<string>("simple");
  const [origin, setOrigin] = useState<WebSelection>(() => templateSelection("simple", wh, baseTopics));
  const [sel, setSel] = useState<WebSelection>(origin);
  const [asking, setAsking] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [help, setHelp] = useState("");
  const [answerKind, setAnswerKind] = useState<CustomAnswer>("text");
  const [choices, setChoices] = useState<string[]>(["", ""]);
  const [editing, setEditing] = useState<string | null>(null);
  const [topicDraft, setTopicDraft] = useState("");
  const [topicMsg, setTopicMsg] = useState<string | null>(null);
  const [tplName, setTplName] = useState("");
  const [form, setForm] = useState({ ...remembered, name: office.name, customerNo: customerNo ?? "" });
  const [packet, setPacket] = useState<QuestionsPacket | null>(null);
  const [start, setStart] = useState<{ id: string; n: number }>({ id: "intro", n: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ entry: WebLogEntry; sel: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const def = sheetOf(sel);
  const prefill = useMemo(() => (def === undefined ? [] : prefillOf(wh, def)), [wh, def]);
  const pre = useMemo(() => new Map(prefill.filter((a) => a.status !== "blank").map((a) => [`${a.key}#${a.index ?? 0}`, a])), [prefill]);
  const problems = def === undefined ? ["元のシートがありません"] : checkSelection(def, sel);
  const face = officeFace({ name: form.name, color: office.color, purpose: form.purpose, privacyContact: form.privacyContact });
  const okNo = CUSTOMER_NO_PATTERN.test(form.customerNo);
  const checks = useMemo(() => docRequests(wh), [wh]);
  const coverage = useMemo(() => (def === undefined ? new Map<string, CoverageInfo>() : coverageOf(def, sel)), [def, sel]);
  const est = useMemo(() => estimateOf(wh, sel), [wh, sel]);
  const shape = useMemo(() => householdShape(wh), [wh]);
  const filled = useMemo(() => filledCount(wh), [wh]);
  // ひな形の説明の数（聞く項目の数・所要時間。お客さまの最初の画面と同じ数え方）
  const notes = useMemo(
    () =>
      new Map(
        WEB_TEMPLATES.map((t) => {
          const s = templateSelection(t.value, wh, baseTopics);
          const e = estimateOf(null, s);
          return [t.value, `${selectedCount(s)}項目${e !== null ? `・${e.std.minutes}分ほど` : ""}`] as const;
        }),
      ),
    [wh, baseTopics],
  );

  useEffect(() => {
    let live = true;
    if (problems.length > 0) return;
    void previewPacket(wh, sel, face, new Date()).then((p) => live && setPacket(p), () => live && setPacket(null));
    return () => {
      live = false;
    };
  }, [sel, face.name, face.purpose, face.privacyContact, face.color]);

  /** 項目を直したか（ひな形を選んだときから聞く項目・並び・聞き方が変わった） */
  const edited = !sameSel(sel, origin);
  /** ひな形を選ぶ。書類・独自の質問・話題は残す（保存した組み合わせは、その中身に置き換える）。直した項目が消えるときは確かめる（H-107） */
  const pickTemplate = (k: string, sure = false) => {
    const saved = k.startsWith("t:") ? templates[Number(k.slice(2))] : undefined;
    const loses = edited || (saved !== undefined && (sel.documents.length > 0 || sel.custom.length > 0));
    if (loses && !sure) return setAsking(k);
    setAsking(null);
    setKind(k);
    setIssued(null);
    let next: WebSelection;
    if (saved !== undefined) next = saved.selection;
    else {
      const t = templateSelection(k as WebTemplateKind, wh, sel.topics ?? baseTopics);
      const fp = sel.sections.find((s) => s.id === FP_SECTION.id);
      next = { ...t, custom: sel.custom, documents: sel.documents, ...(sel.topics !== undefined ? { topics: sel.topics } : {}), sections: fp !== undefined ? [...t.sections, fp] : t.sections };
    }
    setOrigin(next);
    setSel(next);
    setStart({ id: "intro", n: start.n + 1 });
  };

  if (def === undefined) return null;
  const items = new Map(def.items.map((i) => [i.key, i]));
  const choosable = selectableItems(def);
  /** 金額の項目 → その「だいたいの範囲」の項目（範囲の項目は並べず、金額の項目の「範囲でも答えられる」で選ぶ。H-103） */
  const rangeOf = new Map(def.items.filter((i) => i.rangeOf !== undefined).map((i) => [i.rangeOf as string, i.key]));
  const isRange = (k: string) => items.get(k)?.rangeOf !== undefined;
  const order = orderOf(def, sel);
  const baseKeys = (id: string) => (def.sections.find((s) => s.id === id)?.groups.flatMap((g) => g.items) ?? []).filter((k) => choosable.some((i) => i.key === k));
  const secOf = (id: string): SelectedSection | undefined => sel.sections.find((s) => s.id === id);
  /** 区画を置き換える（選んでいた区画はその位置で。新しく選んだ区画は、今の並びの位置に差し込む） */
  const setSection = (id: string, next: SelectedSection | null) => {
    const at = sel.sections.findIndex((s) => s.id === id);
    let list: SelectedSection[];
    if (at >= 0) list = next === null ? sel.sections.filter((s) => s.id !== id) : sel.sections.map((s) => (s.id === id ? next : s));
    else if (next === null) list = [...sel.sections];
    else {
      const before = order.slice(0, order.indexOf(id)).filter((x) => sel.sections.some((s) => s.id === x)).length;
      list = [...sel.sections];
      list.splice(before, 0, next);
    }
    setSel({ ...sel, sections: list.filter((s) => s.items.length > 0) });
  };
  const modeFor = (key: string): SelectedItem["mode"] => (kind === "review" && hasPre(key) ? "confirm" : "ask");
  const toggleItem = (secId: string, key: string, on: boolean) => {
    const s = secOf(secId) ?? { id: secId, items: [] };
    const range = rangeOf.get(key);
    if (on) {
      // 元のシートの並びの位置に戻す（範囲の項目も一緒に）
      const order0 = baseKeys(secId);
      const add: SelectedItem[] = [{ key, mode: modeFor(key) }, ...(range !== undefined && order0.includes(range) ? [{ key: range, mode: "ask" as const }] : [])];
      const list = [...s.items.filter((i) => !add.some((a) => a.key === i.key)), ...add].sort((a, b) => order0.indexOf(a.key) - order0.indexOf(b.key));
      setSection(secId, { ...s, items: list });
    } else setSection(secId, { ...s, items: s.items.filter((i) => i.key !== key && i.key !== range) });
  };
  const toggleRange = (secId: string, key: string, on: boolean) => {
    const s = secOf(secId);
    const range = rangeOf.get(key);
    if (s === undefined || range === undefined) return;
    if (!on) return setSection(secId, { ...s, items: s.items.filter((i) => i.key !== range) });
    const at = s.items.findIndex((i) => i.key === key);
    const list = [...s.items.filter((i) => i.key !== range)];
    list.splice(at + 1, 0, { key: range, mode: "ask" });
    setSection(secId, { ...s, items: list });
  };
  /** 項目の並べ替え（範囲の項目は金額の項目と一緒に動かす） */
  const moveItem = (secId: string, key: string, d: -1 | 1) => {
    const s = secOf(secId);
    if (s === undefined) return;
    const groups: SelectedItem[][] = [];
    for (const i of s.items) {
      if (isRange(i.key) && groups.length > 0 && rangeOf.get(groups[groups.length - 1]?.[0]?.key ?? "") === i.key) groups[groups.length - 1]?.push(i);
      else groups.push([i]);
    }
    const at = groups.findIndex((g) => g[0]?.key === key);
    if (at < 0) return;
    setSection(secId, { ...s, items: move(groups, at, d).flat() });
  };
  const moveSection = (id: string, d: -1 | 1) => {
    const at = sel.sections.findIndex((s) => s.id === id);
    if (at >= 0) setSel({ ...sel, sections: move(sel.sections, at, d) });
  };
  const hasPre = (key: string) => [...pre.keys()].some((k) => k.startsWith(`${key}#`));
  const preText = (key: string) => {
    const it = packet?.items.find((i) => i.key === key);
    const list = [...pre.entries()].filter(([k]) => k.startsWith(`${key}#`)).map(([, a]) => a);
    if (it === undefined || list.length === 0) return null;
    return list
      .slice(0, 3)
      .map((a) => answerText(it, { status: a.status === "blank" ? "later" : a.status, ...(a.raw !== undefined ? { raw: a.raw } : {}), ...(a.raw2 !== undefined ? { raw2: a.raw2 } : {}) }))
      .join("・");
  };
  const setDoc = (id: string, d: RequestedDocument | null) => setSel({ ...sel, documents: d === null ? sel.documents.filter((x) => x.id !== id) : sel.documents.map((x) => (x.id === id ? d : x)) });
  const addDoc = (d: RequestedDocument) => setSel((cur) => ({ ...cur, documents: [...cur.documents, { ...d, id: nextDocId(cur) }] }));
  const topics = sel.topics ?? [];
  const setTopics = (list: string[]) => setSel((cur) => ({ ...cur, topics: list }));
  const consultOn = sel.sections.some((s) => s.items.some((i) => i.key === CONSULT_KEY));

  const issue = async () => {
    setBusy(true);
    setErr(null);
    Object.assign(remembered, { purpose: form.purpose, privacyContact: form.privacyContact });
    try {
      const cfg = await web.config();
      const r = await issueWeb(wh, { selection: { ...sel, name: edited && !kind.startsWith("t:") ? `${CUSTOM_TEMPLATE}（${WEB_TEMPLATES.find((t) => t.value === kind)?.label ?? ""}から）` : (sel.name ?? CUSTOM_TEMPLATE) }, customerNo: form.customerNo, office: face, pageUrl: cfg.pageUrl, transport: web.call });
      onSave(r.wh);
      await saveNow();
      setIssued({ entry: r.entry, sel: JSON.stringify(sel) });
    } catch (e) {
      const code = e instanceof Error ? e.message : String(e);
      setErr(code === "E_RELAY_UNREACHABLE" ? "受け付けのサーバーにつながりませんでした（インターネットにつながっているか確かめてください）" : `発行できませんでした（${code}）`);
    } finally {
      setBusy(false);
    }
  };
  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(null);
    }
  };
  const draft = packet === null ? null : previewDraft(packet, wh);
  const list = packet === null || draft === null ? [] : screens(packet, draft);
  const count = selectedCount(sel);
  const sameAsIssued = issued !== null && issued.sel === JSON.stringify(sel);
  const confirmAny = sel.sections.some((s) => s.items.some((i) => i.mode === "confirm"));
  const titleOf = (sid: string) => (sid === FP_SECTION.id ? FP_SECTION.title : (def.sections.find((x) => x.id === sid)?.title ?? sid).replace(/^\d+\.\s*/, ""));
  const nameOf = (key: string) => sel.custom.find((c) => c.key === key)?.label ?? items.get(key)?.label ?? key;
  const asked = order.filter((id) => (secOf(id)?.items.length ?? 0) > 0);
  const notAsked = order.filter((id) => id !== FP_SECTION.id && (secOf(id)?.items.length ?? 0) === 0);
  const startKind = WEB_TEMPLATES.find((t) => t.value === kind)?.label ?? templates[Number(kind.slice(2))]?.name ?? "";

  const issuedBox =
    issued !== null ? (
      <div class="wb-issued" role="status" data-web-issued>
        <p>
          発行しました（依頼番号 {issued.entry.record.requestId}・期限 {new Date(issued.entry.record.expiresAt).toLocaleDateString("ja-JP")}）。アプリはメールを送りません。下の案内文をコピーして、お客さまに送ってください。
        </p>
        <textarea readOnly rows={3} value={issued.entry.record.url} aria-label="お客さまの URL" data-web-url />
        <button type="button" class="btn" onClick={() => void copy("url", issued.entry.record.url)}>
          URL をコピー
        </button>
        <textarea readOnly rows={14} value={invitationText(issued.entry, form.name)} aria-label="案内文" data-web-message />
        <button type="button" class="btn primary" onClick={() => void copy("msg", invitationText(issued.entry, form.name))} data-web-copy-message>
          案内文をコピー
        </button>
        {copied !== null ? <p class="rp-note">{copied === "url" ? "URL" : "案内文"}を写しました。送る前に送り先を確かめてください。</p> : null}
      </div>
    ) : null;

  return (
    <section class="card hs-panel wb" aria-label="URL で聞く" data-web-builder>
      <div class="card-h">
        <h2>URL で聞く（Web のヒアリング）</h2>
        <span class="aside">お客さまがスマホなどで画面に沿って答えます。答えと書類はお客さまの端末で暗号化され、このアプリだけが開けます</span>
      </div>
      <div class="wb-grid">
        <div class="wb-left">
          <fieldset class="wb-box" data-web-templates>
            <legend>ひな形から始める</legend>
            {WEB_TEMPLATES.map((t) => (
              <label class="hs-check" key={t.value}>
                <input type="radio" name="web-template" checked={kind === t.value} onChange={() => pickTemplate(t.value)} data-web-template={t.value} />
                <span>
                  {t.label}
                  <small>
                    {" "}
                    — {notes.get(t.value)}。{t.note}
                    {t.value === "simple" ? "（ご両親は既定で聞きません）" : ""}
                  </small>
                </span>
              </label>
            ))}
            <div class="wb-customs" data-web-custom-templates>
              <span class="wb-tag-h">{CUSTOM_TEMPLATE}（自分で選んだ・保存した組み合わせ）</span>
              {templates.length === 0 ? <small class="rp-note">まだありません。項目を選んで、下の「カスタムとして保存」で保存できます。</small> : null}
              {templates.map((t, i) => (
                <label class="hs-check" key={`t${i}`}>
                  <input type="radio" name="web-template" checked={kind === `t:${i}`} onChange={() => pickTemplate(`t:${i}`)} data-web-template={`t:${i}`} />
                  <span>
                    {t.name}
                    <small> — {selectedCount(t.selection)}項目・書類 {t.selection.documents.length}</small>
                    <button type="button" class="link-btn" onClick={() => void onTemplates(templates.filter((_, j) => j !== i))}>
                      消す
                    </button>
                  </span>
                </label>
              ))}
            </div>
            {edited ? (
              <p class="rp-note" data-web-edited>
                {startKind}から項目を直しています（{CUSTOM_TEMPLATE}）。よく使う組み合わせなら、下の「カスタムとして保存」で次から選べます。
              </p>
            ) : null}
            {asking !== null ? (
              <p class="wr-confirm" role="alert" data-web-template-ask>
                {edited ? "直した項目は、選んだひな形の項目に戻ります。" : ""}
                {asking.startsWith("t:") ? "書類・独自の質問も、保存した組み合わせのものになります。" : "書類・独自の質問・ご相談の話題はそのまま残します。"}
                よろしいですか。
                <button type="button" class="btn" onClick={() => pickTemplate(asking, true)} data-web-template-yes>
                  選ぶ
                </button>
                <button type="button" class="btn" onClick={() => setAsking(null)}>
                  やめる
                </button>
              </p>
            ) : null}
            {!confirmAny && filled > 0 && def.sheetId !== "full" ? (
              <p class="hs-warn" data-web-has-values>
                この世帯には、もう入力した値があります。前回の値を見せて確かめてもらうなら「見直し」を選んでください（シンプルの答えは大まかです。取り込むときは、今の値を残すかを候補ごとに選べます）。
              </p>
            ) : null}
          </fieldset>

          <div class="wb-box" data-web-items>
            <h3>聞く項目（{count}）</h3>
            <p class="wb-summary" data-web-summary>
              <span>
                <b>聞く:</b> {asked.length > 0 ? asked.map(titleOf).join("・") : "なし"}
              </span>
              {notAsked.length > 0 ? (
                <span>
                  <b>聞かない:</b> {notAsked.map(titleOf).join("・")}
                </span>
              ) : null}
            </p>
            <p class="rp-note">分野ごと・項目ごとに選べます。↑↓で並びを変えられます。配偶者の方・お子さまの人数・住まい・働き方などに合わせて、お客さまの画面では当てはまらない問いを飛ばします。記入の年月と同意の欄は必ず入ります。</p>
            {order.map((sid) => {
              const s = secOf(sid);
              const title = titleOf(sid);
              const chosenKeys = (s?.items ?? []).map((i) => i.key).filter((k) => !isRange(k));
              const keys = sid === FP_SECTION.id ? chosenKeys : displayKeys(baseKeys(sid).filter((k) => !isRange(k)), chosenKeys);
              const on = chosenKeys.length;
              const all = sid === FP_SECTION.id ? on : baseKeys(sid).filter((k) => !isRange(k)).length;
              const si = sel.sections.findIndex((x) => x.id === sid);
              const names = chosenKeys.map(nameOf);
              return (
                <details class={`wb-sec${on === 0 ? " off" : ""}`} key={sid} data-web-section={sid}>
                  <summary>
                    <input
                      type="checkbox"
                      checked={on > 0}
                      ref={(el) => {
                        if (el !== null) el.indeterminate = on > 0 && on < all;
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setSection(sid, (e.currentTarget as HTMLInputElement).checked ? { id: sid, items: baseKeys(sid).map((key) => ({ key, mode: modeFor(key) })) } : null)}
                      aria-label={`${title}をまとめて選ぶ`}
                    />
                    <b>{title}</b>
                    <small>
                      {on}/{all}
                    </small>
                    {on > 0 ? (
                      <small class="wb-sec-names" title={names.join("・")}>
                        {names.slice(0, 3).join("・")}
                        {names.length > 3 ? ` ほか${names.length - 3}` : ""}
                      </small>
                    ) : (
                      <small class="wb-sec-names">聞かない</small>
                    )}
                    {si >= 0 ? (
                      <span class="wb-move">
                        <button type="button" class="link-btn" disabled={si === 0} onClick={(e) => (e.preventDefault(), moveSection(sid, -1))} aria-label={`${title}を上へ`}>
                          ↑
                        </button>
                        <button type="button" class="link-btn" disabled={si >= sel.sections.length - 1} onClick={(e) => (e.preventDefault(), moveSection(sid, 1))} aria-label={`${title}を下へ`}>
                          ↓
                        </button>
                      </span>
                    ) : null}
                  </summary>
                  <ul class="wb-items">
                    {keys.map((key) => {
                      const chosen = s?.items.find((i) => i.key === key);
                      const idx = chosenKeys.indexOf(key);
                      const custom = sel.custom.find((c) => c.key === key);
                      const it = items.get(key);
                      const name = nameOf(key);
                      const target = screenOf(list, key);
                      const cov = chosen !== undefined ? coverage.get(key) : undefined;
                      const range = rangeOf.get(key);
                      const rangeOn = range !== undefined && (s?.items ?? []).some((i) => i.key === range);
                      return (
                        <li key={key} class={chosen === undefined ? "off" : ""} data-web-item={key}>
                          <label>
                            <input type="checkbox" checked={chosen !== undefined} disabled={custom !== undefined} onChange={(e) => toggleItem(sid, key, (e.currentTarget as HTMLInputElement).checked)} />
                            <span>{name}</span>
                            {it !== undefined && axisOf(def, key) !== null ? <small class="wb-axis">{AXIS_HINT[axisOf(def, key)?.id ?? ""] ?? "繰り返し"}</small> : null}
                            {custom !== undefined ? <small class="wb-axis">{ANSWER_KINDS.find((a) => a.value === (custom.answer ?? "text"))?.label}</small> : null}
                          </label>
                          {chosen !== undefined && range !== undefined && baseKeys(sid).includes(range) ? (
                            <label class="wb-range" title="お客さまは、金額のかわりに、だいたいの範囲を選んで答えられます">
                              <input type="checkbox" checked={rangeOn} onChange={(e) => toggleRange(sid, key, (e.currentTarget as HTMLInputElement).checked)} data-web-range={key} />
                              <small>範囲でも答えられる</small>
                            </label>
                          ) : null}
                          {chosen !== undefined && def.sheetId === "full" && hasPre(key) ? (
                            <select value={chosen.mode} onChange={(e) => setSection(sid, { id: sid, items: (s?.items ?? []).map((i) => (i.key === key ? { ...i, mode: (e.currentTarget as HTMLSelectElement).value as "ask" | "confirm" } : i)) })} aria-label={`${name}の聞き方`} data-web-mode={key}>
                              <option value="ask">聞く（空欄から）</option>
                              <option value="confirm">確かめてもらう</option>
                            </select>
                          ) : null}
                          {chosen?.mode === "confirm" ? <small class="wb-pre">今の値: {preText(key) ?? "—"}</small> : null}
                          {cov !== undefined ? (
                            <span class="wb-doc-use" data-web-doc-use={key}>
                              <small>{cov.docs.join("・")}の数字を使います</small>
                              <details class="wb-help">
                                <summary aria-label="説明">？</summary>
                                <p>{coverageHelp(cov)}</p>
                              </details>
                            </span>
                          ) : null}
                          {chosen !== undefined && key === CONSULT_KEY ? <small class="wb-axis">話題 {topics.length}（下で直せます）</small> : null}
                          {chosen !== undefined ? (
                            <span class="wb-move">
                              {target !== undefined ? (
                                <button type="button" class="link-btn" onClick={() => setStart({ id: screenId(target), n: start.n + 1 })} title="見本でこの問いを開きます">
                                  見る
                                </button>
                              ) : null}
                              <button type="button" class="link-btn" disabled={idx <= 0} onClick={() => moveItem(sid, key, -1)} aria-label={`${name}を上へ`}>
                                ↑
                              </button>
                              <button type="button" class="link-btn" disabled={idx >= chosenKeys.length - 1} onClick={() => moveItem(sid, key, 1)} aria-label={`${name}を下へ`}>
                                ↓
                              </button>
                              {custom !== undefined ? (
                                <>
                                  <button type="button" class="link-btn" onClick={() => setEditing(editing === key ? null : key)} aria-expanded={editing === key} data-web-custom-edit={key}>
                                    {editing === key ? "閉じる" : "直す"}
                                  </button>
                                  <button type="button" class="link-btn" onClick={() => setSel(withoutCustom(sel, key))}>
                                    外す
                                  </button>
                                </>
                              ) : null}
                            </span>
                          ) : null}
                          {custom !== undefined && editing === key ? <CustomEditor c={custom} onChange={(next) => setSel(withCustomEdit(sel, key, next))} /> : null}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              );
            })}
            <div class="wb-custom" data-web-custom>
              <h4>FP の独自の質問を足す（答えはメモに入り、計算には使いません。{CUSTOM_MAX}問まで）</h4>
              <input type="text" value={label} maxLength={CUSTOM_LABEL_MAX} placeholder="例: ご相談のきっかけを教えてください" onInput={(e) => setLabel((e.currentTarget as HTMLInputElement).value)} aria-label="独自の質問の文" data-web-custom-label />
              <input type="text" value={help} maxLength={CUSTOM_HELP_MAX} placeholder="補足（任意）" onInput={(e) => setHelp((e.currentTarget as HTMLInputElement).value)} aria-label="独自の質問の補足" />
              <select value={answerKind} onChange={(e) => setAnswerKind((e.currentTarget as HTMLSelectElement).value as CustomAnswer)} aria-label="答えの形" data-web-custom-kind>
                {ANSWER_KINDS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
              {answerKind === "choice" ? <ChoiceInputs list={choices} onChange={setChoices} /> : null}
              <button
                type="button"
                class="btn"
                disabled={label.trim() === "" || sel.custom.length >= CUSTOM_MAX || (answerKind === "choice" && choices.filter((x) => x.trim() !== "").length < 2)}
                onClick={() => {
                  setSel((cur) => withCustom(cur, label, help, undefined, answerKind === "choice" ? { answer: "choice", choices: choices.map((x) => x.trim()).filter((x) => x !== "") } : { answer: answerKind }));
                  setLabel("");
                  setHelp("");
                  setChoices(["", ""]);
                }}
                data-web-custom-add
              >
                足す
              </button>
            </div>
          </div>

          {consultOn ? (
            <div class="wb-box" data-web-topics>
              <h3>ご相談したいことの話題（{topics.length}）</h3>
              <p class="rp-note">お客さまは、この中からいくつでも選べます。ほかにあれば自由に書く欄も一緒に出ます。言い換える・外す・足すができます（この依頼だけ）。いつも使う話題は「事務所の既定にする」で、次から最初に入ります。</p>
              <ul class="wb-topics">
                {topics.map((t, i) => (
                  <li key={i} data-web-topic={i}>
                    <input type="text" value={t} maxLength={TOPIC_LABEL_MAX} onInput={(e) => setTopics(topics.map((x, j) => (j === i ? (e.currentTarget as HTMLInputElement).value : x)))} aria-label={`話題 ${i + 1}`} />
                    <span class="wb-move">
                      <button type="button" class="link-btn" disabled={i === 0} onClick={() => setTopics(move(topics, i, -1))} aria-label={`${t}を上へ`}>
                        ↑
                      </button>
                      <button type="button" class="link-btn" disabled={i >= topics.length - 1} onClick={() => setTopics(move(topics, i, 1))} aria-label={`${t}を下へ`}>
                        ↓
                      </button>
                      <button type="button" class="link-btn" onClick={() => setTopics(topics.filter((_, j) => j !== i))} data-web-topic-remove={i}>
                        外す
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              <div class="hs-form wb-topic-add">
                <input type="text" value={topicDraft} maxLength={TOPIC_LABEL_MAX} placeholder="話題を足す（例: 相続のこと）" onInput={(e) => setTopicDraft((e.currentTarget as HTMLInputElement).value)} aria-label="足す話題" data-web-topic-new />
                <button type="button" class="btn" disabled={topicDraft.trim() === "" || topics.length >= TOPICS_MAX || topics.includes(topicDraft.trim())} onClick={() => (setTopics([...topics, topicDraft.trim()]), setTopicDraft(""))} data-web-topic-add>
                  足す
                </button>
              </div>
              {onTopics !== undefined ? (
                <div class="rp-actions">
                  <button type="button" class="btn" disabled={cleanTopics(topics).length !== topics.length} onClick={() => void onTopics(cleanTopics(topics)).then(() => setTopicMsg("事務所の既定にしました。次に URL で聞くときから、この話題が入ります"))} data-web-topics-office>
                    事務所の既定にする
                  </button>
                  <button type="button" class="btn" onClick={() => (setTopics([...DEFAULT_TOPICS]), void onTopics(null).then(() => setTopicMsg("標準の話題に戻しました")))} data-web-topics-reset>
                    標準の話題に戻す
                  </button>
                  {officeTopics !== null ? <small class="rp-note">今の事務所の既定: {officeTopics.length > 0 ? officeTopics.join("・") : "話題なし（自由記述だけ）"}</small> : null}
                </div>
              ) : null}
              {topicMsg !== null ? (
                <p class="rp-note" role="status">
                  {topicMsg}
                </p>
              ) : null}
            </div>
          ) : null}

          <div class="wb-box" data-web-docs>
            <h3>送っていただきたい書類（{sel.documents.length}）</h3>
            <p class="rp-note">お客さまの画面では、書類を1通ずつ見せ、何のためか・どこが写っていればよいかの説明（直せます）と、撮る前の注意（番号は隠してよい・全体が入るように）を出します。頼んだ書類で分かる問いは、お客さまの画面に出しません（「手元にない」を選んだときだけ出します）。</p>
            {checks.length > 0 ? (
              <div class="wb-checks">
                <h4>書類待ちの欄から（{checks.length}通）</h4>
                <ul>
                  {checks.map((r) => {
                    const added = sel.documents.some((d) => d.docRequest === r.id);
                    return (
                      <li key={r.id}>
                        <span>{r.title}</span>
                        <small>{[...new Set(r.values.map((v) => v.field))].join("・")}</small>
                        <button type="button" class="link-btn" disabled={added} onClick={() => addDoc(documentFromCheck(sel, r))} data-web-doc-check={r.id}>
                          {added ? "頼む書類に入れました" : "この書類を頼む"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            <div class="wb-catalog">
              <h4>書類の一覧から</h4>
              {DOC_GROUPS.map((g) => (
                <div class="wb-tags-row" key={g.title}>
                  <small class="wb-tag-h">{g.title}</small>
                  <div class="wb-tags">
                    {g.kinds.map((k) => DOCUMENT_TEMPLATES.find((t) => t.kind === k)).filter((t) => t !== undefined).map((t) => (
                      <button type="button" class="btn small" key={t.kind} onClick={() => addDoc(documentFromTemplate(sel, t.kind, defaultOwner(sel, t.kind)))} data-web-doc-add={t.kind}>
                        ＋ {t.kind === "other" ? "その他の書類" : t.title}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {sel.documents.map((d) => {
              const t = templateOf(d.kind);
              const covers = documentCovers(def, sel, d);
              const coverNames = [...new Set(covers.map((c) => c.split("#")[0] as string).filter((k) => items.get(k)?.rangeOf === undefined))].map((k) => items.get(k)?.label ?? k);
              return (
                <div class="wb-doc" key={d.id} data-web-doc={d.id}>
                  <input type="text" value={d.title} maxLength={80} placeholder={d.kind === "other" ? "書類の名前（例: 学資保険の証券）" : undefined} onInput={(e) => setDoc(d.id, { ...d, title: (e.currentTarget as HTMLInputElement).value })} aria-label="書類の見出し" />
                  {t !== undefined && t.whose !== "household" ? (
                    <label>
                      誰の書類
                      <select value={d.owner ?? ""} onChange={(e) => setDoc(d.id, withOwner(d, ((e.currentTarget as HTMLSelectElement).value || undefined) as DocumentOwner | undefined))} data-web-doc-owner={d.id}>
                        {t.whose === "either" ? <option value="">ご家族（まとめて）</option> : d.owner === undefined ? <option value="">選んでください</option> : null}
                        {(["self", "spouse"] as const).map((o) => (
                          <option key={o} value={o}>
                            {OWNER_LABEL[o]}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label>
                    何のため
                    <input type="text" value={d.purpose} maxLength={200} placeholder={d.kind === "other" ? "例: 学資保険の満期の額を確かめるため" : undefined} onInput={(e) => setDoc(d.id, { ...d, purpose: (e.currentTarget as HTMLInputElement).value })} />
                  </label>
                  <label>
                    どこが写っていればよいか
                    <input type="text" value={d.where} maxLength={200} placeholder={d.kind === "other" ? "例: 満期の年月と満期保険金の欄" : undefined} onInput={(e) => setDoc(d.id, { ...d, where: (e.currentTarget as HTMLInputElement).value })} />
                  </label>
                  {coverNames.length > 0 ? (
                    <small class="wb-doc-covers" data-web-doc-covers={d.id}>
                      この書類の数字を使う問い（お客さまの画面に出しません）: {coverNames.join("・")}
                    </small>
                  ) : null}
                  {t?.whose === "person" && d.owner === undefined && t.covers.length > 0 ? <small class="wb-doc-covers">誰の書類かを選ぶと、その方の問いをお客さまの画面に出さずに済みます。</small> : null}
                  <span class="wb-move">
                    {d.docRequest !== undefined ? <small>書類待ちと結びつけています</small> : null}
                    <button type="button" class="link-btn" onClick={() => setDoc(d.id, null)}>
                      外す
                    </button>
                  </span>
                </div>
              );
            })}
          </div>

          <div class="wb-box" data-web-save-template>
            <h3>{CUSTOM_TEMPLATE}として保存</h3>
            <p class="rp-note">
              今の組み合わせ（項目・並び・独自の質問・ご相談の話題・書類）を、事務所の{CUSTOM_TEMPLATE}のひな形にします（事務所データに暗号化して置きます。{TEMPLATE_MAX}件まで）。書類は種類だけを保存します（この世帯の書類待ちとの結びつき・誰の書類かは保存しません）。
            </p>
            <div class="hs-form">
              <input type="text" value={tplName} maxLength={40} placeholder="名前（例: 子育て世帯の最初の面談）" onInput={(e) => setTplName((e.currentTarget as HTMLInputElement).value)} aria-label="カスタムの名前" />
              <button type="button" class="btn" disabled={tplName.trim() === "" || problems.length > 0 || templates.length >= TEMPLATE_MAX} onClick={() => void onTemplates([...templates.filter((t) => t.name !== tplName.trim()), { name: tplName.trim(), selection: templateForSave(sel, tplName.trim()) }]).then(() => setTplName(""))} data-web-save-template-go>
                保存
              </button>
            </div>
          </div>

          <div class="wb-box wb-issue" data-web-issue>
            <h3>URL を発行する</h3>
            {issuedBox}
            <div class="hs-form">
              <label>
                <span>顧客番号（英数字）</span>
                <input
                  type="text"
                  value={form.customerNo}
                  maxLength={16}
                  onInput={(e) => {
                    const v = (e.currentTarget as HTMLInputElement).value;
                    setForm((f) => ({ ...f, customerNo: v }));
                  }}
                  aria-invalid={!okNo}
                  data-web-customer
                />
              </label>
              <label>
                <span>事務所名（最初の画面に出ます）</span>
                <input
                  type="text"
                  value={form.name}
                  maxLength={60}
                  onInput={(e) => {
                    const v = (e.currentTarget as HTMLInputElement).value;
                    setForm((f) => ({ ...f, name: v }));
                  }}
                  data-web-office-name
                />
              </label>
              <label>
                <span>何のための問いか</span>
                <input
                  type="text"
                  value={form.purpose}
                  maxLength={120}
                  onInput={(e) => {
                    const v = (e.currentTarget as HTMLInputElement).value;
                    setForm((f) => ({ ...f, purpose: v }));
                  }}
                />
              </label>
              <label>
                <span>個人情報の窓口（任意）</span>
                <input
                  type="text"
                  value={form.privacyContact}
                  maxLength={120}
                  onInput={(e) => {
                    const v = (e.currentTarget as HTMLInputElement).value;
                    setForm((f) => ({ ...f, privacyContact: v }));
                  }}
                />
              </label>
            </div>
            {est !== null ? (
              <p class="rp-note" data-web-estimate>
                お客さまの画面: 問い {est.std.screens}画面・{est.std.minutes}分ほど（夫婦と子2人で数えた目安。お客さまの最初の画面と案内文にも同じ数が出ます）
                {est.own !== null && shape !== null ? `。この世帯（${shape}）では ${est.own.screens}画面・${est.own.minutes}分ほど` : ""}
              </p>
            ) : null}
            <p class="rp-note" data-web-expiry-note>
              回答の期限は、発行した日から30日です。足りないときは、依頼の一覧の「延長」で、押した日から30日に延ばせます（発行した日から90日まで）。
            </p>
            {confirmAny ? <p class="hs-warn">「確かめてもらう」項目の今の値は、問いと一緒に暗号化して送ります。URL を知っている人は今の値を読めるので、送り先を確かめてください。</p> : null}
            {form.name.trim() === "" ? (
              <p class="hs-warn" data-web-no-office>
                事務所名が空です。お客さまの最初の画面には「担当の FP」と出ます（どこからの問いか分かるように、事務所名を入れてください）。
              </p>
            ) : null}
            {!persisted ? <p class="fatal">世帯を保存してから発行してください（受け取りの鍵は世帯ファイルの中に置きます）。</p> : null}
            {problems.length > 0 ? <p class="fatal">{problems.join("・")}</p> : null}
            {!okNo ? <p class="fatal">顧客番号は英数字・ハイフン・下線（16字まで）で入れてください。氏名は入れません。</p> : null}
            {err !== null ? <p class="fatal">{err}</p> : null}
            <div class="rp-actions">
              <button type="button" class={`btn${sameAsIssued ? "" : " primary"}`} disabled={busy || !okNo || !persisted || problems.length > 0} onClick={() => void issue()} data-web-issue-go>
                {busy ? "発行しています…" : sameAsIssued ? "同じ内容でもう1通作る" : `URL を発行する（聞く項目 ${count}・書類 ${sel.documents.length}）`}
              </button>
              <button type="button" class="btn" onClick={onClose}>
                閉じる
              </button>
            </div>
            {sameAsIssued ? <p class="rp-note">この内容の URL は発行しました（上）。もう1通作ると、別の URL になります（前の URL もそのまま使えます）。</p> : null}
          </div>
        </div>
        <div class="wb-right" data-web-preview>
          <div class="wb-phone">
            {packet !== null && draft !== null ? <HearingForm key={`${packet.digest}:${start.n}:${start.id}`} packet={packet} mode="preview" initial={draft} startAt={start.id} /> : <p class="rp-note">見本を作っています…</p>}
          </div>
          {shape !== null ? <small class="rp-note">見本は、この世帯の人数（{shape}）で出しています。</small> : null}
          <button type="button" class="link-btn" onClick={() => setStart({ id: "intro", n: start.n + 1 })}>
            見本を最初から
          </button>
        </div>
      </div>
    </section>
  );
}

/** 選択肢の欄（2〜8つ） */
function ChoiceInputs({ list, onChange }: { list: readonly string[]; onChange: (l: string[]) => void }) {
  return (
    <div class="wb-choices" data-web-custom-choices>
      {list.map((c, i) => (
        <span key={i} class="wb-choice">
          <input type="text" value={c} maxLength={CUSTOM_CHOICE_LABEL_MAX} placeholder={`選択肢 ${i + 1}`} onInput={(e) => onChange(list.map((x, j) => (j === i ? (e.currentTarget as HTMLInputElement).value : x)))} aria-label={`選択肢 ${i + 1}`} />
          {list.length > 2 ? (
            <button type="button" class="link-btn" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label={`選択肢 ${i + 1}を外す`}>
              外す
            </button>
          ) : null}
        </span>
      ))}
      {list.length < CUSTOM_CHOICES_MAX ? (
        <button type="button" class="link-btn" onClick={() => onChange([...list, ""])} data-web-custom-choice-add>
          ＋ 選択肢
        </button>
      ) : null}
    </div>
  );
}

/** 独自の質問を直す（文・補足・答えの形・選択肢。H-109） */
function CustomEditor({ c, onChange }: { c: CustomQuestion; onChange: (next: Pick<CustomQuestion, "label" | "help" | "answer" | "choices">) => void }) {
  const cur = { label: c.label, help: c.help ?? "", answer: c.answer ?? "text", choices: c.choices ?? ["", ""] };
  const put = (x: Partial<typeof cur>) => {
    const n = { ...cur, ...x };
    onChange({ label: n.label, help: n.help, answer: n.answer, ...(n.answer === "choice" ? { choices: n.choices } : {}) });
  };
  return (
    <div class="wb-custom wb-custom-edit" data-web-custom-editor={c.key}>
      <input type="text" value={cur.label} maxLength={CUSTOM_LABEL_MAX} onInput={(e) => put({ label: (e.currentTarget as HTMLInputElement).value })} aria-label="独自の質問の文" data-web-custom-edit-label />
      <input type="text" value={cur.help} maxLength={CUSTOM_HELP_MAX} placeholder="補足（任意）" onInput={(e) => put({ help: (e.currentTarget as HTMLInputElement).value })} aria-label="独自の質問の補足" />
      <select value={cur.answer} onChange={(e) => put({ answer: (e.currentTarget as HTMLSelectElement).value as CustomAnswer })} aria-label="答えの形" data-web-custom-edit-kind>
        {ANSWER_KINDS.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </select>
      {cur.answer === "choice" ? <ChoiceInputs list={cur.choices} onChange={(l) => put({ choices: l })} /> : null}
    </div>
  );
}
