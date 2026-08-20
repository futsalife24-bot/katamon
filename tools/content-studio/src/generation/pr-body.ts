import { convertSkillTemplate } from '../domain/skills';
import type { ArtifactFile, CharacterForm, SpriteMetadata, ValidationIssue } from '../domain/types';

export interface PullRequestBodyInput {
  character: CharacterForm;
  spriteMetadata: SpriteMetadata;
  files: readonly ArtifactFile[];
  issues: readonly ValidationIssue[];
  generatorVersion: string;
  legacyTargetId?: string;
}

function escapeMarkdown(value: string): string {
  return value
    .replace(/\\/gu, '\\\\')
    .replace(/([`|\[\]_*<>])/gu, '\\$1')
    .replace(/[\r\n]+/gu, ' ');
}

function formatBytes(byteLength: number): string {
  if (byteLength < 1_024) return `${byteLength} B`;
  if (byteLength < 1_024 * 1_024) return `${(byteLength / 1_024).toFixed(1)} KiB`;
  return `${(byteLength / (1_024 * 1_024)).toFixed(2)} MiB`;
}

export function buildPullRequestBody(input: PullRequestBodyInput): string {
  const skill = convertSkillTemplate(input.character);
  const errors = input.issues.filter(({ severity }) => severity === 'error');
  const warnings = input.issues.filter(({ severity }) => severity === 'warning');
  const imageFiles = input.files.filter(({ kind }) => kind === 'image' || kind === 'sprite' || kind === 'preview');
  const preview = input.files.find(({ kind }) => kind === 'preview');

  const lines = [
    '## Content Studio 生成内容',
    '',
    `- キャラクター名: ${escapeMarkdown(input.character.displayName)}`,
    `- 内部ID: \`${input.character.id}\``,
    `- slug: \`${input.character.slug}\``,
    input.legacyTargetId
      ? `- 更新対象: 既存キャラクター \`${input.legacyTargetId}\`（能力・技・静止画像は変更なし）`
      : `- ステータス: HP ${input.character.maxHp} / 攻撃 ${input.character.attack} / 防御 ${input.character.defense} / 速度 ${input.character.speed} / 重量 ${input.character.weight}`,
    input.legacyTargetId ? '- 通常技・必殺技: 既存設定を保持' : `- 通常技: \`${input.character.normalSkillId}\`（既存共通・読み取り専用）`,
    ...(input.legacyTargetId ? [] : [`- 必殺技: ${input.character.specialEnabled ? `${escapeMarkdown(input.character.specialName)} / \`${input.character.specialTemplate}\`` : '未設定（ゲーム内ボタン無効）'}`]),
    `- モーション: 前進・後退・単発砲撃・被弾・着地 / 各${input.spriteMetadata.frameCount}フレーム`,
    `- 生成ツール: \`${input.generatorVersion}\``,
    '',
    '### 画像',
    '',
    '| ファイル | サイズ |',
    '|---|---:|',
    ...imageFiles.map((file) => `| \`${file.path}\` | ${formatBytes(file.byteLength)} |`),
    '',
    '### 変更ファイル',
    '',
    ...input.files.map((file) => `- \`${file.path}\``),
    '',
    '### 自動確認',
    '',
    `- 事前検証: ${errors.length === 0 ? '成功' : `失敗（${errors.length}件）`}`,
    '- CI: PR作成後に実行',
    `- 警告: ${warnings.length}件`,
    '',
    '### 手動確認',
    '',
    '- Android Chrome実機でのPWAインストールと共有メニュー',
    '- ゲーム画面での基準点、輪郭、当たり判定候補',
    '- 公開後のキャッシュ更新',
  ];

  if (!input.legacyTargetId && input.character.specialEnabled && !skill.autoRegistrable) {
    lines.push(
      '',
      '### カスタム実装が必要',
      '',
      '- この必殺技は互換カタログへ自動登録されません。',
      `- 仕様メモ: ${escapeMarkdown(skill.customImplementationNote ?? '未入力')}`,
    );
  }
  if (preview) {
    lines.push('', '### プレビュー', '', `![生成プレビュー](./${preview.path})`);
  }
  return `${lines.join('\n')}\n`;
}
