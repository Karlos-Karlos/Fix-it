const https = require('https');

// Resolve the public base URL (used for logo src and reset links)
function getBaseUrl() {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL.replace(/\/$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return 'http://localhost:3000';
}

// Shared HTML email wrapper — light theme, works in Gmail/Outlook/Apple Mail
function emailShell(baseUrl, bodyHtml) {
  const logoUrl = `${baseUrl}/Logo.png`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>FiX-it</title>
</head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0f4f8;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <!-- Header band -->
          <tr>
            <td align="center" style="background:#0f1e35;padding:32px 32px 24px;">
              <img src="${logoUrl}" alt="FiX-it" width="72" height="72"
                   style="display:block;border-radius:14px;margin:0 auto 12px;"
                   onerror="this.style.display='none'">
              <div style="font-size:11px;font-weight:600;letter-spacing:3px;color:#5aaddc;text-transform:uppercase;margin-top:4px;">FiX-it</div>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 32px 28px;">
              ${bodyHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:0 32px 28px;">
              <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.6;">
                This email was sent by FiX-it. If you didn't request this, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Brevo HTTP API (no SMTP — works on Railway) ──
function sendViaBrevo({ to, subject, html }) {
  const FROM_NAME = 'FiX-it';
  const FROM_EMAIL = process.env.EMAIL_FROM || 'noreply@fixit-app.com';

  const payload = JSON.stringify({
    sender: { name: FROM_NAME, email: FROM_EMAIL },
    to: [{ email: to }],
    subject,
    htmlContent: html,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.brevo.com',
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`Brevo API error ${res.statusCode}: ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('Brevo request timed out')); });
    req.write(payload);
    req.end();
  });
}

async function sendMail({ to, subject, html }) {
  if (process.env.BREVO_API_KEY) {
    console.log(`[email] Sending "${subject}" to ${to} via Brevo`);
    await sendViaBrevo({ to, subject, html });
    console.log(`[email] Delivered "${subject}" to ${to}`);
    return;
  }

  // No provider configured — log to console (dev only)
  console.log('──────────────────────────────────────');
  console.log(`EMAIL (no provider): ${subject} → ${to}`);
  console.log('──────────────────────────────────────');
}

async function sendVerificationEmail(to, code) {
  const base = getBaseUrl();
  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f1e35;">Verify your account</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.6;">
      Enter the code below to complete your FiX-it sign-up:
    </p>
    <div style="background:#f0f4f8;border-radius:10px;padding:24px;text-align:center;margin-bottom:24px;">
      <span style="font-size:38px;font-weight:700;letter-spacing:10px;color:#0f1e35;font-family:monospace;">${code}</span>
    </div>
    <p style="margin:0;font-size:13px;color:#94a3b8;">This code expires in 24 hours.</p>
  `;
  await sendMail({
    to,
    subject: 'Your FiX-it verification code',
    html: emailShell(base, body),
  });
}

async function sendPasswordResetEmail(to, token) {
  const base = getBaseUrl();
  const link = `${base}?reset_token=${token}`;
  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f1e35;">Reset your password</h2>
    <p style="margin:0 0 28px;font-size:15px;color:#475569;line-height:1.6;">
      Click the button below to choose a new password for your FiX-it account.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center" style="padding-bottom:28px;">
          <a href="${link}"
             style="display:inline-block;padding:14px 36px;background:#1e78f0;color:#ffffff;font-weight:700;font-size:15px;border-radius:10px;text-decoration:none;letter-spacing:0.3px;">
            Reset Password
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 12px;font-size:13px;color:#94a3b8;">This link expires in 1 hour.</p>
    <p style="margin:0;font-size:12px;color:#cbd5e1;word-break:break-all;">
      Or copy this URL: <a href="${link}" style="color:#1e78f0;">${link}</a>
    </p>
  `;
  await sendMail({
    to,
    subject: 'Reset your FiX-it password',
    html: emailShell(base, body),
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
