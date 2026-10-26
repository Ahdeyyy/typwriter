import { errAsync, okAsync } from "neverthrow";
import { fixtures } from "./fixtures";

const params = new URLSearchParams(location.search);
const data = fixtures(params.get("scenario") ?? "full");
const unsupported = () => errAsync("Opening files is unavailable in this visual preview.");

export const listRecentDocuments = () => okAsync([...data.documents]);
export const getRecentWorkspaces = () => okAsync([...data.workspaces]);
export const removeRecentDocument = (path: string) => {
  data.documents = data.documents.filter((entry) => entry !== path);
  return okAsync(undefined);
};
export const removeRecentWorkspace = (path: string) => {
  data.workspaces = data.workspaces.filter((entry) => entry.path !== path);
  return okAsync(undefined);
};
export const clearRecentWorkspaces = () => {
  data.workspaces = [];
  return okAsync(undefined);
};
export const listPackages = () => okAsync([]);
export const createWorkspace = unsupported;
export const initPackageWorkspace = unsupported;
export const workspace = { opening: false, rootPath: null, init: unsupported };
export const onboarding = { shouldAutoShow: () => okAsync(false) };
export const page = { current: { name: "home" }, preload() {}, navigate() {}, back() {} };
export const platform = { isMac: params.get("platform") === "mac", homePath: "C:/Users/Alex" };
export const settings = { keybindings: {} };
export const initializeDocumentOpening = async () => false;
export const openDocumentPath = async () => {};
export const chooseDocument = async () => {};
export const openSettingsWindow = async () => {};
export const open = async () => null;
export const logError = console.error;
export const getCurrentWindow = () => ({
  isMaximized: async () => false,
  onResized: async () => () => {},
  minimize: async () => {},
  toggleMaximize: async () => {},
  close: async () => {},
});
