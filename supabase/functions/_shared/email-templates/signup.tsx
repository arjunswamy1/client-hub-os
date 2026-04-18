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

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({
  siteUrl,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email for Connect Paid Media</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brandHeader}>
          <Text style={wordmark}>CONNECT PAID MEDIA</Text>
        </Section>
        <Heading style={h1}>Confirm your email</Heading>
        <Text style={text}>
          Thanks for signing up for{' '}
          <Link href={siteUrl} style={link}>
            <strong>Connect Paid Media</strong>
          </Link>
          . You're one click away from seeing exactly where your ad spend is leaking — and how to plug it.
        </Text>
        <Text style={text}>
          Confirm{' '}
          <Link href={`mailto:${recipient}`} style={link}>{recipient}</Link>{' '}
          to activate your Hub access:
        </Text>
        <Button style={button} href={confirmationUrl}>
          Confirm email
        </Button>
        <Text style={footer}>
          If you didn't create an account, you can safely ignore this email.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default SignupEmail

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
  margin: '0 0 20px',
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
