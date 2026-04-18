/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({ siteUrl, confirmationUrl }: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You've been invited to Connect Paid Media</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brandHeader}>
          <Text style={wordmark}>CONNECT PAID MEDIA</Text>
        </Section>
        <Heading style={h1}>You've been invited</Heading>
        <Text style={text}>
          You've been invited to join the{' '}
          <Link href={siteUrl} style={link}>
            <strong>Connect Paid Media Hub</strong>
          </Link>
          . Accept the invitation to set up your account and start tracking performance.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Accept invitation
        </Button>
        <Text style={footer}>
          Weren't expecting this? You can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default InviteEmail

const main = {
  backgroundColor: '#ffffff',
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
}
const container = { padding: '32px 25px', maxWidth: '560px' }
const brandHeader = { borderBottom: '1px solid #e5e7eb', paddingBottom: '16px', marginBottom: '24px' }
const wordmark = {
  fontSize: '12px',
  fontWeight: 700 as const,
  letterSpacing: '0.18em',
  color: 'hsl(94, 55%, 28%)',
  margin: 0,
}
const h1 = {
  fontSize: '24px',
  fontWeight: 700 as const,
  color: 'hsl(220, 20%, 10%)',
  margin: '0 0 20px',
  letterSpacing: '-0.01em',
}
const text = {
  fontSize: '15px',
  color: 'hsl(220, 10%, 35%)',
  lineHeight: '1.6',
  margin: '0 0 24px',
}
const link = { color: 'hsl(94, 55%, 28%)', textDecoration: 'underline' }
const button = {
  backgroundColor: 'hsl(94, 55%, 28%)',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: 600 as const,
  borderRadius: '8px',
  padding: '14px 28px',
  textDecoration: 'none',
  display: 'inline-block',
}
const footer = { fontSize: '13px', color: 'hsl(220, 10%, 55%)', margin: '32px 0 0', lineHeight: '1.5' }
