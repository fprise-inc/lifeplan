// Web のヒアリング（0125）の FP の画面: 聞く項目・並び・確かめてもらう項目・独自の質問・頼む書類を選び、顧客にどう見えるかを見本で見て、
// URL を発行する（有効期限は30日の決め打ち。延長は依頼の一覧で。0158）・案内文のひな形をコピー。送るのは FP（メールなど）。アプリはメールを送らない
// - 書類（0190）: 一覧から足す・書類の持ち主（ご本人・配偶者の方）を選ぶ・その他の書類（名前と説明を FP が書く）。頼んだ書類で分かる問いは、
//   項目の行に「源泉徴収票（ご本人）の数字を使います」と出し、お客さまの画面には出さない（お客さまが「手元にない」を選んだときだけ出す）
import { useEffect, useMemo, useState } from "preact/hooks";
import { HearingForm } from "../../hearingForm/Form.tsx";
import { initialDraft, screenId, screenOf, screens } from "../../../../hearing/src/web/flow.ts";
import { DOCUMENT_TEMPLATES, OWNER_LABEL, templateOf, type DocumentOwner } from "../../../../hearing/src/web/documents.ts";
import { axisOf } from "../../../../hearing/src/definition.ts";
import { checkSelection, CUSTOM_LABEL_MAX, CUSTOM_MAX, documentCovers, FP_SECTION, selectableItems, type QuestionsPacket, type RequestedDocument, type SelectedSection, type WebSelection } from "../../../../hearing/src/web/packet.ts";
import { answerText } from "../../../../hearing/src/web/flow.ts";
import type { HearingWebHost } from "../../engine/host.ts";
import { docRequests } from "../input/docRequests.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { CUSTOMER_NO_PATTERN } from "./sheet.ts";
import { coverageHelp, coverageOf, defaultOwner, documentFromCheck, documentFromTemplate, nextDocId, invitationText, withOwner, issueWeb, officeFace, prefillOf, previewPacket, sheetOf, templateSelection, TEMPLATE_MAX, WEB_TEMPLATES, withCustom, withoutCustom, type CoverageInfo, type HearingTemplate, type WebLogEntry, type WebTemplateKind } from "./web.ts";
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
  /** 保存した世帯か（保存していない世帯では、鍵を失うので発行しない） */
  persisted: boolean;
  onSave: (wh: WorkingHousehold) => void;
  saveNow: () => Promise<boolean>;
  onClose: () => void;
}

/** 事務所の文（アプリを開いている間だけ覚える。ヒアリングシートの書き出しと同じ） */
const remembered = { purpose: "ライフプランの作成と、家計・保険・資産運用のご相談のため", privacyContact: "", customerNo: "" };

/** 繰り返しの軸の言葉（項目選びで、誰の・何の問いかを見分ける） */
const AXIS_HINT: Readonly<Record<string, string>> = { adult: "ご本人・配偶者の方ごと", child: "お子さまごと", parent: "ご両親ごと", loan: "ローンごと", policy: "保険ごと" };

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

export function WebBuilder({ wh, web, office, templates, onTemplates, persisted, onSave, saveNow, onClose }: Props) {
  const [kind, setKind] = useState<string>("first");
  const [sel, setSel] = useState<WebSelection>(() => templateSelection("first", wh));
  const [label, setLabel] = useState("");
  const [help, setHelp] = useState("");
  const [tplName, setTplName] = useState("");
  const [form, setForm] = useState({ ...remembered, name: office.name });
  const [packet, setPacket] = useState<QuestionsPacket | null>(null);
  const [start, setStart] = useState<{ id: string; n: number }>({ id: "intro", n: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [issued, setIssued] = useState<WebLogEntry | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const def = sheetOf(sel);
  const prefill = useMemo(() => (def === undefined ? [] : prefillOf(wh, def)), [wh, def]);
  const pre = useMemo(() => new Map(prefill.filter((a) => a.status !== "blank").map((a) => [`${a.key}#${a.index ?? 0}`, a])), [prefill]);
  const problems = def === undefined ? ["元のシートがありません"] : checkSelection(def, sel);
  const face = officeFace({ name: form.name, color: office.color, purpose: form.purpose, privacyContact: form.privacyContact });
  const okNo = CUSTOMER_NO_PATTERN.test(form.customerNo);
  const checks = useMemo(() => docRequests(wh), [wh]);
  const coverage = useMemo(() => (def === undefined ? new Map<string, CoverageInfo>() : coverageOf(def, sel)), [def, sel]);

  useEffect(() => {
    let live = true;
    if (problems.length > 0) return;
    void previewPacket(wh, sel, face, new Date()).then((p) => live && setPacket(p), () => live && setPacket(null));
    return () => {
      live = false;
    };
  }, [sel, face.name, face.purpose, face.privacyContact, face.color]);

  const pickTemplate = (k: string) => {
    setKind(k);
    setIssued(null);
    if (k.startsWith("t:")) {
      const t = templates[Number(k.slice(2))];
      if (t !== undefined) setSel(t.selection);
    } else setSel(templateSelection(k as WebTemplateKind, wh));
    setStart({ id: "intro", n: start.n + 1 });
  };

  if (def === undefined) return null;
  const items = new Map(def.items.map((i) => [i.key, i]));
  const choosable = selectableItems(def);
  const sectionOrder: string[] = [...sel.sections.map((s) => s.id), ...def.sections.map((s) => s.id).filter((id) => !sel.sections.some((x) => x.id === id) && choosable.some((i) => def.sections.find((s) => s.id === id)?.groups.some((g) => g.items.includes(i.key))))];
  const baseKeys = (id: string) => (def.sections.find((s) => s.id === id)?.groups.flatMap((g) => g.items) ?? []).filter((k) => choosable.some((i) => i.key === k));
  const secOf = (id: string): SelectedSection | undefined => sel.sections.find((s) => s.id === id);
  const setSection = (id: string, next: SelectedSection | null) => {
    const exists = sel.sections.some((s) => s.id === id);
    const sections = next === null ? sel.sections.filter((s) => s.id !== id) : exists ? sel.sections.map((s) => (s.id === id ? next : s)) : [...sel.sections, next];
    setSel({ ...sel, sections: sections.filter((s) => s.items.length > 0) });
  };
  const toggleItem = (secId: string, key: string, on: boolean) => {
    const s = secOf(secId) ?? { id: secId, items: [] };
    if (on) {
      // 元のシートの並びの位置に戻す
      const order = baseKeys(secId);
      const list = [...s.items, { key, mode: pre.has(`${key}#0`) || pre.has(`${key}#1`) ? (sel.sections.some((x) => x.items.some((i) => i.mode === "confirm")) ? "confirm" : "ask") : "ask" } as const].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
      setSection(secId, { ...s, items: list });
    } else setSection(secId, { ...s, items: s.items.filter((i) => i.key !== key) });
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

  const issue = async () => {
    setBusy(true);
    setErr(null);
    Object.assign(remembered, { purpose: form.purpose, privacyContact: form.privacyContact, customerNo: form.customerNo });
    try {
      const cfg = await web.config();
      const r = await issueWeb(wh, { selection: sel, customerNo: form.customerNo, office: face, pageUrl: cfg.pageUrl, transport: web.call });
      onSave(r.wh);
      await saveNow();
      setIssued(r.entry);
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
  const list = packet === null ? [] : screens(packet, initialDraft(packet));
  const questions = list.filter((s) => s.kind === "item").length;

  return (
    <section class="card hs-panel wb" aria-label="Web で聞く" data-web-builder>
      <div class="card-h">
        <h2>Web で聞く（URL を発行）</h2>
        <span class="aside">お客さまがスマホなどで1問ずつ答えます。答えと書類はお客さまの端末で暗号化され、このアプリだけが開けます</span>
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
                  <small> — {t.note}</small>
                </span>
              </label>
            ))}
            {templates.map((t, i) => (
              <label class="hs-check" key={`t${i}`}>
                <input type="radio" name="web-template" checked={kind === `t:${i}`} onChange={() => pickTemplate(`t:${i}`)} />
                <span>
                  事務所のひな形: {t.name}
                  <button type="button" class="link-btn" onClick={() => void onTemplates(templates.filter((_, j) => j !== i))}>
                    消す
                  </button>
                </span>
              </label>
            ))}
          </fieldset>

          <div class="wb-box" data-web-items>
            <h3>聞く項目（{sel.sections.reduce((n, s) => n + s.items.length, 0)}）</h3>
            <p class="rp-note">分野ごと・項目ごとに選べます。↑↓で並びを変えられます。配偶者の方・お子さまの人数・住まい・働き方などに合わせて、お客さまの画面では当てはまらない問いを飛ばします。記入の年月と同意の欄は必ず入ります。</p>
            {sectionOrder.map((sid, si) => {
              const s = secOf(sid);
              const title = sid === FP_SECTION.id ? FP_SECTION.title : (def.sections.find((x) => x.id === sid)?.title ?? sid).replace(/^\d+\.\s*/, "");
              const keys = sid === FP_SECTION.id ? (s?.items.map((i) => i.key) ?? []) : [...(s?.items.map((i) => i.key) ?? []), ...baseKeys(sid).filter((k) => !(s?.items ?? []).some((i) => i.key === k))];
              const on = s?.items.length ?? 0;
              const all = sid === FP_SECTION.id ? on : baseKeys(sid).length;
              const inSel = si < sel.sections.length;
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
                      onChange={(e) => setSection(sid, (e.currentTarget as HTMLInputElement).checked ? { id: sid, items: baseKeys(sid).map((key) => ({ key, mode: kind === "review" && hasPre(key) ? "confirm" : "ask" })) } : null)}
                      aria-label={`${title}をまとめて選ぶ`}
                    />
                    <b>{title}</b>
                    <small>
                      {on}/{all}
                    </small>
                    {inSel ? (
                      <span class="wb-move">
                        <button type="button" class="link-btn" disabled={si === 0} onClick={(e) => (e.preventDefault(), setSel({ ...sel, sections: move(sel.sections, si, -1) }))} aria-label={`${title}を上へ`}>
                          ↑
                        </button>
                        <button type="button" class="link-btn" disabled={si >= sel.sections.length - 1} onClick={(e) => (e.preventDefault(), setSel({ ...sel, sections: move(sel.sections, si, 1) }))} aria-label={`${title}を下へ`}>
                          ↓
                        </button>
                      </span>
                    ) : null}
                  </summary>
                  <ul class="wb-items">
                    {keys.map((key) => {
                      const chosen = s?.items.find((i) => i.key === key);
                      const idx = s?.items.findIndex((i) => i.key === key) ?? -1;
                      const custom = sel.custom.find((c) => c.key === key);
                      const it = items.get(key);
                      const name = custom?.label ?? it?.label ?? key;
                      const target = screenOf(list, key);
                      const cov = chosen !== undefined ? coverage.get(key) : undefined;
                      return (
                        <li key={key} class={chosen === undefined ? "off" : ""} data-web-item={key}>
                          <label>
                            <input type="checkbox" checked={chosen !== undefined} disabled={custom !== undefined} onChange={(e) => toggleItem(sid, key, (e.currentTarget as HTMLInputElement).checked)} />
                            <span>{name}</span>
                            {it !== undefined && axisOf(def, key) !== null ? <small class="wb-axis">{AXIS_HINT[axisOf(def, key)?.id ?? ""] ?? "繰り返し"}</small> : null}
                          </label>
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
                          {chosen !== undefined ? (
                            <span class="wb-move">
                              {target !== undefined ? (
                                <button type="button" class="link-btn" onClick={() => setStart({ id: screenId(target), n: start.n + 1 })} title="見本でこの問いを開きます">
                                  見る
                                </button>
                              ) : null}
                              <button type="button" class="link-btn" disabled={idx <= 0} onClick={() => setSection(sid, { id: sid, items: move(s?.items ?? [], idx, -1) })} aria-label={`${name}を上へ`}>
                                ↑
                              </button>
                              <button type="button" class="link-btn" disabled={idx >= (s?.items.length ?? 0) - 1} onClick={() => setSection(sid, { id: sid, items: move(s?.items ?? [], idx, 1) })} aria-label={`${name}を下へ`}>
                                ↓
                              </button>
                              {custom !== undefined ? (
                                <button type="button" class="link-btn" onClick={() => setSel(withoutCustom(sel, key))}>
                                  外す
                                </button>
                              ) : null}
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              );
            })}
            <div class="wb-custom" data-web-custom>
              <h4>FP の独自の質問を足す（自由記述。答えはメモに入り、計算には使いません。{CUSTOM_MAX}問まで）</h4>
              <input type="text" value={label} maxLength={CUSTOM_LABEL_MAX} placeholder="例: ご相談のきっかけを教えてください" onInput={(e) => setLabel((e.currentTarget as HTMLInputElement).value)} data-web-custom-label />
              <input type="text" value={help} maxLength={300} placeholder="補足（任意）" onInput={(e) => setHelp((e.currentTarget as HTMLInputElement).value)} />
              <button type="button" class="btn" disabled={label.trim() === "" || sel.custom.length >= CUSTOM_MAX} onClick={() => (setSel((cur) => withCustom(cur, label, help)), setLabel(""), setHelp(""))} data-web-custom-add>
                足す
              </button>
            </div>
          </div>

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
                {coverNames.length > 0 ? <small class="wb-doc-covers" data-web-doc-covers={d.id}>この書類の数字を使う問い（お客さまの画面に出しません）: {coverNames.join("・")}</small> : null}
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
            <h3>事務所のひな形として保存</h3>
            <p class="rp-note">今の組み合わせ（項目・並び・独自の質問・書類）を、事務所のひな形にします（事務所データに暗号化して置きます。{TEMPLATE_MAX}件まで）。</p>
            <div class="hs-form">
              <input type="text" value={tplName} maxLength={40} placeholder="ひな形の名前（例: 子育て世帯の初回）" onInput={(e) => setTplName((e.currentTarget as HTMLInputElement).value)} />
              <button type="button" class="btn" disabled={tplName.trim() === "" || problems.length > 0 || templates.length >= TEMPLATE_MAX} onClick={() => void onTemplates([...templates.filter((t) => t.name !== tplName.trim()), { name: tplName.trim(), selection: sel }]).then(() => setTplName(""))}>
                保存
              </button>
            </div>
          </div>

          <div class="wb-box wb-issue" data-web-issue>
            <h3>URL を発行する</h3>
            <div class="hs-form">
              <label>
                <span>顧客番号（英数字）</span>
                <input type="text" value={form.customerNo} maxLength={16} onInput={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value;
                  setForm((f) => ({ ...f, customerNo: v }));
                }} aria-invalid={!okNo} data-web-customer />
              </label>
              <label>
                <span>事務所名（最初の画面に出ます）</span>
                <input type="text" value={form.name} maxLength={60} onInput={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value;
                  setForm((f) => ({ ...f, name: v }));
                }} />
              </label>
              <label>
                <span>何のための問いか</span>
                <input type="text" value={form.purpose} maxLength={120} onInput={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value;
                  setForm((f) => ({ ...f, purpose: v }));
                }} />
              </label>
              <label>
                <span>個人情報の窓口（任意）</span>
                <input type="text" value={form.privacyContact} maxLength={120} onInput={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value;
                  setForm((f) => ({ ...f, privacyContact: v }));
                }} />
              </label>
            </div>
            <p class="rp-note" data-web-expiry-note>回答の期限は、発行した日から30日です。足りないときは、依頼の一覧の「延長」で、押した日から30日に延ばせます（発行した日から90日まで）。</p>
            {sel.sections.some((s) => s.items.some((i) => i.mode === "confirm")) ? <p class="hs-warn">「確かめてもらう」項目の今の値は、問いと一緒に暗号化して送ります。URL を知っている人は今の値を読めるので、送り先を確かめてください。</p> : null}
            {!persisted ? <p class="fatal">世帯を保存してから発行してください（受け取りの鍵は世帯ファイルの中に置きます）。</p> : null}
            {problems.length > 0 ? <p class="fatal">{problems.join("・")}</p> : null}
            {!okNo ? <p class="rp-note">顧客番号は英数字・ハイフン・下線（16字まで）。氏名は入れません。</p> : null}
            {err !== null ? <p class="fatal">{err}</p> : null}
            <div class="rp-actions">
              <button type="button" class="btn primary" disabled={busy || !okNo || !persisted || problems.length > 0} onClick={() => void issue()} data-web-issue-go>
                {busy ? "発行しています…" : `URL を発行する（問い ${questions}・書類 ${sel.documents.length}）`}
              </button>
              <button type="button" class="btn" onClick={onClose}>
                閉じる
              </button>
            </div>
            {issued !== null ? (
              <div class="wb-issued" role="status" data-web-issued>
                <p>
                  発行しました（依頼番号 {issued.record.requestId}・期限 {new Date(issued.record.expiresAt).toLocaleDateString("ja-JP")}）。アプリはメールを送りません。下の案内文をコピーして、お客さまに送ってください。
                </p>
                <textarea readOnly rows={3} value={issued.record.url} aria-label="お客さまの URL" data-web-url />
                <button type="button" class="btn" onClick={() => void copy("url", issued.record.url)}>
                  URL をコピー
                </button>
                <textarea readOnly rows={12} value={invitationText(issued, form.name)} aria-label="案内文" data-web-message />
                <button type="button" class="btn primary" onClick={() => void copy("msg", invitationText(issued, form.name))} data-web-copy-message>
                  案内文をコピー
                </button>
                {copied !== null ? <p class="rp-note">{copied === "url" ? "URL" : "案内文"}を写しました。送る前に送り先を確かめてください。</p> : null}
              </div>
            ) : null}
          </div>
        </div>
        <div class="wb-right" data-web-preview>
          <div class="wb-phone">
            {packet !== null ? <HearingForm key={`${packet.digest}:${start.n}:${start.id}`} packet={packet} mode="preview" initial={initialDraft(packet)} startAt={start.id} /> : <p class="rp-note">見本を作っています…</p>}
          </div>
          <button type="button" class="link-btn" onClick={() => setStart({ id: "intro", n: start.n + 1 })}>
            見本を最初から
          </button>
        </div>
      </div>
    </section>
  );
}
