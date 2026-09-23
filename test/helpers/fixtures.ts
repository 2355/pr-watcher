import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../fixtures/', import.meta.url));

// fixtures は private な実データなのでリポジトリに含めていない。clone 直後でもテストを走らせられるように、無ければ依存テストをスキップする
export const fixturesAvailable = existsSync(dir);

export const loadText = (name: string): string => readFileSync(dir + name, 'utf8');

export const loadJson = (name: string): unknown => JSON.parse(loadText(name));

// 期待値に実データ（組織名・PR タイトル・同僚のログイン名）を書き込まないよう、テストは fixture の生データから期待値を組み立てる
type RawPull = {
  id: string;
  number: number;
  title: string;
  permalink: string;
  repoNameWithOwner: string;
  author: { displayLogin: string };
  isDraft: boolean;
  updatedAt: string;
};

export const rawPulls = (name: string) => {
  const route = (loadJson(name) as {
    payload: { pullsInboxSurfaceContentRoute: { results: RawPull[]; pageInfo: { totalCount: number } } };
  }).payload.pullsInboxSurfaceContentRoute;
  return { results: route.results, totalCount: route.pageInfo.totalCount };
};

export const rawMergeBox = (name: string) =>
  (loadJson(name) as {
    pullRequest: {
      latestOpinionatedReviews: { author: { login: string }; state: string }[];
      pendingReviewRequests: { reviewer: { login: string } }[];
    };
  }).pullRequest;
