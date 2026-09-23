import { DEFAULT_INTERVAL_MINUTES, normalizeInterval } from './schedule';
import type { Snapshot } from './snapshot';

const SNAPSHOT_KEY = 'snapshot';
const INTERVAL_KEY = 'intervalMinutes';

// chrome.storage の値は型を持たないので、キーごとの読み書きと型付けをここに集約する
const onLocalChanged = (key: string, listener: (value: unknown) => void): void =>
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = changes[key];
    if (area === 'local' && change) listener(change.newValue);
  });

const load = async (key: string): Promise<unknown> => (await chrome.storage.local.get(key))[key];

export const loadSnapshot = async (): Promise<Snapshot | undefined> =>
  (await load(SNAPSHOT_KEY)) as Snapshot | undefined;

export const saveSnapshot = (snapshot: Snapshot): Promise<void> =>
  chrome.storage.local.set({ [SNAPSHOT_KEY]: snapshot });

export const onSnapshotChanged = (listener: (snapshot: Snapshot | undefined) => void): void =>
  onLocalChanged(SNAPSHOT_KEY, (value) => listener(value as Snapshot | undefined));

// 未設定や不正な値が保存されていても、既定の間隔で動き続けるようにする
const toInterval = (value: unknown): number => normalizeInterval(value) ?? DEFAULT_INTERVAL_MINUTES;

export const loadIntervalMinutes = async (): Promise<number> => toInterval(await load(INTERVAL_KEY));

export const saveIntervalMinutes = (minutes: number): Promise<void> =>
  chrome.storage.local.set({ [INTERVAL_KEY]: minutes });

export const onIntervalChanged = (listener: (minutes: number) => void): void =>
  onLocalChanged(INTERVAL_KEY, (value) => listener(toInterval(value)));
