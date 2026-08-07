import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe, LogLevel } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { BigIntInterceptor } from './common/interceptors/bigint.interceptor';

function warnIfSupabasePoolConfigLooksWeak(logger: Logger) {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) return;

  const cleaned = raw.replace(/^"|"$/g, '');
  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    return;
  }

  const host = parsed.hostname.toLowerCase();
  if (!host.includes('supabase.com')) {
    return;
  }

  const warnings: string[] = [];
  if (parsed.port !== '6543') {
    warnings.push('expected Supabase pooler port 6543');
  }
  if (parsed.searchParams.get('pgbouncer') !== 'true') {
    warnings.push('missing pgbouncer=true');
  }
  if (!parsed.searchParams.has('connection_limit')) {
    warnings.push('missing connection_limit');
  } else {
    const connectionLimit = Number(parsed.searchParams.get('connection_limit'));
    if (!Number.isFinite(connectionLimit) || connectionLimit < 20) {
      warnings.push('connection_limit is below recommended minimum (20)');
    }
  }
  if (!parsed.searchParams.has('pool_timeout')) {
    warnings.push('missing pool_timeout');
  } else {
    const poolTimeout = Number(parsed.searchParams.get('pool_timeout'));
    if (!Number.isFinite(poolTimeout) || poolTimeout > 10) {
      warnings.push('pool_timeout is above recommended maximum (10)');
    }
  }

  if (warnings.length > 0) {
    logger.warn(`DATABASE_URL Supabase pool tuning recommendation: ${warnings.join(', ')}`);
  }
}

function resolveNestLogLevels(): LogLevel[] {
  const raw = (process.env.NEST_LOG_LEVELS ?? '').trim();
  if (!raw) {
    return ['log', 'warn', 'error'];
  }

  const allowed = new Set<LogLevel>([
    'log',
    'error',
    'warn',
    'debug',
    'verbose',
    'fatal',
  ]);

  const parsed = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is LogLevel => allowed.has(item as LogLevel));

  return parsed.length > 0 ? parsed : ['log', 'warn', 'error'];
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  warnIfSupabasePoolConfigLooksWeak(logger);
  const app = await NestFactory.create(AppModule, {
    logger: resolveNestLogLevels(),
  });
  const trustProxy = process.env.TRUST_PROXY;

  if (trustProxy) {
    (app as unknown as { set: (key: string, value: string | number) => void }).set(
      'trust proxy',
      trustProxy === 'true' ? 1 : trustProxy,
    );
  }

  const corsOrigins = Array.from(
    new Set(
      [
        process.env.FRONTEND_URL,
        ...(process.env.FRONTEND_URLS ?? '').split(','),
        'http://localhost:3000',
        'http://127.0.0.1:3000',
      ]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );

  app.enableCors({
    origin: corsOrigins,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalInterceptors(new BigIntInterceptor());

  const config = new DocumentBuilder()
    .setTitle('BlitzMine API')
    .setDescription('Backend API for BlitzMine on MagicBlock Ephemeral Rollups')
    .setVersion('0.1.0')
    .addTag('mining')
    .addTag('analytics')
    .addTag('chat')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`BlitzMine backend running on port ${port}`);
}

bootstrap();
