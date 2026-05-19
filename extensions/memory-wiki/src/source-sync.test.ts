import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncMemoryWikiImportedSources } from "./source-sync.js";
import {
  createWikiApplyTool,
  createWikiGetTool,
  createWikiSearchTool,
  createWikiStatusTool,
} from "./tool.js";

const {
  syncBridgeMock,
  syncUnsafeLocalMock,
  refreshIndexesMock,
  resolveStatusMock,
  renderStatusMock,
  searchWikiMock,
  getWikiMock,
  normalizeMutationMock,
  applyMutationMock,
} = vi.hoisted(() => ({
  syncBridgeMock: vi.fn(),
  syncUnsafeLocalMock: vi.fn(),
  refreshIndexesMock: vi.fn(),
  resolveStatusMock: vi.fn(),
  renderStatusMock: vi.fn(),
  searchWikiMock: vi.fn(),
  getWikiMock: vi.fn(),
  normalizeMutationMock: vi.fn(),
  applyMutationMock: vi.fn(),
}));

vi.mock("./bridge.js", () => ({
  syncMemoryWikiBridgeSources: syncBridgeMock,
}));

vi.mock("./unsafe-local.js", () => ({
  syncMemoryWikiUnsafeLocalSources: syncUnsafeLocalMock,
}));

vi.mock("./compile.js", () => ({
  refreshMemoryWikiIndexesAfterImport: refreshIndexesMock,
}));

vi.mock("./status.js", () => ({
  resolveMemoryWikiStatus: resolveStatusMock,
  renderMemoryWikiStatus: renderStatusMock,
}));

vi.mock("./query.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./query.js")>()),
  searchMemoryWiki: searchWikiMock,
  getMemoryWikiPage: getWikiMock,
}));

vi.mock("./apply.js", () => ({
  normalizeMemoryWikiMutationInput: normalizeMutationMock,
  applyMemoryWikiMutation: applyMutationMock,
}));

const bridgeResult = {
  importedCount: 1,
  updatedCount: 2,
  skippedCount: 3,
  removedCount: 4,
  artifactCount: 10,
  workspaces: 2,
  pagePaths: ["sources/alpha.md"],
};

describe("syncMemoryWikiImportedSources", () => {
  beforeEach(() => {
    syncBridgeMock.mockReset();
    syncUnsafeLocalMock.mockReset();
    refreshIndexesMock.mockReset();
    syncBridgeMock.mockResolvedValue(bridgeResult);
    syncUnsafeLocalMock.mockResolvedValue({
      ...bridgeResult,
      workspaces: 0,
    });
    refreshIndexesMock.mockResolvedValue({
      refreshed: true,
      reason: "import-changed",
      compile: { updatedFiles: ["index.md", "sources/index.md"] },
    });
    resolveStatusMock.mockReset();
    renderStatusMock.mockReset();
    searchWikiMock.mockReset();
    getWikiMock.mockReset();
    normalizeMutationMock.mockReset();
    applyMutationMock.mockReset();
    resolveStatusMock.mockResolvedValue({ vaultMode: "bridge" });
    renderStatusMock.mockReturnValue("status ok");
    searchWikiMock.mockResolvedValue([]);
    getWikiMock.mockResolvedValue({ content: "page" });
    normalizeMutationMock.mockReturnValue({ op: "create_synthesis", title: "T", body: "B" });
    applyMutationMock.mockResolvedValue({
      changed: true,
      pagePath: "Syntheses/T.md",
      operation: "create_synthesis",
      compile: { updatedFiles: [] },
    });
  });

  it("routes bridge mode through bridge sync and merges refresh results", async () => {
    const config = { vaultMode: "bridge" } as Parameters<
      typeof syncMemoryWikiImportedSources
    >[0]["config"];
    const appConfig = { agents: { list: [{ id: "main", default: true }] } } as Parameters<
      typeof syncMemoryWikiImportedSources
    >[0]["appConfig"];

    const result = await syncMemoryWikiImportedSources({ config, appConfig });

    expect(syncBridgeMock).toHaveBeenCalledWith({ config, appConfig });
    expect(syncUnsafeLocalMock).not.toHaveBeenCalled();
    expect(refreshIndexesMock).toHaveBeenCalledWith({
      config,
      syncResult: bridgeResult,
    });
    expect(result).toEqual({
      ...bridgeResult,
      indexesRefreshed: true,
      indexRefreshReason: "import-changed",
      indexUpdatedFiles: ["index.md", "sources/index.md"],
    });
  });

  it("routes unsafe-local mode through unsafe-local sync", async () => {
    const unsafeLocalResult = {
      ...bridgeResult,
      importedCount: 2,
      workspaces: 0,
      pagePaths: ["sources/private.md"],
    };
    syncUnsafeLocalMock.mockResolvedValueOnce(unsafeLocalResult);
    refreshIndexesMock.mockResolvedValueOnce({
      refreshed: false,
      reason: "auto-compile-disabled",
    });
    const config = { vaultMode: "unsafe-local" } as Parameters<
      typeof syncMemoryWikiImportedSources
    >[0]["config"];

    const result = await syncMemoryWikiImportedSources({ config });

    expect(syncUnsafeLocalMock).toHaveBeenCalledWith(config);
    expect(syncBridgeMock).not.toHaveBeenCalled();
    expect(refreshIndexesMock).toHaveBeenCalledWith({
      config,
      syncResult: unsafeLocalResult,
    });
    expect(result).toEqual({
      ...unsafeLocalResult,
      indexesRefreshed: false,
      indexRefreshReason: "auto-compile-disabled",
      indexUpdatedFiles: [],
    });
  });

  it("returns a no-op sync result outside imported-source modes", async () => {
    const config = { vaultMode: "isolated" } as Parameters<
      typeof syncMemoryWikiImportedSources
    >[0]["config"];

    const result = await syncMemoryWikiImportedSources({ config });

    expect(syncBridgeMock).not.toHaveBeenCalled();
    expect(syncUnsafeLocalMock).not.toHaveBeenCalled();
    expect(refreshIndexesMock).toHaveBeenCalledWith({
      config,
      syncResult: {
        importedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        removedCount: 0,
        artifactCount: 0,
        workspaces: 0,
        pagePaths: [],
      },
    });
    expect(result).toEqual({
      importedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      removedCount: 0,
      artifactCount: 0,
      workspaces: 0,
      pagePaths: [],
      indexesRefreshed: true,
      indexRefreshReason: "import-changed",
      indexUpdatedFiles: ["index.md", "sources/index.md"],
    });
  });
});

describe("memory wiki tool imported-source sync gating", () => {
  beforeEach(() => {
    syncBridgeMock.mockReset();
    syncUnsafeLocalMock.mockReset();
    refreshIndexesMock.mockReset();
    syncBridgeMock.mockResolvedValue(bridgeResult);
    syncUnsafeLocalMock.mockResolvedValue({
      ...bridgeResult,
      workspaces: 0,
    });
    refreshIndexesMock.mockResolvedValue({
      refreshed: true,
      reason: "import-changed",
      compile: { updatedFiles: ["index.md", "sources/index.md"] },
    });
  });

  const config = {
    vaultMode: "bridge",
    ingest: { importedSourceSyncMinIntervalMs: 60_000 },
    search: { backend: "local", corpus: "wiki" },
  } as Parameters<typeof createWikiStatusTool>[0];

  it("two rapid wiki_status calls with forceSync only trigger one sync", async () => {
    const tool = createWikiStatusTool(config);

    await tool.execute("call-1", { forceSync: true });
    await tool.execute("call-2", { forceSync: true });

    expect(syncBridgeMock).toHaveBeenCalledTimes(1);
  });

  it("wiki_search and wiki_get without forceSync trigger zero syncs", async () => {
    const searchTool = createWikiSearchTool(config);
    const getTool = createWikiGetTool(config);

    await searchTool.execute("call-1", { query: "alpha" });
    await getTool.execute("call-2", { lookup: "alpha" });

    expect(syncBridgeMock).not.toHaveBeenCalled();
  });

  it("wiki_apply still triggers a sync", async () => {
    const tool = createWikiApplyTool(config);

    await tool.execute("call-1", { op: "create_synthesis", title: "T", body: "B" });

    expect(syncBridgeMock).toHaveBeenCalledTimes(1);
  });
});
