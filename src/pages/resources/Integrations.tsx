import { DynamicCMSPage } from "@/components/cms/DynamicCMSPage";
import { IntegrationsFallback } from "@/components/cms/fallbacks/IntegrationsFallback";

const Integrations = () => {
  return (
    <DynamicCMSPage 
      slug="integrations" 
      fallback={<IntegrationsFallback />}
      seoTitle="Integrations | Matbex Restaurant OS"
      seoDescription="Connect Matbex with the tools your restaurant already uses — POS systems, delivery aggregators, accounting, payroll, and analytics platforms."
    />
  );
};

export default Integrations;
