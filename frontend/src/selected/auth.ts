/** ORAKL P1 — Client-side publication authorization helpers (EIP-712 & EIP-191).
 *  LOCAL SIMULATION ONLY (Chain ID 31337).
 */

export const PUBLICATION_APP_ID = 'ORAKL';
export const PUBLICATION_AUTH_VERSION = '1';

export type PublicationAction = 'evidence' | 'metadata';

export interface PublicationAuth {
  app: string;
  version: string;
  action: PublicationAction;
  chainId: number;
  factory: string;
  publisher: string;
  commitment: string;
  nonce: string;
  deadline: number;
}

export function createPublicationAuth(params: {
  action: PublicationAction;
  chainId: number;
  factory: string;
  publisher: string;
  commitment: string;
  nonce?: string;
  ttlSeconds?: number;
}): PublicationAuth {
  const now = Math.floor(Date.now() / 1000);
  const nonce = params.nonce ?? `auth_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return {
    app: PUBLICATION_APP_ID,
    version: PUBLICATION_AUTH_VERSION,
    action: params.action,
    chainId: params.chainId,
    factory: params.factory.toLowerCase(),
    publisher: params.publisher.toLowerCase(),
    commitment: params.commitment.toLowerCase(),
    nonce,
    deadline: now + (params.ttlSeconds ?? 3600),
  };
}

export function publicationAuthMessage(auth: PublicationAuth): string {
  return [
    'ORAKL PUBLICATION AUTHORIZATION',
    `app: ${auth.app}`,
    `version: ${auth.version}`,
    `action: ${auth.action}`,
    `chainId: ${auth.chainId}`,
    `factory: ${auth.factory.toLowerCase()}`,
    `publisher: ${auth.publisher.toLowerCase()}`,
    `commitment: ${auth.commitment.toLowerCase()}`,
    `nonce: ${auth.nonce}`,
    `deadline: ${auth.deadline}`,
  ].join('\n');
}
