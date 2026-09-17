# 共通管理画面へのアクセス集計

依頼: LMF能力DB・スワフロ・カタモン・まよいの砦を縦画面で一括確認。

カタモンの変更はindex.htmlの独立した計測スニペットとBUILD_ID/履歴、sw.jsのcache版、版契約テストのみ。ゲーム保存・Firebase・戦闘処理は変更なし。本番正規ページだけでページ表示を既存Swarm Workerへ送る。credentials omit/no-referrer、アプリ別ランダムIDのみ。DNT/GPC/developer=1/analytics=offを除外。失敗はゲームへ伝播しない。

元作業場所の未保存差分を保護し、workspace内cloneのorigin/master `1fdbd583cff70ba354270f8c3df4d8245e12e318`から作業。

検証: cache-version 2、app-shell 3、seat p1 20項目成功。共通Worker側の実Chromeテストで実スニペットの重複排除・開発者除外・無通信時の継続を確認。本番送信はすべてローカルへ差し替え。独立監査・公開前。実機未確認。
