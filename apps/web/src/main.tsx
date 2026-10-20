import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@7xen/ui/theme";
import { TourProvider } from "@7xen/ui/tour";
import { Toaster } from "@7xen/ui/components/ui/sonner";
import { TooltipProvider } from "@7xen/ui/components/ui/tooltip";
import { queryClient } from "@/lib/query";
import { AuthProvider } from "@/lib/auth";
import { SkinProvider } from "@/lib/skin";
import { router } from "@/router";
import { LocaleProvider } from "@/i18n/core";
import { installChunkReload } from "@/lib/chunkReload";
import { splashFailsafe } from "@/lib/splash";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <SkinProvider>
        <TourProvider>
          <AuthProvider>
            <LocaleProvider>
              <TooltipProvider delayDuration={200}>
                <RouterProvider router={router} />
                <Toaster richColors closeButton position="top-right" />
              </TooltipProvider>
            </LocaleProvider>
          </AuthProvider>
        </TourProvider>
        </SkinProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);

installChunkReload();
splashFailsafe();
