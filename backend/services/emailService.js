const https = require('https');

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
