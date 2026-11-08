import * as React from 'react'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry.ts'

interface LoyaltyReengagementProps {
  name?: string
  restaurantName?: string
  points?: string
}

export const LoyaltyReengagementEmail = ({
  name = 'there',
  restaurantName = 'our restaurant',
  points = '0',
}: LoyaltyReengagementProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You have {points} loyalty points waiting at {restaurantName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>We miss you, {name}</Heading>
        <Text style={text}>
          You have <strong style={strong}>{points} loyalty points</strong> waiting at{' '}
          {restaurantName}. Come in and put them to use on your next visit.
        </Text>
        <Button style={button} href="https://matbex.com">
          See your rewards
        </Button>
        <Text style={footer}>
          You are receiving this because you joined the {restaurantName} loyalty program.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: LoyaltyReengagementEmail,
  displayName: 'Loyalty re-engagement',
  subject: (data: Record<string, any>) =>
    `${data?.points ?? '0'} loyalty points are waiting for you`,
  previewData: {
    name: 'Sara',
    restaurantName: 'Matbex Kitchen',
    points: '240',
  },
} satisfies TemplateEntry

export default LoyaltyReengagementEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" }
const container = { padding: '32px 28px', maxWidth: '560px' }
const h1 = { fontSize: '24px', fontWeight: 600 as const, color: '#0a0a0a', letterSpacing: '-0.02em', margin: '0 0 20px' }
const text = { fontSize: '15px', fontWeight: 300 as const, color: '#4a4a4a', lineHeight: '1.6', margin: '0 0 24px' }
const strong = { color: '#00A859', fontWeight: 600 as const }
const button = { backgroundColor: '#00A859', color: '#ffffff', fontSize: '14px', fontWeight: 500 as const, borderRadius: '10px', padding: '12px 22px', textDecoration: 'none', display: 'inline-block' }
const footer = { fontSize: '12px', fontWeight: 300 as const, color: '#9a9a9a', lineHeight: '1.5', margin: '32px 0 0' }
