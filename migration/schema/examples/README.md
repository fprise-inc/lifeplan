# 読み取り規則・用語辞書の書き方の見本

`migration-rule@1.0`・`term-dictionary@1.0`（0113 の4・5。試験版）の書き方の見本。書き方の版ごとに1つずつ置き、消さない（過去の版の書き方がいつまでも読めることを、`engine/test/migration-schema.test.ts` が毎回確かめる）。

- 見出しの言葉は形を示すための汎用の言葉で、特定の製品の帳票に似せない（0113 の11・12）。
- 対応先の ID は登録簿（`registry/items.yaml`・`registry/rows.yaml`）の ID。
- 公式の汎用の規則と辞書（`migration/rules/`・`migration/dictionaries/`）は、これとは別に置く（0113 の実装の段取りの3）。
