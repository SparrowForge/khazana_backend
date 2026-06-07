import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, user, ip, headers } = request;

    const mutatingMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
    if (!mutatingMethods.includes(method)) return next.handle();

    return next.handle().pipe(
      tap(async () => {
        if (!user) return;
        await this.prisma.auditLog.create({
          data: {
            actionPage: url,
            actionDone: method,
            userName: user.userName,
            date: new Date(),
            ipAddress: ip,
            userAgent: headers['user-agent'],
          },
        });
      }),
    );
  }
}
