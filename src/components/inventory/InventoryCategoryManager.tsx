import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

type CogsFrequency = "weekly" | "monthly";

interface InventoryCategory {
  id: string;
  name: string;
  cogs_frequency: CogsFrequency;
  inventory_account_code: string;
  cogs_account_code: string;
  created_at: string;
}

const FREQUENCY_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const ACCOUNT_CODE_OPTIONS = [
  { value: "1200", label: "1200 - Food Inventory" },
  { value: "1210", label: "1210 - Beverage Inventory" },
  { value: "1220", label: "1220 - Packaging Inventory" },
];

const COGS_CODE_OPTIONS = [
  { value: "5000", label: "5000 - Food COGS" },
  { value: "5010", label: "5010 - Beverage COGS" },
  { value: "5020", label: "5020 - Packaging COGS" },
];

export function InventoryCategoryManager() {
  const { restaurant, isManager } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<InventoryCategory | null>(null);
  const [categoryToDelete, setCategoryToDelete] = useState<InventoryCategory | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [cogsFrequency, setCogsFrequency] = useState<CogsFrequency>("monthly");
  const [inventoryAccountCode, setInventoryAccountCode] = useState("1200");
  const [cogsAccountCode, setCogsAccountCode] = useState("5000");

  // Fetch categories
  const { data: categories = [], isLoading } = useQuery({
    queryKey: ["inventory-categories", restaurant?.id],
    queryFn: async () => {
      if (!restaurant?.id) return [];
      const { data, error } = await db
        .from("inventory_categories")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("name");
      if (error) throw error;
      return data as InventoryCategory[];
    },
    enabled: !!restaurant?.id,
  });

  // Create/Update mutation
  const saveMutation = useMutation({
    mutationFn: async (categoryData: {
      name: string;
      cogs_frequency: CogsFrequency;
      inventory_account_code: string;
      cogs_account_code: string;
    }) => {
      if (!restaurant?.id) throw new Error("No restaurant");

      if (editingCategory) {
        const { error } = await db
          .from("inventory_categories")
          .update(categoryData)
          .eq("id", editingCategory.id);
        if (error) throw error;
      } else {
        const { error } = await db
          .from("inventory_categories")
          .insert({ ...categoryData, restaurant_id: restaurant.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: editingCategory ? "Category updated" : "Category added" });
      queryClient.invalidateQueries({ queryKey: ["inventory-categories"] });
      closeDialog();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (categoryId: string) => {
      const { error } = await db
        .from("inventory_categories")
        .delete()
        .eq("id", categoryId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Category deleted" });
      queryClient.invalidateQueries({ queryKey: ["inventory-categories"] });
      setDeleteDialogOpen(false);
      setCategoryToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const openEditDialog = (category: InventoryCategory) => {
    setEditingCategory(category);
    setName(category.name);
    setCogsFrequency(category.cogs_frequency);
    setInventoryAccountCode(category.inventory_account_code);
    setCogsAccountCode(category.cogs_account_code);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingCategory(null);
    setName("");
    setCogsFrequency("monthly");
    setInventoryAccountCode("1200");
    setCogsAccountCode("5000");
  };

  const handleSave = () => {
    if (!name.trim()) {
      toast({
        title: "Error",
        description: "Please enter a category name",
        variant: "destructive",
      });
      return;
    }

    saveMutation.mutate({
      name: name.trim(),
      cogs_frequency: cogsFrequency,
      inventory_account_code: inventoryAccountCode,
      cogs_account_code: cogsAccountCode,
    });
  };

  const handleDelete = (category: InventoryCategory) => {
    setCategoryToDelete(category);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (categoryToDelete) {
      deleteMutation.mutate(categoryToDelete.id);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Inventory Categories</h3>
        {isManager && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => closeDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                Add Category
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {editingCategory ? "Edit Category" : "Add Category"}
                </DialogTitle>
                <DialogDescription>
                  {editingCategory
                    ? "Update category details"
                    : "Create a new inventory category"}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Category Name</Label>
                  <Input
                    placeholder="e.g., Chicken, Vegetables, Spices"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>COGS Frequency</Label>
                  <Select
                    value={cogsFrequency}
                    onValueChange={(val) => setCogsFrequency(val as CogsFrequency)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FREQUENCY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Inventory Account</Label>
                  <Select
                    value={inventoryAccountCode}
                    onValueChange={setInventoryAccountCode}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCOUNT_CODE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>COGS Account</Label>
                  <Select value={cogsAccountCode} onValueChange={setCogsAccountCode}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COGS_CODE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  className="w-full"
                  onClick={handleSave}
                  disabled={saveMutation.isPending || !name.trim()}
                >
                  {saveMutation.isPending
                    ? "Saving..."
                    : editingCategory
                    ? "Update Category"
                    : "Add Category"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      ) : categories.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 text-center border rounded-lg">
          <p className="text-muted-foreground">No categories yet</p>
          <p className="text-sm text-muted-foreground">
            Add categories to organize your inventory
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>COGS Frequency</TableHead>
                <TableHead>Inventory Account</TableHead>
                <TableHead>COGS Account</TableHead>
                {isManager && <TableHead className="w-20">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((category) => (
                <TableRow key={category.id}>
                  <TableCell className="font-medium">{category.name}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        category.cogs_frequency === "weekly"
                          ? "border-orange-500/50 text-orange-600"
                          : "border-blue-500/50 text-blue-600"
                      }
                    >
                      {category.cogs_frequency}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {category.inventory_account_code}
                  </TableCell>
                  <TableCell className="font-mono text-sm">
                    {category.cogs_account_code}
                  </TableCell>
                  {isManager && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEditDialog(category)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(category)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Category</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{categoryToDelete?.name}"? This
              action cannot be undone. Items using this category will have their
              category unset.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
