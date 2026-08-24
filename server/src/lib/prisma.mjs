// Single Prisma client instance shared across the app.
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
