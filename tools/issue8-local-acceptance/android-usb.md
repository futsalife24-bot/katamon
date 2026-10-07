# Android USB localhost：実機前のPC準備と接続手順

PC側は準備完了です。`StartUsb` は固定版 `1f01916b906a7ea39cdd1506cfe4d4722fdc1e30`（v2.0.187）を、実Auth/RTDB emulatorにつながる `http://localhost:42885/` で配信します。実機USB接続、端末設定、本人browser操作は今回していません。

## PCでの再開

実行場所は `C:/Users/futsa/Documents/Codex/2026-10-06/4-pro20x-hub/katamon-local-acceptance`。初回依存はこのPCに準備済みです。

```powershell
.\Run-Lab.ps1 PreflightUsb
.\Run-Lab.ps1 StartUsb
```

起動shellを維持します。固定Rulesの読戻し一致を確認した後にUSB入口が開きます。別shellで必要時の診断・終了を実行できます。

```powershell
.\Run-Lab.ps1 UsbSmoke
.\Run-Lab.ps1 Stop
.\Run-Lab.ps1 PreflightUsb
```

既存の `Start` / HTTPS `42884` は維持します。`StartUsb` だけが追加HTTP `42885` を開きます。6portはすべて127.0.0.1、外部bindやupstream URLを指定するoptionはありません。上流HTTPSの自己署名証明書はNodeのこの接続だけで検証し、OS/browserへ登録しません。localhost用証明書の期限切れ時はREADMEの更新手順が必要です。

| 層 | 制限 |
|---|---|
| Android→HTTP入口 | USB port forwarding経由のlocalhost。通常のLAN IPアクセスは不可 |
| HTTP入口 | Hostはlocalhost/127.0.0.1:42885のみ、Originは要求Hostと完全一致。cross-site、Admin Authorization、停止token/停止endpointを拒否 |
| HTTPS中継 | 127.0.0.1:42884固定、SNI localhost、明示CAで検証、redirect拒否。body/SSEをstream、ETag/条件付きPUT関連headerを維持 |
| 既存proxy | demo-catamon-registrationのAuth/RTDB、許可されたrooms/openだけ。管理token/別namespace/外部backend不可 |
| browser | location.originから同originのAPIを参照、CSPを保持、SW無効。HTTP localhostのsecure-context判定を利用。TLSの端末信頼試験とは別 |

## 本人が行う実機接続手順

次の一連だけが未実施です。**対象AndroidでUSB debuggingを有効にし、このPCの鍵を許可する本人判断**が必要です。端末の一般データや他のtabを作業対象にしません。証明書信頼登録・Firewall変更・LAN公開は不要な設計です。

1. データ通信対応USBケーブルでテスト用AndroidをこのPCへ接続します。対象端末の開発者向けoptionでUSB debuggingを有効にし、PCの接続を許可します。端末のRSA確認表示は本人が確認して承認します。端末ごとの開発者設定の入り方は機種に従います。
2. PCのChromeで `chrome://inspect/#devices` を開き、`Discover USB devices`を有効にします。対象Androidが表示されることを確認します。表示されない場合はケーブル/接続mode/OEM driverを確認し、driverの自動導入や無線debuggingへ範囲を拡張しません。
3. `Port forwarding`に **device port `42885` → `127.0.0.1:42885`** の1件を設定して有効にします。既存転送を消したり、他のportを公開したりしません。
4. Android Chromeで **`http://localhost:42885/`** を開きます。途中で127.0.0.1表記やHTTPSへ切り替えないでください（origin/storageが変わります）。ローカル検証bannerとv2.0.187を確認します。証明書警告が出た場合は別URLを開いている可能性があり、無視して進みません。
5. 対戦相手はPCの専用Chrome profileで同じURLを開くか、2台目Androidへ同様のUSB転送を設定します。同一PC/profileの別tabは同identityになるため、2人目の代用にはしません。実対戦前に別identity・Web Lock利用可・私室入室・live SSEを確認します。今回のNode疎通はこの実機ゲーム確認の合格を意味しません。
6. 終了時は当該port forwardingを外し、USBを外します。必要に応じ本人が当該PCのUSB debugging許可を取り消して機能を無効にします。PCで `Stop` を実行し、session消去・6port解放を確認します。

この流れは [Chrome公式USB転送手順](https://developer.chrome.com/docs/devtools/remote-debugging/local-server) と [Android remote debugging手順](https://developer.chrome.com/docs/devtools/remote-debugging) に基づきます。adb/platform-toolsの追加導入は必須ではありません。

## 今回の検証と限界

`usb-verification-20261007.json` の9観測がPASSしました。実Authの別identity2つ、私室の入室前拒否/guest入室後read、実RTDB SSE、guest token更新とUID維持、生成私室の削除を**新HTTP→HTTPS経路で**確認しています。Host/Origin/cross-site/Admin/停止endpoint、管理token/別namespace拒否も確認しました。起動時6listenerすべて127.0.0.1、停止後6port解放/session消去を確認済みです。匿名Auth userはemulatorのメモリ内にだけ残り、停止で破棄します。秘密token/UID/部屋番号は証拠へ保存しません。

前工程のbrowser8項目、Stage Studio、既存PC多client受入は再実行していません。今回browser/UIは使用していません。物理USB到達、AndroidのWeb Lock/復帰、実ゲーム対戦は未確認です。USBはネットワークを迂回するため、Wi-Fi↔携帯網断の受入に数えません。iPhone・SW/PWA・本番A〜K、元定義未取得のJ/Kは対象外です。

キットは新しい開発補助コードで、PR #404既存独立監査のPASS対象に含めません。本体/Rules/schema/本番は変更していません。指定モデルgpt-6-astra/high、実行設定の独立取得は未確認です。
