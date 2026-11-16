import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Receipt, Save } from "lucide-react";
import { db } from "@/integrations/db/client";
import { toast } from "sonner";

/** platform_settings key the subscription-invoice function reads for the seller block. */
const KEY = "matbex_seller";

interface Seller {
  legal_name: string;
  vat_number: string;
  cr_number: string;
  address: string;
}

const empty: Seller = { legal_name: "", vat_number: "", cr_number: "", address: "" };

/**
 * Matbex's own company details, printed as the seller on the tax invoices for subscription,
 * add-on and registration payments (Billing → Payment history).
 */
export function MatbexSellerSettingsCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<Seller>(empty);

  const load = async () => {
    setLoading(true);
    const { data, error } = await db.from("platform_settings" as any).select("value").eq("key", KEY).maybeSingle();
    if (error) toast.error(error.message);
    setValues({ ...empty, ...(((data as any)?.value ?? {}) as Partial<Seller>) });
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const vatValid = !values.vat_number.trim() || /^3\d{13}3$/.test(values.vat_number.trim());
  const complete = !!values.legal_name.trim() && !!values.vat_number.trim() && !!values.address.trim();

  const save = async () => {
    if (!vatValid) { toast.error("A Saudi VAT number is 15 digits, starting and ending with 3"); return; }
    setSaving(true);
    const value: Seller = {
      legal_name: values.legal_name.trim(),
      vat_number: values.vat_number.trim(),
      cr_number: values.cr_number.trim(),
      address: values.address.trim(),
    };
    const { error } = await db.from("platform_settings" as any).upsert(
      { key: KEY, value, is_secret: false, description: "Matbex seller details on subscription tax invoices" },
      { onConflict: "key" },
    );
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Invoice details saved");
    await load();
  };

  const field = (k: keyof Seller, label: string, placeholder: string) => (
    <div className="space-y-1">
      <Label htmlFor={`seller-${k}`}>{label}</Label>
      <Input id={`seller-${k}`} value={values[k]} placeholder={placeholder}
        onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} />
    </div>
  );

  return (
    <Card className="border-border/40 md:col-span-2">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg font-medium">Subscription invoice details</CardTitle>
          </div>
          {!loading && <Badge variant={complete ? "default" : "secondary"}>{complete ? "Complete" : "Incomplete"}</Badge>}
        </div>
        <CardDescription>
          Matbex's company details, printed as the seller on the tax invoices customers get for their plan,
          add-on and registration payments.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              {field("legal_name", "Legal company name", "As on the commercial registration")}
              {field("vat_number", "VAT registration number", "3xxxxxxxxxxxxx3")}
              {field("cr_number", "Commercial registration (CR) number", "Optional")}
            </div>
            {!vatValid && <p className="text-sm text-destructive">A Saudi VAT number is 15 digits, starting and ending with 3.</p>}
            <div className="space-y-1">
              <Label htmlFor="seller-address">Registered address</Label>
              <Textarea id="seller-address" rows={2} value={values.address} placeholder="Building, street, district, city, postal code"
                onChange={(e) => setValues((v) => ({ ...v, address: e.target.value }))} />
            </div>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}Save
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
