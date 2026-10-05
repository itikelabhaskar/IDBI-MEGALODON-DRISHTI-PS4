import { createFileRoute } from "@tanstack/react-router";
import { Factory, FlaskConical, Network } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContagionView } from "./contagion";
import { ScenarioLab } from "./scenario";
import { SectorView } from "./sectors";

type MarketTab = "sectors" | "scenario" | "contagion";

/**
 * Market Explorer: everything about the book beyond one branch, in one place.
 * Sectors (is a whole sector stressed?), Scenario stress (what if rates, GDP or a
 * sector move?) and Supplier contagion (who is exposed through trade links?).
 * The tab lives in the URL so links and the browser Back button land on it.
 */
export const Route = createFileRoute("/market")({
  validateSearch: (search: Record<string, unknown>): { tab?: MarketTab } => ({
    tab: (["sectors", "scenario", "contagion"] as const).find((t) => t === search.tab),
  }),
  component: MarketExplorer,
});

function MarketExplorer() {
  const { tab = "sectors" } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <div>
      <div className="px-4 pt-4 md:px-6 md:pt-6">
        <h1 className="text-xl font-semibold text-foreground">Market Explorer</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Sector stress, macro scenarios and supplier contagion across the whole book. For one branch, use Branch
          Explorer.
        </p>
      </div>
      <Tabs value={tab} onValueChange={(v) => navigate({ search: { tab: v as MarketTab }, replace: true })}>
        <div className="px-4 pt-3 md:px-6">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="sectors" className="gap-1.5 text-xs">
              <Factory className="h-3.5 w-3.5" /> Sectors
            </TabsTrigger>
            <TabsTrigger value="scenario" className="gap-1.5 text-xs">
              <FlaskConical className="h-3.5 w-3.5" /> Scenario stress
            </TabsTrigger>
            <TabsTrigger value="contagion" className="gap-1.5 text-xs">
              <Network className="h-3.5 w-3.5" /> Supplier contagion
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="sectors" className="mt-0">
          <SectorView />
        </TabsContent>
        <TabsContent value="scenario" className="mt-0">
          <ScenarioLab />
        </TabsContent>
        <TabsContent value="contagion" className="mt-0">
          <ContagionView />
        </TabsContent>
      </Tabs>
    </div>
  );
}
