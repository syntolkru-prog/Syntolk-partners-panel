/** Runtime mode helpers shared by the self-hosted Syntolk application. */
export type OpenPartnerMode = 'selfhost' | 'flat' | 'revshare';

export function getMode(): OpenPartnerMode {
  const mode = process.env.OPENPARTNER_MODE ?? 'selfhost';
  if (mode === 'selfhost' || mode === 'flat' || mode === 'revshare') return mode;
  throw new Error(`Invalid OPENPARTNER_MODE: ${mode}`);
}

/** Legacy hosted-plan accounting value; unrelated to a payment provider. */
export const REVSHARE_FEE_BPS = 300;
