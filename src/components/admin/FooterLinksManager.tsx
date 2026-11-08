import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Pencil, Check, X, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useFooterLinks, useToggleFooterLink, useUpdateFooterLink, FooterLink } from "@/hooks/useFooterLinks";

const categoryLabels: Record<string, string> = {
  product: "Product",
  company: "Company",
  resources: "Resources",
  legal: "Legal",
};

const categoryColors: Record<string, string> = {
  product: "bg-blue-100 text-blue-800",
  company: "bg-green-100 text-green-800",
  resources: "bg-purple-100 text-purple-800",
  legal: "bg-orange-100 text-orange-800",
};

export function FooterLinksManager() {
  const { data: links, isLoading } = useFooterLinks();
  const toggleMutation = useToggleFooterLink();
  const updateMutation = useUpdateFooterLink();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ label: "", href: "" });

  const handleToggle = async (link: FooterLink) => {
    try {
      await toggleMutation.mutateAsync({ id: link.id, is_enabled: !link.is_enabled });
      toast.success(`${link.link_label} ${!link.is_enabled ? "enabled" : "disabled"}`);
    } catch {
      toast.error("Failed to update link status");
    }
  };

  const startEdit = (link: FooterLink) => {
    setEditingId(link.id);
    setEditForm({ label: link.link_label, href: link.link_href });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ label: "", href: "" });
  };

  const saveEdit = async (id: string) => {
    try {
      await updateMutation.mutateAsync({ id, link_label: editForm.label, link_href: editForm.href });
      toast.success("Link updated successfully");
      setEditingId(null);
    } catch {
      toast.error("Failed to update link");
    }
  };

  const groupedLinks = links?.reduce((acc, link) => {
    if (!acc[link.category]) acc[link.category] = [];
    acc[link.category].push(link);
    return acc;
  }, {} as Record<string, FooterLink[]>);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Footer Links Manager</CardTitle>
        <CardDescription>
          Enable or disable footer links displayed on the landing page. Changes take effect immediately.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {Object.entries(groupedLinks || {}).map(([category, categoryLinks]) => (
          <div key={category} className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className={categoryColors[category]}>
                {categoryLabels[category]}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {categoryLinks.filter((l) => l.is_enabled).length}/{categoryLinks.length} enabled
              </span>
            </div>
            <div className="space-y-2">
              {categoryLinks.map((link) => (
                <div
                  key={link.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                >
                  {editingId === link.id ? (
                    <div className="flex-1 flex items-center gap-3">
                      <div className="flex-1 space-y-2">
                        <div>
                          <Label className="text-xs">Label</Label>
                          <Input
                            value={editForm.label}
                            onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                            className="h-8"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">URL</Label>
                          <Input
                            value={editForm.href}
                            onChange={(e) => setEditForm({ ...editForm, href: e.target.value })}
                            className="h-8"
                          />
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => saveEdit(link.id)}
                          disabled={updateMutation.isPending}
                        >
                          <Check className="h-4 w-4 text-green-600" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={cancelEdit}>
                          <X className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={link.is_enabled}
                          onCheckedChange={() => handleToggle(link)}
                          disabled={toggleMutation.isPending}
                        />
                        <div>
                          <p className={`font-medium ${!link.is_enabled ? "text-muted-foreground line-through" : ""}`}>
                            {link.link_label}
                          </p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <ExternalLink className="h-3 w-3" />
                            {link.link_href}
                          </p>
                        </div>
                      </div>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => startEdit(link)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
