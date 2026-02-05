import { DashboardLayout } from "@/layouts/DashboardLayout";
import { StatsCards } from "@/components/dashboard/StatsCards";
import { JobsList } from "@/components/dashboard/JobsList";
import { UsageChart } from "@/components/dashboard/UsageChart";
import { ServerStatus } from "@/components/dashboard/ServerStatus";

const Index = () => {
  return (
    <DashboardLayout>
      {/* Welcome header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold">مرحباً بك في VideoForge</h1>
        <p className="text-sm text-muted-foreground">
          لوحة التحكم الرئيسية لإدارة إنتاج الفيديو
        </p>
      </div>

      {/* Stats */}
      <section className="mb-6">
        <StatsCards />
      </section>

      {/* Chart + Jobs */}
      <div className="grid gap-6 lg:grid-cols-2">
        <UsageChart />
        <JobsList />
      </div>

      {/* Server status */}
      <section className="mt-6">
        <ServerStatus />
      </section>
    </DashboardLayout>
  );
};

export default Index;
