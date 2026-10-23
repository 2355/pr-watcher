import { describe, expect, it } from 'vitest';
import { deriveAuthorReviewStatus } from '../src/review-status';

const base = {
  me: 'me',
  opinionatedReviews: [],
  pendingReviewers: [],
  sidebarReviewers: [],
};

describe('deriveAuthorReviewStatus', () => {
  it('レビューが無ければ何も立たない', () => {
    expect(deriveAuthorReviewStatus(base)).toEqual({
      state: 'none',
      needsFix: false,
      approved: false,
      reviewers: [],
    });
  });

  it('changes requested があれば要修正になる', () => {
    const status = deriveAuthorReviewStatus({
      ...base,
      opinionatedReviews: [{ login: 'alice', state: 'changes_requested' }],
    });

    expect(status).toEqual({ state: 'changes_requested', needsFix: true, approved: false, reviewers: ['alice'] });
  });

  it('changes requested のレビュアーに再レビューを依頼したら要修正が消える', () => {
    const status = deriveAuthorReviewStatus({
      ...base,
      opinionatedReviews: [{ login: 'alice', state: 'changes_requested' }],
      pendingReviewers: ['alice'],
    });

    expect(status).toEqual({ state: 'none', needsFix: false, approved: false, reviewers: ['alice'] });
  });

  it('commented のレビューも要修正として扱う', () => {
    const status = deriveAuthorReviewStatus({
      ...base,
      sidebarReviewers: [{ login: 'bob', state: 'commented' }],
    });

    expect(status).toEqual({ state: 'commented', needsFix: true, approved: false, reviewers: ['bob'] });
  });

  it('commented のレビュアーに再レビューを依頼したら要修正が消える', () => {
    const status = deriveAuthorReviewStatus({
      ...base,
      sidebarReviewers: [{ login: 'bob', state: 'commented' }],
      pendingReviewers: ['bob'],
    });

    expect(status.needsFix).toBe(false);
  });

  it('bot のレビューは無視する', () => {
    const status = deriveAuthorReviewStatus({
      ...base,
      sidebarReviewers: [{ login: 'coderabbitai[bot]', state: 'commented' }],
    });

    expect(status).toEqual({ state: 'none', needsFix: false, approved: false, reviewers: [] });
  });

  it('自分自身のレビューは無視する', () => {
    const status = deriveAuthorReviewStatus({
      ...base,
      sidebarReviewers: [{ login: 'me', state: 'commented' }],
    });

    expect(status.needsFix).toBe(false);
  });

  it('approve だけなら approved になる', () => {
    const status = deriveAuthorReviewStatus({
      ...base,
      opinionatedReviews: [{ login: 'alice', state: 'approved' }],
    });

    expect(status).toEqual({ state: 'approved', needsFix: false, approved: true, reviewers: ['alice'] });
  });

  it('approve と commented が混在すると要修正を優先して表示しつつ approved も保つ', () => {
    const status = deriveAuthorReviewStatus({
      ...base,
      opinionatedReviews: [{ login: 'alice', state: 'approved' }],
      sidebarReviewers: [{ login: 'bob', state: 'commented' }],
    });

    expect(status).toEqual({ state: 'commented', needsFix: true, approved: true, reviewers: ['bob', 'alice'] });
  });

  it('同じレビュアーの状態は merge_box の判定を優先する', () => {
    const status = deriveAuthorReviewStatus({
      ...base,
      opinionatedReviews: [{ login: 'alice', state: 'approved' }],
      sidebarReviewers: [{ login: 'alice', state: 'commented' }],
    });

    expect(status).toEqual({ state: 'approved', needsFix: false, approved: true, reviewers: ['alice'] });
  });

  it('サイドバーを取得できなかったときは merge_box だけで判定する', () => {
    const status = deriveAuthorReviewStatus({
      ...base,
      opinionatedReviews: [{ login: 'alice', state: 'changes_requested' }],
      sidebarReviewers: null,
    });

    expect(status).toEqual({ state: 'changes_requested', needsFix: true, approved: false, reviewers: ['alice'] });
  });

  it('まだレビューしていない依頼先もレビュアーに含める', () => {
    const status = deriveAuthorReviewStatus({ ...base, pendingReviewers: ['carol'] });

    expect(status.reviewers).toEqual(['carol']);
  });

  it('bot と自分はレビュアーに含めない', () => {
    const status = deriveAuthorReviewStatus({
      ...base,
      sidebarReviewers: [
        { login: 'coderabbitai[bot]', state: 'commented' },
        { login: 'me', state: 'commented' },
      ],
      pendingReviewers: ['copilot[bot]'],
    });

    expect(status.reviewers).toEqual([]);
  });
});
