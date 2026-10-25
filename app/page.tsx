import { AppShell } from "@/components/app-shell";
import { DashboardView } from "@/components/dashboard";

export default function HomePage() {
  return (
    <AppShell>
      <DashboardView />
    </AppShell>
  );
}
