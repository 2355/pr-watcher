# PR Watcher

GitHub の「自分の PR」と「自分宛てのレビュー依頼」をツールバーから確認する Chrome 拡張（Manifest V3）。

- PAT や外部サーバーは使わず、ブラウザの github.com ログインセッションだけで動く
- 取得したデータは端末内（`chrome.storage.local`）にのみ保存し、github.com 以外へは送信しない

> [!WARNING]
> GitHub 公式のツールではなく、GitHub, Inc. とは関係がありません。github.com の画面が内部で使っている非公開のエンドポイントに依存しているため、GitHub 側の変更で予告なく動かなくなることがあります。その場合はポップアップに「GitHub の仕様が変わった可能性があります」と表示されます。

## 導入

Chrome ウェブストアには公開していないため、ソースからビルドして読み込む。Node.js 24 と pnpm が必要。

```sh
git clone https://github.com/2355/pr-watcher.git
cd pr-watcher
pnpm install
pnpm build
```

1. `chrome://extensions` を開き、右上の「デベロッパー モード」を ON
2. 「パッケージ化されていない拡張機能を読み込む」で `dist/` を選ぶ
3. Chrome で github.com にログインしておく（ログインしていないとアイコンが薄く表示される）

## 権限

| 権限 | 用途 |
|---|---|
| `host_permissions: https://github.com/*` | ログイン Cookie 付きで github.com から PR 一覧・CI 状態・レビュー状態を取得するため |
| `alarms` | 設定した間隔でバックグラウンドから再取得するため |
| `idle` | 離席中・画面ロック中に取得を止め、不要なリクエストを送らないため |
| `storage` | 取得結果と設定を端末内に保存し、ポップアップを即時表示するため |

## データソース

github.com の画面が内部で使っている、非公開のエンドポイントを利用している。予告なく変わる可能性があるため、取得と解析は `src/github/` に隔離し、zod でスキーマを検証している。形式が変わった場合はエラー状態になる。

| エンドポイント | 取得する情報 |
|---|---|
| `/pulls/inbox/queries?filter=<検索クエリ>` | PR 一覧（最大 25 件） |
| `/pulls/inbox/deferred?ids[]=...` | CI 状態 |
| `/{owner}/{repo}/pull/{n}/page_data/merge_box` | レビュアーごとの approve / changes requested、再レビュー依頼 |
| `/{owner}/{repo}/issues/{n}/show_partial?partial=issues/sidebar` | commented レビュー（HTML を解析するため、失敗しても警告扱い） |

## 取得のタイミング

- ポップアップのヘッダーで設定した間隔（1〜60 分、既定 5 分）で取得する
- 30 分操作が無いとき・画面ロック中は取得しない。操作が戻った時点ですぐ 1 回取得する
- PC のスリープ中は取得しない（Chrome のアラームはスリープ中に端末を起こさない）
- GitHub から制限された（HTTP 429、または Retry-After 付きの 403）ときだけ、`Retry-After` の時間、指定が無ければ間隔を倍々に延ばして（最大 60 分）待つ。待機中はポップアップに次回の取得時刻を表示する
- ポップアップの「更新」ボタンは、上記に関係なくすぐ取得する

## ツールバーアイコン

| 位置 | 色 | 条件 | 消えるタイミング |
|---|---|---|---|
| 右上 | オレンジ | 自分宛てのレビュー依頼がある | レビューを提出して依頼リストから外れたとき |
| 右下 | 赤 | 自分の PR に changes requested / commented のレビューがある（bot と自分自身のレビューは除く） | そのレビュアーに再レビューを依頼したとき |
| 右下 | 緑 | 自分の PR が approved（赤があれば赤を優先） | マージ／クローズしたとき |

取得に失敗したとき・未ログインのときは、アイコン全体を薄く表示してドットを出さない。ポップアップを開いただけではドットは消えない。

## 開発

```sh
pnpm install
pnpm test       # fixtures が無い場合、実データに依存するテストはスキップされる
pnpm typecheck
pnpm build      # dist/ に拡張を出力
pnpm icons      # 描画処理を変えたら、manifest 用の静的アイコン（public/icons/）を再生成する
```

`test/fixtures/` は実データ（private なリポジトリ名や PR タイトルを含みうる）なので `.gitignore` 対象で、リポジトリには含めていない。fixtures が無い環境では、実データに依存するテストはスキップされる。

コードを変更したら `pnpm build` し、`chrome://extensions` で拡張カードの再読み込みボタンを押す。

## ライセンス

[MIT](LICENSE)。同梱しているサードパーティのライセンスは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照。
