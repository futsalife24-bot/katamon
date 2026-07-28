// ロビーのコミット・公開(v3)を2人ぶん仮想的に動かす検証。
//
// ループバック検証(loopbacktest.js)はv2のプロトコルで動くため、キャラのコミットと公開は
// 一度も通っていなかった。そこを埋めるのがこのファイル。ゲームは動かさず、本体の判定関数
// (commitPayload / acceptPeerCommit / acceptPeerReveal)をそのまま呼び、
// 「メッセージがどの順で届くか」だけを変えて結果を見る。
//
//   node tests/lobbysimtest.js
//
// 2026-07-28、実機で「キャラクター確認が一致しません」が出て両者とも動けなくなった。
// 相手が準備完了を押し直すと新旧2つのコミットが飛び、古い方が後から届くと最新を
// 上書きしてしまうのが原因だった。ここで再現してから直している。
const h = require('./seatharness.js');
const s3 = h.kt().stage3();

let pass = 0, fail = 0;
const log = [];
function check(name, ok, detail = '') {
  if (ok) { pass++; log.push(`  ok   ${name}`); }
  else { fail++; log.push(`  FAIL ${name}${detail ? '  ' + detail : ''}`); }
}

// 1人ぶんの端末。本体の online オブジェクトのうち、コミット・公開に関わる部分だけを持つ。
class Peer {
  constructor(name, character) {
    this.name = name;
    this.character = character;
    this.selfCommit = null;
    this.selfNonce = null;
    this.peerCommit = null;
    this.peerCommitAt = null;
    this.peerRevealSeen = false;
    this.error = null;
    this.verified = false;
    this.clock = 1000;
  }
  // commitOwnCharacter() 相当。押すたびに新しいnonceとハッシュになる。
  async commit() {
    this.selfNonce = 'n'.padEnd(24, '0') + Math.random().toString(16).slice(2);
    this.selfCommit = await s3.commitPayload(this.character, this.selfNonce);
    this.clock += 10;
    return { t: 'commit', from: this.name, hash: this.selfCommit, sentAt: this.clock };
  }
  cancel() { this.selfCommit = null; }  // setSelfNotReady() 相当
  reveal() { return { t: 'reveal', from: this.name, character: this.character, nonce: this.selfNonce }; }

  async receive(msg) {
    if (msg.from === this.name || this.error) return;
    if (msg.t === 'commit') {
      const d = s3.acceptPeerCommit(this.peerCommit, msg.hash, this.peerRevealSeen, this.peerCommitAt, msg.sentAt);
      if (d.error) { this.error = d.error; return; }
      if (d.duplicate || d.stale) return;
      this.peerCommit = d.hash;
      this.peerCommitAt = d.at;
    } else if (msg.t === 'reveal') {
      if (!s3.acceptPeerReveal(this.peerRevealSeen)) { this.error = '相手が選択内容を重複公開しました'; return; }
      this.peerRevealSeen = true;
      const expected = await s3.commitPayload(msg.character, msg.nonce);
      if (expected !== this.peerCommit) { this.error = 'キャラクター確認が一致しません'; return; }
      this.verified = true;
    }
  }
}

async function play(script) {
  const host = new Peer('host', 'kyoryu');
  const guest = new Peer('guest', 'kyoryu');
  const deliver = async msgs => { for (const m of msgs) { await host.receive(m); await guest.receive(m); } };
  await script(host, guest, deliver);
  return { host, guest, ok: !host.error && !guest.error && host.verified && guest.verified };
}

(async () => {
  // --- 正常系 ---
  {
    const r = await play(async (host, guest, deliver) => {
      await deliver([await host.commit(), await guest.commit()]);
      await deliver([host.reveal(), guest.reveal()]);
    });
    check('1回ずつ確定して公開すれば両者とも検証できる', r.ok, `${r.host.error} / ${r.guest.error}`);
  }
  {
    const r = await play(async (host, guest, deliver) => {
      const first = await host.commit();
      await deliver([first]);
      host.cancel();
      await deliver([await host.commit(), await guest.commit()]);
      await deliver([host.reveal(), guest.reveal()]);
    });
    check('準備完了を押し直しても、順番どおり届けば通る', r.ok, `${r.host.error} / ${r.guest.error}`);
  }

  // --- 実機で起きた配送順 ---
  {
    const r = await play(async (host, guest, deliver) => {
      const stale = await host.commit();
      host.cancel();
      const fresh = await host.commit();
      await deliver([fresh, stale, await guest.commit()]); // 新しい方が先、古い方が後
      await deliver([host.reveal(), guest.reveal()]);
    });
    check('新旧のコミットが逆順で届いても、古い方に上書きされない', r.ok, `${r.host.error} / ${r.guest.error}`);
  }
  {
    const r = await play(async (host, guest, deliver) => {
      const stale = await host.commit();
      await deliver([stale]);
      host.cancel();
      await deliver([await host.commit(), await guest.commit()]);
      await deliver([stale]);                              // SSEの再送で古いものがもう一度
      await deliver([host.reveal(), guest.reveal()]);
    });
    check('古いコミットが再送で後から届いても、最新が生き残る', r.ok, `${r.host.error} / ${r.guest.error}`);
  }
  {
    const r = await play(async (host, guest, deliver) => {
      const c1 = await host.commit();
      host.cancel();
      const c2 = await host.commit();
      host.cancel();
      const c3 = await host.commit();
      await deliver([c3, c1, c2, await guest.commit()]);   // 3回押し直してばらばらに届く
      await deliver([host.reveal(), guest.reveal()]);
    });
    check('3回押し直してばらばらに届いても最新が生き残る', r.ok, `${r.host.error} / ${r.guest.error}`);
  }

  // --- ここは通ってはいけない(不正の防止) ---
  {
    const r = await play(async (host, guest, deliver) => {
      await deliver([await guest.commit()]);
      await deliver([host.reveal()]);                      // コミットより先に公開
      await deliver([await host.commit(), guest.reveal()]);
    });
    check('コミットより先に公開したら通らない', !!r.guest.error,
      '相手のキャラを見てから自分のを決められてしまう');
  }
  {
    const r = await play(async (host, guest, deliver) => {
      await deliver([await host.commit(), await guest.commit()]);
      await deliver([host.reveal()]);
      host.cancel();
      await deliver([await host.commit()]);                // 公開の後に差し替え
      await deliver([guest.reveal()]);
    });
    check('公開の後にコミットを差し替えたら弾かれる', !!r.guest.error);
  }

  console.log('\n=== lobby sim (commit/reveal) ===');
  console.log(log.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
