import { env } from "../_runtime/env.ts";
import { fromAddress } from "../_shared/sender.ts";
import { serve } from "../_runtime/serve.ts";
import { createClient } from "@matbex/client";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { guardCronCaller } from "../_shared/cronGuard.ts";
import { isBranchEmailable } from "../_shared/branchEmailable.ts";
const Resend = (await import("resend")).Resend;

interface ProfitSummaryRequest {
  restaurant_id: string;
  email: string;
  date?: string;
}

interface PeriodData {
  totalSales: number;
  operatingProfit: number;
  primeCostPct: number;
  marginPct: number;
}

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = buildCorsHeaders(req);
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const unauthorized = await guardCronCaller(req, corsHeaders, { allowAnyUser: true });
  if (unauthorized) return unauthorized;

  try {
    const resendApiKey = env("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const resend = new Resend(resendApiKey);
    const apiUrl = env("API_URL")!;
    const apiKey = env("SERVICE_ROLE_KEY")!;
    const db = createClient(apiUrl, apiKey);

    const { restaurant_id, email, date }: ProfitSummaryRequest = await req.json();

    if (!restaurant_id || !email) {
      return new Response(
        JSON.stringify({ error: "restaurant_id and email are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Honour "Temporarily off" / archived / suspended branches.
    if (!(await isBranchEmailable(db, restaurant_id))) {
      console.log(`Skipping daily profit summary for ${restaurant_id} - branch not emailable`);
      return new Response(
        JSON.stringify({ skipped: true, reason: "branch_not_emailable" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const targetDate = date || new Date().toISOString().split("T")[0];
    const startOfDay = `${targetDate}T00:00:00.000Z`;
    const endOfDay = `${targetDate}T23:59:59.999Z`;

    // Calculate previous period dates for comparison
    const currentDate = new Date(targetDate);
    const yesterdayDate = new Date(currentDate);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const lastWeekDate = new Date(currentDate);
    lastWeekDate.setDate(lastWeekDate.getDate() - 7);

    // Fetch restaurant info
    const { data: restaurant } = await db
      .from("restaurants")
      .select("name, currency")
      .eq("id", restaurant_id)
      .single();

    // Helper function to fetch period data
    const fetchPeriodData = async (dateStr: string): Promise<PeriodData> => {
      const dayStart = `${dateStr}T00:00:00.000Z`;
      const dayEnd = `${dateStr}T23:59:59.999Z`;

      const { data: salesData } = await db
        .from("sales_transactions")
        .select("total")
        .eq("restaurant_id", restaurant_id)
        .gte("created_at", dayStart)
        .lte("created_at", dayEnd);

      const { data: expensesData } = await db
        .from("expenses")
        .select("amount")
        .eq("restaurant_id", restaurant_id)
        .is("deleted_at", null)
        .eq("expense_date", dateStr);

      const totalSales = salesData?.reduce((sum, s) => sum + Number(s.total), 0) || 0;
      const totalExpenses = expensesData?.reduce((sum, e) => sum + Number(e.amount), 0) || 0;
      const estimatedFoodCost = totalSales * 0.28;
      const estimatedLaborCost = totalSales * 0.32;
      const primeCost = estimatedFoodCost + estimatedLaborCost;
      const primeCostPct = totalSales > 0 ? (primeCost / totalSales) * 100 : 0;
      const operatingProfit = totalSales - primeCost - totalExpenses;
      const marginPct = totalSales > 0 ? (operatingProfit / totalSales) * 100 : 0;

      return { totalSales, operatingProfit, primeCostPct, marginPct };
    };

    // Fetch current day data
    const { data: salesData } = await db
      .from("sales_transactions")
      .select("total, payment_method")
      .eq("restaurant_id", restaurant_id)
      .gte("created_at", startOfDay)
      .lte("created_at", endOfDay);

    const { data: expensesData } = await db
      .from("expenses")
      .select("amount")
      .eq("restaurant_id", restaurant_id)
      .is("deleted_at", null)
      .eq("expense_date", targetDate);

    const { data: shiftsData } = await db
      .from("shifts")
      .select("id, status, variance")
      .eq("restaurant_id", restaurant_id)
      .gte("opened_at", startOfDay)
      .lte("opened_at", endOfDay);

    const { data: targetsData } = await db
      .from("profit_targets")
      .select("*")
      .eq("restaurant_id", restaurant_id)
      .eq("target_type", "daily")
      .maybeSingle();

    // Fetch comparison data
    const yesterdayData = await fetchPeriodData(yesterdayDate.toISOString().split("T")[0]);
    const lastWeekData = await fetchPeriodData(lastWeekDate.toISOString().split("T")[0]);

    // Calculate current day summary
    const totalSales = salesData?.reduce((sum, s) => sum + Number(s.total), 0) || 0;
    const cashSales = salesData?.filter(s => s.payment_method === "cash").reduce((sum, s) => sum + Number(s.total), 0) || 0;
    const cardSales = salesData?.filter(s => s.payment_method === "card").reduce((sum, s) => sum + Number(s.total), 0) || 0;
    const totalExpenses = expensesData?.reduce((sum, e) => sum + Number(e.amount), 0) || 0;
    const closedShifts = shiftsData?.filter(s => s.status === "closed").length || 0;
    const avgVariance = shiftsData?.length 
      ? shiftsData.reduce((sum, s) => sum + Math.abs(Number(s.variance || 0)), 0) / shiftsData.length 
      : 0;

    const estimatedFoodCost = totalSales * 0.28;
    const estimatedLaborCost = totalSales * 0.32;
    const primeCost = estimatedFoodCost + estimatedLaborCost;
    const primeCostPct = totalSales > 0 ? (primeCost / totalSales) * 100 : 0;
    const operatingProfit = totalSales - primeCost - totalExpenses;
    const marginPct = totalSales > 0 ? (operatingProfit / totalSales) * 100 : 0;

    // Calculate comparisons
    const vsYesterday = yesterdayData.operatingProfit !== 0 
      ? ((operatingProfit - yesterdayData.operatingProfit) / Math.abs(yesterdayData.operatingProfit)) * 100 
      : operatingProfit > 0 ? 100 : 0;
    const vsLastWeek = lastWeekData.operatingProfit !== 0 
      ? ((operatingProfit - lastWeekData.operatingProfit) / Math.abs(lastWeekData.operatingProfit)) * 100 
      : operatingProfit > 0 ? 100 : 0;

    const salesVsYesterday = yesterdayData.totalSales !== 0
      ? ((totalSales - yesterdayData.totalSales) / yesterdayData.totalSales) * 100
      : totalSales > 0 ? 100 : 0;
    const salesVsLastWeek = lastWeekData.totalSales !== 0
      ? ((totalSales - lastWeekData.totalSales) / lastWeekData.totalSales) * 100
      : totalSales > 0 ? 100 : 0;

    // Check targets
    const dailyTarget = targetsData?.target_amount || 0;
    const targetMet = operatingProfit >= Number(dailyTarget);
    const primeCostTarget = targetsData?.prime_cost_target || 65;
    const primeCostMet = primeCostPct <= Number(primeCostTarget);

    // Determine status
    let status = "Healthy";
    let statusColor = "#22c55e";
    if (primeCostPct > 75 || marginPct < 0) {
      status = "Critical";
      statusColor = "#ef4444";
    } else if (primeCostPct > 65 || marginPct < 10) {
      status = "Needs Attention";
      statusColor = "#f59e0b";
    } else if (primeCostPct <= 55 && marginPct >= 20) {
      status = "Excellent";
      statusColor = "#10b981";
    }

    const currency = restaurant?.currency || "SAR";
    const formatCurrency = (amount: number) => `${currency} ${amount.toFixed(2)}`;
    const formatChange = (change: number) => {
      const sign = change >= 0 ? "+" : "";
      return `${sign}${change.toFixed(1)}%`;
    };
    const changeColor = (change: number) => change >= 0 ? "#22c55e" : "#ef4444";

    // Build email HTML with comparisons
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; }
          .container { max-width: 600px; margin: 0 auto; background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #1a1a1a 0%, #333 100%); color: white; padding: 30px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
          .header p { margin: 10px 0 0; opacity: 0.8; font-size: 14px; }
          .status-badge { display: inline-block; padding: 8px 16px; border-radius: 20px; font-weight: 600; font-size: 14px; margin-top: 15px; }
          .content { padding: 30px; }
          .metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 25px; }
          .metric { background: #f8fafc; border-radius: 8px; padding: 15px; }
          .metric-label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px; }
          .metric-value { font-size: 24px; font-weight: 600; color: #1a1a1a; }
          .metric-sub { font-size: 12px; color: #64748b; margin-top: 3px; }
          .metric-change { font-size: 11px; font-weight: 500; margin-top: 4px; }
          .section { margin-top: 25px; padding-top: 25px; border-top: 1px solid #e2e8f0; }
          .section-title { font-size: 14px; font-weight: 600; color: #1a1a1a; margin-bottom: 15px; }
          .comparison-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          .comparison-table th { text-align: left; font-size: 11px; color: #64748b; text-transform: uppercase; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
          .comparison-table td { padding: 12px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
          .comparison-table .period { color: #64748b; }
          .comparison-table .value { font-weight: 500; }
          .comparison-table .change { font-weight: 600; }
          .target-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
          .target-label { font-size: 14px; color: #64748b; }
          .target-value { font-size: 14px; font-weight: 500; }
          .target-met { color: #22c55e; }
          .target-missed { color: #ef4444; }
          .footer { padding: 20px 30px; background: #f8fafc; text-align: center; font-size: 12px; color: #64748b; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${restaurant?.name || "Restaurant"}</h1>
            <p>Daily Profit Summary • ${new Date(targetDate).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
            <span class="status-badge" style="background-color: ${statusColor}20; color: ${statusColor};">${status}</span>
          </div>
          
          <div class="content">
            <div class="metric-grid">
              <div class="metric">
                <div class="metric-label">Net Sales</div>
                <div class="metric-value">${formatCurrency(totalSales)}</div>
                <div class="metric-sub">Cash: ${formatCurrency(cashSales)} • Card: ${formatCurrency(cardSales)}</div>
                <div class="metric-change" style="color: ${changeColor(salesVsYesterday)}">vs yesterday: ${formatChange(salesVsYesterday)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Operating Profit</div>
                <div class="metric-value" style="color: ${operatingProfit >= 0 ? '#22c55e' : '#ef4444'};">${formatCurrency(operatingProfit)}</div>
                <div class="metric-sub">Margin: ${marginPct.toFixed(1)}%</div>
                <div class="metric-change" style="color: ${changeColor(vsYesterday)}">vs yesterday: ${formatChange(vsYesterday)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Prime Cost</div>
                <div class="metric-value">${primeCostPct.toFixed(1)}%</div>
                <div class="metric-sub">${formatCurrency(primeCost)}</div>
              </div>
              <div class="metric">
                <div class="metric-label">Shifts</div>
                <div class="metric-value">${closedShifts}</div>
                <div class="metric-sub">Avg variance: ±${formatCurrency(avgVariance)}</div>
              </div>
            </div>

            <div class="section">
              <div class="section-title">📊 Period Comparison</div>
              <table class="comparison-table">
                <tr>
                  <th>Period</th>
                  <th>Sales</th>
                  <th>Profit</th>
                  <th>Change</th>
                </tr>
                <tr>
                  <td class="period">Today</td>
                  <td class="value">${formatCurrency(totalSales)}</td>
                  <td class="value">${formatCurrency(operatingProfit)}</td>
                  <td class="change">-</td>
                </tr>
                <tr>
                  <td class="period">Yesterday</td>
                  <td class="value">${formatCurrency(yesterdayData.totalSales)}</td>
                  <td class="value">${formatCurrency(yesterdayData.operatingProfit)}</td>
                  <td class="change" style="color: ${changeColor(vsYesterday)}">${formatChange(vsYesterday)}</td>
                </tr>
                <tr>
                  <td class="period">Same day last week</td>
                  <td class="value">${formatCurrency(lastWeekData.totalSales)}</td>
                  <td class="value">${formatCurrency(lastWeekData.operatingProfit)}</td>
                  <td class="change" style="color: ${changeColor(vsLastWeek)}">${formatChange(vsLastWeek)}</td>
                </tr>
              </table>
            </div>

            ${Number(dailyTarget) > 0 ? `
            <div class="section">
              <div class="section-title">🎯 Target Performance</div>
              <div class="target-row">
                <span class="target-label">Daily Profit Target</span>
                <span class="target-value ${targetMet ? 'target-met' : 'target-missed'}">${targetMet ? '✓' : '✗'} ${formatCurrency(Number(dailyTarget))}</span>
              </div>
              <div class="target-row">
                <span class="target-label">Prime Cost Target</span>
                <span class="target-value ${primeCostMet ? 'target-met' : 'target-missed'}">${primeCostMet ? '✓' : '✗'} ≤${primeCostTarget}%</span>
              </div>
            </div>
            ` : ''}

            <div class="section">
              <div class="section-title">💰 Cost Breakdown</div>
              <div class="target-row">
                <span class="target-label">Estimated Food Cost</span>
                <span class="target-value">${formatCurrency(estimatedFoodCost)} (${((estimatedFoodCost/totalSales)*100 || 0).toFixed(1)}%)</span>
              </div>
              <div class="target-row">
                <span class="target-label">Estimated Labor Cost</span>
                <span class="target-value">${formatCurrency(estimatedLaborCost)} (${((estimatedLaborCost/totalSales)*100 || 0).toFixed(1)}%)</span>
              </div>
              <div class="target-row">
                <span class="target-label">Other Expenses</span>
                <span class="target-value">${formatCurrency(totalExpenses)}</span>
              </div>
            </div>
          </div>

          <div class="footer">
            This is an automated daily profit summary from your restaurant management system.
          </div>
        </div>
      </body>
      </html>
    `;

    // Send email
    const { error: emailError } = await resend.emails.send({
      from: fromAddress("Matbex Reports", "reports"),
      to: [email],
      subject: `📊 Daily Profit Summary: ${formatCurrency(operatingProfit)} (${status}) | ${formatChange(vsYesterday)} vs yesterday`,
      html: emailHtml,
    });

    if (emailError) {
      console.error("Email send error:", emailError);
      throw emailError;
    }

    // Record notification
    await db.from("profit_notifications").insert({
      restaurant_id,
      notification_type: "daily_summary",
      date: targetDate,
      email_sent_at: new Date().toISOString(),
      email_recipient: email,
      summary_data: {
        totalSales,
        operatingProfit,
        primeCostPct,
        marginPct,
        status,
        targetMet,
        vsYesterday,
        vsLastWeek,
      },
    });

    console.log(`Daily profit summary sent to ${email} for ${restaurant?.name}`);

    return new Response(
      JSON.stringify({ success: true, message: "Summary sent successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error sending profit summary:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
