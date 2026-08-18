export const DRAFT_SCHEMA_VERSION = 6 as const;
export const GENERATOR_VERSION = '0.5.0';

export type WorkflowStep =
  | 'image'
  | 'setup'
  | 'character'
  | 'cutout'
  | 'parts'
  | 'motion'
  | 'details'
  | 'skills'
  | 'preview'
  | 'validate'
  | 'publish'
  | 'complete'
  | 'export';

export const WORKFLOW_STEPS: ReadonlyArray<{ id: WorkflowStep; label: string }> = [
  { id: 'image', label: '画像' },
  { id: 'setup', label: '向きと基準点' },
  { id: 'motion', label: '生成' },
  { id: 'character', label: 'キャラ' },
  { id: 'publish', label: 'GitHub' },
];

export type MotionAction = 'idle' | 'move' | 'fire' | 'hit' | 'land';

export type MotionClipId = 'move-forward' | 'move-backward' | 'fire' | 'hit' | 'land';
export type MotionIntensityLevel = 'subtle' | 'standard' | 'strong';
export type FacingDirection = 'left' | 'right';
export type PublishMode = 'pr-only' | 'merge-after-ci';

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface MotionLandmarks {
  status: 'idle' | 'ready' | 'needs-review';
  facing: FacingDirection;
  ground: NormalizedPoint;
  muzzle: NormalizedPoint;
  detectedAt: string | null;
}

export type MotionActionPreset =
  | 'idle-standard'
  | 'idle-heavy'
  | 'idle-hover'
  | 'move-steady'
  | 'move-heavy'
  | 'move-dash'
  | 'fire-recoil'
  | 'fire-charge'
  | 'fire-rapid'
  | 'hit-light'
  | 'hit-heavy'
  | 'hit-knockback';

export type MotionPartRole = 'upper' | 'core' | 'left' | 'right' | 'base';

export interface DetectedMotionPart {
  id: string;
  label: string;
  role: MotionPartRole;
  /** Normalized bounds in the square motion source (0..1). */
  bounds: ContentBounds;
  confidence: number;
  pixelRatio: number;
  enabled: boolean;
}

export interface PartDetectionState {
  status: 'idle' | 'ready' | 'needs-review';
  parts: DetectedMotionPart[];
  focusPartId: string | null;
  anchorPartId: string | null;
  analyzedAt: string | null;
}

export type MotionPreset =
  | 'standard'
  | 'heavy'
  | 'light'
  | 'hover'
  | 'flying'
  | 'flexible'
  | 'winged'
  | 'mechanical'
  | 'breathing'
  | 'almost-still';

export interface MotionParameters {
  frameCount: 8 | 12;
  fps: number;
  durationMs: number;
  moveX: number;
  moveY: number;
  scaleAmount: number;
  squashAmount: number;
  rotationDegrees: number;
  idlePause: number;
  groundContact: number;
  intensity: number;
  flipHorizontal: boolean;
  canvasPadding: number;
  outputSize: 128 | 256 | 384 | 512;
  lightweightPreview: boolean;
}

export interface CropPoint {
  x: number;
  y: number;
  width: number;
}

export type SpecialTemplate =
  | 'single'
  | 'multi-shot'
  | 'straight'
  | 'area'
  | 'explosion'
  | 'piercing'
  | 'knockback'
  | 'healing'
  | 'emp'
  | 'custom-required';

export interface SkillParameters {
  power: number;
  projectileCount: number;
  intervalMs: number;
  projectileSpeed: number;
  gravityMultiplier: number;
  explosionRadius: number;
  penetrationCount: number;
  cooldownTurns: number;
  knockback: number;
  statusChance: number;
  statusDurationTurns: number;
  healing: number;
  effectRef: string;
  soundRef: string;
}

export interface CharacterForm {
  schemaVersion: 1;
  id: string;
  slug: string;
  displayName: string;
  attribute: 'neutral' | 'fire' | 'water' | 'earth' | 'wind' | 'light' | 'dark';
  classification: string;
  rarity: 1 | 2 | 3 | 4 | 5;
  description: string;
  tags: string[];
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  weight: number;
  movement: 'ground' | 'floating' | 'flying' | 'flexible';
  blastMultiplier: number;
  windMultiplier: number;
  fuelMultiplier: number;
  velocityMultiplier: number;
  damageTakenMultiplier: number;
  guideMultiplier: number;
  gravityMultiplier: number;
  specialVelocityMultiplier: number;
  cpuTargetBias: number;
  color: string;
  sourceFacesLeft: boolean;
  spriteScale: number;
  faceCrop: CropPoint;
  matchupCrop: CropPoint;
  normalSkillId: 'standard-projectile';
  specialEnabled: boolean;
  specialName: string;
  specialDescription: string;
  specialTemplate: SpecialTemplate;
  specialParameters: SkillParameters;
  customImplementationNote: string;
  implementationVersion: string;
}

export interface ImageInfo {
  fileName: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  byteLength: number;
  width: number;
  height: number;
  hasAlpha: boolean;
  colorMode: 'sRGB' | 'Display-P3' | 'unknown';
  estimatedOutputBytes: number;
  status: 'idle' | 'reading' | 'ready' | 'processing' | 'error';
  warnings: string[];
}

export interface ImageEditorState {
  tolerance: number;
  edgeFeather: number;
  brushSize: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  flipHorizontal: boolean;
  padding: number;
  outputSize: 128 | 256 | 384 | 512;
  zoom: number;
  tool: 'pan' | 'erase' | 'restore';
}

export interface PreviewSettings {
  background: 'light' | 'dark' | 'game';
  direction: 'left' | 'right';
  size: 'small' | 'normal';
  showAnchor: boolean;
  showCollision: boolean;
  playing: boolean;
}

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  field?: string;
  message: string;
}

export interface DraftRecord {
  schemaVersion: typeof DRAFT_SCHEMA_VERSION;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastStep: WorkflowStep;
  character: CharacterForm;
  imageInfo: ImageInfo | null;
  /** Optional alternate artwork used only by the hit motion. The blob stays in IndexedDB. */
  hitImageInfo: ImageInfo | null;
  editor: ImageEditorState;
  motionPreset: MotionPreset;
  motionAction: MotionAction;
  actionPreset: MotionActionPreset;
  motion: MotionParameters;
  partDetection: PartDetectionState;
  landmarks: MotionLandmarks;
  motionIntensity: Record<MotionClipId, MotionIntensityLevel>;
  generatedClips: MotionClipId[];
  publishMode: PublishMode;
  preview: PreviewSettings;
  validation: ValidationIssue[];
  processingOperations: ImageOperation[];
  historyStatus: 'clean' | 'dirty' | 'corrupt';
  mockScenario: MockScenario;
  sourceIdentity: { id: string; slug: string } | null;
  /** Existing hand-written game character that receives motion references only. */
  legacyTargetId: string | null;
}

export type ImageOperation =
  | { type: 'remove-background'; tolerance: number; feather: number }
  | { type: 'brush'; mode: 'erase' | 'restore'; size: number; points: Array<{ x: number; y: number }> }
  | { type: 'trim' }
  | { type: 'transform'; offsetX: number; offsetY: number; scale: number; flipHorizontal: boolean; padding: number };

export interface ContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpriteMetadata {
  schemaVersion: 1;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  fps: number;
  loop: boolean;
  anchorX: number;
  anchorY: number;
  contentBounds: ContentBounds;
  collisionBounds: ContentBounds;
  sourceImage: string;
  preset: MotionPreset;
  motionAction?: MotionAction;
  actionPreset?: MotionActionPreset;
  clipId?: MotionClipId;
  motionParameters: MotionParameters;
  partMasks: Array<{ id: string; label: string; blobKey?: string }>;
  partRegions?: DetectedMotionPart[];
  generatedAt: string;
  generatorVersion: string;
}

export interface ArtifactFile {
  path: string;
  mimeType: string;
  byteLength: number;
  kind: 'character-data' | 'game-catalog' | 'image' | 'sprite' | 'metadata' | 'rules-candidate' | 'preview';
  text?: string;
  blob?: Blob;
  sha256: string;
}

export interface ArtifactBundle {
  bundleId: string;
  createdAt: string;
  generatorVersion: string;
  character: CharacterForm;
  spriteMetadata: SpriteMetadata;
  files: ArtifactFile[];
  issues: ValidationIssue[];
  prBody: string;
  expectedBaseSha?: string;
}

export type MockScenario = 'success' | 'network-offline' | 'tests-failed' | 'conflict';

export interface RepositoryStatus {
  mode: 'mock' | 'server';
  connected: boolean;
  user: string | null;
  build: 'idle' | 'queued' | 'running' | 'success' | 'failure';
  deployment: 'unknown' | 'pending' | 'published' | 'failure';
  baseSha?: string;
  message: string;
}

export interface PreparedChange {
  id: string;
  branch: string;
  commitSha: string;
  files: ArtifactFile[];
  testStatus: 'success' | 'failure';
  diff: string;
}

export interface PullRequestResult {
  number: number;
  url: string;
  branch: string;
  commitSha: string;
  checks: 'queued' | 'running' | 'success' | 'failure';
  deployment: 'pending' | 'published' | 'failure';
  merged?: boolean;
  mergedAt?: string;
}

export interface RepositoryGateway {
  getStatus(): Promise<RepositoryStatus>;
  prepare(bundle: ArtifactBundle, scenario?: MockScenario): Promise<PreparedChange>;
  createPullRequest(prepared: PreparedChange, bundle: ArtifactBundle, scenario?: MockScenario): Promise<PullRequestResult>;
  mergePullRequest(prepared: PreparedChange, result: PullRequestResult, scenario?: MockScenario): Promise<PullRequestResult>;
  getChecks(ref: string): Promise<RepositoryStatus['build']>;
  getDeployment(ref: string): Promise<RepositoryStatus['deployment']>;
  logout(): Promise<void>;
}

export interface ImageGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  referenceImages?: Blob[];
  outputSize: { width: number; height: number };
  transparent: boolean;
  signal?: AbortSignal;
}

export interface ImageGenerationResult {
  status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
  image?: Blob;
  error?: string;
}

export interface ImageGenerationProvider {
  readonly id: string;
  readonly available: boolean;
  generate(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
  cancel(): Promise<void>;
}
