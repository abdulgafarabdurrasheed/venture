import { useCallback, useEffect, useState } from "react";
import { loadCsrfToken } from "./api/client.js";
import { AuthContext } from "./auth/AuthContext.jsx";
import { Hero } from "./components/Hero.jsx";
import { RulesPage } from "./components/RulesPage.jsx";
import { PlatformGate } from "./platform/PlatformGate.jsx";
import { AdminAirtableSyncPage } from "./pages/AdminAirtableSyncPage.jsx";
import { AdminPage } from "./pages/AdminPage.jsx";
import { AdminReviewPage } from "./pages/AdminReviewPage.jsx";
import { AdminShopOrdersPage } from "./pages/AdminShopOrdersPage.jsx";
import { AdminShopPage } from "./pages/AdminShopPage.jsx";
import { AdminStatsPage } from "./pages/AdminStatsPage.jsx";
import { AdminUsersPage } from "./pages/AdminUsersPage.jsx";
import { FaqPage } from "./pages/FaqPage.jsx";
import { JournalingReviewPage } from "./pages/JournalingReviewPage.jsx";
import { LoginPage } from "./pages/LoginPage.jsx";
import { ProjectsPage } from "./pages/ProjectsPage.jsx";
import { ShopPage } from "./pages/ShopPage.jsx";
import { TestPage } from "./pages/TestPage.jsx";
import { UserAreaPage } from "./pages/UserAreaPage.jsx";

const PUBLIC_PATHS = new Set(["/", "/rules"]);
const PLATFORM_DEFAULT = "/projects";

const PLATFORM_PATHS = new Set([
  "/login",
  "/shop",
  "/projects",
  "/faq",
  "/user",
  "/test",
  "/admin",
]);

function isPlatformPath(pathname) {
  return PLATFORM_PATHS.has(pathname) || pathname.startsWith("/admin/");
}

function canStaffReviewRole(role) {
  return role === "reviewer" || role === "admin" || role === "superadmin";
}

function canFullAdminRole(role) {
  return role === "admin" || role === "superadmin";
}

export default function App() {
  const [auth, setAuth] = useState({ status: "loading", user: null });
  const [platform, setPlatform] = useState({ status: "loading", unlocked: true, required: false });
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  const isLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const isAnyAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");
  const isReviewPath = pathname === "/admin/review" || pathname.startsWith("/admin/review/");
  const isJournalingPath = pathname === "/journaling" || pathname.startsWith("/journaling/");
  const isPublicPath = PUBLIC_PATHS.has(pathname) || isJournalingPath;
  const needsPlatformGate = !isLocalhost && isPlatformPath(pathname) && !isPublicPath;

  const loadMe = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/me", { credentials: "include" });
      const data = response.ok ? await response.json() : { user: null };
      setAuth({ status: "ready", user: data.user ?? null });
    } catch {
      setAuth({ status: "ready", user: null });
    }
  }, []);

  const loadPlatformStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/platform/status", { credentials: "include" });
      const data = response.ok ? await response.json() : { required: false, unlocked: true };
      setPlatform({
        status: "ready",
        required: Boolean(data.required),
        unlocked: Boolean(data.unlocked),
      });
    } catch {
      setPlatform({ status: "ready", required: false, unlocked: true });
    }
  }, []);

  useEffect(() => {
    if (needsPlatformGate || isLocalhost) {
      loadCsrfToken();
    }
  }, [needsPlatformGate, isLocalhost]);

  useEffect(() => {
    if (isPublicPath) {
      loadMe();
      return;
    }

    if (platform.status !== "ready") {
      return;
    }

    if (!platform.required || platform.unlocked) {
      loadMe();
      return;
    }

    setAuth({ status: "ready", user: null });
  }, [isPublicPath, loadMe, platform.required, platform.status, platform.unlocked]);

  useEffect(() => {
    if (needsPlatformGate) {
      loadPlatformStatus();
    } else {
      setPlatform({ status: "ready", required: false, unlocked: true });
    }
  }, [needsPlatformGate, loadPlatformStatus]);

  const waitingForAuth =
    auth.status === "loading" &&
    (isPublicPath || (platform.status === "ready" && (!platform.required || platform.unlocked)));

  if (waitingForAuth || (needsPlatformGate && platform.status === "loading")) {
    return (
      <div className="app-auth-loading" aria-busy="true">
        Loading…
      </div>
    );
  }

  if (needsPlatformGate && platform.required && !platform.unlocked) {
    return <PlatformGate onUnlocked={loadPlatformStatus} />;
  }

  if (isPublicPath) {
    if (isJournalingPath) {
      const [, , projectId, token] = pathname.split("/");
      return <JournalingReviewPage projectId={projectId} token={token} />;
    }
    if (pathname === "/rules") {
      return <RulesPage />;
    }
    return <Hero />;
  }

  if (needsPlatformGate && !auth.user && pathname !== "/login" && !isLocalhost) {
    const returnTo = `${pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    return null;
  }

  const role = auth.user?.role;

  if (isAnyAdminPath && auth.user) {
    if (isReviewPath) {
      if (!canStaffReviewRole(role)) {
        window.location.replace(PLATFORM_DEFAULT);
        return null;
      }
    } else if (!canFullAdminRole(role)) {
      window.location.replace(canStaffReviewRole(role) ? "/admin/review" : PLATFORM_DEFAULT);
      return null;
    }
  }

  if (pathname === "/login" && (auth.user || isLocalhost)) {
    window.location.replace(PLATFORM_DEFAULT);
    return null;
  }

  if (pathname === "/main") {
    window.location.replace(PLATFORM_DEFAULT);
    return null;
  }

  const contextValue = {
    user: auth.user,
    status: auth.status,
    reload: loadMe,
  };

  let page;
  switch (pathname) {
    case "/login":
      page = <LoginPage />;
      break;
    case "/test":
      page = isLocalhost ? <TestPage /> : <AdminPage />;
      break;
    case "/projects":
      page = <ProjectsPage />;
      break;
    case "/shop":
      page = <ShopPage />;
      break;
    case "/faq":
      page = <FaqPage />;
      break;
    case "/user":
      page = <UserAreaPage />;
      break;
    case "/admin":
      page = <AdminPage />;
      break;
    case "/admin/stats":
      page = <AdminStatsPage />;
      break;
    case "/admin/users":
      page = <AdminUsersPage />;
      break;
    case "/admin/airtable_sync":
      page = <AdminAirtableSyncPage />;
      break;
    case "/admin/shop":
      page = <AdminShopPage />;
      break;
    case "/admin/shop/orders":
      page = <AdminShopOrdersPage />;
      break;
    case "/admin/review":
      page = <AdminReviewPage />;
      break;
    default:
      if (pathname.startsWith("/admin/users/")) {
        page = <AdminUsersPage userId={pathname.split("/").pop()} />;
      } else if (pathname.startsWith("/admin/review/project/")) {
        page = <AdminReviewPage projectId={pathname.split("/").pop()} />;
      } else {
        page = <Hero />;
      }
  }

  return <AuthContext.Provider value={contextValue}>{page}</AuthContext.Provider>;
}
