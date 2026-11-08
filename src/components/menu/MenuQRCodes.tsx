import { useState, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Printer, Download, Search } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";

interface MenuItem {
  id: string;
  name: string;
  category: string;
  quarter_price: number;
  half_price: number;
  full_price: number;
  selling_price: number;
  is_active: boolean;
}

interface MenuQRCodesProps {
  isOpen: boolean;
  onClose: () => void;
  menuItems: MenuItem[];
  restaurantId: string;
}

type SizeType = "quarter" | "half" | "full";

interface QRData {
  restaurantId: string;
  menuItemId: string;
  name: string;
  size: SizeType;
  price: number;
}

export function MenuQRCodes({ isOpen, onClose, menuItems, restaurantId }: MenuQRCodesProps) {
  const { format: formatCurrency } = useCurrency();
  const [searchTerm, setSearchTerm] = useState("");
  const printRef = useRef<HTMLDivElement>(null);

  const filteredItems = menuItems.filter(
    (item) =>
      item.is_active &&
      item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const generateQRValue = (item: MenuItem, size: SizeType): string => {
    const data: QRData = {
      restaurantId,
      menuItemId: item.id,
      name: item.name,
      size,
      price: size === "quarter" ? item.quarter_price : size === "half" ? item.half_price : item.full_price || item.selling_price,
    };
    return JSON.stringify(data);
  };

  const getSizeLabel = (size: SizeType) => {
    switch (size) {
      case "quarter":
        return "Quarter";
      case "half":
        return "Half";
      case "full":
        return "Full";
    }
  };

  const getItemSizes = (item: MenuItem): { size: SizeType; price: number }[] => {
    const sizes: { size: SizeType; price: number }[] = [];
    
    if (item.quarter_price > 0) {
      sizes.push({ size: "quarter", price: item.quarter_price });
    }
    if (item.half_price > 0) {
      sizes.push({ size: "half", price: item.half_price });
    }
    if (item.full_price > 0 || item.selling_price > 0) {
      sizes.push({ size: "full", price: item.full_price || item.selling_price });
    }
    
    // If no specific sizes, just add full with selling price
    if (sizes.length === 0) {
      sizes.push({ size: "full", price: item.selling_price });
    }
    
    return sizes;
  };

  const handlePrint = () => {
    const printContent = printRef.current;
    if (!printContent) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Menu QR Codes</title>
          <style>
            body {
              font-family: system-ui, -apple-system, sans-serif;
              padding: 20px;
            }
            .qr-grid {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 20px;
            }
            .qr-card {
              border: 1px solid #ddd;
              border-radius: 8px;
              padding: 16px;
              text-align: center;
              break-inside: avoid;
            }
            .qr-name {
              font-weight: 600;
              font-size: 14px;
              margin-bottom: 4px;
            }
            .qr-size {
              font-size: 12px;
              color: #666;
              margin-bottom: 8px;
            }
            .qr-price {
              font-weight: 500;
              font-size: 12px;
              margin-top: 8px;
            }
            @media print {
              .qr-card {
                page-break-inside: avoid;
              }
            }
          </style>
        </head>
        <body>
          ${printContent.innerHTML}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const downloadAllAsImage = async () => {
    const printContent = printRef.current;
    if (!printContent) return;

    // Use html2canvas if available, otherwise fallback to print
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(printContent);
      const link = document.createElement("a");
      link.download = "menu-qr-codes.png";
      link.href = canvas.toDataURL();
      link.click();
    } catch {
      // Fallback to print
      handlePrint();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent description="Printable QR codes that link customers to your live menu, one per branch." className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Menu QR Codes</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search menu items..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />
            Print All
          </Button>
          <Button variant="outline" size="sm" onClick={downloadAllAsImage}>
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
        </div>

        <ScrollArea className="h-[60vh]">
          <div ref={printRef} className="qr-grid grid grid-cols-2 md:grid-cols-3 gap-4 p-2">
            {filteredItems.map((item) =>
              getItemSizes(item).map(({ size, price }) => (
                <Card key={`${item.id}-${size}`} className="qr-card">
                  <CardContent className="pt-6 flex flex-col items-center">
                    <p className="qr-name font-medium text-sm text-center mb-1 truncate w-full">
                      {item.name}
                    </p>
                    <Badge variant="secondary" className="qr-size mb-2">
                      {getSizeLabel(size)}
                    </Badge>
                    <QRCodeSVG
                      value={generateQRValue(item, size)}
                      size={100}
                      level="M"
                      includeMargin={true}
                    />
                    <p className="qr-price text-sm font-medium mt-2">
                      {formatCurrency(price)}
                    </p>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {filteredItems.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No active menu items found
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
