import { db } from "@/integrations/db/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Json } from "@/integrations/db/types";

export type SuperAdminActionType =
  | "TENANT_CREATE"
  | "TENANT_STATUS_CHANGE"
  | "TENANT_RENAME"
  | "TENANT_DELETE"
  | "PLAN_CHANGE"
  | "FEATURE_TOGGLE"
  | "BILLING_CHANGE"
  | "USER_ROLE_CHANGE"
  | "USER_CREATE"
  | "USER_DELETE"
  | "PASSWORD_RESET_FORCE"
  | "MFA_RESET_FORCE"
  | "IMPERSONATION_START"
  | "IMPERSONATION_END"
  | "ACCOUNT_UNLOCK"
  | "SESSION_REVOKE"
  | "BULK_DATA_DELETE"
  | "BULK_DATA_IMPORT"
  | "RLS_POLICY_CHANGE"
  | "SECURITY_SETTING_CHANGE"
  | "GLOBAL_CONFIG_CHANGE"
  | "DATA_EXPORT"
  | "DATA_EXPORT_APPROVE"
  | "DATA_EXPORT_REJECT"
  | "RETENTION_POLICY_CHANGE"
  | "API_TOKEN_CREATE"
  | "API_TOKEN_REVOKE"
  | "AUDIT_LOG_EXPORT"
  | "WEBHOOK_CONFIG_CHANGE"
  | "OTHER";

export type AuditTargetType =
  | "tenant"
  | "user"
  | "restaurant"
  | "plan"
  | "feature"
  | "setting"
  | "export_request"
  | "session"
  | "webhook"
  | "api_token"
  | "audit_log"
  | "other";

interface AuditEventParams {
  actionType: SuperAdminActionType;
  targetType: AuditTargetType;
  targetId?: string;
  targetIdentifier?: string;
  metadataBefore?: Json;
  metadataAfter?: Json;
  context?: Json;
  summary?: string;
  correlationId?: string;
}

export function useSuperAdminAudit() {
  const { user, profile } = useAuth();

  const logEvent = async (params: AuditEventParams): Promise<string | null> => {
    if (!user || !profile) {
      console.error("Cannot log audit event: no authenticated user");
      return null;
    }

    try {
      const { data, error } = await db.rpc("log_superadmin_event", {
        _actor_id: user.id,
        _actor_email: user.email || "unknown",
        _action_type: params.actionType,
        _target_type: params.targetType,
        _target_id: params.targetId || null,
        _target_identifier: params.targetIdentifier || null,
        _metadata_before: params.metadataBefore || {},
        _metadata_after: params.metadataAfter || {},
        _context: params.context || {},
        _summary: params.summary || null,
        _ip_address: null,
        _user_agent: navigator.userAgent,
        _correlation_id: params.correlationId || null,
      });

      if (error) {
        console.error("Error logging SuperAdmin audit event:", error);
        return null;
      }

      return data as string;
    } catch (error) {
      console.error("Error logging SuperAdmin audit event:", error);
      return null;
    }
  };

  // Convenience methods for common actions
  const logTenantStatusChange = async (
    tenantId: string,
    tenantName: string,
    oldStatus: string,
    newStatus: string
  ) => {
    return logEvent({
      actionType: "TENANT_STATUS_CHANGE",
      targetType: "tenant",
      targetId: tenantId,
      targetIdentifier: tenantName,
      metadataBefore: { status: oldStatus },
      metadataAfter: { status: newStatus },
      summary: `Changed tenant "${tenantName}" status from ${oldStatus} to ${newStatus}`,
      context: { tenant_id: tenantId },
    });
  };

  const logTenantRename = async (
    tenantId: string,
    before: { name: string; slug: string | null },
    after: { name: string; slug: string | null }
  ) => {
    return logEvent({
      actionType: "TENANT_RENAME",
      targetType: "tenant",
      targetId: tenantId,
      targetIdentifier: after.name,
      metadataBefore: before as unknown as Json,
      metadataAfter: after as unknown as Json,
      summary: `Renamed tenant "${before.name}" → "${after.name}"${
        before.slug !== after.slug ? ` (slug ${before.slug ?? "-"} → ${after.slug ?? "-"})` : ""
      }`,
      context: { tenant_id: tenantId },
    });
  };

  const logPlanChange = async (
    tenantId: string,
    tenantName: string,
    oldPlan: { id: string; name: string } | null,
    newPlan: { id: string; name: string } | null
  ) => {
    return logEvent({
      actionType: "PLAN_CHANGE",
      targetType: "tenant",
      targetId: tenantId,
      targetIdentifier: tenantName,
      metadataBefore: { plan: oldPlan },
      metadataAfter: { plan: newPlan },
      summary: `Changed tenant "${tenantName}" plan from ${oldPlan?.name || "none"} to ${newPlan?.name || "none"}`,
      context: { tenant_id: tenantId },
    });
  };

  const logFeatureToggle = async (
    tenantId: string,
    tenantName: string,
    featureKey: string,
    enabled: boolean
  ) => {
    return logEvent({
      actionType: "FEATURE_TOGGLE",
      targetType: "feature",
      targetId: tenantId,
      targetIdentifier: featureKey,
      metadataBefore: { enabled: !enabled },
      metadataAfter: { enabled },
      summary: `${enabled ? "Enabled" : "Disabled"} feature "${featureKey}" for tenant "${tenantName}"`,
      context: { tenant_id: tenantId, feature_key: featureKey },
    });
  };

  const logAccountUnlock = async (
    email: string,
    lockId: string
  ) => {
    return logEvent({
      actionType: "ACCOUNT_UNLOCK",
      targetType: "user",
      targetId: lockId,
      targetIdentifier: email,
      summary: `Unlocked account for user "${email}"`,
    });
  };

  const logSessionRevoke = async (
    sessionId: string,
    userId: string,
    userEmail: string,
    tenantId?: string
  ) => {
    return logEvent({
      actionType: "SESSION_REVOKE",
      targetType: "session",
      targetId: sessionId,
      targetIdentifier: userEmail,
      summary: `Revoked session for user "${userEmail}"`,
      context: { user_id: userId, tenant_id: tenantId },
    });
  };

  const logExportApproval = async (
    exportId: string,
    tenantId: string,
    exportType: string,
    approved: boolean,
    reason?: string
  ) => {
    return logEvent({
      actionType: approved ? "DATA_EXPORT_APPROVE" : "DATA_EXPORT_REJECT",
      targetType: "export_request",
      targetId: exportId,
      metadataAfter: { approved, reason },
      summary: `${approved ? "Approved" : "Rejected"} ${exportType} export request`,
      context: { tenant_id: tenantId },
    });
  };

  const logAuditLogExport = async (
    filters: Json,
    rowCount: number
  ) => {
    return logEvent({
      actionType: "AUDIT_LOG_EXPORT",
      targetType: "audit_log",
      metadataAfter: { filters, row_count: rowCount } as Json,
      summary: `Exported ${rowCount} audit log entries`,
    });
  };

  const logWebhookChange = async (
    webhookId: string,
    webhookName: string,
    action: "create" | "update" | "delete",
    before?: Json,
    after?: Json
  ) => {
    return logEvent({
      actionType: "WEBHOOK_CONFIG_CHANGE",
      targetType: "webhook",
      targetId: webhookId,
      targetIdentifier: webhookName,
      metadataBefore: before || {},
      metadataAfter: after || {},
      summary: `${action.charAt(0).toUpperCase() + action.slice(1)}d webhook "${webhookName}"`,
    });
  };

  const logImpersonation = async (
    userId: string,
    userEmail: string,
    tenantId: string,
    start: boolean
  ) => {
    return logEvent({
      actionType: start ? "IMPERSONATION_START" : "IMPERSONATION_END",
      targetType: "user",
      targetId: userId,
      targetIdentifier: userEmail,
      summary: `${start ? "Started" : "Ended"} impersonation of user "${userEmail}"`,
      context: { tenant_id: tenantId },
    });
  };

  return {
    logEvent,
    logTenantStatusChange,
    logTenantRename,
    logPlanChange,
    logFeatureToggle,
    logAccountUnlock,
    logSessionRevoke,
    logExportApproval,
    logAuditLogExport,
    logWebhookChange,
    logImpersonation,
  };
}
