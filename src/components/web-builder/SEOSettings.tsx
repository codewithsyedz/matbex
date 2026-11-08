import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Search } from "lucide-react";

interface SEOSettingsProps {
  title: string;
  metaDescription: string;
  onTitleChange: (title: string) => void;
  onMetaDescriptionChange: (description: string) => void;
}

export function SEOSettings({
  title,
  metaDescription,
  onTitleChange,
  onMetaDescriptionChange,
}: SEOSettingsProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-md bg-primary/10">
            <Search className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base font-medium">Search Optimization</CardTitle>
            <CardDescription>
              Control how search engines index and display your landing page
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Meta Title */}
        <div className="space-y-2">
          <Label htmlFor="meta-title">Page Title</Label>
          <Input
            id="meta-title"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Your Restaurant | Fine Dining in City"
            maxLength={60}
          />
          <p className="text-xs text-muted-foreground">
            {title.length}/60 characters. Shows in browser tab and search results
          </p>
        </div>

        {/* Meta Description */}
        <div className="space-y-2">
          <Label htmlFor="meta-description">Meta Description</Label>
          <Textarea
            id="meta-description"
            value={metaDescription}
            onChange={(e) => onMetaDescriptionChange(e.target.value)}
            placeholder="Discover authentic cuisine at our award-winning restaurant. Fresh ingredients, exceptional service, and unforgettable dining experiences."
            maxLength={160}
            rows={3}
          />
          <p className="text-xs text-muted-foreground">
            {metaDescription.length}/160 characters. Appears below your title in search results
          </p>
        </div>

        {/* Preview */}
        <div className="space-y-2">
          <Label>Search Preview</Label>
          <div className="p-4 rounded-lg bg-muted/50 border">
            <div className="text-blue-600 text-lg font-medium truncate">
              {title || "Your Restaurant | Fine Dining in City"}
            </div>
            <div className="text-emerald-700 text-sm truncate">
              yourrestaurant.matbex.app
            </div>
            <div className="text-muted-foreground text-sm mt-1 line-clamp-2">
              {metaDescription || "Discover authentic cuisine at our award-winning restaurant. Fresh ingredients, exceptional service, and unforgettable dining experiences."}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
