// Single shared Prisma client. Importing this from anywhere gives you the same
// instance, which matters because Prisma manages a connection pool internally
// and we don't want multiple pools fighting for connections.

import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});
