import { hasDatabase } from "@/lib/prisma";
import type { Repository } from "./repository";
import { memoryRepository } from "./memory";
import { prismaRepository } from "./prisma-repository";

export type { Repository, TicketBoard, Workbench } from "./repository";

/**
 * Single data-access entry point for the app.
 *
 * With DATABASE_URL set, queries go to PostgreSQL via Prisma. Without it the
 * dashboard and intake endpoint run against in-memory demo fixtures so the
 * platform can be explored before infrastructure exists.
 */
export const repository: Repository = hasDatabase ? prismaRepository : memoryRepository;

export const dataMode: "postgres" | "demo" = hasDatabase ? "postgres" : "demo";
