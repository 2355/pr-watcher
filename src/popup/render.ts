import type { DataSourceErrorKind } from '../github/errors';
import type { CiState } from '../github/types';
import type { MyPullRequest, PullRequestRow, Snapshot } from '../snapshot';
import { octicons, type OcticonName } from '../octicons';
import { normalizeInterval } from '../schedule';

export type PopupState = {
  snapshot: Snapshot | undefined;
  refreshing: boolean;
  onRefresh: () => void;
  intervalMinutes: number;
  onIntervalChange: (minutes: number) => void;
  now: Date;
};

type BadgeState = 'open' | 'draft' | 'commented' | 'changes_requested' | 'approved';

const badges: Record<BadgeState, { icon: OcticonName; label: string }> = {
  open: { icon: 'pullRequest', label: 'Open' },
  draft: { icon: 'draft', label: 'Draft' },
  commented: { icon: 'comment', label: 'Commented' },
  changes_requested: { icon: 'fileDiff', label: 'Changes requested' },
  // CI 成功のチェックと見分けられるよう、丸で囲んだチェックにする
  approved: { icon: 'checkCircleFill', label: 'Approved' },
};

// GitHub の PR 一覧と同じく、成功はチェック・失敗は ×・実行中はドットで表す
const ciIcons: Record<CiState, OcticonName> = {
  success: 'check',
  failure: 'x',
  error: 'x',
  pending: 'dotFill',
  expected: 'dotFill',
};

const errorMessages: Record<DataSourceErrorKind, string> = {
  unauthenticated: 'github.com にログインしていません',
  network: 'github.com に接続できません',
  http: 'GitHub からエラーが返されました',
  schema: 'GitHub の仕様が変わった可能性があります',
  rate_limited: 'GitHub から一時的に制限されました',
  unknown: '予期しないエラーが発生しました',
};

const INBOX_URL = 'https://github.com/pulls/inbox';

const timeFormat = new Intl.DateTimeFormat('ja-JP', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const minuteFormat = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' });

const dateTimeFormat = new Intl.DateTimeFormat('ja-JP', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// 行の幅が狭いので短く表し、日単位になっても半日の差が分かるよう時間まで残す
const formatElapsed = (from: Date, now: Date): string => {
  // 時計のずれで負になっても表示が崩れないようにする
  const minutes = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const restHours = hours % 24;
  return `${Math.floor(hours / 24)}d${restHours > 0 ? `${restHours}h` : ''}`;
};

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string; attrs?: Record<string, string> } = {},
  children: Node[] = [],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  // タイトル等は GitHub 上の第三者が書いた文字列なので、HTML として解釈させない
  if (props.text !== undefined) node.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) node.setAttribute(k, v);
  node.append(...children);
  return node;
};

const icon = (name: OcticonName): SVGSVGElement => {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('data-icon', name);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', octicons[name]);
  svg.append(path);
  return svg;
};

const externalLink = (href: string, children: Node[], className?: string): HTMLAnchorElement =>
  el('a', { className, attrs: { href, target: '_blank', rel: 'noopener noreferrer' } }, children);

const myPrBadge = (pr: MyPullRequest): BadgeState => {
  if (pr.isDraft) return 'draft';
  return pr.review.state === 'none' ? 'open' : pr.review.state;
};

const waitingLabel = (waitingSince: string, now: Date): HTMLElement => {
  const since = new Date(waitingSince);
  return el('span', {
    className: 'waiting',
    text: formatElapsed(since, now),
    // 実際の依頼日時ではなく検知した時刻なので、拡張を入れる前や PC がスリープしていた間の依頼は短く出ることを明かしておく
    attrs: { title: `${dateTimeFormat.format(since)} にレビュー待ちを検知` },
  });
};

// reviewers が無い形で保存された古い snapshot も読むので、undefined でも描画を止めない
const reviewersLabel = (reviewers: string[] | undefined): HTMLElement | undefined =>
  reviewers && reviewers.length > 0
    ? el('span', { className: 'reviewers', text: reviewers.map((login) => `@${login}`).join(' ') })
    : undefined;

// 「自分のPR」のレビュアーと見分けがつくよう、作者には by を付ける
const authorLabel = (author: string): HTMLElement => el('span', { className: 'author', text: `by @${author}` });

const prRow = (pr: PullRequestRow, badge: BadgeState, now: Date, people?: HTMLElement): HTMLLIElement => {
  const { icon: iconName, label } = badges[badge];
  const content = [
    el('span', { className: 'badge', attrs: { 'data-state': badge, 'aria-label': label, title: label } }, [
      icon(iconName),
    ]),
    el('span', { className: 'text' }, [
      el('span', { className: 'title', text: pr.title }),
      el('span', { className: 'meta' }, [
        document.createTextNode(`${pr.repo}#${pr.number}`),
        ...(pr.waitingSince ? [waitingLabel(pr.waitingSince, now)] : []),
        ...(people ? [people] : []),
      ]),
    ]),
    ...(pr.ci
      ? [
          el('span', { className: 'ci', attrs: { 'data-ci': pr.ci, title: `CI: ${pr.ci}`, 'aria-label': `CI: ${pr.ci}` } }, [
            icon(ciIcons[pr.ci]),
          ]),
        ]
      : []),
  ];
  // 取得元は非公開エンドポイントなので、想定外の URL が混ざっても javascript: 等を開かないようにする
  const safe = pr.url.startsWith('https://github.com/');
  return el('li', {}, [safe ? externalLink(pr.url, content, 'row') : el('div', { className: 'row' }, content)]);
};

const prSection = (title: string, rows: HTMLLIElement[]): HTMLElement =>
  el('section', {}, [
    el('h2', { text: title }),
    rows.length > 0 ? el('ul', {}, rows) : el('p', { className: 'empty', text: 'なし' }),
  ]);

const intervalControl = ({ intervalMinutes, onIntervalChange }: PopupState): HTMLElement => {
  const input = el('input', {
    className: 'interval',
    attrs: {
      type: 'number',
      min: '1',
      max: '60',
      step: '1',
      value: String(intervalMinutes),
      'data-action': 'interval',
      'aria-label': '更新間隔（分）',
    },
  });
  input.addEventListener('change', () => {
    const minutes = normalizeInterval(input.value.trim() === '' ? Number.NaN : Number(input.value));
    if (minutes === null) {
      // 不正な値のまま表示を残すと、実際に使われている間隔と食い違って見える
      input.value = String(intervalMinutes);
      return;
    }
    onIntervalChange(minutes);
  });
  return el('label', { className: 'interval-control' }, [
    document.createTextNode('更新間隔'),
    input,
    document.createTextNode('分'),
  ]);
};

const header = (state: PopupState): HTMLElement => {
  const { snapshot, refreshing, onRefresh } = state;
  const button = el('button', {
    text: refreshing ? '更新中…' : '更新',
    attrs: { type: 'button', 'data-action': 'refresh' },
  });
  button.disabled = refreshing;
  button.addEventListener('click', onRefresh);
  const fetched = snapshot
    ? `最終取得 ${timeFormat.format(new Date(snapshot.fetchedAt))}`
    : 'まだ取得していません';
  return el('header', {}, [
    el('span', { className: 'fetched', text: fetched }),
    el('span', { className: 'controls' }, [intervalControl(state), button]),
  ]);
};

export const renderPopup = (root: HTMLElement, state: PopupState): void => {
  const { snapshot, now } = state;
  const body: Node[] = [header(state)];

  if (snapshot?.status === 'error') {
    const title = errorMessages[snapshot.error.kind];
    body.push(
      el('div', { className: 'error', attrs: { role: 'alert' } }, [
        el('p', { className: 'error-title', text: title }),
        ...(snapshot.error.message !== title
          ? [el('p', { className: 'error-detail', text: snapshot.error.message })]
          : []),
        // 設定した更新間隔より長く空くので、いつ再開するかを見えるようにする
        ...(snapshot.retryAt
          ? [
              el('p', {
                className: 'error-detail',
                text: `次回の自動取得は ${minuteFormat.format(new Date(snapshot.retryAt))} 以降です`,
              }),
            ]
          : []),
        externalLink(INBOX_URL, [document.createTextNode('github.com/pulls/inbox を開く')]),
      ]),
    );
  } else if (!snapshot) {
    body.push(el('p', { className: 'empty', text: '「更新」を押すと github.com から取得します' }));
  } else {
    if (snapshot.warnings.length > 0) {
      body.push(el('ul', { className: 'warnings' }, snapshot.warnings.map((w) => el('li', { text: w }))));
    }
    body.push(
      prSection('自分のPR', snapshot.myPrs.map((pr) => prRow(pr, myPrBadge(pr), now, reviewersLabel(pr.review.reviewers)))),
      prSection(
        'レビュー中のPR',
        snapshot.reviewRequests.map((pr) => prRow(pr, pr.isDraft ? 'draft' : 'open', now, authorLabel(pr.author))),
      ),
    );
  }

  root.replaceChildren(...body);
};
