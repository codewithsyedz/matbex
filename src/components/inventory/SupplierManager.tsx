import { useState, useEffect } from "react";
import { Plus, Building2, Pencil, Trash2, Mail, Phone, Power, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import { CopyToBranchDialog } from "@/components/shared/CopyToBranchDialog";
import { BulkCopyToBranchDialog } from "@/components/shared/BulkCopyToBranchDialog";
import { useBranch } from "@/contexts/BranchContext";
import { BranchBadge } from "@/components/branch/BranchBadge";
import { useTranslation } from "react-i18next";

interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  branch_id?: string | null;
}

export function SupplierManager() {
  const { restaurant, hasRole } = useAuth();
  const { activeBranchId } = useBranch();
  const isManager = hasRole("manager") || hasRole("owner");
  const isOwner = hasRole("owner");
  const { toast } = useToast();
  const { t } = useTranslation();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copySource, setCopySource] = useState<Supplier | null>(null);
  const [bulkCopyOpen, setBulkCopyOpen] = useState(false);
  const [bulkCopyAllOpen, setBulkCopyAllOpen] = useState(false);
  const [branchMap, setBranchMap] = useState<Record<string, string>>({});

  // Form state
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (restaurant?.id) {
      fetchSuppliers();
      fetchBranches();
    }
  }, [restaurant?.id]);

  const fetchBranches = async () => {
    if (!restaurant?.id) return;
    const { data } = await db
      .from("branches")
      .select("id, name")
      .eq("restaurant_id", restaurant.id)
      .is("deleted_at", null);
    const map: Record<string, string> = {};
    (data || []).forEach((b: any) => (map[b.id] = b.name));
    setBranchMap(map);
  };

  const fetchSuppliers = async () => {
    if (!restaurant?.id) return;
    
    try {
      const { data, error } = await db
        .from("suppliers")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .order("name");

      if (error) throw error;
      setSuppliers(data || []);
    } catch (error) {
      console.error("Error fetching suppliers:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !restaurant?.id) {
      toast({ title: t("inventory.suppliers.error"), description: t("inventory.suppliers.nameRequired"), variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const supplierData = {
        name: name.trim(),
        contact_name: contactName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        notes: notes.trim() || null,
        restaurant_id: restaurant.id,
        is_active: isActive,
      };

      if (editingSupplier) {
        const { error } = await db
          .from("suppliers")
          .update(supplierData)
          .eq("id", editingSupplier.id);

        if (error) throw error;
        toast({ title: t("inventory.suppliers.updated") });
      } else {
        const { error } = await db
          .from("suppliers")
          .insert(supplierData);

        if (error) throw error;
        toast({ title: t("inventory.suppliers.added") });
      }

      fetchSuppliers();
      closeDialog();
    } catch (error: any) {
      console.error("Error saving supplier:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (supplier: Supplier) => {
    if (!confirm(t("inventory.suppliers.deleteConfirm", { name: supplier.name }))) return;

    try {
      const { error } = await db
        .from("suppliers")
        .delete()
        .eq("id", supplier.id);

      if (error) throw error;
      toast({ title: t("inventory.suppliers.deleted") });
      fetchSuppliers();
    } catch (error: any) {
      console.error("Error deleting supplier:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const openEditDialog = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setName(supplier.name);
    setContactName(supplier.contact_name || "");
    setEmail(supplier.email || "");
    setPhone(supplier.phone || "");
    setAddress(supplier.address || "");
    setNotes(supplier.notes || "");
    setIsActive(supplier.is_active);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingSupplier(null);
    setName("");
    setContactName("");
    setEmail("");
    setPhone("");
    setAddress("");
    setNotes("");
    setIsActive(true);
  };

  const toggleActive = async (supplier: Supplier) => {
    try {
      const { error } = await db
        .from("suppliers")
        .update({ is_active: !supplier.is_active })
        .eq("id", supplier.id);
      if (error) throw error;
      toast({ title: supplier.is_active ? t("inventory.suppliers.deactivated") : t("inventory.suppliers.activated") });
      fetchSuppliers();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base font-medium">{t("inventory.suppliers.title")}</CardTitle>
        {isManager && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setBulkCopyOpen(true)}
            >
              <Copy className="h-4 w-4" />
              {t("inventory.suppliers.copyBranch")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setBulkCopyAllOpen(true)}
            >
              <Copy className="h-4 w-4" />
              {t("inventory.suppliers.copyAll")}
            </Button>
            <Dialog open={dialogOpen} onOpenChange={(open) => open ? setDialogOpen(true) : closeDialog()}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus className="h-4 w-4" />
                {t("inventory.suppliers.add")}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{editingSupplier ? t("inventory.suppliers.edit") : t("inventory.suppliers.add")}</DialogTitle>
                <DialogDescription>
                  {editingSupplier ? t("inventory.suppliers.updateDetails") : t("inventory.suppliers.addDescription")}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>{t("inventory.suppliers.name")}</Label>
                  <Input
                    placeholder={t("inventory.suppliers.namePlaceholder")}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t("inventory.suppliers.contact")}</Label>
                  <Input
                    placeholder={t("inventory.suppliers.contactPlaceholder")}
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t("inventory.suppliers.email")}</Label>
                    <Input
                      type="email"
                      placeholder="supplier@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("inventory.suppliers.phone")}</Label>
                    <Input
                      placeholder="+966..."
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t("inventory.suppliers.address")}</Label>
                  <Input
                    placeholder={t("inventory.suppliers.addressPlaceholder")}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t("inventory.suppliers.notes")}</Label>
                  <Textarea
                    placeholder={t("inventory.suppliers.notesPlaceholder")}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                  />
                </div>

                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="space-y-0.5">
                    <Label>{t("inventory.suppliers.active")}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t("inventory.suppliers.inactiveHelp")}
                    </p>
                  </div>
                  <Switch checked={isActive} onCheckedChange={setIsActive} />
                </div>

                <Button 
                  className="w-full" 
                  onClick={handleSave}
                  disabled={submitting || !name.trim()}
                >
                  {submitting ? t("inventory.suppliers.saving") : editingSupplier ? t("inventory.suppliers.update") : t("inventory.suppliers.add")}
                </Button>
              </div>
            </DialogContent>
            </Dialog>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">{t("inventory.suppliers.loading")}</div>
        ) : suppliers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Building2 className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>{t("inventory.suppliers.empty")}</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("inventory.suppliers.title")}</TableHead>
                <TableHead>{t("inventory.suppliers.contact")}</TableHead>
                <TableHead>{t("inventory.suppliers.emailPhone")}</TableHead>
                <TableHead>{t("inventory.suppliers.branch")}</TableHead>
                <TableHead>{t("inventory.suppliers.status")}</TableHead>
                {isManager && <TableHead className="w-20">{t("inventory.suppliers.actions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((supplier) => (
                <TableRow key={supplier.id}>
                  <TableCell className="font-medium">{supplier.name}</TableCell>
                  <TableCell>{supplier.contact_name || "-"}</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {supplier.email && (
                        <div className="flex items-center gap-1 text-sm">
                          <Mail className="h-3 w-3 text-muted-foreground" />
                          {supplier.email}
                        </div>
                      )}
                      {supplier.phone && (
                        <div className="flex items-center gap-1 text-sm">
                          <Phone className="h-3 w-3 text-muted-foreground" />
                          {supplier.phone}
                        </div>
                      )}
                      {!supplier.email && !supplier.phone && "-"}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[150px]">
                    {supplier.branch_id ? (
                      <BranchBadge
                        size="sm"
                        branchId={supplier.branch_id}
                        name={branchMap[supplier.branch_id] || "Branch"}
                      />
                    ) : (
                      <Badge variant="secondary" className="text-xs font-normal">
                        All branches
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={supplier.is_active ? "secondary" : "outline"} 
                      className={supplier.is_active ? "bg-emerald-500/10 text-emerald-600" : ""}>
                      {supplier.is_active ? t("inventory.suppliers.active") : t("inventory.suppliers.inactive")}
                    </Badge>
                  </TableCell>
                  {isManager && (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title={t("inventory.suppliers.copyBranch")}
                          onClick={() => setCopySource(supplier)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title={supplier.is_active ? t("inventory.suppliers.deactivate") : t("inventory.suppliers.activate")}
                          onClick={() => toggleActive(supplier)}
                        >
                          <Power className={`h-4 w-4 ${supplier.is_active ? "text-emerald-600" : "text-muted-foreground"}`} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEditDialog(supplier)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {isOwner && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(supplier)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {restaurant?.id && (
        <CopyToBranchDialog
          open={!!copySource}
          onOpenChange={(o) => {
            if (!o) setCopySource(null);
          }}
          entity="supplier"
          restaurantId={restaurant.id}
          source={copySource}
          sourceLabel={copySource?.name}
        />
      )}
      {restaurant?.id && (
        <BulkCopyToBranchDialog
          open={bulkCopyOpen}
          onOpenChange={setBulkCopyOpen}
          entity="supplier"
          restaurantId={restaurant.id}
          sourceBranchId={activeBranchId}
        />
      )}
      {restaurant?.id && (
        <BulkCopyToBranchDialog
          open={bulkCopyAllOpen}
          onOpenChange={setBulkCopyAllOpen}
          entity="supplier"
          restaurantId={restaurant.id}
          sourceBranchId={activeBranchId}
          defaultTargetBranch="__ALL__"
        />
      )}
    </Card>
  );
}
