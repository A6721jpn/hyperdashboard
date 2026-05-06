# Codex で Google Slides を作るベストプラクティス調査

調査日: 2026-05-06

## 結論

`Slide Builder` は、最初から Google Slides API の細かい `batchUpdate` だけで全スライドを組み立てるより、次の 2 系統を分けて設計するのが安全。

1. 新規デッキ生成: ローカルで編集可能な `.pptx` を生成し、PNG レンダリングで視覚検証してから、Google Drive connector の `_import_presentation` で `upload_mode: "native_google_slides"` として Google Slides に変換する。
2. 既存デッキ/テンプレート編集: Google Drive connector で対象 deck を読み、slide object ID と page element ID を確認してから、`_batch_update_presentation` で小さな batch を適用する。

つまり、アプリ側の中核は「スライド案を作る UI」ではなく、`brief -> deck spec -> local pptx -> import -> connector readback -> thumbnail QA -> Slides link` の実行状態を追跡するワークフローにする。

## 根拠

- Google Slides API は、プレゼンテーションの作成・変更、スライド作成、図形/表/画像/チャート/テキスト/変形/スライド順変更を `batchUpdate` で扱う設計になっている。
- Google は batch request の利用を推奨しており、複数 subrequest は順序通り処理され、依存関係を同じ batch 内で扱える。
- batch update は適用前に全 request が検証され、無効な request があると全体が失敗する atomic な挙動を持つ。
- Google Slides の page/page element は object ID で識別されるが、UI 操作などで変わる可能性があるため、長期保存には向かない。編集時は毎回 connector readback で現在の ID を取る。
- thumbnail API は指定ページの最新バージョンの画像 URL を返す。視覚 QA には有効だが quota 上は expensive read なので、対象スライドに絞って使う。
- Drive では Google Slides の MIME type は `application/vnd.google-apps.presentation`。Google Workspace 形式への変換は、ファイル作成時に Workspace 側の MIME type を指定する流れ。
- Google Workspace のプレゼンテーションは `.pptx` として export 可能。ローカル PPTX 生成と Google Slides import の往復 QA は実装上の逃げ道になる。

## Codex/connector 側の実務ルール

- Connector 呼び出しは Google Drive/Slides MCP tool で行う。`node_repl` は JSON 生成、source processing、小さな helper に限定する。
- OAuth token や raw REST client はアプリ/実装側で扱わない。Codex connector が認証面を隠蔽する。
- 新規デッキは、Presentations plugin/PowerPoint authoring が使える場合、ローカル `.pptx` を作ってから native Google Slides として import する。
- 既存 deck を編集する場合は、毎回 `presentation_id`/title/slide count/target slide object IDs を確認する。
- `_batch_update_presentation.requests[]` は文字列化した JSON ではなく、構造化 object の配列にする。
- MCP wrapper の外側は `presentation_id`, `write_control`, `image_uris` のように snake_case。Slides API の内側 request は `createSlide`, `insertText`, `updateTextStyle` のように camelCase。
- 画像をローカル生成して差し込む場合は、request 内の URL placeholder と wrapper の `image_uris` を対応させる。
- API 成功だけで完了扱いにしない。connector readback と fresh thumbnail を確認する。

## Slide Builder に入れるべき機能要件

- brief 入力: 目的、対象読者、トーン、スライド枚数目安、テンプレート URL、資料 URL/ローカルファイル、画像利用方針を分けて受け取る。
- deck plan 表示: いきなり生成せず、slide title、one job、主要メッセージ、必要素材を確認できる。
- 実行ログ: `drafting`, `pptx_rendered`, `imported`, `readback_verified`, `thumbnail_verified` のような状態を見せる。
- QA 結果: slide count、Google Slides URL、MIME type、読み戻した slide titles、thumbnail 確認対象を保存する。
- テンプレート対応: template URL がある場合は copy を作ってから編集する。元 deck は直接変更しない。
- 失敗時の復旧: import drift、テキストはみ出し、未置換 placeholder、画像欠落、slide count mismatch を明示し、再実行できるようにする。

## 実装方針

- `slide-builder/` 配下に feature を閉じ込める。
- 初期版は URL 直打ちの単体ページでよい。
- UI は「チャット風の自由入力」だけにせず、brief フィールドと plan/QA パネルを持つ作業ツールにする。
- Google Slides 実行は、まず Codex が行うローカル workflow の runbook として実装し、後からアプリ内の backend/API に切り出せるようにする。
- 生成物は最終的に Google Slides link を返す。ローカル `.pptx` は中間成果物であり、ユーザー向けの主成果物にしない。

## 参考ソース

- OpenAI Developer Docs: Prompt engineering, coding best practices
  - https://developers.openai.com/api/docs/guides/prompt-engineering#coding
- Google Slides API: Introduction
  - https://developers.google.com/workspace/slides/api/guides/overview
- Google Slides API: Batch requests
  - https://developers.google.com/workspace/slides/api/guides/batch
- Google Slides API: presentations.batchUpdate
  - https://developers.google.com/workspace/slides/api/reference/rest/v1/presentations/batchUpdate
- Google Slides API: presentations.pages.getThumbnail
  - https://developers.google.com/workspace/slides/api/reference/rest/v1/presentations.pages/getThumbnail
- Google Drive API: Upload file data / Import to Google Docs types
  - https://developers.google.com/workspace/drive/api/guides/manage-uploads#import_to_google_docs_types
- Google Drive API: supported MIME types
  - https://developers.google.com/workspace/drive/api/guides/mime-types
- Google Drive API: export MIME types
  - https://developers.google.com/workspace/drive/api/guides/ref-export-formats
