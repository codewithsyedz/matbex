import { useState, useRef } from "react";
import { Upload, Download, FileText, AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  parseInventoryCSV,
  downloadInventoryTemplate,
  ParsedInventoryItem,
} from "@/lib/inventoryExportUtils";

interface InventoryCSVImportProps {
  onImportComplete: () => void;
}

export function InventoryCSVImport({ onImportComplete }: InventoryCSVImportProps) {
  const { restaurant } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [parsedItems, setParsedItems] = useState<ParsedInventoryItem[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      const { items, errors } = parseInventoryCSV(content);
      setParsedItems(items);
      setParseErrors(errors);
      setDialogOpen(true);
    } catch (error) {
      console.error("Error parsing CSV:", error);
      toast({
        title: "Error",
        description: "Failed to parse CSV file",
        variant: "destructive",
      });
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleImport = async () => {
    if (!restaurant?.id || parsedItems.length === 0) return;

    setImporting(true);
    try {
      const itemsToInsert = parsedItems.map((item) => ({
        restaurant_id: restaurant.id,
        name: item.name,
        current_stock: item.current_stock,
        unit: item.unit,
        unit_cost: item.unit_cost,
        vat_percentage: item.vat_percentage,
        reorder_level: item.reorder_level,
      }));

      const { error } = await db
        .from("inventory_items")
        .insert(itemsToInsert);

      if (error) throw error;

      toast({
        title: "Import successful",
        description: `Imported ${parsedItems.length} inventory items`,
      });

      setDialogOpen(false);
      setParsedItems([]);
      setParseErrors([]);
      onImportComplete();
    } catch (error: any) {
      console.error("Error importing items:", error);
      toast({
        title: "Import failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setParsedItems([]);
    setParseErrors([]);
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleFileSelect}
      />

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={downloadInventoryTemplate}
        >
          <Download className="h-4 w-4" />
          Template
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-4 w-4" />
          Import CSV
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Import Preview
            </DialogTitle>
            <DialogDescription>
              Review the items before importing
            </DialogDescription>
          </DialogHeader>

          {parseErrors.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {parseErrors.slice(0, 5).map((error, idx) => (
                    <li key={idx}>{error}</li>
                  ))}
                  {parseErrors.length > 5 && (
                    <li>...and {parseErrors.length - 5} more errors</li>
                  )}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {parsedItems.length > 0 && (
            <>
              <div className="flex-1 overflow-auto border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Stock</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead>Cost</TableHead>
                      <TableHead>VAT %</TableHead>
                      <TableHead>Reorder</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedItems.slice(0, 10).map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>{item.current_stock}</TableCell>
                        <TableCell>{item.unit}</TableCell>
                        <TableCell>{item.unit_cost.toFixed(2)}</TableCell>
                        <TableCell>{item.vat_percentage}%</TableCell>
                        <TableCell>{item.reorder_level ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {parsedItems.length > 10 && (
                  <div className="p-3 text-sm text-muted-foreground text-center border-t">
                    ...and {parsedItems.length - 10} more items
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-4">
                <p className="text-sm text-muted-foreground">
                  <Check className="h-4 w-4 inline mr-1 text-emerald-500" />
                  {parsedItems.length} items ready to import
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={closeDialog}>
                    Cancel
                  </Button>
                  <Button onClick={handleImport} disabled={importing}>
                    {importing ? "Importing..." : "Import All"}
                  </Button>
                </div>
              </div>
            </>
          )}

          {parsedItems.length === 0 && parseErrors.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">
              No valid items found in the CSV file
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
