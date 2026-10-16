import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

/** Opens a "create" dialog when the URL has ?create=1 (used by dashboard quick actions), then cleans the URL. */
export function useCreateParam() {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (params.get("create") === "1") {
      setOpen(true);
      const next = new URLSearchParams(params);
      next.delete("create");
      setParams(next, { replace: true });
    }
  }, [params, setParams]);
  return [open, setOpen] as const;
}
