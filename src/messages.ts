export type RefreshMessage = { type: 'refresh' };

export const isRefreshMessage = (message: unknown): message is RefreshMessage =>
  typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'refresh';
