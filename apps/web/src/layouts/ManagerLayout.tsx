import { Outlet } from "react-router-dom";

export default function ManagerLayout() {
  return (
    <div className="mx-auto max-w-6xl p-6">
      <Outlet />
    </div>
  );
}
