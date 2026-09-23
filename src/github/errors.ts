export type DataSourceErrorKind = 'unauthenticated' | 'network' | 'http' | 'schema' | 'rate_limited' | 'unknown';

export class DataSourceError extends Error {
  constructor(
    readonly kind: DataSourceErrorKind,
    message: string,
    // 呼び出し側がエンドポイント固有のステータスの意味（例: 404 が未ログインを表す）を判断できるようにする
    readonly status?: number,
    // 制限されたときに GitHub が Retry-After で指定した待ち時間
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'DataSourceError';
  }
}

// String(e) だとエラーのクラス名まで含まれ、利用者に見せる文言として読みにくい
export const toErrorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
