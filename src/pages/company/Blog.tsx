import { DynamicCMSPage } from "@/components/cms/DynamicCMSPage";
import { RouteSeo } from "@/components/seo/RouteSeo";

const Blog = () => {
  return (
    <>
      <RouteSeo
        title="Matbex Blog - Restaurant Operations, COGS & Profit Insights"
        description="Guides and insights on restaurant cost control, inventory, payroll, and daily profitability from the Matbex team."
        path="/blog"
        ogType="article"
      />
      <DynamicCMSPage slug="blog" />
    </>
  );
};

export default Blog;
