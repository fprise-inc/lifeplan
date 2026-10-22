// お金の3つの分け方（説明用の図。0032。提示層の部品）。受け取るのは MoneyThreeModel だけ（0016 の2）。
// - 資産と負債のタブの区画（何か月分・何年先までの欄つき）・持ち帰り用のレポートの1ページ（欄なし。FP が決めた値を文で書く）で同じ部品を使う。
// - 図: 左＝使う時期で分けた3つの箱（上ほどすぐ使う。薄い色＋同じ色相の枠）、右＝今の置き場所（資産と負債のタブと同じ色のベタ塗り）。左右は同じ縮尺。
//   分け方と置き場所のずれ（預金などのままの分・足りない分）は図に描かず、区画の上の一文で示す（図を指しながら FP が説明する前提）。
//   箱にカーソルを合わせる・キーボードで選ぶ・押すと、名前・金額・一言の札（FigTip.tsx）。
// - 箱の横の3枚のカードは同じ形: 名前と額 → 中身の一文 → 中身の一覧 → まとめ（ほか○件）→ ひと言。画面の貯めるお金は、一覧を最初は出さず
//   件数と「内訳を見る」にする。持ち帰り用のレポートは一覧のまま。「内訳を見る」はどちらも小窓（全部の年の表）を開く
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useBoxSize } from "./BsFigure.tsx";
import { FigTip, useFigTip, type FigTipData } from "./FigTip.tsx";
import { group, man } from "./format.ts";
import { PopIcon } from "./icons.tsx";
import type { MoneyThreeBox, MoneyThreeModel, MoneyThreeSettings, VerdictPart, Yen } from "./model.ts";

const Parts = ({ parts }: { parts: readonly VerdictPart[] }) => <>{parts.map((p, i) => (p.strong === true ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>))}</>;
const mn = (v: Yen) => `${man(v)}万円`;
/** 3つの箱の色（薄い色と枠の色。balance.css） */
const KC = ["1", "2", "3"] as const;
const placeColor = (key: string, g: string) => (key === "pooledCash" ? "var(--bs-deposit)" : `var(--bs-${key}, var(--bs-g-${g}))`);

/** 文字の幅の目安（全角1・半角0.6） */
function tw(s: string, fs: number): number {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) < 128 ? (ch === "," || ch === "." ? 0.32 : 0.6) : 1;
  return w * fs;
}

function Amount({ x, y, v, fs, anchor = "start", fill = "var(--ink)" }: { x: number; y: number; v: Yen; fs: number; anchor?: "start" | "middle" | "end"; fill?: string }) {
  return (
    <text x={x} y={y} font-size={fs} text-anchor={anchor} dominant-baseline="central" font-weight="700" fill={fill}>
      <tspan class="num">{man(v)}</tspan>
      <tspan font-size={fs * 0.55} dx="1">
        万円
      </tspan>
    </text>
  );
}

/** 箱の札の中身: 貯めるお金は年・できごと・賄えない分の短い一覧（全部の年の表はカードの「内訳を見る」の小窓）、ほかは中身の一文 */
function tipBody(b: MoneyThreeBox): Pick<FigTipData, "note" | "rows" | "hint"> {
  if (b.key !== "save") return { note: b.formula };
  const rows = [...b.items.map((it) => ({ label: `${it.lead} ${it.label}`.trim(), amount: it.amount })), ...(b.rest !== null ? [{ label: `ほか${b.rest.count}件`, amount: b.rest.amount }] : [])];
  return { rows, note: b.note ?? b.formula, hint: "内訳はカードの「内訳を見る」から" };
}

/** 置き場所の分け方の名前（札の補足。資産と負債のタブの分け方と同じ言葉） */
const PLACE_GROUP: Record<string, string> = { liquid: "すぐ使えるお金", market: "値動きのある運用", locked: "引き出せないお金" };

/**
 * 図（左右の2列。幅に合わせて描き直す）。箱にカーソルを合わせる・キーボードで選ぶ・押すと、名前・金額・一言の札を出す（FigTip.tsx）。
 * list を渡すと、箱に書ききれない名前と金額を図の下に一覧で出す（持ち帰り用のレポート。画面では札で見るので出さない）
 */
export function MoneyThreeFigure({ model, list = false }: { model: MoneyThreeModel; list?: boolean }) {
  const { ref, w: W, fs } = useBoxSize<HTMLDivElement>(560);
  const nar = W < 560;
  const [s, v, g] = model.boxes;
  const total = Math.max(model.place.total, model.need, 1);
  const H = nar ? 260 : 300;
  const k = H / total;
  // 見出しの行（柱の名前）と額の行を分けて、その下から箱を積む（文字「大」・狭い幅でも重ならない）
  const top = fs * 4.1;
  const base = top + H;
  const mid = nar ? 26 : 56;
  const colW = nar ? (W - mid) / 2 : Math.min(220, (W - mid) / 2);
  const off = nar ? 0 : Math.max(0, (W - (colW * 2 + mid)) / 2);
  const xL = off;
  const xR = xL + colW + mid;
  const GAP = 2;
  const pad = 8;
  const figTip = useFigTip({ pinTap: true });
  const hidden: { name: string; val: Yen; fill: string; line: string | null }[] = [];
  const els: JSX.Element[] = [];
  let key = 0;
  const label = (x: number, y0: number, h: number, name: string, val: Yen, ink: string, fill: string, line: string | null) => {
    if (val <= 0) return;
    const cy = y0 + h / 2;
    const nW = tw(name, fs * 0.8);
    const aW = tw(group(Math.round(val / 10000)), fs * 0.8);
    if (!nar && h >= fs * 1.1 && nW + aW + pad * 3 <= colW) {
      els.push(
        <text key={key++} x={x + pad} y={cy} font-size={fs * 0.8} font-weight="700" fill={ink} dominant-baseline="central" pointer-events="none">
          {name}
        </text>,
        <text key={key++} x={x + colW - pad} y={cy} font-size={fs * 0.8} font-weight="700" fill={ink} dominant-baseline="central" text-anchor="end" class="num" pointer-events="none">
          {man(val)}
        </text>,
      );
      return;
    }
    if (h >= fs * 2.3 && nW * 0.92 + pad * 2 <= colW) {
      els.push(
        <text key={key++} x={x + pad} y={cy - fs * 0.55} font-size={fs * 0.74} font-weight="700" fill={ink} dominant-baseline="central" pointer-events="none">
          {name}
        </text>,
        <g key={key++} pointer-events="none">
          <Amount x={x + pad} y={cy + fs * 0.6} v={val} fs={fs * 0.95} fill={ink} />
        </g>,
      );
      return;
    }
    if (h >= fs * 1.05 && tw(`${name} ${man(val)}`, fs * 0.72) + pad * 2 <= colW) {
      els.push(
        <text key={key++} x={x + pad} y={cy} font-size={fs * 0.72} font-weight="700" fill={ink} dominant-baseline="central" pointer-events="none">
          {name}
        </text>,
        <text key={key++} x={x + colW - pad} y={cy} font-size={fs * 0.72} font-weight="700" fill={ink} dominant-baseline="central" text-anchor="end" class="num" pointer-events="none">
          {man(val)}
        </text>,
      );
      return;
    }
    hidden.push({ name, val, fill, line });
  };
  /** 薄い箱は、カーソルを合わせやすいよう、見えない当たりの帯（HIT の高さ）を最後に重ねる */
  const HIT = 9;
  const hits: JSX.Element[] = [];
  /** 箱（札つき。フォーカスでき、押すと札を固定する） */
  const box = (d: FigTipData, body: JSX.Element, at?: { x: number; y: number; h: number }) => {
    if (at !== undefined && at.h < HIT) hits.push(<rect key={`h${key++}`} class="m3-hit" x={at.x} y={at.y + at.h / 2 - HIT / 2} width={colW} height={HIT} fill="transparent" {...figTip.hover(d)} />);
    return (
      <g key={key++} class="m3-box" tabIndex={0} role="button" aria-label={`${d.title} ${man(d.amount)}万円${d.note !== undefined ? `。${d.note}` : ""}`} data-m3-fig-box={d.key} {...figTip.hover(d)} {...figTip.focus(d)}>
        {body}
      </g>
    );
  };

  // 見出し（1行目＝柱の名前、2行目＝合計の額。柱の幅に入らなければ文字を小さくする）
  const hdr = (cx: number, t: string, val: Yen) => {
    const tf = Math.min(fs * 0.8, (colW - 4) / Math.max(1, tw(t, 1)));
    const af0 = fs * (nar ? 1.2 : 1.35);
    const af = Math.min(af0, (colW - 4) / Math.max(1, tw(man(val), 1) + 0.55 * 2));
    return (
      <g key={key++} data-m3-head>
        <text x={cx} y={fs * 0.95} font-size={tf} font-weight="700" fill="var(--ink-2)" text-anchor="middle">
          {t}
        </text>
        <Amount x={cx} y={fs * 1.55 + af * 0.55} v={val} fs={af} anchor="middle" />
      </g>
    );
  };
  els.push(hdr(xL + colW / 2, "いつ使うお金か", s.amount + v.amount + g.amount));
  els.push(hdr(xR + colW / 2, "今どこにあるか", model.place.total));

  // 左: 上から 使う・貯める・増やす（札は右の列の側に出す）
  let y = top;
  model.boxes.forEach((b, i) => {
    const h = b.amount * k;
    if (h > 0.3) {
      els.push(
        box(
          { key: b.key, title: b.name, amount: b.amount, ...tipBody(b), swatch: `var(--m3-${KC[i]}-line)`, x: xL + colW + 6, y: y + h / 2, side: "r" },
          <rect x={xL + 0.75} y={y + GAP / 2 + 0.75} width={Math.max(0, colW - 1.5)} height={Math.max(0, h - GAP - 1.5)} rx="4" fill={`var(--m3-${KC[i]})`} stroke={`var(--m3-${KC[i]}-line)`} stroke-width="1.5" />,
          { x: xL, y, h },
        ),
      );
      label(xL, y, h - GAP, b.name, b.amount, "var(--ink)", `var(--m3-${KC[i]})`, `var(--m3-${KC[i]}-line)`);
    }
    y += h;
  });

  // 右: 置き場所（札は左の列の側に出す）
  const yF = top + model.place.total * k;
  y = top;
  for (const l of model.place.lines) {
    const h = l.amount * k;
    if (h > 0.3) {
      const fill = placeColor(l.key, l.group);
      const note = l.liquid ? (l.key === "pooledCash" ? "運用しない分は預金などに数えます" : `${PLACE_GROUP.liquid}（預金など）`) : PLACE_GROUP[l.group];
      els.push(box({ key: `p.${l.key}`, title: l.label, amount: l.amount, ...(note !== undefined ? { note } : {}), swatch: fill, x: xR - 6, y: y + h / 2, side: "l" }, <rect x={xR} y={y + GAP / 2} width={colW} height={Math.max(0, h - GAP)} rx="4" fill={fill} />, { x: xR, y, h }));
      label(xR, y, h - GAP, l.label, l.amount, "#fff", fill, null);
    }
    y += h;
  }
  // 金融資産の合計でも届かない分（右の列の下に点線の空箱）
  if (model.overFinancial > 0) {
    const h = model.overFinancial * k;
    els.push(
      box(
        { key: "over", title: "金融資産で足りない分", amount: model.overFinancial, note: `「${model.names[0]}」と「${model.names[1]}」の分に、金融資産の合計でも届かない分`, x: xR - 6, y: yF + h / 2, side: "l" },
        <rect x={xR + 0.75} y={yF + GAP / 2 + 0.75} width={colW - 1.5} height={Math.max(0, h - GAP - 1.5)} rx="4" fill="#fff" stroke="var(--ink-2)" stroke-width="1.5" stroke-dasharray="5 3" />,
      ),
    );
    if (h > fs * 1.2)
      els.push(
        <text key={key++} x={xR + colW / 2} y={yF + h / 2} font-size={fs * 0.72} font-weight="700" fill="var(--ink-2)" text-anchor="middle" dominant-baseline="central" pointer-events="none">
          金融資産で足りない分
        </text>,
      );
  }
  els.push(<line key={key++} x1={xL - 4} y1={base + 0.5} x2={xR + colW + 4} y2={base + 0.5} stroke="#9aa3ae" />, ...hits);

  // 入りきらない箱の名前と金額は、持ち帰り用のレポートだけ図の下に一覧で（画面では札で見る）
  let hh = Math.max(base, yF + model.overFinancial * k) + 8;
  if (list && hidden.length > 0) {
    let yy = hh + fs * 0.9;
    const cols = nar ? 1 : 2;
    const colw = nar ? W : Math.max(fs * 12, (colW * 2 + mid) / 2);
    const x0 = nar ? 0 : xL;
    hidden.forEach((it, i) => {
      const x = x0 + (i % cols) * colw;
      els.push(
        <rect key={key++} x={x} y={yy - fs * 0.42} width={fs * 0.84} height={fs * 0.84} rx="2" fill={it.fill} {...(it.line !== null ? { stroke: it.line, "stroke-width": 1.2 } : {})} />,
        <text key={key++} x={x + fs * 1.2} y={yy} font-size={fs * 0.78} font-weight="700" fill="var(--ink-2)" dominant-baseline="central">
          {it.name}
        </text>,
        <Amount key={key++} x={x + colw - (nar ? 2 : fs * 0.8)} y={yy} v={it.val} fs={fs * 0.86} anchor="end" />,
      );
      if (i % cols === cols - 1 || i === hidden.length - 1) yy += fs * 1.5;
    });
    hh = yy;
  }
  const [n0, n1, n2] = model.names;
  const aria = `いつ使うお金か: ${n0}${mn(s.amount)}、${n1}${mn(v.amount)}、${n2}${mn(g.amount)}。今どこにあるか: ${model.place.lines.map((l) => `${l.label}${mn(l.amount)}`).join("、")}`;
  const HH = Math.ceil(hh);
  return (
    <div class="m3-fig" ref={(el) => {
      ref.current = el;
      figTip.wrap.current = el;
    }}>
      <svg viewBox={`0 0 ${Math.round(W)} ${HH}`} width={Math.round(W)} height={HH} role="group" aria-label={aria}>
        {els}
      </svg>
      {figTip.tip !== null ? <FigTip d={figTip.tip} W={Math.round(W)} H={HH} pinned={figTip.pinned} /> : null}
    </div>
  );
}

/** 何か月・何年の欄（− と ＋ と数） */
function Stepper({ value, min, max, label, onChange, attr }: { value: number; min: number; max: number; label: string; onChange: (v: number) => void; attr: string }) {
  const set = (n: number) => {
    if (!Number.isFinite(n)) return;
    const c = Math.min(max, Math.max(min, Math.round(n)));
    if (c !== value) onChange(c);
  };
  return (
    <span class="m3-stp" data-m3-step={attr}>
      <button type="button" aria-label={`${label}を1減らす`} disabled={value <= min} onClick={() => set(value - 1)}>
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={(e) => set(Number((e.currentTarget as HTMLInputElement).value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") set(Number((e.currentTarget as HTMLInputElement).value));
        }}
      />
      <button type="button" aria-label={`${label}を1増やす`} disabled={value >= max} onClick={() => set(value + 1)}>
        ＋
      </button>
    </span>
  );
}

/** 中身の一覧（3枚とも同じ形） */
export function BoxList({ box }: { box: MoneyThreeBox }) {
  // 先頭の文字（年・符号）が1つも無い一覧は、その列を詰める（狭い幅で読みやすく）
  const noLead = box.items.every((it) => it.lead === "");
  return (
    <>
      {box.items.length > 0 || box.rest !== null ? (
        <ul class={`m3-items${noLead ? " nolead" : ""}`} data-m3-items={box.key}>
          {box.items.map((it, i) => (
            <li key={i}>
              {noLead ? null : <span class="m3-lead num">{it.lead}</span>}
              <span class="m3-lab">{it.label}</span>
              <span class="m3-amt num">
                {it.per}
                {man(it.amount)}
                <small>万円</small>
              </span>
            </li>
          ))}
          {box.rest !== null ? (
            <li class="m3-rest">
              {noLead ? null : <span class="m3-lead" />}
              <span class="m3-lab">ほか{box.rest.count}件</span>
              <span class="m3-amt num">
                {man(box.rest.amount)}
                <small>万円</small>
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}
      {box.note !== null ? <p class="m3-note">{box.note}</p> : null}
    </>
  );
}

/** 貯めるお金の全部の表 */
export function SaveTable({ model }: { model: MoneyThreeModel }) {
  const v = model.boxes[1];
  if (model.table.length === 0) return <p class="m3-note">この期間に、できごとの支出はありません。</p>;
  return (
    <>
      <table class="m3-evt">
        <thead>
          <tr>
            <th>年</th>
            <th>できごと</th>
            <th class="r">支出</th>
            <th class="r">収入の残り</th>
            <th class="r">賄えない分</th>
          </tr>
        </thead>
        <tbody>
          {model.table.map((r) => (
            <tr key={r.year}>
              <td class="num">{r.year}</td>
              <td>{r.label}</td>
              <td class="r">{man(r.expense)}</td>
              <td class="r">{man(r.leftover)}</td>
              <td class={`r${r.uncovered > 0 ? "" : " z"}`}>{man(r.uncovered)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4}>合計（万円）</td>
            <td class="r">{man(v.amount)}</td>
          </tr>
        </tfoot>
      </table>
      <p class="m3-note">収入の残り＝その年の手取り収入から、ふだんの支出（基本生活費・住まい・保険料など毎年続く支出）を引いた額。できごとの支出がそれより小さい年は 0 です。</p>
    </>
  );
}

/** 貯めるお金の小窓の中身: 見出し（名前・額・閉じる）と、中身の一文と、全部の年の表（賄えない分が 0 の年も・合計の行・収入の残りの説明つき） */
export function SavePopBody({ model, onClose }: { model: MoneyThreeModel; onClose?: () => void }) {
  const v = model.boxes[1];
  return (
    <>
      <div class="m3-pop-h">
        <i class="m3-sw k2" aria-hidden="true" />
        <b>{v.name}の内訳</b>
        <span class="m3-am num">
          {man(v.amount)}
          <small>万円</small>
        </span>
        {onClose !== undefined ? (
          <button type="button" class="x" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        ) : null}
      </div>
      <div class="m3-pop-b" data-m3-table>
        <p class="m3-note">{v.formula}</p>
        <SaveTable model={model} />
      </div>
    </>
  );
}

/**
 * 貯めるお金の「内訳を見る」と小窓（カードの横に重ねて出す。外を押す・Esc・× で閉じる）。小窓には全部の年の表を最初から出す。
 * 開いたら小窓が見える所までスクロールする（小窓の高さは画面の高さまで。行が多いときは小窓の中だけ縦にスクロール）
 */
function SavePop({ model }: { model: MoneyThreeModel }) {
  const v = model.boxes[1];
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    pop.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(wrap.current?.contains(e.target as Node) ?? false)) {
        setOpen(false);
        if (e instanceof KeyboardEvent) btn.current?.focus();
      }
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div class="m3-popwrap" ref={wrap}>
      <button type="button" class="link-btn m3-open" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)} ref={btn} data-m3-save-open>
        内訳を見る
        <PopIcon />
      </button>
      {open ? (
        <div class="m3-pop" role="dialog" aria-label={`${v.name}の内訳`} ref={pop} data-m3-save-pop>
          <SavePopBody model={model} onClose={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * 3枚のカード（使う・貯める・増やす）。edit があれば何か月分・何年先までの欄を出す。
 * 貯めるお金の全部の年の表は、どちらも「内訳を見る」の小窓で見る。savePop（画面）は貯めるお金の一覧を最初は出さず件数だけにする
 * （持ち帰り用のレポートは一覧も出したまま）
 */
export function MoneyThreeCards({ model, edit, savePop = false }: { model: MoneyThreeModel; edit?: (s: Partial<MoneyThreeSettings>) => void; savePop?: boolean }) {
  const [s, v, g] = model.boxes;
  // 賄えない分のある年の数（一覧の行とまとめた行）
  const saveCount = v.items.length + (v.rest?.count ?? 0);
  const sw = (i: number) => <i class={`m3-sw k${i + 1}`} aria-hidden="true" />;
  const am = (b: MoneyThreeBox) => (
    <span class="m3-am num">
      {man(b.amount)}
      <small>万円</small>
    </span>
  );
  return (
    <div class="m3-cards">
      <div class="m3-card" data-m3-box="spend">
        {sw(0)}
        <span class="m3-nm">{s.name}</span>
        {am(s)}
        <div class="m3-how">
          {edit !== undefined ? (
            <>
              ふだんの支出 月{mn(model.spendMonthly)} ×
              <Stepper value={model.settings.months} min={model.limits.months[0]} max={model.limits.months[1]} label="何か月分" attr="months" onChange={(n) => edit({ months: n })} />
              か月
            </>
          ) : (
            s.formula
          )}
        </div>
        <div class="m3-body-in">
          <BoxList box={s} />
        </div>
      </div>
      <div class="m3-card" data-m3-box="save">
        {sw(1)}
        <span class="m3-nm">{v.name}</span>
        {am(v)}
        <div class="m3-how">
          {edit !== undefined ? (
            <>
              今後
              <Stepper value={model.settings.years} min={model.limits.years[0]} max={model.limits.years[1]} label="何年先まで" attr="years" onChange={(n) => edit({ years: n })} />
              {savePop ? <span data-m3-save-count>年（{model.range}）の できごと {saveCount}件</span> : `年（${model.range}）のできごとの支出のうち、その年の収入で賄えない分の合計`}
            </>
          ) : savePop ? (
            <span data-m3-save-count>
              今後{model.settings.years}年（{model.range}）の できごと {saveCount}件
            </span>
          ) : (
            v.formula
          )}
          {model.clipped !== null ? <span class="m3-clip">{model.clipped}</span> : null}
        </div>
        <div class="m3-body-in">
          {savePop ? null : <BoxList box={v} />}
          <SavePop model={model} />
        </div>
      </div>
      <div class="m3-card" data-m3-box="grow">
        {sw(2)}
        <span class="m3-nm">{g.name}</span>
        {am(g)}
        <div class="m3-how">{g.formula}</div>
        <div class="m3-body-in">
          <BoxList box={g} />
        </div>
      </div>
    </div>
  );
}

/** 区画の上の文 */
export function MoneyThreeSay({ model, eq = true }: { model: MoneyThreeModel; eq?: boolean }) {
  return (
    <div class="m3-say" data-m3-say={model.status}>
      <p class="s1">
        <Parts parts={model.say.head} />
      </p>
      {model.say.sub.length > 0 ? (
        <p class="s2">
          <Parts parts={model.say.sub} />
        </p>
      ) : null}
      {eq && model.say.eq !== null ? <p class="eq num">{model.say.eq}</p> : null}
    </div>
  );
}

/** 資産と負債のタブの区画（主の置き場所）。flash が変わったら区画へ移って光らせる */
export function MoneyThreeSection({ model, onSettings, flash = 0 }: { model: MoneyThreeModel; onSettings: (s: Partial<MoneyThreeSettings>) => void; flash?: number }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (flash === 0 || ref.current === null) return;
    const el = ref.current;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  }, [flash]);
  return (
    <section class="card m3" id="money-three" aria-labelledby="h-m3" ref={ref} data-money-three>
      <div class="m3-hd">
        <h2 id="h-m3">お金の3つの分け方</h2>
        <span class="bs-kind f">今の時点（{model.year}年）</span>
        <span class="m3-memo">説明用の図です。キャッシュフロー表・結果の計算には混ぜません</span>
      </div>
      <MoneyThreeSay model={model} />
      <div class="m3-grid">
        <div>
          <MoneyThreeFigure model={model} />
        </div>
        <MoneyThreeCards model={model} edit={onSettings} savePop />
      </div>
    </section>
  );
}

/** 結果のタブの一行の知らせ（ほぼ同じのときは出さない） */
export function MoneyThreeNotice({ model, onGo }: { model: MoneyThreeModel; onGo: () => void }) {
  if (model.notice === null) return null;
  return (
    <div class="m3-notice" data-m3-notice>
      <span class="ic" aria-hidden="true">
        i
      </span>
      <span class="tx">
        <Parts parts={model.notice} />
        <span class="when">（今の時点・お金の3つの分け方）</span>
      </span>
      <button type="button" class="go" onClick={onGo} data-m3-go>
        資産と負債で見る →
      </button>
    </div>
  );
}
