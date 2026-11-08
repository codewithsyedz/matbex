import { DynamicCMSPage } from "@/components/cms/DynamicCMSPage";
import { InvestmentTiersFallback } from "@/components/cms/fallbacks/InvestmentTiersFallback";

const InvestmentTiers = () => {
  return (
    <DynamicCMSPage 
      slug="investment-tiers" 
      fallback={<InvestmentTiersFallback />}
      seoTitle="Investment Tiers | Matbex Restaurant Operating System"
      seoDescription="Explore Matbex investment and partnership tiers designed for single-location operators, growing groups, and enterprise restaurant brands."
    />
  );
};

export default InvestmentTiers;
