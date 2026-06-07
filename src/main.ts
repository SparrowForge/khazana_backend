import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { PrismaService } from './database/prisma.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const prefix = process.env.API_PREFIX || 'api';
  const version = process.env.API_VERSION || 'v1';
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

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  });

  // Swagger Configuration
  const config = new DocumentBuilder()
    .setTitle('Khazana POS API')
    .setDescription(
      '## Khazana POS Backend API\n\n' +
      'A complete Point of Sale system for retail management.\n\n' +
      '### Modules\n' +
      '- **Auth** — Login, profile, change password\n' +
      '- **Users** — User management and role assignment\n' +
      '- **Roles & Permissions** — RBAC management\n' +
      '- **Menus** — Menu item configuration\n' +
      '- **Customers** — Customer management and ledger\n' +
      '- **Sales** — Cash sales, credit sales, VAT cash/credit\n' +
      '- **Inventory** — Items, stock receive, issue, adjustment\n' +
      '- **Pricing** — Sale prices and cost prices\n' +
      
      '- **Orders** — Order management (cash and VAT)\n' +
      '- **Finance** — Money receive and cash purchases\n' +
      '- **Packets** — Packet stock management\n' +
      '- **NC Adjustment** — Non-conformance adjustments\n' +
      '- **Assortment** — Assortment sales\n' +
      '- **Reports** — Sales, stock, daily, customer statement\n' +
      '- **Admin** — Branches, system settings, banks, audit logs\n\n' +
      '### Authentication\n' +
      'All endpoints except `POST /auth/login` require a Bearer JWT token.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Enter JWT token' },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  
  // Swagger at root path (not prefixed with api/v1)
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  
  console.log(`Backend running on http://localhost:${port}/${globalPrefix}`);
  console.log(`Swagger documentation available at http://localhost:${port}/api/docs`);
}

bootstrap();