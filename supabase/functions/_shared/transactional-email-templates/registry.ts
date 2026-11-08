import type { ComponentType } from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

import { template as loyaltyReengagementTemplate } from './loyalty-reengagement.tsx'
import { template as contactEnquiryNotificationTemplate } from './contact-enquiry-notification.tsx'
import { template as contactEnquiryConfirmationTemplate } from './contact-enquiry-confirmation.tsx'
import { template as accountantPendingAlertTemplate } from './accountant-pending-alert.tsx'

/**
 * Template registry — maps template names to their React Email components.
 * Import and register new templates here after creating them in this directory.
 */
export const TEMPLATES: Record<string, TemplateEntry> = {
  'accountant-pending-alert': accountantPendingAlertTemplate,
  'loyalty-reengagement': loyaltyReengagementTemplate,
  'contact-enquiry-notification': contactEnquiryNotificationTemplate,
  'contact-enquiry-confirmation': contactEnquiryConfirmationTemplate,
}
