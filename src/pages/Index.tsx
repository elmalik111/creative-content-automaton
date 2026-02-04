import { StatsCards } from '@/components/dashboard/StatsCards';
import { JobsList } from '@/components/dashboard/JobsList';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { Button } from '@/components/ui/button';
import { Film, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';

const Index = () => {
  return (
    <div className="min-h-screen bg-background dark">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Film className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                Video Automation Platform
              </h1>
              <p className="text-sm text-muted-foreground">
                Automated video creation and publishing
              </p>
            </div>
          </div>

           <Button asChild variant="outline">
             <Link to="/settings">
               <Settings className="h-4 w-4 mr-2" />
               الإعدادات
             </Link>
           </Button>
        </div>

        {/* Stats */}
        <div className="mb-8">
          <StatsCards />
        </div>

        {/* Main Content */}
        <div className="grid lg:grid-cols-2 gap-8">
          <JobsList />
          <SettingsPanel />
        </div>
      </div>
    </div>
  );
};

export default Index;
