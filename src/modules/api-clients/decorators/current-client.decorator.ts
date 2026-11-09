import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ApiClient } from '@prisma/client';
import { RequestWithClient } from '../../../common/types/request-with-context';

export const CurrentApiClient = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApiClient => {
    const request = ctx.switchToHttp().getRequest<RequestWithClient>();
    return request.apiClient;
  },
);
