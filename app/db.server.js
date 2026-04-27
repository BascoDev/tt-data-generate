import { PrismaClient } from "@prisma/client";

let prisma;

if (process.env.NODE_ENV === "production") {
  // Production: always create new instance
  prisma = new PrismaClient();
} else {
  // Development: use global to preserve hot reload
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
  prisma = global.prismaGlobal;
}

export default prisma;
