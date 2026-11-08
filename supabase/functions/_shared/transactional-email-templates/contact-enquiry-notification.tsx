import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface ContactEnquiryNotificationProps {
  name?: string
  email?: string
  message?: string
  submittedAt?: string
}

export const ContactEnquiryNotificationEmail = ({
  name = 'Unknown',
  email = 'unknown@example.com',
  message = '(no message)',
  submittedAt = '',
}: ContactEnquiryNotificationProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>New enquiry from {name}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>Matbex — website enquiry</Text>
        <Heading style={h1}>{name} wants to talk</Heading>
        <Text style={meta}>
          <strong style={strong}>Email:</strong> {email}
        </Text>
        {submittedAt ? (
          <Text style={meta}>
            <strong style={strong}>Received:</strong> {submittedAt}
          </Text>
        ) : null}
        <Hr style={hr} />
        <Text style={text}>{message}</Text>
        <Text style={footer}>
          Reply directly to this email to reach {name}.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: ContactEnquiryNotificationEmail,
  displayName: 'Contact enquiry (team notification)',
  subject: (data: Record<string, any>) =>
    `New Matbex enquiry from ${data?.name ?? 'a visitor'}`,
  to: 'hello@matbex.com',
  previewData: {
    name: 'Sara Al-Otaibi',
    email: 'sara@example.com',
    message: 'We run three branches in Riyadh and want to know about onboarding.',
    submittedAt: '8 Sep 2026, 11:30 (Riyadh)',
  },
} satisfies TemplateEntry

export default ContactEnquiryNotificationEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" }
const container = { padding: '32px 28px', maxWidth: '560px' }
const eyebrow = { fontSize: '12px', fontWeight: 500 as const, color: '#00A859', letterSpacing: '0.08em', textTransform: 'uppercase' as const, margin: '0 0 12px' }
const h1 = { fontSize: '22px', fontWeight: 600 as const, color: '#0a0a0a', letterSpacing: '-0.02em', margin: '0 0 20px' }
const meta = { fontSize: '14px', fontWeight: 300 as const, color: '#4a4a4a', lineHeight: '1.6', margin: '0 0 6px' }
const strong = { color: '#0a0a0a', fontWeight: 600 as const }
const hr = { borderColor: '#eaeaea', margin: '24px 0' }
const text = { fontSize: '15px', fontWeight: 300 as const, color: '#2a2a2a', lineHeight: '1.7', margin: '0 0 24px', whiteSpace: 'pre-wrap' as const }
const footer = { fontSize: '12px', fontWeight: 300 as const, color: '#9a9a9a', lineHeight: '1.5', margin: '32px 0 0' }
