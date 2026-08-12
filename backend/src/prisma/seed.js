const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Dev/test credentials only — change both before any real deployment.
const TEST_OWNER = { username: 'owner', password: 'owner1234', name: 'Test Owner', pin: '123456' };

async function main() {
  const existing = await prisma.user.findUnique({ where: { username: TEST_OWNER.username } });

  if (!existing) {
    const passwordHash = await bcrypt.hash(TEST_OWNER.password, 10);
    const priceEditPinHash = await bcrypt.hash(TEST_OWNER.pin, 10);

    const user = await prisma.user.create({
      data: {
        username: TEST_OWNER.username,
        passwordHash,
        name: TEST_OWNER.name,
        role: 'OWNER',
        priceEditPinHash,
        isPrimaryOwner: true, // this IS the originally-seeded owner account, by definition
      },
    });

    console.log(`Seeded OWNER user: ${user.username} (id ${user.id}) with dev PIN ${TEST_OWNER.pin}, isPrimaryOwner: true`);
    return;
  }

  // Never overwrite passwordHash/priceEditPinHash on an existing user — re-running this script
  // must not silently undo a real password or PIN change made after seeding. isPrimaryOwner is
  // different: it's a system flag, not a secret the account holder manages, and this seeded
  // account IS the originally-seeded owner by definition — backfilling it to true is always
  // correct, never a destructive overwrite of something a real user set themselves.
  const backfill = {};
  if (!existing.priceEditPinHash) {
    backfill.priceEditPinHash = await bcrypt.hash(TEST_OWNER.pin, 10);
  }
  if (!existing.isPrimaryOwner) {
    backfill.isPrimaryOwner = true;
  }

  if (Object.keys(backfill).length > 0) {
    await prisma.user.update({ where: { id: existing.id }, data: backfill });
    console.log(`Backfilled for existing OWNER user '${existing.username}': ${Object.keys(backfill).join(', ')}`);
  } else {
    console.log(`OWNER user '${existing.username}' already fully set up — nothing to do.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
