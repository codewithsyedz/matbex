import * as React from 'npm:react@18.3.1'
import { Html, Head, Body, Container, Heading, Text, Button, Preview, Hr } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
interface Props { restaurant?: string; expenses?: number; vat?: number; inventory?: number; details?: string[]; }
const Email = ({restaurant = 'Matbex', expenses = 0, vat = 0, inventory = 0, details = []}: Props) => <Html lang="en"><Head/><Preview>Accounting work needs review at {restaurant}</Preview><Body style={main}><Container style={container}><Text style={brand}>MATBEX</Text><Heading>Accounting review pending</Heading><Text>{restaurant}</Text><Text>Expenses requiring review: {expenses}<br/>VAT reviews / reversal checks: {vat}<br/>Low-stock inventory items: {inventory}</Text><Hr/>{details.map((detail, index) => <Text key={index}>{detail}</Text>)}<Text>A VAT review is a request to check the expense, not an automatic VAT reversal.</Text><Button href="https://www.matbex.com/dashboard" style={button}>Open Matbex</Button></Container></Body></Html>
export const template = { component: Email, subject: 'Matbex: accounting review pending', displayName: 'Accountant pending work', to: 'dev@matbex.com', previewData: {restaurant:'Riyadh-HQ', expenses:1, vat:1, inventory:1, details:['Expense awaiting VAT review','Inventory at reorder level']} } satisfies TemplateEntry
const main = {backgroundColor:'#ffffff', fontFamily:'Arial, sans-serif', color:'#17251d'}
const container = {padding:'32px 24px', maxWidth:'600px'}
const brand = {color:'#166235', fontWeight:700}
const button = {backgroundColor:'#166235', color:'#ffffff', padding:'12px 20px', borderRadius:'6px'}