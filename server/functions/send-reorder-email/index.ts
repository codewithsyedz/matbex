import { env } from "../_runtime/env.ts";
import { fromAddress } from "../_shared/sender.ts";
import { serve } from "../_runtime/serve.ts";
import { Resend } from "resend";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
const resend = new Resend(env("RESEND_API_KEY"));

interface ReorderEmailRequest {
  supplier_id: string;
  supplier_name: string;
  supplier_email: string;
  items: Array<{
    name: string;
    current_stock: number;
    reorder_level: number;
    unit: string;
    requested_quantity: number;
  }>;
  restaurant_name: string;
}

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Require authenticated caller - prevents anyone from sending emails through us.
    try {
      await requireUser(req);
    } catch (resp) {
      if (resp instanceof Response) {
        const body = await resp.text();
        return new Response(body, { status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw resp;
    }

    const { supplier_id, supplier_name, supplier_email, items, restaurant_name }: ReorderEmailRequest = await req.json();

    if (!supplier_email) {
      return new Response(
        JSON.stringify({ error: "Supplier email not provided" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const itemsList = items.map(item => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.name}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.current_stock} ${item.unit}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.requested_quantity} ${item.unit}</td>
      </tr>
    `).join("");

    const emailResponse = await resend.emails.send({
      from: fromAddress("Matbex Inventory", "inventory"),
      to: [supplier_email],
      subject: `Reorder Request from ${restaurant_name}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #f8f9fa; padding: 20px; border-radius: 8px 8px 0 0; }
            .content { background: #fff; padding: 20px; border: 1px solid #eee; border-radius: 0 0 8px 8px; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th { background: #f8f9fa; padding: 10px; text-align: left; }
            .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2 style="margin: 0; color: #333;">Reorder Request</h2>
              <p style="margin: 5px 0 0; color: #666;">From ${restaurant_name}</p>
            </div>
            <div class="content">
              <p>Dear ${supplier_name},</p>
              <p>We would like to place an order for the following items that are running low in our inventory:</p>
              
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Current Stock</th>
                    <th>Requested Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsList}
                </tbody>
              </table>
              
              <p>Please confirm availability and expected delivery date at your earliest convenience.</p>
              
              <p>Thank you for your partnership!</p>
              
              <div class="footer">
                <p>This is an automated message from ${restaurant_name}'s inventory system.</p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    console.log("Reorder email sent successfully:", emailResponse);

    return new Response(JSON.stringify({ success: true, data: emailResponse }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error sending reorder email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
