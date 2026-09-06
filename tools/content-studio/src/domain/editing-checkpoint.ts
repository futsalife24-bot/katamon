import { z } from 'zod';
import { motionParametersSchema } from './schemas.js';

const size = z.union([z.literal(128), z.literal(256), z.literal(384), z.literal(512)]);
const point = z.object({ x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1) }).strict();
const image = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), width: z.number().int().min(1).max(1600), height: z.number().int().min(1).max(1600) }).strict();
const intensity = z.enum(['subtle', 'standard', 'strong']);
const clip = z.object({ preset: z.enum(['standard','heavy','light','hover','flying','flexible','winged','mechanical','breathing','almost-still']), parameters: motionParametersSchema.strict() }).strict();
const five = <T extends z.ZodType>(value: T) => z.object({ 'move-forward':value, 'move-backward':value, fire:value, hit:value, land:value }).strict();
/** Background/brush edits are already baked into sanitized PNGs. No camera originals or operation history. */
export const editingCheckpointSchema = z.object({
  version: z.literal(1),
  generatorVersion: z.string().regex(/^[a-zA-Z0-9._-]{1,32}$/),
  source: image,
  hitSource: image.optional(),
  placement: z.object({ padding:z.number().int().min(0).max(512), offsetX:z.number().finite().min(-2048).max(2048), offsetY:z.number().finite().min(-2048).max(2048), scale:z.number().finite().min(.05).max(8), flipHorizontal:z.boolean(), referenceSize:size }).strict(),
  landmarks: z.object({ facing:z.enum(['left','right']), ground:point, muzzle:point }).strict(),
  outputSize:size,
  intensity:five(intensity),
  clips:five(clip),
}).strict();
export type EditingCheckpoint = z.infer<typeof editingCheckpointSchema>;

export { publishedRevisionSchema, type PublishedRevision } from './published-revision';
