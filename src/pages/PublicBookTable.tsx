import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CalendarCheck, CheckCircle2, Loader2, Utensils } from "lucide-react";
import { toast } from "sonner";

const TIME_SLOTS = [
  "12:00", "12:30", "13:00", "13:30", "14:00", "14:30",
  "18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00",
];

export default function PublicBookTable() {
  const { restaurantId } = useParams<{ restaurantId: string }>();
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    guest_name: "",
    guest_phone: "",
    guest_email: "",
    party_size: 2,
    reserved_date: today,
    reserved_time: "19:00",
    notes: "",
  });

  const restaurant = useQuery({
    queryKey: ["public-restaurant-booking", restaurantId],
    enabled: !!restaurantId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("restaurants_public")
        .select("id,name")
        .eq("id", restaurantId!)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; name: string } | null;
    },
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!restaurantId) return;
    if (!form.guest_name.trim() || !form.guest_phone.trim()) {
      toast.error("Please add your name and phone number");
      return;
    }
    setSubmitting(true);
    const { error } = await (supabase as any).from("table_reservations").insert({
      restaurant_id: restaurantId,
      guest_name: form.guest_name.trim(),
      guest_phone: form.guest_phone.trim(),
      guest_email: form.guest_email.trim() || null,
      party_size: Number(form.party_size) || 2,
      reserved_date: form.reserved_date,
      reserved_time: form.reserved_time,
      notes: form.notes.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error("We could not save your booking. Please try again.");
      return;
    }
    setDone(true);
  }

  const name = restaurant.data?.name || "our restaurant";

  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-lg space-y-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Utensils className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-semibold">Book a table</h1>
            <p className="text-sm text-muted-foreground">{name}</p>
          </div>
        </div>

        {done ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                Your table is requested
              </CardTitle>
              <CardDescription>
                {form.guest_name}, we have your request for {form.party_size} on {form.reserved_date} at{" "}
                {form.reserved_time}. The team will confirm by phone.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={() => setDone(false)}>
                Book another table
              </Button>
              <Button asChild>
                <Link to={`/order/${restaurantId}`}>See the menu</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <CalendarCheck className="h-5 w-5 text-primary" />
                Reservation details
              </CardTitle>
              <CardDescription>We will call you back to confirm.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={submit}>
                <div className="space-y-2">
                  <Label htmlFor="guest_name">Your name</Label>
                  <Input
                    id="guest_name"
                    value={form.guest_name}
                    onChange={(e) => setForm({ ...form, guest_name: e.target.value })}
                    required
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="guest_phone">Phone</Label>
                    <Input
                      id="guest_phone"
                      type="tel"
                      value={form.guest_phone}
                      onChange={(e) => setForm({ ...form, guest_phone: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="guest_email">Email (optional)</Label>
                    <Input
                      id="guest_email"
                      type="email"
                      value={form.guest_email}
                      onChange={(e) => setForm({ ...form, guest_email: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="party_size">Guests</Label>
                    <Input
                      id="party_size"
                      type="number"
                      min={1}
                      max={50}
                      value={form.party_size}
                      onChange={(e) => setForm({ ...form, party_size: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reserved_date">Date</Label>
                    <Input
                      id="reserved_date"
                      type="date"
                      min={today}
                      value={form.reserved_date}
                      onChange={(e) => setForm({ ...form, reserved_date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reserved_time">Time</Label>
                    <select
                      id="reserved_time"
                      className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={form.reserved_time}
                      onChange={(e) => setForm({ ...form, reserved_time: e.target.value })}
                    >
                      {TIME_SLOTS.map((slot) => (
                        <option key={slot} value={slot}>
                          {slot}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Anything we should know?</Label>
                  <Textarea
                    id="notes"
                    rows={3}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="Birthday, high chair, allergies…"
                  />
                </div>
                <Button type="submit" className="min-h-11 w-full" disabled={submitting}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Request table"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
