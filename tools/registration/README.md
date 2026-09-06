# 登録revisionの有効化

本番適用は未実施。既定はdry-runで、通常のPR CIにFirebase本番資格情報は渡さない。

`tools/content-studio/node_modules/.bin/tsx tools/registration/publish.ts --sha=<merge SHA> --dry-run`

publisherは固定repositoryのmerge済みcommitからcanonical・既存定義・asset bytesを読み、生成器でcandidateを再構成する。対応する`github-pages` deployment成功と公開candidate・参照bytesの一致を検証する。Studioホストの配備は代用しない。origin/protocol/パスは固定または運用設定に限定し、PWAから受け取った登録簿を適用しない。

適用は不変candidateをETag付き条件更新で保存してからactiveを更新する。期待するactiveと世代が変われば停止する。同一内容の再送・応答喪失は読戻しで照合し、古い配備通知はGit ancestryで拒否する。旧candidate・定義・画像は削除しない。rollbackは通常の更新に混ぜず停止する。本PRには自動rollback操作は設けない。

管理者接続には通常クライアント用Rulesの保護は適用されない。専用service accountとworkflowの環境制限に加え、publisher自身が固定repository・登録用path・入力schema/hash・変更範囲を検証する。IAMだけでDB内の子path制限が成立したとは扱わない。

## 初回の人間操作（別途承認が必要）

1. 本PRを独立監査・merge後、後方互換RulesをEmulatorと同じhashで別途承認・配備する。このworkflowはRulesを配備しない。
2. `content-registration-production` environmentを作り、master限定の配備branch規則を設定する。通常はrequired reviewersと自己承認禁止を設定する。単独運用では、管理者本人をrequired reviewerに登録して自己承認を許可し、repository variable `CONTENT_REGISTRATION_APPROVAL_MODE=single-operator` を明示する。どちらの場合もreviewerが空、設定不明、または方式が一致しないとpublisherは停止する。
   environmentの読取にはworkflowの`actions: read`を使用する（[GitHub Get an environment](https://docs.github.com/en/rest/deployments/environments#get-an-environment)）。設定を書き換えるAdministration権限は付与しない。
3. 固定repo・当該environment・masterに限定したWorkload Identity Federationと専用service accountを用意する。権限は対象Realtime Databaseの登録処理に必要なものに限定する。PWA用サービスアカウントや長期鍵を作らない。
4. environment変数`REGISTRY_DATABASE_ORIGIN`、`REGISTRY_WORKLOAD_IDENTITY_PROVIDER`、`REGISTRY_SERVICE_ACCOUNT`を設定する。originは対象DBのHTTPS originだけ。tokenはActionから一時的に渡し、ファイル・artifact・ログへ出さない。
5. dry-runで対象merge SHAのゲームPagesとcandidate/assetを確認する。承認後にrepository変数`CONTENT_REGISTRATION_ENABLED=true`を設定し、environment承認付きapplyを行う。

未設定時は新登録対戦を開始できない。旧形式の既存18体対戦は維持する。登録対戦の失敗を旧形式へ自動降格しない。以後はPages配備成功から同じ検証・environment承認・条件付き有効化につながり、キャラごとのRules編集は不要。

既存Node/PWA配備・OAuth等は[`../content-studio/server/PRODUCTION.md`](../content-studio/server/PRODUCTION.md)を正本とする。この登録手順でホストや秘密情報を再設定しない。

## ローカル試験

Java21以上、固定版firebase-toolsを利用。`firebase.emulator.json`のAuth/RTDBはloopback限定。`demo-catamon-registration`以外へ試験接続しない。試験は実際に読み込まれたRulesを照合し、正常ユーザーの許可/拒否とAdmin fixtureを区別する。Windowsでは試験プロセスのJAVA_HOMEを専用JDKへ向けるだけでよく、システム全体の設定変更は不要。

公式根拠: [Firebase Emulator接続](https://firebase.google.com/docs/emulator-suite/connect_rtdb)、[Google GitHub Actions認証](https://github.com/google-github-actions/auth)。
