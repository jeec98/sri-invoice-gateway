import { Request } from 'express';
import { ApiClient, Tenant } from '@prisma/client';

export interface RequestWithClient extends Request {
  apiClient: ApiClient;
}

export interface RequestWithTenant extends RequestWithClient {
  tenant: Tenant;
}
