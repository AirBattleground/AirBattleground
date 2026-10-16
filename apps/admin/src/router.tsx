import { lazy, Suspense, type ComponentType } from "react";
import { createBrowserRouter } from "react-router-dom";
import { FullPageLoader } from "@7xen/ui/components/brand/page";
import { RequireAdmin } from "@/lib/guards";

const page = (load: () => Promise<{ default: ComponentType }>) => {
  const C = lazy(load);
  return (
    <Suspense fallback={<FullPageLoader />}>
      <C />
    </Suspense>
  );
};
const AdminLayout = lazy(() => import("@/layouts/AdminLayout"));

export const router = createBrowserRouter([
  { path: "/login", element: page(() => import("@/pages/LoginPage")) },
  {
    path: "/",
    element: (
      <RequireAdmin>
        <Suspense fallback={<FullPageLoader />}>
          <AdminLayout />
        </Suspense>
      </RequireAdmin>
    ),
    children: [
      { index: true, element: page(() => import("@/pages/DashboardPage")) },
      { path: "managers", element: page(() => import("@/pages/ManagersPage")) },
      { path: "teams", element: page(() => import("@/pages/TeamsPage")) },
    ],
  },
  { path: "*", element: page(() => import("@/pages/NotFoundPage")) },
]);
