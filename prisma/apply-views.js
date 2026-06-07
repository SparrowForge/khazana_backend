// Uses the generated Prisma client (no pg dependency needed)
const { PrismaClient } = require('../src/generated/prisma');
const fs = require('fs');
const path = require('path');

// Load .env manually
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .forEach(line => {
      const [k, ...v] = line.split('=');
      if (k && !k.startsWith('#')) process.env[k.trim()] = v.join('=').trim();
    });
}

const prisma = new PrismaClient();

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'views.sql'), 'utf8');
  // Split on semicolons that end a CREATE OR REPLACE VIEW block
  const statements = sql
    .split(/;\s*(?=\n|$)/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  let ok = 0, fail = 0;
  for (const stmt of statements) {
    const name = (stmt.match(/VIEW\s+(\w+)/i) || [])[1] || stmt.slice(0, 60).replace(/\n/g, ' ');
    try {
      await prisma.$executeRawUnsafe(stmt);
      console.log(`  ✓ ${name}`);
      ok++;
    } catch (e) {
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
