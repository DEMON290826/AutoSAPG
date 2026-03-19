export type AppTheme = "dark" | "light";

export type ModelHealthStatus = "idle" | "ok" | "error";

export type ModelRegistryItem = {
  id: string;
  vendor: string;
  model: string;
  lastStatus: ModelHealthStatus;
  lastMessage: string;
  lastCheckedAt: string;
};

export type AppSettingsState = {
  apiUrl: string;
  dnaApiKey: string;
  storyApiKeys: string; // Semicolon separated
  dnaStoragePath: string;
  storyStoragePath: string;
  storyCookieJsonPath: string;
  storyWriterChatUrl: string;
  storyReviewerVendor: string;
  storyReviewerModel: string;
  dnaVendor: string;
  dnaModel: string;
  storyBatchSize: number;
  dnaBatchSize: number;
  useStoryReviewer: boolean;
  maxRetries: number;
  retryDelay: number;
};

export type ApiRuntimeStatus = "idle" | "testing" | "ok" | "error";

export type ApiRuntimeHealth = {
  status: ApiRuntimeStatus;
  message: string;
  checkedAt: string;
};
