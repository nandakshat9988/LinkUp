const nodemailer = require('nodemailer');

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER || process.env.GMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.GMAIL_PASS;
  const port = parseInt(process.env.SMTP_PORT, 10) || 587;

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });
  }

  if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS
      }
    });
  }

  return null;
}

async function sendOtpEmail(toEmail, otpCode, userName = 'there') {
  const transporter = createTransporter();

  if (!transporter) {
    console.log(`\n======================================================`);
    console.log(`[LinkUp Auth] OTP for ${toEmail}: ${otpCode}`);
    console.log(`(SMTP not configured in .env; OTP logged above for testing)`);
    console.log(`======================================================\n`);
    return { success: true, mode: 'console', otp: otpCode };
  }

  const fromAddress = process.env.SMTP_FROM || `"LinkUp Sports" <${process.env.SMTP_USER || process.env.GMAIL_USER}>`;

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 520px; margin: 0 auto; background: #080b11; color: #f8fafc; padding: 32px 24px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1);">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="font-size: 24px; color: #38bdf8; margin: 0;">LinkUp</h1>
        <p style="color: #94a3b8; font-size: 14px; margin-top: 4px;">Location-Based Match & Activity Hub</p>
      </div>

      <div style="background: rgba(18, 24, 38, 0.9); padding: 24px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); text-align: center;">
        <h2 style="font-size: 18px; margin-top: 0; color: #ffffff;">Verify Your Account</h2>
        <p style="color: #cbd5e1; font-size: 14px; line-height: 1.6;">
          Hi ${userName}, welcome to LinkUp! Use the one-time verification code below to complete creating your account.
        </p>

        <div style="margin: 24px 0; background: rgba(56, 189, 248, 0.1); border: 2px dashed #38bdf8; border-radius: 10px; padding: 16px;">
          <span style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #38bdf8;">${otpCode}</span>
        </div>

        <p style="color: #94a3b8; font-size: 12px; margin-bottom: 0;">
          ⏰ This code will expire in <strong>10 minutes</strong>. If you didn't request this code, you can safely ignore this email.
        </p>
      </div>

      <p style="text-align: center; color: #64748b; font-size: 12px; margin-top: 24px;">
        © 2026 LinkUp - Find Players & Play Instantly.
      </p>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to: toEmail,
      subject: `Your LinkUp Verification Code: ${otpCode}`,
      text: `Your LinkUp verification code is: ${otpCode}. It expires in 10 minutes.`,
      html
    });

    return { success: true, mode: 'smtp', messageId: info.messageId };
  } catch (err) {
    console.error('[LinkUp Mailer] Error sending email:', err.message);
    // Fallback to console log so registration is not blocked by SMTP outages
    console.log(`[LinkUp Fallback] OTP for ${toEmail}: ${otpCode}`);
    return { success: true, mode: 'fallback_console', otp: otpCode };
  }
}

module.exports = {
  sendOtpEmail
};
