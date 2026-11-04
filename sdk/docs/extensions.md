# 拡張の束（入力欄・見せ方の差し込み口・提案書の章）

拡張の束は、FP の画面に「見るもの」と提案書の章を足すための1つのフォルダです（設計記録 0114）。宣言型の入力欄（`fields/`）、値を作る計算部品（TypeScript）、提案書の章（Typst）を1つにまとめます。見本は `examples/extensions/combined-bs/`（合算BS。経営者個人と会社のバランスシート）です。

> **今のアプリが読むのは、アプリに同梱した公式の拡張だけです**（0114 の1。段1）。カスタム層の `modules/` に束を置いても、まだ読み込みません。カスタム層の束の読み込み・承認・隔離実行は β公開の後に入ります。束の形・約束はそのときも変わりません。

計算エンジンの計算そのものを変える（公式の計算部品を差し替える・差し込み口に支出の行を足す）ときの一覧と約束は `extension-points.md` にあります。

## 束のフォルダ

```
modules/<束の名前>/
  manifest.json        … 束の宣言（必須）
  index.ts             … 入口。差し込み口に載せる関数を名前つきで出す
  parts/*.ts           … 計算部品（入口から相対パスで読む）
  fields/<名前>.json    … 宣言型の入力欄（0個以上）
  reports/<名前>.typ    … 提案書の拡張の章（0個以上）
```

## manifest.json

```json
{
  "manifestVersion": "1.0",
  "id": "ext.myOffice.companyBs",
  "name": "会社と合わせたバランスシート（事務所版）",
  "version": "1.0.0",
  "author": "（作成者の表示名）",
  "license": "MIT",
  "kind": "component",
  "entry": "index.ts",
  "provides": [
    { "type": "extend", "extensionPoint": "view.balance", "contract": "1", "export": "balanceView", "label": "合算BS" },
    { "type": "extend", "extensionPoint": "report.chapter", "contract": "1", "export": "chapter",
      "chapter": { "id": "ext.myOffice.companyBs", "label": "会社と合わせたバランスシート", "typst": "reports/chapter.typ" } }
  ],
  "reads": ["balance.now"],
  "fields": ["fields/company.json"],
  "activation": { "households": "executive" }
}
```

- `id`・入力欄の `key`・章の `id` は、どれも `ext.<作成者>.<名前>`（英小文字で始まる英数字の3段）。3つの作成者はそろえます。作成者 `official` は提供元だけが使えます。公式の見本を写したら、作成者を自分の名前に変えてください。
- `provides[].export` は、`index.ts` が出す関数の名前です。差し込み口ごとに1つ。
- `reads` は、関数に渡してほしい値の名前です。今は `balance.now`（現状のプランの今の年の家計のバランスシート）だけです。自分の入力欄の値は書かなくても渡ります。書いていない値は渡りません。
- `activation.households`: `all`（既定）か `executive`（役員として働く人のいる世帯だけ）。`activation.feature`（機能を有効にするコード）は公式の拡張だけが書けます。

## 宣言型の入力欄（`fields/<名前>.json`・`extFields@1.0`）

```json
{
  "schema": "extFields@1.0",
  "key": "ext.myOffice.companyBs",
  "version": 1,
  "attachTo": "household",
  "label": "会社の数字",
  "form": { "title": "会社の数字を入れる", "note": "…", "groups": [{ "title": "会社の資産", "fields": ["amount:cash"] }] },
  "fields": [
    { "id": "amount:cash", "path": ["amounts", "cash"], "type": "yen", "label": "現預金" },
    { "id": "asOf", "path": ["asOf"], "type": "month", "label": "基準日", "placeholder": "2026-09" },
    { "id": "stage", "path": ["stage"], "type": "choice", "label": "会社の段階", "options": [{ "value": "founding", "label": "創業期" }] },
    { "id": "useRestated", "path": ["useRestated"], "type": "check", "label": "直した額で並べる" }
  ]
}
```

- 欄の種類は4つです。`yen`（円の整数で持ち、画面では万円で入れて出す。`"negative": true` のときだけマイナスも入る。上限は1兆円）、`month`（`YYYY-MM`）、`choice`（`options` の `value` のどれか。画面が先頭に「選ばない」を足す）、`check`（印）。
- 文字の読み方（全角の数字・「万」・▲・年月の書き方）は画面が決まった形で行います。束の関数は、読んだ後の値を受け取るだけです。
- 値は世帯ファイルの拡張領域 `ext["<key>"]` に、`path` のとおりの対で入ります。空欄は欄を持ちません。何も入れていなければキーごとありません。定義は `extDefinitions["<key>"]` に写ります。
- 文字は字のまま出ます（HTML・Markdown として読みません）。改行のほかの制御文字と、文字の向きを変える字は使えません。
- **既定の値は書けません**（`default`・`value` を書くと読み込めません）。既定の値は事務所の既定値の画面で変えます。
- 入力欄は、今は見るもの（下の `view.balance`）の中にだけ出ます。

## 見せ方の差し込み口

どちらも、JSON の値だけを受け取り JSON の値だけを返す、副作用の無い関数です。計算の結果・キャッシュフロー表・家計のバランスシートは変わりません。型は `@lifeplan/sdk` にあります（`ExtInput`・`HouseholdNow`・`BalanceView`・`ChapterData`）。

```ts
import type { BalanceView, ExtInput } from "@lifeplan/sdk";

export function balanceView(input: ExtInput): BalanceView {
  const values = input.values["ext.myOffice.companyBs"]; // 自分の入力欄の値（無ければ null）
  const now = input.balance?.now;                        // reads に balance.now を書いたときだけ
  // …
}
```

- **`view.balance`**（約束の版 1）: 資産と負債のタブの「見るもの」を1つ作ります。返す値は `lead`・`note`・`columns`（並べる図。列ごとに `name`・`sub`・`at`）・`steps`（段の切り替え）・`scale`（共通の縮尺）・`groups`（分け方の名前の置き換え）・`notices`・`sections`（表と文。`field` に入力欄の `id` を書くと、その欄を表の横に出す）・`form`（`open` と、欄ごとの差し込みの文 `hints`）・`empty`（図を出せないときの文）。画面が、鍵と入力欄（宣言と今の値）を足して描きます。図は家計のバランスシートと同じ部品です。
- **`report.chapter`**（約束の版 1）: 提案書の章の材料を作ります。返す値は JSON の対か `null`（材料が無い。章を載せない）。帳票の入力の `extensions["<章の id>"]` に入ります。

## 提案書の章（`reports/<名前>.typ`）

```typst
#import "@lifeplan/report-core:0.1.0": *

#let ext-chapter(cb, data) = {
  chapter("会社と合わせたバランスシート")
  // cb は report.chapter の関数が返した対。data は帳票の入力の全体
}
```

- 関数 `ext-chapter(ext-data, data)` を出します。章は、提案書の章の一覧で「提案での変更点」の後、「プランの比較」の前に並び、FP が選んで材料があるときだけ載ります。
- 読めるのは公式の帳票の部品 `@lifeplan/report-core:0.1.0` と、束の `reports/` の中のファイルだけです。金額は計算し直さず、書式（`man`・`man-unit` など）だけを当てます（`reports.md` と同じ決まり）。

## 計算部品の決まり

- 読み込めるのは、束のフォルダの中の相対パスと `@lifeplan/sdk` だけです。
- 時計（`Date`）・乱数（`Math.random`）・端末の言語設定に依る関数（`toLocaleString`・`Intl`）・`Math.pow` などの関数・`import()`・通信は使えません。金額の書式は `@lifeplan/sdk` の `man`（万円。▲つき）を使います。
- 関数は受け取った値だけから値を作ります（副作用を持たない）。

## 見本: 合算BS（`examples/extensions/combined-bs/`）

アプリに同梱した公式の拡張 `ext.official.combinedBs` と同じファイルです（機能を有効にするコードを入れた FP だけが使えます）。

| ファイル | 中身 |
|---|---|
| `manifest.json` | 2つの差し込み口・`reads` の `balance.now`・役員のいる世帯だけ |
| `fields/company.json` | 会社の試算表の主な科目・基準日・毎月の固定の支出・会社の段階・実力に直した額 |
| `parts/combinedBs.ts` | 計算（①2枚を並べる ②4つの組を相殺する ③足して1枚にする、純資産の内訳、何か月分、段階の1文、お知らせ） |
| `parts/view.ts` | 見るもの（`view.balance`） |
| `parts/chapter.ts` | 提案書の章の材料（`report.chapter`） |
| `reports/chapter.typ` | 提案書の章 |

写して自分の束にするときは、`id`・入力欄の `key`・章の `id` の作成者を自分の名前に変え、`activation.feature` を消してください。
