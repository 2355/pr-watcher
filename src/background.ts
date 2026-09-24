import { createGitHubClient } from './github/client';
import { drawIcon } from './icon/draw';
import { iconStateOf, type IconState } from './icon/state';
import { isRefreshMessage } from './messages';
import { applyRateLimit, shouldPoll } from './schedule';
import { buildSnapshot, type Snapshot } from './snapshot';
import {
  loadIntervalMinutes,
  loadSnapshot,
  loadWaitingSince,
  onIntervalChanged,
  onSnapshotChanged,
  saveSnapshot,
  saveWaitingSince,
} from './storage';
import { waitingSinceOf } from './waiting-since';

const ALARM = 'refresh';
// 読み物や会議などで操作しない時間は取得を続け、席を離れたと言える長さだけ操作が無ければ止める
const IDLE_DETECTION_SECONDS = 30 * 60;

const renderIcon = (size: number, state: IconState): ImageData => {
  const ctx = new OffscreenCanvas(size, size).getContext('2d')!;
  drawIcon(ctx, size, state, (d) => new Path2D(d));
  return ctx.getImageData(0, 0, size, size);
};

let drawnIcon: string | undefined;

const updateIcon = async (snapshot: Snapshot | undefined): Promise<void> => {
  const state = iconStateOf(snapshot);
  // 取得のたびに保存内容は変わるが、見た目が変わるのは PR の状態が変わったときだけなので描き直しを省く
  const key = JSON.stringify(state);
  if (key === drawnIcon) return;
  // Retina のツールバーでは 32px が使われるので、両方渡してぼやけないようにする
  await chrome.action.setIcon({ imageData: { 16: renderIcon(16, state), 32: renderIcon(32, state) } });
  drawnIcon = key;
};

let inFlight: Promise<void> | null = null;

// 取得に 1 分以上かかった場合にアラームが重なって同じリクエストを二重に投げないようにする
const refresh = (): Promise<void> => {
  inFlight ??= (async () => {
    try {
      const [previous, intervalMinutes, previousWaitingSince] = await Promise.all([
        loadSnapshot(),
        loadIntervalMinutes(),
        loadWaitingSince(),
      ]);
      const snapshot = await buildSnapshot(
        createGitHubClient(fetch.bind(globalThis)),
        () => new Date(),
        previousWaitingSince,
      );
      const waitingSince = waitingSinceOf(snapshot, previousWaitingSince);
      if (waitingSince) await saveWaitingSince(waitingSince);
      await saveSnapshot(applyRateLimit(snapshot, previous, intervalMinutes, new Date()));
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
};

// 手動更新以外の取得はここを通し、離席中と制限による待機中は GitHub へリクエストを送らない
const pollIfNeeded = async (): Promise<void> => {
  const [idleState, snapshot] = await Promise.all([
    chrome.idle.queryState(IDLE_DETECTION_SECONDS),
    loadSnapshot(),
  ]);
  if (shouldPoll({ idleState, snapshot, now: new Date() })) await refresh();
};

const ensureAlarm = async (): Promise<void> => {
  const intervalMinutes = await loadIntervalMinutes();
  const alarm = await chrome.alarms.get(ALARM);
  // 同名で作り直すと既存のアラームは置き換わるので、間隔が変わったときだけ作り直して周期をリセットしない
  if (alarm?.periodInMinutes !== intervalMinutes) {
    await chrome.alarms.create(ALARM, { periodInMinutes: intervalMinutes });
  }
};

const start = (): void => {
  void ensureAlarm();
  void pollIfNeeded();
};

chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);

chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void pollIfNeeded();
});

// 席に戻った時点で最新の状態を見られるよう、次の定期取得を待たずに取得する
chrome.idle.onStateChanged.addListener((state) => {
  if (state === 'active') void pollIfNeeded();
});

onIntervalChanged(() => void ensureAlarm());

// 取得処理から直接呼ばず保存内容に追従させることで、アイコンが常にポップアップと同じデータを表すようにする
onSnapshotChanged((snapshot) => void updateIcon(snapshot));

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isRefreshMessage(message)) return false;
  // 手動更新は利用者の明示的な操作なので、離席判定や制限による待機を無視してすぐ取得する。
  // 取得完了まで応答を保留し、ポップアップが「更新中」表示を解除するタイミングを知れるようにする。保存に失敗しても解除されるよう finally で応答する
  void refresh().finally(() => sendResponse());
  return true;
});
