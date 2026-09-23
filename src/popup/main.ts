import type { RefreshMessage } from '../messages';
import { DEFAULT_INTERVAL_MINUTES } from '../schedule';
import type { Snapshot } from '../snapshot';
import {
  loadIntervalMinutes,
  loadSnapshot,
  onIntervalChanged,
  onSnapshotChanged,
  saveIntervalMinutes,
} from '../storage';
import { renderPopup } from './render';

const root = document.querySelector('main')!;
let snapshot: Snapshot | undefined;
let intervalMinutes = DEFAULT_INTERVAL_MINUTES;
let refreshing = false;

const draw = (): void =>
  renderPopup(root, {
    snapshot,
    refreshing,
    onRefresh,
    intervalMinutes,
    onIntervalChange: (minutes) => void saveIntervalMinutes(minutes),
  });

async function onRefresh(): Promise<void> {
  refreshing = true;
  draw();
  try {
    await chrome.runtime.sendMessage<RefreshMessage>({ type: 'refresh' });
  } finally {
    refreshing = false;
    draw();
  }
}

// ポップアップを開いたままでも、定期取得の結果や設定の変更が反映されるようにする
onSnapshotChanged((next) => {
  snapshot = next;
  draw();
});
onIntervalChanged((next) => {
  intervalMinutes = next;
  draw();
});

[snapshot, intervalMinutes] = await Promise.all([loadSnapshot(), loadIntervalMinutes()]);
draw();
