import { PrismaClient } from '../src/generated/prisma';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'views.sql'), 'utf8');
  const statements = sql
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  let ok = 0, fail = 0;
  for (const stmt of statements) {
    const name = (stmt.match(/VIEW\s+(\w+)/i) || [])[1] || stmt.slice(0, 50).replace(/\n/g, ' ');
    try {
      await prisma.$executeRawUnsafe(stmt);
      console.log(`  ✓ ${name}`);
      ok++;
    } catch (e: any) {
      console.error(`  ✗ ${name}: ${e.message}`);
      fail++;
    }
  }

  console.log(`\nDone: ${ok} succeeded, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
