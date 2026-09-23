export type CiState = 'success' | 'failure' | 'pending' | 'error' | 'expected';

export type PullRequestSummary = {
  id: string;
  number: number;
  title: string;
  url: string;
  repo: string;
  author: string;
  isDraft: boolean;
  updatedAt: string;
};

export type OpinionatedReview = {
  login: string;
  state: 'approved' | 'changes_requested';
};

export type SidebarReviewerState = 'commented' | 'approved' | 'changes_requested' | 'pending';

export type SidebarReviewer = {
  login: string;
  state: SidebarReviewerState;
};
