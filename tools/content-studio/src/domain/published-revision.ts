import { z } from 'zod';
export const publishedRevisionSchema = z.object({
  mode:z.enum(['server','mock']), repository:z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  baseSha:z.string().regex(/^[a-f0-9]{40}$/), canonicalBlobSha:z.string().regex(/^[a-f0-9]{40}$/),
  slug:z.string().regex(/^[a-z][a-z0-9-]{0,23}$/), attestation:z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export type PublishedRevision = z.infer<typeof publishedRevisionSchema>;
