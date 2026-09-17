import type { CodexAppServerClient } from "./client.js";
import {
  getLeasedSharedCodexAppServerClient,
  releaseLeasedSharedCodexAppServerClient,
  retainSharedCodexAppServerClientByInstanceId,
  type CodexAppServerClientFactory,
  type CodexAppServerClientOptions,
} from "./shared-client.js";

/** Acquires the persisted physical owner for native compaction when it is live. */
export async function acquireCodexAppServerClientForNativeCompaction(params: {
  clientId?: string;
  clientFactory?: CodexAppServerClientFactory;
  options?: CodexAppServerClientOptions;
}): Promise<{ client: CodexAppServerClient; release: () => void }> {
  if (!params.clientFactory) {
    const retained = retainSharedCodexAppServerClientByInstanceId(params.clientId);
    if (retained) {
      return retained;
    }
  }
  const clientFactory = params.clientFactory ?? getLeasedSharedCodexAppServerClient;
  const client = await clientFactory(params.options);
  return {
    client,
    release: params.clientFactory
      ? () => undefined
      : () => {
          releaseLeasedSharedCodexAppServerClient(client);
        },
  };
}
