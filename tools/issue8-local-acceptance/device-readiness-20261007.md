# 実機への到達条件：2026-10-07

**後続更新:** 以下はbrowser確認時点の判断記録です。Android向けloopback HTTP入口の実装と実Auth/RTDBの9観測、起動停止/6portの検証は後続工程で完了しました。現在の操作は [Android USB手順](android-usb.md) が優先です。platform-tools/adb導入は必須にせず、既存ChromeのUSB port forwardingを使えます。実機未接続、USB debugging/PC鍵承認未実施は変わりません。

今回完了したのはPC上のbrowser適用確認です。実機は接続していません。推奨は、利用できるAndroidがあればUSB経由のlocalhostで短停止/復帰から始めることです。iPhone/PWA/携帯網切替と、元定義未取得のA〜K完全受入は別に残ります。

## 観測済みの状態

| 確認 | 結果と限界 |
|---|---|
| 固定対象 | PR #404のcode SHA `1f01916b906a7ea39cdd1506cfe4d4722fdc1e30` / `v2.0.187-issue8-recovery`。実公開版の差替えなし |
| 通常browser | Chrome 154.0.8037.98、独立headless、HTTP 127.0.0.1はsecure、Web Lockあり、開始画面描画、pageerror 0 |
| 証明書 | localhost/127.0.0.1限定の自己署名。browser直接HTTPSは `ERR_CERT_AUTHORITY_INVALID`。OS信頼変更・警告回避なし |
| Windows | 接続networkはPublic。Domain/Private/PublicのFirewall有効。DefaultInboundActionはNotConfiguredで、個別規則や最終有効policyの許否までは断定しない |
| 既存HTTPS候補 | TCP 80/443/8443/42884/42885のlistenerなし。CurrentUser/MyとLocalMachine/Myのsubject `localhost / katamon / .ts.net / loopback` 条件で候補なし。汎用wildcard証明書や全ドメインを網羅した探索ではない |
| 接続ツール | PATH上でadb/tailscale/cloudflared/mkcertなし。標準Tailscale/cloudflared実行ファイル、cloudflared設定候補、両serviceも見つからず。別配置/別端末の既存経路がないとは断定しない |
| 検証分離 | 実emulator8項目は前工程のみ。今回は架空SSE fixture、本人profile不使用、全サーバーloopback、終了確認。共有UI借用なし |

## 経路比較

| 案 | 必要な端末/操作 | 信頼・認証・Firewall | 確認できること / 残ること |
|---|---|---|---|
| **推奨：Android USB localhost** | Android Chrome + data対応USB。対戦相手はまずPC独立profile、両mobileが必要ならAndroid2台。実emulatorにつなぐloopback HTTP入口を追加し、端末別USB port forwardingを設定 | 対象端末のUSB debugging有効化とPCのRSA鍵承認が必要。証明書登録、LAN bind、Firewall変更は不要な構成。Firebaseはテスト匿名Authのみ | Android短いbackground/復帰・再参加・二重tabの切り分け候補。USB経路を使うため実Wi-Fi↔携帯網断やTLS信頼、iPhone、PWAの代替ではない |
| 既存の端末信頼済みHTTPS | 実際のURL・到達経路・管理者を特定。専用テストoriginからPC proxyへ届くこととSSE streamingを確認 | 当該端末で既に信頼され、テスト専用でアクセスを限定できる場合だけ再利用。現PCの限定探索では未発見 | Android/iPhoneの実HTTPSとWeb Lock候補。通常の公開サイトURLがあるだけではPCのloopbackに届かない |
| 限定LAN HTTPS | PCと端末2台の到達可能なLAN、固定アドレス/hostname、対応SAN証明書、限定bindを準備 | 現証明書はLAN用SANなし。端末信頼登録とinbound規則が必要かを具体的構成で判定。必要なら対象/fingerprint/port/source IP/撤去方法を示して操作別承認 | Wi-Fi内の実機HTTPS。携帯網からLANへの到達は別。今回未実装・未承認・未実行 |
| 外部Preview | 固定版frontendと専用backendの安全な公開経路・アクセス制限・予算等を別途設計 | 外部公開は今回範囲外。必要性未確定 | 携帯網を含む候補だが、ローカル準備を進めるための先行承認は不要 |

AndroidのUSB転送がネットワーク設定から独立して端末localhostへ届く仕組みは [Chrome公式手順](https://developer.chrome.com/docs/devtools/remote-debugging/local-server) を確認しました。開発者設定と端末での許可は [remote debugging公式手順](https://developer.chrome.com/docs/devtools/remote-debugging) に基づきます。CLI代替の `adb reverse tcp:DEVICE_PORT tcp:HOST_PORT` は [Android公式資料](https://developer.android.com/develop/ui/views/layout/webapps/access-local-server?hl=en) に記載されています。これらは今回実機で実証した結果ではありません。

## 最小再開手順と本人判断

1. 次工程担当が、Androidを使えるか、iPhoneを先に確認する必要があるかを確認します。現時点で証明書登録やFirewall操作は求めません。
2. Androidを使える場合、PC側では実emulatorへ接続する**loopback専用HTTP入口**を今回のfixtureから切り出して作り、通常CSP/SSE/Host/Origin制限を検証します。現 `BrowserProbe` は架空backend専用なので、そのまま実対戦用には使いません。必要な公式platform-toolsは作業フォルダ内で準備し、システムPATHやFirewallを変えません。
3. 本人が対象AndroidのUSB debuggingとこのPCの鍵承認を許可した後、対象端末だけにUSB転送を設定します。本人の一般browserタブや情報は操作対象にしません。端末localhostで固定版表示、`isSecureContext`、Web Lock、SSE、端末独立identityを確認してから私室へ進みます。USB接続は本人作業が必要ですが、この準備作業の未完理由にはしません。
4. 5〜10秒のbackground復帰、35秒超の待機/reloadを区別して記録します。期待値は既存Issue #8に従い、未取得のJ/Kを創作しません。終了後は当該転送を外し、必要に応じ本人が当該PCのUSB debugging許可を取り消します。emulator/入口も停止します。
5. iPhone/HTTPSを先に必要とする場合のみ、既存の信頼済みURLがあるかを本人から確認し、なければLAN案の具体的操作を設計して承認対象を確定します。アプリ追加、OS/端末信頼登録、Firewall/LAN公開を今回の許可に読み替えません。

SW/PWAは現キットが意図的に遮断しているため別の検証モードが必要です。実ブラウザでのCSPとnative lock基礎動作のPASSから、再参加ロジック全体や本番A〜Kの合格を推定しません。
