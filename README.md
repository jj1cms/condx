# CondX — HF バンドコンディション可視化 PWA

「今どのバンドが開けてるか」を色で直感的に表示する、アマチュア無線向けのコンディション可視化アプリです。
ビルド不要の静的サイト（バニラ JS）なので、GitHub Pages にそのまま置けて iPhone からも使えます。

## 機能

- **太陽指数** — SFI(10.7cm flux) / SSN(黒点数) / K指数 / A指数（NOAA SWPC、色分け表示）
- **バンドコンディション** — 160m〜6m を Excellent/Good/Fair/Poor/Closed で色表示。MUF・太陽高度・D層吸収・地磁気擾乱・グレーラインを加味
- **MUF 可視化** — 世界の MUF(3000km) マップ（KC2G ライブ画像）＋ QTH 近傍の推定/実測 MUF
- **世界マップ** — ダークタイル＋夜間グレーライン＋自局＋電離層観測点（MUFで色分け）
- **DX クラスタ** — 最新スポット一覧（取得不可時は優雅に縮退）
- **通知** — ウォッチ中のバンドが開けたら通知（例: 「6m が開けています！」）
- **PWA** — ホーム画面に追加してオフライン起動、ネイティブ風 UI

## データ出典と制約

| データ | ソース | CORS | 備考 |
|---|---|---|---|
| SFI / SSN / K / A | NOAA SWPC (`services.swpc.noaa.gov`) | ✅ 直接取得 | 安定 |
| 世界 MUF マップ画像 | KC2G (`prop.kc2g.com/renders`) | ✅ 直接取得 | GIRO データ、約4分更新 |
| 電離層観測点 MUF/foF2 | KC2G (`/api/stations.json`) | ⚠️ CORSなし | プロキシ経由のベストエフォート。失敗時は推定MUFにフォールバック |
| DX スポット | DX Summit API | ⚠️ 不安定 | サーバー稼働状況に依存。失敗時はリンク表示 |

> バンド判定は **QTH 直下の推定MUF（SFI＋太陽高度）を主軸**にしています。近く(<2500km)かつ新しい(<90分)
> 実測観測点があるときだけ実測値を採用します。これは推定であり、実際の交信状況とは異なります。

## ローカルで動かす

Python/Node があればどちらでも。なければ付属の PowerShell サーバーでも可。

```powershell
# このフォルダ(condx)で
python -m http.server 4178       # → http://localhost:4178/
# または
npx serve -l 4178
```

> Service Worker と ES モジュールは `localhost` か HTTPS が必要です（`file://` では動きません）。

## GitHub Pages に公開する

### A. 新しいリポジトリで公開（推奨・最短）

```bash
cd condx
git init
git add -A
git commit -m "CondX initial"
git branch -M main
git remote add origin https://github.com/<ユーザー名>/condx.git
git push -u origin main
```

GitHub の **Settings → Pages → Source: Deploy from a branch → main / (root)** を選択。
数分後 `https://<ユーザー名>.github.io/condx/` で公開されます（相対パス設計なのでサブパスでも動作）。

### B. 既存サイトのサブフォルダで公開

`<ユーザー名>.github.io` リポジトリ直下に `condx/` を置いて push するだけで
`https://<ユーザー名>.github.io/condx/` で見られます。

## iPhone で使う

1. Safari で公開 URL を開く
2. 共有 → **「ホーム画面に追加」**
3. ホーム画面のアイコンから起動（フルスクリーン PWA）
4. 設定タブで **「通知を有効化」**（iOS 16.4+ / インストール後・アプリを開いた状態で通知）

## カスタマイズ

- 既定の QTH（東京）やバンド定義: `js/config.js`
- バンド判定ロジック: `js/bands.js`
- データソース URL: `js/config.js` の `DATA`

更新を反映するときは `sw.js` の `CACHE`（`condx-v2` など）の数字を上げると確実です。
（同一オリジンはネットワーク優先キャッシュなので、通常はオンラインで自動更新されます。）

---
73! de JJ1CMS
