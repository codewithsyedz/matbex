import { useState } from "react";
import { useCMSPages, useUpdateCMSPage, useCMSPageBlocks, CMSPage } from "@/hooks/useCMSPages";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileText, Settings2, ExternalLink, Layers, Eye, Pencil, Languages, Loader2 } from "lucide-react";
import { CMSPageBlockEditor } from "./CMSPageBlockEditor";
import { CMSBlockRenderer } from "@/components/cms/CMSBlockRenderer";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function CMSPageManager() {
  const { data: pages, isLoading } = useCMSPages();
  const updatePage = useUpdateCMSPage();
  const [editingPage, setEditingPage] = useState<CMSPage | null>(null);
  const [blockEditorPage, setBlockEditorPage] = useState<CMSPage | null>(null);
  const [translatingAll, setTranslatingAll] = useState(false);
  const [translatingSlug, setTranslatingSlug] = useState<string | null>(null);

  const runTranslate = async (opts: { slug?: string; force?: boolean }) => {
    const isAll = !opts.slug;
    if (isAll) setTranslatingAll(true);
    else setTranslatingSlug(opts.slug!);
    try {
      const { data, error } = await supabase.functions.invoke("cms-translate-arabic", {
        body: opts,
      });
      if (error) throw error;
      const s = data?.summary;
      toast.success(
        `Arabic translation complete — ${s?.pages ?? 0} page(s), ${s?.blocks ?? 0} block(s)` +
          (s?.skipped ? ` (${s.skipped} skipped)` : ""),
      );
    } catch (e: any) {
      const msg = e?.message ?? "Translation failed";
      if (msg.includes("RATE_LIMITED")) toast.error("AI rate limit hit — try again in a moment.");
      else if (msg.includes("AI_CREDITS")) toast.error("Lovable AI credits exhausted — top up workspace.");
      else toast.error(msg);
    } finally {
      setTranslatingAll(false);
      setTranslatingSlug(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  const getCategoryFromSlug = (slug: string) => {
    const productPages = ["investment-tiers", "integrations", "api"];
    const companyPages = ["about", "careers", "blog", "press"];
    const resourcePages = ["documentation", "help-center", "community", "status"];
    const legalPages = ["privacy-policy", "terms-of-service", "security", "cookies"];

    if (productPages.includes(slug)) return "Product";
    if (companyPages.includes(slug)) return "Company";
    if (resourcePages.includes(slug)) return "Resources";
    if (legalPages.includes(slug)) return "Legal";
    return "Other";
  };

  const groupedPages = pages?.reduce((acc, page) => {
    const category = getCategoryFromSlug(page.slug);
    if (!acc[category]) acc[category] = [];
    acc[category].push(page);
    return acc;
  }, {} as Record<string, CMSPage[]>) || {};

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="font-medium flex items-center gap-2">
              <Languages className="h-4 w-4" /> Arabic translations
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Auto-translate every page and block to Arabic via Lovable AI. Skips rows that already have an Arabic translation unless you force a re-run.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => runTranslate({ force: false })}
              disabled={translatingAll}
            >
              {translatingAll && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Translate missing
            </Button>
            <Button
              variant="secondary"
              onClick={() => runTranslate({ force: true })}
              disabled={translatingAll}
            >
              Re-translate all
            </Button>
          </div>
        </CardContent>
      </Card>

      {Object.entries(groupedPages).map(([category, categoryPages]) => (
        <Card key={category}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {category} Pages
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Page</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categoryPages.map((page) => (
                  <TableRow key={page.id}>
                    <TableCell className="font-medium">{page.title}</TableCell>
                    <TableCell className="text-muted-foreground">/{page.slug}</TableCell>
                    <TableCell>
                      <Badge variant={page.is_published ? "default" : "secondary"}>
                        {page.is_published ? "Published" : "Draft"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => setBlockEditorPage(page)}
                      >
                        <Layers className="h-4 w-4 mr-1" />
                        Edit Content
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingPage(page)}
                      >
                        <Settings2 className="h-4 w-4 mr-1" />
                        SEO
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        asChild
                      >
                        <a href={`/${page.slug}`} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}

      {/* Page Settings Dialog */}
      <Dialog open={!!editingPage} onOpenChange={(open) => !open && setEditingPage(null)}>
        <DialogContent
          description={
            editingPage
              ? `Edit metadata for "${editingPage.title}" (/${editingPage.slug}) - title, slug, publish status.`
              : "Edit CMS page metadata."
          }
          className="max-w-lg"
        >
          <DialogHeader>
            <DialogTitle>Page Settings: {editingPage?.title}</DialogTitle>
          </DialogHeader>
          {editingPage && (
            <PageSettingsForm
              page={editingPage}
              onSave={(updates) => {
                updatePage.mutate({ id: editingPage.id, ...updates });
                setEditingPage(null);
              }}
              onCancel={() => setEditingPage(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Block Editor Dialog with Preview */}
      <Dialog open={!!blockEditorPage} onOpenChange={(open) => !open && setBlockEditorPage(null)}>
        <DialogContent
          description={
            blockEditorPage
              ? `Block editor for "${blockEditorPage.title}" (/${blockEditorPage.slug}).`
              : "CMS block editor."
          }
          className="max-w-[95vw] w-full max-h-[95vh] h-[90vh] p-0"
        >
          <DialogHeader className="px-6 py-4 border-b">
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Edit Content: {blockEditorPage?.title}
            </DialogTitle>
          </DialogHeader>
          {blockEditorPage && (
            <BlockEditorWithPreview 
              pageId={blockEditorPage.id} 
              pageSlug={blockEditorPage.slug} 
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BlockEditorWithPreview({ pageId, pageSlug }: { pageId: string; pageSlug: string }) {
  const { data: blocks, isLoading } = useCMSPageBlocks(pageId);
  const [activeTab, setActiveTab] = useState<"edit" | "preview">("edit");

  if (isLoading) {
    return (
      <div className="flex-1 p-6">
        <Skeleton className="h-full w-full" />
      </div>
    );
  }

  return (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "edit" | "preview")} className="flex flex-col h-full">
      <div className="border-b px-6">
        <TabsList className="h-10">
          <TabsTrigger value="edit" className="gap-2">
            <Pencil className="h-4 w-4" />
            Edit Blocks
          </TabsTrigger>
          <TabsTrigger value="preview" className="gap-2">
            <Eye className="h-4 w-4" />
            Live Preview
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="edit" className="flex-1 m-0 overflow-y-auto max-h-[calc(90vh-120px)]">
        <div className="p-6">
          <CMSPageBlockEditor pageId={pageId} pageSlug={pageSlug} />
        </div>
      </TabsContent>

      <TabsContent value="preview" className="flex-1 m-0 overflow-y-auto max-h-[calc(90vh-120px)]">
        <div className="bg-white min-h-full">
          {blocks && blocks.length > 0 ? (
            <CMSBlockRenderer blocks={blocks} />
          ) : (
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              No blocks to preview. Add blocks in the Edit tab.
            </div>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}

function PageSettingsForm({
  page,
  onSave,
  onCancel,
}: {
  page: CMSPage;
  onSave: (updates: Partial<CMSPage>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(page.title);
  const [metaTitle, setMetaTitle] = useState(page.meta_title || "");
  const [metaDescription, setMetaDescription] = useState(page.meta_description || "");
  const [isPublished, setIsPublished] = useState(page.is_published);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Page Title</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="space-y-2">
        <Label>Meta Title (SEO)</Label>
        <Input
          value={metaTitle}
          onChange={(e) => setMetaTitle(e.target.value)}
          placeholder="Title for search engines"
        />
        <p className="text-xs text-muted-foreground">{metaTitle.length}/60 characters</p>
      </div>

      <div className="space-y-2">
        <Label>Meta Description (SEO)</Label>
        <Input
          value={metaDescription}
          onChange={(e) => setMetaDescription(e.target.value)}
          placeholder="Description for search engines"
        />
        <p className="text-xs text-muted-foreground">{metaDescription.length}/160 characters</p>
      </div>

      <div className="flex items-center justify-between">
        <Label>Published</Label>
        <Switch checked={isPublished} onCheckedChange={setIsPublished} />
      </div>

      <div className="flex gap-2 justify-end pt-4">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={() =>
            onSave({
              title,
              meta_title: metaTitle || null,
              meta_description: metaDescription || null,
              is_published: isPublished,
            })
          }
        >
          Save Changes
        </Button>
      </div>
    </div>
  );
}
