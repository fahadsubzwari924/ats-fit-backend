export interface ErrorDetail {
  code: string; // e.g., "INVALID_EMAIL", "DUPLICATE_EMAIL"
  message: string; // e.g., "Invalid email format"
}

export interface ApiResponse<T = any> {
  status: 'success' | 'error';
  payload?: T; // Payload for success responses
  errors?: ErrorDetail[]; // Error details for error responses
  message?: string; // Optional summary message
}
