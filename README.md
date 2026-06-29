# Ranzo Site Copier

CSS、画像、フォント、script参照をローカルに保存して、静的に開けるサイトコピーを作るツールです。

## Web UI

```bash
npm install
npm run dev
```

UIでは対象URL、出力先、巡回深度、最大ページ数を指定し、実行コマンドを生成できます。

## CLI

```bash
npm run copy -- https://example.com --output copies/example-com --depth 1 --max-pages 12 --clean
```

主な処理:

- HTML内の `link`, `script`, `img`, `source`, `video`, `audio`, `iframe`, `object`, `meta` の参照を保存
- CSS内の `url()` と `@import` をCSSファイル基準で再解決して保存
- `srcset` と `data-src` などのlazy画像属性を保存
- 取得できない画像はSVG placeholderを生成
- `ranzo-manifest.json` にページ、アセット、欠損、生成物を記録

## Options

```bash
npm run copy -- <url> [options]
```

- `--output <dir>`: 出力先
- `--depth <n>`: 同一originページの巡回深度
- `--max-pages <n>`: 保存するHTMLページ上限
- `--timeout <ms>`: リクエストタイムアウト
- `--external-pages`: 外部HTMLページも巡回
- `--no-scripts`: scriptタグを削除
- `--clean`: 出力先を削除してから実行

## Build

```bash
npm run build
```
