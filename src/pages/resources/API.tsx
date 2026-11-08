import { DynamicCMSPage } from "@/components/cms/DynamicCMSPage";
import { APIFallback } from "@/components/cms/fallbacks/APIFallback";

const API = () => {
  return (
    <DynamicCMSPage 
      slug="api" 
      fallback={<APIFallback />}
      seoTitle="Matbex API Reference | REST Endpoints for Restaurant Data"
      seoDescription="Developer documentation for the Matbex API: authenticate, manage menus and orders, sync inventory, and pull sales and accounting data from your restaurant."
    />
  );
};

export default API;
