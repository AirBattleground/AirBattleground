import { Outlet } from "react-router-dom";

export default function AdminLayout() {
  return (
    <div className="mx-auto max-w-6xl p-6">
      <Outlet />
    </div>
  );
}
