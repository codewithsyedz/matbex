import { serve } from "../_runtime/serve.ts";
import { corsHeaders } from '../_runtime/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { hasValidCronSecret } from '../_shared/cronSecret.ts';
import { env } from '../_runtime/env.ts';
import { createClient } from '@matbex/client';
import { sendTemplateEmail } from '../_shared/transactional-email-templates/send-email.ts';
import { pendingExpenseReasons, inventoryNeedsAttention, pendingSignature, type PendingRecord } from './pending.ts';
const RESTAURANT_ID = 'fe1a4d9e-1595-43ba-a47a-37575a9a55b9';
const TENANT_ID = 'fe1a4d9e-1595-43ba-a47a-37575a9a55b9';
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers:{...corsHeaders, 'Content-Type':'application/json'}});
serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', {headers:corsHeaders});
  if (req.method !== 'POST') return response({error:'Method not allowed'},405);
  try {
    // Two callers: the accountant dashboard (user JWT, checked below) and the worker's
    // schedule (x-cron-secret; server/src/jobs/schedules.ts), so alerts go out while the
    // dashboard is closed. Both read only the fixed restaurant and mail the fixed recipient;
    // the content-derived idempotency key stops repeat sends of an unchanged backlog.
    let client;
    if (await hasValidCronSecret(req)) {
      client = createClient(env('API_URL')!, env('SERVICE_ROLE_KEY')!, {auth:{persistSession:false}});
    } else {
      const {userId, userClient} = await requireUser(req);
      const {data: profile, error: profileError} = await userClient.from('profiles').select('tenant_id,restaurant_id').eq('id',userId).single();
      if (profileError) throw profileError;
      if (profile?.tenant_id !== TENANT_ID || profile.restaurant_id !== RESTAURANT_ID) return response({status:'not_enabled'});
      const permissions = await Promise.all(['accountant','owner','manager','superadmin'].map(role => userClient.rpc('has_role', {_user_id:userId,_role:role})));
      if (!permissions.some(p => !p.error && p.data === true)) return response({error:'Forbidden'},403);
      client = userClient;
    }
    const load = async (table: 'expenses' | 'inventory_items', columns: string) => {
      const rows: PendingRecord[] = [];
      for (let offset=0; ;offset+=1000) {
        let q = client.from(table).select(columns).eq('restaurant_id',RESTAURANT_ID).order('id').range(offset,offset+999);
        if (table==='expenses') q=q.eq('tenant_id',TENANT_ID).is('deleted_at',null);
        else q=q.eq('is_active',true);
        const {data,error}=await q;
        if(error) throw error;
        rows.push(...(data || []) as unknown as PendingRecord[]);
        if(!data || data.length<1000) return rows;
      }
    };
    const [expenses,inventory] = await Promise.all([
      load('expenses','id,description,amount,vat_amount,branch_id,account_id,ledger_posted,approval_status,vat_split_status,deleted_at'),
      load('inventory_items','id,name,is_active,current_stock,reorder_level,branch_id'),
    ]);
    const pending=expenses.filter(r=>pendingExpenseReasons(r).length);
    const low=inventory.filter(inventoryNeedsAttention);
    // Sales missing from the ledger: closed days not posted, and days with POS sales but no End of Day.
    const [{data: unposted, error: uErr}, {data: noEod, error: nErr}] = await Promise.all([
      client.from('daily_sales_summary').select('sales_date,total_sales').eq('restaurant_id',RESTAURANT_ID)
        .in('status',['closed','approved']).or('ledger_posted.is.null,ledger_posted.eq.false'),
      client.rpc('days_without_end_of_day',{p_restaurant_id:RESTAURANT_ID,p_branch_id:null}),
    ]);
    if(uErr) throw uErr;
    if(nErr) throw nErr;
    const sum=(rows: Array<Record<string, unknown>>, k: string)=>rows.reduce((s,r)=>s+Number(r[k]||0),0);
    const sar=(n: number)=>n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' SAR';
    const u=(unposted||[]) as Array<Record<string, unknown>>, n=(noEod||[]) as Array<Record<string, unknown>>;
    const salesMissing=[
      ...(u.length?[`${u.length} closed day(s) not posted · ${sar(sum(u,'total_sales'))} (Daily Profit → Auto-post)`]:[]),
      ...(n.length?[`${n.length} day(s) with sales but no End of Day · ${sar(sum(n,'pos_total'))} (Sales → Day-End)`]:[]),
    ];
    if(!pending.length && !low.length && !salesMissing.length) return response({status:'nothing_pending'});
    const signature=pendingSignature(expenses,inventory)+JSON.stringify(salesMissing);
    const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(signature));
    const hash=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
    const details=[...pending.slice(0,15).map(r=>`${r.description || 'Expense'} · ${pendingExpenseReasons(r).join(', ')}`),...low.slice(0,15).map(r=>`${r.name} · stock ${r.current_stock}, reorder level ${r.reorder_level}`)];
    const result=await sendTemplateEmail('accountant-pending-alert','',{templateData:{restaurant:'Riyadh-HQ',salesMissing,expenses:pending.length,vat:pending.filter(r=>r.vat_split_status==='pending').length,inventory:low.length,details},idempotencyKey:`accountant-pending-${RESTAURANT_ID}-${hash}`});
    return response(result.sent ? {status:'sent',expenses:pending.length,inventory:low.length} : {status:'suppressed'});
  } catch(error) {
    if(error instanceof Response) return response({error:'Unauthorized'},error.status);
    console.error('Accounting alert failed', error instanceof Error ? error.message : 'Unknown error');
    return response({error:'Accounting email could not be sent'},500);
  }
});