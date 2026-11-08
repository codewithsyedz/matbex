import { useState } from "react";
import {
  useCMSPageBlocks,
  useCreateCMSBlock,
  useUpdateCMSBlock,
  useDeleteCMSBlock,
  CMSPageBlock,
} from "@/hooks/useCMSPages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import { Plus, Trash2, GripVertical, Eye, EyeOff } from "lucide-react";

const BLOCK_TYPES = [
  { value: "hero", label: "Hero Section", description: "Large header with title and subtitle" },
  { value: "text", label: "Text Block", description: "Rich text content section" },
  { value: "features", label: "Features Grid", description: "Grid of feature cards" },
  { value: "cta", label: "Call to Action", description: "CTA section with button" },
  { value: "pricing", label: "Pricing Cards", description: "Pricing tier cards" },
  { value: "faq", label: "FAQ Section", description: "Accordion FAQ items" },
  { value: "team", label: "Team Grid", description: "Team member cards" },
  { value: "stats", label: "Stats Row", description: "Key statistics display" },
  { value: "testimonials", label: "Testimonials", description: "Customer quotes" },
  { value: "image", label: "Image Block", description: "Full-width image" },
  { value: "cards", label: "Content Cards", description: "Grid of content cards" },
];

interface CMSPageBlockEditorProps {
  pageId: string;
  pageSlug: string;
}

export function CMSPageBlockEditor({ pageId, pageSlug }: CMSPageBlockEditorProps) {
  const { data: blocks, isLoading } = useCMSPageBlocks(pageId);
  const createBlock = useCreateCMSBlock();
  const updateBlock = useUpdateCMSBlock();
  const deleteBlock = useDeleteCMSBlock();
  const [newBlockType, setNewBlockType] = useState("");

  const handleAddBlock = () => {
    if (!newBlockType) return;
    const maxOrder = Math.max(0, ...(blocks?.map((b) => b.sort_order) || [0]));
    createBlock.mutate({
      page_id: pageId,
      block_type: newBlockType,
      sort_order: maxOrder + 1,
      is_visible: true,
      config: getDefaultConfig(newBlockType),
    });
    setNewBlockType("");
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Add New Block */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-2">
            <Select value={newBlockType} onValueChange={setNewBlockType}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Select block type to add..." />
              </SelectTrigger>
              <SelectContent>
                {BLOCK_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    <div>
                      <span className="font-medium">{type.label}</span>
                      <span className="text-muted-foreground ml-2 text-xs">
                        {type.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleAddBlock} disabled={!newBlockType}>
              <Plus className="h-4 w-4 mr-1" />
              Add Block
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Block List */}
      {blocks?.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            No blocks yet. Add your first block above.
          </CardContent>
        </Card>
      ) : (
        <Accordion type="single" collapsible className="space-y-2">
          {blocks?.map((block, index) => (
            <AccordionItem
              key={block.id}
              value={block.id}
              className="border rounded-lg px-4"
            >
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-3 flex-1">
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">
                    {BLOCK_TYPES.find((t) => t.value === block.block_type)?.label ||
                      block.block_type}
                  </span>
                  {!block.is_visible && (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="text-xs text-muted-foreground ml-auto mr-4">
                    Order: {block.sort_order}
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <BlockConfigEditor
                  block={block}
                  onUpdate={(config) =>
                    updateBlock.mutate({ id: block.id, page_id: pageId, config })
                  }
                  onToggleVisibility={() =>
                    updateBlock.mutate({
                      id: block.id,
                      page_id: pageId,
                      is_visible: !block.is_visible,
                    })
                  }
                  onDelete={() => deleteBlock.mutate({ id: block.id, page_id: pageId })}
                  onReorder={(newOrder) =>
                    updateBlock.mutate({
                      id: block.id,
                      page_id: pageId,
                      sort_order: newOrder,
                    })
                  }
                />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}

function BlockConfigEditor({
  block,
  onUpdate,
  onToggleVisibility,
  onDelete,
  onReorder,
}: {
  block: CMSPageBlock;
  onUpdate: (config: Record<string, any>) => void;
  onToggleVisibility: () => void;
  onDelete: () => void;
  onReorder: (order: number) => void;
}) {
  const [config, setConfig] = useState(block.config);

  const handleFieldChange = (field: string, value: any) => {
    const newConfig = { ...config, [field]: value };
    setConfig(newConfig);
  };

  const handleSave = () => {
    onUpdate(config);
  };

  const renderConfigFields = () => {
    switch (block.block_type) {
      case "hero":
        return (
          <>
            <ConfigField label="Eyebrow Text" field="eyebrow" config={config} onChange={handleFieldChange} />
            <ConfigField label="Headline" field="headline" config={config} onChange={handleFieldChange} />
            <ConfigField label="Subheadline" field="subheadline" config={config} onChange={handleFieldChange} textarea />
            <ConfigField label="Primary CTA Text" field="primaryCtaText" config={config} onChange={handleFieldChange} />
            <ConfigField label="Primary CTA Link" field="primaryCtaLink" config={config} onChange={handleFieldChange} />
            <ConfigField label="Secondary CTA Text" field="secondaryCtaText" config={config} onChange={handleFieldChange} />
            <ConfigField label="Background Gradient" field="bgGradient" config={config} onChange={handleFieldChange} />
          </>
        );
      case "text":
        return (
          <>
            <ConfigField label="Title" field="title" config={config} onChange={handleFieldChange} />
            <ConfigField label="Content" field="content" config={config} onChange={handleFieldChange} textarea rows={6} />
          </>
        );
      case "features":
        return (
          <>
            <ConfigField label="Section Title" field="title" config={config} onChange={handleFieldChange} />
            <ConfigField label="Section Subtitle" field="subtitle" config={config} onChange={handleFieldChange} />
            <div className="space-y-2">
              <Label>Features (JSON Array)</Label>
              <Textarea
                value={JSON.stringify(config.items || [], null, 2)}
                onChange={(e) => {
                  try {
                    handleFieldChange("items", JSON.parse(e.target.value));
                  } catch {}
                }}
                rows={8}
                className="font-mono text-sm"
                placeholder='[{"title": "Feature 1", "description": "...", "icon": "Star"}]'
              />
            </div>
          </>
        );
      case "cta":
        return (
          <>
            <ConfigField label="Headline" field="headline" config={config} onChange={handleFieldChange} />
            <ConfigField label="Description" field="description" config={config} onChange={handleFieldChange} textarea />
            <ConfigField label="Button Text" field="buttonText" config={config} onChange={handleFieldChange} />
            <ConfigField label="Button Link" field="buttonLink" config={config} onChange={handleFieldChange} />
            <ConfigField label="Background Style" field="bgStyle" config={config} onChange={handleFieldChange} />
          </>
        );
      case "pricing":
        return (
          <>
            <ConfigField label="Section Title" field="title" config={config} onChange={handleFieldChange} />
            <div className="space-y-2">
              <Label>Pricing Tiers (JSON Array)</Label>
              <Textarea
                value={JSON.stringify(config.tiers || [], null, 2)}
                onChange={(e) => {
                  try {
                    handleFieldChange("tiers", JSON.parse(e.target.value));
                  } catch {}
                }}
                rows={10}
                className="font-mono text-sm"
                placeholder='[{"name": "Starter", "price": 99, "features": [...]}]'
              />
            </div>
          </>
        );
      case "faq":
        return (
          <>
            <ConfigField label="Section Title" field="title" config={config} onChange={handleFieldChange} />
            <div className="space-y-2">
              <Label>FAQ Items (JSON Array)</Label>
              <Textarea
                value={JSON.stringify(config.items || [], null, 2)}
                onChange={(e) => {
                  try {
                    handleFieldChange("items", JSON.parse(e.target.value));
                  } catch {}
                }}
                rows={8}
                className="font-mono text-sm"
                placeholder='[{"question": "...", "answer": "..."}]'
              />
            </div>
          </>
        );
      case "team":
        return (
          <>
            <ConfigField label="Section Title" field="title" config={config} onChange={handleFieldChange} />
            <ConfigField label="Section Subtitle" field="subtitle" config={config} onChange={handleFieldChange} />
            <div className="space-y-2">
              <Label>Team Members (JSON Array)</Label>
              <Textarea
                value={JSON.stringify(config.members || [], null, 2)}
                onChange={(e) => {
                  try {
                    handleFieldChange("members", JSON.parse(e.target.value));
                  } catch {}
                }}
                rows={8}
                className="font-mono text-sm"
                placeholder='[{"name": "...", "role": "...", "image": "..."}]'
              />
            </div>
          </>
        );
      case "stats":
        return (
          <>
            <div className="space-y-2">
              <Label>Stats (JSON Array)</Label>
              <Textarea
                value={JSON.stringify(config.stats || [], null, 2)}
                onChange={(e) => {
                  try {
                    handleFieldChange("stats", JSON.parse(e.target.value));
                  } catch {}
                }}
                rows={6}
                className="font-mono text-sm"
                placeholder='[{"value": "99%", "label": "Uptime"}]'
              />
            </div>
          </>
        );
      case "testimonials":
        return (
          <>
            <ConfigField label="Section Title" field="title" config={config} onChange={handleFieldChange} />
            <div className="space-y-2">
              <Label>Testimonials (JSON Array)</Label>
              <Textarea
                value={JSON.stringify(config.items || [], null, 2)}
                onChange={(e) => {
                  try {
                    handleFieldChange("items", JSON.parse(e.target.value));
                  } catch {}
                }}
                rows={8}
                className="font-mono text-sm"
                placeholder='[{"quote": "...", "author": "...", "role": "..."}]'
              />
            </div>
          </>
        );
      case "image":
        return (
          <>
            <ConfigField label="Image URL" field="src" config={config} onChange={handleFieldChange} />
            <ConfigField label="Alt Text" field="alt" config={config} onChange={handleFieldChange} />
            <ConfigField label="Caption" field="caption" config={config} onChange={handleFieldChange} />
          </>
        );
      case "cards":
        return (
          <>
            <ConfigField label="Section Title" field="title" config={config} onChange={handleFieldChange} />
            <ConfigField label="Columns (2-4)" field="columns" config={config} onChange={handleFieldChange} />
            <div className="space-y-2">
              <Label>Cards (JSON Array)</Label>
              <Textarea
                value={JSON.stringify(config.cards || [], null, 2)}
                onChange={(e) => {
                  try {
                    handleFieldChange("cards", JSON.parse(e.target.value));
                  } catch {}
                }}
                rows={8}
                className="font-mono text-sm"
                placeholder='[{"title": "...", "description": "...", "icon": "..."}]'
              />
            </div>
          </>
        );
      default:
        return (
          <div className="space-y-2">
            <Label>Raw Config (JSON)</Label>
            <Textarea
              value={JSON.stringify(config, null, 2)}
              onChange={(e) => {
                try {
                  setConfig(JSON.parse(e.target.value));
                } catch {}
              }}
              rows={8}
              className="font-mono text-sm"
            />
          </div>
        );
    }
  };

  return (
    <div className="space-y-4 pt-2 pb-4">
      <div className="flex items-center justify-between pb-2 border-b">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleVisibility}
          >
            {block.is_visible ? (
              <>
                <Eye className="h-4 w-4 mr-1" /> Visible
              </>
            ) : (
              <>
                <EyeOff className="h-4 w-4 mr-1" /> Hidden
              </>
            )}
          </Button>
          <div className="flex items-center gap-2">
            <Label className="text-sm">Order:</Label>
            <Input
              type="number"
              value={block.sort_order}
              onChange={(e) => onReorder(parseInt(e.target.value) || 0)}
              className="w-20"
            />
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <Trash2 className="h-4 w-4 mr-1" />
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Block?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. The block will be permanently removed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="grid gap-4">
        {renderConfigFields()}
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={handleSave}>Save Block</Button>
      </div>
    </div>
  );
}

function ConfigField({
  label,
  field,
  config,
  onChange,
  textarea = false,
  rows = 3,
}: {
  label: string;
  field: string;
  config: Record<string, any>;
  onChange: (field: string, value: any) => void;
  textarea?: boolean;
  rows?: number;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {textarea ? (
        <Textarea
          value={config[field] || ""}
          onChange={(e) => onChange(field, e.target.value)}
          rows={rows}
        />
      ) : (
        <Input
          value={config[field] || ""}
          onChange={(e) => onChange(field, e.target.value)}
        />
      )}
    </div>
  );
}

function getDefaultConfig(blockType: string): Record<string, any> {
  switch (blockType) {
    case "hero":
      return {
        eyebrow: "Welcome",
        headline: "Page Title",
        subheadline: "A brief description of this page.",
        primaryCtaText: "Get Started",
        primaryCtaLink: "/register",
      };
    case "text":
      return { title: "Section Title", content: "Your content here..." };
    case "features":
      return {
        title: "Features",
        subtitle: "",
        items: [{ title: "Feature 1", description: "Description", icon: "Star" }],
      };
    case "cta":
      return {
        headline: "Ready to get started?",
        description: "Start your journey today.",
        buttonText: "Get Started",
        buttonLink: "/register",
      };
    case "pricing":
      return { title: "Pricing", tiers: [] };
    case "faq":
      return { title: "Frequently Asked Questions", items: [] };
    case "team":
      return { title: "Our Team", subtitle: "", members: [] };
    case "stats":
      return { stats: [{ value: "100+", label: "Customers" }] };
    case "testimonials":
      return { title: "What Our Customers Say", items: [] };
    case "image":
      return { src: "", alt: "", caption: "" };
    case "cards":
      return { title: "", columns: 3, cards: [] };
    default:
      return {};
  }
}
