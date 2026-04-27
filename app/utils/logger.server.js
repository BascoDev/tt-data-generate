import prisma from "../db.server";

// Only enable logging in development mode
const isDev = process.env.NODE_ENV !== "production";

export async function logDebug(shop, source, message, details = null) {
  // Skip logging in production
  if (!isDev) return;

  try {
    // Keep last 10 logs for debugging
    const existingLogs = await prisma.debugLog.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 10
    });

    // If we have 10 logs, delete the oldest one
    if (existingLogs.length >= 10) {
      const oldestLog = existingLogs[existingLogs.length - 1];
      await prisma.debugLog.delete({
        where: { id: oldestLog.id }
      });
    }

    // Create new log
    await prisma.debugLog.create({
      data: {
        shop,
        source,
        message,
        details: details ? JSON.stringify(details) : null,
        level: "info"
      }
    });
  } catch (error) {
    console.error("[Logger] Failed to save log:", error);
  }
}

export async function logError(shop, source, message, details = null) {
  // Skip logging in production
  if (!isDev) return;

  try {
    // Keep last 5 logs for debugging
    const existingLogs = await prisma.debugLog.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 5
    });

    // If we have 5 logs, delete the oldest one
    if (existingLogs.length >= 5) {
      const oldestLog = existingLogs[existingLogs.length - 1];
      await prisma.debugLog.delete({
        where: { id: oldestLog.id }
      });
    }

    // Create new log
    await prisma.debugLog.create({
      data: {
        shop,
        source,
        message,
        details: details ? JSON.stringify(details) : null,
        level: "error"
      }
    });
  } catch (error) {
    console.error("[Logger] Failed to save error log:", error);
  }
}

export async function getRecentLogs(shop, limit = 50) {
  // Return empty in production
  if (!isDev) return [];

  try {
    const logs = await prisma.debugLog.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: limit
    });
    return logs;
  } catch (error) {
    console.error("[Logger] Failed to fetch logs:", error);
    return [];
  }
}

export async function clearOldLogs(shop, days = 7) {
  // Skip in production
  if (!isDev) return;

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    await prisma.debugLog.deleteMany({
      where: {
        shop,
        createdAt: {
          lt: cutoff
        }
      }
    });
  } catch (error) {
    console.error("[Logger] Failed to clear old logs:", error);
  }
}

// Export isDev for use in other files
export { isDev };
