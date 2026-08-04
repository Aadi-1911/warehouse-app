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
      data: { username: TEST_OWNER.username, passwordHash, name: TEST_OWNER.name, role: 'OWNER', priceEditPinHash },
    });

    console.log(`Seeded OWNER user: ${user.username} (id ${user.id}) with dev PIN ${TEST_OWNER.pin}`);
    return;
  }

  // Never overwrite passwordHash/priceEditPinHash on an existing user — re-running this script
  // must not silently undo a real password or PIN change made after seeding.
  if (!existing.priceEditPinHash) {
    const priceEditPinHash = await bcrypt.hash(TEST_OWNER.pin, 10);
    await prisma.user.update({ where: { id: existing.id }, data: { priceEditPinHash } });
    console.log(`Backfilled dev PIN ${TEST_OWNER.pin} for existing OWNER user: ${existing.username}`);
  } else {
    console.log(`OWNER user '${existing.username}' already exists with a PIN set — nothing to do.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
