// 名前つきの出来事（0003 の6・0038）: 時点の部品で「出来事から」選べる一覧と、年齢で入れるときの人の呼び方。
// 出来事が正本: 子の独立・入居・年金の受け取り開始・介護の始まりは、選ばれたときに出来事にし（元の物の時点はその出来事を指す）、
// 出来事を動かすと、指している物が全部いっしょに動く。出来事の時点は年月か人の年齢だけ（出来事から出来事は作らない）
import type { Household, HouseholdEvent, Member, Timepoint } from "../../engine/types.ts";
import { resolveTimepoint } from "../timepoint.ts";
import { roles } from "../roles.ts";
import type { WorkingHousehold } from "./household.ts";
import { memberLabels } from "./labels.ts";
import type { WhenEvent, WhenPerson } from "./when.ts";
import { sameWhen } from "./when.ts";

/** 出来事の種類の名前（世帯ファイルの `events[].kind`）。知らない種類は「出来事」 */
export const EVENT_KIND_LABEL: Record<string, string> = {
  moveIn: "入居",
  independence: "独立",
  careStart: "介護の始まり",
  carPurchase: "車の購入",
  carRelease: "車を手放す",
  pensionStart: "年金の受け取り開始",
  retirement: "定年",
  lastWork: "働く最後",
  marriage: "結婚",
  divorce: "離婚",
  jobChange: "転職",
  startBusiness: "開業",
  relocation: "住み替え・移住",
  parentMoveIn: "親との同居",
  birth: "出産",
  other: "その他の出来事",
};

/** FP が家族のカードで足せる出来事の種類 */
export const FP_EVENT_KINDS: readonly string[] = ["marriage", "divorce", "jobChange", "startBusiness", "relocation", "parentMoveIn", "birth", "other"];

const kindLabel = (kind: string) => EVENT_KIND_LABEL[kind] ?? "出来事";

// ---- 人 ----

/** 年齢で入れられる人（呼び方つき）。並びは 本人 → 配偶者 → 子（上から）→ ほかの家族 */
export function whenPeople(wh: WorkingHousehold): WhenPerson[] {
  const h = wh.request.input.household;
  const labels = memberLabels(wh);
  const rs = roles(wh.request);
  const self = h.members.find((m) => m.kind === "self");
  const spouse = h.members.find((m) => m.kind === "spouse");
  const kids = rs.filter((r) => r.member.kind === "child");
  const couple = (m: Member) => (spouse === undefined || self === undefined ? [] : m.sex === "female" ? ["妻"] : ["夫"]);
  const out: WhenPerson[] = [];
  const nick = (m: Member) => {
    const n = wh.labelsByMember[m.id];
    return n !== undefined && n !== "" ? [n] : [];
  };
  for (const r of rs) {
    const m = r.member;
    const label = labels.get(m.id) ?? r.label;
    let names: string[];
    if (m.kind === "self") names = ["本人", ...couple(m), "ご本人", "自分", r.label];
    else if (m.kind === "spouse") names = [...couple(m), "配偶者", r.label];
    else if (m.kind === "child") {
      const i = kids.findIndex((k) => k.member.id === m.id);
      names = [r.label];
      if (kids.length === 1) names.push("子", "子ども");
      if (kids.length > 1 && i === 0) names.push("上の子", "一番上の子");
      if (kids.length > 1 && i === kids.length - 1) names.push("下の子", "末子", "末っ子", "一番下の子");
    } else if (m.kind === "parent") names = [m.sex === "female" ? "母" : "父", "親", label];
    else if (m.kind === "grandparent") names = [m.sex === "female" ? "祖母" : "祖父", label];
    else names = [label];
    out.push({ id: m.id, label, names: [...new Set([...names, ...nick(m), label])] });
  }
  for (const m of h.members) if (!out.some((p) => p.id === m.id)) out.push({ id: m.id, label: labels.get(m.id) ?? "ご家族", names: [labels.get(m.id) ?? "ご家族", ...nick(m)] });
  return out;
}

// ---- 出来事にできる物（まだ出来事でないもの） ----

/** 出来事にできる物の、元の時点の場所。読むと今の時点、書くとその出来事を指す */
interface Anchor {
  /** 選ぶ前の仮の ID（`new:<種類>:<物の ID>`） */
  id: string;
  kind: string;
  member?: string;
  read: (h: Household) => Timepoint | null;
  point: (h: Household, event: string) => void;
}

const isEventForm = (t: Timepoint | null | undefined) => t?.event !== undefined;

/** 年金の受け取り開始の、省略のときの時点（65歳になった翌月。0003 の追記 2026-10-11） */
const defaultClaim = (member: string): Timepoint => ({ memberAge: { member, years: 65, ageSwitch: "monthAfterReach" } });

function anchors(h: Household): Anchor[] {
  const out: Anchor[] = [];
  for (const m of h.members) {
    if (m.kind !== "child" || m.leaves == null || isEventForm(m.leaves)) continue;
    out.push({
      id: `new:independence:${m.id}`,
      kind: "independence",
      member: m.id,
      read: (hh) => hh.members.find((x) => x.id === m.id)?.leaves ?? null,
      point: (hh, ev) => {
        const x = hh.members.find((y) => y.id === m.id);
        if (x !== undefined) x.leaves = { event: ev };
      },
    });
  }
  for (const r of h.residences ?? []) {
    if (r.kind !== "own" || isEventForm(r.from)) continue;
    out.push({
      id: `new:moveIn:${r.id}`,
      kind: "moveIn",
      read: (hh) => (hh.residences ?? []).find((x) => x.id === r.id)?.from ?? null,
      point: (hh, ev) => {
        const x = (hh.residences ?? []).find((y) => y.id === r.id);
        if (x !== undefined) x.from = { event: ev };
      },
    });
  }
  for (const rec of h.pensionRecords ?? []) {
    const m = h.members.find((x) => x.id === rec.member);
    if (m === undefined || (m.kind !== "self" && m.kind !== "spouse")) continue;
    const b = rec.claim?.basic;
    const e = rec.claim?.employee;
    if (isEventForm(b) || isEventForm(e) || !sameWhen(b ?? defaultClaim(m.id), e ?? defaultClaim(m.id))) continue;
    out.push({
      id: `new:pensionStart:${m.id}`,
      kind: "pensionStart",
      member: m.id,
      read: (hh) => (hh.pensionRecords ?? []).find((x) => x.member === m.id)?.claim?.basic ?? defaultClaim(m.id),
      point: (hh, ev) => {
        const x = (hh.pensionRecords ?? []).find((y) => y.member === m.id);
        if (x !== undefined) x.claim = { basic: { event: ev }, employee: { event: ev } };
      },
    });
  }
  // 夫婦の関係の始まり（入籍）・最後の段の終わり（離婚）。家族のカードの「夫婦の関係」の時点
  for (const r of h.relations ?? []) {
    if (r.type !== "spouse" || r.id === undefined) continue;
    const rid = r.id;
    const other = h.members.find((x) => x.kind === "spouse" && (x.id === r.a || x.id === r.b));
    const rel = (hh: Household) => (hh.relations ?? []).find((x) => x.id === rid) as Extract<NonNullable<Household["relations"]>[number], { type: "spouse" }> | undefined;
    if (r.from !== null && !isEventForm(r.from))
      out.push({
        id: `new:marriage:${rid}`,
        kind: "marriage",
        ...(other !== undefined ? { member: other.id } : {}),
        read: (hh) => rel(hh)?.from ?? null,
        point: (hh, ev) => {
          const x = rel(hh);
          if (x !== undefined) x.from = { event: ev };
        },
      });
    const last = !(h.relations ?? []).some((x) => x !== r && x.type === "spouse" && x.a === r.a && x.b === r.b && (resolveTimepoint(h, x.from) ?? "") > (resolveTimepoint(h, r.from) ?? ""));
    if (last && r.to !== null && !isEventForm(r.to))
      out.push({
        id: `new:divorce:${rid}`,
        kind: "divorce",
        ...(other !== undefined ? { member: other.id } : {}),
        read: (hh) => rel(hh)?.to ?? null,
        point: (hh, ev) => {
          const x = rel(hh);
          if (x !== undefined) x.to = { event: ev };
        },
      });
  }
  // 車の購入（次の買い替え・購入の時期）と手放す時期（0069）。手放した後の移動の費用・古くなってからの修理費・続きの車が指す
  for (const c of h.cars ?? []) {
    const car = (hh: Household) => (hh.cars ?? []).find((x) => x.id === c.id);
    if (!isEventForm(c.purchase.first))
      out.push({
        id: `new:carPurchase:${c.id}`,
        kind: "carPurchase",
        member: c.owner,
        read: (hh) => car(hh)?.purchase.first ?? null,
        point: (hh, ev) => {
          const x = car(hh);
          if (x !== undefined) x.purchase.first = { event: ev };
        },
      });
    if (c.until != null && !isEventForm(c.until))
      out.push({
        id: `new:carRelease:${c.id}`,
        kind: "carRelease",
        member: c.owner,
        read: (hh) => car(hh)?.until ?? null,
        point: (hh, ev) => {
          const x = car(hh);
          if (x !== undefined) x.until = { event: ev };
        },
      });
  }
  for (const c of h.careExpenses ?? []) {
    if (isEventForm(c.from)) continue;
    out.push({
      id: `new:careStart:${c.id}`,
      kind: "careStart",
      member: c.member,
      read: (hh) => (hh.careExpenses ?? []).find((x) => x.id === c.id)?.from ?? null,
      point: (hh, ev) => {
        const x = (hh.careExpenses ?? []).find((y) => y.id === c.id);
        if (x !== undefined) x.from = { event: ev };
      },
    });
  }
  return out;
}

// ---- 一覧 ----

/** 出来事が指されている数（出来事を指す時点と、住宅ローン控除の入居など出来事の ID を持つ欄。出来事そのものは数えない） */
export function refsTo(h: Household, id: string): number {
  let n = 0;
  const walk = (v: unknown, skip: boolean) => {
    if (typeof v === "string") {
      if (v === id && !skip) n++;
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x, false);
      return;
    }
    if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k === "id");
  };
  for (const [k, v] of Object.entries(h)) if (k !== "events") walk(v, false);
  for (const e of h.events ?? []) walk(e.at, false);
  return n;
}

/** 出来事の見せる名前（「第1子の独立」「入居」） */
export function eventName(wh: WorkingHousehold, e: Pick<HouseholdEvent, "kind" | "member">, people: readonly WhenPerson[] = whenPeople(wh)): string {
  const who = e.member === undefined ? undefined : people.find((p) => p.id === e.member);
  return who === undefined ? kindLabel(e.kind) : `${who.names[0] ?? who.label}の${kindLabel(e.kind)}`;
}

/** 名前の別の呼び方（下の子の独立・ご本人の定年・配偶者の年金の受け取り開始 など） */
function aliases(e: Pick<HouseholdEvent, "kind" | "member">, people: readonly WhenPerson[]): string[] {
  const k = kindLabel(e.kind);
  const who = e.member === undefined ? undefined : people.find((p) => p.id === e.member);
  const out = who === undefined ? [k] : who.names.map((n) => `${n}の${k}`);
  if (e.kind === "independence" && who !== undefined && who.names.includes("末子")) out.push("末子独立");
  if (e.kind === "moveIn") out.push("住宅の入居", "新居の入居");
  return out;
}

/**
 * 「出来事から」選べる一覧: 世帯の出来事と、まだ出来事でない物（子の独立・持ち家の住み始め・年金の受け取り開始・介護の始まり）。
 * 名前が同じ物は年月を添えて分ける。`exclude` の出来事は出さない（出来事そのものの時点の欄で、自分を選ばせない）
 */
export function eventChoices(wh: WorkingHousehold, opts: { exclude?: string; withCandidates?: boolean } = {}): WhenEvent[] {
  const h = wh.request.input.household;
  const people = whenPeople(wh);
  const out: WhenEvent[] = [];
  for (const e of h.events ?? []) {
    if (e.id === opts.exclude) continue;
    out.push({ id: e.id, label: eventName(wh, e, people), names: aliases(e, people), ym: resolveTimepoint(h, e.at) });
  }
  if (opts.withCandidates !== false)
    for (const a of anchors(h)) {
      const ev = { kind: a.kind, ...(a.member !== undefined ? { member: a.member } : {}) };
      out.push({ id: a.id, label: eventName(wh, ev, people), names: aliases(ev, people), ym: resolveTimepoint(h, a.read(h)), candidate: true });
    }
  // 同じ名前は年月で分ける（打った名前は、分けた名前でも元の名前でも読む。元の名前は最初の1つだけ）
  const count = new Map<string, number>();
  for (const e of out) count.set(e.label, (count.get(e.label) ?? 0) + 1);
  for (const e of out)
    if ((count.get(e.label) ?? 0) > 1 && e.ym !== null) {
      const plain = e.label;
      e.label = `${plain}（${Number(e.ym.slice(0, 4))}年${Number(e.ym.slice(5))}月）`;
      e.names = [e.label, ...e.names];
    }
  for (const e of out) e.names = [...new Set([e.label, ...e.names])];
  return out;
}

/** 時点が、まだ出来事でない物を指しているか（選んだばかりで、書くときに出来事にする） */
export const pointsToCandidate = (t: Timepoint | null | undefined): boolean => t?.event?.startsWith("new:") === true;

/**
 * まだ出来事でない物を指す時点を、出来事にしてから指す形にする（書き換える世帯 h の上で）。
 * 出来事を作り、元の物の時点をその出来事に向け、作った出来事を指す時点を返す。作れなければ null
 */
export function materializeEvent(h: Household, tp: Timepoint, newId: () => string): Timepoint | null {
  if (!pointsToCandidate(tp)) return tp;
  const a = anchors(h).find((x) => x.id === tp.event);
  if (a === undefined) return null;
  const at = a.read(h);
  if (at === null || isEventForm(at)) return null;
  const id = newId();
  (h.events ??= []).push({ id, kind: a.kind, ...(a.member !== undefined ? { member: a.member } : {}), at: structuredClone(at) });
  a.point(h, id);
  const { event: _old, ...rest } = tp;
  void _old;
  return { ...rest, event: id };
}

const isTimepointObj = (v: unknown): v is Timepoint => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return keys.length > 0 && keys.every((k) => k === "at" || k === "memberAge" || k === "event" || k === "offset") && ("memberAge" in v || "event" in v);
};

/**
 * 世帯から外す人・出来事を指していた時点を、今の年月に直す（書き換える世帯 h の上で。外した後に解けない時点を残さない）。
 * 外す人の年齢で決めた時点・外す出来事から決めた時点が対象。直した数を返す
 */
export function freezeTimepoints(h: Household, hit: (t: Timepoint) => boolean): number {
  let n = 0;
  const fix = (v: unknown): unknown => {
    if (isTimepointObj(v) && hit(v)) {
      const ym = resolveTimepoint(h, v);
      if (ym !== null) {
        n++;
        return { at: ym };
      }
      return v;
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) v[i] = fix(v[i]);
      return v;
    }
    if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v)) (v as Record<string, unknown>)[k] = fix(x);
    return v;
  };
  // 先に全部の年月を解いてから書き換える（出来事の時点を先に直すと、その出来事から決めた時点が解けなくなるため、出来事は最後）
  const { events, ...rest } = h;
  for (const v of Object.values(rest)) fix(v);
  if (events !== undefined) for (const e of events) e.at = fix(e.at) as Timepoint;
  return n;
}
