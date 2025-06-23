export interface ApiResponse<T> {
  status: 'success' | 'error';
  data?: T;
  error?: ApiError;
  meta?: MetaData;
}

export interface ApiError {
  code: string;
  message: string;
  details?: ErrorDetail[];
  stack?: string;
}

export interface ErrorDetail {
  field?: string;
  message: string;
}

export interface MetaData {
  timestamp?: string;
  pagination?: {
    total: number;
    page: number;
    limit: number;
  };
  [key: string]: any;
}
