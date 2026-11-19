import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Plus, Pencil, Trash2, Loader2, Monitor } from "lucide-react";
import { toast } from "sonner";

interface Drawer {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export function DrawerManager() {
  const { restaurant } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDrawer, setEditingDrawer] = useState<Drawer | null>(null);
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);

  const { data: drawers = [], isLoading } = useQuery({
    queryKey: ["drawers", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("drawers")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("name");
      if (error) throw error;
      return data as Drawer[];
    },
    enabled: !!restaurant?.id,
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; is_active: boolean }) => {
      const { error } = await db.from("drawers").insert({
        name: data.name,
        is_active: data.is_active,
        restaurant_id: restaurant!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drawers"] });
      toast.success("Drawer created successfully");
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to create drawer");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; name: string; is_active: boolean }) => {
      const { error } = await db
        .from("drawers")
        .update({ name: data.name, is_active: data.is_active })
        .eq("id", data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drawers"] });
      toast.success("Drawer updated successfully");
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update drawer");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("drawers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drawers"] });
      toast.success("Drawer deleted successfully");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete drawer. It may be in use by shifts.");
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await db
        .from("drawers")
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drawers"] });
      toast.success("Drawer status updated");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update drawer status");
    },
  });

  const resetForm = () => {
    setName("");
    setIsActive(true);
    setEditingDrawer(null);
    setDialogOpen(false);
  };

  const openEditDialog = (drawer: Drawer) => {
    setEditingDrawer(drawer);
    setName(drawer.name);
    setIsActive(drawer.is_active);
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      toast.error("Please enter a drawer name");
      return;
    }

    if (editingDrawer) {
      updateMutation.mutate({ id: editingDrawer.id, name: name.trim(), is_active: isActive });
    } else {
      createMutation.mutate({ name: name.trim(), is_active: isActive });
    }
  };

  const activeDrawers = drawers.filter(d => d.is_active);
  const inactiveDrawers = drawers.filter(d => !d.is_active);

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-accent text-accent-foreground">
            <Monitor className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-medium text-foreground">Cash Drawers / Shift Types</h3>
            <p className="text-sm text-muted-foreground">
              Configure drawers like Main Register, Drive Thru, etc.
            </p>
          </div>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" />
              Add Drawer
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingDrawer ? "Edit Drawer" : "Add New Drawer"}</DialogTitle>
              <DialogDescription>
                {editingDrawer 
                  ? "Update the drawer name and status" 
                  : "Create a new drawer type for your shifts"}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Drawer Name</Label>
                <Input
                  placeholder="e.g., Main Register, Drive Thru, Counter 2"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Active</Label>
                  <p className="text-sm text-muted-foreground">
                    Inactive drawers won't appear in shift options
                  </p>
                </div>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </div>
              <Button 
                className="w-full" 
                onClick={handleSubmit}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                {editingDrawer ? "Update Drawer" : "Create Drawer"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : drawers.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 text-center">
          <Monitor className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-muted-foreground text-sm">No drawers configured</p>
          <p className="text-xs text-muted-foreground">Add your first drawer to get started</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Summary badges */}
          <div className="flex gap-2">
            <Badge variant="outline" className="bg-success/10 text-success border-success/20">
              {activeDrawers.length} Active
            </Badge>
            {inactiveDrawers.length > 0 && (
              <Badge variant="outline" className="bg-muted text-muted-foreground">
                {inactiveDrawers.length} Inactive
              </Badge>
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[100px]">Active</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drawers.map((drawer) => (
                <TableRow key={drawer.id}>
                  <TableCell className="font-medium">{drawer.name}</TableCell>
                  <TableCell>
                    <Badge 
                      variant="outline" 
                      className={drawer.is_active 
                        ? "bg-success/10 text-success border-success/20" 
                        : "bg-muted text-muted-foreground"
                      }
                    >
                      {drawer.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={drawer.is_active}
                      onCheckedChange={(checked) => 
                        toggleActiveMutation.mutate({ id: drawer.id, is_active: checked })
                      }
                      disabled={toggleActiveMutation.isPending}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEditDialog(drawer)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Drawer</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete "{drawer.name}"? This cannot be undone.
                              If this drawer is used by any shifts, deletion will fail.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => deleteMutation.mutate(drawer.id)}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
