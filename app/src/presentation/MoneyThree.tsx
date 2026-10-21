// お金の3つの分け方（説明用の図。0032。提示層の部品）。受け取るのは MoneyThreeModel だけ（0016 の2）。
// - 資産と負債のタブの区画（何か月分・何年先までの欄つき）・持ち帰り用のレポートの1ページ（欄なし。FP が決めた値を文で書く）で同じ部品を使う。
// - 図: 左＝使う時期で分けた3つの箱（上ほどすぐ使う。薄い色＋同じ色相の枠）、右＝今の置き場所（資産と負債のタブと同じ色のベタ塗り）。左右は同じ縮尺。
//   左の「使う＋貯める」の下端を右の列まで点線でのばし、ずれている分に斜線と点線の枠と札を付ける。
// - 箱の横の3枚のカードは同じ形: 名前と額 → 中身の一文 → いつも見える中身の一覧 → まとめ（ほか○件）→ ひと言。貯めるお金の全部の表は「内訳を見る」で開く
import type { JSX } from "preact";
import { useEffect, useId, useRef } from "preact/hooks";
import { useBoxSize } from "./BsFigure.tsx";
import { group, man } from "./format.ts";
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

/** 図（左右の2列。幅に合わせて描き直す） */
export function MoneyThreeFigure({ model }: { model: MoneyThreeModel }) {
  const { ref, w: W, fs } = useBoxSize<HTMLDivElement>(560);
  const nar = W < 560;
  const [s, v, g] = model.boxes;
  const total = Math.max(model.place.total, model.need, 1);
  const H = nar ? 260 : 300;
  const k = H / total;
  const top = fs * 3.5;
  const base = top + H;
  const mid = nar ? 26 : 56;
  const calW = nar ? 0 : fs * 11.5;
  const colW = nar ? (W - mid) / 2 : Math.min(220, (W - mid - calW) / 2);
  const off = nar ? 0 : Math.max(0, (W - (colW * 2 + mid + calW)) / 2);
  const xL = off;
  const xR = xL + colW + mid;
  const GAP = 2;
  const pad = 8;
  const hidden: { name: string; val: Yen; fill: string; line: string | null }[] = [];
  const els: JSX.Element[] = [];
  const hatch = `${useId()}-hx`;
  let key = 0;
  const label = (x: number, y0: number, h: number, name: string, val: Yen, ink: string, fill: string, line: string | null) => {
    if (val <= 0) return;
    const cy = y0 + h / 2;
    const nW = tw(name, fs * 0.8);
    const aW = tw(group(Math.round(val / 10000)), fs * 0.8);
    if (!nar && h >= fs * 1.1 && nW + aW + pad * 3 <= colW) {
      els.push(
        <text key={key++} x={x + pad} y={cy} font-size={fs * 0.8} font-weight="700" fill={ink} dominant-baseline="central">
          {name}
        </text>,
        <text key={key++} x={x + colW - pad} y={cy} font-size={fs * 0.8} font-weight="700" fill={ink} dominant-baseline="central" text-anchor="end" class="num">
          {man(val)}
        </text>,
      );
      return;
    }
    if (h >= fs * 2.3 && nW * 0.92 + pad * 2 <= colW) {
      els.push(
        <text key={key++} x={x + pad} y={cy - fs * 0.55} font-size={fs * 0.74} font-weight="700" fill={ink} dominant-baseline="central">
          {name}
        </text>,
        <Amount key={key++} x={x + pad} y={cy + fs * 0.6} v={val} fs={fs * 0.95} fill={ink} />,
      );
      return;
    }
    if (h >= fs * 1.05 && tw(`${name} ${man(val)}`, fs * 0.72) + pad * 2 <= colW) {
      els.push(
        <text key={key++} x={x + pad} y={cy} font-size={fs * 0.72} font-weight="700" fill={ink} dominant-baseline="central">
          {name}
        </text>,
        <text key={key++} x={x + colW - pad} y={cy} font-size={fs * 0.72} font-weight="700" fill={ink} dominant-baseline="central" text-anchor="end" class="num">
          {man(val)}
        </text>,
      );
      return;
    }
    hidden.push({ name, val, fill, line });
  };

  // 見出し
  const hdr = (cx: number, t: string, val: Yen) => (
    <g key={key++}>
      <text x={cx} y={fs * 0.75} font-size={fs * 0.8} font-weight="700" fill="var(--ink-2)" text-anchor="middle" dominant-baseline="central">
        {t}
      </text>
      <Amount x={cx} y={fs * 2.15} v={val} fs={fs * (nar ? 1.2 : 1.35)} anchor="middle" />
    </g>
  );
  els.push(hdr(xL + colW / 2, nar ? "使う時期で分けると" : "使う時期で分けると（説明用）", s.amount + v.amount + g.amount));
  els.push(hdr(xR + colW / 2, nar ? "今の置き場所" : "今の置き場所（入力した値）", model.place.total));

  // 左: 上から 使う・貯める・増やす
  let y = top;
  model.boxes.forEach((b, i) => {
    const h = b.amount * k;
    if (h > 0.3) {
      els.push(<rect key={key++} x={xL + 0.75} y={y + GAP / 2 + 0.75} width={Math.max(0, colW - 1.5)} height={Math.max(0, h - GAP - 1.5)} rx="4" fill={`var(--m3-${KC[i]})`} stroke={`var(--m3-${KC[i]}-line)`} stroke-width="1.5" />);
      label(xL, y, h - GAP, b.name, b.amount, "var(--ink)", `var(--m3-${KC[i]})`, `var(--m3-${KC[i]}-line)`);
    }
    y += h;
  });

  // 差の部分（右の列）
  const yNeed = top + model.need * k;
  const yLiq = top + model.place.liquid * k;
  const yF = top + model.place.total * k;
  const showGap = model.status !== "even";
  const hz1 = showGap ? Math.min(yNeed, yLiq) : 0;
  const hz2 = showGap ? Math.max(yNeed, yLiq) : 0;

  // 右: 置き場所
  y = top;
  for (const l of model.place.lines) {
    const h = l.amount * k;
    if (h > 0.3) {
      const fill = placeColor(l.key, l.group);
      els.push(<rect key={key++} x={xR} y={y + GAP / 2} width={colW} height={Math.max(0, h - GAP)} rx="4" fill={fill} />);
      // 斜線の上に名前が重ならないよう、斜線の外の広い方に置く
      const e = y + h;
      const overlap = showGap && hz2 > y && hz1 < e;
      const up: [number, number] = [y, Math.min(e, hz1)];
      const dn: [number, number] = [Math.max(y, hz2), e];
      const part = up[1] - up[0] >= dn[1] - dn[0] ? up : dn;
      if (overlap && part[1] - part[0] >= fs * 1.5) label(xR, part[0] + 2, part[1] - part[0] - 4, l.label, l.amount, "#fff", fill, null);
      else label(xR, y, h - GAP, l.label, l.amount, "#fff", fill, null);
    }
    y += h;
  }
  // 金融資産の合計でも届かない分（右の列の下に点線の空箱）
  if (model.overFinancial > 0) {
    const h = model.overFinancial * k;
    els.push(<rect key={key++} x={xR + 0.75} y={yF + GAP / 2 + 0.75} width={colW - 1.5} height={Math.max(0, h - GAP - 1.5)} rx="4" fill="#fff" stroke="var(--ink-2)" stroke-width="1.5" stroke-dasharray="5 3" />);
    if (h > fs * 1.2)
      els.push(
        <text key={key++} x={xR + colW / 2} y={yF + h / 2} font-size={fs * 0.72} font-weight="700" fill="var(--ink-2)" text-anchor="middle" dominant-baseline="central">
          金融資産で足りない分
        </text>,
      );
  }
  // 境目: 左の「使う＋貯める」の下端を右の列まで点線で
  els.push(<line key={key++} x1={xL + colW + 3} y1={yNeed} x2={xR - 3} y2={yNeed} stroke="var(--ink-2)" stroke-width="1.5" stroke-dasharray="4 3" />);
  els.push(<circle key={key++} cx={xL + colW + 3} cy={yNeed} r="2.6" fill="var(--ink-2)" />);

  let callout: { y1: number; y2: number; t1: string; v: Yen; t3: string[] } | null = null;
  if (showGap) {
    const y2 = Math.min(hz2, yF);
    if (y2 - hz1 > 0.5) els.push(<rect key={key++} x={xR} y={hz1} width={colW} height={y2 - hz1} fill={`url(#${hatch})`} />);
    els.push(<rect key={key++} x={xR - 3} y={hz1 - 3} width={colW + 6} height={hz2 - hz1 + 6} rx="6" fill="none" stroke="var(--ink)" stroke-width="2" stroke-dasharray="6 3" />);
    const [n0, n1, n2] = model.names;
    callout =
      model.status === "over"
        ? { y1: hz1, y2: hz2, t1: `${model.place.liquidName}のまま`, v: model.gap, t3: [`「${n2}」の分`] }
        : { y1: hz1, y2: hz2, t1: `${model.place.liquidName}で足りない分`, v: -model.gap, t3: [`「${n0}」と`, `「${n1}」の分`] };
    if (!nar) {
      const x = xR + colW + 10;
      const cy = (callout.y1 + callout.y2) / 2;
      els.push(<path key={key++} d={`M${x} ${callout.y1}h6V${callout.y2}h-6M${x + 6} ${cy}h8`} fill="none" stroke="var(--ink)" stroke-width="1.5" />);
      const lx = x + 18;
      const h0 = cy - (fs * 1.0 + fs * 1.5 + callout.t3.length * fs * 1.05) / 2;
      els.push(
        <text key={key++} x={lx} y={h0 + fs * 0.5} font-size={fs * 0.84} font-weight="700" fill="var(--ink)" dominant-baseline="central">
          {callout.t1}
        </text>,
        <Amount key={key++} x={lx} y={h0 + fs * 1.75} v={callout.v} fs={fs * 1.35} fill="var(--prop-ink)" />,
        ...callout.t3.map((t, i) => (
          <text key={key++} x={lx} y={h0 + fs * 2.95 + i * fs * 1.05} font-size={fs * 0.74} fill="var(--ink-2)" dominant-baseline="central">
            {t}
          </text>
        )),
      );
    }
  }
  els.push(<line key={key++} x1={xL - 4} y1={base + 0.5} x2={xR + colW + 4} y2={base + 0.5} stroke="#9aa3ae" />);

  // 狭い幅: 入りきらない箱の名前と、差の札を図の下に
  let hh = Math.max(base, yF + model.overFinancial * k) + 8;
  // 入りきらない箱の名前は図の下に一覧で（広い幅でも）
  if (!nar && hidden.length > 0) {
    let yy = hh + fs * 0.9;
    const colw = Math.max(fs * 12, (colW * 2 + mid) / 2);
    hidden.forEach((it, i) => {
      const x = xL + (i % 2) * colw;
      els.push(
        <rect key={key++} x={x} y={yy - fs * 0.42} width={fs * 0.84} height={fs * 0.84} rx="2" fill={it.fill} {...(it.line !== null ? { stroke: it.line, "stroke-width": 1.2 } : {})} />,
        <text key={key++} x={x + fs * 1.2} y={yy} font-size={fs * 0.78} font-weight="700" fill="var(--ink-2)" dominant-baseline="central">
          {it.name}
        </text>,
        <Amount key={key++} x={x + colw - fs * 0.8} y={yy} v={it.val} fs={fs * 0.86} anchor="end" />,
      );
      if (i % 2 === 1 || i === hidden.length - 1) yy += fs * 1.5;
    });
    hh = yy;
  }
  if (nar) {
    let yy = hh + fs * 0.9;
    const rowH = fs * 1.5;
    for (const it of hidden) {
      els.push(
        <rect key={key++} x="0" y={yy - fs * 0.42} width={fs * 0.84} height={fs * 0.84} rx="2" fill={it.fill} {...(it.line !== null ? { stroke: it.line, "stroke-width": 1.2 } : {})} />,
        <text key={key++} x={fs * 1.3} y={yy} font-size={fs * 0.78} font-weight="700" fill="var(--ink-2)" dominant-baseline="central">
          {it.name}
        </text>,
        <Amount key={key++} x={W - 2} y={yy} v={it.val} fs={fs * 0.86} anchor="end" />,
      );
      yy += rowH;
    }
    if (callout !== null) {
      els.push(
        <rect key={key++} x="0" y={yy - fs * 0.5} width={fs * 0.84} height={fs} fill={model.status === "over" ? "var(--bs-deposit)" : "var(--bs-nisa)"} />,
        <rect key={key++} x="0" y={yy - fs * 0.5} width={fs * 0.84} height={fs} fill={`url(#${hatch})`} />,
        <rect key={key++} x="-2" y={yy - fs * 0.5 - 2} width={fs * 0.84 + 4} height={fs + 4} rx="3" fill="none" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="3 2" />,
        <text key={key++} x={fs * 1.3} y={yy} font-size={fs * 0.78} font-weight="700" fill="var(--ink)" dominant-baseline="central">
          {callout.t1}
        </text>,
        <Amount key={key++} x={W - 2} y={yy} v={callout.v} fs={fs * 1.05} anchor="end" fill="var(--prop-ink)" />,
      );
      yy += fs * 1.25;
      els.push(
        <text key={key++} x={fs * 1.3} y={yy} font-size={fs * 0.7} fill="var(--ink-2)" dominant-baseline="central">
          {callout.t3.join("")}
        </text>,
      );
      yy += rowH * 0.8;
    }
    hh = yy;
  }
  const [n0, n1, n2] = model.names;
  const aria = `${n0}${mn(s.amount)}、${n1}${mn(v.amount)}、${n2}${mn(g.amount)}。今の置き場所は${model.place.lines.map((l) => `${l.label}${mn(l.amount)}`).join("、")}`;
  return (
    <div class="m3-fig" ref={ref}>
      <svg viewBox={`0 0 ${Math.round(W)} ${Math.ceil(hh)}`} width={Math.round(W)} height={Math.ceil(hh)} role="img" aria-label={aria}>
        <defs>
          <pattern id={hatch} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <rect width="2.6" height="6" fill="rgba(255,255,255,.55)" />
          </pattern>
        </defs>
        {els}
      </svg>
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

/** 3枚のカード（使う・貯める・増やす）。edit があれば何か月分・何年先までの欄を出す */
export function MoneyThreeCards({ model, edit }: { model: MoneyThreeModel; edit?: (s: Partial<MoneyThreeSettings>) => void }) {
  const [s, v, g] = model.boxes;
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
              年（{model.range}）のできごとの支出のうち、その年の収入で賄えない分の合計
            </>
          ) : (
            v.formula
          )}
          {model.clipped !== null ? <span class="m3-clip">{model.clipped}</span> : null}
        </div>
        <div class="m3-body-in">
          <BoxList box={v} />
          {model.table.length > 0 ? (
            <details class="m3-more" data-m3-table>
              <summary>内訳を見る（全部の年の表）</summary>
              <SaveTable model={model} />
            </details>
          ) : null}
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

/** 凡例 */
export function MoneyThreeLegend({ model }: { model: MoneyThreeModel }) {
  return (
    <div class="m3-legend">
      <span>
        <i class="plan" />
        左＝ライフプランから出した分け方（説明用）
      </span>
      <span>
        <i class="fact" />
        右＝今の置き場所（入力した値）
      </span>
      {model.status !== "even" ? (
        <span>
          <i class="hx" />
          分け方と置き場所がずれている分
        </span>
      ) : null}
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
          <MoneyThreeLegend model={model} />
        </div>
        <MoneyThreeCards model={model} edit={onSettings} />
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
