import { PaginationMeta } from './pagination.helper';

export interface PaginatedApiResponse<T> {
  success: boolean;
  message: string;
  data: {
    items: T[];
    meta: PaginationMeta;
  };
}

export function paginatedResponse<T>(
  items: T[],
  meta: PaginationMeta,
  entityName: string,
): PaginatedApiResponse<T> {
  return {
    success: true,
    message: `${entityName} retrieved successfully`,
    data: { items, meta },
  };
}
