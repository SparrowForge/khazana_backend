/**
 * Regenerates doc/apidoc.json (the static OpenAPI snapshot) from the live Nest
 * decorators. The runtime Swagger UI at /api/docs is always current; this keeps
 * the checked-in snapshot in sync. Branding (info/servers/tags) from the existing
 * file is preserved — only paths + component schemas are refreshed.
 *
 *   npx ts-node --transpile-only --project tsconfig.json scripts/generate-openapi.ts
 */
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });

  const config = new DocumentBuilder()
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', name: 'Authorization', in: 'header', description: 'Enter JWT access token' },
      'bearer',
    )
    .addSecurityRequirements('bearer')
    .build();

  const document: any = SwaggerModule.createDocument(app, config);

  // Preserve existing branding (title/description/servers/tags) so only the API
  // surface (paths + schemas) changes.
  const outPath = path.join(__dirname, '..', 'doc', 'apidoc.json');
  try {
    const existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    if (existing.info) document.info = existing.info;
    if (existing.servers) document.servers = existing.servers;
    if (existing.tags) document.tags = existing.tags;
  } catch {
    /* no existing file — emit a fresh document */
  }

  fs.writeFileSync(outPath, JSON.stringify(document, null, 2) + '\n');
  console.log(`apidoc.json regenerated (${Object.keys(document.paths).length} paths)`);
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
