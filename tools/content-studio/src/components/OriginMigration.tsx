import {useRef,useState} from 'react';
import type {StudioController} from '../app/use-studio-controller';

export function OriginMigration({studio}:{studio:StudioController}){
  const input=useRef<HTMLInputElement>(null);
  const [draftId,setDraftId]=useState('');
  return <section className="card origin-migration" data-testid="origin-migration">
    <h2>公開元の移行・既存PRの照合</h2>
    <p>旧サイトの保存領域は自動移行されません。旧サイトを残したまま、下書きの「出力」→新サイトの「JSON読込」で画像と設定を移してください。端末内バックアップには元画像も含まれるため、共有先に注意してください。</p>
    <p>公開操作は別に移します。復旧情報は加工済み公開生成物と照合用情報だけで、ログイン情報や過去の承認は含みません。初回は読取確認のみです。</p>
    {studio.outbox.map(item=><button key={item.id} className="secondary full-width" type="button" disabled={studio.busy||studio.repositoryStatus.mode!=='server'} onClick={()=>void studio.exportRecoveryPackage(item.id)}>復旧情報を出力：{item.bundle.character.displayName}</button>)}
    <label>移行済みの下書き<select value={draftId} onChange={event=>setDraftId(event.target.value)} data-testid="migration-draft"><option value="">下書きJSONを先に読み込んで選択</option>{studio.drafts.map(d=><option key={d.id} value={d.id}>{d.character.displayName||d.title}</option>)}</select></label>
    <input ref={input} hidden type="file" accept="application/json,.json" data-testid="recovery-package-file" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void studio.importRecoveryPackage(file,draftId);}}/>
    <button className="primary full-width" type="button" disabled={!draftId||studio.busy||studio.repositoryStatus.mode!=='server'} onClick={()=>input.current?.click()}>復旧情報を読み込み、既存PRだけ照合</button>
    <p>同じGitHubアカウントで再認証してください。mock履歴・対応を証明できない旧形式は復旧できません。旧保存物を消したり、別の下書きへ推測で結び付けたりしません。</p>
  </section>;
}
