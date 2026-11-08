import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle,
  DialogTrigger 
} from "@/components/ui/dialog";
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  useLandingContent, 
  LandingFeature, 
  LandingTestimonial, 
  LandingFAQ,
  LandingPricingPlan,
  LandingSection,
  LandingMission
} from "@/hooks/useLandingContent";
import { 
  useToolsStackContent,
  ToolsSettings,
  ToolsCategory,
  ToolsItem
} from "@/hooks/useToolsStackContent";
import { 
  Layout, 
  Star, 
  MessageSquareQuote, 
  CreditCard, 
  HelpCircle,
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  ExternalLink,
  Eye,
  ToggleLeft,
  Sparkles,
  Settings,
  ArrowUp,
  ArrowDown,
  Link as LinkIcon,
  FileText,
  BarChart2
} from "lucide-react";
import { FooterLinksManager } from "@/components/admin/FooterLinksManager";
import { CMSPageManager } from "@/components/admin/CMSPageManager";
import { ComparisonEditor } from "@/components/admin/ComparisonEditor";
import { LandingStringsEditor } from "@/components/admin/LandingStringsEditor";
import { Languages } from "lucide-react";

const iconOptions = [
  "Scale", "Calendar", "BarChart2", "BookOpen", "Mail", "Globe", 
  "Zap", "Shield", "Clock", "Users", "TrendingUp", "DollarSign"
];

const colorOptions = [
  { value: "emerald", label: "Emerald" },
  { value: "blue", label: "Blue" },
  { value: "purple", label: "Purple" },
  { value: "amber", label: "Amber" },
  { value: "rose", label: "Rose" },
  { value: "cyan", label: "Cyan" },
  { value: "yellow", label: "Yellow" },
  { value: "slate", label: "Slate" },
  { value: "indigo", label: "Indigo" },
];

const sizeOptions = [
  { value: "small", label: "Small (1x1)" },
  { value: "medium", label: "Medium (2x1)" },
  { value: "large", label: "Large (2x2)" },
];

const AdminLandingCMS = () => {
  const {
    hero,
    features,
    testimonials,
    pricingPlans,
    faq,
    sections,
    mission,
    isLoading,
    updateHero,
    updateFeature,
    createFeature,
    deleteFeature,
    updateTestimonial,
    createTestimonial,
    deleteTestimonial,
    updatePricingPlan,
    updateFAQ,
    createFAQ,
    deleteFAQ,
    updateSection,
    updateMission,
  } = useLandingContent();

  const {
    settings: toolsSettings,
    categories: toolsCategories,
    items: toolsItems,
    isLoading: toolsLoading,
    updateSettings: updateToolsSettings,
    updateCategory: updateToolsCategory,
    createCategory: createToolsCategory,
    deleteCategory: deleteToolsCategory,
    updateItem: updateToolsItem,
    createItem: createToolsItem,
    deleteItem: deleteToolsItem,
  } = useToolsStackContent();

  if (isLoading || toolsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Landing Page CMS</h1>
          <p className="text-sm text-muted-foreground">
            Manage landing page content without code changes
          </p>
        </div>
        <Button variant="outline" asChild>
          <a href="/landing" target="_blank" rel="noopener noreferrer">
            <Eye className="w-4 h-4 mr-2" />
            Preview Landing Page
            <ExternalLink className="w-3 h-3 ml-2" />
          </a>
        </Button>
      </div>

      <Tabs defaultValue="sections" className="space-y-6">
        <TabsList className="flex flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="sections" className="gap-1.5 px-3">
            <ToggleLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Sections</span>
          </TabsTrigger>
          <TabsTrigger value="hero" className="gap-1.5 px-3">
            <Layout className="w-4 h-4" />
            <span className="hidden sm:inline">Hero</span>
          </TabsTrigger>
          <TabsTrigger value="mission" className="gap-1.5 px-3">
            <Sparkles className="w-4 h-4" />
            <span className="hidden sm:inline">Mission</span>
          </TabsTrigger>
          <TabsTrigger value="features" className="gap-1.5 px-3">
            <Star className="w-4 h-4" />
            <span className="hidden sm:inline">Features</span>
          </TabsTrigger>
          <TabsTrigger value="tools" className="gap-1.5 px-3">
            <Settings className="w-4 h-4" />
            <span className="hidden sm:inline">Tools</span>
          </TabsTrigger>
          <TabsTrigger value="testimonials" className="gap-1.5 px-3">
            <MessageSquareQuote className="w-4 h-4" />
            <span className="hidden sm:inline">Testimonials</span>
          </TabsTrigger>
          <TabsTrigger value="pricing" className="gap-1.5 px-3">
            <CreditCard className="w-4 h-4" />
            <span className="hidden sm:inline">Pricing</span>
          </TabsTrigger>
          <TabsTrigger value="comparison" className="gap-1.5 px-3">
            <BarChart2 className="w-4 h-4" />
            <span className="hidden sm:inline">Comparison</span>
          </TabsTrigger>
          <TabsTrigger value="strings" className="gap-1.5 px-3">
            <Languages className="w-4 h-4" />
            <span className="hidden sm:inline">Strings (EN/AR)</span>
          </TabsTrigger>
          <TabsTrigger value="faq" className="gap-1.5 px-3">
            <HelpCircle className="w-4 h-4" />
            <span className="hidden sm:inline">FAQ</span>
          </TabsTrigger>
          <TabsTrigger value="footer-links" className="gap-1.5 px-3">
            <LinkIcon className="w-4 h-4" />
            <span className="hidden sm:inline">Links</span>
          </TabsTrigger>
          <TabsTrigger value="footer-pages" className="gap-1.5 px-3">
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">Pages</span>
          </TabsTrigger>
        </TabsList>

        {/* Sections Visibility Tab */}
        <TabsContent value="sections">
          <SectionsEditor sections={sections} onUpdate={updateSection.mutate} />
        </TabsContent>

        {/* Hero Tab */}
        <TabsContent value="hero">
          <HeroEditor hero={hero} onSave={updateHero.mutate} isSaving={updateHero.isPending} />
        </TabsContent>

        {/* Mission Tab */}
        <TabsContent value="mission">
          <MissionEditor mission={mission} onSave={updateMission.mutate} isSaving={updateMission.isPending} />
        </TabsContent>

        {/* Features Tab */}
        <TabsContent value="features">
          <FeaturesEditor
            features={features}
            onUpdate={updateFeature.mutate}
            onCreate={createFeature.mutate}
            onDelete={deleteFeature.mutate}
          />
        </TabsContent>

        {/* Tools Tab */}
        <TabsContent value="tools">
          <ToolsEditor
            settings={toolsSettings}
            categories={toolsCategories}
            items={toolsItems}
            onUpdateSettings={updateToolsSettings.mutate}
            onUpdateCategory={updateToolsCategory.mutate}
            onCreateCategory={createToolsCategory.mutate}
            onDeleteCategory={deleteToolsCategory.mutate}
            onUpdateItem={updateToolsItem.mutate}
            onCreateItem={createToolsItem.mutate}
            onDeleteItem={deleteToolsItem.mutate}
            isSaving={updateToolsSettings.isPending}
          />
        </TabsContent>

        {/* Testimonials Tab */}
        <TabsContent value="testimonials">
          <TestimonialsEditor
            testimonials={testimonials}
            onUpdate={updateTestimonial.mutate}
            onCreate={createTestimonial.mutate}
            onDelete={deleteTestimonial.mutate}
          />
        </TabsContent>

        {/* Pricing Tab */}
        <TabsContent value="pricing">
          <PricingEditor plans={pricingPlans} onUpdate={updatePricingPlan.mutate} />
        </TabsContent>

        {/* Comparison Tab */}
        <TabsContent value="comparison">
          <ComparisonEditor />
        </TabsContent>

        {/* Strings (EN/AR) Tab — generic editor for every landing-page text */}
        <TabsContent value="strings">
          <LandingStringsEditor />
        </TabsContent>

        {/* FAQ Tab */}
        <TabsContent value="faq">
          <FAQEditor
            faq={faq}
            onUpdate={updateFAQ.mutate}
            onCreate={createFAQ.mutate}
            onDelete={deleteFAQ.mutate}
          />
        </TabsContent>

        {/* Footer Links Tab */}
        <TabsContent value="footer-links">
          <FooterLinksManager />
        </TabsContent>

        {/* Footer Pages Tab */}
        <TabsContent value="footer-pages">
          <CMSPageManager />
        </TabsContent>
      </Tabs>
    </div>
  );
};

// Hero Editor Component
const HeroEditor = ({ 
  hero, 
  onSave, 
  isSaving 
}: { 
  hero: any; 
  onSave: (data: any) => void; 
  isSaving: boolean;
}) => {
  const [formData, setFormData] = useState({
    eyebrow: hero?.eyebrow || "",
    headline: hero?.headline || "",
    subheadline: hero?.subheadline || "",
    primary_cta_text: hero?.primary_cta_text || "",
    secondary_cta_text: hero?.secondary_cta_text || "",
    eyebrow_ar: hero?.eyebrow_ar || "",
    headline_ar: hero?.headline_ar || "",
    subheadline_ar: hero?.subheadline_ar || "",
    primary_cta_text_ar: hero?.primary_cta_text_ar || "",
    secondary_cta_text_ar: hero?.secondary_cta_text_ar || "",
  });

  const handleSave = () => {
    onSave(formData);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hero Section</CardTitle>
        <CardDescription>
          Edit the main hero section that appears at the top of the landing page
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs defaultValue="en" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="en">English</TabsTrigger>
            <TabsTrigger value="ar">العربية (Arabic)</TabsTrigger>
          </TabsList>

          <TabsContent value="en" className="space-y-6 mt-6">
            <div className="space-y-2">
              <Label htmlFor="eyebrow">Eyebrow Text</Label>
              <Input
                id="eyebrow"
                value={formData.eyebrow}
                onChange={(e) => setFormData({ ...formData, eyebrow: e.target.value })}
                placeholder="The Future of Hospitality Management"
              />
              <p className="text-xs text-muted-foreground">Small text above the headline</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="headline">Headline</Label>
              <Input
                id="headline"
                value={formData.headline}
                onChange={(e) => setFormData({ ...formData, headline: e.target.value })}
                placeholder="Your Entire Restaurant, Synchronized."
                className="text-lg"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="subheadline">Subheadline</Label>
              <Textarea
                id="subheadline"
                value={formData.subheadline}
                onChange={(e) => setFormData({ ...formData, subheadline: e.target.value })}
                placeholder="From real-time COGS tracking to automated payroll..."
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="primary_cta">Primary CTA Text</Label>
                <Input
                  id="primary_cta"
                  value={formData.primary_cta_text}
                  onChange={(e) => setFormData({ ...formData, primary_cta_text: e.target.value })}
                  placeholder="Start Free Trial"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="secondary_cta">Secondary CTA Text</Label>
                <Input
                  id="secondary_cta"
                  value={formData.secondary_cta_text}
                  onChange={(e) => setFormData({ ...formData, secondary_cta_text: e.target.value })}
                  placeholder="Watch Demo"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="ar" className="space-y-4 mt-6">
            <p className="text-xs text-muted-foreground">Shown when language is Arabic. Falls back to English if empty.</p>
            <div className="space-y-2" dir="rtl">
              <Label dir="ltr">Eyebrow (Arabic)</Label>
              <Input value={formData.eyebrow_ar} onChange={(e) => setFormData({ ...formData, eyebrow_ar: e.target.value })} placeholder="مستقبل إدارة الضيافة" />
            </div>
            <div className="space-y-2" dir="rtl">
              <Label dir="ltr">Headline (Arabic)</Label>
              <Input value={formData.headline_ar} onChange={(e) => setFormData({ ...formData, headline_ar: e.target.value })} placeholder="مطعمك بأكمله، متزامن." />
            </div>
            <div className="space-y-2" dir="rtl">
              <Label dir="ltr">Subheadline (Arabic)</Label>
              <Textarea rows={3} value={formData.subheadline_ar} onChange={(e) => setFormData({ ...formData, subheadline_ar: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2" dir="rtl">
                <Label dir="ltr">Primary CTA (Arabic)</Label>
                <Input value={formData.primary_cta_text_ar} onChange={(e) => setFormData({ ...formData, primary_cta_text_ar: e.target.value })} placeholder="ابدأ التجربة المجانية" />
              </div>
              <div className="space-y-2" dir="rtl">
                <Label dir="ltr">Secondary CTA (Arabic)</Label>
                <Input value={formData.secondary_cta_text_ar} onChange={(e) => setFormData({ ...formData, secondary_cta_text_ar: e.target.value })} placeholder="شاهد العرض" />
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
      </CardContent>
    </Card>
  );
};

// Sections Visibility Editor Component
const SectionsEditor = ({
  sections,
  onUpdate,
}: {
  sections: LandingSection[];
  onUpdate: (data: any) => void;
}) => {
  const sortedSections = [...sections].sort((a, b) => a.sort_order - b.sort_order);

  const handleMoveUp = (section: LandingSection, index: number) => {
    if (index === 0) return;
    const prevSection = sortedSections[index - 1];
    // Swap sort orders
    onUpdate({ id: section.id, sort_order: prevSection.sort_order });
    onUpdate({ id: prevSection.id, sort_order: section.sort_order });
  };

  const handleMoveDown = (section: LandingSection, index: number) => {
    if (index === sortedSections.length - 1) return;
    const nextSection = sortedSections[index + 1];
    // Swap sort orders
    onUpdate({ id: section.id, sort_order: nextSection.sort_order });
    onUpdate({ id: nextSection.id, sort_order: section.sort_order });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Section Visibility & Order</CardTitle>
        <CardDescription>
          Enable or disable sections and change their order on the landing page. Changes are applied immediately.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {sortedSections.map((section, index) => (
            <div
              key={section.id}
              className="flex items-center justify-between p-4 rounded-lg border bg-card"
            >
              <div className="flex items-center gap-4">
                <div className="flex flex-col gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={index === 0}
                    onClick={() => handleMoveUp(section, index)}
                  >
                    <ArrowUp className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={index === sortedSections.length - 1}
                    onClick={() => handleMoveDown(section, index)}
                  >
                    <ArrowDown className="w-3 h-3" />
                  </Button>
                </div>
                <div>
                  <p className="font-medium">{section.section_name}</p>
                  <p className="text-sm text-muted-foreground">
                    Key: <code className="text-xs bg-muted px-1 py-0.5 rounded">{section.section_key}</code>
                    <span className="ml-2 text-xs">Position: {section.sort_order}</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={section.is_active ? "default" : "secondary"}>
                  {section.is_active ? "Visible" : "Hidden"}
                </Badge>
                <Switch
                  checked={section.is_active}
                  onCheckedChange={(checked) => onUpdate({ id: section.id, is_active: checked })}
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

// Mission Statement Editor Component
const MissionEditor = ({
  mission,
  onSave,
  isSaving,
}: {
  mission: LandingMission | undefined;
  onSave: (data: any) => void;
  isSaving: boolean;
}) => {
  const [formData, setFormData] = useState({
    headline_prefix: mission?.headline_prefix || "",
    headline_bold: mission?.headline_bold || "",
    opening_paragraph: mission?.opening_paragraph || "",
    core_mission: mission?.core_mission || "",
    identity_text: mission?.identity_text || "",
    symbolic_statement: mission?.symbolic_statement || "",
    closing_text: mission?.closing_text || "",
    headline_prefix_ar: mission?.headline_prefix_ar || "",
    headline_bold_ar: mission?.headline_bold_ar || "",
    opening_paragraph_ar: mission?.opening_paragraph_ar || "",
    core_mission_ar: mission?.core_mission_ar || "",
    identity_text_ar: mission?.identity_text_ar || "",
    symbolic_statement_ar: mission?.symbolic_statement_ar || "",
    closing_text_ar: mission?.closing_text_ar || "",
  });

  const handleSave = () => {
    onSave(formData);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mission Statement Section</CardTitle>
        <CardDescription>
          Edit the mission statement that appears after the hero section
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs defaultValue="en" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="en">English</TabsTrigger>
            <TabsTrigger value="ar">العربية (Arabic)</TabsTrigger>
          </TabsList>

          <TabsContent value="en" className="space-y-6 mt-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="headline_prefix">Headline Prefix</Label>
            <Input
              id="headline_prefix"
              value={formData.headline_prefix}
              onChange={(e) => setFormData({ ...formData, headline_prefix: e.target.value })}
              placeholder="Engineered Vitality for the"
            />
            <p className="text-xs text-muted-foreground">Light font weight text</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="headline_bold">Headline Bold</Label>
            <Input
              id="headline_bold"
              value={formData.headline_bold}
              onChange={(e) => setFormData({ ...formData, headline_bold: e.target.value })}
              placeholder="Modern Restaurateur."
            />
            <p className="text-xs text-muted-foreground">Bold emphasis text</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="opening_paragraph">Opening Paragraph</Label>
          <Textarea
            id="opening_paragraph"
            value={formData.opening_paragraph}
            onChange={(e) => setFormData({ ...formData, opening_paragraph: e.target.value })}
            placeholder="Hospitality is a complex, living ecosystem..."
            rows={3}
          />
          <p className="text-xs text-muted-foreground">Introductory text about the industry</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="core_mission">Core Mission Statement</Label>
          <Input
            id="core_mission"
            value={formData.core_mission}
            onChange={(e) => setFormData({ ...formData, core_mission: e.target.value })}
            placeholder="Matbex exists to synchronize this chaos."
            className="text-lg"
          />
          <p className="text-xs text-muted-foreground">Green highlighted tagline</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="identity_text">Visual Identity Text</Label>
          <Textarea
            id="identity_text"
            value={formData.identity_text}
            onChange={(e) => setFormData({ ...formData, identity_text: e.target.value })}
            placeholder='Our visual identity, the "Pulse Line," is our operational mandate...'
            rows={3}
          />
          <p className="text-xs text-muted-foreground">Description of the Pulse Line identity</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="symbolic_statement">Symbolic Statement</Label>
          <Input
            id="symbolic_statement"
            value={formData.symbolic_statement}
            onChange={(e) => setFormData({ ...formData, symbolic_statement: e.target.value })}
            placeholder="It symbolizes the moment intuition meets intelligence."
          />
          <p className="text-xs text-muted-foreground">Italic statement</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="closing_text">Closing Statement</Label>
          <Textarea
            id="closing_text"
            value={formData.closing_text}
            onChange={(e) => setFormData({ ...formData, closing_text: e.target.value })}
            placeholder="We are not merely providing software..."
            rows={4}
          />
          <p className="text-xs text-muted-foreground">
            Final paragraph (text "central nervous system" will be auto-bolded)
          </p>
        </div>
          </TabsContent>

          <TabsContent value="ar" className="space-y-4 mt-6">
            <p className="text-xs text-muted-foreground">Falls back to English if empty.</p>
            <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2" dir="rtl">
              <Label dir="ltr">Headline Prefix (Arabic)</Label>
              <Input value={formData.headline_prefix_ar} onChange={(e) => setFormData({ ...formData, headline_prefix_ar: e.target.value })} />
            </div>
            <div className="space-y-2" dir="rtl">
              <Label dir="ltr">Headline Bold (Arabic)</Label>
              <Input value={formData.headline_bold_ar} onChange={(e) => setFormData({ ...formData, headline_bold_ar: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2" dir="rtl">
            <Label dir="ltr">Opening Paragraph (Arabic)</Label>
            <Textarea rows={3} value={formData.opening_paragraph_ar} onChange={(e) => setFormData({ ...formData, opening_paragraph_ar: e.target.value })} />
          </div>
          <div className="space-y-2" dir="rtl">
            <Label dir="ltr">Core Mission (Arabic)</Label>
            <Input value={formData.core_mission_ar} onChange={(e) => setFormData({ ...formData, core_mission_ar: e.target.value })} />
          </div>
          <div className="space-y-2" dir="rtl">
            <Label dir="ltr">Visual Identity Text (Arabic)</Label>
            <Textarea rows={3} value={formData.identity_text_ar} onChange={(e) => setFormData({ ...formData, identity_text_ar: e.target.value })} />
          </div>
          <div className="space-y-2" dir="rtl">
            <Label dir="ltr">Symbolic Statement (Arabic)</Label>
            <Input value={formData.symbolic_statement_ar} onChange={(e) => setFormData({ ...formData, symbolic_statement_ar: e.target.value })} />
          </div>
          <div className="space-y-2" dir="rtl">
            <Label dir="ltr">Closing Statement (Arabic)</Label>
            <Textarea rows={4} value={formData.closing_text_ar} onChange={(e) => setFormData({ ...formData, closing_text_ar: e.target.value })} />
          </div>
          </TabsContent>
        </Tabs>

        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
      </CardContent>
    </Card>
  );
};

// Features Editor Component
const FeaturesEditor = ({
  features,
  onUpdate,
  onCreate,
  onDelete,
}: {
  features: LandingFeature[];
  onUpdate: (data: any) => void;
  onCreate: (data: any) => void;
  onDelete: (id: string) => void;
}) => {
  const [editingFeature, setEditingFeature] = useState<LandingFeature | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Features (Bento Grid)</CardTitle>
          <CardDescription>
            Manage the feature cards displayed in the bento grid
          </CardDescription>
        </div>
        <Dialog open={isCreating} onOpenChange={setIsCreating}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add Feature
            </Button>
          </DialogTrigger>
          <DialogContent>
            <FeatureForm
              onSubmit={(data) => {
                onCreate(data);
                setIsCreating(false);
              }}
              onCancel={() => setIsCreating(false)}
            />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {features.map((feature) => (
            <div
              key={feature.id}
              className="flex items-center gap-4 p-4 rounded-lg border bg-card"
            >
              <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{feature.title}</span>
                  <Badge variant="outline" className="text-xs">
                    {feature.size}
                  </Badge>
                  <Badge 
                    variant="secondary" 
                    className="text-xs"
                    style={{ backgroundColor: `var(--${feature.color}-100, #f0f0f0)` }}
                  >
                    {feature.color}
                  </Badge>
                  {!feature.is_active && (
                    <Badge variant="secondary" className="text-xs">Hidden</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground truncate">{feature.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <Dialog open={editingFeature?.id === feature.id} onOpenChange={(open) => !open && setEditingFeature(null)}>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={() => setEditingFeature(feature)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <FeatureForm
                      feature={editingFeature || undefined}
                      onSubmit={(data) => {
                        onUpdate({ id: feature.id, ...data });
                        setEditingFeature(null);
                      }}
                      onCancel={() => setEditingFeature(null)}
                    />
                  </DialogContent>
                </Dialog>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Feature</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete "{feature.title}"? This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => onDelete(feature.id)}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

// Feature Form Component
const FeatureForm = ({
  feature,
  onSubmit,
  onCancel,
}: {
  feature?: LandingFeature;
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) => {
  const [formData, setFormData] = useState({
    title: feature?.title || "",
    description: feature?.description || "",
    icon: feature?.icon || "Scale",
    size: feature?.size || "small",
    color: feature?.color || "emerald",
    sort_order: feature?.sort_order || 0,
    is_active: feature?.is_active ?? true,
    title_ar: feature?.title_ar || "",
    description_ar: feature?.description_ar || "",
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{feature ? "Edit Feature" : "Add Feature"}</DialogTitle>
        <DialogDescription>
          {feature ? "Update the feature details" : "Add a new feature to the bento grid"}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <Tabs defaultValue="en" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="en">English</TabsTrigger>
            <TabsTrigger value="ar">العربية (Arabic)</TabsTrigger>
          </TabsList>

          <TabsContent value="en" className="space-y-4 mt-4">
        <div className="space-y-2">
          <Label>Title</Label>
          <Input
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="Inventory & COGS"
          />
        </div>
        <div className="space-y-2">
          <Label>Description</Label>
          <Textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Real-time COGS tracking..."
            rows={2}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Icon</Label>
            <Select
              value={formData.icon}
              onValueChange={(value) => setFormData({ ...formData, icon: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {iconOptions.map((icon) => (
                  <SelectItem key={icon} value={icon}>{icon}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Size</Label>
            <Select
              value={formData.size}
              onValueChange={(value) => setFormData({ ...formData, size: value as any })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sizeOptions.map((size) => (
                  <SelectItem key={size.value} value={size.value}>{size.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Color</Label>
            <Select
              value={formData.color}
              onValueChange={(value) => setFormData({ ...formData, color: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {colorOptions.map((color) => (
                  <SelectItem key={color.value} value={color.value}>{color.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Sort Order</Label>
            <Input
              type="number"
              value={formData.sort_order}
              onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={formData.is_active}
            onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
          />
          <Label>Active (visible on landing page)</Label>
        </div>
          </TabsContent>

          <TabsContent value="ar" className="space-y-3 mt-4">
          <div className="space-y-2" dir="rtl">
            <Label dir="ltr">Title (Arabic)</Label>
            <Input value={formData.title_ar} onChange={(e) => setFormData({ ...formData, title_ar: e.target.value })} />
          </div>
          <div className="space-y-2" dir="rtl">
            <Label dir="ltr">Description (Arabic)</Label>
            <Textarea rows={2} value={formData.description_ar} onChange={(e) => setFormData({ ...formData, description_ar: e.target.value })} />
          </div>
          </TabsContent>
        </Tabs>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onSubmit(formData)}>
          {feature ? "Save Changes" : "Add Feature"}
        </Button>
      </DialogFooter>
    </>
  );
};

// Testimonials Editor Component
const TestimonialsEditor = ({
  testimonials,
  onUpdate,
  onCreate,
  onDelete,
}: {
  testimonials: LandingTestimonial[];
  onUpdate: (data: any) => void;
  onCreate: (data: any) => void;
  onDelete: (id: string) => void;
}) => {
  const [editingTestimonial, setEditingTestimonial] = useState<LandingTestimonial | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Testimonials</CardTitle>
          <CardDescription>
            Manage customer testimonials displayed in the carousel
          </CardDescription>
        </div>
        <Dialog open={isCreating} onOpenChange={setIsCreating}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add Testimonial
            </Button>
          </DialogTrigger>
          <DialogContent>
            <TestimonialForm
              onSubmit={(data) => {
                onCreate(data);
                setIsCreating(false);
              }}
              onCancel={() => setIsCreating(false)}
            />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {testimonials.map((testimonial) => (
            <div
              key={testimonial.id}
              className="flex items-start gap-4 p-4 rounded-lg border bg-card"
            >
              <span className="text-2xl">{testimonial.avatar_emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{testimonial.author_name}</span>
                  <span className="text-sm text-muted-foreground">
                    {testimonial.author_role} • {testimonial.restaurant_name}
                  </span>
                  {!testimonial.is_active && (
                    <Badge variant="secondary" className="text-xs">Hidden</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                  "{testimonial.quote}"
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Dialog open={editingTestimonial?.id === testimonial.id} onOpenChange={(open) => !open && setEditingTestimonial(null)}>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={() => setEditingTestimonial(testimonial)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <TestimonialForm
                      testimonial={editingTestimonial || undefined}
                      onSubmit={(data) => {
                        onUpdate({ id: testimonial.id, ...data });
                        setEditingTestimonial(null);
                      }}
                      onCancel={() => setEditingTestimonial(null)}
                    />
                  </DialogContent>
                </Dialog>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Testimonial</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete this testimonial from {testimonial.author_name}?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => onDelete(testimonial.id)}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

// Testimonial Form Component
const TestimonialForm = ({
  testimonial,
  onSubmit,
  onCancel,
}: {
  testimonial?: LandingTestimonial;
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) => {
  const [formData, setFormData] = useState({
    quote: testimonial?.quote || "",
    author_name: testimonial?.author_name || "",
    author_role: testimonial?.author_role || "",
    restaurant_name: testimonial?.restaurant_name || "",
    avatar_emoji: testimonial?.avatar_emoji || "👨‍🍳",
    sort_order: testimonial?.sort_order || 0,
    is_active: testimonial?.is_active ?? true,
    quote_ar: testimonial?.quote_ar || "",
    author_name_ar: testimonial?.author_name_ar || "",
    author_role_ar: testimonial?.author_role_ar || "",
    restaurant_name_ar: testimonial?.restaurant_name_ar || "",
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{testimonial ? "Edit Testimonial" : "Add Testimonial"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <Tabs defaultValue="en" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="en">English</TabsTrigger>
            <TabsTrigger value="ar">العربية (Arabic)</TabsTrigger>
          </TabsList>

          <TabsContent value="en" className="space-y-4 mt-4">
        <div className="space-y-2">
          <Label>Quote</Label>
          <Textarea
            value={formData.quote}
            onChange={(e) => setFormData({ ...formData, quote: e.target.value })}
            placeholder="Matbex gave me back 15 hours a week..."
            rows={3}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Author Name</Label>
            <Input
              value={formData.author_name}
              onChange={(e) => setFormData({ ...formData, author_name: e.target.value })}
              placeholder="Chef Marcus"
            />
          </div>
          <div className="space-y-2">
            <Label>Avatar Emoji</Label>
            <Input
              value={formData.avatar_emoji}
              onChange={(e) => setFormData({ ...formData, avatar_emoji: e.target.value })}
              placeholder="👨‍🍳"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Role</Label>
            <Input
              value={formData.author_role}
              onChange={(e) => setFormData({ ...formData, author_role: e.target.value })}
              placeholder="Executive Chef"
            />
          </div>
          <div className="space-y-2">
            <Label>Restaurant Name</Label>
            <Input
              value={formData.restaurant_name}
              onChange={(e) => setFormData({ ...formData, restaurant_name: e.target.value })}
              placeholder="The Gilded Fig"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={formData.is_active}
            onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
          />
          <Label>Active</Label>
        </div>
          </TabsContent>

          <TabsContent value="ar" className="space-y-3 mt-4">
          <div className="space-y-2" dir="rtl">
            <Label dir="ltr">Quote (Arabic)</Label>
            <Textarea rows={3} value={formData.quote_ar} onChange={(e) => setFormData({ ...formData, quote_ar: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2" dir="rtl">
              <Label dir="ltr">Author Name (Arabic)</Label>
              <Input value={formData.author_name_ar} onChange={(e) => setFormData({ ...formData, author_name_ar: e.target.value })} />
            </div>
            <div className="space-y-2" dir="rtl">
              <Label dir="ltr">Role (Arabic)</Label>
              <Input value={formData.author_role_ar} onChange={(e) => setFormData({ ...formData, author_role_ar: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2" dir="rtl">
            <Label dir="ltr">Restaurant Name (Arabic)</Label>
            <Input value={formData.restaurant_name_ar} onChange={(e) => setFormData({ ...formData, restaurant_name_ar: e.target.value })} />
          </div>
          </TabsContent>
        </Tabs>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onSubmit(formData)}>
          {testimonial ? "Save Changes" : "Add Testimonial"}
        </Button>
      </DialogFooter>
    </>
  );
};

// Pricing Editor Component
const PricingEditor = ({
  plans,
  onUpdate,
}: {
  plans: LandingPricingPlan[];
  onUpdate: (data: any) => void;
}) => {
  const [editingPlan, setEditingPlan] = useState<LandingPricingPlan | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pricing Plans</CardTitle>
        <CardDescription>
          Edit pricing tiers and features
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid md:grid-cols-3 gap-4">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`p-4 rounded-lg border ${plan.is_highlighted ? 'border-primary bg-primary/5' : 'bg-card'}`}
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="text-sm text-muted-foreground">{plan.tagline}</span>
                  <h4 className="font-medium">{plan.name}</h4>
                </div>
                {plan.badge_text && (
                  <Badge variant="default" className="text-xs">{plan.badge_text}</Badge>
                )}
              </div>
              <p className="text-2xl font-light mb-2">
                {plan.monthly_price !== null ? `$${plan.monthly_price}/mo` : "Custom"}
              </p>
              <p className="text-sm text-muted-foreground mb-4">{plan.description}</p>
              <ul className="text-sm space-y-1 mb-4">
                {plan.features.slice(0, 3).map((feature, i) => (
                  <li key={i} className="text-muted-foreground">• {feature}</li>
                ))}
                {plan.features.length > 3 && (
                  <li className="text-muted-foreground">+{plan.features.length - 3} more...</li>
                )}
              </ul>
              <Dialog open={editingPlan?.id === plan.id} onOpenChange={(open) => !open && setEditingPlan(null)}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full" onClick={() => setEditingPlan(plan)}>
                    <Pencil className="w-3 h-3 mr-2" />
                    Edit Plan
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <PricingForm
                    plan={editingPlan || undefined}
                    onSubmit={(data) => {
                      onUpdate({ id: plan.id, ...data });
                      setEditingPlan(null);
                    }}
                    onCancel={() => setEditingPlan(null)}
                  />
                </DialogContent>
              </Dialog>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

// Pricing Form Component
const PricingForm = ({
  plan,
  onSubmit,
  onCancel,
}: {
  plan?: LandingPricingPlan;
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) => {
  const [formData, setFormData] = useState({
    name: plan?.name || "",
    tagline: plan?.tagline || "",
    monthly_price: plan?.monthly_price || null,
    annual_price: plan?.annual_price || null,
    description: plan?.description || "",
    features: plan?.features || [],
    cta_text: plan?.cta_text || "Start Free Trial",
    is_highlighted: plan?.is_highlighted || false,
    badge_text: plan?.badge_text || "",
    name_ar: plan?.name_ar || "",
    tagline_ar: plan?.tagline_ar || "",
    description_ar: plan?.description_ar || "",
    features_ar: plan?.features_ar || [],
    cta_text_ar: plan?.cta_text_ar || "",
    badge_text_ar: plan?.badge_text_ar || "",
  });
  const [newFeature, setNewFeature] = useState("");
  const [newFeatureAr, setNewFeatureAr] = useState("");

  const addFeature = () => {
    if (newFeature.trim()) {
      setFormData({ ...formData, features: [...formData.features, newFeature.trim()] });
      setNewFeature("");
    }
  };

  const removeFeature = (index: number) => {
    setFormData({ 
      ...formData, 
      features: formData.features.filter((_, i) => i !== index) 
    });
  };

  const addFeatureAr = () => {
    if (newFeatureAr.trim()) {
      setFormData({ ...formData, features_ar: [...formData.features_ar, newFeatureAr.trim()] });
      setNewFeatureAr("");
    }
  };

  const removeFeatureAr = (index: number) => {
    setFormData({
      ...formData,
      features_ar: formData.features_ar.filter((_, i) => i !== index),
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit {plan?.name} Plan</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
        <Tabs defaultValue="en" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="en">English</TabsTrigger>
            <TabsTrigger value="ar">العربية (Arabic)</TabsTrigger>
          </TabsList>

          <TabsContent value="en" className="space-y-4 mt-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Plan Name</Label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Tagline</Label>
            <Input
              value={formData.tagline}
              onChange={(e) => setFormData({ ...formData, tagline: e.target.value })}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Monthly Price ($)</Label>
            <Input
              type="number"
              value={formData.monthly_price || ""}
              onChange={(e) => setFormData({ 
                ...formData, 
                monthly_price: e.target.value ? parseInt(e.target.value) : null 
              })}
              placeholder="Leave empty for custom"
            />
          </div>
          <div className="space-y-2">
            <Label>Annual Price ($)</Label>
            <Input
              type="number"
              value={formData.annual_price || ""}
              onChange={(e) => setFormData({ 
                ...formData, 
                annual_price: e.target.value ? parseInt(e.target.value) : null 
              })}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Description</Label>
          <Textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={2}
          />
        </div>
        <div className="space-y-2">
          <Label>Features</Label>
          <div className="space-y-2">
            {formData.features.map((feature, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input value={feature} readOnly className="flex-1" />
                <Button variant="ghost" size="icon" onClick={() => removeFeature(index)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Input
                value={newFeature}
                onChange={(e) => setNewFeature(e.target.value)}
                placeholder="Add feature..."
                onKeyPress={(e) => e.key === "Enter" && addFeature()}
              />
              <Button variant="outline" onClick={addFeature}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>CTA Text</Label>
            <Input
              value={formData.cta_text}
              onChange={(e) => setFormData({ ...formData, cta_text: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Badge Text</Label>
            <Input
              value={formData.badge_text || ""}
              onChange={(e) => setFormData({ ...formData, badge_text: e.target.value })}
              placeholder="Most Popular"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={formData.is_highlighted}
            onCheckedChange={(checked) => setFormData({ ...formData, is_highlighted: checked })}
          />
          <Label>Highlight this plan (dark background)</Label>
        </div>
          </TabsContent>

          <TabsContent value="ar" className="space-y-3 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2" dir="rtl">
              <Label dir="ltr">Plan Name (Arabic)</Label>
              <Input value={formData.name_ar} onChange={(e) => setFormData({ ...formData, name_ar: e.target.value })} />
            </div>
            <div className="space-y-2" dir="rtl">
              <Label dir="ltr">Tagline (Arabic)</Label>
              <Input value={formData.tagline_ar} onChange={(e) => setFormData({ ...formData, tagline_ar: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2" dir="rtl">
            <Label dir="ltr">Description (Arabic)</Label>
            <Textarea rows={2} value={formData.description_ar} onChange={(e) => setFormData({ ...formData, description_ar: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Features (Arabic)</Label>
            <div className="space-y-2" dir="rtl">
              {formData.features_ar.map((feature, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input value={feature} readOnly className="flex-1" />
                  <Button variant="ghost" size="icon" onClick={() => removeFeatureAr(index)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Input
                  value={newFeatureAr}
                  onChange={(e) => setNewFeatureAr(e.target.value)}
                  placeholder="أضف ميزة..."
                  onKeyPress={(e) => e.key === "Enter" && addFeatureAr()}
                />
                <Button variant="outline" onClick={addFeatureAr}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2" dir="rtl">
              <Label dir="ltr">CTA Text (Arabic)</Label>
              <Input value={formData.cta_text_ar} onChange={(e) => setFormData({ ...formData, cta_text_ar: e.target.value })} />
            </div>
            <div className="space-y-2" dir="rtl">
              <Label dir="ltr">Badge Text (Arabic)</Label>
              <Input value={formData.badge_text_ar} onChange={(e) => setFormData({ ...formData, badge_text_ar: e.target.value })} />
            </div>
          </div>
          </TabsContent>
        </Tabs>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onSubmit(formData)}>Save Changes</Button>
      </DialogFooter>
    </>
  );
};

// FAQ Editor Component
const FAQEditor = ({
  faq,
  onUpdate,
  onCreate,
  onDelete,
}: {
  faq: LandingFAQ[];
  onUpdate: (data: any) => void;
  onCreate: (data: any) => void;
  onDelete: (id: string) => void;
}) => {
  const [editingFAQ, setEditingFAQ] = useState<LandingFAQ | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>FAQ</CardTitle>
          <CardDescription>
            Manage frequently asked questions
          </CardDescription>
        </div>
        <Dialog open={isCreating} onOpenChange={setIsCreating}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add FAQ
            </Button>
          </DialogTrigger>
          <DialogContent>
            <FAQForm
              onSubmit={(data) => {
                onCreate(data);
                setIsCreating(false);
              }}
              onCancel={() => setIsCreating(false)}
            />
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {faq.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-4 p-4 rounded-lg border bg-card"
            >
              <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab mt-1" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{item.question}</span>
                  {!item.is_active && (
                    <Badge variant="secondary" className="text-xs">Hidden</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                  {item.answer}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Dialog open={editingFAQ?.id === item.id} onOpenChange={(open) => !open && setEditingFAQ(null)}>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={() => setEditingFAQ(item)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <FAQForm
                      faq={editingFAQ || undefined}
                      onSubmit={(data) => {
                        onUpdate({ id: item.id, ...data });
                        setEditingFAQ(null);
                      }}
                      onCancel={() => setEditingFAQ(null)}
                    />
                  </DialogContent>
                </Dialog>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete FAQ</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete this FAQ item?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => onDelete(item.id)}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

// FAQ Form Component
const FAQForm = ({
  faq,
  onSubmit,
  onCancel,
}: {
  faq?: LandingFAQ;
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) => {
  const [formData, setFormData] = useState({
    question: faq?.question || "",
    answer: faq?.answer || "",
    sort_order: faq?.sort_order || 0,
    is_active: faq?.is_active ?? true,
    question_ar: faq?.question_ar || "",
    answer_ar: faq?.answer_ar || "",
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{faq ? "Edit FAQ" : "Add FAQ"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <Tabs defaultValue="en" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="en">English</TabsTrigger>
            <TabsTrigger value="ar">العربية (Arabic)</TabsTrigger>
          </TabsList>

          <TabsContent value="en" className="space-y-4 mt-4">
        <div className="space-y-2">
          <Label>Question</Label>
          <Input
            value={formData.question}
            onChange={(e) => setFormData({ ...formData, question: e.target.value })}
            placeholder="Can I migrate from my current POS?"
          />
        </div>
        <div className="space-y-2">
          <Label>Answer</Label>
          <Textarea
            value={formData.answer}
            onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
            rows={4}
            placeholder="Yes! Matbex integrates with all major POS systems..."
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={formData.is_active}
            onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
          />
          <Label>Active</Label>
        </div>
          </TabsContent>

          <TabsContent value="ar" className="space-y-3 mt-4">
          <div className="space-y-2" dir="rtl">
            <Label dir="ltr">Question (Arabic)</Label>
            <Input value={formData.question_ar} onChange={(e) => setFormData({ ...formData, question_ar: e.target.value })} />
          </div>
          <div className="space-y-2" dir="rtl">
            <Label dir="ltr">Answer (Arabic)</Label>
            <Textarea rows={4} value={formData.answer_ar} onChange={(e) => setFormData({ ...formData, answer_ar: e.target.value })} />
          </div>
          </TabsContent>
        </Tabs>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onSubmit(formData)}>
          {faq ? "Save Changes" : "Add FAQ"}
        </Button>
      </DialogFooter>
    </>
  );
};

// Preview Type Options for Tools
const previewTypeOptions = [
  { value: "pos", label: "POS Preview" },
  { value: "inventory", label: "Inventory Preview" },
  { value: "dashboard", label: "Dashboard Preview" },
  { value: "revenue", label: "Revenue Preview" },
  { value: "reports", label: "Reports Preview" },
];

// Tools Editor Component
const ToolsEditor = ({
  settings,
  categories,
  items,
  onUpdateSettings,
  onUpdateCategory,
  onCreateCategory,
  onDeleteCategory,
  onUpdateItem,
  onCreateItem,
  onDeleteItem,
  isSaving,
}: {
  settings: ToolsSettings | null;
  categories: ToolsCategory[];
  items: ToolsItem[];
  onUpdateSettings: (data: any) => void;
  onUpdateCategory: (data: any) => void;
  onCreateCategory: (data: any) => void;
  onDeleteCategory: (id: string) => void;
  onUpdateItem: (data: any) => void;
  onCreateItem: (data: any) => void;
  onDeleteItem: (id: string) => void;
  isSaving: boolean;
}) => {
  const [settingsForm, setSettingsForm] = useState({
    eyebrow: settings?.eyebrow || "",
    headline: settings?.headline || "",
    is_active: settings?.is_active ?? true,
    eyebrow_ar: settings?.eyebrow_ar || "",
    headline_ar: settings?.headline_ar || "",
  });
  const [editingCategory, setEditingCategory] = useState<ToolsCategory | null>(null);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [editingItem, setEditingItem] = useState<ToolsItem | null>(null);
  const [isCreatingItem, setIsCreatingItem] = useState(false);
  const [selectedCategoryForItem, setSelectedCategoryForItem] = useState<string>("");

  const handleSaveSettings = () => {
    onUpdateSettings(settingsForm);
  };

  return (
    <div className="space-y-6">
      {/* Section Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Tools Section Settings</CardTitle>
          <CardDescription>
            Configure the header and visibility of the Built-in Tools section
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Switch
              checked={settingsForm.is_active}
              onCheckedChange={(checked) => setSettingsForm({ ...settingsForm, is_active: checked })}
            />
            <Label>Section Enabled</Label>
          </div>
          <Tabs defaultValue="en" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="en">English</TabsTrigger>
              <TabsTrigger value="ar">العربية (Arabic)</TabsTrigger>
            </TabsList>

            <TabsContent value="en" className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label>Eyebrow Text</Label>
            <Input
              value={settingsForm.eyebrow}
              onChange={(e) => setSettingsForm({ ...settingsForm, eyebrow: e.target.value })}
              placeholder="BUILT IN TOOLS"
            />
          </div>
          <div className="space-y-2">
            <Label>Headline</Label>
            <Input
              value={settingsForm.headline}
              onChange={(e) => setSettingsForm({ ...settingsForm, headline: e.target.value })}
              placeholder="An entire stack of tools that keep your kitchen moving"
            />
            <p className="text-xs text-muted-foreground">
              The word "kitchen" will have an emoji icon inserted before it
            </p>
          </div>
            </TabsContent>

            <TabsContent value="ar" className="space-y-3 mt-4">
            <div className="space-y-2" dir="rtl">
              <Label dir="ltr">Eyebrow (Arabic)</Label>
              <Input value={settingsForm.eyebrow_ar} onChange={(e) => setSettingsForm({ ...settingsForm, eyebrow_ar: e.target.value })} placeholder="أدوات مدمجة" />
            </div>
            <div className="space-y-2" dir="rtl">
              <Label dir="ltr">Headline (Arabic)</Label>
              <Input value={settingsForm.headline_ar} onChange={(e) => setSettingsForm({ ...settingsForm, headline_ar: e.target.value })} />
            </div>
            </TabsContent>
          </Tabs>
          <Button onClick={handleSaveSettings} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Settings"}
          </Button>
        </CardContent>
      </Card>

      {/* Categories */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Tool Categories</CardTitle>
            <CardDescription>
              Business types that filter the tools display
            </CardDescription>
          </div>
          <Dialog open={isCreatingCategory} onOpenChange={setIsCreatingCategory}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Add Category
              </Button>
            </DialogTrigger>
            <DialogContent>
              <ToolsCategoryForm
                onSubmit={(data) => {
                  onCreateCategory(data);
                  setIsCreatingCategory(false);
                }}
                onCancel={() => setIsCreatingCategory(false)}
              />
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {categories.map((category) => (
              <div
                key={category.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-card"
              >
                <div className="flex items-center gap-3">
                  <GripVertical className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{category.name}</p>
                    <p className="text-sm text-muted-foreground">
                      Sort: {category.sort_order} • {items.filter(i => i.category_id === category.id).length} items
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={category.is_active ? "default" : "secondary"}>
                    {category.is_active ? "Active" : "Hidden"}
                  </Badge>
                  <Switch
                    checked={category.is_active}
                    onCheckedChange={(checked) => onUpdateCategory({ id: category.id, is_active: checked })}
                  />
                  <Dialog open={editingCategory?.id === category.id} onOpenChange={(open) => !open && setEditingCategory(null)}>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="icon" onClick={() => setEditingCategory(category)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <ToolsCategoryForm
                        category={category}
                        onSubmit={(data) => {
                          onUpdateCategory({ id: category.id, ...data });
                          setEditingCategory(null);
                        }}
                        onCancel={() => setEditingCategory(null)}
                      />
                    </DialogContent>
                  </Dialog>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Category?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will delete the category "{category.name}" and all its items. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => onDeleteCategory(category.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tool Items */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Tool Items</CardTitle>
            <CardDescription>
              Individual tools displayed within each category
            </CardDescription>
          </div>
          <Dialog open={isCreatingItem} onOpenChange={setIsCreatingItem}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Add Tool
              </Button>
            </DialogTrigger>
            <DialogContent>
              <ToolsItemForm
                categories={categories}
                onSubmit={(data) => {
                  onCreateItem(data);
                  setIsCreatingItem(false);
                }}
                onCancel={() => setIsCreatingItem(false)}
              />
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {categories.map((category) => {
            const categoryItems = items.filter(i => i.category_id === category.id);
            if (categoryItems.length === 0) return null;
            
            return (
              <div key={category.id} className="mb-6 last:mb-0">
                <h4 className="text-sm font-medium text-muted-foreground mb-3">{category.name}</h4>
                <div className="space-y-2">
                  {categoryItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-card"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-light text-muted-foreground w-6">{item.number}</span>
                        <div>
                          <p className="font-medium">{item.title}</p>
                          <p className="text-sm text-muted-foreground line-clamp-1">{item.description}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{item.preview_type}</Badge>
                        <Switch
                          checked={item.is_active}
                          onCheckedChange={(checked) => onUpdateItem({ id: item.id, is_active: checked })}
                        />
                        <Dialog open={editingItem?.id === item.id} onOpenChange={(open) => !open && setEditingItem(null)}>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="icon" onClick={() => setEditingItem(item)}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <ToolsItemForm
                              item={item}
                              categories={categories}
                              onSubmit={(data) => {
                                onUpdateItem({ id: item.id, ...data });
                                setEditingItem(null);
                              }}
                              onCancel={() => setEditingItem(null)}
                            />
                          </DialogContent>
                        </Dialog>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-destructive">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Tool?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will delete the tool "{item.title}". This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => onDeleteItem(item.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
};

// Tools Category Form
const ToolsCategoryForm = ({
  category,
  onSubmit,
  onCancel,
}: {
  category?: ToolsCategory;
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) => {
  const [formData, setFormData] = useState({
    name: category?.name || "",
    sort_order: category?.sort_order || 1,
    is_active: category?.is_active ?? true,
    name_ar: category?.name_ar || "",
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{category ? "Edit Category" : "Add Category"}</DialogTitle>
        <DialogDescription>
          Categories are the business types shown as filter tabs
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <Tabs defaultValue="en" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="en">English</TabsTrigger>
            <TabsTrigger value="ar">العربية (Arabic)</TabsTrigger>
          </TabsList>

          <TabsContent value="en" className="space-y-4 mt-4">
        <div className="space-y-2">
          <Label>Category Name</Label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Independent Restaurant"
          />
        </div>
        <div className="space-y-2">
          <Label>Sort Order</Label>
          <Input
            type="number"
            value={formData.sort_order}
            onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={formData.is_active}
            onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
          />
          <Label>Active</Label>
        </div>
          </TabsContent>

          <TabsContent value="ar" className="space-y-2 mt-4" dir="rtl">
            <Label dir="ltr">Category Name (Arabic)</Label>
            <Input value={formData.name_ar} onChange={(e) => setFormData({ ...formData, name_ar: e.target.value })} placeholder="مطعم مستقل" />
          </TabsContent>
        </Tabs>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onSubmit(formData)}>
          {category ? "Save Changes" : "Add Category"}
        </Button>
      </DialogFooter>
    </>
  );
};

// Tools Item Form
const ToolsItemForm = ({
  item,
  categories,
  onSubmit,
  onCancel,
}: {
  item?: ToolsItem;
  categories: ToolsCategory[];
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) => {
  const [formData, setFormData] = useState({
    category_id: item?.category_id || categories[0]?.id || "",
    number: item?.number || 1,
    title: item?.title || "",
    description: item?.description || "",
    preview_type: item?.preview_type || "pos",
    sort_order: item?.sort_order || 1,
    is_active: item?.is_active ?? true,
    title_ar: item?.title_ar || "",
    description_ar: item?.description_ar || "",
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{item ? "Edit Tool" : "Add Tool"}</DialogTitle>
        <DialogDescription>
          Configure a tool item with its preview type
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <Tabs defaultValue="en" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="en">English</TabsTrigger>
            <TabsTrigger value="ar">العربية (Arabic)</TabsTrigger>
          </TabsList>

          <TabsContent value="en" className="space-y-4 mt-4">
        <div className="space-y-2">
          <Label>Category</Label>
          <Select
            value={formData.category_id}
            onValueChange={(value) => setFormData({ ...formData, category_id: value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Number</Label>
            <Input
              type="number"
              value={formData.number}
              onChange={(e) => setFormData({ ...formData, number: parseInt(e.target.value) || 1 })}
            />
          </div>
          <div className="space-y-2">
            <Label>Sort Order</Label>
            <Input
              type="number"
              value={formData.sort_order}
              onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Title</Label>
          <Input
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="Restaurant POS"
          />
        </div>
        <div className="space-y-2">
          <Label>Description</Label>
          <Textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="A fast, intuitive point-of-sale system..."
            rows={3}
          />
        </div>
        <div className="space-y-2">
          <Label>Preview Type</Label>
          <Select
            value={formData.preview_type}
            onValueChange={(value) => setFormData({ ...formData, preview_type: value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select preview" />
            </SelectTrigger>
            <SelectContent>
              {previewTypeOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Determines the animated preview shown on the card
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={formData.is_active}
            onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
          />
          <Label>Active</Label>
        </div>
          </TabsContent>

          <TabsContent value="ar" className="space-y-3 mt-4">
          <div className="space-y-2" dir="rtl">
            <Label dir="ltr">Title (Arabic)</Label>
            <Input value={formData.title_ar} onChange={(e) => setFormData({ ...formData, title_ar: e.target.value })} />
          </div>
          <div className="space-y-2" dir="rtl">
            <Label dir="ltr">Description (Arabic)</Label>
            <Textarea rows={3} value={formData.description_ar} onChange={(e) => setFormData({ ...formData, description_ar: e.target.value })} />
          </div>
          </TabsContent>
        </Tabs>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onSubmit(formData)}>
          {item ? "Save Changes" : "Add Tool"}
        </Button>
      </DialogFooter>
    </>
  );
};

export default AdminLandingCMS;
