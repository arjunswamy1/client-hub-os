import { VerticalProvider } from "@/contexts/VerticalContext";
import { BillyVerticalSelector } from "@/components/dashboard/BillyVerticalSelector";
import BillyRevenueEngine from "@/components/dashboard/BillyRevenueEngine";
import BillyDailyTrends from "@/components/dashboard/BillyDailyTrends";
import BillyTrendAnalysis from "@/components/dashboard/BillyTrendAnalysis";
import BillyMetaDashboard from "@/components/dashboard/BillyMetaDashboard";
import BillyGoogleDashboard from "@/components/dashboard/BillyGoogleDashboard";
import BillyCrossChannel from "@/components/dashboard/BillyCrossChannel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, Chrome, Facebook, TrendingUp, CalendarDays, GitCompare } from "lucide-react";

function BillyDashboardInner() {
  return (
    <div className="space-y-4">
      <BillyVerticalSelector />

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="bg-secondary/50">
          <TabsTrigger value="overview" className="gap-1.5 text-xs">
            <BarChart3 className="h-3.5 w-3.5" />
            Revenue Engine
          </TabsTrigger>
          <TabsTrigger value="cross" className="gap-1.5 text-xs">
            <GitCompare className="h-3.5 w-3.5" />
            Cross-Platform
          </TabsTrigger>
          <TabsTrigger value="trends" className="gap-1.5 text-xs">
            <TrendingUp className="h-3.5 w-3.5" />
            Daily Trends
          </TabsTrigger>
          <TabsTrigger value="analysis" className="gap-1.5 text-xs">
            <CalendarDays className="h-3.5 w-3.5" />
            Trend Analysis
          </TabsTrigger>
          <TabsTrigger value="meta" className="gap-1.5 text-xs">
            <Facebook className="h-3.5 w-3.5" />
            Meta Ads
          </TabsTrigger>
          <TabsTrigger value="google" className="gap-1.5 text-xs">
            <Chrome className="h-3.5 w-3.5" />
            Google Ads
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <BillyRevenueEngine />
        </TabsContent>
        <TabsContent value="cross">
          <BillyCrossChannel />
        </TabsContent>
        <TabsContent value="trends">
          <BillyDailyTrends />
        </TabsContent>
        <TabsContent value="analysis">
          <BillyTrendAnalysis />
        </TabsContent>
        <TabsContent value="meta">
          <BillyMetaDashboard />
        </TabsContent>
        <TabsContent value="google">
          <BillyGoogleDashboard />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function BillyDashboard() {
  return (
    <VerticalProvider>
      <BillyDashboardInner />
    </VerticalProvider>
  );
}
