// Suggestions from NEAR AI Cloud, end to end encrypted to a model running in a TEE, with every check recorded.
//
// 1. The model must be listed by NEAR AI (GET /v1/model/list) as verifiable with attestation support.
// 2. client.verify(model): the SDK fetches the gateway's and the model's attestation with a fresh random nonce and
//    verifies them (Intel TDX quote, NVIDIA GPU evidence, measured deployment, signing key).
// 3. The request is encrypted to the attested model key (e2ee), so only that TEE can read the facts and notes.
// 4. client.verifyResponse(id): the reply's signature is checked against the attested signer.
// Nothing is kept anywhere: Tickmark has no server, and the suggestions file stays on the user's machine.
import { createHash } from 'node:crypto';
import { InferenceClient } from '@nearai/inference-sdk/node';
import { buildMessages, parseSuggestions, pickTeeModel, practiceSuggestions, type NearAiModel, type SuggestionsFile, type SuspenseGroup, type Verification } from '../core/suggest.ts';

export const NEAR_AI_BASE_URL = 'https://cloud-api.near.ai/v1';
export const DEFAULT_MODEL = 'z-ai/glm-5.3-flash';

/** Pulls the facts the "Verified" panel shows out of the SDK's attestation result, without the raw quotes. */
export function summarizeAttestation(result: unknown): Verification['attestation'] {
  const nonces = new Set<string>();
  const details: Record<string, unknown> = {};
  let signer: string | undefined;
  let tcbStatus: string | undefined;
  let gpuEvidence: string | undefined;
  const walk = (value: unknown, path: string, depth: number) => {
    if (depth > 7 || value === null || typeof value !== 'object') return;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const here = path ? `${path}.${key}` : key;
      if (key === 'nonce' && typeof v === 'string') nonces.add(v);
      else if (key === 'signingAddress' && typeof v === 'string') signer ??= v;
      else if (key === 'tcbStatus' && typeof v === 'string') (tcbStatus ??= v), (details[here] = v);
      else if (key === 'gpuEvidence') (gpuEvidence ??= typeof v === 'string' ? v : JSON.stringify(v)), (details[here] = v);
      else if (key === 'deploymentProvenance' || key === 'advisoryIds' || key === 'tlsBinding') details[here] = v;
      else if (key === 'intelQuote' || key === 'eventLog' || key === 'appCompose' || key === 'nvidiaPayload') continue; // large raw evidence
      else walk(v, here, depth + 1);
    }
  };
  walk(result, '', 0);
  return { verified: true, nonces: [...nonces], signer, tcbStatus, gpuEvidence, details };
}

type ChatCompletion = { id: string; choices: { message?: { content?: string | null } }[] };

export async function suggest(options: {
  dao: string;
  reportFingerprint: string;
  groups: SuspenseGroup[];
  apiKey?: string;
  model?: string;
  notes?: string;
  onStep?: (step: string) => void;
}): Promise<SuggestionsFile> {
  const base = { format: 'tickmark-suggestions/1' as const, reportFingerprint: options.reportFingerprint, dao: options.dao, createdAt: new Date().toISOString() };
  const step = options.onStep ?? (() => {});
  if (!options.apiKey) {
    return { ...base, mode: 'practice', suggestions: practiceSuggestions(options.groups), problems: ['no NEAR_AI_API_KEY: practice mode, nothing was sent anywhere'], verification: null };
  }

  step('checking that the model runs in a TEE (NEAR AI model list)');
  const res = await fetch(`${NEAR_AI_BASE_URL}/model/list`);
  if (!res.ok) throw new Error(`NEAR AI model list failed: HTTP ${res.status}`);
  const model = pickTeeModel(((await res.json()) as { models: NearAiModel[] }).models, options.model ?? DEFAULT_MODEL);

  const client = new InferenceClient({ baseUrl: NEAR_AI_BASE_URL, apiKey: options.apiKey, e2ee: true });
  step(`fetching and verifying the attestation of ${model} with a fresh nonce (the first time can take 20 s to 2 min)`);
  const attestation = summarizeAttestation(await client.verify(model));

  step('sending the unexplained payments, encrypted to the attested model');
  const completion = (await client.chat.completions.create({
    model,
    max_tokens: 6000,
    reasoning_effort: 'low',
    messages: buildMessages(options.dao, options.groups, options.notes),
  } as never)) as unknown as ChatCompletion;
  const text = completion.choices[0]?.message?.content ?? '';

  step('checking the signature on the reply');
  const checked = await client.verifyResponse(completion.id);
  const { signedText, signature, signer } = checked.signature;

  const { suggestions, problems } = parseSuggestions(text, options.groups);
  return {
    ...base,
    mode: 'verified',
    suggestions,
    problems,
    verification: {
      model,
      modelListedAsTee: true,
      attestation,
      replySignature: {
        verified: true,
        kind: checked.signatureKind,
        signer: signer.signingAddress,
        signedTextSha256: createHash('sha256').update(signedText).digest('hex'),
        signature,
        completionId: completion.id,
      },
      endToEndEncrypted: true,
      storedServerSide: false,
    },
  };
}
