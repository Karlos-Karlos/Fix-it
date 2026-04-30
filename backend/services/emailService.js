const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

async function sendVerificationEmail(to, code) {
  const transport = getTransporter();

  if (!transport) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('──────────────────────────────────────');
      console.log('EMAIL: Verify your account');
      console.log(`TO:    ${to}`);
      console.log(`CODE:  ${code}`);
      console.log('──────────────────────────────────────');
    } else {
      console.warn(`[emailService] SMTP not configured — verification email NOT sent to ${to}`);
    }
    return;
  }

  await transport.sendMail({
    from: process.env.SMTP_USER,
    to,
    subject: 'Your FiX-it verification code',
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #1a1917; border-radius: 12px;">
        <h2 style="color: #c9a962; margin: 0 0 8px 0; font-size: 22px;">FiX-it</h2>
        <p style="color: #d4d0c8; margin: 0 0 24px 0; font-size: 15px;">Enter this code to verify your account:</p>
        <div style="background: #232120; border: 1px solid #3a3632; border-radius: 8px; padding: 24px; text-align: center; margin-bottom: 24px;">
          <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #ffffff; font-family: monospace;">${code}</span>
        </div>
        <p style="color: #8a8578; margin: 0; font-size: 13px;">This code expires in 24 hours. If you didn't create an account, ignore this email.</p>
      </div>
    `,
  });
}

async function sendPasswordResetEmail(to, token) {
  const base = process.env.FRONTEND_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3000');
  const link = `${base}?reset_token=${token}`;
  const transport = getTransporter();

  if (!transport) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('──────────────────────────────────────');
      console.log('EMAIL: Password reset');
      console.log(`TO:    ${to}`);
      console.log(`TOKEN: ${token}`);
      console.log(`LINK:  ${link}`);
      console.log('──────────────────────────────────────');
    } else {
      console.warn(`[emailService] SMTP not configured — password reset email NOT sent to ${to}`);
    }
    return;
  }

  await transport.sendMail({
    from: process.env.SMTP_USER,
    to,
    subject: 'Reset your FiX-it password',
    html: `<p>Click <a href="${link}">here</a> to reset your password.</p><p>This link expires in 1 hour.</p>`,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
