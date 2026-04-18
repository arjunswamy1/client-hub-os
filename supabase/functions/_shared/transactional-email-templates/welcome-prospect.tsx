import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Connect Paid Media'
const BRAND = 'hsl(94, 55%, 28%)'

interface WelcomeProspectProps {
  name?: string
  company?: string
}

const WelcomeProspectEmail = ({ name, company }: WelcomeProspectProps) => {
  const firstName = name ? name.split(' ')[0] : 'there'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Welcome to {SITE_NAME} — your demo is ready</Preview>
      <Body style={main}>
        <Container style={container}>
          <Text style={wordmark}>CONNECT PAID MEDIA</Text>
          <Heading style={h1}>Welcome, {firstName} 👋</Heading>
          <Text style={text}>
            Thanks for signing up for the Connect Paid Media Hub
            {company ? ` on behalf of ${company}` : ''}.
          </Text>
          <Text style={text}>
            We're getting your demo workspace ready. In the meantime, book a
            30-minute walkthrough with Charles to see exactly how the Hub will
            surface where your ad spend is leaking — and how to plug it.
          </Text>
          <Section style={{ textAlign: 'center', margin: '32px 0' }}>
            <Button
              href="https://calendly.com/charles-connectpaidmedia/30min"
              style={button}
            >
              Book your walkthrough
            </Button>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>
            Talk soon,
            <br />
            Charles & the {SITE_NAME} team
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: WelcomeProspectEmail,
  subject: (data: Record<string, any>) => {
    const first = data?.name ? String(data.name).split(' ')[0] : 'there'
    return `Welcome to ${SITE_NAME}, ${first}`
  },
  displayName: 'Prospect welcome email',
  previewData: { name: 'Jane Smith', company: 'Acme Co.' },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
}
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const wordmark = {
  fontSize: '12px',
  fontWeight: 700,
  letterSpacing: '0.18em',
  color: BRAND,
  margin: '0 0 24px 0',
}
const h1 = {
  fontSize: '24px',
  fontWeight: 700,
  color: '#111827',
  margin: '0 0 16px 0',
  lineHeight: '1.3',
}
const text = {
  fontSize: '15px',
  color: '#374151',
  lineHeight: '1.6',
  margin: '0 0 16px 0',
}
const button = {
  backgroundColor: BRAND,
  borderRadius: '8px',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: 600,
  padding: '14px 28px',
  textDecoration: 'none',
}
const hr = { borderColor: '#e5e7eb', margin: '32px 0' }
const footer = { fontSize: '13px', color: '#6b7280', margin: 0 }
