import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  onProjectThreadDataChanged: vi.fn<() => () => void>(() => () => {}),
  createDesktopRemoteAccessController: vi.fn<
    (options: unknown) => {
      getServer: () => null;
      handleSupervisorEvent: () => void;
      handleSupervisorReset: () => void;
      updateGitSummaries: () => void;
      startIfEnabled: () => Promise<void>;
      dispose: () => Promise<void>;
    }
  >(() => ({
    getServer: () => null,
    handleSupervisorEvent: () => {},
    handleSupervisorReset: () => {},
    updateGitSummaries: () => {},
    startIfEnabled: () => Promise.resolve(),
    dispose: () => Promise.resolve(),
  })),
  readOrCreateRemoteAccessIdentity: vi.fn<(baseDir: string) => { desktopId: string }>(() => ({
    desktopId: "desktop-1",
  })),
}));

vi.mock("@/main/db", () => ({
  dbGetProjects: vi.fn<() => never[]>(() => []),
  dbGetThreads: vi.fn<() => never[]>(() => []),
  dbMarkLiveThreadsInactive: vi.fn<() => void>(() => {}),
  onProjectThreadDataChanged: mocks.onProjectThreadDataChanged,
}));

vi.mock("@/main/remote/DesktopRemoteAccessController", () => ({
  createDesktopRemoteAccessController: mocks.createDesktopRemoteAccessController,
}));

vi.mock("@/main/remote/pairingInfo", () => ({
  getRemoteAccessPairingInfo: vi.fn<() => null>(() => null),
}));

vi.mock("@/main/profile", () => ({
  getProfileCoreStats: vi.fn<() => null>(() => null),
  getProfileDevicesResponse: vi.fn<() => null>(() => null),
  getProfileIdentityResponse: vi.fn<() => null>(() => null),
  getProfileTokenStats: vi.fn<() => null>(() => null),
  setProfileIdentityResponse: vi.fn<() => null>(() => null),
}));

vi.mock("@/main/sharedSettingsFile", () => ({
  readSharedSettingsFile: vi.fn<() => Record<string, never>>(() => ({})),
  writeSharedSettingsFile: vi.fn<() => void>(() => {}),
}));

vi.mock("@/main/remote/identity", () => ({
  readOrCreateRemoteAccessIdentity: mocks.readOrCreateRemoteAccessIdentity,
}));

vi.mock("@/main/legacyDataMigration", () => ({
  requestLegacyDataMigration: vi.fn<() => null>(() => null),
}));

vi.mock("./BackendDurableServices", () => ({
  BackendDurableServices: class {
    scheduleService = {};
    prWatchService = {};
    gitStateService = {};
    getSupervisorExtraEnv = () => ({});
    startIngress = () => Promise.resolve();
    startBackgroundServices = () => {};
    observeSupervisorEvent = () => {};
    dispose = () => {};
  },
}));

vi.mock("./BackendRemoteBrowserProxy", () => ({
  BackendRemoteBrowserProxy: class {
    publish = () => {};
    dispose = () => {};
  },
}));

vi.mock("./BackendImagePreview", () => ({
  generateBackendImagePreview: vi.fn<() => null>(() => null),
}));

import { affectsShellProjection, BackendDesktopServices } from "./BackendDesktopServices";
import type { BackendHostCore } from "./BackendHostCore";
import type { BackendHostInitializePayload } from "@/shared/backendHostProtocol";

function initialize(desktop: boolean): BackendHostInitializePayload {
  return {
    baseDir: "/data",
    dbPath: "/data/state.sqlite",
    supervisor: {
      appVersion: "test",
      isDev: false,
      supervisorPath: "/supervisor.cjs",
      wslHelpersDir: "/wsl",
      secretStorageKey: "secret",
    },
    ...(desktop
      ? { desktop: { channel: "stable" as const, settingsPath: "/data/settings.json" } }
      : {}),
  };
}

function options(desktop: boolean) {
  return {
    initialize: initialize(desktop),
    host: {
      supervisorClient: { call: vi.fn<() => null>(() => null) },
    } as unknown as BackendHostCore,
    requestNative: vi.fn<(request: never) => Promise<unknown>>(() => Promise.resolve(null)),
    emitNativeEvent: vi.fn<(event: never) => void>(() => {}),
    reportError: vi.fn<(error: unknown) => void>(() => {}),
    setRemoteEventInterests: vi.fn<(interests: never) => void>(() => {}),
  };
}

describe("BackendDesktopServices projection invalidation", () => {
  it("never turns shell projection reads into another invalidation", () => {
    expect(affectsShellProjection("dbGetProjects")).toBe(false);
    expect(affectsShellProjection("dbGetThreads")).toBe(false);
    expect(affectsShellProjection("dbGetState")).toBe(false);
    expect(affectsShellProjection("dbUpsertProject")).toBe(true);
    expect(affectsShellProjection("dbUpsertThread")).toBe(true);
  });
});

describe("BackendDesktopServices supervisor reset", () => {
  beforeEach(() => {
    mocks.createDesktopRemoteAccessController.mockClear();
  });

  it("forwards supervisor reset to the desktop remote controller", () => {
    const handleSupervisorReset = vi.fn<() => void>(() => {});
    mocks.createDesktopRemoteAccessController.mockImplementationOnce(() => ({
      getServer: () => null,
      handleSupervisorEvent: () => {},
      handleSupervisorReset,
      updateGitSummaries: () => {},
      startIfEnabled: () => Promise.resolve(),
      dispose: () => Promise.resolve(),
    }));
    const services = new BackendDesktopServices(options(true));

    services.handleSupervisorReset();

    expect(handleSupervisorReset).toHaveBeenCalledOnce();
  });

  it("no-ops supervisor reset without desktop remote access", () => {
    const services = new BackendDesktopServices(options(false));

    expect(() => services.handleSupervisorReset()).not.toThrow();
    expect(mocks.createDesktopRemoteAccessController).not.toHaveBeenCalled();
  });
});
