import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';

@Injectable()
export class BigIntInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((value) => this.serialize(value)));
  }

  private serialize(value: unknown): unknown {
    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.serialize(item));
    }

    if (value instanceof Date || value === null || value === undefined) {
      return value;
    }

    if (typeof value === 'object') {
      if ('toBase58' in value && typeof value.toBase58 === 'function') {
        return value.toBase58();
      }
      const obj = value as Record<string, unknown>;
      const serialized: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(obj)) {
        serialized[key] = this.serialize(item);
      }
      return serialized;
    }

    return value;
  }
}
