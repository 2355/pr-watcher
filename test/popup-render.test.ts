// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPopup } from '../src/popup/render';
import type { DataSourceErrorKind } from '../src/github/errors';
import type { MyPullRequest, Snapshot } from '../src/snapshot';
import { myPr, ok, row } from './helpers/builders';

process.env.TZ = 'Asia/Tokyo';

let root: HTMLElement;
const render = (
  snapshot: Snapshot | undefined,
  options: {
    refreshing?: boolean;
    onRefresh?: () => void;
    intervalMinutes?: number;
    onIntervalChange?: (minutes: number) => void;
  } = {},
) =>
  renderPopup(root, {
    snapshot,
    refreshing: options.refreshing ?? false,
    onRefresh: options.onRefresh ?? (() => {}),
    intervalMinutes: options.intervalMinutes ?? 5,
    onIntervalChange: options.onIntervalChange ?? (() => {}),
  });

const intervalInput = () => root.querySelector<HTMLInputElement>('input[data-action="interval"]')!;

const section = (name: string) =>
  [...root.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === name)!;

beforeEach(() => {
  document.body.innerHTML = '<main></main>';
  root = document.querySelector('main')!;
});

describe('renderPopup: 一覧', () => {
  it('自分のPR とレビュー中のPR の 2 セクションに分けて表示する', () => {
    render(ok({ myPrs: [myPr({ number: 10 })], reviewRequests: [row({ number: 20 }), row({ number: 21 })] }));

    expect(section('自分のPR').querySelectorAll('li')).toHaveLength(1);
    expect(section('レビュー中のPR').querySelectorAll('li')).toHaveLength(2);
  });

  it('行はタイトルとリポジトリ#番号を表示し、新しいタブで PR を開くリンクになる', () => {
    render(ok({ reviewRequests: [row({ number: 20, title: '修正する', url: 'https://github.com/o/r/pull/20', repo: 'o/r' })] }));

    const link = section('レビュー中のPR').querySelector('a')!;
    expect(link.getAttribute('href')).toBe('https://github.com/o/r/pull/20');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toContain('修正する');
    expect(link.textContent).toContain('o/r#20');
  });

  it('タイトルは HTML として解釈しない', () => {
    render(ok({ reviewRequests: [row({ title: '<img src=x onerror=alert(1)>' })] }));

    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it.each(['javascript:alert(1)', 'https://evil.example.com/pull/1', 'https://github.com.evil.example/pull/1'])(
    'github.com 以外の URL（%s）はリンクにしない',
    (url) => {
      render(ok({ reviewRequests: [row({ url })] }));

      expect(section('レビュー中のPR').querySelector('a')).toBeNull();
      expect(section('レビュー中のPR').textContent).toContain('タイトル');
    },
  );

  it('対象が無いセクションには「なし」と表示する', () => {
    render(ok());

    expect(section('自分のPR').textContent).toContain('なし');
    expect(section('レビュー中のPR').textContent).toContain('なし');
  });
});

describe('renderPopup: 状態', () => {
  const stateOf = (pr: MyPullRequest) => {
    render(ok({ myPrs: [pr] }));
    const badge = root.querySelector('[data-state]')!;
    return { state: badge.getAttribute('data-state'), label: badge.getAttribute('aria-label') };
  };

  it.each([
    [{ state: 'none' }, 'open', 'Open'],
    [{ state: 'commented' }, 'commented', 'Commented'],
    [{ state: 'changes_requested' }, 'changes_requested', 'Changes requested'],
    [{ state: 'approved' }, 'approved', 'Approved'],
  ] as const)('レビュー状態 %o を %s として表示する', (review, state, label) => {
    expect(stateOf(myPr({ review: { needsFix: false, approved: false, ...review } }))).toEqual({ state, label });
  });

  it('draft はレビュー状態より優先して表示する', () => {
    expect(
      stateOf(myPr({ isDraft: true, review: { state: 'commented', needsFix: true, approved: false } })).state,
    ).toBe('draft');
  });

  it('レビュー依頼の PR は open / draft を表示する', () => {
    render(ok({ reviewRequests: [row({ isDraft: false }), row({ isDraft: true })] }));

    expect([...root.querySelectorAll('[data-state]')].map((e) => e.getAttribute('data-state'))).toEqual([
      'open',
      'draft',
    ]);
  });

  it.each([
    ['success', 'check'],
    ['failure', 'x'],
    ['error', 'x'],
    ['pending', 'dotFill'],
    ['expected', 'dotFill'],
  ] as const)('CI 状態 %s を GitHub と同じ %s アイコンで表示する', (ci, iconName) => {
    render(ok({ reviewRequests: [row({ ci })] }));

    const indicator = root.querySelector('[data-ci]')!;
    expect(indicator.getAttribute('data-ci')).toBe(ci);
    expect(indicator.querySelector('svg')?.getAttribute('data-icon')).toBe(iconName);
  });

  it('approved は CI の成功と見分けられるよう、丸で囲んだチェックで表示する', () => {
    render(ok({ myPrs: [myPr({ review: { state: 'approved', needsFix: false, approved: true } })] }));

    expect(root.querySelector('[data-state] svg')?.getAttribute('data-icon')).toBe('checkCircleFill');
  });

  it('CI が無い PR には CI 表示を出さない', () => {
    render(ok({ reviewRequests: [row({ ci: null })] }));

    expect(root.querySelector('[data-ci]')).toBeNull();
  });
});

describe('renderPopup: ヘッダと警告', () => {
  it('最終取得時刻を表示する', () => {
    render(ok());

    expect(root.textContent).toContain('16:44');
  });

  it('更新ボタンで onRefresh を呼ぶ', () => {
    const onRefresh = vi.fn();
    render(ok(), { onRefresh });

    root.querySelector<HTMLButtonElement>('button[data-action="refresh"]')!.click();

    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('更新中はボタンを押せない', () => {
    render(ok(), { refreshing: true });

    expect(root.querySelector<HTMLButtonElement>('button[data-action="refresh"]')!.disabled).toBe(true);
  });

  it('更新間隔を分単位の入力欄に表示する', () => {
    render(ok(), { intervalMinutes: 10 });

    expect(intervalInput().value).toBe('10');
    expect(root.querySelector('header')?.textContent).toContain('更新間隔');
  });

  it('更新間隔を変えると onIntervalChange を呼ぶ', () => {
    const onIntervalChange = vi.fn();
    render(ok(), { onIntervalChange });

    intervalInput().value = '15';
    intervalInput().dispatchEvent(new Event('change'));

    expect(onIntervalChange).toHaveBeenCalledWith(15);
  });

  it.each(['0', '61', '2.5', ''])('無効な更新間隔 "%s" は反映せず、元の値に戻す', (value) => {
    const onIntervalChange = vi.fn();
    render(ok(), { intervalMinutes: 5, onIntervalChange });

    intervalInput().value = value;
    intervalInput().dispatchEvent(new Event('change'));

    expect(onIntervalChange).not.toHaveBeenCalled();
    expect(intervalInput().value).toBe('5');
  });

  it('警告を表示する', () => {
    render(ok({ warnings: ['レビュー依頼が多すぎるため、一部のみ表示しています'] }));

    expect(root.textContent).toContain('レビュー依頼が多すぎるため、一部のみ表示しています');
  });

  it('まだ取得していなければその旨を表示する', () => {
    render(undefined);

    expect(root.textContent).toContain('まだ取得していません');
  });

  it('まだ取得していなければ更新ボタンで取得できることを案内する', () => {
    render(undefined);

    expect(root.querySelector('.empty')?.textContent).toBe('「更新」を押すと github.com から取得します');
  });
});

describe('renderPopup: エラー', () => {
  const error = (kind: DataSourceErrorKind, message = '詳細'): Extract<Snapshot, { status: 'error' }> => ({
    status: 'error',
    fetchedAt: '2026-09-23T07:44:08.018Z',
    error: { kind, message },
  });

  it('原因と github.com/pulls/inbox を開くリンクを表示する', () => {
    render(error('unauthenticated'));

    expect(root.textContent).toContain('github.com にログインしていません');
    const link = root.querySelector<HTMLAnchorElement>('a[href="https://github.com/pulls/inbox"]')!;
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.textContent).toContain('github.com/pulls/inbox を開く');
  });

  it('形式の変化は仕様変更の可能性として、詳細と共に表示する', () => {
    render(error('schema', 'PR 一覧 の形式が想定と異なります'));

    expect(root.textContent).toContain('仕様が変わった可能性があります');
    expect(root.textContent).toContain('PR 一覧 の形式が想定と異なります');
  });

  it('詳細が見出しと同じ文言なら繰り返さない', () => {
    render(error('unauthenticated', 'github.com にログインしていません'));

    expect(root.textContent?.match(/github\.com にログインしていません/g)).toHaveLength(1);
  });

  it('制限されたときは、次に取得する時刻を表示する', () => {
    render({ ...error('rate_limited', 'HTTP 429'), retryAt: '2026-09-23T08:10:00.000Z' });

    expect(root.textContent).toContain('GitHub から一時的に制限されました');
    expect(root.textContent).toContain('次回の自動取得は 17:10 以降です');
  });

  it('エラー時も最終取得時刻と更新ボタンを表示する', () => {
    render(error('network'));

    expect(root.textContent).toContain('16:44');
    expect(root.querySelector('button[data-action="refresh"]')).not.toBeNull();
  });
});
