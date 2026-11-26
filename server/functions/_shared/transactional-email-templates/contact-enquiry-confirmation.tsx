import * as React from 'react'
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry.ts'

interface ContactEnquiryConfirmationProps {
  name?: string
  message?: string
}

export const ContactEnquiryConfirmationEmail = ({
  name = 'there',
  message = '',
}: ContactEnquiryConfirmationProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>We received your message — the Matbex team will reply shortly</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>Matbex</Text>
        <Heading style={h1}>Thanks, {name} — we have your message</Heading>
        <Text style={text}>
          Our team reads every enquiry and replies within one business day. If your
          question is urgent, just reply to this email and it comes straight to us.
        </Text>
        {message ? (
          <>
            <Hr style={hr} />
            <Text style={label}>What you sent us</Text>
            <Text style={quote}>{message}</Text>
          </>
        ) : null}
        <Text style={footer}>
          Matbex — restaurant financial control, built in Saudi Arabia.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: ContactEnquiryConfirmationEmail,
  displayName: 'Contact enquiry (visitor confirmation)',
  subject: "We've got your message — Matbex",
  previewData: {
    name: 'Sara',
    message: 'We run three branches in Riyadh and want to know about onboarding.',
  },
} satisfies TemplateEntry

export default ContactEnquiryConfirmationEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" }
const container = { padding: '32px 28px', maxWidth: '560px' }
const eyebrow = { fontSize: '12px', fontWeight: 500 as const, color: '#00A859', letterSpacing: '0.08em', textTransform: 'uppercase' as const, margin: '0 0 12px' }
const h1 = { fontSize: '22px', fontWeight: 600 as const, color: '#0a0a0a', letterSpacing: '-0.02em', margin: '0 0 20px' }
const text = { fontSize: '15px', fontWeight: 300 as const, color: '#4a4a4a', lineHeight: '1.7', margin: '0 0 20px' }
const hr = { borderColor: '#eaeaea', margin: '24px 0' }
const label = { fontSize: '12px', fontWeight: 600 as const, color: '#0a0a0a', letterSpacing: '0.04em', textTransform: 'uppercase' as const, margin: '0 0 8px' }
const quote = { fontSize: '14px', fontWeight: 300 as const, color: '#4a4a4a', lineHeight: '1.7', margin: '0', whiteSpace: 'pre-wrap' as const, borderLeft: '3px solid #00A859', paddingLeft: '14px' }
const footer = { fontSize: '12px', fontWeight: 300 as const, color: '#9a9a9a', lineHeight: '1.5', margin: '32px 0 0' }
