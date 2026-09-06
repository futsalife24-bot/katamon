import { z } from 'zod';
import { characterFormSchema, spriteMetadataSchema } from './schemas';
import { publishedRevisionSchema } from './editing-checkpoint';
import { PUBLISH_LIMITS } from './publish-limits';

const sha=z.string().regex(/^[a-f0-9]{40}$/), hash=z.string().regex(/^[a-f0-9]{64}$/);
export const recoveryHintSchema=z.object({
  repository:z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).max(200),
  branch:z.string().regex(/^studio\/add-character-[a-z0-9-]+-[a-f0-9]{40}$/).max(160),
  baseSha:sha, operationDigest:hash, headSha:sha.optional(), pullRequestNumber:z.number().int().positive().optional(),
}).strict();
const file=z.object({path:z.string().max(240),mimeType:z.enum(['image/png','image/webp','image/jpeg','application/json','text/markdown','text/plain']),byteLength:z.number().int().positive().max(PUBLISH_LIMITS.maxFileBytes),sha256:hash,contentBase64:z.string().max(Math.ceil(PUBLISH_LIMITS.maxFileBytes/3)*4).regex(/^[A-Za-z0-9+/]*={0,2}$/)}).strict();
export const recoveryPackageSchema=z.object({
  format:z.literal('content-studio-recovery-v1'),mode:z.literal('server'),actor:z.string().regex(/^[A-Za-z0-9-]{1,39}$/),draftContentHash:hash,
  hint:recoveryHintSchema,
  bundle:z.object({bundleId:z.string().min(1).max(120),generatorVersion:z.string().max(40),createdAt:z.string().datetime(),character:characterFormSchema,spriteMetadata:spriteMetadataSchema,
    sourceRevision:publishedRevisionSchema.optional(),
    revalidation:z.object({branch:z.string().max(160),headSha:sha,baseSha:sha,digest:hash,targetBaseSha:sha}).strict().optional(),
    prBody:z.string().max(64*1024),files:z.array(file).min(1).max(PUBLISH_LIMITS.maxFiles),
  }).strict(),
}).strict();
export type RecoveryHint=z.infer<typeof recoveryHintSchema>;
export type RecoveryPackage=z.infer<typeof recoveryPackageSchema>;
