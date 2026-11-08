import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageBlock, BlockContent } from "@/hooks/usePageBlocks";
import { LottieSelector } from "../LottieSelector";
import { MenuBlockConfig } from "./MenuBlockConfig";
import { HoursBlockConfig } from "./HoursBlockConfig";

interface BlockConfigDialogProps {
  block: PageBlock;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (content: BlockContent) => void;
}

export function BlockConfigDialog({ block, open, onOpenChange, onSave }: BlockConfigDialogProps) {
  const [content, setContent] = useState<BlockContent>(block.content as BlockContent);

  useEffect(() => {
    setContent(block.content as BlockContent);
  }, [block]);

  const updateContent = (key: keyof BlockContent, value: unknown) => {
    setContent(prev => ({ ...prev, [key]: value }));
  };

  const renderConfig = () => {
    switch (block.block_type) {
      case 'hero':
        return (
          <div className="space-y-4">
            <Tabs defaultValue="content">
              <TabsList className="w-full">
                <TabsTrigger value="content" className="flex-1">Content</TabsTrigger>
                <TabsTrigger value="animation" className="flex-1">Animation</TabsTrigger>
              </TabsList>
              <TabsContent value="content" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input
                    value={content.title || ''}
                    onChange={(e) => updateContent('title', e.target.value)}
                    placeholder="Welcome to Our Restaurant"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Subtitle</Label>
                  <Textarea
                    value={content.subtitle || ''}
                    onChange={(e) => updateContent('subtitle', e.target.value)}
                    placeholder="Experience the finest cuisine..."
                    rows={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label>CTA Button Text</Label>
                  <Input
                    value={content.cta_text || ''}
                    onChange={(e) => updateContent('cta_text', e.target.value)}
                    placeholder="View Menu"
                  />
                </div>
                <div className="space-y-2">
                  <Label>CTA Button Link</Label>
                  <Input
                    value={content.cta_link || ''}
                    onChange={(e) => updateContent('cta_link', e.target.value)}
                    placeholder="#menu"
                  />
                </div>
              </TabsContent>
              <TabsContent value="animation" className="mt-4">
                <LottieSelector
                  value={content.lottie_preset || content.lottie_url}
                  onChange={(value, isPreset) => {
                    if (isPreset) {
                      updateContent('lottie_preset', value);
                      updateContent('lottie_url', undefined);
                    } else {
                      updateContent('lottie_url', value);
                      updateContent('lottie_preset', undefined);
                    }
                  }}
                />
              </TabsContent>
            </Tabs>
          </div>
        );

      case 'menu':
        return (
          <MenuBlockConfig
            content={content}
            onUpdate={updateContent}
          />
        );

      case 'hours':
        return (
          <HoursBlockConfig
            content={content}
            onUpdate={updateContent}
          />
        );

      case 'location':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Address</Label>
              <Textarea
                value={content.address || ''}
                onChange={(e) => updateContent('address', e.target.value)}
                placeholder="123 Main Street, City, Country"
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                value={content.phone || ''}
                onChange={(e) => updateContent('phone', e.target.value)}
                placeholder="+1 234 567 890"
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={content.email || ''}
                onChange={(e) => updateContent('email', e.target.value)}
                placeholder="hello@restaurant.com"
              />
            </div>
            <div className="space-y-2">
              <Label>Google Maps Embed URL (optional)</Label>
              <Input
                value={content.map_embed_url || ''}
                onChange={(e) => updateContent('map_embed_url', e.target.value)}
                placeholder="https://www.google.com/maps/embed?..."
              />
              <p className="text-xs text-muted-foreground">
                Paste the iframe src URL from Google Maps
              </p>
            </div>
          </div>
        );

      case 'cta':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Heading</Label>
              <Input
                value={content.heading || ''}
                onChange={(e) => updateContent('heading', e.target.value)}
                placeholder="Ready to Dine?"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={content.description || ''}
                onChange={(e) => updateContent('description', e.target.value)}
                placeholder="Book your table today and experience..."
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label>Button Text</Label>
              <Input
                value={content.button_text || ''}
                onChange={(e) => updateContent('button_text', e.target.value)}
                placeholder="Make a Reservation"
              />
            </div>
            <div className="space-y-2">
              <Label>Button Link</Label>
              <Input
                value={content.button_link || ''}
                onChange={(e) => updateContent('button_link', e.target.value)}
                placeholder="https://..."
              />
            </div>
          </div>
        );

      case 'gallery':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Layout Style</Label>
              <div className="flex gap-2">
                {(['grid', 'masonry', 'carousel'] as const).map((layout) => (
                  <Button
                    key={layout}
                    variant={content.layout === layout ? "default" : "outline"}
                    size="sm"
                    onClick={() => updateContent('layout', layout)}
                    className="capitalize"
                  >
                    {layout}
                  </Button>
                ))}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Upload images in the Hero editor tab. Gallery will display all uploaded images.
            </p>
          </div>
        );

      case 'testimonials':
        return (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Testimonials will be displayed from your reviews. You can configure display options here.
            </p>
            <div className="flex items-center gap-2">
              <Switch
                checked={content.show_images !== false}
                onCheckedChange={(checked) => updateContent('show_images', checked)}
              />
              <Label>Show reviewer photos</Label>
            </div>
          </div>
        );

      case 'custom':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Custom HTML</Label>
              <Textarea
                value={content.html || ''}
                onChange={(e) => updateContent('html', e.target.value)}
                placeholder="<div>Your custom HTML...</div>"
                rows={8}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                ⚠️ Custom HTML is rendered as-is. Ensure your code is safe and valid.
              </p>
            </div>
          </div>
        );

      default:
        return <p className="text-muted-foreground">No configuration available for this block type.</p>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent description="Configure the content and styling for this page block." className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="capitalize">
            Edit {block.block_type.replace('_', ' ')} Block
          </DialogTitle>
        </DialogHeader>
        
        <div className="py-4">
          {renderConfig()}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onSave(content)}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
