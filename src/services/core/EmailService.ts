import nodemailer from "nodemailer";
import FormData from "form-data";
// import Mailgun from "mailgun.js";
import { Resend } from "resend";
import { emailConfig } from "@/config/email";
import logger from "@/logger";
import { emailColors } from "@/config/emailColors";

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export class EmailService {
  private transporter: any;
  private mailgunClient: any;
  private resendClient: Resend | null = null;

  constructor() {
    if (emailConfig.transport === "mailgun") {
      // this.initializeMailgun();
      this.initializeResend();
    } else if (emailConfig.transport === "gmail") {
      this.initializeGmail();
    } else if (emailConfig.transport === "resend") {
      this.initializeResend();
    } else {
      throw new Error("Invalid email transport configuration");
    }
  }

  // private initializeMailgun() {
  //   logger.debug("Initializing Mailgun transport...");
  //   const mailgun = new Mailgun(FormData);
  //   this.mailgunClient = mailgun.client({
  //     username: "api",
  //     key: emailConfig.mailgun.apiKey,
  //     url: `https://${emailConfig.mailgun.host}`,
  //   });
  // }

  private initializeGmail() {
    logger.debug("Initializing Gmail transport...");

    this.transporter = nodemailer.createTransport({
      service: emailConfig.gmail.service || "gmail",
      // auth: emailConfig.gmail.auth,
      auth: {
        user: emailConfig.gmail.auth.user || process.env.EMAIL_USER,
        pass: emailConfig.gmail.auth.pass || process.env.EMAIL_PASSWORD,
      },
    });
  }

  private initializeResend() {
    logger.debug("Initializing Resend transport...");
    this.resendClient = new Resend(
      emailConfig.resend?.apiKey || process.env.RESEND_API_KEY,
    );
  }

  async sendEmail(options: EmailOptions): Promise<void> {
    try {
      if (emailConfig.transport === "mailgun") {
        await this.sendViaMailgun(options);
      } else if (emailConfig.transport === "resend") {
        await this.sendViaResend(options);
      } else {
        await this.sendViaSMTP(options);
      }
      logger.info(`Email sent successfully to ${options.to}`);
    } catch (error) {
      logger.error("Email sending failed:", error);
      throw error;
    }
  }

  private async sendViaMailgun(options: EmailOptions): Promise<void> {
    const messageData = {
      from: `${emailConfig.fromName} <${emailConfig.from}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text || "",
    };

    await this.mailgunClient.messages.create(
      emailConfig.mailgun.domain,
      messageData,
    );
  }

  private async sendViaResend(options: EmailOptions): Promise<void> {
    if (!this.resendClient) {
      throw new Error("Resend client not initialized");
    }

    await this.resendClient.emails.send({
      from: process.env.RESEND_FROM_EMAIL || "",
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
  }

  private async sendViaSMTP(options: EmailOptions): Promise<void> {
    await this.transporter.sendMail({
      from: `${emailConfig.fromName} <${emailConfig.from}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
  }

  async sendVerificationEmail(
    to: string,
    otp: string,
    name: string,
  ): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #${emailColors.textPrimary}; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { 
              background-color: #${emailColors.primary}; 
              color: white; 
              padding: 30px 20px;
              text-align: center;
            }
            .header h2 {
              margin: 0;
              font-size: 24px;
            }
            .content { background-color: #${emailColors.bgLight}; padding: 30px; }
            .otp-box { background-color: white; border: 2px solid #${emailColors.primary}; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #${emailColors.textSecondary}; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div >
             ${this.getEmailHeader("Verify Your Email")}
            </div>
            <div class="content">
              <p>Hello ${name},</p>
              <p>Thank you for registering with ${process.env.APP_NAME}! Please use the OTP below to verify your email address:</p>
              <div class="otp-box">${otp}</div>
              <p>This OTP will expire in 10 minutes.</p>
              <p>If you didn't request this verification, please ignore this email.</p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to,
      subject: `Verify Your Email - ${process.env.APP_NAME}`,
      html,
      text: `Hello ${name}, Your verification OTP is: ${otp}. This OTP will expire in 10 minutes.`,
    });
  }

  async sendPinChangeEmail(to: string, otp: string): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #${emailColors.textPrimary}; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
             .header { 
              background-color: #${emailColors.primary}; 
              color: white; 
              padding: 30px 20px;
              text-align: center;
            }

        

            .header h2 {
              margin: 0;
              font-size: 24px;
            }
            .content { background-color: #${emailColors.bgLight}; padding: 30px; }
            .otp-box { background-color: white; border: 2px solid #${emailColors.primary}; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #${emailColors.textSecondary}; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div>
              ${this.getEmailHeader("Pin Change Request")}
            </div>
            <div class="content">
              <p> Please use the OTP below to change your pin:</p>
              <div class="otp-box">${otp}</div>
              <p>This OTP will expire in 10 minutes.</p>
              <p>If you didn't request this verification, please ignore this email.</p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to,
      subject: `Pin Change Request - ${process.env.APP_NAME}`,
      html,
      text: `Your OTP code is: ${otp}. This OTP will expire in 10 minutes.`,
    });
  }

  async sendForgotPasswordEmail(
    to: string,
    otp: string,
    name: string,
  ): Promise<void> {
    const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #${emailColors.textPrimary}; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
           .header { 
              background-color: #${emailColors.primary}; 
              color: white; 
              padding: 30px 20px;
              text-align: center;
            }

        

            .header h2 {
              margin: 0;
              font-size: 24px;
            }
          .content { background-color: #${emailColors.bgLight}; padding: 30px; }
          .otp-box { background-color: white; border: 2px solid #${emailColors.primary}; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #${emailColors.textSecondary}; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div>
            ${this.getEmailHeader("Password Reset Request")}
          </div>
          <div class="content">
            <p>Hello ${name},</p>
            <p>We received a request to reset your ${process.env.APP_NAME} account password. Please use the OTP below to proceed with resetting your password:</p>
            <div class="otp-box">${otp}</div>
            <p>This OTP will expire in 10 minutes.</p>
            <p>If you did not request a password reset, please ignore this email and your account will remain secure.</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME}. All rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
  `;

    await this.sendEmail({
      to,
      subject: `Reset Your Password - ${process.env.APP_NAME}`,
      html,
      text: `Hello ${name}, Your password reset OTP is: ${otp}. It will expire in 10 minutes. If you did not request a reset, please ignore this email.`,
    });
  }

  async send2FAEmail(to: string, otp: string, name: string): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #${emailColors.textPrimary}; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
             .header { 
              background-color: #${emailColors.primary}; 
              color: white; 
              padding: 30px 20px;
              text-align: center;
            }

        

            .header h2 {
              margin: 0;
              font-size: 24px;
            }
            .content { background-color: #${emailColors.bgLight}; padding: 30px; }
            .otp-box { background-color: white; border: 2px solid #${emailColors.primary}; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; }
            .footer { text-align: center; padding: 20px; color: #${emailColors.textSecondary}; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div>
              ${this.getEmailHeader("Two-Factor Authentication")}
            </div>
            <div class="content">
              <p>Hello ${name},</p>
              <p>Your 2FA verification code is:</p>
              <div class="otp-box">${otp}</div>
              <p>This code will expire in 10 minutes.</p>
              <p>If you didn't request this code, please secure your account immediately.</p>
            </div>
            <div class="footer">
              <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to,
      subject: `Your 2FA Code - ${process.env.APP_NAME}`,
      html,
      text: `Hello ${name}, Your 2FA code is: ${otp}. This code will expire in 10 minutes.`,
    });
  }

  async sendContactEmail(to: string, data: any): Promise<void> {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #${emailColors.textPrimary}; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { 
              background-color: #${emailColors.primary}; 
              color: white; 
              padding: 30px 20px;
              text-align: center;
            }

        

            .header h2 {
              margin: 0;
              font-size: 24px;
            }
            .content { background-color: #${emailColors.bgLight}; padding: 30px; }
            .footer { text-align: center; padding: 20px; color: #${emailColors.textSecondary}; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div>
              ${this.getEmailHeader("Contact Form Submission")}
            </div>
            <div class="content">
              <p>Name: ${data.name}</p>
              <p>Email: ${data.email}</p>
              <p>Message: ${data.message}</p>
            </div>
            <div class="footer"></div>
              <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    await this.sendEmail({
      to,
      subject: `Contact Form Submission - ${process.env.APP_NAME}`,
      html,
      text: `Name: ${data.name}\nEmail: ${data.email}\nMessage: ${data.message}`,
    });
  }

  // Add these methods to the EmailService class
  async sendTransactionReversalEmail(
    to: string,
    name: string,
    txn: any,
    totalDeduction: number,
    reason: string,
  ): Promise<void> {
    const html = `
<!DOCTYPE html>
<html>
  <head>
    <style>
      body {
        font-family: Arial, sans-serif;
        background-color: #f3f4f6;
        color: #${emailColors.textPrimary};
        margin: 0;
        padding: 0;
      }
      .container {
        max-width: 600px;
        margin: 0 auto;
        padding: 20px;
      }
      .header { 
        background-color: #${emailColors.primary}; 
        color: white; 
        padding: 30px 20px;
        text-align: center;
      }


      .header h2 {
        margin: 0;
        font-size: 24px;
      }
      .content {
        background-color: #${emailColors.bgPrimary};
        padding: 30px;
        border-radius: 0 0 8px 8px;
      }
      .info-box {
        background-color: #${emailColors.bgLighter};
        border-left: 4px solid #${emailColors.secondary};
        padding: 15px;
        margin: 20px 0;
      }
      .amount {
        font-size: 32px;
        font-weight: bold;
        color: #${emailColors.success};
        text-align: center;
        margin: 20px 0;
      }
      .details {
        background-color: #${emailColors.bgLight};
        padding: 15px;
        border-radius: 6px;
        margin: 20px 0;
      }
      .detail-row {
        display: flex;
        justify-content: space-between;
        padding: 8px 0;
        border-bottom: 1px solid #${emailColors.bgLight};
      }
      .detail-row:last-child {
        border-bottom: none;
      }
      .label {
        font-weight: 600;
        color: #${emailColors.textSecondary};
      }
      .value {
        color: #${emailColors.textPrimary};
        text-align: right;
      }
      .footer {
        text-align: center;
        font-size: 12px;
        color: #${emailColors.textSecondary};
        padding: 20px;
      }
      .button {
        display: inline-block;
        background-color: #${emailColors.primary};
        color: #${emailColors.bgPrimary};
        padding: 12px 30px;
        text-decoration: none;
        border-radius: 6px;
        margin: 20px 0;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div>
        ${this.getEmailHeader("💰 Transaction Reversed")}
      </div>

      <div class="content">
        <p>Hello ${name},</p>
        
        <p>Your transaction has been reversed and the funds have been returned to your wallet.</p>

        <div class="amount">
          ₦${totalDeduction.toLocaleString("en-NG", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </div>

        <div class="info-box">
          <strong>Reason:</strong> ${reason}
        </div>

        <div class="details">
          <div class="detail-row">
            <span class="label">Transaction Reference</span>
            <span class="value">${txn.reference}</span>
          </div>
          <div class="detail-row">
            <span class="label">Transaction Amount</span>
            <span class="value">₦${txn.amount.toLocaleString("en-NG", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}</span>
          </div>
          ${
            txn.meta?.chargeInfo?.serviceCharge
              ? `
          <div class="detail-row">
            <span class="label">Service Charge</span>
            <span class="value">₦${txn.meta.chargeInfo.serviceCharge.toLocaleString(
              "en-NG",
              { minimumFractionDigits: 2, maximumFractionDigits: 2 },
            )}</span>
          </div>
          `
              : ""
          }
          <div class="detail-row">
            <span class="label">Total Refunded</span>
            <span class="value"><strong>₦${totalDeduction.toLocaleString(
              "en-NG",
              { minimumFractionDigits: 2, maximumFractionDigits: 2 },
            )}</strong></span>
          </div>
          <div class="detail-row">
            <span class="label">Reversed At</span>
            <span class="value">${new Date().toLocaleString("en-NG", {
              dateStyle: "medium",
              timeStyle: "short",
            })}</span>
          </div>
        </div>

        <p>The funds are now available in your wallet and can be used immediately.</p>

        <center>
          <a href="${
            process.env.FRONTEND_URL || `https://${process.env.APP_NAME}.com`
          }/wallet" class="button">View Wallet</a>
        </center>

        <p style="margin-top: 30px; font-size: 14px; color: #${emailColors.textSecondary};">
          If you have any questions about this reversal, please don't hesitate to contact our support team.
        </p>
      </div>

      <div class="footer">
        <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME}</p>
        <p>This is an automated notification.</p>
      </div>
    </div>
  </body>
</html>
  `;

    await this.sendEmail({
      to,
      subject: `Transaction Reversed - ₦${totalDeduction.toLocaleString()}`,
      html,
      text: `
Hello ${name},

Your transaction has been reversed.

Transaction Reference: ${txn.reference}
Amount Refunded: ₦${totalDeduction.toLocaleString()}
Reason: ${reason}

The funds have been returned to your wallet and are now available for use.

If you have any questions, please contact our support team.

Best regards,
${process.env.APP_NAME} Team
    `,
    });
  }

  //ADMIM
  async sendSystemNotificationToAdmin(
    to: string,
    subject: string,
    data: Record<string, any>,
    message: string,
  ): Promise<void> {
    const severity = data?.severity || "info"; // info | warning | error | critical

    const severityColorMap: Record<string, string> = {
      info: "#${emailColors.primary}",
      warning: "#${emailColors.secondary}",
      error: "#${emailColors.error}",
      critical: "#${emailColors.critical}",
    };

    const severityBgMap: Record<string, string> = {
      info: "#EFF6FF",
      warning: "#${emailColors.bgLighter}",
      error: "#${emailColors.error}15",
      critical: "#${emailColors.critical}15",
    };

    const severityColor =
      severityColorMap[severity] || "#${emailColors.primary}";
    const severityBg = severityBgMap[severity] || "#EFF6FF";

    const renderDataRows = (obj: Record<string, any>) =>
      Object.entries(obj || {})
        .filter(([key]) => key !== "severity")
        .map(([key, value]) => {
          let renderedValue: string;

          if (Array.isArray(value)) {
            renderedValue = `
          <table style="width:100%; border-collapse: collapse; margin: 0;">
            ${value
              .map(
                (item, index) => `
              <tr>
                <td style="padding: 4px 8px; border: 1px solid #${emailColors.bgLight}; color: #${emailColors.textSecondary}; width: 30px;">${index + 1}</td>
                <td style="padding: 4px 8px; border: 1px solid #${emailColors.bgLight};">${typeof item === "object" ? JSON.stringify(item) : item}</td>
              </tr>
            `,
              )
              .join("")}
          </table>
        `;
          } else if (typeof value === "object" && value !== null) {
            renderedValue = `<pre style="margin:0">${JSON.stringify(value, null, 2)}</pre>`;
          } else {
            renderedValue = String(value);
          }

          return `
        <tr>
          <td style="padding: 8px; border: 1px solid #${emailColors.bgLight}; vertical-align: top;"><strong>${key}</strong></td>
          <td style="padding: 8px; border: 1px solid #${emailColors.bgLight};">${renderedValue}</td>
        </tr>
      `;
        })
        .join("");

    const html = `
  <!DOCTYPE html>
  <html>
    <head>
      <style>
        body {
          font-family: Arial, sans-serif;
          background-color: #f3f4f6;
          color: #${emailColors.textPrimary};
        }
        .container {
          max-width: 700px;
          margin: 0 auto;
          padding: 20px;
        }
       .header { 
        background-color: #${emailColors.primary}; 
        color: white; 
        padding: 30px 20px;
        text-align: center;
      }


      .header h2 {
        margin: 0;
        font-size: 24px;
      }
        .content {
          background-color: #${emailColors.bgPrimary};
          padding: 25px;
        }
        .alert-box {
          background-color: ${severityBg};
          border-left: 5px solid ${severityColor};
          padding: 15px;
          margin-bottom: 20px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 10px;
        }
        .footer {
          text-align: center;
          font-size: 12px;
          color: #${emailColors.textSecondary};
          padding: 15px;
        }
        pre {
          background-color: #${emailColors.bgLight};
          padding: 10px;
          overflow-x: auto;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div>
          ${this.getEmailHeader("System Notification")}
        </div>

        <div class="content">
          <div class="alert-box">
            <strong>Severity:</strong> ${severity.toUpperCase()}<br />
            <strong>Time:</strong> ${new Date().toLocaleString()}
          </div>

          <p>${message}</p>

          ${
            Object.keys(data || {}).length > 0
              ? `
            <h3>Details</h3>
            <table>
              ${renderDataRows(data)}
            </table>
          `
              : ""
          }
        </div>

        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME} System</p>
          <p>This is an automated system notification.</p>
        </div>
      </div>
    </body>
  </html>
  `;

    await this.sendEmail({
      to,
      subject,
      html,
      text: `
System Notification (${severity.toUpperCase()})

${message}

Details:
${JSON.stringify(data, null, 2)}
    `,
    });
  }

  async sendAdminWelcomeEmail(
    to: string,
    name: string,
    adminLevel: string,
    temporaryPassword: string,
  ): Promise<void> {
    const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #${emailColors.textPrimary}; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { 
        background-color: #${emailColors.primary}; 
        color: white; 
        padding: 30px 20px;
        text-align: center;
      }


      .header h2 {
        margin: 0;
        font-size: 24px;
      }
          .content { background-color: #${emailColors.bgLight}; padding: 30px; }
          .credentials-box { background-color: white; border: 2px solid #${emailColors.primary}; padding: 20px; margin: 20px 0; }
          .password { font-family: monospace; font-size: 18px; font-weight: bold; color: #${emailColors.primary}; }
          .warning { background-color: #${emailColors.bgLighter}; border-left: 4px solid #${emailColors.secondary}; padding: 15px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #${emailColors.textSecondary}; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div >
            ${this.getEmailHeader(`Welcome to ${process.env.APP_NAME} Admin`)}
          </div>
          <div class="content">
            <p>Hello ${name},</p>
            <p>Your admin account has been created successfully! Here are your account details:</p>
            <div class="credentials-box">
              <p><strong>Admin Level:</strong> ${adminLevel}</p>
              <p><strong>Email:</strong> ${to}</p>
              <p><strong>Temporary Password:</strong></p>
              <p class="password">${temporaryPassword}</p>
            </div>
            <div class="warning">
              <strong>⚠️ Important:</strong> For security reasons, please change your password immediately after your first login.
            </div>
            <p>You can now log in to the admin dashboard and start managing your responsibilities.</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME}. All rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
  `;

    await this.sendEmail({
      to,
      subject: `Welcome to ${process.env.APP_NAME} Admin - Your Account Details`,
      html,
      text: `Hello ${name}, Your admin account has been created. Admin Level: ${adminLevel}. Temporary Password: ${temporaryPassword}. Please change your password after first login.`,
    });
  }

  async sendPasswordResetConfirmation(
    to: string,
    name: string,
    newPassword: string,
  ): Promise<void> {
    const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #${emailColors.textPrimary}; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { 
              background-color: #${emailColors.primary}; 
              color: white; 
              padding: 30px 20px;
              text-align: center;
            }

        

            .header h2 {
              margin: 0;
              font-size: 24px;
            }
          .content { background-color: #${emailColors.bgLight}; padding: 30px; }
          .password-box { background-color: white; border: 2px solid #${emailColors.primary}; padding: 20px; text-align: center; margin: 20px 0; }
          .password { font-family: monospace; font-size: 20px; font-weight: bold; color: #${emailColors.primary}; letter-spacing: 2px; }
          .warning { background-color: #${emailColors.bgLighter}; border-left: 4px solid #${emailColors.secondary}; padding: 15px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #${emailColors.textSecondary}; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div>
            ${this.getEmailHeader("Password Reset Successful")}
          </div>
          <div class="content">
            <p>Hello ${name},</p>
            <p>Your password has been reset successfully. Your new temporary password is:</p>
            <div class="password-box">
              <p class="password">${newPassword}</p>
            </div>
            <div class="warning">
              <strong>⚠️ Security Notice:</strong> This is a temporary password. Please change it immediately after logging in to maintain account security.
            </div>
            <p>If you did not request this password reset, please contact support immediately.</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME}. All rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
  `;

    await this.sendEmail({
      to,
      subject: `Password Reset Successful - ${process.env.APP_NAME} Admin`,
      html,
      text: `Hello ${name}, Your password has been reset. Your new temporary password is: ${newPassword}. Please change it after logging in. If you didn't request this, contact support immediately.`,
    });
  }

  async sendLoginSecurityEmail(
    to: string,
    name: string,
    meta?: {
      ipAddress?: string;
      device?: string;
      location?: string;
    },
  ): Promise<void> {
    const now = new Date();
    const time = now.toLocaleTimeString("en-NG", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    });
    const date = now.toLocaleDateString("en-NG", {
      weekday: "long",
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    const detailRows = [
      meta?.location
        ? `<tr><td class="label">Location</td><td class="val">${meta.location}</td></tr>`
        : "",
      meta?.device
        ? `<tr><td class="label">Device</td><td class="val">${meta.device}</td></tr>`
        : "",
      meta?.ipAddress
        ? `<tr><td class="label">IP Address</td><td class="val">${meta.ipAddress}</td></tr>`
        : "",
      `<tr><td class="label">Time</td><td class="val">${time}</td></tr>`,
      `<tr><td class="label">Date</td><td class="val">${date}</td></tr>`,
    ]
      .filter(Boolean)
      .join("");

    const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #${emailColors.textPrimary}; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .content { background-color: #${emailColors.bgLight}; padding: 30px; }
          .detail-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          .detail-table td { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
          .label { font-weight: bold; color: #${emailColors.textSecondary}; width: 40%; }
          .val { color: #${emailColors.textPrimary}; }
          .warning-box { background-color: #fff8e1; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; font-size: 14px; }
          .footer { text-align: center; padding: 20px; color: #${emailColors.textSecondary}; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          ${this.getEmailHeader("New Login Alert")}
          <div class="content">
            <p>Hello ${name},</p>
            <p>We noticed a new sign-in to your account.</p>
            <p><strong>Here are some extra details about this recent login:</strong></p>
            <table class="detail-table">
              ${detailRows}
            </table>
            <p>If this was you, please disregard this message.</p>
            <div class="warning-box">
              If that wasn't you, we highly advise that you change your password as soon as possible and contact our support team immediately.
            </div>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME}. All rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
  `;

    await this.sendEmail({
      to,
      subject: `New Login Alert On Your ${process.env.APP_NAME} Account`,
      html,
      text: `Hello ${name}, we noticed a new sign-in to your account. Time: ${time}, Date: ${date}${meta?.device ? `, Device: ${meta.device}` : ""}${meta?.ipAddress ? `, IP: ${meta.ipAddress}` : ""}. If this wasn't you, change your password immediately.`,
    });
  }

  async sendWelcomeEmail(to: string, name: string): Promise<void> {
    const appStoreUrl = process.env.APP_STORE_URL || "";
    const playStoreUrl = process.env.PLAY_STORE_URL || "";
    const dashboardUrl = process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/dashboard`
      : "";

    const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f3f4f6; color: #${emailColors.textPrimary}; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .hero {
            background: linear-gradient(135deg, #${emailColors.primary} 0%, #${emailColors.secondary || emailColors.primary} 100%);
            padding: 50px 30px;
            text-align: center;
            color: white;
          }
          .hero h1 { margin: 0 0 10px; font-size: 28px; }
          .hero p  { margin: 0; font-size: 16px; opacity: 0.9; }
          .content { background-color: white; padding: 35px 30px; }
          .features { display: flex; gap: 0; margin: 30px 0; }
          .feature { flex: 1; text-align: center; padding: 15px 10px; }
          .feature-icon { font-size: 28px; margin-bottom: 8px; }
          .feature-title { font-weight: bold; font-size: 14px; color: #${emailColors.textPrimary}; margin-bottom: 4px; }
          .feature-desc  { font-size: 12px; color: #${emailColors.textSecondary}; }
          .divider { border: none; border-top: 1px solid #e5e7eb; margin: 25px 0; }
          .cta-section { text-align: center; margin: 30px 0; }
          .cta-btn {
            display: inline-block;
            background-color: #${emailColors.primary};
            color: white !important;
            padding: 14px 36px;
            text-decoration: none;
            border-radius: 8px;
            font-weight: bold;
            font-size: 16px;
          }
          .store-section { text-align: center; margin: 25px 0; }
          .store-section p { font-size: 13px; color: #${emailColors.textSecondary}; margin-bottom: 12px; }
          .store-badge {
            display: inline-block;
            background-color: #${emailColors.textPrimary};
            color: white !important;
            padding: 10px 20px;
            border-radius: 8px;
            text-decoration: none;
            font-size: 13px;
            margin: 0 5px;
          }
          .footer { text-align: center; padding: 20px; color: #${emailColors.textSecondary}; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div>
            <img src="${process.env.EMAIL_LOGO_URL}" alt="${process.env.APP_NAME}" style="height:50px; width:auto; display:block; margin: 20px auto;">
          </div>

          <div class="hero">
            <h1>Welcome to ${process.env.APP_NAME}! 🎉</h1>
            <p>Your account is verified and ready to go.</p>
          </div>

          <div class="content">
            <p>Hello ${name},</p>
            <p>We're thrilled to have you on board. Your email has been verified successfully and your account is now fully active.</p>

            <div class="features">
              <div class="feature">
                <div class="feature-icon">⚡</div>
                <div class="feature-title">Fast Transfers</div>
                <div class="feature-desc">Send & receive money instantly</div>
              </div>
              <div class="feature">
                <div class="feature-icon">🔒</div>
                <div class="feature-title">Bank-Grade Security</div>
                <div class="feature-desc">Your funds are always protected</div>
              </div>
              <div class="feature">
                <div class="feature-icon">💳</div>
                <div class="feature-title">Smart Payments</div>
                <div class="feature-desc">Pay bills & more with ease</div>
              </div>
            </div>

            <hr class="divider">

            ${
              dashboardUrl
                ? `
            <div class="cta-section">
              <p style="margin-bottom:16px; color:#${emailColors.textSecondary}; font-size:14px;">Ready to get started?</p>
              <a href="${dashboardUrl}" class="cta-btn">Go to Dashboard</a>
            </div>
            `
                : ""
            }

            ${
              appStoreUrl || playStoreUrl
                ? `
            <div class="store-section">
              <p>Or download our mobile app:</p>
              ${appStoreUrl ? `<a href="${appStoreUrl}"  class="store-badge">🍎 App Store</a>` : ""}
              ${playStoreUrl ? `<a href="${playStoreUrl}" class="store-badge">▶ Google Play</a>` : ""}
            </div>
            `
                : ""
            }

          </div>

          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME}. All rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
  `;

    await this.sendEmail({
      to,
      subject: `Welcome to ${process.env.APP_NAME} – You're all set! 🎉`,
      html,
      text: `Hello ${name}, welcome to ${process.env.APP_NAME}! Your account is verified and ready. ${dashboardUrl ? `Visit your dashboard: ${dashboardUrl}` : ""}`,
    });
  }

  async sendProfileIncompleteEmail(to: string, name: string): Promise<void> {
    const html = `
      <!DOCTYPE html><html><head><style>
        body { font-family: Arial, sans-serif; color: #${emailColors.textPrimary}; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .content { background-color: #${emailColors.bgLight}; padding: 30px; }
        .cta { display: inline-block; background-color: #${emailColors.primary}; color: white !important; padding: 12px 28px; text-decoration: none; border-radius: 6px; margin-top: 15px; }
        .footer { text-align: center; padding: 20px; color: #${emailColors.textSecondary}; font-size: 12px; }
      </style></head><body>
        <div class="container">
          ${this.getEmailHeader("Finish Setting Up Your Account")}
          <div class="content">
            <p>Hello ${name},</p>
            <p>You're almost there! Complete your profile (phone, email and BVN verification) to unlock full access to your ${process.env.APP_NAME} account.</p>
            <a href="${process.env.FRONTEND_URL || ""}/profile" class="cta">Complete My Profile</a>
          </div>
          <div class="footer"><p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME}</p></div>
        </div>
      </body></html>`;
    await this.sendEmail({
      to,
      subject: `Finish setting up your ${process.env.APP_NAME} account`,
      html,
      text: `Hello ${name}, complete your profile (phone, email, BVN) to unlock full access.`,
    });
  }

  async sendNoTransactionReminderEmail(
    to: string,
    name: string,
    daysSinceSignup: number,
  ): Promise<void> {
    const html = `
      <!DOCTYPE html><html><head><style>
        body { font-family: Arial, sans-serif; color: #${emailColors.textPrimary}; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .content { background-color: #${emailColors.bgLight}; padding: 30px; }
        .cta { display: inline-block; background-color: #${emailColors.primary}; color: white !important; padding: 12px 28px; text-decoration: none; border-radius: 6px; margin-top: 15px; }
        .footer { text-align: center; padding: 20px; color: #${emailColors.textSecondary}; font-size: 12px; }
      </style></head><body>
        <div class="container">
          ${this.getEmailHeader("Still There?")}
          <div class="content">
            <p>Hello ${name},</p>
            <p>It's been ${daysSinceSignup} days since you joined ${process.env.APP_NAME} and you haven't made a transaction yet. Fund your wallet and try it out — airtime, data, bills and more, all in one place.</p>
            <a href="${process.env.FRONTEND_URL || ""}/dashboard" class="cta">Get Started</a>
          </div>
          <div class="footer"><p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME}</p></div>
        </div>
      </body></html>`;
    await this.sendEmail({
      to,
      subject: `Haven't tried ${process.env.APP_NAME} yet?`,
      html,
      text: `Hello ${name}, it's been ${daysSinceSignup} days and you haven't made a transaction yet. Come try it out.`,
    });
  }

  async sendFirstTransactionEmail(to: string, name: string): Promise<void> {
    const html = `
      <!DOCTYPE html><html><head><style>
        body { font-family: Arial, sans-serif; color: #${emailColors.textPrimary}; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .content { background-color: #${emailColors.bgLight}; padding: 30px; }
        .footer { text-align: center; padding: 20px; color: #${emailColors.textSecondary}; font-size: 12px; }
      </style></head><body>
        <div class="container">
          ${this.getEmailHeader("🎉 First Transaction Complete!")}
          <div class="content">
            <p>Hello ${name},</p>
            <p>Congrats on your first transaction on ${process.env.APP_NAME}! Welcome to the family — this is just the beginning.</p>
          </div>
          <div class="footer"><p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME}</p></div>
        </div>
      </body></html>`;
    await this.sendEmail({
      to,
      subject: `You just made your first transaction 🎉`,
      html,
      text: `Hello ${name}, congrats on your first transaction on ${process.env.APP_NAME}!`,
    });
  }

  async sendTransactionCelebrationEmail(
    to: string,
    name: string,
  ): Promise<void> {
    const html = `
      <!DOCTYPE html><html><head><style>
        body { font-family: Arial, sans-serif; color: #${emailColors.textPrimary}; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .content { background-color: #${emailColors.bgLight}; padding: 30px; }
        .footer { text-align: center; padding: 20px; color: #${emailColors.textSecondary}; font-size: 12px; }
      </style></head><body>
        <div class="container">
          ${this.getEmailHeader("Transaction Successful ✅")}
          <div class="content">
            <p>Hello ${name},</p>
            <p>Nice one! Your transaction just went through successfully. Thanks for using ${process.env.APP_NAME}.</p>
          </div>
          <div class="footer"><p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME}</p></div>
        </div>
      </body></html>`;
    await this.sendEmail({
      to,
      subject: `Transaction successful ✅`,
      html,
      text: `Hello ${name}, your transaction just went through successfully.`,
    });
  }

  async sendInactivityWinBackEmail(
    to: string,
    name: string,
    daysInactive: number,
  ): Promise<void> {
    const html = `
      <!DOCTYPE html><html><head><style>
        body { font-family: Arial, sans-serif; color: #${emailColors.textPrimary}; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .content { background-color: #${emailColors.bgLight}; padding: 30px; }
        .cta { display: inline-block; background-color: #${emailColors.primary}; color: white !important; padding: 12px 28px; text-decoration: none; border-radius: 6px; margin-top: 15px; }
        .footer { text-align: center; padding: 20px; color: #${emailColors.textSecondary}; font-size: 12px; }
      </style></head><body>
        <div class="container">
          ${this.getEmailHeader("We Miss You")}
          <div class="content">
            <p>Hello ${name},</p>
            <p>It's been ${daysInactive} days since your last transaction on ${process.env.APP_NAME}. Come back and see what's new.</p>
            <a href="${process.env.FRONTEND_URL || ""}/dashboard" class="cta">Come Back</a>
          </div>
          <div class="footer"><p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME}</p></div>
        </div>
      </body></html>`;
    await this.sendEmail({
      to,
      subject: `We miss you on ${process.env.APP_NAME}`,
      html,
      text: `Hello ${name}, it's been ${daysInactive} days since your last transaction.`,
    });
  }

  private getEmailHeader(title: string): string {
    return `
    <div style="text-align: center; margin-bottom: 0;">
      <img src="${process.env.EMAIL_LOGO_URL}" alt="Logo" style="height: 50px; width: auto; display: block; margin: 0 auto 20px;">
    </div>
    
    <div class="header">
      <h2 style="margin: 0; padding: 0; font-size: 24px; color: white;">${title}</h2>
    </div>
  `;
  }
}
