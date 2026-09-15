/**
 * The token signing secret, fetched rather than baked in.
 *
 * A Lambda environment variable is readable by anyone who can describe the
 * function, and this secret mints access to a socket that spends money on
 * transcription. So the deployed path holds the secret's ARN and reads the
 * value at cold start, and a direct VOICE_TOKEN_SECRET stays available for a
 * developer machine where there is no Secrets Manager and nothing to protect.
 */
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

let cached: string | null = null;
let client: SecretsManagerClient | null = null;

export class SecretUnavailable extends Error {}

export async function tokenSecret(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const direct = env.VOICE_TOKEN_SECRET;
  if (direct) return direct;
  if (cached) return cached;

  const arn = env.VOICE_TOKEN_SECRET_ARN;
  if (!arn) {
    throw new SecretUnavailable(
      "Neither VOICE_TOKEN_SECRET nor VOICE_TOKEN_SECRET_ARN is set, so no session token " +
        "can be verified.",
    );
  }

  client ??= new SecretsManagerClient({});
  const response = await client.send(new GetSecretValueCommand({ SecretId: arn }));
  if (!response.SecretString) {
    throw new SecretUnavailable(`Secret ${arn} holds no string value.`);
  }
  // Cached for the life of the execution environment. Rotating the secret
  // means a new function version, which is what a deploy already does.
  cached = response.SecretString;
  return cached;
}

/** Tests only: forget what was fetched. */
export function forgetSecret(): void {
  cached = null;
}
