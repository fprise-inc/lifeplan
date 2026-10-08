// 0005 の3: 計算用の実行環境を固める。エンジンを読み込む前に1回だけ流す
(function () {
  "use strict";
  const g = globalThis;
  const defineProperty = Object.defineProperty;
  const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  const getPrototypeOf = Object.getPrototypeOf;
  const ownKeys = Reflect.ownKeys;
  const freeze = Object.freeze;
  const hasOwn = Object.prototype.hasOwnProperty;
  const TypeErrorCtor = TypeError;

  const disabled = (name) =>
    function () {
      throw new TypeErrorCtor(name + " is disabled (0005)");
    };

  // 2. 計算に要らない組み込みを消す（Date は最初から入れていない）
  for (const name of ["eval", "SharedArrayBuffer", "Atomics", "WeakRef", "FinalizationRegistry", "WebAssembly", "performance", "navigator"]) {
    delete g[name];
  }

  // 実行時にコードを作れないようにする（Function・GeneratorFunction などのコンストラクタ）
  const fnProtos = [
    Function.prototype,
    getPrototypeOf(function* () {}),
    getPrototypeOf(async function () {}),
    getPrototypeOf(async function* () {}),
  ];
  const tamedFunction = disabled("Function constructor");
  tamedFunction.prototype = Function.prototype;
  for (const p of fnProtos) {
    // configurable のままにして、下の override mistake の対策と凍結に任せる
    defineProperty(p, "constructor", { value: disabled("Function constructor"), writable: false, enumerable: false, configurable: true });
  }
  defineProperty(Function.prototype, "constructor", { value: tamedFunction, writable: false, enumerable: false, configurable: true });
  defineProperty(g, "Function", { value: tamedFunction, writable: false, enumerable: false, configurable: true });

  // 3・4. 乱数と、結果がエンジンやOSで変わる Math の関数は、呼ぶとエラー（0002 の4）
  for (const name of [
    "random", "pow", "exp", "expm1", "log", "log1p", "log2", "log10", "sqrt", "cbrt", "hypot",
    "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
    "round", "fround", "f16round", "sumPrecise",
  ]) {
    if (hasOwn.call(Math, name)) defineProperty(Math, name, { value: disabled("Math." + name), writable: false, enumerable: false, configurable: false });
  }

  // 5. override mistake の対策（SES と同じ方法）: よく上書きされる名前を、子への代入なら子に値を作る取得・設定関数にする
  const OVERRIDABLE = ["constructor", "toString", "valueOf", "toLocaleString", "toJSON", "name", "message"];
  const enableOverride = (obj, prop) => {
    const desc = getOwnPropertyDescriptor(obj, prop);
    if (desc === undefined || !("value" in desc) || !desc.configurable) return;
    const value = desc.value;
    const getter = function () {
      return value;
    };
    const setter = function (v) {
      if (this === obj) throw new TypeErrorCtor("Cannot assign to read only property '" + String(prop) + "'");
      if (hasOwn.call(this, prop)) this[prop] = v;
      else defineProperty(this, prop, { value: v, writable: true, enumerable: true, configurable: true });
    };
    defineProperty(obj, prop, { get: getter, set: setter, enumerable: desc.enumerable, configurable: false });
  };

  // 凍結する根（グローバルにある組み込みと、名前のない組み込み）
  const roots = [];
  for (const name of ownKeys(g)) {
    const d = getOwnPropertyDescriptor(g, name);
    if (d !== undefined && "value" in d && (typeof d.value === "object" || typeof d.value === "function") && d.value !== null && d.value !== g) {
      roots.push(d.value);
      // グローバルの組み込みの名前を差し替えられないようにする
      if (d.configurable) defineProperty(g, name, { value: d.value, writable: false, enumerable: d.enumerable, configurable: false });
    }
  }
  const iterProto = (it) => getPrototypeOf(it);
  roots.push(
    ...fnProtos,
    getPrototypeOf(Int8Array),
    iterProto([][Symbol.iterator]()),
    iterProto(new Map()[Symbol.iterator]()),
    iterProto(new Set()[Symbol.iterator]()),
    iterProto(""[Symbol.iterator]()),
    iterProto("a".matchAll(/a/g)),
    getPrototypeOf(iterProto([][Symbol.iterator]())),
    getPrototypeOf(function* () {}).prototype,
    getPrototypeOf(async function* () {}).prototype,
  );

  for (const r of roots) {
    if (typeof r === "function" && r.prototype !== undefined && r.prototype !== null) {
      for (const prop of OVERRIDABLE) enableOverride(r.prototype, prop);
    }
  }
  for (const prop of OVERRIDABLE) enableOverride(Object.prototype, prop);

  // 深く凍結する（プロトタイプ・プロパティの値・取得設定関数をたどる）
  const seen = new Set();
  const stack = roots.slice();
  while (stack.length > 0) {
    const o = stack.pop();
    if ((typeof o !== "object" && typeof o !== "function") || o === null || seen.has(o) || o === g) continue;
    seen.add(o);
    freeze(o);
    stack.push(getPrototypeOf(o));
    for (const k of ownKeys(o)) {
      const d = getOwnPropertyDescriptor(o, k);
      if (d === undefined) continue;
      if ("value" in d) stack.push(d.value);
      else {
        stack.push(d.get);
        stack.push(d.set);
      }
    }
  }
})();
