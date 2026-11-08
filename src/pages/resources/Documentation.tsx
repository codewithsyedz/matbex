import { DynamicCMSPage } from "@/components/cms/DynamicCMSPage";
import { DocsVersionProvider } from "@/components/docs/DocsVersionContext";
import { DocsVersionSelector } from "@/components/docs/DocsVersionSelector";

const Documentation = () => {
  return (
    <DocsVersionProvider>
      <DynamicCMSPage
        slug="documentation"
        seoTitle="Documentation | Matbex Restaurant OS"
        seoDescription="Complete documentation for Matbex: setup, daily workflows, COGS tracking, payroll, accounting integrations, and team management best practices."
        beforeContent={
          <div className="sticky top-16 z-30 bg-background/80 backdrop-blur-md border-b border-border/60">
            <div className="max-w-4xl mx-auto px-6 py-2">
              <DocsVersionSelector />
            </div>
          </div>
        }
      />
    </DocsVersionProvider>
  );
};

export default Documentation;
