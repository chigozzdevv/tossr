const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const markets = await prisma.market.findMany();
  console.log(JSON.stringify(markets, null, 2));
}

main().finally(() => prisma.$disconnect());
