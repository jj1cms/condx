# CondX — HF バンドコンディション可視化 PWA

「今どのバンドが開けてるか」を色で直感的に表示する、アマチュア無線向けのコンディション可視化アプリです。
ビルド不要の静的サイト（バニラ JS）なので、GitHub Pages にそのまま置けて iPhone からも使えます。

## 機能

- **太陽指数** — SFI(10.7cm flux) / SSN(黒点数) / K指数 / A指数（NOAA SWPC、色分け表示）
- **バンドコンディション** — 160m〜6m を Excellent/Good/Fair/Poor/Closed で色表示。MUF・太陽高度・D層吸収・地磁気擾乱・グレーラインを加味
- **パスMUF（相手局への到達判定）** — グリッド/座標を入れると、経路距離・ホップ数・**入射角**からその経路の MUF を計算し、各バンドを 開/際どい/閉 で判定。foEs があれば Eスポ到達も表示（下記）
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
| 電離層観測点 MUF/foF2/foEs/hmF2 | KC2G (`/api/stations.json`) | ⚠️ CORSなし | 自前Worker推奨（下記）。無ければallorigins経由。失敗時は推定MUFにフォールバック |
| DX スポット | DX Summit API | ⚠️ 不安定 | サーバー稼働状況に依存。失敗時はリンク表示 |

> 状態タブのバンド判定は **QTH 直下の推定MUF（SFI＋太陽高度）を主軸**にしています。近く(<2500km)かつ
> 新しい(<90分)実測観測点があるときだけ実測値を採用します。観測点/推定が返す MUF(3000) を、近距離/国内
> 向けに **約1000km経路の MUF にセカント則で換算**してから判定します（基準距離は `BAND_REF_KM`、下記）。
> これは推定であり、実際の交信状況とは異なります。遠距離DXは「相手局へ届く?」で経路ごとに確認できます。

## パスMUF — 入射角を考慮した到達判定

状態タブの「相手局へ届く?」は、QTH 直下ではなく **特定の経路** の MUF を求めます。
MUF は反射点での**入射角**で変わる（セカント則 `MUF = f_c · sec φ`）ため、同じ電離層でも
短い経路（浅い入射角）ほど MUF は低くなります。計算は [`js/path.js`](js/path.js)：

1. 大圏距離 → 最小ホップ数 → 1ホップの地上距離 `d`
2. 球面幾何で打上げ角 Δ と入射角 φ を算出（反射高 h′ は観測点の `hmf2` 実測、無ければ 300km）
   - `ψ = d/2R`, `Δ = atan2(cosψ − R/(R+h′), sinψ)`, `φ = 90° − ψ − Δ`
3. **F2**: 経路中点の MUF(3000) を `sec φ / sec φ(3000)` でスケール
   （3000km ホップなら MUF(3000) に一致、短い経路ほど低く）。中点の MUF(3000) は
   中点近くの新鮮な観測点（<90分・<2500km）があれば実測、無ければ太陽指数＋中点の太陽高度で推定
4. **Es（スポラディックE）**: `MUF_Es = foEs · sec φ`（h′≈105km）。Es層は薄くセカント則がそのまま使えます。
   近傍（<1200km・<60分）に foEs 実測があるときだけ計算し、F2 が閉でもそのバンドが届けば「Es可」表示
5. 各バンドを `運用周波数 ≤ OWF(=0.85×MUF)` で **開**、`≤ MUF` で **際どい**、超えたら **閉** と判定

> 例: 東京→ヨーロッパ(約9700km)は3ホップ・入射角≈73°で中点MUF(3000)とほぼ同じ。
> 一方 東京→韓国(約1200km)は1ホップ・入射角≈60°で、同じ電離層でもパスMUFは約6割に下がります。

## Cloudflare Worker でプロキシ（任意・推奨）

KC2G の `stations.json` は CORS ヘッダが無いため、既定では公開プロキシ
(allorigins) 経由で取得しています。これは時間帯で不安定なので、`workers/` に
**自前の極小プロキシ Worker** を用意しました（KC2G の1エンドポイントだけを
CORS 付きで再配信。オープンプロキシではありません）。デプロイすると観測点ドットが
安定して出ます。

**方法A — Cloudflare ダッシュボード（node 不要・最短）**
1. dash.cloudflare.com → Workers & Pages → Create → Worker
2. 名前を `condx-kc2g-proxy` にして Deploy
3. Edit code を開き、[`workers/kc2g-proxy.js`](workers/kc2g-proxy.js) の中身を全部貼り付けて Deploy
4. 発行された `https://condx-kc2g-proxy.<あなた>.workers.dev/` をコピー

**方法B — wrangler CLI**
```bash
cd workers
npx wrangler login
npx wrangler deploy        # → *.workers.dev URL が表示される
```

**仕上げ（共通）** — [`js/config.js`](js/config.js) の `DATA.kc2gProxy` に上記URLを設定して push:
```js
kc2gProxy: 'https://condx-kc2g-proxy.<あなた>.workers.dev/',
```
アプリは「自前Worker → 失敗時 allorigins」の順で取得します。設定後、世界マップ上部の
バナーが `✅ 観測点 N点 取得` になれば成功です（空のままなら従来どおり allorigins）。

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
- **状態タブの基準距離**: `js/config.js` の `BAND_REF_KM`（既定 1000km。大きくすると遠距離DX寄り、小さくすると国内寄りの厳しめ判定）
- バンド判定ロジック: `js/bands.js`
- パスMUF（入射角・ホップ）と相手局判定: `js/path.js`、クイック宛先チップ: `js/app.js` の `TARGETS`
- データソース URL: `js/config.js` の `DATA`

更新を反映するときは `sw.js` の `CACHE`（`condx-v2` など）の数字を上げると確実です。
（同一オリジンはネットワーク優先キャッシュなので、通常はオンラインで自動更新されます。）

---
73! de JJ1CMS
