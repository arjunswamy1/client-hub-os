/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your verification code</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brandHeader}>
          <Text style={wordmark}>CONNECT PAID MEDIA</Text>
        </Section>
        <Heading style={h1}>Confirm reauthentication</Heading>
        <Text style={text}>Use the code below to confirm your identity:</Text>
        <Text style={codeStyle}>{token}</Text>
        <Text style={footer}>
          This code will expire shortly. If you didn't request it, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail

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
  margin: '0 0 16px',
}
const codeStyle = {
  fontFamily: "'SF Mono', Menlo, Courier, monospace",
  fontSize: '28px',
  fontWeight: 700 as const,
  letterSpacing: '0.15em',
  color: 'hsl(94, 55%, 28%)',
  backgroundColor: 'hsl(220, 14%, 96%)',
  padding: '16px 20px',
  borderRadius: '8px',
  display: 'inline-block',
  margin: '0 0 24px',
}
const footer = { fontSize: '13px', color: 'hsl(220, 10%, 55%)', margin: '32px 0 0', lineHeight: '1.5' }
