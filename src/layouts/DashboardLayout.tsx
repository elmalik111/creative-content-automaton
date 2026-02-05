import { Link, useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  Video,
  Bell,
  Settings,
  FileText,
  PlusCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "لوحة التحكم", icon: LayoutDashboard, href: "/" },
  { label: "إنشاء فيديو", icon: PlusCircle, href: "/" },
  { label: "المهام", icon: FileText, href: "/" },
  { label: "القوالب", icon: Video, href: "/" },
  { label: "الإعدادات", icon: Settings, href: "/settings" },
  { label: "التوثيق", icon: Bell, href: "/" },
];

function SidebarNav() {
  const { pathname } = useLocation();
  const { open } = useSidebar();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <SidebarContent>
      {/* Logo area */}
      <div className="flex items-center gap-2 px-4 py-5">
        <div className="h-8 w-8 rounded-lg gradient-primary flex items-center justify-center text-white font-bold text-lg">
          V
        </div>
        {open && (
          <span className="font-bold text-foreground text-lg">VideoForge</span>
        )}
      </div>

      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);

              return (
                <SidebarMenuItem key={item.label}>
                  <SidebarMenuButton
                    asChild
                    className={cn(
                      "w-full justify-start gap-3 text-sm font-medium rounded-lg transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-accent"
                    )}
                  >
                    <Link to={item.href}>
                      <Icon className="h-5 w-5 shrink-0" />
                      {open && <span>{item.label}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
  );
}

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <SidebarProvider defaultOpen>
      <div dir="rtl" className="flex min-h-screen w-full">
        {/* Content first so Sidebar sticks right in RTL */}
        <main className="flex-1 overflow-auto">
          <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b bg-card px-4 lg:px-6 backdrop-blur supports-[backdrop-filter]:bg-card/80">
            <SidebarTrigger />
            <div className="flex-1" />
            {/* Future: user avatar / notifications */}
          </header>

          <div className="p-4 lg:p-6">{children}</div>
        </main>

        {/* Sidebar on the right in RTL */}
        <Sidebar side="right" collapsible="icon" className="border-l border-sidebar-border">
          <SidebarNav />
        </Sidebar>
      </div>
    </SidebarProvider>
  );
}
