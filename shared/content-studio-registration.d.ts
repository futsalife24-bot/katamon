declare const registration: {
  CONTRACT: string;
  stable(value: unknown): string;
  hash(value: string | Uint8Array): Promise<string>;
  create(characters: Record<string, unknown>): Promise<RegistrationCandidate>;
  verify(value: unknown, expectedRevision?: string): Promise<RegistrationCandidate>;
  assetPath(path: string): boolean;
  gameplayDefinition(definition: Record<string, unknown>): Record<string, unknown>;
};
export interface RegistrationCandidate {
  schemaVersion: 1;
  runtimeContract: string;
  registryRevision: string;
  characters: Record<string, unknown>;
}
export default registration;
