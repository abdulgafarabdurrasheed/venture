import { listProjectsForUser } from "./projects.js";
import { listShopOrdersForUser } from "./shopItems.js";

const REJECTED_STATUSES = new Set(["rejected", "reship-rejected"]);

function roundHours(value) {
  return Number(Number(value || 0).toFixed(2));
}

function orderStatus(order) {
  if (order.rejected) return "rejected";
  if (order.fulfilled) return "fulfilled";
  return "pending";
}

export async function getUserDashboard(userId) {
  const [projects, orders] = await Promise.all([
    listProjectsForUser(userId),
    listShopOrdersForUser(userId),
  ]);

  const loggedHours = roundHours(projects.reduce((sum, project) => sum + (project.combinedHours ?? project.totalHours ?? 0), 0));
  const approvedHours = roundHours(projects.reduce((sum, project) => sum + (project.approvedHours ?? 0), 0));
  const rejectedHours = roundHours(
    projects
      .filter((project) => REJECTED_STATUSES.has(project.status))
      .reduce((sum, project) => sum + (project.totalHours ?? 0), 0)
  );

  return {
    stats: {
      loggedHours,
      approvedHours,
      rejectedHours,
      orderCount: orders.length,
      totalProjects: projects.length,
    },
    orders: orders.map((order) => ({
      id: order.id,
      itemName: order.itemName,
      quantity: order.quantity,
      totalCoins: order.totalCoins,
      totalUsd: order.totalUsd,
      status: orderStatus(order),
    })),
  };
}
