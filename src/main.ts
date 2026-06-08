import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { PrismaService } from './database/prisma.service';

const parseOrigins = (value?: string): string[] =>
  value
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];

const getAllowedOrigins = (): string[] => {
  const origins = new Set<string>(['http://localhost:3000']);

  for (const origin of parseOrigins(process.env.FRONTEND_URL)) {
    origins.add(origin);
  }

  for (const origin of parseOrigins(process.env.CORS_ORIGINS)) {
    origins.add(origin);
  }

  return [...origins];
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const prefix = process.env.API_PREFIX || 'api';
  const version = process.env.API_VERSION || 'v1';
  const allowedOrigins = getAllowedOrigins();
  const globalPrefix = `${prefix}/${version}`;

  app.setGlobalPrefix(globalPrefix);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const prisma = app.get(PrismaService);
  app.useGlobalInterceptors(new AuditInterceptor(prisma)); 

  // Swagger Configuration
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Pharmacy Management API')
    .setDescription('Pharmacy backend API documentation')
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        in: 'header',
        description: 'Enter JWT access token',
      },
      'bearer',
    )
    .addSecurityRequirements('bearer')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS`), false);
    },
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 4000);
}

bootstrap();