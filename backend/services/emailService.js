const nodemailer = require('nodemailer');

let _transport = null;
function getTransport() {
  if (_transport) return _transport;

  if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
    _transport = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
      connectionTimeout: 10000,
      socketTimeout: 10000,
    });
    return _transport;
  }

  if (process.env.SMTP_HOST) {
    _transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: process.env.SMTP_PORT === '465',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 10000,
      socketTimeout: 10000,
    });
    return _transport;
  }

  return null;
}

const FROM_ADDRESS = process.env.EMAIL_FROM || process.env.GMAIL_USER || process.env.SMTP_USER || 'noreply@fixit.app';

async function sendMail({ to, subject, html }) {
  const transport = getTransport();
  if (transport) {
    await transport.sendMail({ from: `"FiX-it" <${FROM_ADDRESS}>`, to, subject, html });
    return;
  }

  // No email provider configured — log to console (dev only)
  console.log('──────────────────────────────────────');
  console.log(`EMAIL: ${subject}`);
  console.log(`TO:    ${to}`);
  console.log(`HTML:  ${html.replace(/<[^>]+>/g, '').trim().slice(0, 200)}`);
  console.log('──────────────────────────────────────');
}

async function sendVerificationEmail(to, code) {
  await sendMail({
    to,
    subject: 'Your FiX-it verification code',
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#1a1917;border-radius:12px;">
        <h2 style="color:#c9a962;margin:0 0 8px 0;font-size:22px;">FiX-it</h2>
        <p style="color:#d4d0c8;margin:0 0 24px 0;font-size:15px;">Enter this code to verify your account:</p>
        <div style="background:#232120;border:1px solid #3a3632;border-radius:8px;padding:24px;text-align:center;margin-bottom:24px;">
          <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#ffffff;font-family:monospace;">${code}</span>
        </div>
        <p style="color:#8a8578;margin:0;font-size:13px;">This code expires in 24 hours. If you didn't create an account, ignore this email.</p>
      </div>
    `,
  });
}

async function sendPasswordResetEmail(to, token) {
  const base = process.env.FRONTEND_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3000');
  const link = `${base}?reset_token=${token}`;

  await sendMail({
    to,
    subject: 'Reset your FiX-it password',
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#1a1917;border-radius:12px;">
        <h2 style="color:#c9a962;margin:0 0 8px 0;font-size:22px;">FiX-it</h2>
        <p style="color:#d4d0c8;margin:0 0 24px 0;font-size:15px;">Click the button below to reset your password:</p>
        <div style="text-align:center;margin-bottom:24px;">
          <a href="${link}" style="display:inline-block;padding:14px 32px;background:#c9a962;color:#141211;font-weight:700;font-size:15px;border-radius:8px;text-decoration:none;">Reset Password</a>
        </div>
        <p style="color:#8a8578;margin:0;font-size:13px;">This link expires in 1 hour. If you didn't request a reset, ignore this email.</p>
      </div>
    `,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
