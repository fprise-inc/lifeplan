// 速さの計測の JavaScript 側（Node（V8）と Bun（JavaScriptCore）で同じ手順を流す。scripts/bench.ts と scripts/jsc-bench.js から使う）。
// 0005 の追記（2026-10-09: 先出しの範囲）の目標:
//   1. スライダーを動かしている間（sliderXxx。正式の項目）: 世帯の入力（または案の前提）を1刻み動かし、今見ている案の「万一が起きない」想定の
//      1枠だけを先出し（preview）で計算する1回の時間（セッションに5案×4想定の20枠を置き、session.slide で20枠すべての要求を置き直して、
//      見ている1枠だけを計算する。画面の動きと同じ）。目標は画面側で0.1秒以内
//   2. 指を離した直後（afterRelease19）: 万一の3枠とほかの4案×4想定（19枠）を session.release で先出しで計算し直す時間。目安1秒以内
//      （正の計算は quickjs-ng 側で測る）
//   3. 必要保障額の推移（protection）: 夫婦2人の「この年に亡くなったら」の推移を求める要求1件（0005 の追記 2026-10-09。目安は正の計算で数秒）
//   （参考）前の目標の形: 見ている案の1案×4想定を先出しする1刻み（sliderSalaryFour）
// 使い方: measure(engine, packsJson, data, repeat) → { 名前: { median, min } }
//   data = { requests: [20件], sliders: { 名前: [[20件]（刻み0）, [20件]（刻み1）, …] }, protection?: 要求 }

import { performance } from "node:perf_hooks";

const now = () => performance.now();

function stat(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return { median: Math.round(s[Math.floor(s.length / 2)] * 10) / 10, min: Math.round(s[0] * 10) / 10 };
}

function time(f, repeat, warm = 2) {
  for (let i = 0; i < warm; i++) f(i - warm);
  const xs = [];
  for (let i = 0; i < repeat; i++) {
    const t = now();
    f(i);
    xs.push(now() - t);
  }
  return stat(xs);
}

/** 枠の ID（案 p・想定 s） */
const slotId = (i) => `p${Math.floor(i / 4)}/s${i % 4}`;

export function measure(engine, packsJson, data, repeat) {
  const out = {};
  const reqJson = data.requests.map((r) => JSON.stringify(r));
  // 1件（正と同じ run の入口。温まった後）
  out.single = time(() => engine.run(reqJson[0], packsJson, "{}"), repeat);
  // 必要保障額の推移（夫婦2人。正と同じ run の入口）
  if (data.protection !== undefined) {
    const p = JSON.stringify(data.protection);
    out.protection = time(() => {
      const r = engine.run(p, packsJson, "{}");
      if (r.startsWith('{"error"')) throw new Error(r.slice(0, 200));
    }, repeat, 1);
  }
  for (const [name, ticks] of Object.entries(data.sliders)) {
    const session = engine.createSession(packsJson);
    const setAll = (k) => {
      const reqs = ticks[k % ticks.length];
      const slots = {};
      reqs.forEach((r, i) => {
        slots[slotId(i)] = r;
      });
      session.set(JSON.stringify(slots));
    };
    const slotsOf = (k) => {
      const reqs = ticks[k % ticks.length];
      const slots = {};
      reqs.forEach((r, i) => {
        slots[slotId(i)] = r;
      });
      return JSON.stringify(slots);
    };
    // 始めに20枠すべてを計算しておく（画面を開いたとき）
    setAll(0);
    session.release();
    const focus = slotId(0);
    let k = 0;
    const key = `slider${name[0].toUpperCase()}${name.slice(1)}`;
    // 動かしている間（release しない。ほかの19枠は古い印のまま）の1刻み
    out[key] = time(() => {
      k++;
      const r = session.slide(slotsOf(k), focus);
      if (r.startsWith('{"error"')) throw new Error(r.slice(0, 200));
    }, repeat * 3, 3);
    if (name === "salary") {
      // （参考）前の目標の形: 見ている案の4想定を先出しする1刻み
      const visible = JSON.stringify([0, 1, 2, 3].map(slotId));
      out[`${key}Four`] = time(() => {
        k++;
        setAll(k);
        const r = session.compute(visible, '{"preview":true}');
        if (r.startsWith('{"error"')) throw new Error(r.slice(0, 200));
      }, repeat * 3, 3);
      // 指を離した直後: 古い印の付いた19枠（万一の3枠とほかの4案×4想定）を先出しで計算し直す
      const xs = [];
      for (let i = 0; i < Math.max(3, Math.ceil(repeat / 2)); i++) {
        k++;
        session.slide(slotsOf(k), focus);
        const t = now();
        const r = session.release();
        xs.push(now() - t);
        if (r.startsWith('{"error"')) throw new Error(r.slice(0, 200));
      }
      out.afterRelease19 = stat(xs);
    }
  }
  return out;
}
