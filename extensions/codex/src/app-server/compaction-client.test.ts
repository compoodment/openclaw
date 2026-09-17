import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexAppServerClient } from "./client.js";

const sharedClientMocks = vi.hoisted(() => ({
  getLeased: vi.fn(),
  releaseLeased: vi.fn(),
  retainByInstanceId: vi.fn(),
}));

vi.mock("./shared-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./shared-client.js")>()),
  getLeasedSharedCodexAppServerClient: sharedClientMocks.getLeased,
  releaseLeasedSharedCodexAppServerClient: sharedClientMocks.releaseLeased,
  retainSharedCodexAppServerClientByInstanceId: sharedClientMocks.retainByInstanceId,
}));

import { acquireCodexAppServerClientForNativeCompaction } from "./compaction-client.js";

describe("acquireCodexAppServerClientForNativeCompaction", () => {
  beforeEach(() => {
    sharedClientMocks.getLeased.mockReset();
    sharedClientMocks.releaseLeased.mockReset();
    sharedClientMocks.retainByInstanceId.mockReset();
  });

  it("returns the persisted owner without invoking the generic pool", async () => {
    const owner = {} as CodexAppServerClient;
    const releaseOwner = vi.fn();
    sharedClientMocks.retainByInstanceId.mockReturnValue({
      client: owner,
      release: releaseOwner,
    });

    const result = await acquireCodexAppServerClientForNativeCompaction({
      clientId: "owner-client",
      options: {},
    });

    expect(result.client).toBe(owner);
    expect(sharedClientMocks.retainByInstanceId).toHaveBeenCalledWith("owner-client");
    expect(sharedClientMocks.getLeased).not.toHaveBeenCalled();
    result.release();
    expect(releaseOwner).toHaveBeenCalledOnce();
  });

  it("falls back to a new leased client when the persisted owner is gone", async () => {
    const replacement = {} as CodexAppServerClient;
    sharedClientMocks.retainByInstanceId.mockReturnValue(undefined);
    sharedClientMocks.getLeased.mockResolvedValue(replacement);

    const result = await acquireCodexAppServerClientForNativeCompaction({
      clientId: "retired-client",
      options: {},
    });

    expect(result.client).toBe(replacement);
    expect(sharedClientMocks.getLeased).toHaveBeenCalledWith({});
    result.release();
    expect(sharedClientMocks.releaseLeased).toHaveBeenCalledWith(replacement);
  });

  it("does not override an explicitly injected client factory", async () => {
    const replacement = {} as CodexAppServerClient;
    const clientFactory = vi.fn().mockResolvedValue(replacement);

    const result = await acquireCodexAppServerClientForNativeCompaction({
      clientId: "owner-client",
      clientFactory,
      options: {},
    });

    expect(result.client).toBe(replacement);
    expect(sharedClientMocks.retainByInstanceId).not.toHaveBeenCalled();
    expect(clientFactory).toHaveBeenCalledWith({});
    result.release();
    expect(sharedClientMocks.releaseLeased).not.toHaveBeenCalled();
  });
});
